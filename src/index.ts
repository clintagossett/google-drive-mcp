#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { google } from "googleapis";
import type { drive_v3 } from "googleapis";
import { v4 as uuidv4 } from 'uuid';
import { authenticate, runAuthCommand, AuthServer, initializeOAuth2Client } from './auth.js';
import { z } from 'zod';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';

// Drive service - will be created with auth when needed
let drive: any = null;

// Helper to ensure drive service has current auth
function ensureDriveService() {
  if (!authClient) {
    throw new Error('Authentication required');
  }
  
  // Log detailed auth client info
  log('About to create drive service', {
    authClientType: authClient?.constructor?.name,
    hasCredentials: !!authClient.credentials,
    credentialsKeys: authClient.credentials ? Object.keys(authClient.credentials) : [],
    accessTokenLength: authClient.credentials?.access_token?.length,
    accessTokenPrefix: authClient.credentials?.access_token?.substring(0, 20),
    expiryDate: authClient.credentials?.expiry_date,
    isExpired: authClient.credentials?.expiry_date ? Date.now() > authClient.credentials.expiry_date : 'no expiry'
  });
  
  // Create drive service with auth parameter directly
  drive = google.drive({ version: 'v3', auth: authClient });
  
  log('Drive service created/updated', {
    hasAuth: !!authClient,
    hasCredentials: !!authClient.credentials,
    hasAccessToken: !!authClient.credentials?.access_token
  });
  
  // Test the auth by making a simple API call
  drive.about.get({ fields: 'user' })
    .then((response: any) => {
      log('Auth test successful, user:', response.data.user?.emailAddress);
    })
    .catch((error: any) => {
      log('Auth test failed:', error.message || error);
      if (error.response) {
        log('Auth test error details:', {
          status: error.response.status,
          statusText: error.response.statusText,
          headers: error.response.headers,
          data: error.response.data
        });
      }
    });
}

// -----------------------------------------------------------------------------
// CONSTANTS & CONFIG
// -----------------------------------------------------------------------------
const FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder';
const TEXT_MIME_TYPES = {
  txt: 'text/plain',
  md: 'text/markdown'
};
// Global auth client - will be initialized on first use
let authClient: any = null;
let authenticationPromise: Promise<any> | null = null;

// Get package version
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageJsonPath = join(__dirname, '..', 'package.json');
const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
const VERSION = packageJson.version;

// -----------------------------------------------------------------------------
// LOGGING UTILITY
// -----------------------------------------------------------------------------
function log(message: string, data?: any) {
  const timestamp = new Date().toISOString();
  const logMessage = data
    ? `[${timestamp}] ${message}: ${JSON.stringify(data)}`
    : `[${timestamp}] ${message}`;
  console.error(logMessage);
}

// -----------------------------------------------------------------------------
// HELPER FUNCTIONS
// -----------------------------------------------------------------------------
function getExtensionFromFilename(filename: string): string {
  return filename.split('.').pop()?.toLowerCase() || '';
}

function getMimeTypeFromFilename(filename: string): string {
  const ext = getExtensionFromFilename(filename);
  return TEXT_MIME_TYPES[ext as keyof typeof TEXT_MIME_TYPES] || 'text/plain';
}



/**
 * Resolve a slash-delimited path (e.g. "/some/folder") within Google Drive
 * into a folder ID. Creates folders if they don't exist.
 */
async function resolvePath(pathStr: string): Promise<string> {
  if (!pathStr || pathStr === '/') return 'root';

  // Note: This function is called after ensureAuthenticated, so drive should exist
  const parts = pathStr.replace(/^\/+|\/+$/g, '').split('/');
  let currentFolderId: string = 'root';

  for (const part of parts) {
    if (!part) continue;
    let response = await drive.files.list({
      q: `'${currentFolderId}' in parents and name = '${part}' and mimeType = '${FOLDER_MIME_TYPE}' and trashed = false`,
      fields: 'files(id)',
      spaces: 'drive'
    });

    // If the folder segment doesn't exist, create it
    if (!response.data.files?.length) {
      const folderMetadata = {
        name: part,
        mimeType: FOLDER_MIME_TYPE,
        parents: [currentFolderId]
      };
      const folder = await drive.files.create({
        requestBody: folderMetadata,
        fields: 'id'
      });

      if (!folder.data.id) {
        throw new Error(`Failed to create intermediate folder: ${part}`);
      }

      currentFolderId = folder.data.id;
    } else {
      // Folder exists, proceed deeper
      currentFolderId = response.data.files[0].id!;
    }
  }

  return currentFolderId;
}


/**
 * Resolve a folder ID or path.
 * If it's a path (starts with '/'), resolve it.
 * If no folder is provided, return 'root'.
 */
async function resolveFolderId(input: string | undefined): Promise<string> {
  if (!input) return 'root';

  if (input.startsWith('/')) {
    // Input is a path
    return resolvePath(input);
  } else {
    // Input is a folder ID, return as-is
    return input;
  }
}

/**
 * For text-based files, ensure they have a valid extension.
 */
function validateTextFileExtension(name: string) {
  const ext = getExtensionFromFilename(name);
  if (!['txt', 'md'].includes(ext)) {
    throw new Error("File name must end with .txt or .md for text files.");
  }
}

/**
 * Convert A1 notation to GridRange for Google Sheets API
 */
function convertA1ToGridRange(a1Notation: string, sheetId: number): any {
  // Regular expression to match A1 notation like "A1", "B2:D5", "A:A", "1:1"
  const rangeRegex = /^([A-Z]*)([0-9]*)(:([A-Z]*)([0-9]*))?$/;
  const match = a1Notation.match(rangeRegex);
  
  if (!match) {
    throw new Error(`Invalid A1 notation: ${a1Notation}`);
  }
  
  const [, startCol, startRow, , endCol, endRow] = match;
  
  const gridRange: any = { sheetId };
  
  // Convert column letters to numbers (A=0, B=1, etc.)
  const colToNum = (col: string): number => {
    let num = 0;
    for (let i = 0; i < col.length; i++) {
      num = num * 26 + (col.charCodeAt(i) - 'A'.charCodeAt(0) + 1);
    }
    return num - 1;
  };
  
  // Set start indices
  if (startCol) gridRange.startColumnIndex = colToNum(startCol);
  if (startRow) gridRange.startRowIndex = parseInt(startRow) - 1;
  
  // Set end indices (exclusive)
  if (endCol) {
    gridRange.endColumnIndex = colToNum(endCol) + 1;
  } else if (startCol && !endCol) {
    gridRange.endColumnIndex = gridRange.startColumnIndex + 1;
  }
  
  if (endRow) {
    gridRange.endRowIndex = parseInt(endRow);
  } else if (startRow && !endRow) {
    gridRange.endRowIndex = gridRange.startRowIndex + 1;
  }
  
  return gridRange;
}

/**
 * Check if a file with the given name already exists in the specified folder.
 * Returns the file ID if it exists, null otherwise.
 */
async function checkFileExists(name: string, parentFolderId: string = 'root'): Promise<string | null> {
  try {
    const escapedName = name.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    const query = `name = '${escapedName}' and '${parentFolderId}' in parents and trashed = false`;
    
    const res = await drive.files.list({
      q: query,
      fields: 'files(id, name, mimeType)',
      pageSize: 1
    });
    
    if (res.data.files && res.data.files.length > 0) {
      return res.data.files[0].id || null;
    }
    return null;
  } catch (error) {
    log('Error checking file existence:', error);
    return null;
  }
}

// -----------------------------------------------------------------------------
// INPUT VALIDATION SCHEMAS
// -----------------------------------------------------------------------------
const SearchSchema = z.object({
  query: z.string().min(1, "Search query is required")
});

const CreateTextFileSchema = z.object({
  name: z.string().min(1, "File name is required"),
  content: z.string(),
  parentFolderId: z.string().optional()
});

const UpdateTextFileSchema = z.object({
  fileId: z.string().min(1, "File ID is required"),
  content: z.string(),
  name: z.string().optional()
});

const CreateFolderSchema = z.object({
  name: z.string().min(1, "Folder name is required"),
  parent: z.string().optional()
});

const ListFolderSchema = z.object({
  folderId: z.string().optional(),
  pageSize: z.number().min(1).max(100).optional(),
  pageToken: z.string().optional()
});

const DeleteItemSchema = z.object({
  itemId: z.string().min(1, "Item ID is required")
});

const RenameItemSchema = z.object({
  itemId: z.string().min(1, "Item ID is required"),
  newName: z.string().min(1, "New name is required")
});

const MoveItemSchema = z.object({
  itemId: z.string().min(1, "Item ID is required"),
  destinationFolderId: z.string().optional()
});

const CreateGoogleDocSchema = z.object({
  name: z.string().min(1, "Document name is required"),
  content: z.string(),
  parentFolderId: z.string().optional()
});

const UpdateGoogleDocSchema = z.object({
  documentId: z.string().min(1, "Document ID is required"),
  content: z.string()
});

const CreateGoogleSheetSchema = z.object({
  name: z.string().min(1, "Sheet name is required"),
  data: z.array(z.array(z.string())),
  parentFolderId: z.string().optional()
});

const UpdateGoogleSheetSchema = z.object({
  spreadsheetId: z.string().min(1, "Spreadsheet ID is required"),
  range: z.string().min(1, "Range is required"),
  data: z.array(z.array(z.string()))
});

const GetGoogleSheetContentSchema = z.object({
  spreadsheetId: z.string().min(1, "Spreadsheet ID is required"),
  range: z.string().min(1, "Range is required")
});

const FormatGoogleSheetCellsSchema = z.object({
  spreadsheetId: z.string().min(1, "Spreadsheet ID is required"),
  range: z.string().min(1, "Range is required"),
  backgroundColor: z.object({
    red: z.number().min(0).max(1).optional(),
    green: z.number().min(0).max(1).optional(),
    blue: z.number().min(0).max(1).optional()
  }).optional(),
  horizontalAlignment: z.enum(["LEFT", "CENTER", "RIGHT"]).optional(),
  verticalAlignment: z.enum(["TOP", "MIDDLE", "BOTTOM"]).optional(),
  wrapStrategy: z.enum(["OVERFLOW_CELL", "CLIP", "WRAP"]).optional()
});

const FormatGoogleSheetTextSchema = z.object({
  spreadsheetId: z.string().min(1, "Spreadsheet ID is required"),
  range: z.string().min(1, "Range is required"),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  strikethrough: z.boolean().optional(),
  underline: z.boolean().optional(),
  fontSize: z.number().min(1).optional(),
  fontFamily: z.string().optional(),
  foregroundColor: z.object({
    red: z.number().min(0).max(1).optional(),
    green: z.number().min(0).max(1).optional(),
    blue: z.number().min(0).max(1).optional()
  }).optional()
});

const FormatGoogleSheetNumbersSchema = z.object({
  spreadsheetId: z.string().min(1, "Spreadsheet ID is required"),
  range: z.string().min(1, "Range is required"),
  pattern: z.string().min(1, "Pattern is required"),
  type: z.enum(["NUMBER", "CURRENCY", "PERCENT", "DATE", "TIME", "DATE_TIME", "SCIENTIFIC"]).optional()
});

const SetGoogleSheetBordersSchema = z.object({
  spreadsheetId: z.string().min(1, "Spreadsheet ID is required"),
  range: z.string().min(1, "Range is required"),
  style: z.enum(["SOLID", "DASHED", "DOTTED", "DOUBLE"]),
  width: z.number().min(1).max(3).optional(),
  color: z.object({
    red: z.number().min(0).max(1).optional(),
    green: z.number().min(0).max(1).optional(),
    blue: z.number().min(0).max(1).optional()
  }).optional(),
  top: z.boolean().optional(),
  bottom: z.boolean().optional(),
  left: z.boolean().optional(),
  right: z.boolean().optional(),
  innerHorizontal: z.boolean().optional(),
  innerVertical: z.boolean().optional()
});

const MergeGoogleSheetCellsSchema = z.object({
  spreadsheetId: z.string().min(1, "Spreadsheet ID is required"),
  range: z.string().min(1, "Range is required"),
  mergeType: z.enum(["MERGE_ALL", "MERGE_COLUMNS", "MERGE_ROWS"])
});

const AddGoogleSheetConditionalFormatSchema = z.object({
  spreadsheetId: z.string().min(1, "Spreadsheet ID is required"),
  range: z.string().min(1, "Range is required"),
  condition: z.object({
    type: z.enum(["NUMBER_GREATER", "NUMBER_LESS", "TEXT_CONTAINS", "TEXT_STARTS_WITH", "TEXT_ENDS_WITH", "CUSTOM_FORMULA"]),
    value: z.string()
  }),
  format: z.object({
    backgroundColor: z.object({
      red: z.number().min(0).max(1).optional(),
      green: z.number().min(0).max(1).optional(),
      blue: z.number().min(0).max(1).optional()
    }).optional(),
    textFormat: z.object({
      bold: z.boolean().optional(),
      foregroundColor: z.object({
        red: z.number().min(0).max(1).optional(),
        green: z.number().min(0).max(1).optional(),
        blue: z.number().min(0).max(1).optional()
      }).optional()
    }).optional()
  })
});

const CreateGoogleSlidesSchema = z.object({
  name: z.string().min(1, "Presentation name is required"),
  slides: z.array(z.object({
    title: z.string(),
    content: z.string()
  })).min(1, "At least one slide is required"),
  parentFolderId: z.string().optional()
});

const UpdateGoogleSlidesSchema = z.object({
  presentationId: z.string().min(1, "Presentation ID is required"),
  slides: z.array(z.object({
    title: z.string(),
    content: z.string()
  })).min(1, "At least one slide is required")
});

const FormatGoogleDocTextSchema = z.object({
  documentId: z.string().min(1, "Document ID is required"),
  startIndex: z.number().min(1, "Start index must be at least 1"),
  endIndex: z.number().min(1, "End index must be at least 1"),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  underline: z.boolean().optional(),
  strikethrough: z.boolean().optional(),
  fontSize: z.number().optional(),
  foregroundColor: z.object({
    red: z.number().min(0).max(1).optional(),
    green: z.number().min(0).max(1).optional(),
    blue: z.number().min(0).max(1).optional()
  }).optional()
});

const FormatGoogleDocParagraphSchema = z.object({
  documentId: z.string().min(1, "Document ID is required"),
  startIndex: z.number().min(1, "Start index must be at least 1"),
  endIndex: z.number().min(1, "End index must be at least 1"),
  namedStyleType: z.enum(['NORMAL_TEXT', 'TITLE', 'SUBTITLE', 'HEADING_1', 'HEADING_2', 'HEADING_3', 'HEADING_4', 'HEADING_5', 'HEADING_6']).optional(),
  alignment: z.enum(['START', 'CENTER', 'END', 'JUSTIFIED']).optional(),
  lineSpacing: z.number().optional(),
  spaceAbove: z.number().optional(),
  spaceBelow: z.number().optional()
});

const GetGoogleDocContentSchema = z.object({
  documentId: z.string().min(1, "Document ID is required")
});

// Google Slides Formatting Schemas
const GetGoogleSlidesContentSchema = z.object({
  presentationId: z.string().min(1, "Presentation ID is required"),
  slideIndex: z.number().min(0).optional()
});

const FormatGoogleSlidesTextSchema = z.object({
  presentationId: z.string().min(1, "Presentation ID is required"),
  objectId: z.string().min(1, "Object ID is required"),
  startIndex: z.number().min(0).optional(),
  endIndex: z.number().min(0).optional(),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  underline: z.boolean().optional(),
  strikethrough: z.boolean().optional(),
  fontSize: z.number().optional(),
  fontFamily: z.string().optional(),
  foregroundColor: z.object({
    red: z.number().min(0).max(1).optional(),
    green: z.number().min(0).max(1).optional(),
    blue: z.number().min(0).max(1).optional()
  }).optional()
});

const FormatGoogleSlidesParagraphSchema = z.object({
  presentationId: z.string().min(1, "Presentation ID is required"),
  objectId: z.string().min(1, "Object ID is required"),
  alignment: z.enum(['START', 'CENTER', 'END', 'JUSTIFIED']).optional(),
  lineSpacing: z.number().optional(),
  bulletStyle: z.enum(['NONE', 'DISC', 'ARROW', 'SQUARE', 'DIAMOND', 'STAR', 'NUMBERED']).optional()
});

const StyleGoogleSlidesShapeSchema = z.object({
  presentationId: z.string().min(1, "Presentation ID is required"),
  objectId: z.string().min(1, "Shape object ID is required"),
  backgroundColor: z.object({
    red: z.number().min(0).max(1).optional(),
    green: z.number().min(0).max(1).optional(),
    blue: z.number().min(0).max(1).optional(),
    alpha: z.number().min(0).max(1).optional()
  }).optional(),
  outlineColor: z.object({
    red: z.number().min(0).max(1).optional(),
    green: z.number().min(0).max(1).optional(),
    blue: z.number().min(0).max(1).optional()
  }).optional(),
  outlineWeight: z.number().optional(),
  outlineDashStyle: z.enum(['SOLID', 'DOT', 'DASH', 'DASH_DOT', 'LONG_DASH', 'LONG_DASH_DOT']).optional()
});

const SetGoogleSlidesBackgroundSchema = z.object({
  presentationId: z.string().min(1, "Presentation ID is required"),
  pageObjectIds: z.array(z.string()).min(1, "At least one page object ID is required"),
  backgroundColor: z.object({
    red: z.number().min(0).max(1).optional(),
    green: z.number().min(0).max(1).optional(),
    blue: z.number().min(0).max(1).optional(),
    alpha: z.number().min(0).max(1).optional()
  })
});

const CreateGoogleSlidesTextBoxSchema = z.object({
  presentationId: z.string().min(1, "Presentation ID is required"),
  pageObjectId: z.string().min(1, "Page object ID is required"),
  text: z.string().min(1, "Text content is required"),
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
  fontSize: z.number().optional(),
  bold: z.boolean().optional(),
  italic: z.boolean().optional()
});

const CreateGoogleSlidesShapeSchema = z.object({
  presentationId: z.string().min(1, "Presentation ID is required"),
  pageObjectId: z.string().min(1, "Page object ID is required"),
  shapeType: z.enum(['RECTANGLE', 'ELLIPSE', 'DIAMOND', 'TRIANGLE', 'STAR', 'ROUND_RECTANGLE', 'ARROW']),
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
  backgroundColor: z.object({
    red: z.number().min(0).max(1).optional(),
    green: z.number().min(0).max(1).optional(),
    blue: z.number().min(0).max(1).optional(),
    alpha: z.number().min(0).max(1).optional()
  }).optional()
});

// Phase 1 Google Docs API Tools
const DocsDeleteContentRangeSchema = z.object({
  documentId: z.string().min(1, "Document ID is required"),
  startIndex: z.number().min(1, "Start index must be at least 1"),
  endIndex: z.number().min(1, "End index must be at least 1")
});

const DocsReplaceAllTextSchema = z.object({
  documentId: z.string().min(1, "Document ID is required"),
  containsText: z.string().min(1, "Search text is required"),
  replaceText: z.string(),
  matchCase: z.boolean().optional()
});

const DocsCreateParagraphBulletsSchema = z.object({
  documentId: z.string().min(1, "Document ID is required"),
  startIndex: z.number().min(1, "Start index must be at least 1"),
  endIndex: z.number().min(1, "End index must be at least 1"),
  bulletPreset: z.enum([
    'BULLET_DISC_CIRCLE_SQUARE',
    'BULLET_DIAMONDX_ARROW3D_SQUARE',
    'BULLET_CHECKBOX',
    'BULLET_ARROW_DIAMOND_DISC',
    'BULLET_STAR_CIRCLE_SQUARE',
    'BULLET_ARROW3D_CIRCLE_SQUARE',
    'BULLET_LEFTTRIANGLE_DIAMOND_DISC',
    'BULLET_DIAMONDX_HOLLOWDIAMOND_SQUARE',
    'BULLET_DIAMOND_CIRCLE_SQUARE',
    'NUMBERED_DECIMAL_ALPHA_ROMAN',
    'NUMBERED_DECIMAL_ALPHA_ROMAN_PARENS',
    'NUMBERED_DECIMAL_NESTED',
    'NUMBERED_UPPERALPHA_ALPHA_ROMAN',
    'NUMBERED_UPPERROMAN_UPPERALPHA_DECIMAL',
    'NUMBERED_ZERODECIMAL_ALPHA_ROMAN'
  ]).optional()
});

const DocsDeleteParagraphBulletsSchema = z.object({
  documentId: z.string().min(1, "Document ID is required"),
  startIndex: z.number().min(1, "Start index must be at least 1"),
  endIndex: z.number().min(1, "End index must be at least 1")
});

const DocsInsertPageBreakSchema = z.object({
  documentId: z.string().min(1, "Document ID is required"),
  index: z.number().min(1, "Index must be at least 1")
});

const DocsUpdateDocumentStyleSchema = z.object({
  documentId: z.string().min(1, "Document ID is required"),
  marginTop: z.number().optional(),
  marginBottom: z.number().optional(),
  marginLeft: z.number().optional(),
  marginRight: z.number().optional(),
  pageWidth: z.number().optional(),
  pageHeight: z.number().optional()
});

// Phase 2 Google Docs API Tools - Tables
const DocsDeleteTableColumnSchema = z.object({
  documentId: z.string().min(1, "Document ID is required"),
  tableStartIndex: z.number().min(1, "Table start index must be at least 1"),
  rowIndex: z.number().min(0, "Row index must be at least 0"),
  columnIndex: z.number().min(0, "Column index must be at least 0")
});

const DocsDeleteTableRowSchema = z.object({
  documentId: z.string().min(1, "Document ID is required"),
  tableStartIndex: z.number().min(1, "Table start index must be at least 1"),
  rowIndex: z.number().min(0, "Row index must be at least 0"),
  columnIndex: z.number().min(0, "Column index must be at least 0")
});

const DocsInsertTableSchema = z.object({
  documentId: z.string().min(1, "Document ID is required"),
  index: z.number().min(1, "Index must be at least 1"),
  rows: z.number().min(1, "Rows must be at least 1"),
  columns: z.number().min(1, "Columns must be at least 1")
});

const DocsInsertTableColumnSchema = z.object({
  documentId: z.string().min(1, "Document ID is required"),
  tableStartIndex: z.number().min(1, "Table start index must be at least 1"),
  rowIndex: z.number().min(0, "Row index must be at least 0"),
  columnIndex: z.number().min(0, "Column index must be at least 0"),
  insertRight: z.boolean()
});

const DocsInsertTableRowSchema = z.object({
  documentId: z.string().min(1, "Document ID is required"),
  tableStartIndex: z.number().min(1, "Table start index must be at least 1"),
  rowIndex: z.number().min(0, "Row index must be at least 0"),
  columnIndex: z.number().min(0, "Column index must be at least 0"),
  insertBelow: z.boolean()
});

const DocsMergeTableCellsSchema = z.object({
  documentId: z.string().min(1, "Document ID is required"),
  tableStartIndex: z.number().min(1, "Table start index must be at least 1"),
  rowIndex: z.number().min(0, "Row index must be at least 0"),
  columnIndex: z.number().min(0, "Column index must be at least 0"),
  rowSpan: z.number().min(1, "Row span must be at least 1"),
  columnSpan: z.number().min(1, "Column span must be at least 1")
});

const DocsPinTableHeaderRowsSchema = z.object({
  documentId: z.string().min(1, "Document ID is required"),
  tableStartIndex: z.number().min(1, "Table start index must be at least 1"),
  pinnedHeaderRowsCount: z.number().min(0, "Pinned header rows count must be at least 0")
});

const DocsUnmergeTableCellsSchema = z.object({
  documentId: z.string().min(1, "Document ID is required"),
  tableStartIndex: z.number().min(1, "Table start index must be at least 1"),
  rowIndex: z.number().min(0, "Row index must be at least 0"),
  columnIndex: z.number().min(0, "Column index must be at least 0"),
  rowSpan: z.number().min(1, "Row span must be at least 1"),
  columnSpan: z.number().min(1, "Column span must be at least 1")
});

const DocsUpdateTableCellStyleSchema = z.object({
  documentId: z.string().min(1, "Document ID is required"),
  tableStartIndex: z.number().min(1, "Table start index must be at least 1"),
  rowIndex: z.number().min(0, "Row index must be at least 0"),
  columnIndex: z.number().min(0, "Column index must be at least 0"),
  rowSpan: z.number().min(1, "Row span must be at least 1").optional(),
  columnSpan: z.number().min(1, "Column span must be at least 1").optional(),
  backgroundColor: z.object({
    red: z.number().min(0).max(1).optional(),
    green: z.number().min(0).max(1).optional(),
    blue: z.number().min(0).max(1).optional()
  }).optional(),
  borderLeft: z.object({
    color: z.object({
      red: z.number().min(0).max(1).optional(),
      green: z.number().min(0).max(1).optional(),
      blue: z.number().min(0).max(1).optional()
    }).optional(),
    width: z.number().optional(),
    dashStyle: z.enum(['SOLID', 'DOT', 'DASH']).optional()
  }).optional(),
  borderRight: z.object({
    color: z.object({
      red: z.number().min(0).max(1).optional(),
      green: z.number().min(0).max(1).optional(),
      blue: z.number().min(0).max(1).optional()
    }).optional(),
    width: z.number().optional(),
    dashStyle: z.enum(['SOLID', 'DOT', 'DASH']).optional()
  }).optional(),
  borderTop: z.object({
    color: z.object({
      red: z.number().min(0).max(1).optional(),
      green: z.number().min(0).max(1).optional(),
      blue: z.number().min(0).max(1).optional()
    }).optional(),
    width: z.number().optional(),
    dashStyle: z.enum(['SOLID', 'DOT', 'DASH']).optional()
  }).optional(),
  borderBottom: z.object({
    color: z.object({
      red: z.number().min(0).max(1).optional(),
      green: z.number().min(0).max(1).optional(),
      blue: z.number().min(0).max(1).optional()
    }).optional(),
    width: z.number().optional(),
    dashStyle: z.enum(['SOLID', 'DOT', 'DASH']).optional()
  }).optional(),
  paddingLeft: z.number().optional(),
  paddingRight: z.number().optional(),
  paddingTop: z.number().optional(),
  paddingBottom: z.number().optional(),
  contentAlignment: z.enum(['TOP', 'MIDDLE', 'BOTTOM']).optional()
});

const DocsUpdateTableColumnPropertiesSchema = z.object({
  documentId: z.string().min(1, "Document ID is required"),
  tableStartIndex: z.number().min(1, "Table start index must be at least 1"),
  columnIndices: z.array(z.number().min(0)),
  widthMagnitude: z.number().optional(),
  widthType: z.enum(['EVENLY_DISTRIBUTED', 'FIXED_WIDTH']).optional()
});

const DocsUpdateTableRowStyleSchema = z.object({
  documentId: z.string().min(1, "Document ID is required"),
  tableStartIndex: z.number().min(1, "Table start index must be at least 1"),
  rowIndices: z.array(z.number().min(0)),
  minRowHeight: z.number().optional(),
  tableHeader: z.boolean().optional(),
  preventOverflow: z.boolean().optional()
});

// Phase 3 Google Docs API Tools - Advanced Structure
const DocsCreateFooterSchema = z.object({
  documentId: z.string().min(1, "Document ID is required"),
  type: z.enum(['FOOTER_DEFAULT', 'FOOTER_FIRST_PAGE', 'FOOTER_EVEN_PAGES']),
  sectionBreakIndex: z.number().int().min(1).optional()
});

const DocsCreateFootnoteSchema = z.object({
  documentId: z.string().min(1, "Document ID is required"),
  index: z.number().int().min(1, "Index must be at least 1")
});

const DocsCreateHeaderSchema = z.object({
  documentId: z.string().min(1, "Document ID is required"),
  type: z.enum(['HEADER_DEFAULT', 'HEADER_FIRST_PAGE', 'HEADER_EVEN_PAGES']),
  sectionBreakIndex: z.number().int().min(1).optional()
});

const DocsDeleteFooterSchema = z.object({
  documentId: z.string().min(1, "Document ID is required"),
  footerId: z.string().min(1, "Footer ID is required")
});

const DocsDeleteHeaderSchema = z.object({
  documentId: z.string().min(1, "Document ID is required"),
  headerId: z.string().min(1, "Header ID is required")
});

const DocsDeletePositionedObjectSchema = z.object({
  documentId: z.string().min(1, "Document ID is required"),
  objectId: z.string().min(1, "Object ID is required")
});

const DocsInsertSectionBreakSchema = z.object({
  documentId: z.string().min(1, "Document ID is required"),
  index: z.number().int().min(1, "Index must be at least 1"),
  sectionType: z.enum(['SECTION_TYPE_UNSPECIFIED', 'CONTINUOUS', 'NEXT_PAGE']).optional()
});

const DocsUpdateSectionStyleSchema = z.object({
  documentId: z.string().min(1, "Document ID is required"),
  startIndex: z.number().int().min(1, "Start index must be at least 1"),
  endIndex: z.number().int().min(1, "End index must be at least 1"),
  columnSeparatorStyle: z.enum(['NONE', 'BETWEEN_EACH_COLUMN']).optional(),
  contentDirection: z.enum(['LEFT_TO_RIGHT', 'RIGHT_TO_LEFT']).optional(),
  defaultHeaderId: z.string().optional(),
  defaultFooterId: z.string().optional(),
  evenPageHeaderId: z.string().optional(),
  evenPageFooterId: z.string().optional(),
  firstPageHeaderId: z.string().optional(),
  firstPageFooterId: z.string().optional(),
  flipPageOrientation: z.boolean().optional(),
  marginTop: z.number().optional(),
  marginBottom: z.number().optional(),
  marginRight: z.number().optional(),
  marginLeft: z.number().optional(),
  marginHeader: z.number().optional(),
  marginFooter: z.number().optional(),
  pageNumberStart: z.number().int().optional(),
  sectionType: z.enum(['CONTINUOUS', 'NEXT_PAGE']).optional(),
  useFirstPageHeaderFooter: z.boolean().optional()
});

// Phase 4 Google Docs API Tools - Power User Features
const DocsCreateNamedRangeSchema = z.object({
  documentId: z.string().min(1, "Document ID is required"),
  name: z.string().min(1, "Name is required"),
  startIndex: z.number().int().min(1, "Start index must be at least 1"),
  endIndex: z.number().int().min(1, "End index must be at least 1")
});

const DocsDeleteNamedRangeSchema = z.object({
  documentId: z.string().min(1, "Document ID is required"),
  namedRangeId: z.string().optional(),
  name: z.string().optional()
}).refine(data => data.namedRangeId || data.name, {
  message: "Either namedRangeId or name must be provided"
});

const DocsInsertPersonSchema = z.object({
  documentId: z.string().min(1, "Document ID is required"),
  index: z.number().int().min(1, "Index must be at least 1"),
  email: z.string().email("Valid email is required")
});

const DocsReplaceNamedRangeContentSchema = z.object({
  documentId: z.string().min(1, "Document ID is required"),
  namedRangeId: z.string().optional(),
  namedRangeName: z.string().optional(),
  text: z.string(),
  tabId: z.string().optional()
}).refine(data => data.namedRangeId || data.namedRangeName, {
  message: "Either namedRangeId or namedRangeName must be provided"
});

// Phase 5 Google Docs API Tools - Images & Media
const DocsInsertInlineImageSchema = z.object({
  documentId: z.string().min(1, "Document ID is required"),
  index: z.number().int().min(1, "Index must be at least 1"),
  uri: z.string().url("Valid image URL is required"),
  width: z.number().positive("Width must be positive").optional(),
  height: z.number().positive("Height must be positive").optional()
});

const DocsReplaceImageSchema = z.object({
  documentId: z.string().min(1, "Document ID is required"),
  imageObjectId: z.string().min(1, "Image object ID is required"),
  uri: z.string().url("Valid image URL is required")
});

// -----------------------------------------------------------------------------
// SERVER SETUP
// -----------------------------------------------------------------------------
const server = new Server(
  {
    name: "google-drive-mcp",
    version: VERSION,
  },
  {
    capabilities: {
      resources: {},
      tools: {},
    },
  },
);

// -----------------------------------------------------------------------------
// AUTHENTICATION HELPER
// -----------------------------------------------------------------------------
async function ensureAuthenticated() {
  if (!authClient) {
    // If authentication is already in progress, wait for it
    if (authenticationPromise) {
      log('Authentication already in progress, waiting...');
      authClient = await authenticationPromise;
      return;
    }
    
    log('Initializing authentication');
    // Store the promise to prevent concurrent authentication attempts
    authenticationPromise = authenticate();
    
    try {
      authClient = await authenticationPromise;
      log('Authentication complete', {
        authClientType: authClient?.constructor?.name,
        hasCredentials: !!authClient?.credentials,
        hasAccessToken: !!authClient?.credentials?.access_token
      });
      // Ensure drive service is created with auth
      ensureDriveService();
    } finally {
      // Clear the promise after completion (success or failure)
      authenticationPromise = null;
    }
  }
  
  // If we already have authClient, ensure drive is up to date
  ensureDriveService();
}

// -----------------------------------------------------------------------------
// MCP REQUEST HANDLERS
// -----------------------------------------------------------------------------

server.setRequestHandler(ListResourcesRequestSchema, async (request) => {
  await ensureAuthenticated();
  log('Handling ListResources request', { params: request.params });
  const pageSize = 10;
  const params: {
    pageSize: number,
    fields: string,
    pageToken?: string,
    q: string
  } = {
    pageSize,
    fields: "nextPageToken, files(id, name, mimeType)",
    q: `trashed = false`
  };

  if (request.params?.cursor) {
    params.pageToken = request.params.cursor;
  }

  const res = await drive.files.list(params);
  log('Listed files', { count: res.data.files?.length });
  const files = res.data.files || [];

  return {
    resources: files.map((file: drive_v3.Schema$File) => ({
      uri: `gdrive:///${file.id}`,
      mimeType: file.mimeType || 'application/octet-stream',
      name: file.name || 'Untitled',
    })),
    nextCursor: res.data.nextPageToken,
  };
});

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  await ensureAuthenticated();
  log('Handling ReadResource request', { uri: request.params.uri });
  const fileId = request.params.uri.replace("gdrive:///", "");

  const file = await drive.files.get({
    fileId,
    fields: "mimeType",
  });
  const mimeType = file.data.mimeType;

  if (!mimeType) {
    throw new Error("File has no MIME type.");
  }

  if (mimeType.startsWith("application/vnd.google-apps")) {
    // Export logic for Google Docs/Sheets/Slides
    let exportMimeType;
    switch (mimeType) {
      case "application/vnd.google-apps.document": exportMimeType = "text/markdown"; break;
      case "application/vnd.google-apps.spreadsheet": exportMimeType = "text/csv"; break;
      case "application/vnd.google-apps.presentation": exportMimeType = "text/plain"; break;
      case "application/vnd.google-apps.drawing": exportMimeType = "image/png"; break;
      default: exportMimeType = "text/plain"; break;
    }

    const res = await drive.files.export(
      { fileId, mimeType: exportMimeType },
      { responseType: "text" },
    );

    log('Successfully read resource', { fileId, mimeType });
    return {
      contents: [
        {
          uri: request.params.uri,
          mimeType: exportMimeType,
          text: res.data,
        },
      ],
    };
  } else {
    // Regular file download
    const res = await drive.files.get(
      { fileId, alt: "media" },
      { responseType: "arraybuffer" },
    );
    const contentMime = mimeType || "application/octet-stream";

    if (contentMime.startsWith("text/") || contentMime === "application/json") {
      return {
        contents: [
          {
            uri: request.params.uri,
            mimeType: contentMime,
            text: Buffer.from(res.data as ArrayBuffer).toString("utf-8"),
          },
        ],
      };
    } else {
      return {
        contents: [
          {
            uri: request.params.uri,
            mimeType: contentMime,
            blob: Buffer.from(res.data as ArrayBuffer).toString("base64"),
          },
        ],
      };
    }
  }
});

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "search",
        description: "Search for files in Google Drive",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", description: "Search query" },
          },
          required: ["query"],
        },
      },
      {
        name: "createTextFile",
        description: "Create a new text or markdown file",
        inputSchema: {
          type: "object",
          properties: {
            name: { type: "string", description: "File name (.txt or .md)" },
            content: { type: "string", description: "File content" },
            parentFolderId: { type: "string", description: "Optional parent folder ID", optional: true }
          },
          required: ["name", "content"]
        }
      },
      {
        name: "updateTextFile",
        description: "Update an existing text or markdown file",
        inputSchema: {
          type: "object",
          properties: {
            fileId: { type: "string", description: "ID of the file to update" },
            content: { type: "string", description: "New file content" },
            name: { type: "string", description: "Optional new name (.txt or .md)", optional: true }
          },
          required: ["fileId", "content"]
        }
      },
      {
        name: "createFolder",
        description: "Create a new folder in Google Drive",
        inputSchema: {
          type: "object",
          properties: {
            name: { type: "string", description: "Folder name" },
            parent: { type: "string", description: "Optional parent folder ID or path", optional: true }
          },
          required: ["name"]
        }
      },
      {
        name: "listFolder",
        description: "List contents of a folder (defaults to root)",
        inputSchema: {
          type: "object",
          properties: {
            folderId: { type: "string", description: "Folder ID", optional: true },
            pageSize: { type: "number", description: "Items to return (default 50, max 100)", optional: true },
            pageToken: { type: "string", description: "Token for next page", optional: true }
          }
        }
      },
      {
        name: "deleteItem",
        description: "Move a file or folder to trash (can be restored from Google Drive trash)",
        inputSchema: {
          type: "object",
          properties: {
            itemId: { type: "string", description: "ID of the item to delete" }
          },
          required: ["itemId"]
        }
      },
      {
        name: "renameItem",
        description: "Rename a file or folder",
        inputSchema: {
          type: "object",
          properties: {
            itemId: { type: "string", description: "ID of the item to rename" },
            newName: { type: "string", description: "New name" }
          },
          required: ["itemId", "newName"]
        }
      },
      {
        name: "moveItem",
        description: "Move a file or folder",
        inputSchema: {
          type: "object",
          properties: {
            itemId: { type: "string", description: "ID of the item to move" },
            destinationFolderId: { type: "string", description: "Destination folder ID", optional: true }
          },
          required: ["itemId"]
        }
      },
      {
        name: "createGoogleDoc",
        description: "Create a new Google Doc",
        inputSchema: {
          type: "object",
          properties: {
            name: { type: "string", description: "Doc name" },
            content: { type: "string", description: "Doc content" },
            parentFolderId: { type: "string", description: "Parent folder ID", optional: true }
          },
          required: ["name", "content"]
        }
      },
      {
        name: "updateGoogleDoc",
        description: "Update an existing Google Doc",
        inputSchema: {
          type: "object",
          properties: {
            documentId: { type: "string", description: "Doc ID" },
            content: { type: "string", description: "New content" }
          },
          required: ["documentId", "content"]
        }
      },
      {
        name: "createGoogleSheet",
        description: "Create a new Google Sheet",
        inputSchema: {
          type: "object",
          properties: {
            name: { type: "string", description: "Sheet name" },
            data: {
              type: "array",
              description: "Data as array of arrays",
              items: { type: "array", items: { type: "string" } }
            },
            parentFolderId: { type: "string", description: "Parent folder ID (defaults to root)", optional: true }
          },
          required: ["name", "data"]
        }
      },
      {
        name: "updateGoogleSheet",
        description: "Update an existing Google Sheet",
        inputSchema: {
          type: "object",
          properties: {
            spreadsheetId: { type: "string", description: "Sheet ID" },
            range: { type: "string", description: "Range to update" },
            data: {
              type: "array",
              items: { type: "array", items: { type: "string" } }
            }
          },
          required: ["spreadsheetId", "range", "data"]
        }
      },
      {
        name: "getGoogleSheetContent",
        description: "Get content of a Google Sheet with cell information",
        inputSchema: {
          type: "object",
          properties: {
            spreadsheetId: { type: "string", description: "Spreadsheet ID" },
            range: { type: "string", description: "Range to get (e.g., 'Sheet1!A1:C10')" }
          },
          required: ["spreadsheetId", "range"]
        }
      },
      {
        name: "formatGoogleSheetCells",
        description: "Format cells in a Google Sheet (background, borders, alignment)",
        inputSchema: {
          type: "object",
          properties: {
            spreadsheetId: { type: "string", description: "Spreadsheet ID" },
            range: { type: "string", description: "Range to format (e.g., 'A1:C10')" },
            backgroundColor: {
              type: "object",
              description: "Background color (RGB values 0-1)",
              properties: {
                red: { type: "number", optional: true },
                green: { type: "number", optional: true },
                blue: { type: "number", optional: true }
              },
              optional: true
            },
            horizontalAlignment: {
              type: "string",
              description: "Horizontal alignment",
              enum: ["LEFT", "CENTER", "RIGHT"],
              optional: true
            },
            verticalAlignment: {
              type: "string",
              description: "Vertical alignment",
              enum: ["TOP", "MIDDLE", "BOTTOM"],
              optional: true
            },
            wrapStrategy: {
              type: "string",
              description: "Text wrapping",
              enum: ["OVERFLOW_CELL", "CLIP", "WRAP"],
              optional: true
            }
          },
          required: ["spreadsheetId", "range"]
        }
      },
      {
        name: "formatGoogleSheetText",
        description: "Apply text formatting to cells in a Google Sheet",
        inputSchema: {
          type: "object",
          properties: {
            spreadsheetId: { type: "string", description: "Spreadsheet ID" },
            range: { type: "string", description: "Range to format (e.g., 'A1:C10')" },
            bold: { type: "boolean", description: "Make text bold", optional: true },
            italic: { type: "boolean", description: "Make text italic", optional: true },
            strikethrough: { type: "boolean", description: "Strikethrough text", optional: true },
            underline: { type: "boolean", description: "Underline text", optional: true },
            fontSize: { type: "number", description: "Font size in points", optional: true },
            fontFamily: { type: "string", description: "Font family name", optional: true },
            foregroundColor: {
              type: "object",
              description: "Text color (RGB values 0-1)",
              properties: {
                red: { type: "number", optional: true },
                green: { type: "number", optional: true },
                blue: { type: "number", optional: true }
              },
              optional: true
            }
          },
          required: ["spreadsheetId", "range"]
        }
      },
      {
        name: "formatGoogleSheetNumbers",
        description: "Apply number formatting to cells in a Google Sheet",
        inputSchema: {
          type: "object",
          properties: {
            spreadsheetId: { type: "string", description: "Spreadsheet ID" },
            range: { type: "string", description: "Range to format (e.g., 'A1:C10')" },
            pattern: {
              type: "string",
              description: "Number format pattern (e.g., '#,##0.00', 'yyyy-mm-dd', '$#,##0.00', '0.00%')"
            },
            type: {
              type: "string",
              description: "Format type",
              enum: ["NUMBER", "CURRENCY", "PERCENT", "DATE", "TIME", "DATE_TIME", "SCIENTIFIC"],
              optional: true
            }
          },
          required: ["spreadsheetId", "range", "pattern"]
        }
      },
      {
        name: "setGoogleSheetBorders",
        description: "Set borders for cells in a Google Sheet",
        inputSchema: {
          type: "object",
          properties: {
            spreadsheetId: { type: "string", description: "Spreadsheet ID" },
            range: { type: "string", description: "Range to format (e.g., 'A1:C10')" },
            style: {
              type: "string",
              description: "Border style",
              enum: ["SOLID", "DASHED", "DOTTED", "DOUBLE"]
            },
            width: { type: "number", description: "Border width (1-3)", optional: true },
            color: {
              type: "object",
              description: "Border color (RGB values 0-1)",
              properties: {
                red: { type: "number", optional: true },
                green: { type: "number", optional: true },
                blue: { type: "number", optional: true }
              },
              optional: true
            },
            top: { type: "boolean", description: "Apply to top border", optional: true },
            bottom: { type: "boolean", description: "Apply to bottom border", optional: true },
            left: { type: "boolean", description: "Apply to left border", optional: true },
            right: { type: "boolean", description: "Apply to right border", optional: true },
            innerHorizontal: { type: "boolean", description: "Apply to inner horizontal borders", optional: true },
            innerVertical: { type: "boolean", description: "Apply to inner vertical borders", optional: true }
          },
          required: ["spreadsheetId", "range", "style"]
        }
      },
      {
        name: "mergeGoogleSheetCells",
        description: "Merge cells in a Google Sheet",
        inputSchema: {
          type: "object",
          properties: {
            spreadsheetId: { type: "string", description: "Spreadsheet ID" },
            range: { type: "string", description: "Range to merge (e.g., 'A1:C3')" },
            mergeType: {
              type: "string",
              description: "Merge type",
              enum: ["MERGE_ALL", "MERGE_COLUMNS", "MERGE_ROWS"]
            }
          },
          required: ["spreadsheetId", "range", "mergeType"]
        }
      },
      {
        name: "addGoogleSheetConditionalFormat",
        description: "Add conditional formatting to a Google Sheet",
        inputSchema: {
          type: "object",
          properties: {
            spreadsheetId: { type: "string", description: "Spreadsheet ID" },
            range: { type: "string", description: "Range to apply formatting (e.g., 'A1:C10')" },
            condition: {
              type: "object",
              description: "Condition configuration",
              properties: {
                type: {
                  type: "string",
                  description: "Condition type",
                  enum: ["NUMBER_GREATER", "NUMBER_LESS", "TEXT_CONTAINS", "TEXT_STARTS_WITH", "TEXT_ENDS_WITH", "CUSTOM_FORMULA"]
                },
                value: { type: "string", description: "Value to compare or formula" }
              }
            },
            format: {
              type: "object",
              description: "Format to apply when condition is true",
              properties: {
                backgroundColor: {
                  type: "object",
                  properties: {
                    red: { type: "number", optional: true },
                    green: { type: "number", optional: true },
                    blue: { type: "number", optional: true }
                  },
                  optional: true
                },
                textFormat: {
                  type: "object",
                  properties: {
                    bold: { type: "boolean", optional: true },
                    foregroundColor: {
                      type: "object",
                      properties: {
                        red: { type: "number", optional: true },
                        green: { type: "number", optional: true },
                        blue: { type: "number", optional: true }
                      },
                      optional: true
                    }
                  },
                  optional: true
                }
              }
            }
          },
          required: ["spreadsheetId", "range", "condition", "format"]
        }
      },
      {
        name: "createGoogleSlides",
        description: "Create a new Google Slides presentation",
        inputSchema: {
          type: "object",
          properties: {
            name: { type: "string", description: "Presentation name" },
            slides: {
              type: "array",
              description: "Array of slide objects",
              items: {
                type: "object",
                properties: {
                  title: { type: "string" },
                  content: { type: "string" }
                }
              }
            },
            parentFolderId: { type: "string", description: "Parent folder ID (defaults to root)", optional: true }
          },
          required: ["name", "slides"]
        }
      },
      {
        name: "updateGoogleSlides",
        description: "Update an existing Google Slides presentation",
        inputSchema: {
          type: "object",
          properties: {
            presentationId: { type: "string", description: "Presentation ID" },
            slides: {
              type: "array",
              description: "Array of slide objects to replace existing slides",
              items: {
                type: "object",
                properties: {
                  title: { type: "string" },
                  content: { type: "string" }
                }
              }
            }
          },
          required: ["presentationId", "slides"]
        }
      },
      {
        name: "formatGoogleDocText",
        description: "Apply text formatting to a range in a Google Doc",
        inputSchema: {
          type: "object",
          properties: {
            documentId: { type: "string", description: "Document ID" },
            startIndex: { type: "number", description: "Start index (1-based)" },
            endIndex: { type: "number", description: "End index (1-based)" },
            bold: { type: "boolean", description: "Make text bold", optional: true },
            italic: { type: "boolean", description: "Make text italic", optional: true },
            underline: { type: "boolean", description: "Underline text", optional: true },
            strikethrough: { type: "boolean", description: "Strikethrough text", optional: true },
            fontSize: { type: "number", description: "Font size in points", optional: true },
            foregroundColor: {
              type: "object",
              description: "Text color (RGB values 0-1)",
              properties: {
                red: { type: "number", optional: true },
                green: { type: "number", optional: true },
                blue: { type: "number", optional: true }
              },
              optional: true
            }
          },
          required: ["documentId", "startIndex", "endIndex"]
        }
      },
      {
        name: "formatGoogleDocParagraph",
        description: "Apply paragraph formatting to a range in a Google Doc",
        inputSchema: {
          type: "object",
          properties: {
            documentId: { type: "string", description: "Document ID" },
            startIndex: { type: "number", description: "Start index (1-based)" },
            endIndex: { type: "number", description: "End index (1-based)" },
            namedStyleType: {
              type: "string",
              description: "Paragraph style",
              enum: ["NORMAL_TEXT", "TITLE", "SUBTITLE", "HEADING_1", "HEADING_2", "HEADING_3", "HEADING_4", "HEADING_5", "HEADING_6"],
              optional: true
            },
            alignment: {
              type: "string",
              description: "Text alignment",
              enum: ["START", "CENTER", "END", "JUSTIFIED"],
              optional: true
            },
            lineSpacing: { type: "number", description: "Line spacing multiplier", optional: true },
            spaceAbove: { type: "number", description: "Space above paragraph in points", optional: true },
            spaceBelow: { type: "number", description: "Space below paragraph in points", optional: true }
          },
          required: ["documentId", "startIndex", "endIndex"]
        }
      },
      {
        name: "getGoogleDocContent",
        description: "Get content of a Google Doc with text indices for formatting",
        inputSchema: {
          type: "object",
          properties: {
            documentId: { type: "string", description: "Document ID" }
          },
          required: ["documentId"]
        }
      },
      {
        name: "docs_deleteContentRange",
        description: "Delete content from a specified range in a Google Doc. Maps to DeleteContentRangeRequest in Google Docs API.",
        inputSchema: {
          type: "object",
          properties: {
            documentId: { type: "string", description: "The ID of the document" },
            startIndex: { type: "number", description: "The zero-based start index of the range to delete (inclusive, min 1)" },
            endIndex: { type: "number", description: "The zero-based end index of the range to delete (exclusive, min 1)" }
          },
          required: ["documentId", "startIndex", "endIndex"]
        }
      },
      {
        name: "docs_replaceAllText",
        description: "Replace all instances of text matching criteria with replacement text in a Google Doc. Maps to ReplaceAllTextRequest in Google Docs API.",
        inputSchema: {
          type: "object",
          properties: {
            documentId: { type: "string", description: "The ID of the document" },
            containsText: { type: "string", description: "The text to search for" },
            replaceText: { type: "string", description: "The text to replace with (cannot contain newlines)" },
            matchCase: { type: "boolean", description: "Whether to match case (default: false)", optional: true }
          },
          required: ["documentId", "containsText", "replaceText"]
        }
      },
      {
        name: "docs_createParagraphBullets",
        description: "Create bullets for paragraphs in a range. Maps to CreateParagraphBulletsRequest in Google Docs API.",
        inputSchema: {
          type: "object",
          properties: {
            documentId: { type: "string", description: "The ID of the document" },
            startIndex: { type: "number", description: "Start index of the range" },
            endIndex: { type: "number", description: "End index of the range" },
            bulletPreset: { type: "string", description: "Bullet style preset (optional)", optional: true }
          },
          required: ["documentId", "startIndex", "endIndex"]
        }
      },
      {
        name: "docs_deleteParagraphBullets",
        description: "Remove bullets from paragraphs in a range. Maps to DeleteParagraphBulletsRequest in Google Docs API.",
        inputSchema: {
          type: "object",
          properties: {
            documentId: { type: "string", description: "The ID of the document" },
            startIndex: { type: "number", description: "Start index of the range" },
            endIndex: { type: "number", description: "End index of the range" }
          },
          required: ["documentId", "startIndex", "endIndex"]
        }
      },
      {
        name: "docs_insertPageBreak",
        description: "Insert a page break at a specified location. Maps to InsertPageBreakRequest in Google Docs API.",
        inputSchema: {
          type: "object",
          properties: {
            documentId: { type: "string", description: "The ID of the document" },
            index: { type: "number", description: "The location to insert the page break" }
          },
          required: ["documentId", "index"]
        }
      },
      {
        name: "docs_updateDocumentStyle",
        description: "Update document-wide styling (margins, page size). Maps to UpdateDocumentStyleRequest in Google Docs API.",
        inputSchema: {
          type: "object",
          properties: {
            documentId: { type: "string", description: "The ID of the document" },
            marginTop: { type: "number", description: "Top margin in points", optional: true },
            marginBottom: { type: "number", description: "Bottom margin in points", optional: true },
            marginLeft: { type: "number", description: "Left margin in points", optional: true },
            marginRight: { type: "number", description: "Right margin in points", optional: true },
            pageWidth: { type: "number", description: "Page width in points", optional: true },
            pageHeight: { type: "number", description: "Page height in points", optional: true }
          },
          required: ["documentId"]
        }
      },
      {
        name: "docs_deleteTableColumn",
        description: "Delete a table column. Maps to DeleteTableColumnRequest in Google Docs API. Specify a cell in the column to delete.",
        inputSchema: {
          type: "object",
          properties: {
            documentId: { type: "string", description: "The ID of the document" },
            tableStartIndex: { type: "number", description: "The index where the table starts (1-based)" },
            rowIndex: { type: "number", description: "Row index of reference cell (0-based)" },
            columnIndex: { type: "number", description: "Column index to delete (0-based)" }
          },
          required: ["documentId", "tableStartIndex", "rowIndex", "columnIndex"]
        }
      },
      {
        name: "docs_deleteTableRow",
        description: "Delete a table row. Maps to DeleteTableRowRequest in Google Docs API. Specify a cell in the row to delete.",
        inputSchema: {
          type: "object",
          properties: {
            documentId: { type: "string", description: "The ID of the document" },
            tableStartIndex: { type: "number", description: "The index where the table starts (1-based)" },
            rowIndex: { type: "number", description: "Row index to delete (0-based)" },
            columnIndex: { type: "number", description: "Column index of reference cell (0-based)" }
          },
          required: ["documentId", "tableStartIndex", "rowIndex", "columnIndex"]
        }
      },
      {
        name: "docs_insertTable",
        description: "Insert a table at the specified location. Maps to InsertTableRequest in Google Docs API. Returns the table's objectId.",
        inputSchema: {
          type: "object",
          properties: {
            documentId: { type: "string", description: "The ID of the document" },
            index: { type: "number", description: "The index where the table should be inserted (1-based)" },
            rows: { type: "number", description: "Number of rows in the table" },
            columns: { type: "number", description: "Number of columns in the table" }
          },
          required: ["documentId", "index", "rows", "columns"]
        }
      },
      {
        name: "docs_insertTableColumn",
        description: "Insert a column into a table. Maps to InsertTableColumnRequest in Google Docs API. Specify reference cell and whether to insert right or left.",
        inputSchema: {
          type: "object",
          properties: {
            documentId: { type: "string", description: "The ID of the document" },
            tableStartIndex: { type: "number", description: "The index where the table starts (1-based)" },
            rowIndex: { type: "number", description: "Row index of reference cell (0-based)" },
            columnIndex: { type: "number", description: "Column index of reference cell (0-based)" },
            insertRight: { type: "boolean", description: "Insert to the right (true) or left (false) of reference cell" }
          },
          required: ["documentId", "tableStartIndex", "rowIndex", "columnIndex", "insertRight"]
        }
      },
      {
        name: "docs_insertTableRow",
        description: "Insert a row into a table. Maps to InsertTableRowRequest in Google Docs API. Specify reference cell and whether to insert below or above.",
        inputSchema: {
          type: "object",
          properties: {
            documentId: { type: "string", description: "The ID of the document" },
            tableStartIndex: { type: "number", description: "The index where the table starts (1-based)" },
            rowIndex: { type: "number", description: "Row index of reference cell (0-based)" },
            columnIndex: { type: "number", description: "Column index of reference cell (0-based)" },
            insertBelow: { type: "boolean", description: "Insert below (true) or above (false) the reference cell" }
          },
          required: ["documentId", "tableStartIndex", "rowIndex", "columnIndex", "insertBelow"]
        }
      },
      {
        name: "docs_mergeTableCells",
        description: "Merge table cells into a single cell. Maps to MergeTableCellsRequest in Google Docs API. Cells must form a rectangular region.",
        inputSchema: {
          type: "object",
          properties: {
            documentId: { type: "string", description: "The ID of the document" },
            tableStartIndex: { type: "number", description: "The index where the table starts (1-based)" },
            rowIndex: { type: "number", description: "Starting row index (0-based)" },
            columnIndex: { type: "number", description: "Starting column index (0-based)" },
            rowSpan: { type: "number", description: "Number of rows to merge" },
            columnSpan: { type: "number", description: "Number of columns to merge" }
          },
          required: ["documentId", "tableStartIndex", "rowIndex", "columnIndex", "rowSpan", "columnSpan"]
        }
      },
      {
        name: "docs_pinTableHeaderRows",
        description: "Pin table header rows to repeat on each page. Maps to PinTableHeaderRowsRequest in Google Docs API. Set to 0 to unpin all.",
        inputSchema: {
          type: "object",
          properties: {
            documentId: { type: "string", description: "The ID of the document" },
            tableStartIndex: { type: "number", description: "The index where the table starts (1-based)" },
            pinnedHeaderRowsCount: { type: "number", description: "Number of rows to pin as headers (0 to unpin all)" }
          },
          required: ["documentId", "tableStartIndex", "pinnedHeaderRowsCount"]
        }
      },
      {
        name: "docs_unmergeTableCells",
        description: "Unmerge previously merged table cells. Maps to UnmergeTableCellsRequest in Google Docs API.",
        inputSchema: {
          type: "object",
          properties: {
            documentId: { type: "string", description: "The ID of the document" },
            tableStartIndex: { type: "number", description: "The index where the table starts (1-based)" },
            rowIndex: { type: "number", description: "Starting row index (0-based)" },
            columnIndex: { type: "number", description: "Starting column index (0-based)" },
            rowSpan: { type: "number", description: "Number of rows in the range" },
            columnSpan: { type: "number", description: "Number of columns in the range" }
          },
          required: ["documentId", "tableStartIndex", "rowIndex", "columnIndex", "rowSpan", "columnSpan"]
        }
      },
      {
        name: "docs_updateTableCellStyle",
        description: "Update table cell styling (borders, background, padding, alignment). Maps to UpdateTableCellStyleRequest in Google Docs API.",
        inputSchema: {
          type: "object",
          properties: {
            documentId: { type: "string", description: "The ID of the document" },
            tableStartIndex: { type: "number", description: "The index where the table starts (1-based)" },
            rowIndex: { type: "number", description: "Starting row index (0-based)" },
            columnIndex: { type: "number", description: "Starting column index (0-based)" },
            rowSpan: { type: "number", description: "Number of rows to apply style to", optional: true },
            columnSpan: { type: "number", description: "Number of columns to apply style to", optional: true },
            backgroundColor: {
              type: "object",
              description: "Background color (RGB 0-1)",
              properties: {
                red: { type: "number", optional: true },
                green: { type: "number", optional: true },
                blue: { type: "number", optional: true }
              },
              optional: true
            },
            borderLeft: {
              type: "object",
              description: "Left border style",
              properties: {
                color: {
                  type: "object",
                  properties: {
                    red: { type: "number", optional: true },
                    green: { type: "number", optional: true },
                    blue: { type: "number", optional: true }
                  },
                  optional: true
                },
                width: { type: "number", description: "Border width in points", optional: true },
                dashStyle: { type: "string", enum: ["SOLID", "DOT", "DASH"], optional: true }
              },
              optional: true
            },
            borderRight: {
              type: "object",
              description: "Right border style",
              properties: {
                color: {
                  type: "object",
                  properties: {
                    red: { type: "number", optional: true },
                    green: { type: "number", optional: true },
                    blue: { type: "number", optional: true }
                  },
                  optional: true
                },
                width: { type: "number", description: "Border width in points", optional: true },
                dashStyle: { type: "string", enum: ["SOLID", "DOT", "DASH"], optional: true }
              },
              optional: true
            },
            borderTop: {
              type: "object",
              description: "Top border style",
              properties: {
                color: {
                  type: "object",
                  properties: {
                    red: { type: "number", optional: true },
                    green: { type: "number", optional: true },
                    blue: { type: "number", optional: true }
                  },
                  optional: true
                },
                width: { type: "number", description: "Border width in points", optional: true },
                dashStyle: { type: "string", enum: ["SOLID", "DOT", "DASH"], optional: true }
              },
              optional: true
            },
            borderBottom: {
              type: "object",
              description: "Bottom border style",
              properties: {
                color: {
                  type: "object",
                  properties: {
                    red: { type: "number", optional: true },
                    green: { type: "number", optional: true },
                    blue: { type: "number", optional: true }
                  },
                  optional: true
                },
                width: { type: "number", description: "Border width in points", optional: true },
                dashStyle: { type: "string", enum: ["SOLID", "DOT", "DASH"], optional: true }
              },
              optional: true
            },
            paddingLeft: { type: "number", description: "Left padding in points", optional: true },
            paddingRight: { type: "number", description: "Right padding in points", optional: true },
            paddingTop: { type: "number", description: "Top padding in points", optional: true },
            paddingBottom: { type: "number", description: "Bottom padding in points", optional: true },
            contentAlignment: { type: "string", description: "Vertical content alignment", enum: ["TOP", "MIDDLE", "BOTTOM"], optional: true }
          },
          required: ["documentId", "tableStartIndex", "rowIndex", "columnIndex"]
        }
      },
      {
        name: "docs_updateTableColumnProperties",
        description: "Update table column properties (width, width type). Maps to UpdateTableColumnPropertiesRequest in Google Docs API.",
        inputSchema: {
          type: "object",
          properties: {
            documentId: { type: "string", description: "The ID of the document" },
            tableStartIndex: { type: "number", description: "The index where the table starts (1-based)" },
            columnIndices: {
              type: "array",
              description: "Array of column indices to update (0-based)",
              items: { type: "number" }
            },
            widthMagnitude: { type: "number", description: "Column width in points", optional: true },
            widthType: { type: "string", description: "Width type", enum: ["EVENLY_DISTRIBUTED", "FIXED_WIDTH"], optional: true }
          },
          required: ["documentId", "tableStartIndex", "columnIndices"]
        }
      },
      {
        name: "docs_updateTableRowStyle",
        description: "Update table row styling (height, header flag, overflow prevention). Maps to UpdateTableRowStyleRequest in Google Docs API.",
        inputSchema: {
          type: "object",
          properties: {
            documentId: { type: "string", description: "The ID of the document" },
            tableStartIndex: { type: "number", description: "The index where the table starts (1-based)" },
            rowIndices: {
              type: "array",
              description: "Array of row indices to update (0-based)",
              items: { type: "number" }
            },
            minRowHeight: { type: "number", description: "Minimum row height in points", optional: true },
            tableHeader: { type: "boolean", description: "Whether this row is a table header", optional: true },
            preventOverflow: { type: "boolean", description: "Prevent content overflow to next page", optional: true }
          },
          required: ["documentId", "tableStartIndex", "rowIndices"]
        }
      },
      {
        name: "docs_createFooter",
        description: "Create a footer in a Google Doc. Maps to CreateFooterRequest in Google Docs API. Returns footerId.",
        inputSchema: {
          type: "object",
          properties: {
            documentId: { type: "string", description: "The ID of the document" },
            type: { type: "string", description: "Footer type: FOOTER_DEFAULT, FOOTER_FIRST_PAGE, or FOOTER_EVEN_PAGES" },
            sectionBreakIndex: { type: "number", description: "Optional section break location index (1-based)", optional: true }
          },
          required: ["documentId", "type"]
        }
      },
      {
        name: "docs_createFootnote",
        description: "Insert a footnote reference at a specified location. Maps to CreateFootnoteRequest in Google Docs API. Returns footnoteId.",
        inputSchema: {
          type: "object",
          properties: {
            documentId: { type: "string", description: "The ID of the document" },
            index: { type: "number", description: "The location to insert the footnote (1-based)" }
          },
          required: ["documentId", "index"]
        }
      },
      {
        name: "docs_createHeader",
        description: "Create a header in a Google Doc. Maps to CreateHeaderRequest in Google Docs API. Returns headerId.",
        inputSchema: {
          type: "object",
          properties: {
            documentId: { type: "string", description: "The ID of the document" },
            type: { type: "string", description: "Header type: HEADER_DEFAULT, HEADER_FIRST_PAGE, or HEADER_EVEN_PAGES" },
            sectionBreakIndex: { type: "number", description: "Optional section break location index (1-based)", optional: true }
          },
          required: ["documentId", "type"]
        }
      },
      {
        name: "docs_createNamedRange",
        description: "Create a named range referencing content in a Google Doc. Maps to CreateNamedRangeRequest in Google Docs API. Returns namedRangeId.",
        inputSchema: {
          type: "object",
          properties: {
            documentId: { type: "string", description: "The ID of the document" },
            name: { type: "string", description: "Name for the range" },
            startIndex: { type: "number", description: "Start index of the range (1-based)" },
            endIndex: { type: "number", description: "End index of the range (1-based)" }
          },
          required: ["documentId", "name", "startIndex", "endIndex"]
        }
      },
      {
        name: "docs_deleteFooter",
        description: "Delete a footer by ID. Maps to DeleteFooterRequest in Google Docs API.",
        inputSchema: {
          type: "object",
          properties: {
            documentId: { type: "string", description: "The ID of the document" },
            footerId: { type: "string", description: "The footer ID to delete" }
          },
          required: ["documentId", "footerId"]
        }
      },
      {
        name: "docs_deleteHeader",
        description: "Delete a header by ID. Maps to DeleteHeaderRequest in Google Docs API.",
        inputSchema: {
          type: "object",
          properties: {
            documentId: { type: "string", description: "The ID of the document" },
            headerId: { type: "string", description: "The header ID to delete" }
          },
          required: ["documentId", "headerId"]
        }
      },
      {
        name: "docs_deleteNamedRange",
        description: "Delete a named range (content remains). Maps to DeleteNamedRangeRequest in Google Docs API. Must provide either namedRangeId or name.",
        inputSchema: {
          type: "object",
          properties: {
            documentId: { type: "string", description: "The ID of the document" },
            namedRangeId: { type: "string", description: "ID of the named range to delete", optional: true },
            name: { type: "string", description: "Name of the named range to delete", optional: true }
          },
          required: ["documentId"]
        }
      },
      {
        name: "docs_deletePositionedObject",
        description: "Delete a positioned object (image, shape) by ID. Maps to DeletePositionedObjectRequest in Google Docs API.",
        inputSchema: {
          type: "object",
          properties: {
            documentId: { type: "string", description: "The ID of the document" },
            objectId: { type: "string", description: "The positioned object ID to delete" }
          },
          required: ["documentId", "objectId"]
        }
      },
      {
        name: "docs_insertSectionBreak",
        description: "Insert a section break at a specified location. Maps to InsertSectionBreakRequest in Google Docs API. Section breaks create new sections with independent styling.",
        inputSchema: {
          type: "object",
          properties: {
            documentId: { type: "string", description: "The ID of the document" },
            index: { type: "number", description: "The location to insert the section break (1-based)" },
            sectionType: { type: "string", description: "Section type: SECTION_TYPE_UNSPECIFIED, CONTINUOUS, or NEXT_PAGE", optional: true }
          },
          required: ["documentId", "index"]
        }
      },
      {
        name: "docs_insertPerson",
        description: "Insert a person mention/chip in a Google Doc. Maps to InsertPersonRequest in Google Docs API. Person chips link to Google Workspace contacts.",
        inputSchema: {
          type: "object",
          properties: {
            documentId: { type: "string", description: "The ID of the document" },
            index: { type: "number", description: "The insertion point (1-based)" },
            email: { type: "string", description: "Email address of the person to mention" }
          },
          required: ["documentId", "index", "email"]
        }
      },
      {
        name: "docs_insertInlineImage",
        description: "Insert an inline image in a Google Doc. Maps to InsertInlineImageRequest in Google Docs API. Image URL must be publicly accessible. Supported formats: PNG, JPEG, GIF, BMP. Max 50MB file size, max 25 megapixels. Size parameters in points (PT).",
        inputSchema: {
          type: "object",
          properties: {
            documentId: { type: "string", description: "The ID of the document" },
            index: { type: "number", description: "The insertion point (1-based)" },
            uri: { type: "string", description: "Publicly accessible image URL" },
            width: { type: "number", description: "Image width in points (PT) - optional", optional: true },
            height: { type: "number", description: "Image height in points (PT) - optional", optional: true }
          },
          required: ["documentId", "index", "uri"]
        }
      },
      {
        name: "docs_replaceImage",
        description: "Replace an existing image in a Google Doc. Maps to ReplaceImageRequest in Google Docs API. Image URL must be publicly accessible. Uses CENTER_CROP method. Some image effects may be removed to match Docs editor behavior.",
        inputSchema: {
          type: "object",
          properties: {
            documentId: { type: "string", description: "The ID of the document" },
            imageObjectId: { type: "string", description: "Object ID of the image to replace (e.g., 'kix.abc123')" },
            uri: { type: "string", description: "Publicly accessible URL of the new image" }
          },
          required: ["documentId", "imageObjectId", "uri"]
        }
      },
      {
        name: "docs_replaceNamedRangeContent",
        description: "Replace content within named ranges. Maps to ReplaceNamedRangeContentRequest in Google Docs API. Must provide either namedRangeId or namedRangeName. If named range has multiple discontinuous ranges, only first is replaced.",
        inputSchema: {
          type: "object",
          properties: {
            documentId: { type: "string", description: "The ID of the document" },
            namedRangeId: { type: "string", description: "ID of the named range", optional: true },
            namedRangeName: { type: "string", description: "Name of the named range", optional: true },
            text: { type: "string", description: "Replacement text" },
            tabId: { type: "string", description: "Optional tab ID", optional: true }
          },
          required: ["documentId", "text"]
        }
      },
      {
        name: "docs_updateSectionStyle",
        description: "Update section styling (margins, columns, page orientation). Maps to UpdateSectionStyleRequest in Google Docs API.",
        inputSchema: {
          type: "object",
          properties: {
            documentId: { type: "string", description: "The ID of the document" },
            startIndex: { type: "number", description: "Start index of the section range (1-based)" },
            endIndex: { type: "number", description: "End index of the section range (1-based)" },
            columnSeparatorStyle: { type: "string", description: "Column separator style: NONE or BETWEEN_EACH_COLUMN", optional: true },
            contentDirection: { type: "string", description: "Content direction: LEFT_TO_RIGHT or RIGHT_TO_LEFT", optional: true },
            defaultHeaderId: { type: "string", description: "Default header ID", optional: true },
            defaultFooterId: { type: "string", description: "Default footer ID", optional: true },
            evenPageHeaderId: { type: "string", description: "Even page header ID", optional: true },
            evenPageFooterId: { type: "string", description: "Even page footer ID", optional: true },
            firstPageHeaderId: { type: "string", description: "First page header ID", optional: true },
            firstPageFooterId: { type: "string", description: "First page footer ID", optional: true },
            flipPageOrientation: { type: "boolean", description: "Flip page orientation", optional: true },
            marginTop: { type: "number", description: "Top margin in points", optional: true },
            marginBottom: { type: "number", description: "Bottom margin in points", optional: true },
            marginRight: { type: "number", description: "Right margin in points", optional: true },
            marginLeft: { type: "number", description: "Left margin in points", optional: true },
            marginHeader: { type: "number", description: "Header margin in points", optional: true },
            marginFooter: { type: "number", description: "Footer margin in points", optional: true },
            pageNumberStart: { type: "number", description: "Starting page number", optional: true },
            sectionType: { type: "string", description: "Section type: CONTINUOUS or NEXT_PAGE", optional: true },
            useFirstPageHeaderFooter: { type: "boolean", description: "Use first page header/footer", optional: true }
          },
          required: ["documentId", "startIndex", "endIndex"]
        }
      },
      {
        name: "getGoogleSlidesContent",
        description: "Get content of Google Slides with element IDs for formatting",
        inputSchema: {
          type: "object",
          properties: {
            presentationId: { type: "string", description: "Presentation ID" },
            slideIndex: { type: "number", description: "Specific slide index (optional)", optional: true }
          },
          required: ["presentationId"]
        }
      },
      {
        name: "formatGoogleSlidesText",
        description: "Apply text formatting to elements in Google Slides",
        inputSchema: {
          type: "object",
          properties: {
            presentationId: { type: "string", description: "Presentation ID" },
            objectId: { type: "string", description: "Object ID of the text element" },
            startIndex: { type: "number", description: "Start index (0-based)", optional: true },
            endIndex: { type: "number", description: "End index (0-based)", optional: true },
            bold: { type: "boolean", description: "Make text bold", optional: true },
            italic: { type: "boolean", description: "Make text italic", optional: true },
            underline: { type: "boolean", description: "Underline text", optional: true },
            strikethrough: { type: "boolean", description: "Strikethrough text", optional: true },
            fontSize: { type: "number", description: "Font size in points", optional: true },
            fontFamily: { type: "string", description: "Font family name", optional: true },
            foregroundColor: {
              type: "object",
              description: "Text color (RGB values 0-1)",
              properties: {
                red: { type: "number", optional: true },
                green: { type: "number", optional: true },
                blue: { type: "number", optional: true }
              },
              optional: true
            }
          },
          required: ["presentationId", "objectId"]
        }
      },
      {
        name: "formatGoogleSlidesParagraph",
        description: "Apply paragraph formatting to text in Google Slides",
        inputSchema: {
          type: "object",
          properties: {
            presentationId: { type: "string", description: "Presentation ID" },
            objectId: { type: "string", description: "Object ID of the text element" },
            alignment: {
              type: "string",
              description: "Text alignment",
              enum: ["START", "CENTER", "END", "JUSTIFIED"],
              optional: true
            },
            lineSpacing: { type: "number", description: "Line spacing multiplier", optional: true },
            bulletStyle: {
              type: "string",
              description: "Bullet style",
              enum: ["NONE", "DISC", "ARROW", "SQUARE", "DIAMOND", "STAR", "NUMBERED"],
              optional: true
            }
          },
          required: ["presentationId", "objectId"]
        }
      },
      {
        name: "styleGoogleSlidesShape",
        description: "Style shapes in Google Slides",
        inputSchema: {
          type: "object",
          properties: {
            presentationId: { type: "string", description: "Presentation ID" },
            objectId: { type: "string", description: "Shape object ID" },
            backgroundColor: {
              type: "object",
              description: "Background color (RGBA values 0-1)",
              properties: {
                red: { type: "number", optional: true },
                green: { type: "number", optional: true },
                blue: { type: "number", optional: true },
                alpha: { type: "number", optional: true }
              },
              optional: true
            },
            outlineColor: {
              type: "object",
              description: "Outline color (RGB values 0-1)",
              properties: {
                red: { type: "number", optional: true },
                green: { type: "number", optional: true },
                blue: { type: "number", optional: true }
              },
              optional: true
            },
            outlineWeight: { type: "number", description: "Outline thickness in points", optional: true },
            outlineDashStyle: {
              type: "string",
              description: "Outline dash style",
              enum: ["SOLID", "DOT", "DASH", "DASH_DOT", "LONG_DASH", "LONG_DASH_DOT"],
              optional: true
            }
          },
          required: ["presentationId", "objectId"]
        }
      },
      {
        name: "setGoogleSlidesBackground",
        description: "Set background color for slides",
        inputSchema: {
          type: "object",
          properties: {
            presentationId: { type: "string", description: "Presentation ID" },
            pageObjectIds: {
              type: "array",
              description: "Array of slide IDs to update",
              items: { type: "string" }
            },
            backgroundColor: {
              type: "object",
              description: "Background color (RGBA values 0-1)",
              properties: {
                red: { type: "number", optional: true },
                green: { type: "number", optional: true },
                blue: { type: "number", optional: true },
                alpha: { type: "number", optional: true }
              }
            }
          },
          required: ["presentationId", "pageObjectIds", "backgroundColor"]
        }
      },
      {
        name: "createGoogleSlidesTextBox",
        description: "Create a text box in Google Slides",
        inputSchema: {
          type: "object",
          properties: {
            presentationId: { type: "string", description: "Presentation ID" },
            pageObjectId: { type: "string", description: "Slide ID" },
            text: { type: "string", description: "Text content" },
            x: { type: "number", description: "X position in EMU (1/360000 cm)" },
            y: { type: "number", description: "Y position in EMU" },
            width: { type: "number", description: "Width in EMU" },
            height: { type: "number", description: "Height in EMU" },
            fontSize: { type: "number", description: "Font size in points", optional: true },
            bold: { type: "boolean", description: "Make text bold", optional: true },
            italic: { type: "boolean", description: "Make text italic", optional: true }
          },
          required: ["presentationId", "pageObjectId", "text", "x", "y", "width", "height"]
        }
      },
      {
        name: "createGoogleSlidesShape",
        description: "Create a shape in Google Slides",
        inputSchema: {
          type: "object",
          properties: {
            presentationId: { type: "string", description: "Presentation ID" },
            pageObjectId: { type: "string", description: "Slide ID" },
            shapeType: {
              type: "string",
              description: "Shape type",
              enum: ["RECTANGLE", "ELLIPSE", "DIAMOND", "TRIANGLE", "STAR", "ROUND_RECTANGLE", "ARROW"]
            },
            x: { type: "number", description: "X position in EMU" },
            y: { type: "number", description: "Y position in EMU" },
            width: { type: "number", description: "Width in EMU" },
            height: { type: "number", description: "Height in EMU" },
            backgroundColor: {
              type: "object",
              description: "Fill color (RGBA values 0-1)",
              properties: {
                red: { type: "number", optional: true },
                green: { type: "number", optional: true },
                blue: { type: "number", optional: true },
                alpha: { type: "number", optional: true }
              },
              optional: true
            }
          },
          required: ["presentationId", "pageObjectId", "shapeType", "x", "y", "width", "height"]
        }
      }
    ]
  };
});

// -----------------------------------------------------------------------------
// TOOL CALL REQUEST HANDLER
// -----------------------------------------------------------------------------

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  console.error(`[DEBUG] CallTool handler called for tool: ${request.params.name}`);
  await ensureAuthenticated();
  console.error(`[DEBUG] After ensureAuthenticated - authClient exists: ${!!authClient}, drive exists: ${!!drive}`);
  log('Handling tool request', { tool: request.params.name });

  // Helper for error responses
  function errorResponse(message: string) {
    log('Error', { message });
    return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
  }

  try {
    switch (request.params.name) {
      case "search": {
        const validation = SearchSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const { query: userQuery } = validation.data;

        const escapedQuery = userQuery.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
        const formattedQuery = `fullText contains '${escapedQuery}' and trashed = false`;

        const res = await drive.files.list({
          q: formattedQuery,
          pageSize: 10,
          fields: "files(id, name, mimeType, modifiedTime, size)",
        });

        const fileList = res.data.files?.map((f: drive_v3.Schema$File) => `${f.name} (${f.mimeType})`).join("\n") || '';
        log('Search results', { query: userQuery, resultCount: res.data.files?.length });

        return {
          content: [{ type: "text", text: `Found ${res.data.files?.length ?? 0} files:\n${fileList}` }],
          isError: false,
        };
      }

      case "createTextFile": {
        const validation = CreateTextFileSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        validateTextFileExtension(args.name);
        const parentFolderId = await resolveFolderId(args.parentFolderId);

        // Check if file already exists
        const existingFileId = await checkFileExists(args.name, parentFolderId);
        if (existingFileId) {
          return errorResponse(
            `A file named "${args.name}" already exists in this location. ` +
            `To update it, use updateTextFile with fileId: ${existingFileId}`
          );
        }

        const fileMetadata = {
          name: args.name,
          mimeType: getMimeTypeFromFilename(args.name),
          parents: [parentFolderId]
        };

        log('About to create file', {
          driveExists: !!drive,
          authClientExists: !!authClient,
          hasAccessToken: !!authClient?.credentials?.access_token,
          tokenLength: authClient?.credentials?.access_token?.length
        });

        const file = await drive.files.create({
          requestBody: fileMetadata,
          media: {
            mimeType: fileMetadata.mimeType,
            body: args.content,
          },
        });

        log('File created successfully', { fileId: file.data?.id });
        return {
          content: [{
            type: "text",
            text: `Created file: ${file.data?.name || args.name}\nID: ${file.data?.id || 'unknown'}`
          }],
          isError: false
        };
      }

      case "updateTextFile": {
        const validation = UpdateTextFileSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        // Check file MIME type
        const existingFile = await drive.files.get({
          fileId: args.fileId,
          fields: 'mimeType, name, parents'
        });

        const currentMimeType = existingFile.data.mimeType || 'text/plain';
        if (!Object.values(TEXT_MIME_TYPES).includes(currentMimeType)) {
          return errorResponse("File is not a text or markdown file.");
        }

        const updateMetadata: { name?: string; mimeType?: string } = {};
        if (args.name) {
          validateTextFileExtension(args.name);
          updateMetadata.name = args.name;
          updateMetadata.mimeType = getMimeTypeFromFilename(args.name);
        }

        const updatedFile = await drive.files.update({
          fileId: args.fileId,
          requestBody: updateMetadata,
          media: {
            mimeType: updateMetadata.mimeType || currentMimeType,
            body: args.content
          },
          fields: 'id, name, modifiedTime, webViewLink'
        });

        return {
          content: [{
            type: "text",
            text: `Updated file: ${updatedFile.data.name}\nModified: ${updatedFile.data.modifiedTime}`
          }],
          isError: false
        };
      }

      case "createFolder": {
        const validation = CreateFolderSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        const parentFolderId = await resolveFolderId(args.parent);

        // Check if folder already exists
        const existingFolderId = await checkFileExists(args.name, parentFolderId);
        if (existingFolderId) {
          return errorResponse(
            `A folder named "${args.name}" already exists in this location. ` +
            `Folder ID: ${existingFolderId}`
          );
        }
        const folderMetadata = {
          name: args.name,
          mimeType: FOLDER_MIME_TYPE,
          parents: [parentFolderId]
        };

        const folder = await drive.files.create({
          requestBody: folderMetadata,
          fields: 'id, name, webViewLink'
        });

        log('Folder created successfully', { folderId: folder.data.id, name: folder.data.name });

        return {
          content: [{
            type: "text",
            text: `Created folder: ${folder.data.name}\nID: ${folder.data.id}`
          }],
          isError: false
        };
      }

      case "listFolder": {
        const validation = ListFolderSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        // Default to root if no folder specified
        const targetFolderId = args.folderId || 'root';

        const res = await drive.files.list({
          q: `'${targetFolderId}' in parents and trashed = false`,
          pageSize: Math.min(args.pageSize || 50, 100),
          pageToken: args.pageToken,
          fields: "nextPageToken, files(id, name, mimeType, modifiedTime, size)",
          orderBy: "name"
        });

        const files = res.data.files || [];
        const formattedFiles = files.map((file: drive_v3.Schema$File) => {
          const isFolder = file.mimeType === FOLDER_MIME_TYPE;
          return `${isFolder ? '📁' : '📄'} ${file.name} (ID: ${file.id})`;
        }).join('\n');

        let response = `Contents of folder:\n\n${formattedFiles}`;
        if (res.data.nextPageToken) {
          response += `\n\nMore items available. Use pageToken: ${res.data.nextPageToken}`;
        }

        return {
          content: [{ type: "text", text: response }],
          isError: false
        };
      }

      case "deleteItem": {
        const validation = DeleteItemSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        const item = await drive.files.get({ fileId: args.itemId, fields: 'name' });
        
        // Move to trash instead of permanent deletion
        await drive.files.update({
          fileId: args.itemId,
          requestBody: {
            trashed: true
          }
        });

        log('Item moved to trash successfully', { itemId: args.itemId, name: item.data.name });
        return {
          content: [{ type: "text", text: `Successfully moved to trash: ${item.data.name}` }],
          isError: false
        };
      }

      case "renameItem": {
        const validation = RenameItemSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        // If it's a text file, check extension
        const item = await drive.files.get({ fileId: args.itemId, fields: 'name, mimeType' });
        if (Object.values(TEXT_MIME_TYPES).includes(item.data.mimeType || '')) {
          validateTextFileExtension(args.newName);
        }

        const updatedItem = await drive.files.update({
          fileId: args.itemId,
          requestBody: { name: args.newName },
          fields: 'id, name, modifiedTime'
        });

        return {
          content: [{
            type: "text",
            text: `Successfully renamed "${item.data.name}" to "${updatedItem.data.name}"`
          }],
          isError: false
        };
      }

      case "moveItem": {
        const validation = MoveItemSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        const destinationFolderId = args.destinationFolderId ?
          await resolveFolderId(args.destinationFolderId) :
          'root';

        // Check we aren't moving a folder into itself or its descendant
        if (args.destinationFolderId === args.itemId) {
          return errorResponse("Cannot move a folder into itself.");
        }

        const item = await drive.files.get({ fileId: args.itemId, fields: 'name, parents' });

        // Perform move
        await drive.files.update({
          fileId: args.itemId,
          addParents: destinationFolderId,
          removeParents: item.data.parents?.join(',') || '',
          fields: 'id, name, parents'
        });

        // Get the destination folder name for a nice response
        const destinationFolder = await drive.files.get({
          fileId: destinationFolderId,
          fields: 'name'
        });

        return {
          content: [{
            type: "text",
            text: `Successfully moved "${item.data.name}" to "${destinationFolder.data.name}"`
          }],
          isError: false
        };
      }

      case "createGoogleDoc": {
        const validation = CreateGoogleDocSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        const parentFolderId = await resolveFolderId(args.parentFolderId);

        // Check if document already exists
        const existingFileId = await checkFileExists(args.name, parentFolderId);
        if (existingFileId) {
          return errorResponse(
            `A document named "${args.name}" already exists in this location. ` +
            `To update it, use updateGoogleDoc with documentId: ${existingFileId}`
          );
        }

        log('Creating Google Doc', { 
          authClientExists: !!authClient, 
          parentFolderId,
          authClientType: authClient?.constructor?.name,
          accessToken: authClient?.credentials?.access_token ? 'present' : 'missing',
          tokenLength: authClient?.credentials?.access_token?.length
        });

        // Debug: Try to get current user to verify auth
        try {
          const aboutResponse = await drive.about.get({ fields: 'user' });
          log('Auth verification - current user:', aboutResponse.data.user?.emailAddress);
        } catch (authError) {
          log('Auth verification failed:', authError instanceof Error ? authError.message : String(authError));
        }

        // Create empty doc
        let docResponse;
        try {
          docResponse = await drive.files.create({
            requestBody: {
              name: args.name,
              mimeType: 'application/vnd.google-apps.document',
              parents: [parentFolderId]
            },
            fields: 'id, name, webViewLink'
          });
        } catch (createError: any) {
          log('Drive files.create error details:', {
            message: createError.message,
            code: createError.code,
            errors: createError.errors,
            status: createError.status
          });
          throw createError;
        }
        const doc = docResponse.data;

        const docs = google.docs({ version: 'v1', auth: authClient });
        await docs.documents.batchUpdate({
          documentId: doc.id!,
          requestBody: {
            requests: [
              {
                insertText: { location: { index: 1 }, text: args.content }
              },
              // Ensure the text is formatted as normal text, not as a header
              {
                updateParagraphStyle: {
                  range: {
                    startIndex: 1,
                    endIndex: args.content.length + 1
                  },
                  paragraphStyle: {
                    namedStyleType: 'NORMAL_TEXT'
                  },
                  fields: 'namedStyleType'
                }
              }
            ]
          }
        });

        return {
          content: [{ type: "text", text: `Created Google Doc: ${doc.name}\nID: ${doc.id}\nLink: ${doc.webViewLink}` }],
          isError: false
        };
      }

      case "updateGoogleDoc": {
        const validation = UpdateGoogleDocSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        const docs = google.docs({ version: 'v1', auth: authClient });
        const document = await docs.documents.get({ documentId: args.documentId });

        // Delete all content
        // End index of last piece of content (body's last element, fallback to 1 if none)
        const endIndex = document.data.body?.content?.[document.data.body.content.length - 1]?.endIndex || 1;
        
        // Google Docs API doesn't allow deleting the final newline character
        // We need to leave at least one character in the document
        const deleteEndIndex = Math.max(1, endIndex - 1);

        if (deleteEndIndex > 1) {
          await docs.documents.batchUpdate({
            documentId: args.documentId,
            requestBody: {
              requests: [{
                deleteContentRange: {
                  range: { startIndex: 1, endIndex: deleteEndIndex }
                }
              }]
            }
          });
        }

        // Insert new content
        await docs.documents.batchUpdate({
          documentId: args.documentId,
          requestBody: {
            requests: [
              {
                insertText: { location: { index: 1 }, text: args.content }
              },
              // Ensure the text is formatted as normal text, not as a header
              {
                updateParagraphStyle: {
                  range: {
                    startIndex: 1,
                    endIndex: args.content.length + 1
                  },
                  paragraphStyle: {
                    namedStyleType: 'NORMAL_TEXT'
                  },
                  fields: 'namedStyleType'
                }
              }
            ]
          }
        });

        return {
          content: [{ type: "text", text: `Updated Google Doc: ${document.data.title}` }],
          isError: false
        };
      }

      case "createGoogleSheet": {
        const validation = CreateGoogleSheetSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        const parentFolderId = await resolveFolderId(args.parentFolderId);

        // Check if spreadsheet already exists
        const existingFileId = await checkFileExists(args.name, parentFolderId);
        if (existingFileId) {
          return errorResponse(
            `A spreadsheet named "${args.name}" already exists in this location. ` +
            `To update it, use updateGoogleSheet with spreadsheetId: ${existingFileId}`
          );
        }
        const sheets = google.sheets({ version: 'v4', auth: authClient });
        
        // Create spreadsheet with initial sheet
        const spreadsheet = await sheets.spreadsheets.create({
          requestBody: { 
            properties: { title: args.name },
            sheets: [{
              properties: {
                sheetId: 0,
                title: 'Sheet1',
                gridProperties: {
                  rowCount: Math.max(args.data.length, 1000),
                  columnCount: Math.max(args.data[0]?.length || 0, 26)
                }
              }
            }]
          }
        });

        await drive.files.update({
          fileId: spreadsheet.data.spreadsheetId || '',
          addParents: parentFolderId,
          fields: 'id, name, webViewLink'
        });

        // Now update with data
        await sheets.spreadsheets.values.update({
          spreadsheetId: spreadsheet.data.spreadsheetId!,
          range: 'Sheet1!A1',
          valueInputOption: 'RAW',
          requestBody: { values: args.data }
        });

        return {
          content: [{ type: "text", text: `Created Google Sheet: ${args.name}\nID: ${spreadsheet.data.spreadsheetId}` }],
          isError: false
        };
      }

      case "updateGoogleSheet": {
        const validation = UpdateGoogleSheetSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        const sheets = google.sheets({ version: 'v4', auth: authClient });
        await sheets.spreadsheets.values.update({
          spreadsheetId: args.spreadsheetId,
          range: args.range,
          valueInputOption: 'RAW',
          requestBody: { values: args.data }
        });

        return {
          content: [{ type: "text", text: `Updated Google Sheet range: ${args.range}` }],
          isError: false
        };
      }

      case "getGoogleSheetContent": {
        const validation = GetGoogleSheetContentSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        const sheets = google.sheets({ version: 'v4', auth: authClient });
        const response = await sheets.spreadsheets.values.get({
          spreadsheetId: args.spreadsheetId,
          range: args.range
        });

        const values = response.data.values || [];
        let content = `Content for range ${args.range}:\n\n`;
        
        if (values.length === 0) {
          content += "(empty range)";
        } else {
          values.forEach((row, rowIndex) => {
            content += `Row ${rowIndex + 1}: ${row.join(', ')}\n`;
          });
        }

        return {
          content: [{ type: "text", text: content }],
          isError: false
        };
      }

      case "formatGoogleSheetCells": {
        const validation = FormatGoogleSheetCellsSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        const sheets = google.sheets({ version: 'v4', auth: authClient });
        
        // Parse the range to get sheet ID and grid range
        const rangeData = await sheets.spreadsheets.get({
          spreadsheetId: args.spreadsheetId,
          ranges: [args.range],
          fields: 'sheets(properties(sheetId,title))'
        });

        console.error(`[DEBUG] formatGoogleSheetCells - range: ${args.range}`);
        console.error(`[DEBUG] rangeData.data:`, JSON.stringify(rangeData.data, null, 2));
        
        const sheetName = args.range.includes('!') ? args.range.split('!')[0] : 'Sheet1';
        console.error(`[DEBUG] Calculated sheetName: "${sheetName}"`);
        
        const sheet = rangeData.data.sheets?.find(s => s.properties?.title === sheetName);
        console.error(`[DEBUG] Found sheet:`, sheet ? JSON.stringify(sheet, null, 2) : 'null');
        
        if (!sheet || sheet.properties?.sheetId === undefined || sheet.properties?.sheetId === null) {
          console.error(`[DEBUG] Available sheets:`, rangeData.data.sheets?.map(s => s.properties?.title).join(', '));
          return errorResponse(`Sheet "${sheetName}" not found`);
        }

        // Parse A1 notation to grid range
        const a1Range = args.range.includes('!') ? args.range.split('!')[1] : args.range;
        const gridRange = convertA1ToGridRange(a1Range, sheet.properties.sheetId!);

        const requests: any[] = [{
          repeatCell: {
            range: gridRange,
            cell: {
              userEnteredFormat: {
                ...(args.backgroundColor && {
                  backgroundColor: {
                    red: args.backgroundColor.red || 0,
                    green: args.backgroundColor.green || 0,
                    blue: args.backgroundColor.blue || 0
                  }
                }),
                ...(args.horizontalAlignment && { horizontalAlignment: args.horizontalAlignment }),
                ...(args.verticalAlignment && { verticalAlignment: args.verticalAlignment }),
                ...(args.wrapStrategy && { wrapStrategy: args.wrapStrategy })
              }
            },
            fields: [
              args.backgroundColor && 'userEnteredFormat.backgroundColor',
              args.horizontalAlignment && 'userEnteredFormat.horizontalAlignment',
              args.verticalAlignment && 'userEnteredFormat.verticalAlignment',
              args.wrapStrategy && 'userEnteredFormat.wrapStrategy'
            ].filter(Boolean).join(',')
          }
        }];

        await sheets.spreadsheets.batchUpdate({
          spreadsheetId: args.spreadsheetId,
          requestBody: { requests }
        });

        return {
          content: [{ type: "text", text: `Formatted cells in range ${args.range}` }],
          isError: false
        };
      }

      case "formatGoogleSheetText": {
        const validation = FormatGoogleSheetTextSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        const sheets = google.sheets({ version: 'v4', auth: authClient });
        
        // Get sheet information
        const rangeData = await sheets.spreadsheets.get({
          spreadsheetId: args.spreadsheetId,
          ranges: [args.range],
          fields: 'sheets(properties(sheetId,title))'
        });

        const sheetName = args.range.includes('!') ? args.range.split('!')[0] : 'Sheet1';
        const sheet = rangeData.data.sheets?.find(s => s.properties?.title === sheetName);
        if (!sheet || sheet.properties?.sheetId === undefined || sheet.properties?.sheetId === null) {
          return errorResponse(`Sheet "${sheetName}" not found`);
        }

        const a1Range = args.range.includes('!') ? args.range.split('!')[1] : args.range;
        const gridRange = convertA1ToGridRange(a1Range, sheet.properties.sheetId!);

        const textFormat: any = {};
        const fields: string[] = [];

        if (args.bold !== undefined) {
          textFormat.bold = args.bold;
          fields.push('bold');
        }
        if (args.italic !== undefined) {
          textFormat.italic = args.italic;
          fields.push('italic');
        }
        if (args.strikethrough !== undefined) {
          textFormat.strikethrough = args.strikethrough;
          fields.push('strikethrough');
        }
        if (args.underline !== undefined) {
          textFormat.underline = args.underline;
          fields.push('underline');
        }
        if (args.fontSize !== undefined) {
          textFormat.fontSize = args.fontSize;
          fields.push('fontSize');
        }
        if (args.fontFamily !== undefined) {
          textFormat.fontFamily = args.fontFamily;
          fields.push('fontFamily');
        }
        if (args.foregroundColor) {
          textFormat.foregroundColor = {
            red: args.foregroundColor.red || 0,
            green: args.foregroundColor.green || 0,
            blue: args.foregroundColor.blue || 0
          };
          fields.push('foregroundColor');
        }

        const requests = [{
          repeatCell: {
            range: gridRange,
            cell: {
              userEnteredFormat: { textFormat }
            },
            fields: 'userEnteredFormat.textFormat(' + fields.join(',') + ')'
          }
        }];

        await sheets.spreadsheets.batchUpdate({
          spreadsheetId: args.spreadsheetId,
          requestBody: { requests }
        });

        return {
          content: [{ type: "text", text: `Applied text formatting to range ${args.range}` }],
          isError: false
        };
      }

      case "formatGoogleSheetNumbers": {
        const validation = FormatGoogleSheetNumbersSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        const sheets = google.sheets({ version: 'v4', auth: authClient });
        
        const rangeData = await sheets.spreadsheets.get({
          spreadsheetId: args.spreadsheetId,
          ranges: [args.range],
          fields: 'sheets(properties(sheetId,title))'
        });

        const sheetName = args.range.includes('!') ? args.range.split('!')[0] : 'Sheet1';
        const sheet = rangeData.data.sheets?.find(s => s.properties?.title === sheetName);
        if (!sheet || sheet.properties?.sheetId === undefined || sheet.properties?.sheetId === null) {
          return errorResponse(`Sheet "${sheetName}" not found`);
        }

        const a1Range = args.range.includes('!') ? args.range.split('!')[1] : args.range;
        const gridRange = convertA1ToGridRange(a1Range, sheet.properties.sheetId!);

        const numberFormat: any = {
          pattern: args.pattern
        };
        if (args.type) {
          numberFormat.type = args.type;
        }

        const requests = [{
          repeatCell: {
            range: gridRange,
            cell: {
              userEnteredFormat: { numberFormat }
            },
            fields: 'userEnteredFormat.numberFormat'
          }
        }];

        await sheets.spreadsheets.batchUpdate({
          spreadsheetId: args.spreadsheetId,
          requestBody: { requests }
        });

        return {
          content: [{ type: "text", text: `Applied number formatting to range ${args.range}` }],
          isError: false
        };
      }

      case "setGoogleSheetBorders": {
        const validation = SetGoogleSheetBordersSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        const sheets = google.sheets({ version: 'v4', auth: authClient });
        
        const rangeData = await sheets.spreadsheets.get({
          spreadsheetId: args.spreadsheetId,
          ranges: [args.range],
          fields: 'sheets(properties(sheetId,title))'
        });

        const sheetName = args.range.includes('!') ? args.range.split('!')[0] : 'Sheet1';
        const sheet = rangeData.data.sheets?.find(s => s.properties?.title === sheetName);
        if (!sheet || sheet.properties?.sheetId === undefined || sheet.properties?.sheetId === null) {
          return errorResponse(`Sheet "${sheetName}" not found`);
        }

        const a1Range = args.range.includes('!') ? args.range.split('!')[1] : args.range;
        const gridRange = convertA1ToGridRange(a1Range, sheet.properties.sheetId!);

        const border = {
          style: args.style,
          width: args.width || 1,
          color: args.color ? {
            red: args.color.red || 0,
            green: args.color.green || 0,
            blue: args.color.blue || 0
          } : undefined
        };

        const updateBordersRequest: any = {
          updateBorders: {
            range: gridRange
          }
        };

        if (args.top !== false) updateBordersRequest.updateBorders.top = border;
        if (args.bottom !== false) updateBordersRequest.updateBorders.bottom = border;
        if (args.left !== false) updateBordersRequest.updateBorders.left = border;
        if (args.right !== false) updateBordersRequest.updateBorders.right = border;
        if (args.innerHorizontal) updateBordersRequest.updateBorders.innerHorizontal = border;
        if (args.innerVertical) updateBordersRequest.updateBorders.innerVertical = border;

        await sheets.spreadsheets.batchUpdate({
          spreadsheetId: args.spreadsheetId,
          requestBody: { requests: [updateBordersRequest] }
        });

        return {
          content: [{ type: "text", text: `Set borders for range ${args.range}` }],
          isError: false
        };
      }

      case "mergeGoogleSheetCells": {
        const validation = MergeGoogleSheetCellsSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        const sheets = google.sheets({ version: 'v4', auth: authClient });
        
        const rangeData = await sheets.spreadsheets.get({
          spreadsheetId: args.spreadsheetId,
          ranges: [args.range],
          fields: 'sheets(properties(sheetId,title))'
        });

        const sheetName = args.range.includes('!') ? args.range.split('!')[0] : 'Sheet1';
        const sheet = rangeData.data.sheets?.find(s => s.properties?.title === sheetName);
        if (!sheet || sheet.properties?.sheetId === undefined || sheet.properties?.sheetId === null) {
          return errorResponse(`Sheet "${sheetName}" not found`);
        }

        const a1Range = args.range.includes('!') ? args.range.split('!')[1] : args.range;
        const gridRange = convertA1ToGridRange(a1Range, sheet.properties.sheetId!);

        const requests = [{
          mergeCells: {
            range: gridRange,
            mergeType: args.mergeType
          }
        }];

        await sheets.spreadsheets.batchUpdate({
          spreadsheetId: args.spreadsheetId,
          requestBody: { requests }
        });

        return {
          content: [{ type: "text", text: `Merged cells in range ${args.range} with type ${args.mergeType}` }],
          isError: false
        };
      }

      case "addGoogleSheetConditionalFormat": {
        const validation = AddGoogleSheetConditionalFormatSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        const sheets = google.sheets({ version: 'v4', auth: authClient });
        
        const rangeData = await sheets.spreadsheets.get({
          spreadsheetId: args.spreadsheetId,
          ranges: [args.range],
          fields: 'sheets(properties(sheetId,title))'
        });

        const sheetName = args.range.includes('!') ? args.range.split('!')[0] : 'Sheet1';
        const sheet = rangeData.data.sheets?.find(s => s.properties?.title === sheetName);
        if (!sheet || sheet.properties?.sheetId === undefined || sheet.properties?.sheetId === null) {
          return errorResponse(`Sheet "${sheetName}" not found`);
        }

        const a1Range = args.range.includes('!') ? args.range.split('!')[1] : args.range;
        const gridRange = convertA1ToGridRange(a1Range, sheet.properties.sheetId!);

        // Build condition based on type
        const booleanCondition: any = {};
        switch (args.condition.type) {
          case 'NUMBER_GREATER':
            booleanCondition.type = 'NUMBER_GREATER';
            booleanCondition.values = [{ userEnteredValue: args.condition.value }];
            break;
          case 'NUMBER_LESS':
            booleanCondition.type = 'NUMBER_LESS';
            booleanCondition.values = [{ userEnteredValue: args.condition.value }];
            break;
          case 'TEXT_CONTAINS':
            booleanCondition.type = 'TEXT_CONTAINS';
            booleanCondition.values = [{ userEnteredValue: args.condition.value }];
            break;
          case 'TEXT_STARTS_WITH':
            booleanCondition.type = 'TEXT_STARTS_WITH';
            booleanCondition.values = [{ userEnteredValue: args.condition.value }];
            break;
          case 'TEXT_ENDS_WITH':
            booleanCondition.type = 'TEXT_ENDS_WITH';
            booleanCondition.values = [{ userEnteredValue: args.condition.value }];
            break;
          case 'CUSTOM_FORMULA':
            booleanCondition.type = 'CUSTOM_FORMULA';
            booleanCondition.values = [{ userEnteredValue: args.condition.value }];
            break;
        }

        const format: any = {};
        if (args.format.backgroundColor) {
          format.backgroundColor = {
            red: args.format.backgroundColor.red || 0,
            green: args.format.backgroundColor.green || 0,
            blue: args.format.backgroundColor.blue || 0
          };
        }
        if (args.format.textFormat) {
          format.textFormat = {};
          if (args.format.textFormat.bold !== undefined) {
            format.textFormat.bold = args.format.textFormat.bold;
          }
          if (args.format.textFormat.foregroundColor) {
            format.textFormat.foregroundColor = {
              red: args.format.textFormat.foregroundColor.red || 0,
              green: args.format.textFormat.foregroundColor.green || 0,
              blue: args.format.textFormat.foregroundColor.blue || 0
            };
          }
        }

        const requests = [{
          addConditionalFormatRule: {
            rule: {
              ranges: [gridRange],
              booleanRule: {
                condition: booleanCondition,
                format: format
              }
            },
            index: 0
          }
        }];

        await sheets.spreadsheets.batchUpdate({
          spreadsheetId: args.spreadsheetId,
          requestBody: { requests }
        });

        return {
          content: [{ type: "text", text: `Added conditional formatting to range ${args.range}` }],
          isError: false
        };
      }

      case "createGoogleSlides": {
        const validation = CreateGoogleSlidesSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        const parentFolderId = await resolveFolderId(args.parentFolderId);

        // Check if presentation already exists
        const existingFileId = await checkFileExists(args.name, parentFolderId);
        if (existingFileId) {
          return errorResponse(
            `A presentation named "${args.name}" already exists in this location. ` +
            `File ID: ${existingFileId}. To modify it, you can use Google Slides directly.`
          );
        }

        const slidesService = google.slides({ version: 'v1', auth: authClient });
        const presentation = await slidesService.presentations.create({
          requestBody: { title: args.name },
        });

        await drive.files.update({
          fileId: presentation.data.presentationId!,
          addParents: parentFolderId,
          removeParents: 'root',
        });

        for (const slide of args.slides) {
          const slideObjectId = `slide_${uuidv4().substring(0, 8)}`;
          await slidesService.presentations.batchUpdate({
            presentationId: presentation.data.presentationId!,
            requestBody: {
              requests: [{
                createSlide: {
                  objectId: slideObjectId,
                  slideLayoutReference: { predefinedLayout: 'TITLE_AND_BODY' },
                }
              }]
            },
          });

          const slidePage = await slidesService.presentations.pages.get({
            presentationId: presentation.data.presentationId!,
            pageObjectId: slideObjectId,
          });

          let titlePlaceholderId = '';
          let bodyPlaceholderId = '';
          slidePage.data.pageElements?.forEach((el) => {
            if (el.shape?.placeholder?.type === 'TITLE') {
              titlePlaceholderId = el.objectId!;
            } else if (el.shape?.placeholder?.type === 'BODY') {
              bodyPlaceholderId = el.objectId!;
            }
          });

          await slidesService.presentations.batchUpdate({
            presentationId: presentation.data.presentationId!,
            requestBody: {
              requests: [
                { insertText: { objectId: titlePlaceholderId, text: slide.title, insertionIndex: 0 } },
                { insertText: { objectId: bodyPlaceholderId, text: slide.content, insertionIndex: 0 } }
              ]
            },
          });
        }

        return {
          content: [{
            type: 'text',
            text: `Created Google Slides presentation: ${args.name}\nID: ${presentation.data.presentationId}\nLink: https://docs.google.com/presentation/d/${presentation.data.presentationId}`,
          }],
          isError: false,
        };
      }

      case "updateGoogleSlides": {
        const validation = UpdateGoogleSlidesSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        const slidesService = google.slides({ version: 'v1', auth: authClient });
        
        // Get current presentation details
        const currentPresentation = await slidesService.presentations.get({
          presentationId: args.presentationId
        });
        
        if (!currentPresentation.data.slides) {
          return errorResponse("No slides found in presentation");
        }

        // Collect all slide IDs except the first one (we'll keep it for now)
        const slideIdsToDelete = currentPresentation.data.slides
          .slice(1)
          .map(slide => slide.objectId)
          .filter((id): id is string => id !== undefined);

        // Prepare requests to update presentation
        const requests: any[] = [];

        // Delete all slides except the first one
        if (slideIdsToDelete.length > 0) {
          slideIdsToDelete.forEach(slideId => {
            requests.push({
              deleteObject: { objectId: slideId }
            });
          });
        }

        // Now we need to update the first slide or create new slides
        if (args.slides.length === 0) {
          return errorResponse("At least one slide must be provided");
        }

        // Clear content of the first slide
        const firstSlide = currentPresentation.data.slides[0];
        if (firstSlide && firstSlide.pageElements) {
          // Find text elements to clear
          firstSlide.pageElements.forEach(element => {
            if (element.objectId && element.shape?.text) {
              requests.push({
                deleteText: {
                  objectId: element.objectId,
                  textRange: { type: 'ALL' }
                }
              });
            }
          });
        }

        // Update the first slide with new content
        const firstSlideContent = args.slides[0];
        if (firstSlide && firstSlide.pageElements) {
          // Find title and body placeholders
          let titlePlaceholderId: string | undefined;
          let bodyPlaceholderId: string | undefined;

          firstSlide.pageElements.forEach(element => {
            if (element.shape?.placeholder?.type === 'TITLE' || element.shape?.placeholder?.type === 'CENTERED_TITLE') {
              titlePlaceholderId = element.objectId || undefined;
            } else if (element.shape?.placeholder?.type === 'BODY' || element.shape?.placeholder?.type === 'SUBTITLE') {
              bodyPlaceholderId = element.objectId || undefined;
            }
          });

          if (titlePlaceholderId) {
            requests.push({
              insertText: {
                objectId: titlePlaceholderId,
                text: firstSlideContent.title,
                insertionIndex: 0
              }
            });
          }

          if (bodyPlaceholderId) {
            requests.push({
              insertText: {
                objectId: bodyPlaceholderId,
                text: firstSlideContent.content,
                insertionIndex: 0
              }
            });
          }
        }

        // Add any additional slides from the request
        for (let i = 1; i < args.slides.length; i++) {
          const slide = args.slides[i];
          const slideId = `slide_${Date.now()}_${i}`;
          
          requests.push({
            createSlide: {
              objectId: slideId,
              slideLayoutReference: {
                predefinedLayout: 'TITLE_AND_BODY'
              }
            }
          });

          // We'll need to add content to these slides in a separate batch update
          // because we need to wait for the slides to be created first
        }

        // Execute the batch update
        await slidesService.presentations.batchUpdate({
          presentationId: args.presentationId,
          requestBody: { requests }
        });

        // If we have additional slides, add their content
        if (args.slides.length > 1) {
          const contentRequests: any[] = [];
          
          // Get updated presentation to find the new slide IDs
          const updatedPresentation = await slidesService.presentations.get({
            presentationId: args.presentationId
          });

          // Add content to the new slides (starting from the second slide in our args)
          for (let i = 1; i < args.slides.length && updatedPresentation.data.slides; i++) {
            const slide = args.slides[i];
            const presentationSlide = updatedPresentation.data.slides[i];
            
            if (presentationSlide && presentationSlide.pageElements) {
              presentationSlide.pageElements.forEach(element => {
                if (element.objectId) {
                  if (element.shape?.placeholder?.type === 'TITLE' || element.shape?.placeholder?.type === 'CENTERED_TITLE') {
                    contentRequests.push({
                      insertText: {
                        objectId: element.objectId,
                        text: slide.title,
                        insertionIndex: 0
                      }
                    });
                  } else if (element.shape?.placeholder?.type === 'BODY' || element.shape?.placeholder?.type === 'SUBTITLE') {
                    contentRequests.push({
                      insertText: {
                        objectId: element.objectId,
                        text: slide.content,
                        insertionIndex: 0
                      }
                    });
                  }
                }
              });
            }
          }

          if (contentRequests.length > 0) {
            await slidesService.presentations.batchUpdate({
              presentationId: args.presentationId,
              requestBody: { requests: contentRequests }
            });
          }
        }

        return {
          content: [{
            type: 'text',
            text: `Updated Google Slides presentation with ${args.slides.length} slide(s)\nLink: https://docs.google.com/presentation/d/${args.presentationId}`,
          }],
          isError: false,
        };
      }

      case "formatGoogleDocText": {
        const validation = FormatGoogleDocTextSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        const docs = google.docs({ version: 'v1', auth: authClient });
        
        // Build text style object
        const textStyle: any = {};
        const fields: string[] = [];
        
        if (args.bold !== undefined) {
          textStyle.bold = args.bold;
          fields.push('bold');
        }
        
        if (args.italic !== undefined) {
          textStyle.italic = args.italic;
          fields.push('italic');
        }
        
        if (args.underline !== undefined) {
          textStyle.underline = args.underline;
          fields.push('underline');
        }
        
        if (args.strikethrough !== undefined) {
          textStyle.strikethrough = args.strikethrough;
          fields.push('strikethrough');
        }
        
        if (args.fontSize !== undefined) {
          textStyle.fontSize = {
            magnitude: args.fontSize,
            unit: 'PT'
          };
          fields.push('fontSize');
        }
        
        if (args.foregroundColor) {
          textStyle.foregroundColor = {
            color: {
              rgbColor: {
                red: args.foregroundColor.red || 0,
                green: args.foregroundColor.green || 0,
                blue: args.foregroundColor.blue || 0
              }
            }
          };
          fields.push('foregroundColor');
        }
        
        if (fields.length === 0) {
          return errorResponse("No formatting options specified");
        }
        
        await docs.documents.batchUpdate({
          documentId: args.documentId,
          requestBody: {
            requests: [{
              updateTextStyle: {
                range: {
                  startIndex: args.startIndex,
                  endIndex: args.endIndex
                },
                textStyle,
                fields: fields.join(',')
              }
            }]
          }
        });
        
        return {
          content: [{ type: "text", text: `Applied text formatting to range ${args.startIndex}-${args.endIndex}` }],
          isError: false
        };
      }

      case "formatGoogleDocParagraph": {
        const validation = FormatGoogleDocParagraphSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        const docs = google.docs({ version: 'v1', auth: authClient });
        
        // Build paragraph style object
        const paragraphStyle: any = {};
        const fields: string[] = [];
        
        if (args.namedStyleType !== undefined) {
          paragraphStyle.namedStyleType = args.namedStyleType;
          fields.push('namedStyleType');
        }
        
        if (args.alignment !== undefined) {
          paragraphStyle.alignment = args.alignment;
          fields.push('alignment');
        }
        
        if (args.lineSpacing !== undefined) {
          paragraphStyle.lineSpacing = args.lineSpacing;
          fields.push('lineSpacing');
        }
        
        if (args.spaceAbove !== undefined) {
          paragraphStyle.spaceAbove = {
            magnitude: args.spaceAbove,
            unit: 'PT'
          };
          fields.push('spaceAbove');
        }
        
        if (args.spaceBelow !== undefined) {
          paragraphStyle.spaceBelow = {
            magnitude: args.spaceBelow,
            unit: 'PT'
          };
          fields.push('spaceBelow');
        }
        
        if (fields.length === 0) {
          return errorResponse("No formatting options specified");
        }
        
        await docs.documents.batchUpdate({
          documentId: args.documentId,
          requestBody: {
            requests: [{
              updateParagraphStyle: {
                range: {
                  startIndex: args.startIndex,
                  endIndex: args.endIndex
                },
                paragraphStyle,
                fields: fields.join(',')
              }
            }]
          }
        });
        
        return {
          content: [{ type: "text", text: `Applied paragraph formatting to range ${args.startIndex}-${args.endIndex}` }],
          isError: false
        };
      }

      case "getGoogleDocContent": {
        const validation = GetGoogleDocContentSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        const docs = google.docs({ version: 'v1', auth: authClient });
        const document = await docs.documents.get({ documentId: args.documentId });
        
        let content = '';
        let currentIndex = 1;
        const segments: Array<{text: string, startIndex: number, endIndex: number}> = [];
        
        // Extract text content with indices
        if (document.data.body?.content) {
          for (const element of document.data.body.content) {
            if (element.paragraph?.elements) {
              for (const textElement of element.paragraph.elements) {
                if (textElement.textRun?.content) {
                  const text = textElement.textRun.content;
                  segments.push({
                    text,
                    startIndex: currentIndex,
                    endIndex: currentIndex + text.length
                  });
                  content += text;
                  currentIndex += text.length;
                }
              }
            }
          }
        }
        
        // Format the response to show text with indices
        let formattedContent = 'Document content with indices:\n\n';
        let lineStart = 1;
        const lines = content.split('\n');
        
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          const lineEnd = lineStart + line.length;
          if (line.trim()) {
            formattedContent += `[${lineStart}-${lineEnd}] ${line}\n`;
          }
          lineStart = lineEnd + 1; // +1 for the newline character
        }
        
        return {
          content: [{
            type: "text",
            text: formattedContent + `\nTotal length: ${content.length} characters`
          }],
          isError: false
        };
      }

      case "docs_deleteContentRange": {
        const validation = DocsDeleteContentRangeSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        const docs = google.docs({ version: 'v1', auth: authClient });
        await docs.documents.batchUpdate({
          documentId: args.documentId,
          requestBody: {
            requests: [{
              deleteContentRange: {
                range: {
                  startIndex: args.startIndex,
                  endIndex: args.endIndex
                }
              }
            }]
          }
        });

        return {
          content: [{
            type: "text",
            text: `Successfully deleted content from index ${args.startIndex} to ${args.endIndex} in document ${args.documentId}`
          }],
          isError: false
        };
      }

      case "docs_replaceAllText": {
        const validation = DocsReplaceAllTextSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        const docs = google.docs({ version: 'v1', auth: authClient });
        const response = await docs.documents.batchUpdate({
          documentId: args.documentId,
          requestBody: {
            requests: [{
              replaceAllText: {
                containsText: {
                  text: args.containsText,
                  matchCase: args.matchCase ?? false
                },
                replaceText: args.replaceText
              }
            }]
          }
        });

        const occurrencesReplaced = response.data.replies?.[0]?.replaceAllText?.occurrencesChanged || 0;

        return {
          content: [{
            type: "text",
            text: `Successfully replaced ${occurrencesReplaced} occurrence(s) of "${args.containsText}" with "${args.replaceText}" in document ${args.documentId}`
          }],
          isError: false
        };
      }

      case "docs_createParagraphBullets": {
        const validation = DocsCreateParagraphBulletsSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        const docs = google.docs({ version: 'v1', auth: authClient });
        const requestBody: any = {
          requests: [{
            createParagraphBullets: {
              range: {
                startIndex: args.startIndex,
                endIndex: args.endIndex
              }
            }
          }]
        };

        if (args.bulletPreset) {
          requestBody.requests[0].createParagraphBullets.bulletPreset = args.bulletPreset;
        }

        await docs.documents.batchUpdate({
          documentId: args.documentId,
          requestBody
        });

        return {
          content: [{
            type: "text",
            text: `Successfully created bullets for paragraphs from index ${args.startIndex} to ${args.endIndex}${args.bulletPreset ? ` with preset: ${args.bulletPreset}` : ''}`
          }],
          isError: false
        };
      }

      case "docs_deleteParagraphBullets": {
        const validation = DocsDeleteParagraphBulletsSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        const docs = google.docs({ version: 'v1', auth: authClient });
        await docs.documents.batchUpdate({
          documentId: args.documentId,
          requestBody: {
            requests: [{
              deleteParagraphBullets: {
                range: {
                  startIndex: args.startIndex,
                  endIndex: args.endIndex
                }
              }
            }]
          }
        });

        return {
          content: [{
            type: "text",
            text: `Successfully removed bullets from paragraphs from index ${args.startIndex} to ${args.endIndex}`
          }],
          isError: false
        };
      }

      case "docs_insertPageBreak": {
        const validation = DocsInsertPageBreakSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        const docs = google.docs({ version: 'v1', auth: authClient });
        await docs.documents.batchUpdate({
          documentId: args.documentId,
          requestBody: {
            requests: [{
              insertPageBreak: {
                location: {
                  index: args.index
                }
              }
            }]
          }
        });

        return {
          content: [{
            type: "text",
            text: `Successfully inserted page break at index ${args.index}`
          }],
          isError: false
        };
      }

      case "docs_updateDocumentStyle": {
        const validation = DocsUpdateDocumentStyleSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        const docs = google.docs({ version: 'v1', auth: authClient });
        const documentStyle: any = {};
        const fields: string[] = [];

        if (args.marginTop !== undefined) {
          documentStyle.marginTop = { magnitude: args.marginTop, unit: 'PT' };
          fields.push('marginTop');
        }
        if (args.marginBottom !== undefined) {
          documentStyle.marginBottom = { magnitude: args.marginBottom, unit: 'PT' };
          fields.push('marginBottom');
        }
        if (args.marginLeft !== undefined) {
          documentStyle.marginLeft = { magnitude: args.marginLeft, unit: 'PT' };
          fields.push('marginLeft');
        }
        if (args.marginRight !== undefined) {
          documentStyle.marginRight = { magnitude: args.marginRight, unit: 'PT' };
          fields.push('marginRight');
        }
        if (args.pageWidth !== undefined || args.pageHeight !== undefined) {
          documentStyle.pageSize = {};
          if (args.pageWidth !== undefined) {
            documentStyle.pageSize.width = { magnitude: args.pageWidth, unit: 'PT' };
            fields.push('pageSize.width');
          }
          if (args.pageHeight !== undefined) {
            documentStyle.pageSize.height = { magnitude: args.pageHeight, unit: 'PT' };
            fields.push('pageSize.height');
          }
        }

        await docs.documents.batchUpdate({
          documentId: args.documentId,
          requestBody: {
            requests: [{
              updateDocumentStyle: {
                documentStyle,
                fields: fields.join(',')
              }
            }]
          }
        });

        return {
          content: [{
            type: "text",
            text: `Successfully updated document style: ${fields.join(', ')}`
          }],
          isError: false
        };
      }

      case "docs_deleteTableColumn": {
        const validation = DocsDeleteTableColumnSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        const docs = google.docs({ version: 'v1', auth: authClient });
        try {
          await docs.documents.batchUpdate({
            documentId: args.documentId,
            requestBody: {
              requests: [{
                deleteTableColumn: {
                  tableCellLocation: {
                    tableStartLocation: { index: args.tableStartIndex },
                    rowIndex: args.rowIndex,
                    columnIndex: args.columnIndex
                  }
                }
              }]
            }
          });

          return {
            content: [{
              type: "text",
              text: `Successfully deleted column ${args.columnIndex} from table at index ${args.tableStartIndex}`
            }],
            isError: false
          };
        } catch (error: any) {
          return errorResponse(error.message || 'Failed to delete table column');
        }
      }

      case "docs_deleteTableRow": {
        const validation = DocsDeleteTableRowSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        const docs = google.docs({ version: 'v1', auth: authClient });
        try {
          await docs.documents.batchUpdate({
            documentId: args.documentId,
            requestBody: {
              requests: [{
                deleteTableRow: {
                  tableCellLocation: {
                    tableStartLocation: { index: args.tableStartIndex },
                    rowIndex: args.rowIndex,
                    columnIndex: args.columnIndex
                  }
                }
              }]
            }
          });

          return {
            content: [{
              type: "text",
              text: `Successfully deleted row ${args.rowIndex} from table at index ${args.tableStartIndex}`
            }],
            isError: false
          };
        } catch (error: any) {
          return errorResponse(error.message || 'Failed to delete table row');
        }
      }

      case "docs_insertTable": {
        const validation = DocsInsertTableSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        const docs = google.docs({ version: 'v1', auth: authClient });
        try {
          const response = await docs.documents.batchUpdate({
            documentId: args.documentId,
            requestBody: {
              requests: [{
                insertTable: {
                  location: { index: args.index },
                  rows: args.rows,
                  columns: args.columns
                }
              }]
            }
          });

          const tableId = response.data.replies?.[0]?.insertTable?.tableObjectId || 'unknown';
          return {
            content: [{
              type: "text",
              text: `Successfully inserted ${args.rows}x${args.columns} table at index ${args.index}. Table ID: ${tableId}`
            }],
            isError: false
          };
        } catch (error: any) {
          return errorResponse(error.message || 'Failed to insert table');
        }
      }

      case "docs_insertTableColumn": {
        const validation = DocsInsertTableColumnSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        const docs = google.docs({ version: 'v1', auth: authClient });
        try {
          await docs.documents.batchUpdate({
            documentId: args.documentId,
            requestBody: {
              requests: [{
                insertTableColumn: {
                  tableCellLocation: {
                    tableStartLocation: { index: args.tableStartIndex },
                    rowIndex: args.rowIndex,
                    columnIndex: args.columnIndex
                  },
                  insertRight: args.insertRight
                }
              }]
            }
          });

          return {
            content: [{
              type: "text",
              text: `Successfully inserted column ${args.insertRight ? 'right of' : 'left of'} column ${args.columnIndex} in table at index ${args.tableStartIndex}`
            }],
            isError: false
          };
        } catch (error: any) {
          return errorResponse(error.message || 'Failed to insert table column');
        }
      }

      case "docs_insertTableRow": {
        const validation = DocsInsertTableRowSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        const docs = google.docs({ version: 'v1', auth: authClient });
        try {
          await docs.documents.batchUpdate({
            documentId: args.documentId,
            requestBody: {
              requests: [{
                insertTableRow: {
                  tableCellLocation: {
                    tableStartLocation: { index: args.tableStartIndex },
                    rowIndex: args.rowIndex,
                    columnIndex: args.columnIndex
                  },
                  insertBelow: args.insertBelow
                }
              }]
            }
          });

          return {
            content: [{
              type: "text",
              text: `Successfully inserted row ${args.insertBelow ? 'below' : 'above'} row ${args.rowIndex} in table at index ${args.tableStartIndex}`
            }],
            isError: false
          };
        } catch (error: any) {
          return errorResponse(error.message || 'Failed to insert table row');
        }
      }

      case "docs_mergeTableCells": {
        const validation = DocsMergeTableCellsSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        const docs = google.docs({ version: 'v1', auth: authClient });
        try {
          await docs.documents.batchUpdate({
            documentId: args.documentId,
            requestBody: {
              requests: [{
                mergeTableCells: {
                  tableRange: {
                    tableCellLocation: {
                      tableStartLocation: { index: args.tableStartIndex },
                      rowIndex: args.rowIndex,
                      columnIndex: args.columnIndex
                    },
                    rowSpan: args.rowSpan,
                    columnSpan: args.columnSpan
                  }
                }
              }]
            }
          });

          return {
            content: [{
              type: "text",
              text: `Successfully merged ${args.rowSpan}x${args.columnSpan} cells starting at row ${args.rowIndex}, column ${args.columnIndex} in table at index ${args.tableStartIndex}`
            }],
            isError: false
          };
        } catch (error: any) {
          return errorResponse(error.message || 'Failed to merge table cells');
        }
      }

      case "docs_pinTableHeaderRows": {
        const validation = DocsPinTableHeaderRowsSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        const docs = google.docs({ version: 'v1', auth: authClient });
        try {
          await docs.documents.batchUpdate({
            documentId: args.documentId,
            requestBody: {
              requests: [{
                pinTableHeaderRows: {
                  tableStartLocation: { index: args.tableStartIndex },
                  pinnedHeaderRowsCount: args.pinnedHeaderRowsCount
                }
              }]
            }
          });

          return {
            content: [{
              type: "text",
              text: args.pinnedHeaderRowsCount === 0
                ? `Successfully unpinned all header rows in table at index ${args.tableStartIndex}`
                : `Successfully pinned ${args.pinnedHeaderRowsCount} header row(s) in table at index ${args.tableStartIndex}`
            }],
            isError: false
          };
        } catch (error: any) {
          return errorResponse(error.message || 'Failed to pin table header rows');
        }
      }

      case "docs_unmergeTableCells": {
        const validation = DocsUnmergeTableCellsSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        const docs = google.docs({ version: 'v1', auth: authClient });
        try {
          await docs.documents.batchUpdate({
            documentId: args.documentId,
            requestBody: {
              requests: [{
                unmergeTableCells: {
                  tableRange: {
                    tableCellLocation: {
                      tableStartLocation: { index: args.tableStartIndex },
                      rowIndex: args.rowIndex,
                      columnIndex: args.columnIndex
                    },
                    rowSpan: args.rowSpan,
                    columnSpan: args.columnSpan
                  }
                }
              }]
            }
          });

          return {
            content: [{
              type: "text",
              text: `Successfully unmerged ${args.rowSpan}x${args.columnSpan} cells starting at row ${args.rowIndex}, column ${args.columnIndex} in table at index ${args.tableStartIndex}`
            }],
            isError: false
          };
        } catch (error: any) {
          return errorResponse(error.message || 'Failed to unmerge table cells');
        }
      }

      case "docs_updateTableCellStyle": {
        const validation = DocsUpdateTableCellStyleSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        const docs = google.docs({ version: 'v1', auth: authClient });
        try {
          const tableCellStyle: any = {};
          const fields: string[] = [];

          // Background color
          if (args.backgroundColor) {
            tableCellStyle.backgroundColor = { color: { rgbColor: args.backgroundColor } };
            fields.push('backgroundColor');
          }

          // Borders
          if (args.borderLeft) {
            tableCellStyle.borderLeft = {};
            if (args.borderLeft.color) {
              tableCellStyle.borderLeft.color = { rgbColor: args.borderLeft.color };
            }
            if (args.borderLeft.width !== undefined) {
              tableCellStyle.borderLeft.width = { magnitude: args.borderLeft.width, unit: 'PT' };
            }
            if (args.borderLeft.dashStyle) {
              tableCellStyle.borderLeft.dashStyle = args.borderLeft.dashStyle;
            }
            fields.push('borderLeft');
          }

          if (args.borderRight) {
            tableCellStyle.borderRight = {};
            if (args.borderRight.color) {
              tableCellStyle.borderRight.color = { rgbColor: args.borderRight.color };
            }
            if (args.borderRight.width !== undefined) {
              tableCellStyle.borderRight.width = { magnitude: args.borderRight.width, unit: 'PT' };
            }
            if (args.borderRight.dashStyle) {
              tableCellStyle.borderRight.dashStyle = args.borderRight.dashStyle;
            }
            fields.push('borderRight');
          }

          if (args.borderTop) {
            tableCellStyle.borderTop = {};
            if (args.borderTop.color) {
              tableCellStyle.borderTop.color = { rgbColor: args.borderTop.color };
            }
            if (args.borderTop.width !== undefined) {
              tableCellStyle.borderTop.width = { magnitude: args.borderTop.width, unit: 'PT' };
            }
            if (args.borderTop.dashStyle) {
              tableCellStyle.borderTop.dashStyle = args.borderTop.dashStyle;
            }
            fields.push('borderTop');
          }

          if (args.borderBottom) {
            tableCellStyle.borderBottom = {};
            if (args.borderBottom.color) {
              tableCellStyle.borderBottom.color = { rgbColor: args.borderBottom.color };
            }
            if (args.borderBottom.width !== undefined) {
              tableCellStyle.borderBottom.width = { magnitude: args.borderBottom.width, unit: 'PT' };
            }
            if (args.borderBottom.dashStyle) {
              tableCellStyle.borderBottom.dashStyle = args.borderBottom.dashStyle;
            }
            fields.push('borderBottom');
          }

          // Padding
          if (args.paddingLeft !== undefined) {
            tableCellStyle.paddingLeft = { magnitude: args.paddingLeft, unit: 'PT' };
            fields.push('paddingLeft');
          }
          if (args.paddingRight !== undefined) {
            tableCellStyle.paddingRight = { magnitude: args.paddingRight, unit: 'PT' };
            fields.push('paddingRight');
          }
          if (args.paddingTop !== undefined) {
            tableCellStyle.paddingTop = { magnitude: args.paddingTop, unit: 'PT' };
            fields.push('paddingTop');
          }
          if (args.paddingBottom !== undefined) {
            tableCellStyle.paddingBottom = { magnitude: args.paddingBottom, unit: 'PT' };
            fields.push('paddingBottom');
          }

          // Content alignment
          if (args.contentAlignment) {
            tableCellStyle.contentAlignment = args.contentAlignment;
            fields.push('contentAlignment');
          }

          await docs.documents.batchUpdate({
            documentId: args.documentId,
            requestBody: {
              requests: [{
                updateTableCellStyle: {
                  tableStartLocation: { index: args.tableStartIndex },
                  tableRange: {
                    tableCellLocation: {
                      tableStartLocation: { index: args.tableStartIndex },
                      rowIndex: args.rowIndex,
                      columnIndex: args.columnIndex
                    },
                    rowSpan: args.rowSpan || 1,
                    columnSpan: args.columnSpan || 1
                  },
                  tableCellStyle,
                  fields: fields.join(',')
                }
              }]
            }
          });

          return {
            content: [{
              type: "text",
              text: `Successfully updated table cell style for cells starting at row ${args.rowIndex}, column ${args.columnIndex} in table at index ${args.tableStartIndex}. Updated: ${fields.join(', ')}`
            }],
            isError: false
          };
        } catch (error: any) {
          return errorResponse(error.message || 'Failed to update table cell style');
        }
      }

      case "docs_updateTableColumnProperties": {
        const validation = DocsUpdateTableColumnPropertiesSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        const docs = google.docs({ version: 'v1', auth: authClient });
        try {
          const tableColumnProperties: any = {};
          const fields: string[] = [];

          if (args.widthMagnitude !== undefined) {
            tableColumnProperties.width = { magnitude: args.widthMagnitude, unit: 'PT' };
            fields.push('width');
          }

          if (args.widthType) {
            tableColumnProperties.widthType = args.widthType;
            fields.push('widthType');
          }

          await docs.documents.batchUpdate({
            documentId: args.documentId,
            requestBody: {
              requests: [{
                updateTableColumnProperties: {
                  tableStartLocation: { index: args.tableStartIndex },
                  columnIndices: args.columnIndices,
                  tableColumnProperties,
                  fields: fields.join(',')
                }
              }]
            }
          });

          return {
            content: [{
              type: "text",
              text: `Successfully updated properties for columns [${args.columnIndices.join(', ')}] in table at index ${args.tableStartIndex}. Updated: ${fields.join(', ')}`
            }],
            isError: false
          };
        } catch (error: any) {
          return errorResponse(error.message || 'Failed to update table column properties');
        }
      }

      case "docs_updateTableRowStyle": {
        const validation = DocsUpdateTableRowStyleSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        const docs = google.docs({ version: 'v1', auth: authClient });
        try {
          const tableRowStyle: any = {};
          const fields: string[] = [];

          if (args.minRowHeight !== undefined) {
            tableRowStyle.minRowHeight = { magnitude: args.minRowHeight, unit: 'PT' };
            fields.push('minRowHeight');
          }

          if (args.tableHeader !== undefined) {
            tableRowStyle.tableHeader = args.tableHeader;
            fields.push('tableHeader');
          }

          if (args.preventOverflow !== undefined) {
            tableRowStyle.preventOverflow = args.preventOverflow;
            fields.push('preventOverflow');
          }

          await docs.documents.batchUpdate({
            documentId: args.documentId,
            requestBody: {
              requests: [{
                updateTableRowStyle: {
                  tableStartLocation: { index: args.tableStartIndex },
                  rowIndices: args.rowIndices,
                  tableRowStyle,
                  fields: fields.join(',')
                }
              }]
            }
          });

          return {
            content: [{
              type: "text",
              text: `Successfully updated style for rows [${args.rowIndices.join(', ')}] in table at index ${args.tableStartIndex}. Updated: ${fields.join(', ')}`
            }],
            isError: false
          };
        } catch (error: any) {
          return errorResponse(error.message || 'Failed to update table row style');
        }
      }

      case "docs_createFooter": {
        const validation = DocsCreateFooterSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        const docs = google.docs({ version: 'v1', auth: authClient });
        try {
          const createFooterRequest: any = {
            type: args.type
          };

          if (args.sectionBreakIndex !== undefined) {
            createFooterRequest.sectionBreakLocation = { index: args.sectionBreakIndex };
          }

          const response = await docs.documents.batchUpdate({
            documentId: args.documentId,
            requestBody: {
              requests: [{
                createFooter: createFooterRequest
              }]
            }
          });

          const footerId = response.data.replies?.[0]?.createFooter?.footerId;
          return {
            content: [{
              type: "text",
              text: `Successfully created footer with ID: ${footerId || 'unknown'}`
            }],
            isError: false
          };
        } catch (error: any) {
          return errorResponse(error.message || 'Failed to create footer');
        }
      }

      case "docs_createFootnote": {
        const validation = DocsCreateFootnoteSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        const docs = google.docs({ version: 'v1', auth: authClient });
        try {
          const response = await docs.documents.batchUpdate({
            documentId: args.documentId,
            requestBody: {
              requests: [{
                createFootnote: {
                  location: { index: args.index }
                }
              }]
            }
          });

          const footnoteId = response.data.replies?.[0]?.createFootnote?.footnoteId;
          return {
            content: [{
              type: "text",
              text: `Successfully created footnote at index ${args.index} with ID: ${footnoteId || 'unknown'}`
            }],
            isError: false
          };
        } catch (error: any) {
          return errorResponse(error.message || 'Failed to create footnote');
        }
      }

      case "docs_createHeader": {
        const validation = DocsCreateHeaderSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        const docs = google.docs({ version: 'v1', auth: authClient });
        try {
          const createHeaderRequest: any = {
            type: args.type
          };

          if (args.sectionBreakIndex !== undefined) {
            createHeaderRequest.sectionBreakLocation = { index: args.sectionBreakIndex };
          }

          const response = await docs.documents.batchUpdate({
            documentId: args.documentId,
            requestBody: {
              requests: [{
                createHeader: createHeaderRequest
              }]
            }
          });

          const headerId = response.data.replies?.[0]?.createHeader?.headerId;
          return {
            content: [{
              type: "text",
              text: `Successfully created header with ID: ${headerId || 'unknown'}`
            }],
            isError: false
          };
        } catch (error: any) {
          return errorResponse(error.message || 'Failed to create header');
        }
      }

      case "docs_createNamedRange": {
        const validation = DocsCreateNamedRangeSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        const docs = google.docs({ version: 'v1', auth: authClient });
        try {
          const response = await docs.documents.batchUpdate({
            documentId: args.documentId,
            requestBody: {
              requests: [{
                createNamedRange: {
                  name: args.name,
                  range: {
                    startIndex: args.startIndex,
                    endIndex: args.endIndex
                  }
                }
              }]
            }
          });

          const namedRangeId = response.data.replies?.[0]?.createNamedRange?.namedRangeId;
          return {
            content: [{
              type: "text",
              text: `Successfully created named range "${args.name}" with ID: ${namedRangeId || 'unknown'}`
            }],
            isError: false
          };
        } catch (error: any) {
          return errorResponse(error.message || 'Failed to create named range');
        }
      }

      case "docs_deleteFooter": {
        const validation = DocsDeleteFooterSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        const docs = google.docs({ version: 'v1', auth: authClient });
        try {
          await docs.documents.batchUpdate({
            documentId: args.documentId,
            requestBody: {
              requests: [{
                deleteFooter: {
                  footerId: args.footerId
                }
              }]
            }
          });

          return {
            content: [{
              type: "text",
              text: `Successfully deleted footer with ID: ${args.footerId}`
            }],
            isError: false
          };
        } catch (error: any) {
          return errorResponse(error.message || 'Failed to delete footer');
        }
      }

      case "docs_deleteHeader": {
        const validation = DocsDeleteHeaderSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        const docs = google.docs({ version: 'v1', auth: authClient });
        try {
          await docs.documents.batchUpdate({
            documentId: args.documentId,
            requestBody: {
              requests: [{
                deleteHeader: {
                  headerId: args.headerId
                }
              }]
            }
          });

          return {
            content: [{
              type: "text",
              text: `Successfully deleted header with ID: ${args.headerId}`
            }],
            isError: false
          };
        } catch (error: any) {
          return errorResponse(error.message || 'Failed to delete header');
        }
      }

      case "docs_deleteNamedRange": {
        const validation = DocsDeleteNamedRangeSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        const docs = google.docs({ version: 'v1', auth: authClient });
        try {
          const deleteRequest: any = {};

          if (args.namedRangeId) {
            deleteRequest.namedRangeId = args.namedRangeId;
          } else if (args.name) {
            deleteRequest.name = args.name;
          }

          await docs.documents.batchUpdate({
            documentId: args.documentId,
            requestBody: {
              requests: [{
                deleteNamedRange: deleteRequest
              }]
            }
          });

          const identifier = args.namedRangeId || args.name;
          return {
            content: [{
              type: "text",
              text: `Successfully deleted named range: ${identifier}`
            }],
            isError: false
          };
        } catch (error: any) {
          return errorResponse(error.message || 'Failed to delete named range');
        }
      }

      case "docs_deletePositionedObject": {
        const validation = DocsDeletePositionedObjectSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        const docs = google.docs({ version: 'v1', auth: authClient });
        try {
          await docs.documents.batchUpdate({
            documentId: args.documentId,
            requestBody: {
              requests: [{
                deletePositionedObject: {
                  objectId: args.objectId
                }
              }]
            }
          });

          return {
            content: [{
              type: "text",
              text: `Successfully deleted positioned object with ID: ${args.objectId}`
            }],
            isError: false
          };
        } catch (error: any) {
          return errorResponse(error.message || 'Failed to delete positioned object');
        }
      }

      case "docs_insertSectionBreak": {
        const validation = DocsInsertSectionBreakSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        const docs = google.docs({ version: 'v1', auth: authClient });
        try {
          const insertSectionBreakRequest: any = {
            location: { index: args.index }
          };

          if (args.sectionType !== undefined) {
            insertSectionBreakRequest.sectionType = args.sectionType;
          }

          await docs.documents.batchUpdate({
            documentId: args.documentId,
            requestBody: {
              requests: [{
                insertSectionBreak: insertSectionBreakRequest
              }]
            }
          });

          return {
            content: [{
              type: "text",
              text: `Successfully inserted section break at index ${args.index}${args.sectionType ? ` with type ${args.sectionType}` : ''}`
            }],
            isError: false
          };
        } catch (error: any) {
          return errorResponse(error.message || 'Failed to insert section break');
        }
      }

      case "docs_insertPerson": {
        const validation = DocsInsertPersonSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        const docs = google.docs({ version: 'v1', auth: authClient });
        try {
          await docs.documents.batchUpdate({
            documentId: args.documentId,
            requestBody: {
              requests: [{
                insertPerson: {
                  location: { index: args.index },
                  person: {
                    personProperties: {
                      email: args.email
                    }
                  }
                }
              }]
            }
          });

          return {
            content: [{
              type: "text",
              text: `Successfully inserted person mention for ${args.email} at index ${args.index}`
            }],
            isError: false
          };
        } catch (error: any) {
          return errorResponse(error.message || 'Failed to insert person mention');
        }
      }

      case "docs_insertInlineImage": {
        const validation = DocsInsertInlineImageSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        const docs = google.docs({ version: 'v1', auth: authClient });
        try {
          const insertRequest: any = {
            location: { index: args.index },
            uri: args.uri
          };

          if (args.width !== undefined || args.height !== undefined) {
            insertRequest.objectSize = {};
            if (args.width !== undefined) {
              insertRequest.objectSize.width = {
                magnitude: args.width,
                unit: 'PT'
              };
            }
            if (args.height !== undefined) {
              insertRequest.objectSize.height = {
                magnitude: args.height,
                unit: 'PT'
              };
            }
          }

          const response = await docs.documents.batchUpdate({
            documentId: args.documentId,
            requestBody: {
              requests: [{
                insertInlineImage: insertRequest
              }]
            }
          });

          const objectId = response.data.replies?.[0]?.insertInlineImage?.objectId;
          return {
            content: [{
              type: "text",
              text: `Successfully inserted inline image at index ${args.index}${objectId ? ` with object ID: ${objectId}` : ''}`
            }],
            isError: false
          };
        } catch (error: any) {
          return errorResponse(error.message || 'Failed to insert inline image');
        }
      }

      case "docs_replaceImage": {
        const validation = DocsReplaceImageSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        const docs = google.docs({ version: 'v1', auth: authClient });
        try {
          await docs.documents.batchUpdate({
            documentId: args.documentId,
            requestBody: {
              requests: [{
                replaceImage: {
                  imageObjectId: args.imageObjectId,
                  uri: args.uri,
                  imageReplaceMethod: 'CENTER_CROP'
                }
              }]
            }
          });

          return {
            content: [{
              type: "text",
              text: `Successfully replaced image ${args.imageObjectId} with new image from ${args.uri}`
            }],
            isError: false
          };
        } catch (error: any) {
          return errorResponse(error.message || 'Failed to replace image');
        }
      }

      case "docs_replaceNamedRangeContent": {
        const validation = DocsReplaceNamedRangeContentSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        const docs = google.docs({ version: 'v1', auth: authClient });
        try {
          const replaceRequest: any = {
            text: args.text
          };

          if (args.namedRangeId) {
            replaceRequest.namedRangeId = args.namedRangeId;
          } else if (args.namedRangeName) {
            replaceRequest.namedRangeName = args.namedRangeName;
          }

          if (args.tabId !== undefined) {
            replaceRequest.tabId = args.tabId;
          }

          await docs.documents.batchUpdate({
            documentId: args.documentId,
            requestBody: {
              requests: [{
                replaceNamedRangeContent: replaceRequest
              }]
            }
          });

          const identifier = args.namedRangeId || args.namedRangeName;
          return {
            content: [{
              type: "text",
              text: `Successfully replaced content in named range: ${identifier}`
            }],
            isError: false
          };
        } catch (error: any) {
          return errorResponse(error.message || 'Failed to replace named range content');
        }
      }

      case "docs_updateSectionStyle": {
        const validation = DocsUpdateSectionStyleSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        const docs = google.docs({ version: 'v1', auth: authClient });
        try {
          const sectionStyle: any = {};
          const fields: string[] = [];

          if (args.columnSeparatorStyle !== undefined) {
            sectionStyle.columnSeparatorStyle = args.columnSeparatorStyle;
            fields.push('columnSeparatorStyle');
          }

          if (args.contentDirection !== undefined) {
            sectionStyle.contentDirection = args.contentDirection;
            fields.push('contentDirection');
          }

          if (args.defaultHeaderId !== undefined) {
            sectionStyle.defaultHeaderId = args.defaultHeaderId;
            fields.push('defaultHeaderId');
          }

          if (args.defaultFooterId !== undefined) {
            sectionStyle.defaultFooterId = args.defaultFooterId;
            fields.push('defaultFooterId');
          }

          if (args.evenPageHeaderId !== undefined) {
            sectionStyle.evenPageHeaderId = args.evenPageHeaderId;
            fields.push('evenPageHeaderId');
          }

          if (args.evenPageFooterId !== undefined) {
            sectionStyle.evenPageFooterId = args.evenPageFooterId;
            fields.push('evenPageFooterId');
          }

          if (args.firstPageHeaderId !== undefined) {
            sectionStyle.firstPageHeaderId = args.firstPageHeaderId;
            fields.push('firstPageHeaderId');
          }

          if (args.firstPageFooterId !== undefined) {
            sectionStyle.firstPageFooterId = args.firstPageFooterId;
            fields.push('firstPageFooterId');
          }

          if (args.flipPageOrientation !== undefined) {
            sectionStyle.flipPageOrientation = args.flipPageOrientation;
            fields.push('flipPageOrientation');
          }

          if (args.marginTop !== undefined) {
            sectionStyle.marginTop = { magnitude: args.marginTop, unit: 'PT' };
            fields.push('marginTop');
          }

          if (args.marginBottom !== undefined) {
            sectionStyle.marginBottom = { magnitude: args.marginBottom, unit: 'PT' };
            fields.push('marginBottom');
          }

          if (args.marginRight !== undefined) {
            sectionStyle.marginRight = { magnitude: args.marginRight, unit: 'PT' };
            fields.push('marginRight');
          }

          if (args.marginLeft !== undefined) {
            sectionStyle.marginLeft = { magnitude: args.marginLeft, unit: 'PT' };
            fields.push('marginLeft');
          }

          if (args.marginHeader !== undefined) {
            sectionStyle.marginHeader = { magnitude: args.marginHeader, unit: 'PT' };
            fields.push('marginHeader');
          }

          if (args.marginFooter !== undefined) {
            sectionStyle.marginFooter = { magnitude: args.marginFooter, unit: 'PT' };
            fields.push('marginFooter');
          }

          if (args.pageNumberStart !== undefined) {
            sectionStyle.pageNumberStart = args.pageNumberStart;
            fields.push('pageNumberStart');
          }

          if (args.sectionType !== undefined) {
            sectionStyle.sectionType = args.sectionType;
            fields.push('sectionType');
          }

          if (args.useFirstPageHeaderFooter !== undefined) {
            sectionStyle.useFirstPageHeaderFooter = args.useFirstPageHeaderFooter;
            fields.push('useFirstPageHeaderFooter');
          }

          await docs.documents.batchUpdate({
            documentId: args.documentId,
            requestBody: {
              requests: [{
                updateSectionStyle: {
                  range: {
                    startIndex: args.startIndex,
                    endIndex: args.endIndex
                  },
                  sectionStyle,
                  fields: fields.join(',')
                }
              }]
            }
          });

          return {
            content: [{
              type: "text",
              text: `Successfully updated section style for range ${args.startIndex}-${args.endIndex}. Updated: ${fields.join(', ')}`
            }],
            isError: false
          };
        } catch (error: any) {
          return errorResponse(error.message || 'Failed to update section style');
        }
      }

      case "getGoogleSlidesContent": {
        const validation = GetGoogleSlidesContentSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        const slidesService = google.slides({ version: 'v1', auth: authClient });
        const presentation = await slidesService.presentations.get({
          presentationId: args.presentationId
        });

        if (!presentation.data.slides) {
          return errorResponse("No slides found in presentation");
        }

        let content = 'Presentation content with element IDs:\n\n';
        const slides = args.slideIndex !== undefined 
          ? [presentation.data.slides[args.slideIndex]]
          : presentation.data.slides;

        slides.forEach((slide, index) => {
          if (!slide || !slide.objectId) return;
          
          content += `\nSlide ${args.slideIndex ?? index} (ID: ${slide.objectId}):\n`;
          content += '----------------------------\n';

          if (slide.pageElements) {
            slide.pageElements.forEach((element) => {
              if (!element.objectId) return;

              if (element.shape?.text) {
                content += `  Text Box (ID: ${element.objectId}):\n`;
                const textElements = element.shape.text.textElements || [];
                let text = '';
                textElements.forEach((textElement) => {
                  if (textElement.textRun?.content) {
                    text += textElement.textRun.content;
                  }
                });
                content += `    "${text.trim()}"\n`;
              } else if (element.shape) {
                content += `  Shape (ID: ${element.objectId}): ${element.shape.shapeType || 'Unknown'}\n`;
              } else if (element.image) {
                content += `  Image (ID: ${element.objectId})\n`;
              } else if (element.video) {
                content += `  Video (ID: ${element.objectId})\n`;
              } else if (element.table) {
                content += `  Table (ID: ${element.objectId})\n`;
              }
            });
          }
        });

        return {
          content: [{ type: "text", text: content }],
          isError: false
        };
      }

      case "formatGoogleSlidesText": {
        const validation = FormatGoogleSlidesTextSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        const slidesService = google.slides({ version: 'v1', auth: authClient });
        const textStyle: any = {};
        const fields: string[] = [];

        if (args.bold !== undefined) {
          textStyle.bold = args.bold;
          fields.push('bold');
        }

        if (args.italic !== undefined) {
          textStyle.italic = args.italic;
          fields.push('italic');
        }

        if (args.underline !== undefined) {
          textStyle.underline = args.underline;
          fields.push('underline');
        }

        if (args.strikethrough !== undefined) {
          textStyle.strikethrough = args.strikethrough;
          fields.push('strikethrough');
        }

        if (args.fontSize !== undefined) {
          textStyle.fontSize = {
            magnitude: args.fontSize,
            unit: 'PT'
          };
          fields.push('fontSize');
        }

        if (args.fontFamily !== undefined) {
          textStyle.fontFamily = args.fontFamily;
          fields.push('fontFamily');
        }

        if (args.foregroundColor) {
          textStyle.foregroundColor = {
            opaqueColor: {
              rgbColor: {
                red: args.foregroundColor.red || 0,
                green: args.foregroundColor.green || 0,
                blue: args.foregroundColor.blue || 0
              }
            }
          };
          fields.push('foregroundColor');
        }

        if (fields.length === 0) {
          return errorResponse("No formatting options specified");
        }

        const updateRequest: any = {
          updateTextStyle: {
            objectId: args.objectId,
            style: textStyle,
            fields: fields.join(',')
          }
        };

        // Add text range if specified
        if (args.startIndex !== undefined && args.endIndex !== undefined) {
          updateRequest.updateTextStyle.textRange = {
            type: 'FIXED_RANGE',
            startIndex: args.startIndex,
            endIndex: args.endIndex
          };
        } else {
          updateRequest.updateTextStyle.textRange = { type: 'ALL' };
        }

        await slidesService.presentations.batchUpdate({
          presentationId: args.presentationId,
          requestBody: { requests: [updateRequest] }
        });

        return {
          content: [{ type: "text", text: `Applied text formatting to object ${args.objectId}` }],
          isError: false
        };
      }

      case "formatGoogleSlidesParagraph": {
        const validation = FormatGoogleSlidesParagraphSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        const slidesService = google.slides({ version: 'v1', auth: authClient });
        const requests: any[] = [];

        if (args.alignment) {
          requests.push({
            updateParagraphStyle: {
              objectId: args.objectId,
              style: { alignment: args.alignment },
              fields: 'alignment'
            }
          });
        }

        if (args.lineSpacing !== undefined) {
          requests.push({
            updateParagraphStyle: {
              objectId: args.objectId,
              style: { lineSpacing: args.lineSpacing },
              fields: 'lineSpacing'
            }
          });
        }

        if (args.bulletStyle) {
          if (args.bulletStyle === 'NONE') {
            requests.push({
              deleteParagraphBullets: {
                objectId: args.objectId
              }
            });
          } else if (args.bulletStyle === 'NUMBERED') {
            requests.push({
              createParagraphBullets: {
                objectId: args.objectId,
                bulletPreset: 'NUMBERED_DIGIT_ALPHA_ROMAN'
              }
            });
          } else {
            requests.push({
              createParagraphBullets: {
                objectId: args.objectId,
                bulletPreset: `BULLET_${args.bulletStyle}_CIRCLE_SQUARE`
              }
            });
          }
        }

        if (requests.length === 0) {
          return errorResponse("No formatting options specified");
        }

        await slidesService.presentations.batchUpdate({
          presentationId: args.presentationId,
          requestBody: { requests }
        });

        return {
          content: [{ type: "text", text: `Applied paragraph formatting to object ${args.objectId}` }],
          isError: false
        };
      }

      case "styleGoogleSlidesShape": {
        const validation = StyleGoogleSlidesShapeSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        const slidesService = google.slides({ version: 'v1', auth: authClient });
        const shapeProperties: any = {};
        const fields: string[] = [];

        if (args.backgroundColor) {
          shapeProperties.shapeBackgroundFill = {
            solidFill: {
              color: {
                rgbColor: {
                  red: args.backgroundColor.red || 0,
                  green: args.backgroundColor.green || 0,
                  blue: args.backgroundColor.blue || 0
                }
              },
              alpha: args.backgroundColor.alpha || 1
            }
          };
          fields.push('shapeBackgroundFill');
        }

        const outline: any = {};
        let hasOutlineChanges = false;

        if (args.outlineColor) {
          outline.outlineFill = {
            solidFill: {
              color: {
                rgbColor: {
                  red: args.outlineColor.red || 0,
                  green: args.outlineColor.green || 0,
                  blue: args.outlineColor.blue || 0
                }
              }
            }
          };
          hasOutlineChanges = true;
        }

        if (args.outlineWeight !== undefined) {
          outline.weight = {
            magnitude: args.outlineWeight,
            unit: 'PT'
          };
          hasOutlineChanges = true;
        }

        if (args.outlineDashStyle !== undefined) {
          outline.dashStyle = args.outlineDashStyle;
          hasOutlineChanges = true;
        }

        if (hasOutlineChanges) {
          shapeProperties.outline = outline;
          fields.push('outline');
        }

        if (fields.length === 0) {
          return errorResponse("No styling options specified");
        }

        await slidesService.presentations.batchUpdate({
          presentationId: args.presentationId,
          requestBody: {
            requests: [{
              updateShapeProperties: {
                objectId: args.objectId,
                shapeProperties,
                fields: fields.join(',')
              }
            }]
          }
        });

        return {
          content: [{ type: "text", text: `Applied styling to shape ${args.objectId}` }],
          isError: false
        };
      }

      case "setGoogleSlidesBackground": {
        const validation = SetGoogleSlidesBackgroundSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        const slidesService = google.slides({ version: 'v1', auth: authClient });
        const requests = args.pageObjectIds.map(pageObjectId => ({
          updatePageProperties: {
            objectId: pageObjectId,
            pageProperties: {
              pageBackgroundFill: {
                solidFill: {
                  color: {
                    rgbColor: {
                      red: args.backgroundColor.red || 0,
                      green: args.backgroundColor.green || 0,
                      blue: args.backgroundColor.blue || 0
                    }
                  },
                  alpha: args.backgroundColor.alpha || 1
                }
              }
            },
            fields: 'pageBackgroundFill'
          }
        }));

        await slidesService.presentations.batchUpdate({
          presentationId: args.presentationId,
          requestBody: { requests }
        });

        return {
          content: [{ type: "text", text: `Set background color for ${args.pageObjectIds.length} slide(s)` }],
          isError: false
        };
      }

      case "createGoogleSlidesTextBox": {
        const validation = CreateGoogleSlidesTextBoxSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        const slidesService = google.slides({ version: 'v1', auth: authClient });
        const elementId = `textBox_${uuidv4().substring(0, 8)}`;

        const requests: any[] = [
          {
            createShape: {
              objectId: elementId,
              shapeType: 'TEXT_BOX',
              elementProperties: {
                pageObjectId: args.pageObjectId,
                size: {
                  width: { magnitude: args.width, unit: 'EMU' },
                  height: { magnitude: args.height, unit: 'EMU' }
                },
                transform: {
                  scaleX: 1,
                  scaleY: 1,
                  translateX: args.x,
                  translateY: args.y,
                  unit: 'EMU'
                }
              }
            }
          },
          {
            insertText: {
              objectId: elementId,
              text: args.text,
              insertionIndex: 0
            }
          }
        ];

        // Apply optional formatting
        if (args.fontSize || args.bold || args.italic) {
          const textStyle: any = {};
          const fields: string[] = [];

          if (args.fontSize) {
            textStyle.fontSize = {
              magnitude: args.fontSize,
              unit: 'PT'
            };
            fields.push('fontSize');
          }

          if (args.bold !== undefined) {
            textStyle.bold = args.bold;
            fields.push('bold');
          }

          if (args.italic !== undefined) {
            textStyle.italic = args.italic;
            fields.push('italic');
          }

          if (fields.length > 0) {
            requests.push({
              updateTextStyle: {
                objectId: elementId,
                style: textStyle,
                fields: fields.join(','),
                textRange: { type: 'ALL' }
              }
            });
          }
        }

        await slidesService.presentations.batchUpdate({
          presentationId: args.presentationId,
          requestBody: { requests }
        });

        return {
          content: [{ type: "text", text: `Created text box with ID: ${elementId}` }],
          isError: false
        };
      }

      case "createGoogleSlidesShape": {
        const validation = CreateGoogleSlidesShapeSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        const slidesService = google.slides({ version: 'v1', auth: authClient });
        const elementId = `shape_${uuidv4().substring(0, 8)}`;

        const createRequest: any = {
          createShape: {
            objectId: elementId,
            shapeType: args.shapeType,
            elementProperties: {
              pageObjectId: args.pageObjectId,
              size: {
                width: { magnitude: args.width, unit: 'EMU' },
                height: { magnitude: args.height, unit: 'EMU' }
              },
              transform: {
                scaleX: 1,
                scaleY: 1,
                translateX: args.x,
                translateY: args.y,
                unit: 'EMU'
              }
            }
          }
        };

        const requests = [createRequest];

        // Apply background color if specified
        if (args.backgroundColor) {
          requests.push({
            updateShapeProperties: {
              objectId: elementId,
              shapeProperties: {
                shapeBackgroundFill: {
                  solidFill: {
                    color: {
                      rgbColor: {
                        red: args.backgroundColor.red || 0,
                        green: args.backgroundColor.green || 0,
                        blue: args.backgroundColor.blue || 0
                      }
                    },
                    alpha: args.backgroundColor.alpha || 1
                  }
                }
              },
              fields: 'shapeBackgroundFill'
            }
          });
        }

        await slidesService.presentations.batchUpdate({
          presentationId: args.presentationId,
          requestBody: { requests }
        });

        return {
          content: [{ type: "text", text: `Created ${args.shapeType} shape with ID: ${elementId}` }],
          isError: false
        };
      }

      default:
        return errorResponse("Tool not found");
    }
  } catch (error) {
    log('Error in tool request handler', { error: (error as Error).message });
    return errorResponse((error as Error).message);
  }
});

// -----------------------------------------------------------------------------
// CLI FUNCTIONS
// -----------------------------------------------------------------------------

function showHelp(): void {
  console.log(`
Google Drive MCP Server v${VERSION}

Usage:
  npx @yourusername/google-drive-mcp [command]

Commands:
  auth     Run the authentication flow
  start    Start the MCP server (default)
  version  Show version information
  help     Show this help message

Examples:
  npx @yourusername/google-drive-mcp auth
  npx @yourusername/google-drive-mcp start
  npx @yourusername/google-drive-mcp version
  npx @yourusername/google-drive-mcp

Environment Variables:
  GOOGLE_DRIVE_OAUTH_CREDENTIALS   Path to OAuth credentials file
  GOOGLE_DRIVE_MCP_TOKEN_PATH      Path to store authentication tokens
`);
}

function showVersion(): void {
  console.log(`Google Drive MCP Server v${VERSION}`);
}

async function runAuthServer(): Promise<void> {
  try {
    // Initialize OAuth client
    const oauth2Client = await initializeOAuth2Client();

    // Create and start the auth server
    const authServerInstance = new AuthServer(oauth2Client);

    // Start with browser opening (true by default)
    const success = await authServerInstance.start(true);

    if (!success && !authServerInstance.authCompletedSuccessfully) {
      // Failed to start and tokens weren't already valid
      console.error(
        "Authentication failed. Could not start server or validate existing tokens. Check port availability (3000-3004) and try again."
      );
      process.exit(1);
    } else if (authServerInstance.authCompletedSuccessfully) {
      // Auth was successful (either existing tokens were valid or flow completed just now)
      console.log("Authentication successful.");
      process.exit(0); // Exit cleanly if auth is already done
    }

    // If we reach here, the server started and is waiting for the browser callback
    console.log(
      "Authentication server started. Please complete the authentication in your browser..."
    );

    // Wait for completion
    const intervalId = setInterval(async () => {
      if (authServerInstance.authCompletedSuccessfully) {
        clearInterval(intervalId);
        await authServerInstance.stop();
        console.log("Authentication completed successfully!");
        process.exit(0);
      }
    }, 1000);
  } catch (error) {
    console.error("Authentication failed:", error);
    process.exit(1);
  }
}

// -----------------------------------------------------------------------------
// MAIN EXECUTION
// -----------------------------------------------------------------------------

function parseCliArgs(): { command: string | undefined } {
  const args = process.argv.slice(2);
  let command: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    // Handle special version/help flags as commands
    if (arg === '--version' || arg === '-v' || arg === '--help' || arg === '-h') {
      command = arg;
      continue;
    }
    
    // Check for command (first non-option argument)
    if (!command && !arg.startsWith('--')) {
      command = arg;
      continue;
    }
  }

  return { command };
}

async function main() {
  const { command } = parseCliArgs();

  switch (command) {
    case "auth":
      await runAuthServer();
      break;
    case "start":
    case undefined:
      try {
        // Start the MCP server
        console.error("Starting Google Drive MCP server...");
        const transport = new StdioServerTransport();
        await server.connect(transport);
        log('Server started successfully');
        
        // Set up graceful shutdown
        process.on("SIGINT", async () => {
          await server.close();
          process.exit(0);
        });
        process.on("SIGTERM", async () => {
          await server.close();
          process.exit(0);
        });
      } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
      }
      break;
    case "version":
    case "--version":
    case "-v":
      showVersion();
      break;
    case "help":
    case "--help":
    case "-h":
      showHelp();
      break;
    default:
      console.error(`Unknown command: ${command}`);
      showHelp();
      process.exit(1);
  }
}

// Export server and main for testing or potential programmatic use
export { main, server };

// Run the CLI
main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});