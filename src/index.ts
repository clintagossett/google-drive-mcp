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

// Cache Infrastructure Constants (Issue #23)
const CHARACTER_LIMIT = 25000;  // Max characters before truncation
const CACHE_TTL_MS = 30 * 60 * 1000;  // 30 minutes cache TTL

// -----------------------------------------------------------------------------
// DOCUMENT CACHE (Issue #23 - Resource Cache Infrastructure)
// -----------------------------------------------------------------------------
interface CacheEntry {
  content: any;       // Original API response
  text: string;       // Extracted text content
  fetchedAt: number;  // Timestamp for TTL management
  type: 'doc' | 'sheet' | 'file';  // Resource type
}

const documentCache = new Map<string, CacheEntry>();

/**
 * Store content in cache with current timestamp
 */
function cacheStore(key: string, content: any, text: string, type: CacheEntry['type']): void {
  documentCache.set(key, {
    content,
    text,
    fetchedAt: Date.now(),
    type
  });
  log('Cache store', { key, textLength: text.length, type });
}

/**
 * Retrieve content from cache if not expired
 * Returns null if entry doesn't exist or is expired
 */
function cacheGet(key: string): CacheEntry | null {
  const entry = documentCache.get(key);
  if (!entry) {
    return null;
  }

  // Check TTL expiration
  if (Date.now() - entry.fetchedAt > CACHE_TTL_MS) {
    documentCache.delete(key);
    log('Cache expired', { key });
    return null;
  }

  return entry;
}

/**
 * Remove expired entries from cache (housekeeping)
 */
function cacheCleanup(): number {
  const now = Date.now();
  let removedCount = 0;

  for (const [key, entry] of documentCache.entries()) {
    if (now - entry.fetchedAt > CACHE_TTL_MS) {
      documentCache.delete(key);
      removedCount++;
    }
  }

  if (removedCount > 0) {
    log('Cache cleanup', { removedCount, remaining: documentCache.size });
  }

  return removedCount;
}

/**
 * Get cache statistics
 */
function cacheStats(): { size: number; entries: { key: string; type: string; age: number; textLength: number }[] } {
  const now = Date.now();
  const entries = Array.from(documentCache.entries()).map(([key, entry]) => ({
    key,
    type: entry.type,
    age: Math.round((now - entry.fetchedAt) / 1000), // age in seconds
    textLength: entry.text.length
  }));

  return {
    size: documentCache.size,
    entries
  };
}

// -----------------------------------------------------------------------------
// TRUNCATION HELPER (Issue #25)
// -----------------------------------------------------------------------------
interface TruncationResult {
  text: string;
  truncated: boolean;
  originalLength?: number;
}

/**
 * Truncate content with actionable message for agents
 *
 * @param content - The content to potentially truncate
 * @param options - Optional configuration
 * @param options.limit - Character limit (defaults to CHARACTER_LIMIT)
 * @param options.hint - Custom hint message for agents
 * @returns Object with truncated text and truncation status
 */
function truncateResponse(
  content: string,
  options?: {
    limit?: number;
    hint?: string;
  }
): TruncationResult {
  const limit = options?.limit ?? CHARACTER_LIMIT;

  if (content.length <= limit) {
    return { text: content, truncated: false };
  }

  const hint = options?.hint ??
    "Use returnMode: 'summary' or narrower parameters to manage response size.";

  return {
    text: content.slice(0, limit) +
      `\n\n--- TRUNCATED ---\n` +
      `Response truncated from ${content.length.toLocaleString()} to ${limit.toLocaleString()} characters.\n` +
      hint,
    truncated: true,
    originalLength: content.length
  };
}

// -----------------------------------------------------------------------------
// RESOURCE URI PARSER (Issue #23)
// -----------------------------------------------------------------------------
interface ParsedResourceUri {
  valid: boolean;
  type?: 'doc' | 'sheet' | 'file' | 'legacy';
  resourceId?: string;
  action?: 'content' | 'chunk' | 'structure' | 'values';
  params?: {
    start?: number;
    end?: number;
    range?: string;
  };
  error?: string;
}

/**
 * Parse gdrive:// URIs into structured components
 *
 * Supported patterns:
 * - gdrive:///{fileId}                         → legacy (original format)
 * - gdrive://docs/{docId}/content              → full cached doc text
 * - gdrive://docs/{docId}/chunk/{start}-{end}  → doc text slice
 * - gdrive://docs/{docId}/structure            → doc headings/sections
 * - gdrive://sheets/{id}/values/{range}        → sheet cell values
 * - gdrive://files/{id}/content/{start}-{end}  → exported file content
 */
function parseResourceUri(uri: string): ParsedResourceUri {
  // Legacy format: gdrive:///{fileId}
  if (uri.startsWith('gdrive:///')) {
    const fileId = uri.replace('gdrive:///', '');
    if (!fileId) {
      return { valid: false, error: 'Empty file ID in legacy URI' };
    }
    return { valid: true, type: 'legacy', resourceId: fileId };
  }

  // New format: gdrive://{type}/{id}/{action}[/{params}]
  if (!uri.startsWith('gdrive://')) {
    return { valid: false, error: 'Invalid URI scheme - must start with gdrive://' };
  }

  const path = uri.substring('gdrive://'.length);
  const segments = path.split('/');

  if (segments.length < 2) {
    return { valid: false, error: 'URI must have at least type and resource ID' };
  }

  const resourceType = segments[0];
  const resourceId = segments[1];
  const action = segments[2];
  const actionParams = segments[3];

  if (!resourceId) {
    return { valid: false, error: 'Missing resource ID' };
  }

  // Handle docs URIs
  if (resourceType === 'docs') {
    if (!action) {
      return { valid: false, error: 'Docs URI requires action: content, chunk, or structure' };
    }

    if (action === 'content') {
      return { valid: true, type: 'doc', resourceId, action: 'content' };
    }

    if (action === 'structure') {
      return { valid: true, type: 'doc', resourceId, action: 'structure' };
    }

    if (action === 'chunk') {
      if (!actionParams) {
        return { valid: false, error: 'Chunk action requires range parameter (e.g., 0-5000)' };
      }

      const rangeMatch = actionParams.match(/^(\d+)-(\d+)$/);
      if (!rangeMatch) {
        return { valid: false, error: 'Invalid chunk range format. Use: {start}-{end} (e.g., 0-5000)' };
      }

      const start = parseInt(rangeMatch[1], 10);
      const end = parseInt(rangeMatch[2], 10);

      if (start < 0) {
        return { valid: false, error: 'Chunk start index cannot be negative' };
      }

      if (end <= start) {
        return { valid: false, error: 'Chunk end index must be greater than start index' };
      }

      return { valid: true, type: 'doc', resourceId, action: 'chunk', params: { start, end } };
    }

    return { valid: false, error: `Unknown docs action: ${action}. Valid actions: content, chunk, structure` };
  }

  // Handle sheets URIs
  if (resourceType === 'sheets') {
    if (action !== 'values') {
      return { valid: false, error: 'Sheets URI requires "values" action with range parameter' };
    }

    if (!actionParams) {
      return { valid: false, error: 'Sheets values action requires range parameter (e.g., Sheet1!A1:B10)' };
    }

    // URL decode the range (it may be encoded)
    const range = decodeURIComponent(actionParams);

    return { valid: true, type: 'sheet', resourceId, action: 'values', params: { range } };
  }

  // Handle files URIs
  if (resourceType === 'files') {
    if (action !== 'content') {
      return { valid: false, error: 'Files URI requires "content" action' };
    }

    if (!actionParams) {
      // Full content without range
      return { valid: true, type: 'file', resourceId, action: 'content' };
    }

    const rangeMatch = actionParams.match(/^(\d+)-(\d+)$/);
    if (!rangeMatch) {
      return { valid: false, error: 'Invalid content range format. Use: {start}-{end} (e.g., 0-5000)' };
    }

    const start = parseInt(rangeMatch[1], 10);
    const end = parseInt(rangeMatch[2], 10);

    if (start < 0) {
      return { valid: false, error: 'Content start index cannot be negative' };
    }

    if (end <= start) {
      return { valid: false, error: 'Content end index must be greater than start index' };
    }

    return { valid: true, type: 'file', resourceId, action: 'content', params: { start, end } };
  }

  return { valid: false, error: `Unknown resource type: ${resourceType}. Valid types: docs, sheets, files` };
}

/**
 * Serve cached content based on parsed URI
 * Returns null if cache miss, content string if hit
 */
function serveCachedContent(parsed: ParsedResourceUri): { content: string | null; error?: string; hint?: string } {
  if (!parsed.valid || !parsed.resourceId) {
    return { content: null, error: parsed.error };
  }

  // Legacy URIs don't use the cache
  if (parsed.type === 'legacy') {
    return { content: null, hint: 'Legacy URI format - use standard resource fetch' };
  }

  const cacheKey = parsed.resourceId;
  const entry = cacheGet(cacheKey);

  if (!entry) {
    return {
      content: null,
      error: `Cache miss for resource: ${cacheKey}`,
      hint: `First fetch the document using the appropriate tool (e.g., docs_getDocument) to populate the cache.`
    };
  }

  // Handle different actions
  if (parsed.action === 'content') {
    return { content: entry.text };
  }

  if (parsed.action === 'chunk') {
    const start = parsed.params?.start ?? 0;
    const end = parsed.params?.end ?? entry.text.length;

    // Clamp to actual content length
    const clampedEnd = Math.min(end, entry.text.length);
    const chunk = entry.text.slice(start, clampedEnd);

    return { content: chunk };
  }

  if (parsed.action === 'structure') {
    // For now, return a placeholder - full implementation in Issue #24
    return {
      content: null,
      error: 'Structure extraction not yet implemented',
      hint: 'Use content or chunk actions to access document text'
    };
  }

  if (parsed.action === 'values') {
    // Sheet values require specific range handling - placeholder for now
    return {
      content: null,
      error: 'Sheet values extraction not yet implemented',
      hint: 'Use sheets_batchGetValues tool to fetch specific ranges'
    };
  }

  return { content: null, error: `Unknown action: ${parsed.action}` };
}
// Global auth client - will be initialized on first use
let authClient: any = null;
let authenticationPromise: Promise<any> | null = null;

// Get package version
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageJsonPath = join(__dirname, '..', 'package.json');
const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
const VERSION = packageJson.version;

// Server start time for uptime tracking
const SERVER_START_TIME = Date.now();

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

// -----------------------------------------------------------------------------
// INPUT VALIDATION SCHEMAS
// -----------------------------------------------------------------------------

// Server Info Schema
const ServerGetInfoSchema = z.object({
  includeUptime: z.boolean().optional().default(false)
});

// Phase 1: Essential Drive API Operations - 1:1 Mappings
// Maps to files.create in Google Drive API v3
const DriveCreateFileSchema = z.object({
  name: z.string().min(1, "File name is required"),
  mimeType: z.string().min(1, "MIME type is required"),
  parents: z.array(z.string()).optional(),
  description: z.string().optional(),
  properties: z.record(z.string()).optional(),
  supportsAllDrives: z.boolean().optional()
});

// Maps to files.get in Google Drive API v3
const DriveGetFileSchema = z.object({
  fileId: z.string().min(1, "File ID is required"),
  fields: z.string().optional(),
  supportsAllDrives: z.boolean().optional(),
  includeTrashed: z.boolean().optional()
});

// Maps to files.update in Google Drive API v3
const DriveUpdateFileSchema = z.object({
  fileId: z.string().min(1, "File ID is required"),
  name: z.string().optional(),
  mimeType: z.string().optional(),
  parents: z.array(z.string()).optional(),
  trashed: z.boolean().optional(),
  description: z.string().optional(),
  properties: z.record(z.string()).optional(),
  supportsAllDrives: z.boolean().optional()
});

// Maps to files.delete in Google Drive API v3
const DriveDeleteFileSchema = z.object({
  fileId: z.string().min(1, "File ID is required"),
  supportsAllDrives: z.boolean().optional()
});

// Maps to files.list in Google Drive API v3
const DriveListFilesSchema = z.object({
  q: z.string().optional(),
  pageSize: z.number().min(1).max(1000).optional(),
  pageToken: z.string().optional(),
  orderBy: z.string().optional(),
  fields: z.string().optional(),
  spaces: z.string().optional(),
  corpora: z.string().optional(),
  includeItemsFromAllDrives: z.boolean().optional(),
  supportsAllDrives: z.boolean().optional(),
  includeTrashed: z.boolean().optional()
});

// Phase 2: File Utilities - 1:1 Mappings
// Maps to files.copy in Google Drive API v3
const DriveCopyFileSchema = z.object({
  fileId: z.string().min(1, "File ID is required"),
  name: z.string().optional(),
  parents: z.array(z.string()).optional(),
  description: z.string().optional(),
  properties: z.record(z.string()).optional(),
  supportsAllDrives: z.boolean().optional()
});

// Maps to files.export in Google Drive API v3
const DriveExportFileSchema = z.object({
  fileId: z.string().min(1, "File ID is required"),
  mimeType: z.string().min(1, "Export MIME type is required"),
  supportsAllDrives: z.boolean().optional(),
  returnMode: z.enum(["summary", "full"]).default("summary")
    .describe("'summary' (default): Returns metadata + resource URI, caches content. 'full': Returns complete response with truncation")
});

// Phase 3: Comments & Collaboration - 1:1 Mappings
// Maps to comments.create in Google Drive API v3
const DriveCreateCommentSchema = z.object({
  fileId: z.string().min(1, "File ID is required"),
  content: z.string().min(1, "Comment content is required"),
  anchor: z.string().optional(),
  quotedFileContent: z.object({
    mimeType: z.string(),
    value: z.string()
  }).optional()
});

// Maps to comments.list in Google Drive API v3
const DriveListCommentsSchema = z.object({
  fileId: z.string().min(1, "File ID is required"),
  pageSize: z.number().min(1).max(100).optional(),
  pageToken: z.string().optional(),
  includeDeleted: z.boolean().optional(),
  startModifiedTime: z.string().optional()
});

// Maps to comments.get in Google Drive API v3
const DriveGetCommentSchema = z.object({
  fileId: z.string().min(1, "File ID is required"),
  commentId: z.string().min(1, "Comment ID is required"),
  includeDeleted: z.boolean().optional()
});

// Maps to comments.update in Google Drive API v3
const DriveUpdateCommentSchema = z.object({
  fileId: z.string().min(1, "File ID is required"),
  commentId: z.string().min(1, "Comment ID is required"),
  content: z.string().min(1, "Comment content is required")
});

// Maps to comments.delete in Google Drive API v3
const DriveDeleteCommentSchema = z.object({
  fileId: z.string().min(1, "File ID is required"),
  commentId: z.string().min(1, "Comment ID is required")
});

// Maps to replies.create in Google Drive API v3
const DriveCreateReplySchema = z.object({
  fileId: z.string().min(1, "File ID is required"),
  commentId: z.string().min(1, "Comment ID is required"),
  content: z.string().min(1, "Reply content is required"),
  action: z.enum(["resolve", "reopen"]).optional()
});

// Maps to replies.list in Google Drive API v3
const DriveListRepliesSchema = z.object({
  fileId: z.string().min(1, "File ID is required"),
  commentId: z.string().min(1, "Comment ID is required"),
  pageSize: z.number().min(1).max(100).optional(),
  pageToken: z.string().optional(),
  includeDeleted: z.boolean().optional()
});

// Maps to replies.get in Google Drive API v3
const DriveGetReplySchema = z.object({
  fileId: z.string().min(1, "File ID is required"),
  commentId: z.string().min(1, "Comment ID is required"),
  replyId: z.string().min(1, "Reply ID is required"),
  includeDeleted: z.boolean().optional()
});

// Maps to replies.update in Google Drive API v3
const DriveUpdateReplySchema = z.object({
  fileId: z.string().min(1, "File ID is required"),
  commentId: z.string().min(1, "Comment ID is required"),
  replyId: z.string().min(1, "Reply ID is required"),
  content: z.string().min(1, "Reply content is required"),
  action: z.enum(["resolve", "reopen"]).optional()
});

// Maps to replies.delete in Google Drive API v3
const DriveDeleteReplySchema = z.object({
  fileId: z.string().min(1, "File ID is required"),
  commentId: z.string().min(1, "Comment ID is required"),
  replyId: z.string().min(1, "Reply ID is required")
});

// Phase 4: Sharing & Permissions - 1:1 Mappings
// Maps to permissions.create in Google Drive API v3
const DriveCreatePermissionSchema = z.object({
  fileId: z.string().min(1, "File ID is required"),
  role: z.enum(["owner", "organizer", "fileOrganizer", "writer", "commenter", "reader"]),
  type: z.enum(["user", "group", "domain", "anyone"]),
  emailAddress: z.string().email().optional(),
  domain: z.string().optional(),
  sendNotificationEmail: z.boolean().optional(),
  emailMessage: z.string().optional(),
  supportsAllDrives: z.boolean().optional()
});

// Maps to permissions.list in Google Drive API v3
const DriveListPermissionsSchema = z.object({
  fileId: z.string().min(1, "File ID is required"),
  pageSize: z.number().min(1).max(100).optional(),
  pageToken: z.string().optional(),
  fields: z.string().optional(),
  supportsAllDrives: z.boolean().optional()
});

// Maps to permissions.get in Google Drive API v3
const DriveGetPermissionSchema = z.object({
  fileId: z.string().min(1, "File ID is required"),
  permissionId: z.string().min(1, "Permission ID is required"),
  fields: z.string().optional(),
  supportsAllDrives: z.boolean().optional()
});

// Maps to permissions.update in Google Drive API v3
const DriveUpdatePermissionSchema = z.object({
  fileId: z.string().min(1, "File ID is required"),
  permissionId: z.string().min(1, "Permission ID is required"),
  role: z.enum(["owner", "organizer", "fileOrganizer", "writer", "commenter", "reader"]),
  removeExpiration: z.boolean().optional(),
  transferOwnership: z.boolean().optional(),
  supportsAllDrives: z.boolean().optional()
});

// Maps to permissions.delete in Google Drive API v3
const DriveDeletePermissionSchema = z.object({
  fileId: z.string().min(1, "File ID is required"),
  permissionId: z.string().min(1, "Permission ID is required"),
  supportsAllDrives: z.boolean().optional()
});

// Authentication & Diagnostic Tools - Help users troubleshoot auth and permission issues

// Maps to about.get in Google Drive API v3
const AuthGetStatusSchema = z.object({
  fields: z.string().optional() // Default: 'user,storageQuota'
});

// Maps to files.get in Google Drive API v3 with enhanced error handling
const AuthTestFileAccessSchema = z.object({
  fileId: z.string().min(1, "File ID is required"),
  fields: z.string().optional() // Default: 'id,name,mimeType,capabilities,permissions'
});

// Shows granted OAuth scopes from current token
const AuthListScopesSchema = z.object({
  // No parameters needed - reads from current auth token
});

// Clear authentication tokens and force re-authentication
const AuthClearTokensSchema = z.object({
  // No parameters needed
});

// Comprehensive RepeatCellRequest schema - replaces formatGoogleSheetCells, formatGoogleSheetText, formatGoogleSheetNumbers
const SheetsRepeatCellSchema = z.object({
  spreadsheetId: z.string().min(1, "Spreadsheet ID is required"),
  range: z.string().min(1, "Range is required"),
  // Cell format fields (backgroundColor, alignment, wrap)
  backgroundColor: z.object({
    red: z.number().min(0).max(1).optional(),
    green: z.number().min(0).max(1).optional(),
    blue: z.number().min(0).max(1).optional()
  }).optional(),
  horizontalAlignment: z.enum(["LEFT", "CENTER", "RIGHT"]).optional(),
  verticalAlignment: z.enum(["TOP", "MIDDLE", "BOTTOM"]).optional(),
  wrapStrategy: z.enum(["OVERFLOW_CELL", "CLIP", "WRAP"]).optional(),
  // Text format fields (bold, italic, font, color)
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
  }).optional(),
  // Number format fields (pattern, type)
  numberFormatPattern: z.string().optional(),
  numberFormatType: z.enum(["NUMBER", "CURRENCY", "PERCENT", "DATE", "TIME", "DATE_TIME", "SCIENTIFIC"]).optional()
});

// Maps to UpdateBordersRequest in Google Sheets API
const SheetsUpdateBordersSchema = z.object({
  spreadsheetId: z.string().min(1, "Spreadsheet ID is required"),
  range: z.string().min(1, "Range is required (e.g., 'A1:C10')"),
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

// Maps to MergeCellsRequest in Google Sheets API
const SheetsMergeCellsSchema = z.object({
  spreadsheetId: z.string().min(1, "Spreadsheet ID is required"),
  range: z.string().min(1, "Range is required (e.g., 'A1:C3')"),
  mergeType: z.enum(["MERGE_ALL", "MERGE_COLUMNS", "MERGE_ROWS"])
});

// Maps to AddConditionalFormatRuleRequest in Google Sheets API
const SheetsAddConditionalFormatRuleSchema = z.object({
  spreadsheetId: z.string().min(1, "Spreadsheet ID is required"),
  range: z.string().min(1, "Range is required (e.g., 'A1:C10')"),
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

// Phase 1: Core Data Operations - Thin Layer Schemas
const SheetsGetSpreadsheetSchema = z.object({
  spreadsheetId: z.string().min(1, "Spreadsheet ID is required"),
  ranges: z.array(z.string()).optional(),
  includeGridData: z.boolean().optional(),
  returnMode: z.enum(["summary", "full"]).default("summary")
    .describe("'summary' (default): Returns metadata + resource URI, caches content. 'full': Returns complete response with truncation")
});

const SheetsCreateSpreadsheetSchema = z.object({
  title: z.string().min(1, "Title is required"),
  locale: z.string().optional(),
  autoRecalc: z.enum(["ON_CHANGE", "MINUTE", "HOUR"]).optional(),
  timeZone: z.string().optional()
});

const SheetsAppendValuesSchema = z.object({
  spreadsheetId: z.string().min(1, "Spreadsheet ID is required"),
  range: z.string().min(1, "Range is required"),
  values: z.array(z.array(z.string())),
  valueInputOption: z.enum(["RAW", "USER_ENTERED"]).default("USER_ENTERED"),
  insertDataOption: z.enum(["OVERWRITE", "INSERT_ROWS"]).optional()
});

const SheetsClearValuesSchema = z.object({
  spreadsheetId: z.string().min(1, "Spreadsheet ID is required"),
  range: z.string().min(1, "Range is required")
});

const SheetsBatchGetValuesSchema = z.object({
  spreadsheetId: z.string().min(1, "Spreadsheet ID is required"),
  ranges: z.array(z.string()).min(1, "At least one range is required"),
  majorDimension: z.enum(["ROWS", "COLUMNS"]).optional(),
  valueRenderOption: z.enum(["FORMATTED_VALUE", "UNFORMATTED_VALUE", "FORMULA"]).optional(),
  returnMode: z.enum(["summary", "full"]).default("summary")
    .describe("'summary' (default): Returns metadata + resource URI, caches content. 'full': Returns complete response with truncation")
});

const SheetsBatchUpdateValuesSchema = z.object({
  spreadsheetId: z.string().min(1, "Spreadsheet ID is required"),
  valueInputOption: z.enum(["RAW", "USER_ENTERED"]).default("USER_ENTERED"),
  data: z.array(z.object({
    range: z.string(),
    values: z.array(z.array(z.string()))
  })).min(1, "At least one range update is required")
});

const SheetsBatchClearValuesSchema = z.object({
  spreadsheetId: z.string().min(1, "Spreadsheet ID is required"),
  ranges: z.array(z.string()).min(1, "At least one range is required")
});

const SheetsAddSheetSchema = z.object({
  spreadsheetId: z.string().min(1, "Spreadsheet ID is required"),
  title: z.string().min(1, "Sheet title is required"),
  index: z.number().int().min(0).optional(),
  sheetType: z.enum(["GRID", "OBJECT"]).optional(),
  gridRowCount: z.number().int().min(1).optional(),
  gridColumnCount: z.number().int().min(1).optional(),
  frozenRowCount: z.number().int().min(0).optional(),
  frozenColumnCount: z.number().int().min(0).optional(),
  hidden: z.boolean().optional(),
  tabColorRed: z.number().min(0).max(1).optional(),
  tabColorGreen: z.number().min(0).max(1).optional(),
  tabColorBlue: z.number().min(0).max(1).optional(),
  rightToLeft: z.boolean().optional()
});

const SheetsDeleteSheetSchema = z.object({
  spreadsheetId: z.string().min(1, "Spreadsheet ID is required"),
  sheetId: z.number().int().min(0, "Sheet ID is required")
});

const SheetsUpdateSheetPropertiesSchema = z.object({
  spreadsheetId: z.string().min(1, "Spreadsheet ID is required"),
  sheetId: z.number().int().min(0, "Sheet ID is required"),
  title: z.string().optional(),
  index: z.number().int().min(0).optional(),
  hidden: z.boolean().optional(),
  tabColorRed: z.number().min(0).max(1).optional(),
  tabColorGreen: z.number().min(0).max(1).optional(),
  tabColorBlue: z.number().min(0).max(1).optional(),
  frozenRowCount: z.number().int().min(0).optional(),
  frozenColumnCount: z.number().int().min(0).optional(),
  rightToLeft: z.boolean().optional()
});

// ========================================
// Phase 2: Row/Column/Range Operations Schemas
// ========================================

const SheetsInsertDimensionSchema = z.object({
  spreadsheetId: z.string().min(1, "Spreadsheet ID is required"),
  sheetId: z.number().int().min(0, "Sheet ID is required"),
  dimension: z.enum(["ROWS", "COLUMNS"], {
    errorMap: () => ({ message: "Dimension must be ROWS or COLUMNS" })
  }),
  startIndex: z.number().int().min(0, "Start index must be non-negative"),
  endIndex: z.number().int().min(0, "End index must be non-negative"),
  inheritFromBefore: z.boolean().optional()
}).refine(data => data.endIndex > data.startIndex, {
  message: "End index must be greater than start index"
});

const SheetsDeleteDimensionSchema = z.object({
  spreadsheetId: z.string().min(1, "Spreadsheet ID is required"),
  sheetId: z.number().int().min(0, "Sheet ID is required"),
  dimension: z.enum(["ROWS", "COLUMNS"], {
    errorMap: () => ({ message: "Dimension must be ROWS or COLUMNS" })
  }),
  startIndex: z.number().int().min(0, "Start index must be non-negative"),
  endIndex: z.number().int().min(0, "End index must be non-negative")
}).refine(data => data.endIndex > data.startIndex, {
  message: "End index must be greater than start index"
});

const SheetsMoveDimensionSchema = z.object({
  spreadsheetId: z.string().min(1, "Spreadsheet ID is required"),
  sheetId: z.number().int().min(0, "Sheet ID is required"),
  dimension: z.enum(["ROWS", "COLUMNS"], {
    errorMap: () => ({ message: "Dimension must be ROWS or COLUMNS" })
  }),
  startIndex: z.number().int().min(0, "Start index must be non-negative"),
  endIndex: z.number().int().min(0, "End index must be non-negative"),
  destinationIndex: z.number().int().min(0, "Destination index must be non-negative")
}).refine(data => data.endIndex > data.startIndex, {
  message: "End index must be greater than start index"
});

const SheetsUpdateDimensionPropertiesSchema = z.object({
  spreadsheetId: z.string().min(1, "Spreadsheet ID is required"),
  sheetId: z.number().int().min(0, "Sheet ID is required"),
  dimension: z.enum(["ROWS", "COLUMNS"], {
    errorMap: () => ({ message: "Dimension must be ROWS or COLUMNS" })
  }),
  startIndex: z.number().int().min(0, "Start index must be non-negative"),
  endIndex: z.number().int().min(0, "End index must be non-negative"),
  pixelSize: z.number().int().min(1, "Pixel size must be at least 1").optional(),
  hiddenByUser: z.boolean().optional()
}).refine(data => data.endIndex > data.startIndex, {
  message: "End index must be greater than start index"
}).refine(data => data.pixelSize !== undefined || data.hiddenByUser !== undefined, {
  message: "At least one property (pixelSize or hiddenByUser) must be specified"
});

const SheetsAppendDimensionSchema = z.object({
  spreadsheetId: z.string().min(1, "Spreadsheet ID is required"),
  sheetId: z.number().int().min(0, "Sheet ID is required"),
  dimension: z.enum(["ROWS", "COLUMNS"], {
    errorMap: () => ({ message: "Dimension must be ROWS or COLUMNS" })
  }),
  length: z.number().int().min(1, "Length must be at least 1")
});

const SheetsInsertRangeSchema = z.object({
  spreadsheetId: z.string().min(1, "Spreadsheet ID is required"),
  sheetId: z.number().int().min(0, "Sheet ID is required"),
  startRowIndex: z.number().int().min(0, "Start row index must be non-negative"),
  endRowIndex: z.number().int().min(0, "End row index must be non-negative"),
  startColumnIndex: z.number().int().min(0, "Start column index must be non-negative"),
  endColumnIndex: z.number().int().min(0, "End column index must be non-negative"),
  shiftDimension: z.enum(["ROWS", "COLUMNS"], {
    errorMap: () => ({ message: "Shift dimension must be ROWS or COLUMNS" })
  })
}).refine(data => data.endRowIndex > data.startRowIndex, {
  message: "End row index must be greater than start row index"
}).refine(data => data.endColumnIndex > data.startColumnIndex, {
  message: "End column index must be greater than start column index"
});

const SheetsDeleteRangeSchema = z.object({
  spreadsheetId: z.string().min(1, "Spreadsheet ID is required"),
  sheetId: z.number().int().min(0, "Sheet ID is required"),
  startRowIndex: z.number().int().min(0, "Start row index must be non-negative"),
  endRowIndex: z.number().int().min(0, "End row index must be non-negative"),
  startColumnIndex: z.number().int().min(0, "Start column index must be non-negative"),
  endColumnIndex: z.number().int().min(0, "End column index must be non-negative"),
  shiftDimension: z.enum(["ROWS", "COLUMNS"], {
    errorMap: () => ({ message: "Shift dimension must be ROWS or COLUMNS" })
  })
}).refine(data => data.endRowIndex > data.startRowIndex, {
  message: "End row index must be greater than start row index"
}).refine(data => data.endColumnIndex > data.startColumnIndex, {
  message: "End column index must be greater than start column index"
});

const SheetsCopyPasteSchema = z.object({
  spreadsheetId: z.string().min(1, "Spreadsheet ID is required"),
  sourceSheetId: z.number().int().min(0, "Source sheet ID is required"),
  sourceStartRowIndex: z.number().int().min(0, "Source start row index must be non-negative"),
  sourceEndRowIndex: z.number().int().min(0, "Source end row index must be non-negative"),
  sourceStartColumnIndex: z.number().int().min(0, "Source start column index must be non-negative"),
  sourceEndColumnIndex: z.number().int().min(0, "Source end column index must be non-negative"),
  destinationSheetId: z.number().int().min(0, "Destination sheet ID is required"),
  destinationStartRowIndex: z.number().int().min(0, "Destination start row index must be non-negative"),
  destinationEndRowIndex: z.number().int().min(0, "Destination end row index must be non-negative"),
  destinationStartColumnIndex: z.number().int().min(0, "Destination start column index must be non-negative"),
  destinationEndColumnIndex: z.number().int().min(0, "Destination end column index must be non-negative"),
  pasteType: z.enum(["PASTE_NORMAL", "PASTE_VALUES", "PASTE_FORMAT", "PASTE_NO_BORDERS", "PASTE_FORMULA", "PASTE_DATA_VALIDATION", "PASTE_CONDITIONAL_FORMATTING"]).optional(),
  pasteOrientation: z.enum(["NORMAL", "TRANSPOSE"]).optional()
}).refine(data => data.sourceEndRowIndex > data.sourceStartRowIndex, {
  message: "Source end row index must be greater than source start row index"
}).refine(data => data.sourceEndColumnIndex > data.sourceStartColumnIndex, {
  message: "Source end column index must be greater than source start column index"
}).refine(data => data.destinationEndRowIndex > data.destinationStartRowIndex, {
  message: "Destination end row index must be greater than destination start row index"
}).refine(data => data.destinationEndColumnIndex > data.destinationStartColumnIndex, {
  message: "Destination end column index must be greater than destination start column index"
});

const SheetsCutPasteSchema = z.object({
  spreadsheetId: z.string().min(1, "Spreadsheet ID is required"),
  sourceSheetId: z.number().int().min(0, "Source sheet ID is required"),
  sourceStartRowIndex: z.number().int().min(0, "Source start row index must be non-negative"),
  sourceEndRowIndex: z.number().int().min(0, "Source end row index must be non-negative"),
  sourceStartColumnIndex: z.number().int().min(0, "Source start column index must be non-negative"),
  sourceEndColumnIndex: z.number().int().min(0, "Source end column index must be non-negative"),
  destinationSheetId: z.number().int().min(0, "Destination sheet ID is required"),
  destinationRowIndex: z.number().int().min(0, "Destination row index must be non-negative"),
  destinationColumnIndex: z.number().int().min(0, "Destination column index must be non-negative"),
  pasteType: z.enum(["PASTE_NORMAL", "PASTE_VALUES", "PASTE_FORMAT", "PASTE_NO_BORDERS", "PASTE_FORMULA", "PASTE_DATA_VALIDATION", "PASTE_CONDITIONAL_FORMATTING"]).optional()
}).refine(data => data.sourceEndRowIndex > data.sourceStartRowIndex, {
  message: "Source end row index must be greater than source start row index"
}).refine(data => data.sourceEndColumnIndex > data.sourceStartColumnIndex, {
  message: "Source end column index must be greater than source start column index"
});

const SheetsAutoResizeDimensionsSchema = z.object({
  spreadsheetId: z.string().min(1, "Spreadsheet ID is required"),
  sheetId: z.number().int().min(0, "Sheet ID is required"),
  dimension: z.enum(["ROWS", "COLUMNS"], {
    errorMap: () => ({ message: "Dimension must be ROWS or COLUMNS" })
  }),
  startIndex: z.number().int().min(0, "Start index must be non-negative"),
  endIndex: z.number().int().min(0, "End index must be non-negative")
}).refine(data => data.endIndex > data.startIndex, {
  message: "End index must be greater than start index"
});

// ========================================
// Phase 3: Advanced Formatting & Validation Schemas
// ========================================

const SheetsUnmergeCellsSchema = z.object({
  spreadsheetId: z.string().min(1, "Spreadsheet ID is required"),
  sheetId: z.number().int().min(0, "Sheet ID is required"),
  startRowIndex: z.number().int().min(0, "Start row index must be non-negative"),
  endRowIndex: z.number().int().min(0, "End row index must be non-negative"),
  startColumnIndex: z.number().int().min(0, "Start column index must be non-negative"),
  endColumnIndex: z.number().int().min(0, "End column index must be non-negative")
}).refine(data => data.endRowIndex > data.startRowIndex, {
  message: "End row index must be greater than start row index"
}).refine(data => data.endColumnIndex > data.startColumnIndex, {
  message: "End column index must be greater than start column index"
});

// ========================================
// Phase 4: Named Ranges, Sorting & Filtering Schemas
// ========================================

const SheetsAddNamedRangeSchema = z.object({
  spreadsheetId: z.string().min(1, "Spreadsheet ID is required"),
  name: z.string().min(1, "Range name is required"),
  sheetId: z.number().int().min(0, "Sheet ID is required"),
  startRowIndex: z.number().int().min(0, "Start row index must be non-negative"),
  endRowIndex: z.number().int().min(0, "End row index must be non-negative"),
  startColumnIndex: z.number().int().min(0, "Start column index must be non-negative"),
  endColumnIndex: z.number().int().min(0, "End column index must be non-negative")
}).refine(data => data.endRowIndex > data.startRowIndex, {
  message: "End row index must be greater than start row index"
}).refine(data => data.endColumnIndex > data.startColumnIndex, {
  message: "End column index must be greater than start column index"
});

const SheetsDeleteNamedRangeSchema = z.object({
  spreadsheetId: z.string().min(1, "Spreadsheet ID is required"),
  namedRangeId: z.string().min(1, "Named range ID is required")
});

const SheetsSortRangeSchema = z.object({
  spreadsheetId: z.string().min(1, "Spreadsheet ID is required"),
  sheetId: z.number().int().min(0, "Sheet ID is required"),
  startRowIndex: z.number().int().min(0, "Start row index must be non-negative"),
  endRowIndex: z.number().int().min(0, "End row index must be non-negative"),
  startColumnIndex: z.number().int().min(0, "Start column index must be non-negative"),
  endColumnIndex: z.number().int().min(0, "End column index must be non-negative"),
  sortSpecs: z.array(z.object({
    dimensionIndex: z.number().int().min(0, "Dimension index must be non-negative"),
    sortOrder: z.enum(["ASCENDING", "DESCENDING"], {
      errorMap: () => ({ message: "Sort order must be ASCENDING or DESCENDING" })
    })
  })).min(1, "At least one sort specification is required")
}).refine(data => data.endRowIndex > data.startRowIndex, {
  message: "End row index must be greater than start row index"
}).refine(data => data.endColumnIndex > data.startColumnIndex, {
  message: "End column index must be greater than start column index"
});

const SheetsSetBasicFilterSchema = z.object({
  spreadsheetId: z.string().min(1, "Spreadsheet ID is required"),
  sheetId: z.number().int().min(0, "Sheet ID is required"),
  startRowIndex: z.number().int().min(0, "Start row index must be non-negative"),
  endRowIndex: z.number().int().min(0, "End row index must be non-negative"),
  startColumnIndex: z.number().int().min(0, "Start column index must be non-negative"),
  endColumnIndex: z.number().int().min(0, "End column index must be non-negative")
}).refine(data => data.endRowIndex > data.startRowIndex, {
  message: "End row index must be greater than start row index"
}).refine(data => data.endColumnIndex > data.startColumnIndex, {
  message: "End column index must be greater than start column index"
});

const SheetsClearBasicFilterSchema = z.object({
  spreadsheetId: z.string().min(1, "Spreadsheet ID is required"),
  sheetId: z.number().int().min(0, "Sheet ID is required")
});

const SheetsFindReplaceSchema = z.object({
  spreadsheetId: z.string().min(1, "Spreadsheet ID is required"),
  find: z.string().min(1, "Find text is required"),
  replacement: z.string(),
  matchCase: z.boolean().optional(),
  matchEntireCell: z.boolean().optional(),
  searchByRegex: z.boolean().optional(),
  includeFormulas: z.boolean().optional(),
  sheetId: z.number().int().min(0).optional(),
  startRowIndex: z.number().int().min(0).optional(),
  endRowIndex: z.number().int().min(0).optional(),
  startColumnIndex: z.number().int().min(0).optional(),
  endColumnIndex: z.number().int().min(0).optional(),
  allSheets: z.boolean().optional()
});

// ========================================
// Phase 5: Advanced Operations Schemas
// ========================================

const SheetsTextToColumnsSchema = z.object({
  spreadsheetId: z.string().min(1, "Spreadsheet ID is required"),
  sheetId: z.number().int().min(0, "Sheet ID is required"),
  startRowIndex: z.number().int().min(0, "Start row index must be non-negative"),
  endRowIndex: z.number().int().min(0, "End row index must be non-negative"),
  startColumnIndex: z.number().int().min(0, "Start column index must be non-negative"),
  endColumnIndex: z.number().int().min(0, "End column index must be non-negative"),
  delimiterType: z.enum(["COMMA", "SEMICOLON", "PERIOD", "SPACE", "CUSTOM", "AUTODETECT"], {
    errorMap: () => ({ message: "Invalid delimiter type" })
  }),
  delimiter: z.string().optional()
}).refine(data => data.endRowIndex > data.startRowIndex, {
  message: "End row index must be greater than start row index"
}).refine(data => data.endColumnIndex > data.startColumnIndex, {
  message: "End column index must be greater than start column index"
});

const SheetsTrimWhitespaceSchema = z.object({
  spreadsheetId: z.string().min(1, "Spreadsheet ID is required"),
  sheetId: z.number().int().min(0, "Sheet ID is required"),
  startRowIndex: z.number().int().min(0, "Start row index must be non-negative"),
  endRowIndex: z.number().int().min(0, "End row index must be non-negative"),
  startColumnIndex: z.number().int().min(0, "Start column index must be non-negative"),
  endColumnIndex: z.number().int().min(0, "End column index must be non-negative")
}).refine(data => data.endRowIndex > data.startRowIndex, {
  message: "End row index must be greater than start row index"
}).refine(data => data.endColumnIndex > data.startColumnIndex, {
  message: "End column index must be greater than start column index"
});

const SheetsDeleteDuplicatesSchema = z.object({
  spreadsheetId: z.string().min(1, "Spreadsheet ID is required"),
  sheetId: z.number().int().min(0, "Sheet ID is required"),
  startRowIndex: z.number().int().min(0, "Start row index must be non-negative"),
  endRowIndex: z.number().int().min(0, "End row index must be non-negative"),
  startColumnIndex: z.number().int().min(0, "Start column index must be non-negative"),
  endColumnIndex: z.number().int().min(0, "End column index must be non-negative"),
  comparisonColumns: z.array(z.object({
    sheetId: z.number().int().min(0, "Sheet ID is required"),
    dimension: z.enum(["ROWS", "COLUMNS"], {
      errorMap: () => ({ message: "Dimension must be ROWS or COLUMNS" })
    }),
    startIndex: z.number().int().min(0, "Start index must be non-negative"),
    endIndex: z.number().int().min(0, "End index must be non-negative")
  })).min(1, "At least one comparison column is required")
}).refine(data => data.endRowIndex > data.startRowIndex, {
  message: "End row index must be greater than start row index"
}).refine(data => data.endColumnIndex > data.startColumnIndex, {
  message: "End column index must be greater than start column index"
});

// Maps to UpdateTextStyleRequest in Google Docs API
const DocsUpdateTextStyleSchema = z.object({
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

// Maps to UpdateParagraphStyleRequest in Google Docs API
const DocsUpdateParagraphStyleSchema = z.object({
  documentId: z.string().min(1, "Document ID is required"),
  startIndex: z.number().min(1, "Start index must be at least 1"),
  endIndex: z.number().min(1, "End index must be at least 1"),
  namedStyleType: z.enum(['NORMAL_TEXT', 'TITLE', 'SUBTITLE', 'HEADING_1', 'HEADING_2', 'HEADING_3', 'HEADING_4', 'HEADING_5', 'HEADING_6']).optional(),
  alignment: z.enum(['START', 'CENTER', 'END', 'JUSTIFIED']).optional(),
  lineSpacing: z.number().optional(),
  spaceAbove: z.number().optional(),
  spaceBelow: z.number().optional()
});

// Google Slides Formatting Schemas

const SlidesUpdateTextStyleSchema = z.object({
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

const SlidesUpdateParagraphStyleSchema = z.object({
  presentationId: z.string().min(1, "Presentation ID is required"),
  objectId: z.string().min(1, "Object ID is required"),
  alignment: z.enum(['START', 'CENTER', 'END', 'JUSTIFIED']).optional(),
  lineSpacing: z.number().optional(),
  bulletStyle: z.enum(['NONE', 'DISC', 'ARROW', 'SQUARE', 'DIAMOND', 'STAR', 'NUMBERED']).optional()
});

const SlidesUpdateShapePropertiesSchema = z.object({
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

const SlidesUpdatePagePropertiesSchema = z.object({
  presentationId: z.string().min(1, "Presentation ID is required"),
  pageObjectIds: z.array(z.string()).min(1, "At least one page object ID is required"),
  backgroundColor: z.object({
    red: z.number().min(0).max(1).optional(),
    green: z.number().min(0).max(1).optional(),
    blue: z.number().min(0).max(1).optional(),
    alpha: z.number().min(0).max(1).optional()
  })
});

const SlidesCreateTextBoxSchema = z.object({
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

const SlidesCreateShapeSchema = z.object({
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

const SlidesGetSchema = z.object({
  presentationId: z.string().min(1, "Presentation ID is required")
});

// Phase 1 Google Slides API Tools (Issue #7)
const SlidesCreatePresentationSchema = z.object({
  title: z.string().optional(),
  locale: z.string().optional(),
  pageSize: z.object({
    width: z.object({
      magnitude: z.number(),
      unit: z.enum(['EMU', 'PT'])
    }),
    height: z.object({
      magnitude: z.number(),
      unit: z.enum(['EMU', 'PT'])
    })
  }).optional()
});

const SlidesCreateSlideSchema = z.object({
  presentationId: z.string().min(1, "Presentation ID is required"),
  insertionIndex: z.number().min(0, "Insertion index must be at least 0").optional(),
  objectId: z.string().optional(),
  slideLayoutReference: z.object({
    predefinedLayout: z.string().optional(),
    layoutId: z.string().optional()
  }).optional(),
  placeholderIdMappings: z.array(z.object({
    layoutPlaceholder: z.object({
      type: z.string(),
      index: z.number().optional()
    }),
    objectId: z.string()
  })).optional()
});

const SlidesDeleteObjectSchema = z.object({
  presentationId: z.string().min(1, "Presentation ID is required"),
  objectId: z.string().min(1, "Object ID is required")
});

const SlidesUpdateSlidesPositionSchema = z.object({
  presentationId: z.string().min(1, "Presentation ID is required"),
  slideObjectIds: z.array(z.string().min(1)).min(1, "At least one slide ID is required"),
  insertionIndex: z.number().min(0, "Insertion index must be at least 0")
});

const SlidesDuplicateObjectSchema = z.object({
  presentationId: z.string().min(1, "Presentation ID is required"),
  objectId: z.string().min(1, "Object ID is required"),
  objectIds: z.record(z.string()).optional()
});

const SlidesInsertTextSchema = z.object({
  presentationId: z.string().min(1, "Presentation ID is required"),
  objectId: z.string().min(1, "Object ID is required"),
  text: z.string(),
  insertionIndex: z.number().min(0, "Insertion index must be at least 0").optional(),
  cellLocation: z.object({
    rowIndex: z.number().min(0),
    columnIndex: z.number().min(0)
  }).optional()
});

const SlidesDeleteTextSchema = z.object({
  presentationId: z.string().min(1, "Presentation ID is required"),
  objectId: z.string().min(1, "Object ID is required"),
  textRange: z.object({
    startIndex: z.number().min(0, "Start index must be at least 0").optional(),
    endIndex: z.number().min(0, "End index must be at least 0").optional(),
    type: z.enum(['FIXED_RANGE', 'FROM_START_INDEX', 'ALL']).optional()
  }).optional(),
  cellLocation: z.object({
    rowIndex: z.number().min(0),
    columnIndex: z.number().min(0)
  }).optional()
});

const SlidesReplaceAllTextSchema = z.object({
  presentationId: z.string().min(1, "Presentation ID is required"),
  containsText: z.object({
    text: z.string().min(1, "Search text is required"),
    matchCase: z.boolean().optional()
  }),
  replaceText: z.string(),
  pageObjectIds: z.array(z.string()).optional()
});

const SlidesCreateParagraphBulletsSchema = z.object({
  presentationId: z.string().min(1, "Presentation ID is required"),
  objectId: z.string().min(1, "Object ID is required"),
  textRange: z.object({
    startIndex: z.number().min(0, "Start index must be at least 0").optional(),
    endIndex: z.number().min(0, "End index must be at least 0").optional(),
    type: z.enum(['FIXED_RANGE', 'FROM_START_INDEX', 'ALL']).optional()
  }).optional(),
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
    'NUMBERED_DIGIT_ALPHA_ROMAN',
    'NUMBERED_DIGIT_ALPHA_ROMAN_PARENS',
    'NUMBERED_DIGIT_NESTED',
    'NUMBERED_UPPERALPHA_ALPHA_ROMAN',
    'NUMBERED_UPPERROMAN_UPPERALPHA_DIGIT',
    'NUMBERED_ZERODECIMAL_ALPHA_ROMAN'
  ]).optional(),
  cellLocation: z.object({
    rowIndex: z.number().min(0),
    columnIndex: z.number().min(0)
  }).optional()
});

const SlidesUpdatePageElementTransformSchema = z.object({
  presentationId: z.string().min(1, "Presentation ID is required"),
  objectId: z.string().min(1, "Object ID is required"),
  transform: z.object({
    scaleX: z.number().optional(),
    scaleY: z.number().optional(),
    shearX: z.number().optional(),
    shearY: z.number().optional(),
    translateX: z.number().optional(),
    translateY: z.number().optional(),
    unit: z.enum(['EMU', 'PT']).optional()
  }),
  applyMode: z.enum(['RELATIVE', 'ABSOLUTE']).optional()
});

// Phase 2 Google Slides API Tools - Shape & Media Creation
const SlidesCreateImageSchema = z.object({
  presentationId: z.string().min(1, "Presentation ID is required"),
  pageObjectId: z.string().min(1, "Page object ID is required"),
  url: z.string().url("Valid image URL is required"),
  elementProperties: z.object({
    pageObjectId: z.string().optional(),
    size: z.object({
      width: z.object({ magnitude: z.number(), unit: z.enum(['EMU', 'PT']) }),
      height: z.object({ magnitude: z.number(), unit: z.enum(['EMU', 'PT']) })
    }).optional(),
    transform: z.object({
      scaleX: z.number().optional(),
      scaleY: z.number().optional(),
      translateX: z.number().optional(),
      translateY: z.number().optional(),
      unit: z.enum(['EMU', 'PT']).optional()
    }).optional()
  }).optional()
});

const SlidesCreateVideoSchema = z.object({
  presentationId: z.string().min(1, "Presentation ID is required"),
  pageObjectId: z.string().min(1, "Page object ID is required"),
  source: z.enum(['YOUTUBE', 'DRIVE']),
  id: z.string().min(1, "Video ID is required"),
  elementProperties: z.object({
    pageObjectId: z.string().optional(),
    size: z.object({
      width: z.object({ magnitude: z.number(), unit: z.enum(['EMU', 'PT']) }),
      height: z.object({ magnitude: z.number(), unit: z.enum(['EMU', 'PT']) })
    }).optional(),
    transform: z.object({
      scaleX: z.number().optional(),
      scaleY: z.number().optional(),
      translateX: z.number().optional(),
      translateY: z.number().optional(),
      unit: z.enum(['EMU', 'PT']).optional()
    }).optional()
  }).optional()
});

const SlidesCreateLineSchema = z.object({
  presentationId: z.string().min(1, "Presentation ID is required"),
  pageObjectId: z.string().min(1, "Page object ID is required"),
  lineCategory: z.enum(['STRAIGHT', 'BENT', 'CURVED']).optional(),
  elementProperties: z.object({
    pageObjectId: z.string().optional(),
    size: z.object({
      width: z.object({ magnitude: z.number(), unit: z.enum(['EMU', 'PT']) }),
      height: z.object({ magnitude: z.number(), unit: z.enum(['EMU', 'PT']) })
    }).optional(),
    transform: z.object({
      scaleX: z.number().optional(),
      scaleY: z.number().optional(),
      translateX: z.number().optional(),
      translateY: z.number().optional(),
      unit: z.enum(['EMU', 'PT']).optional()
    }).optional()
  }).optional()
});

const SlidesCreateTableSchema = z.object({
  presentationId: z.string().min(1, "Presentation ID is required"),
  pageObjectId: z.string().min(1, "Page object ID is required"),
  rows: z.number().min(1, "Must have at least 1 row"),
  columns: z.number().min(1, "Must have at least 1 column"),
  elementProperties: z.object({
    pageObjectId: z.string().optional(),
    size: z.object({
      width: z.object({ magnitude: z.number(), unit: z.enum(['EMU', 'PT']) }),
      height: z.object({ magnitude: z.number(), unit: z.enum(['EMU', 'PT']) })
    }).optional(),
    transform: z.object({
      scaleX: z.number().optional(),
      scaleY: z.number().optional(),
      translateX: z.number().optional(),
      translateY: z.number().optional(),
      unit: z.enum(['EMU', 'PT']).optional()
    }).optional()
  }).optional()
});

const SlidesCreateSheetsChartSchema = z.object({
  presentationId: z.string().min(1, "Presentation ID is required"),
  pageObjectId: z.string().min(1, "Page object ID is required"),
  spreadsheetId: z.string().min(1, "Spreadsheet ID is required"),
  chartId: z.number().min(0, "Chart ID must be non-negative"),
  linkingMode: z.enum(['LINKED', 'NOT_LINKED_IMAGE']).optional(),
  elementProperties: z.object({
    pageObjectId: z.string().optional(),
    size: z.object({
      width: z.object({ magnitude: z.number(), unit: z.enum(['EMU', 'PT']) }),
      height: z.object({ magnitude: z.number(), unit: z.enum(['EMU', 'PT']) })
    }).optional(),
    transform: z.object({
      scaleX: z.number().optional(),
      scaleY: z.number().optional(),
      translateX: z.number().optional(),
      translateY: z.number().optional(),
      unit: z.enum(['EMU', 'PT']).optional()
    }).optional()
  }).optional()
});

const SlidesRefreshSheetsChartSchema = z.object({
  presentationId: z.string().min(1, "Presentation ID is required"),
  objectId: z.string().min(1, "Object ID is required")
});

const SlidesUpdateImagePropertiesSchema = z.object({
  presentationId: z.string().min(1, "Presentation ID is required"),
  objectId: z.string().min(1, "Object ID is required"),
  imageProperties: z.object({
    brightness: z.number().min(-1).max(1).optional(),
    contrast: z.number().min(-1).max(1).optional(),
    transparency: z.number().min(0).max(1).optional(),
    recolor: z.object({
      recolorStops: z.array(z.object({
        color: z.object({
          red: z.number().min(0).max(1).optional(),
          green: z.number().min(0).max(1).optional(),
          blue: z.number().min(0).max(1).optional()
        }),
        alpha: z.number().min(0).max(1).optional(),
        position: z.number().min(0).max(1)
      }))
    }).optional(),
    outline: z.object({
      outlineFill: z.object({
        solidFill: z.object({
          color: z.object({
            red: z.number().min(0).max(1).optional(),
            green: z.number().min(0).max(1).optional(),
            blue: z.number().min(0).max(1).optional()
          }),
          alpha: z.number().min(0).max(1).optional()
        }).optional()
      }).optional(),
      weight: z.object({ magnitude: z.number(), unit: z.enum(['EMU', 'PT']) }).optional(),
      dashStyle: z.enum(['SOLID', 'DOT', 'DASH', 'DASH_DOT', 'LONG_DASH', 'LONG_DASH_DOT']).optional()
    }).optional(),
    shadow: z.object({
      type: z.enum(['OUTER']),
      alignment: z.enum(['TOP_LEFT', 'TOP_CENTER', 'TOP_RIGHT', 'LEFT_CENTER', 'CENTER', 'RIGHT_CENTER', 'BOTTOM_LEFT', 'BOTTOM_CENTER', 'BOTTOM_RIGHT']),
      color: z.object({
        red: z.number().min(0).max(1).optional(),
        green: z.number().min(0).max(1).optional(),
        blue: z.number().min(0).max(1).optional()
      }),
      alpha: z.number().min(0).max(1).optional(),
      blurRadius: z.object({ magnitude: z.number(), unit: z.enum(['EMU', 'PT']) }),
      transform: z.object({
        scaleX: z.number().optional(),
        scaleY: z.number().optional(),
        translateX: z.number().optional(),
        translateY: z.number().optional(),
        unit: z.enum(['EMU', 'PT']).optional()
      }).optional()
    }).optional(),
    cropProperties: z.object({
      leftOffset: z.number().min(0).max(1).optional(),
      rightOffset: z.number().min(0).max(1).optional(),
      topOffset: z.number().min(0).max(1).optional(),
      bottomOffset: z.number().min(0).max(1).optional(),
      angle: z.number().optional()
    }).optional()
  }).optional()
});

const SlidesUpdateVideoPropertiesSchema = z.object({
  presentationId: z.string().min(1, "Presentation ID is required"),
  objectId: z.string().min(1, "Object ID is required"),
  videoProperties: z.object({
    outline: z.object({
      outlineFill: z.object({
        solidFill: z.object({
          color: z.object({
            red: z.number().min(0).max(1).optional(),
            green: z.number().min(0).max(1).optional(),
            blue: z.number().min(0).max(1).optional()
          }),
          alpha: z.number().min(0).max(1).optional()
        }).optional()
      }).optional(),
      weight: z.object({ magnitude: z.number(), unit: z.enum(['EMU', 'PT']) }).optional(),
      dashStyle: z.enum(['SOLID', 'DOT', 'DASH', 'DASH_DOT', 'LONG_DASH', 'LONG_DASH_DOT']).optional()
    }).optional(),
    autoPlay: z.boolean().optional(),
    start: z.number().min(0).optional(),
    end: z.number().min(0).optional(),
    mute: z.boolean().optional()
  }).optional()
});

// Phase 3 Zod Schemas (Issue #7 - Text & Line Formatting)
const SlidesDeleteParagraphBulletsSchema = z.object({
  presentationId: z.string().min(1, "Presentation ID is required"),
  objectId: z.string().min(1, "Object ID is required"),
  textRange: z.object({
    type: z.enum(['FIXED_RANGE', 'FROM_START_INDEX', 'ALL']).optional(),
    startIndex: z.number().min(0).optional(),
    endIndex: z.number().min(0).optional()
  }).optional(),
  cellLocation: z.object({
    rowIndex: z.number().min(0),
    columnIndex: z.number().min(0)
  }).optional()
});

const SlidesUpdateLinePropertiesSchema = z.object({
  presentationId: z.string().min(1, "Presentation ID is required"),
  objectId: z.string().min(1, "Object ID is required"),
  lineProperties: z.object({
    weight: z.object({
      magnitude: z.number().min(0),
      unit: z.enum(['EMU', 'PT'])
    }).optional(),
    dashStyle: z.enum(['SOLID', 'DOT', 'DASH', 'DASH_DOT', 'LONG_DASH', 'LONG_DASH_DOT']).optional(),
    startArrow: z.enum([
      'ARROW_NONE', 'ARROW', 'STEALTH_ARROW', 'FILL_ARROW', 'FILL_CIRCLE', 'FILL_SQUARE', 'FILL_DIAMOND', 'OPEN_ARROW', 'OPEN_CIRCLE', 'OPEN_SQUARE', 'OPEN_DIAMOND'
    ]).optional(),
    endArrow: z.enum([
      'ARROW_NONE', 'ARROW', 'STEALTH_ARROW', 'FILL_ARROW', 'FILL_CIRCLE', 'FILL_SQUARE', 'FILL_DIAMOND', 'OPEN_ARROW', 'OPEN_CIRCLE', 'OPEN_SQUARE', 'OPEN_DIAMOND'
    ]).optional(),
    lineFill: z.object({
      solidFill: z.object({
        color: z.object({
          red: z.number().min(0).max(1).optional(),
          green: z.number().min(0).max(1).optional(),
          blue: z.number().min(0).max(1).optional()
        }),
        alpha: z.number().min(0).max(1).optional()
      }).optional()
    }).optional(),
    link: z.object({
      url: z.string().url().optional(),
      relativeLink: z.enum(['NEXT_SLIDE', 'PREVIOUS_SLIDE', 'FIRST_SLIDE', 'LAST_SLIDE']).optional(),
      slideIndex: z.number().min(0).optional(),
      pageObjectId: z.string().optional()
    }).optional()
  }).optional()
});

const SlidesUpdateLineCategorySchema = z.object({
  presentationId: z.string().min(1, "Presentation ID is required"),
  objectId: z.string().min(1, "Object ID is required"),
  lineCategory: z.enum(['STRAIGHT', 'BENT', 'CURVED'])
});

const SlidesRerouteLineSchema = z.object({
  presentationId: z.string().min(1, "Presentation ID is required"),
  objectId: z.string().min(1, "Object ID is required")
});

// Phase 4 Zod Schemas (Issue #7 - Table Operations)
const SlidesInsertTableRowsSchema = z.object({
  presentationId: z.string().min(1, "Presentation ID is required"),
  tableObjectId: z.string().min(1, "Table object ID is required"),
  cellLocation: z.object({
    rowIndex: z.number().min(0),
    columnIndex: z.number().min(0)
  }),
  insertBelow: z.boolean(),
  number: z.number().min(1, "Number of rows must be at least 1").optional()
});

const SlidesInsertTableColumnsSchema = z.object({
  presentationId: z.string().min(1, "Presentation ID is required"),
  tableObjectId: z.string().min(1, "Table object ID is required"),
  cellLocation: z.object({
    rowIndex: z.number().min(0),
    columnIndex: z.number().min(0)
  }),
  insertRight: z.boolean(),
  number: z.number().min(1, "Number of columns must be at least 1").optional()
});

const SlidesDeleteTableRowSchema = z.object({
  presentationId: z.string().min(1, "Presentation ID is required"),
  tableObjectId: z.string().min(1, "Table object ID is required"),
  cellLocation: z.object({
    rowIndex: z.number().min(0),
    columnIndex: z.number().min(0)
  })
});

const SlidesDeleteTableColumnSchema = z.object({
  presentationId: z.string().min(1, "Presentation ID is required"),
  tableObjectId: z.string().min(1, "Table object ID is required"),
  cellLocation: z.object({
    rowIndex: z.number().min(0),
    columnIndex: z.number().min(0)
  })
});

const SlidesUpdateTableCellPropertiesSchema = z.object({
  presentationId: z.string().min(1, "Presentation ID is required"),
  objectId: z.string().min(1, "Table object ID is required"),
  tableRange: z.object({
    location: z.object({
      rowIndex: z.number().min(0),
      columnIndex: z.number().min(0)
    }),
    rowSpan: z.number().min(1).optional(),
    columnSpan: z.number().min(1).optional()
  }),
  tableCellProperties: z.object({
    tableCellBackgroundFill: z.object({
      solidFill: z.object({
        color: z.object({
          red: z.number().min(0).max(1).optional(),
          green: z.number().min(0).max(1).optional(),
          blue: z.number().min(0).max(1).optional()
        }),
        alpha: z.number().min(0).max(1).optional()
      }).optional()
    }).optional(),
    contentAlignment: z.enum(['TOP', 'MIDDLE', 'BOTTOM']).optional()
  }).optional()
});

const SlidesUpdateTableBorderPropertiesSchema = z.object({
  presentationId: z.string().min(1, "Presentation ID is required"),
  objectId: z.string().min(1, "Table object ID is required"),
  tableRange: z.object({
    location: z.object({
      rowIndex: z.number().min(0),
      columnIndex: z.number().min(0)
    }),
    rowSpan: z.number().min(1).optional(),
    columnSpan: z.number().min(1).optional()
  }),
  borderPosition: z.enum(['ALL', 'BOTTOM', 'INNER', 'INNER_HORIZONTAL', 'INNER_VERTICAL', 'LEFT', 'OUTER', 'RIGHT', 'TOP']),
  tableBorderProperties: z.object({
    tableBorderFill: z.object({
      solidFill: z.object({
        color: z.object({
          red: z.number().min(0).max(1).optional(),
          green: z.number().min(0).max(1).optional(),
          blue: z.number().min(0).max(1).optional()
        }),
        alpha: z.number().min(0).max(1).optional()
      }).optional()
    }).optional(),
    weight: z.object({
      magnitude: z.number().min(0),
      unit: z.enum(['EMU', 'PT'])
    }).optional(),
    dashStyle: z.enum(['SOLID', 'DOT', 'DASH', 'DASH_DOT', 'LONG_DASH', 'LONG_DASH_DOT']).optional()
  }).optional()
});

const SlidesUpdateTableColumnPropertiesSchema = z.object({
  presentationId: z.string().min(1, "Presentation ID is required"),
  objectId: z.string().min(1, "Table object ID is required"),
  columnIndices: z.array(z.number().min(0)).min(1, "At least one column index is required"),
  tableColumnProperties: z.object({
    columnWidth: z.object({
      magnitude: z.number().min(0),
      unit: z.enum(['EMU', 'PT'])
    })
  })
});

const SlidesUpdateTableRowPropertiesSchema = z.object({
  presentationId: z.string().min(1, "Presentation ID is required"),
  objectId: z.string().min(1, "Table object ID is required"),
  rowIndices: z.array(z.number().min(0)).min(1, "At least one row index is required"),
  tableRowProperties: z.object({
    minRowHeight: z.object({
      magnitude: z.number().min(0),
      unit: z.enum(['EMU', 'PT'])
    })
  })
});

const SlidesMergeTableCellsSchema = z.object({
  presentationId: z.string().min(1, "Presentation ID is required"),
  objectId: z.string().min(1, "Table object ID is required"),
  tableRange: z.object({
    location: z.object({
      rowIndex: z.number().min(0),
      columnIndex: z.number().min(0)
    }),
    rowSpan: z.number().min(1),
    columnSpan: z.number().min(1)
  })
});

const SlidesUnmergeTableCellsSchema = z.object({
  presentationId: z.string().min(1, "Presentation ID is required"),
  objectId: z.string().min(1, "Table object ID is required"),
  tableRange: z.object({
    location: z.object({
      rowIndex: z.number().min(0),
      columnIndex: z.number().min(0)
    }),
    rowSpan: z.number().min(1).optional(),
    columnSpan: z.number().min(1).optional()
  })
});

// Phase 5 Zod Schemas (Issue #7 - Advanced Element Operations)
const SlidesUpdatePageElementAltTextSchema = z.object({
  presentationId: z.string().min(1, "Presentation ID is required"),
  objectId: z.string().min(1, "Object ID is required"),
  title: z.string().optional(),
  description: z.string().optional()
});

const SlidesUpdatePageElementsZOrderSchema = z.object({
  presentationId: z.string().min(1, "Presentation ID is required"),
  pageElementObjectIds: z.array(z.string()).min(1, "At least one element ID is required"),
  operation: z.enum(['BRING_TO_FRONT', 'SEND_TO_BACK', 'BRING_FORWARD', 'SEND_BACKWARD'])
});

const SlidesGroupObjectsSchema = z.object({
  presentationId: z.string().min(1, "Presentation ID is required"),
  childrenObjectIds: z.array(z.string()).min(2, "At least two objects are required to group"),
  groupObjectId: z.string().optional()
});

const SlidesUngroupObjectsSchema = z.object({
  presentationId: z.string().min(1, "Presentation ID is required"),
  objectIds: z.array(z.string()).min(1, "At least one group ID is required")
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

const DocsGetSchema = z.object({
  documentId: z.string().min(1, "Document ID is required"),
  includeTabsContent: z.boolean().optional(),
  returnMode: z.enum(["summary", "full"]).default("summary")
    .describe("'summary' (default): Returns metadata + resource URI, caches content. 'full': Returns complete response with truncation")
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
    name: "google-drive-collaboration-mcp",
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

  // Parse the URI to determine how to handle it
  const parsed = parseResourceUri(request.params.uri);

  // Handle new cache-based URI formats (Issue #23)
  if (parsed.valid && parsed.type !== 'legacy') {
    const cached = serveCachedContent(parsed);

    if (cached.content !== null) {
      log('Serving cached content', { uri: request.params.uri, contentLength: cached.content.length });
      return {
        contents: [
          {
            uri: request.params.uri,
            mimeType: 'text/plain',
            text: cached.content,
          },
        ],
      };
    }

    // Cache miss or error - return helpful error message
    const errorMessage = cached.error || 'Unknown error';
    const hint = cached.hint || '';
    log('Cache miss or error', { uri: request.params.uri, error: errorMessage });

    return {
      contents: [
        {
          uri: request.params.uri,
          mimeType: 'text/plain',
          text: JSON.stringify({
            error: errorMessage,
            hint: hint,
            uri: request.params.uri,
            suggestion: 'Use the appropriate fetch tool first to populate the cache, then access via this resource URI.'
          }, null, 2),
        },
      ],
    };
  }

  // Invalid URI format
  if (!parsed.valid) {
    log('Invalid resource URI', { uri: request.params.uri, error: parsed.error });
    return {
      contents: [
        {
          uri: request.params.uri,
          mimeType: 'text/plain',
          text: JSON.stringify({
            error: parsed.error,
            supportedFormats: [
              'gdrive:///{fileId} (legacy)',
              'gdrive://docs/{docId}/content',
              'gdrive://docs/{docId}/chunk/{start}-{end}',
              'gdrive://docs/{docId}/structure',
              'gdrive://sheets/{spreadsheetId}/values/{range}',
              'gdrive://files/{fileId}/content/{start}-{end}'
            ]
          }, null, 2),
        },
      ],
    };
  }

  // Legacy format: gdrive:///{fileId} - use existing behavior
  const fileId = parsed.resourceId!;

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

// -----------------------------------------------------------------------------
// TOOLS DEFINITION
// -----------------------------------------------------------------------------
const TOOLS_LIST = [
      {
        name: "server_getInfo",
        description: "Get server information including name, version, capabilities, and uptime. Returns details about the MCP server, project metadata, supported APIs, and optional uptime statistics.",
        inputSchema: {
          type: "object",
          properties: {
            includeUptime: {
              type: "boolean",
              description: "Include server uptime information (how long server has been running)",
              optional: true
            }
          }
        }
      },
      // Phase 1: Essential Drive API Operations
      {
        name: "drive_createFile",
        description: "Create a new file or folder in Google Drive. Maps directly to files.create in Drive API v3.",
        inputSchema: {
          type: "object",
          properties: {
            name: { type: "string", description: "File or folder name" },
            mimeType: { type: "string", description: "MIME type (e.g., 'application/vnd.google-apps.document', 'application/vnd.google-apps.folder')" },
            parents: { type: "array", items: { type: "string" }, description: "Parent folder IDs", optional: true },
            description: { type: "string", description: "File description", optional: true },
            properties: { type: "object", description: "Custom key-value properties", optional: true },
            supportsAllDrives: { type: "boolean", description: "Whether to support shared drives (defaults to true)", optional: true }
          },
          required: ["name", "mimeType"]
        }
      },
      {
        name: "drive_getFile",
        description: "Get a file's metadata by ID. Maps directly to files.get in Drive API v3.",
        inputSchema: {
          type: "object",
          properties: {
            fileId: { type: "string", description: "File ID" },
            fields: { type: "string", description: "Fields to include in response (e.g., 'id,name,mimeType,parents')", optional: true },
            supportsAllDrives: { type: "boolean", description: "Whether to support shared drives (defaults to true)", optional: true },
            includeTrashed: { type: "boolean", description: "Whether to return files in trash (defaults to false - trashed files will error)", optional: true }
          },
          required: ["fileId"]
        }
      },
      {
        name: "drive_updateFile",
        description: "Update a file's metadata. Maps directly to files.update in Drive API v3.",
        inputSchema: {
          type: "object",
          properties: {
            fileId: { type: "string", description: "File ID" },
            name: { type: "string", description: "New name", optional: true },
            mimeType: { type: "string", description: "New MIME type", optional: true },
            parents: { type: "array", items: { type: "string" }, description: "New parent folder IDs", optional: true },
            trashed: { type: "boolean", description: "Move to/from trash", optional: true },
            description: { type: "string", description: "New description", optional: true },
            properties: { type: "object", description: "Update custom properties", optional: true },
            supportsAllDrives: { type: "boolean", description: "Whether to support shared drives (defaults to true)", optional: true }
          },
          required: ["fileId"]
        }
      },
      {
        name: "drive_deleteFile",
        description: "Permanently delete a file (bypasses trash). Maps directly to files.delete in Drive API v3.",
        inputSchema: {
          type: "object",
          properties: {
            fileId: { type: "string", description: "File ID" },
            supportsAllDrives: { type: "boolean", description: "Whether to support shared drives (defaults to true)", optional: true }
          },
          required: ["fileId"]
        }
      },
      {
        name: "drive_listFiles",
        description: "List or search for files. Maps directly to files.list in Drive API v3.",
        inputSchema: {
          type: "object",
          properties: {
            q: { type: "string", description: "Query string (e.g., \"name contains 'report'\")", optional: true },
            pageSize: { type: "number", description: "Max results per page (1-1000)", optional: true },
            pageToken: { type: "string", description: "Token for next page", optional: true },
            orderBy: { type: "string", description: "Sort order (e.g., 'modifiedTime desc')", optional: true },
            fields: { type: "string", description: "Fields to include", optional: true },
            spaces: { type: "string", description: "Spaces to search (drive, appDataFolder, photos)", optional: true },
            corpora: { type: "string", description: "Bodies to search (user, domain, drive, allDrives)", optional: true },
            includeItemsFromAllDrives: { type: "boolean", description: "Include items from all drives (defaults to true)", optional: true },
            supportsAllDrives: { type: "boolean", description: "Whether to support shared drives (defaults to true)", optional: true },
            includeTrashed: { type: "boolean", description: "Whether to include trashed files (defaults to false)", optional: true }
          },
          required: []
        }
      },
      // Phase 2: File Utilities
      {
        name: "drive_copyFile",
        description: "Create a copy of a file. Maps directly to files.copy in Drive API v3.",
        inputSchema: {
          type: "object",
          properties: {
            fileId: { type: "string", description: "File ID to copy" },
            name: { type: "string", description: "Name for the copy", optional: true },
            parents: { type: "array", items: { type: "string" }, description: "Parent folder IDs for the copy", optional: true },
            description: { type: "string", description: "Description for the copy", optional: true },
            properties: { type: "object", description: "Custom properties for the copy", optional: true },
            supportsAllDrives: { type: "boolean", description: "Whether to support shared drives (defaults to true)", optional: true }
          },
          required: ["fileId"]
        }
      },
      {
        name: "drive_exportFile",
        description: `Export a Google Docs/Sheets/Slides file to a different format. Maps directly to files.export in Drive API v3. Returns base64-encoded content. Max 10MB export size.

✨ EFFICIENCY BENEFIT: For Google Docs, exporting to text/markdown or text/plain provides 60-65% token reduction compared to docs_get.

WHEN TO USE:
✓ Need document content/text without formatting details
✓ Reading/analyzing document text efficiently
✓ Creating summaries or extracting information
✓ Searching for specific content
✓ Maximum token efficiency (especially for large documents)
✓ Read-only operations

BEST FORMATS FOR CONTENT EXTRACTION:
• text/markdown - Preserves headings, lists, basic formatting (~65% smaller than docs_get)
• text/plain - Raw text only, most efficient

NOTE: This is read-only. For editing documents, use docs_get + editing tools. For structure analysis or formatting work, use docs_get.`,
        inputSchema: {
          type: "object",
          properties: {
            fileId: { type: "string", description: "File ID to export" },
            mimeType: {
              type: "string",
              description: `Export MIME type. Supported formats by document type:

Google Docs:
- application/pdf (.pdf) - PDF
- application/vnd.openxmlformats-officedocument.wordprocessingml.document (.docx) - MS Word
- text/markdown (.md) - Markdown
- text/plain (.txt) - Plain text
- application/rtf (.rtf) - Rich text
- application/vnd.oasis.opendocument.text (.odt) - OpenDocument
- application/zip (.zip) - HTML (zipped)
- application/epub+zip (.epub) - EPUB

Google Sheets:
- application/pdf (.pdf) - PDF
- application/vnd.openxmlformats-officedocument.spreadsheetml.sheet (.xlsx) - MS Excel
- text/csv (.csv) - CSV (first sheet only)
- text/tab-separated-values (.tsv) - TSV (first sheet only)
- application/vnd.oasis.opendocument.spreadsheet (.ods) - OpenDocument
- application/zip (.zip) - HTML (zipped)

Google Slides:
- application/pdf (.pdf) - PDF
- application/vnd.openxmlformats-officedocument.presentationml.presentation (.pptx) - MS PowerPoint
- text/plain (.txt) - Plain text
- image/jpeg (.jpg) - JPEG (first slide only)
- image/png (.png) - PNG (first slide only)
- image/svg+xml (.svg) - SVG (first slide only)
- application/vnd.oasis.opendocument.presentation (.odp) - OpenDocument`
            },
            supportsAllDrives: { type: "boolean", description: "Whether to support shared drives (defaults to true)", optional: true }
          },
          required: ["fileId", "mimeType"]
        }
      },
      // Phase 3: Comments & Collaboration
      {
        name: "drive_createComment",
        description: "Add a comment to a file. Maps directly to comments.create in Drive API v3.",
        inputSchema: {
          type: "object",
          properties: {
            fileId: { type: "string", description: "File ID" },
            content: { type: "string", description: "Comment text" },
            anchor: { type: "string", description: "Optional anchor location in document", optional: true },
            quotedFileContent: {
              type: "object",
              description: "Quoted text being commented on",
              properties: {
                mimeType: { type: "string" },
                value: { type: "string" }
              },
              optional: true
            }
          },
          required: ["fileId", "content"]
        }
      },
      {
        name: "drive_listComments",
        description: "List all comments on a file. Maps directly to comments.list in Drive API v3.",
        inputSchema: {
          type: "object",
          properties: {
            fileId: { type: "string", description: "File ID" },
            pageSize: { type: "number", description: "Max results (1-100)", optional: true },
            pageToken: { type: "string", description: "Pagination token", optional: true },
            includeDeleted: { type: "boolean", description: "Include deleted comments", optional: true },
            startModifiedTime: { type: "string", description: "Filter by modification time", optional: true }
          },
          required: ["fileId"]
        }
      },
      {
        name: "drive_getComment",
        description: "Get a comment by ID. Maps directly to comments.get in Drive API v3.",
        inputSchema: {
          type: "object",
          properties: {
            fileId: { type: "string", description: "File ID" },
            commentId: { type: "string", description: "Comment ID" },
            includeDeleted: { type: "boolean", description: "Include deleted comment", optional: true }
          },
          required: ["fileId", "commentId"]
        }
      },
      {
        name: "drive_updateComment",
        description: "Update a comment. Maps directly to comments.update in Drive API v3.",
        inputSchema: {
          type: "object",
          properties: {
            fileId: { type: "string", description: "File ID" },
            commentId: { type: "string", description: "Comment ID" },
            content: { type: "string", description: "New comment text" }
          },
          required: ["fileId", "commentId", "content"]
        }
      },
      {
        name: "drive_deleteComment",
        description: "Delete a comment. Maps directly to comments.delete in Drive API v3.",
        inputSchema: {
          type: "object",
          properties: {
            fileId: { type: "string", description: "File ID" },
            commentId: { type: "string", description: "Comment ID" }
          },
          required: ["fileId", "commentId"]
        }
      },
      {
        name: "drive_createReply",
        description: "Add a reply to a comment. Maps directly to replies.create in Drive API v3.",
        inputSchema: {
          type: "object",
          properties: {
            fileId: { type: "string", description: "File ID" },
            commentId: { type: "string", description: "Comment ID" },
            content: { type: "string", description: "Reply text" },
            action: { type: "string", enum: ["resolve", "reopen"], description: "Optional action", optional: true }
          },
          required: ["fileId", "commentId", "content"]
        }
      },
      {
        name: "drive_listReplies",
        description: "List all replies to a comment. Maps directly to replies.list in Drive API v3.",
        inputSchema: {
          type: "object",
          properties: {
            fileId: { type: "string", description: "File ID" },
            commentId: { type: "string", description: "Comment ID" },
            pageSize: { type: "number", description: "Max results (1-100)", optional: true },
            pageToken: { type: "string", description: "Pagination token", optional: true },
            includeDeleted: { type: "boolean", description: "Include deleted replies", optional: true }
          },
          required: ["fileId", "commentId"]
        }
      },
      {
        name: "drive_getReply",
        description: "Get a reply by ID. Maps directly to replies.get in Drive API v3.",
        inputSchema: {
          type: "object",
          properties: {
            fileId: { type: "string", description: "File ID" },
            commentId: { type: "string", description: "Comment ID" },
            replyId: { type: "string", description: "Reply ID" },
            includeDeleted: { type: "boolean", description: "Include deleted reply", optional: true }
          },
          required: ["fileId", "commentId", "replyId"]
        }
      },
      {
        name: "drive_updateReply",
        description: "Update a reply. Maps directly to replies.update in Drive API v3.",
        inputSchema: {
          type: "object",
          properties: {
            fileId: { type: "string", description: "File ID" },
            commentId: { type: "string", description: "Comment ID" },
            replyId: { type: "string", description: "Reply ID" },
            content: { type: "string", description: "New reply text" },
            action: { type: "string", enum: ["resolve", "reopen"], description: "Optional action", optional: true }
          },
          required: ["fileId", "commentId", "replyId", "content"]
        }
      },
      {
        name: "drive_deleteReply",
        description: "Delete a reply. Maps directly to replies.delete in Drive API v3.",
        inputSchema: {
          type: "object",
          properties: {
            fileId: { type: "string", description: "File ID" },
            commentId: { type: "string", description: "Comment ID" },
            replyId: { type: "string", description: "Reply ID" }
          },
          required: ["fileId", "commentId", "replyId"]
        }
      },
      {
        name: "drive_createPermission",
        description: "Grant access to a file. Maps directly to permissions.create in Drive API v3. Share with users, groups, domains, or anyone.",
        inputSchema: {
          type: "object",
          properties: {
            fileId: { type: "string", description: "File ID" },
            role: {
              type: "string",
              enum: ["owner", "organizer", "fileOrganizer", "writer", "commenter", "reader"],
              description: "Access level to grant"
            },
            type: {
              type: "string",
              enum: ["user", "group", "domain", "anyone"],
              description: "Permission type"
            },
            emailAddress: { type: "string", description: "Email address (required for user/group types)", optional: true },
            domain: { type: "string", description: "Domain name (required for domain type)", optional: true },
            sendNotificationEmail: { type: "boolean", description: "Send notification email (default: true)", optional: true },
            emailMessage: { type: "string", description: "Custom email message", optional: true },
            supportsAllDrives: { type: "boolean", description: "Include shared drives (defaults to true)", optional: true }
          },
          required: ["fileId", "role", "type"]
        }
      },
      {
        name: "drive_listPermissions",
        description: "List all permissions on a file. Maps directly to permissions.list in Drive API v3. Returns array of permissions with role, type, and user details.",
        inputSchema: {
          type: "object",
          properties: {
            fileId: { type: "string", description: "File ID" },
            pageSize: { type: "number", description: "Max results per page (1-100, default 100)", optional: true },
            pageToken: { type: "string", description: "Token for next page", optional: true },
            fields: { type: "string", description: "Fields to include (e.g. 'permissions(id,role,emailAddress)')", optional: true },
            supportsAllDrives: { type: "boolean", description: "Include shared drives (defaults to true)", optional: true }
          },
          required: ["fileId"]
        }
      },
      {
        name: "drive_getPermission",
        description: "Get permission details by ID. Maps directly to permissions.get in Drive API v3. Returns specific permission metadata including role and user info.",
        inputSchema: {
          type: "object",
          properties: {
            fileId: { type: "string", description: "File ID" },
            permissionId: { type: "string", description: "Permission ID" },
            fields: { type: "string", description: "Fields to include (e.g. 'id,role,emailAddress,expirationTime')", optional: true },
            supportsAllDrives: { type: "boolean", description: "Include shared drives (defaults to true)", optional: true }
          },
          required: ["fileId", "permissionId"]
        }
      },
      {
        name: "drive_updatePermission",
        description: "Update permission role or settings. Maps directly to permissions.update in Drive API v3. Can change access level or transfer ownership.",
        inputSchema: {
          type: "object",
          properties: {
            fileId: { type: "string", description: "File ID" },
            permissionId: { type: "string", description: "Permission ID" },
            role: {
              type: "string",
              enum: ["owner", "organizer", "fileOrganizer", "writer", "commenter", "reader"],
              description: "New access level"
            },
            removeExpiration: { type: "boolean", description: "Remove expiration time", optional: true },
            transferOwnership: { type: "boolean", description: "Transfer ownership (required when changing to owner role)", optional: true },
            supportsAllDrives: { type: "boolean", description: "Include shared drives (defaults to true)", optional: true }
          },
          required: ["fileId", "permissionId", "role"]
        }
      },
      {
        name: "drive_deletePermission",
        description: "Revoke access to a file. Maps directly to permissions.delete in Drive API v3. Removes permission completely.",
        inputSchema: {
          type: "object",
          properties: {
            fileId: { type: "string", description: "File ID" },
            permissionId: { type: "string", description: "Permission ID to delete" },
            supportsAllDrives: { type: "boolean", description: "Include shared drives (defaults to true)", optional: true }
          },
          required: ["fileId", "permissionId"]
        }
      },
      {
        name: "auth_getStatus",
        description: "Check authentication status and show current user info. Maps to about.get in Drive API v3. Returns authenticated user details and storage quota.",
        inputSchema: {
          type: "object",
          properties: {
            fields: { type: "string", description: "Optional fields to include (default: 'user,storageQuota')", optional: true }
          }
        }
      },
      {
        name: "auth_testFileAccess",
        description: "Test if you can access a specific file/folder and show what permissions you have. Maps to files.get in Drive API v3 with enhanced error handling.",
        inputSchema: {
          type: "object",
          properties: {
            fileId: { type: "string", description: "File or folder ID to test access" },
            fields: { type: "string", description: "Optional fields (default: 'id,name,mimeType,capabilities,permissions')", optional: true }
          },
          required: ["fileId"]
        }
      },
      {
        name: "auth_listScopes",
        description: "Show granted OAuth scopes and token information. Helps diagnose scope-related permission issues.",
        inputSchema: {
          type: "object",
          properties: {}
        }
      },
      {
        name: "auth_clearTokens",
        description: "Clear authentication tokens and force re-authentication. Useful for switching accounts or fixing auth issues. Server will automatically re-authenticate on next tool call.",
        inputSchema: {
          type: "object",
          properties: {}
        }
      },
      {
        name: "sheets_repeatCell",
        description: "Format cells in a Google Sheet. Maps to RepeatCellRequest in Google Sheets API. Supports cell formatting (background, alignment, wrap), text formatting (bold, font, color), and number formatting (pattern, type).",
        inputSchema: {
          type: "object",
          properties: {
            spreadsheetId: { type: "string", description: "Spreadsheet ID" },
            range: { type: "string", description: "Range to format (e.g., 'A1:C10')" },
            // Cell format
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
            },
            // Text format
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
            },
            // Number format
            numberFormatPattern: { type: "string", description: "Number format pattern (e.g., '#,##0.00', 'yyyy-mm-dd')", optional: true },
            numberFormatType: {
              type: "string",
              description: "Format type",
              enum: ["NUMBER", "CURRENCY", "PERCENT", "DATE", "TIME", "DATE_TIME", "SCIENTIFIC"],
              optional: true
            }
          },
          required: ["spreadsheetId", "range"]
        }
      },
      {
        name: "sheets_updateBorders",
        description: "Set borders for cells in a Google Sheet. Maps directly to UpdateBordersRequest in batchUpdate API.",
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
        name: "sheets_mergeCells",
        description: "Merge cells in a Google Sheet. Maps directly to MergeCellsRequest in batchUpdate API.",
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
        name: "sheets_addConditionalFormatRule",
        description: "Add conditional formatting to a Google Sheet. Maps directly to AddConditionalFormatRuleRequest in batchUpdate API.",
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
      // Phase 1: Core Data Operations - Thin Layer Tools
      {
        name: "sheets_getSpreadsheet",
        description: "Get full spreadsheet metadata and optionally grid data. Maps directly to spreadsheets.get API.",
        inputSchema: {
          type: "object",
          properties: {
            spreadsheetId: { type: "string", description: "Spreadsheet ID" },
            ranges: { type: "array", items: { type: "string" }, description: "Optional: specific ranges to retrieve", optional: true },
            includeGridData: { type: "boolean", description: "Include cell values (default: false)", optional: true }
          },
          required: ["spreadsheetId"]
        }
      },
      {
        name: "sheets_createSpreadsheet",
        description: "Create a new spreadsheet with full property control. Maps directly to spreadsheets.create API.",
        inputSchema: {
          type: "object",
          properties: {
            title: { type: "string", description: "Spreadsheet title" },
            locale: { type: "string", description: "Locale (e.g., 'en_US')", optional: true },
            autoRecalc: { type: "string", enum: ["ON_CHANGE", "MINUTE", "HOUR"], description: "Auto-recalc setting", optional: true },
            timeZone: { type: "string", description: "Time zone (e.g., 'America/New_York')", optional: true }
          },
          required: ["title"]
        }
      },
      {
        name: "sheets_appendValues",
        description: "Append values to a sheet after the last row with data. Maps directly to spreadsheets.values.append API.",
        inputSchema: {
          type: "object",
          properties: {
            spreadsheetId: { type: "string", description: "Spreadsheet ID" },
            range: { type: "string", description: "Starting range (e.g., 'Sheet1!A1')" },
            values: { type: "array", items: { type: "array", items: { type: "string" } }, description: "2D array of values" },
            valueInputOption: { type: "string", enum: ["RAW", "USER_ENTERED"], description: "How to interpret values (default: USER_ENTERED)", optional: true },
            insertDataOption: { type: "string", enum: ["OVERWRITE", "INSERT_ROWS"], description: "How to insert data", optional: true }
          },
          required: ["spreadsheetId", "range", "values"]
        }
      },
      {
        name: "sheets_clearValues",
        description: "Clear values from a range. Maps directly to spreadsheets.values.clear API.",
        inputSchema: {
          type: "object",
          properties: {
            spreadsheetId: { type: "string", description: "Spreadsheet ID" },
            range: { type: "string", description: "Range to clear (e.g., 'Sheet1!A1:B10')" }
          },
          required: ["spreadsheetId", "range"]
        }
      },
      {
        name: "sheets_batchGetValues",
        description: "Get values from multiple ranges in one request. Maps directly to spreadsheets.values.batchGet API.",
        inputSchema: {
          type: "object",
          properties: {
            spreadsheetId: { type: "string", description: "Spreadsheet ID" },
            ranges: { type: "array", items: { type: "string" }, description: "Array of ranges to retrieve" },
            majorDimension: { type: "string", enum: ["ROWS", "COLUMNS"], description: "Major dimension", optional: true },
            valueRenderOption: { type: "string", enum: ["FORMATTED_VALUE", "UNFORMATTED_VALUE", "FORMULA"], description: "How to render values", optional: true }
          },
          required: ["spreadsheetId", "ranges"]
        }
      },
      {
        name: "sheets_batchUpdateValues",
        description: "Update multiple ranges in one request. Maps directly to spreadsheets.values.batchUpdate API.",
        inputSchema: {
          type: "object",
          properties: {
            spreadsheetId: { type: "string", description: "Spreadsheet ID" },
            valueInputOption: { type: "string", enum: ["RAW", "USER_ENTERED"], description: "How to interpret values (default: USER_ENTERED)", optional: true },
            data: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  range: { type: "string" },
                  values: { type: "array", items: { type: "array", items: { type: "string" } } }
                }
              },
              description: "Array of range updates"
            }
          },
          required: ["spreadsheetId", "data"]
        }
      },
      {
        name: "sheets_batchClearValues",
        description: "Clear multiple ranges in one request. Maps directly to spreadsheets.values.batchClear API.",
        inputSchema: {
          type: "object",
          properties: {
            spreadsheetId: { type: "string", description: "Spreadsheet ID" },
            ranges: { type: "array", items: { type: "string" }, description: "Array of ranges to clear" }
          },
          required: ["spreadsheetId", "ranges"]
        }
      },
      {
        name: "sheets_addSheet",
        description: "Add a new sheet to a spreadsheet. Maps directly to AddSheetRequest in batchUpdate API.",
        inputSchema: {
          type: "object",
          properties: {
            spreadsheetId: { type: "string", description: "Spreadsheet ID" },
            title: { type: "string", description: "Sheet title" },
            index: { type: "number", description: "Position in sheet list", optional: true },
            sheetType: { type: "string", enum: ["GRID", "OBJECT"], description: "Sheet type", optional: true },
            gridRowCount: { type: "number", description: "Initial row count", optional: true },
            gridColumnCount: { type: "number", description: "Initial column count", optional: true },
            frozenRowCount: { type: "number", description: "Number of frozen rows", optional: true },
            frozenColumnCount: { type: "number", description: "Number of frozen columns", optional: true },
            hidden: { type: "boolean", description: "Hide sheet", optional: true },
            tabColorRed: { type: "number", description: "Tab color red (0-1)", optional: true },
            tabColorGreen: { type: "number", description: "Tab color green (0-1)", optional: true },
            tabColorBlue: { type: "number", description: "Tab color blue (0-1)", optional: true },
            rightToLeft: { type: "boolean", description: "RTL direction", optional: true }
          },
          required: ["spreadsheetId", "title"]
        }
      },
      {
        name: "sheets_deleteSheet",
        description: "Delete a sheet from a spreadsheet. Maps directly to DeleteSheetRequest in batchUpdate API.",
        inputSchema: {
          type: "object",
          properties: {
            spreadsheetId: { type: "string", description: "Spreadsheet ID" },
            sheetId: { type: "number", description: "Sheet ID to delete" }
          },
          required: ["spreadsheetId", "sheetId"]
        }
      },
      {
        name: "sheets_updateSheetProperties",
        description: "Update sheet properties. Maps directly to UpdateSheetPropertiesRequest in batchUpdate API.",
        inputSchema: {
          type: "object",
          properties: {
            spreadsheetId: { type: "string", description: "Spreadsheet ID" },
            sheetId: { type: "number", description: "Sheet ID to update" },
            title: { type: "string", description: "New sheet title", optional: true },
            index: { type: "number", description: "New position", optional: true },
            hidden: { type: "boolean", description: "Hide/show sheet", optional: true },
            tabColorRed: { type: "number", description: "Tab color red (0-1)", optional: true },
            tabColorGreen: { type: "number", description: "Tab color green (0-1)", optional: true },
            tabColorBlue: { type: "number", description: "Tab color blue (0-1)", optional: true },
            frozenRowCount: { type: "number", description: "Number of frozen rows", optional: true },
            frozenColumnCount: { type: "number", description: "Number of frozen columns", optional: true },
            rightToLeft: { type: "boolean", description: "RTL direction", optional: true }
          },
          required: ["spreadsheetId", "sheetId"]
        }
      },
      {
        name: "sheets_insertDimension",
        description: "Insert rows or columns. Maps directly to InsertDimensionRequest in batchUpdate API.",
        inputSchema: {
          type: "object",
          properties: {
            spreadsheetId: { type: "string", description: "Spreadsheet ID" },
            sheetId: { type: "number", description: "Sheet ID to insert into" },
            dimension: { type: "string", enum: ["ROWS", "COLUMNS"], description: "Insert rows or columns" },
            startIndex: { type: "number", description: "Starting index (0-based, inclusive)" },
            endIndex: { type: "number", description: "Ending index (0-based, exclusive)" },
            inheritFromBefore: { type: "boolean", description: "Inherit formatting from before (true) or after (false)", optional: true }
          },
          required: ["spreadsheetId", "sheetId", "dimension", "startIndex", "endIndex"]
        }
      },
      {
        name: "sheets_deleteDimension",
        description: "Delete rows or columns. Maps directly to DeleteDimensionRequest in batchUpdate API.",
        inputSchema: {
          type: "object",
          properties: {
            spreadsheetId: { type: "string", description: "Spreadsheet ID" },
            sheetId: { type: "number", description: "Sheet ID to delete from" },
            dimension: { type: "string", enum: ["ROWS", "COLUMNS"], description: "Delete rows or columns" },
            startIndex: { type: "number", description: "Starting index (0-based, inclusive)" },
            endIndex: { type: "number", description: "Ending index (0-based, exclusive)" }
          },
          required: ["spreadsheetId", "sheetId", "dimension", "startIndex", "endIndex"]
        }
      },
      {
        name: "sheets_moveDimension",
        description: "Move rows or columns to a different location. Maps directly to MoveDimensionRequest in batchUpdate API.",
        inputSchema: {
          type: "object",
          properties: {
            spreadsheetId: { type: "string", description: "Spreadsheet ID" },
            sheetId: { type: "number", description: "Sheet ID containing rows/columns to move" },
            dimension: { type: "string", enum: ["ROWS", "COLUMNS"], description: "Move rows or columns" },
            startIndex: { type: "number", description: "Starting index of rows/columns to move (0-based, inclusive)" },
            endIndex: { type: "number", description: "Ending index of rows/columns to move (0-based, exclusive)" },
            destinationIndex: { type: "number", description: "Index where rows/columns should be moved to (0-based)" }
          },
          required: ["spreadsheetId", "sheetId", "dimension", "startIndex", "endIndex", "destinationIndex"]
        }
      },
      {
        name: "sheets_updateDimensionProperties",
        description: "Update row heights or column widths. Maps directly to UpdateDimensionPropertiesRequest in batchUpdate API.",
        inputSchema: {
          type: "object",
          properties: {
            spreadsheetId: { type: "string", description: "Spreadsheet ID" },
            sheetId: { type: "number", description: "Sheet ID to update" },
            dimension: { type: "string", enum: ["ROWS", "COLUMNS"], description: "Update rows or columns" },
            startIndex: { type: "number", description: "Starting index (0-based, inclusive)" },
            endIndex: { type: "number", description: "Ending index (0-based, exclusive)" },
            pixelSize: { type: "number", description: "Row height or column width in pixels", optional: true },
            hiddenByUser: { type: "boolean", description: "Hide or show rows/columns", optional: true }
          },
          required: ["spreadsheetId", "sheetId", "dimension", "startIndex", "endIndex"]
        }
      },
      {
        name: "sheets_appendDimension",
        description: "Append rows or columns to the end of a sheet. Maps directly to AppendDimensionRequest in batchUpdate API.",
        inputSchema: {
          type: "object",
          properties: {
            spreadsheetId: { type: "string", description: "Spreadsheet ID" },
            sheetId: { type: "number", description: "Sheet ID to append to" },
            dimension: { type: "string", enum: ["ROWS", "COLUMNS"], description: "Append rows or columns" },
            length: { type: "number", description: "Number of rows/columns to append" }
          },
          required: ["spreadsheetId", "sheetId", "dimension", "length"]
        }
      },
      {
        name: "sheets_insertRange",
        description: "Insert empty cells and shift existing cells. Maps directly to InsertRangeRequest in batchUpdate API.",
        inputSchema: {
          type: "object",
          properties: {
            spreadsheetId: { type: "string", description: "Spreadsheet ID" },
            sheetId: { type: "number", description: "Sheet ID" },
            startRowIndex: { type: "number", description: "Start row index (0-based, inclusive)" },
            endRowIndex: { type: "number", description: "End row index (0-based, exclusive)" },
            startColumnIndex: { type: "number", description: "Start column index (0-based, inclusive)" },
            endColumnIndex: { type: "number", description: "End column index (0-based, exclusive)" },
            shiftDimension: { type: "string", enum: ["ROWS", "COLUMNS"], description: "Direction to shift existing cells" }
          },
          required: ["spreadsheetId", "sheetId", "startRowIndex", "endRowIndex", "startColumnIndex", "endColumnIndex", "shiftDimension"]
        }
      },
      {
        name: "sheets_deleteRange",
        description: "Delete cells and shift remaining cells. Maps directly to DeleteRangeRequest in batchUpdate API.",
        inputSchema: {
          type: "object",
          properties: {
            spreadsheetId: { type: "string", description: "Spreadsheet ID" },
            sheetId: { type: "number", description: "Sheet ID" },
            startRowIndex: { type: "number", description: "Start row index (0-based, inclusive)" },
            endRowIndex: { type: "number", description: "End row index (0-based, exclusive)" },
            startColumnIndex: { type: "number", description: "Start column index (0-based, inclusive)" },
            endColumnIndex: { type: "number", description: "End column index (0-based, exclusive)" },
            shiftDimension: { type: "string", enum: ["ROWS", "COLUMNS"], description: "Direction to shift remaining cells" }
          },
          required: ["spreadsheetId", "sheetId", "startRowIndex", "endRowIndex", "startColumnIndex", "endColumnIndex", "shiftDimension"]
        }
      },
      {
        name: "sheets_copyPaste",
        description: "Copy data/formatting from source to destination. Maps directly to CopyPasteRequest in batchUpdate API.",
        inputSchema: {
          type: "object",
          properties: {
            spreadsheetId: { type: "string", description: "Spreadsheet ID" },
            sourceSheetId: { type: "number", description: "Source sheet ID" },
            sourceStartRowIndex: { type: "number", description: "Source start row (0-based, inclusive)" },
            sourceEndRowIndex: { type: "number", description: "Source end row (0-based, exclusive)" },
            sourceStartColumnIndex: { type: "number", description: "Source start column (0-based, inclusive)" },
            sourceEndColumnIndex: { type: "number", description: "Source end column (0-based, exclusive)" },
            destinationSheetId: { type: "number", description: "Destination sheet ID" },
            destinationStartRowIndex: { type: "number", description: "Destination start row (0-based, inclusive)" },
            destinationEndRowIndex: { type: "number", description: "Destination end row (0-based, exclusive)" },
            destinationStartColumnIndex: { type: "number", description: "Destination start column (0-based, inclusive)" },
            destinationEndColumnIndex: { type: "number", description: "Destination end column (0-based, exclusive)" },
            pasteType: { type: "string", enum: ["PASTE_NORMAL", "PASTE_VALUES", "PASTE_FORMAT", "PASTE_NO_BORDERS", "PASTE_FORMULA", "PASTE_DATA_VALIDATION", "PASTE_CONDITIONAL_FORMATTING"], description: "What to paste", optional: true },
            pasteOrientation: { type: "string", enum: ["NORMAL", "TRANSPOSE"], description: "Paste orientation", optional: true }
          },
          required: ["spreadsheetId", "sourceSheetId", "sourceStartRowIndex", "sourceEndRowIndex", "sourceStartColumnIndex", "sourceEndColumnIndex", "destinationSheetId", "destinationStartRowIndex", "destinationEndRowIndex", "destinationStartColumnIndex", "destinationEndColumnIndex"]
        }
      },
      {
        name: "sheets_cutPaste",
        description: "Cut data from source and paste to destination. Maps directly to CutPasteRequest in batchUpdate API.",
        inputSchema: {
          type: "object",
          properties: {
            spreadsheetId: { type: "string", description: "Spreadsheet ID" },
            sourceSheetId: { type: "number", description: "Source sheet ID" },
            sourceStartRowIndex: { type: "number", description: "Source start row (0-based, inclusive)" },
            sourceEndRowIndex: { type: "number", description: "Source end row (0-based, exclusive)" },
            sourceStartColumnIndex: { type: "number", description: "Source start column (0-based, inclusive)" },
            sourceEndColumnIndex: { type: "number", description: "Source end column (0-based, exclusive)" },
            destinationSheetId: { type: "number", description: "Destination sheet ID" },
            destinationRowIndex: { type: "number", description: "Destination top-left row (0-based)" },
            destinationColumnIndex: { type: "number", description: "Destination top-left column (0-based)" },
            pasteType: { type: "string", enum: ["PASTE_NORMAL", "PASTE_VALUES", "PASTE_FORMAT", "PASTE_NO_BORDERS", "PASTE_FORMULA", "PASTE_DATA_VALIDATION", "PASTE_CONDITIONAL_FORMATTING"], description: "What to paste", optional: true }
          },
          required: ["spreadsheetId", "sourceSheetId", "sourceStartRowIndex", "sourceEndRowIndex", "sourceStartColumnIndex", "sourceEndColumnIndex", "destinationSheetId", "destinationRowIndex", "destinationColumnIndex"]
        }
      },
      {
        name: "sheets_autoResizeDimensions",
        description: "Auto-resize row heights or column widths to fit content. Maps directly to AutoResizeDimensionsRequest in batchUpdate API.",
        inputSchema: {
          type: "object",
          properties: {
            spreadsheetId: { type: "string", description: "Spreadsheet ID" },
            sheetId: { type: "number", description: "Sheet ID" },
            dimension: { type: "string", enum: ["ROWS", "COLUMNS"], description: "Auto-resize rows or columns" },
            startIndex: { type: "number", description: "Starting index (0-based, inclusive)" },
            endIndex: { type: "number", description: "Ending index (0-based, exclusive)" }
          },
          required: ["spreadsheetId", "sheetId", "dimension", "startIndex", "endIndex"]
        }
      },
      {
        name: "sheets_unmergeCells",
        description: "Unmerge cells in a range. Maps directly to UnmergeCellsRequest in batchUpdate API.",
        inputSchema: {
          type: "object",
          properties: {
            spreadsheetId: { type: "string", description: "Spreadsheet ID" },
            sheetId: { type: "number", description: "Sheet ID" },
            startRowIndex: { type: "number", description: "Start row index (0-based, inclusive)" },
            endRowIndex: { type: "number", description: "End row index (0-based, exclusive)" },
            startColumnIndex: { type: "number", description: "Start column index (0-based, inclusive)" },
            endColumnIndex: { type: "number", description: "End column index (0-based, exclusive)" }
          },
          required: ["spreadsheetId", "sheetId", "startRowIndex", "endRowIndex", "startColumnIndex", "endColumnIndex"]
        }
      },
      {
        name: "sheets_addNamedRange",
        description: "Create a named range. Maps directly to AddNamedRangeRequest in batchUpdate API.",
        inputSchema: {
          type: "object",
          properties: {
            spreadsheetId: { type: "string", description: "Spreadsheet ID" },
            name: { type: "string", description: "Name for the range" },
            sheetId: { type: "number", description: "Sheet ID" },
            startRowIndex: { type: "number", description: "Start row index (0-based, inclusive)" },
            endRowIndex: { type: "number", description: "End row index (0-based, exclusive)" },
            startColumnIndex: { type: "number", description: "Start column index (0-based, inclusive)" },
            endColumnIndex: { type: "number", description: "End column index (0-based, exclusive)" }
          },
          required: ["spreadsheetId", "name", "sheetId", "startRowIndex", "endRowIndex", "startColumnIndex", "endColumnIndex"]
        }
      },
      {
        name: "sheets_deleteNamedRange",
        description: "Delete a named range. Maps directly to DeleteNamedRangeRequest in batchUpdate API.",
        inputSchema: {
          type: "object",
          properties: {
            spreadsheetId: { type: "string", description: "Spreadsheet ID" },
            namedRangeId: { type: "string", description: "ID of the named range to delete" }
          },
          required: ["spreadsheetId", "namedRangeId"]
        }
      },
      {
        name: "sheets_sortRange",
        description: "Sort data in a range. Maps directly to SortRangeRequest in batchUpdate API.",
        inputSchema: {
          type: "object",
          properties: {
            spreadsheetId: { type: "string", description: "Spreadsheet ID" },
            sheetId: { type: "number", description: "Sheet ID" },
            startRowIndex: { type: "number", description: "Start row index (0-based, inclusive)" },
            endRowIndex: { type: "number", description: "End row index (0-based, exclusive)" },
            startColumnIndex: { type: "number", description: "Start column index (0-based, inclusive)" },
            endColumnIndex: { type: "number", description: "End column index (0-based, exclusive)" },
            sortSpecs: {
              type: "array",
              description: "Sort specifications",
              items: {
                type: "object",
                properties: {
                  dimensionIndex: { type: "number", description: "Column index to sort by (0-based)" },
                  sortOrder: { type: "string", enum: ["ASCENDING", "DESCENDING"], description: "Sort order" }
                },
                required: ["dimensionIndex", "sortOrder"]
              }
            }
          },
          required: ["spreadsheetId", "sheetId", "startRowIndex", "endRowIndex", "startColumnIndex", "endColumnIndex", "sortSpecs"]
        }
      },
      {
        name: "sheets_setBasicFilter",
        description: "Set a basic filter on a range. Maps directly to SetBasicFilterRequest in batchUpdate API.",
        inputSchema: {
          type: "object",
          properties: {
            spreadsheetId: { type: "string", description: "Spreadsheet ID" },
            sheetId: { type: "number", description: "Sheet ID" },
            startRowIndex: { type: "number", description: "Start row index (0-based, inclusive)" },
            endRowIndex: { type: "number", description: "End row index (0-based, exclusive)" },
            startColumnIndex: { type: "number", description: "Start column index (0-based, inclusive)" },
            endColumnIndex: { type: "number", description: "End column index (0-based, exclusive)" }
          },
          required: ["spreadsheetId", "sheetId", "startRowIndex", "endRowIndex", "startColumnIndex", "endColumnIndex"]
        }
      },
      {
        name: "sheets_clearBasicFilter",
        description: "Clear the basic filter on a sheet. Maps directly to ClearBasicFilterRequest in batchUpdate API.",
        inputSchema: {
          type: "object",
          properties: {
            spreadsheetId: { type: "string", description: "Spreadsheet ID" },
            sheetId: { type: "number", description: "Sheet ID to clear filter from" }
          },
          required: ["spreadsheetId", "sheetId"]
        }
      },
      {
        name: "sheets_findReplace",
        description: "Find and replace text or values. Maps directly to FindReplaceRequest in batchUpdate API.",
        inputSchema: {
          type: "object",
          properties: {
            spreadsheetId: { type: "string", description: "Spreadsheet ID" },
            find: { type: "string", description: "Text to find" },
            replacement: { type: "string", description: "Replacement text" },
            matchCase: { type: "boolean", description: "Case-sensitive search", optional: true },
            matchEntireCell: { type: "boolean", description: "Match entire cell content", optional: true },
            searchByRegex: { type: "boolean", description: "Use regex pattern", optional: true },
            includeFormulas: { type: "boolean", description: "Search in formulas", optional: true },
            sheetId: { type: "number", description: "Optional sheet ID to limit search", optional: true },
            startRowIndex: { type: "number", description: "Optional start row", optional: true },
            endRowIndex: { type: "number", description: "Optional end row", optional: true },
            startColumnIndex: { type: "number", description: "Optional start column", optional: true },
            endColumnIndex: { type: "number", description: "Optional end column", optional: true },
            allSheets: { type: "boolean", description: "Search all sheets", optional: true }
          },
          required: ["spreadsheetId", "find", "replacement"]
        }
      },
      {
        name: "sheets_textToColumns",
        description: "Split text in cells into multiple columns. Maps directly to TextToColumnsRequest in batchUpdate API.",
        inputSchema: {
          type: "object",
          properties: {
            spreadsheetId: { type: "string", description: "Spreadsheet ID" },
            sheetId: { type: "number", description: "Sheet ID" },
            startRowIndex: { type: "number", description: "Start row index (0-based, inclusive)" },
            endRowIndex: { type: "number", description: "End row index (0-based, exclusive)" },
            startColumnIndex: { type: "number", description: "Start column index (0-based, inclusive)" },
            endColumnIndex: { type: "number", description: "End column index (0-based, exclusive)" },
            delimiterType: { type: "string", enum: ["COMMA", "SEMICOLON", "PERIOD", "SPACE", "CUSTOM", "AUTODETECT"], description: "Delimiter type" },
            delimiter: { type: "string", description: "Custom delimiter (required if delimiterType is CUSTOM)", optional: true }
          },
          required: ["spreadsheetId", "sheetId", "startRowIndex", "endRowIndex", "startColumnIndex", "endColumnIndex", "delimiterType"]
        }
      },
      {
        name: "sheets_trimWhitespace",
        description: "Remove leading and trailing whitespace from cells. Maps directly to TrimWhitespaceRequest in batchUpdate API.",
        inputSchema: {
          type: "object",
          properties: {
            spreadsheetId: { type: "string", description: "Spreadsheet ID" },
            sheetId: { type: "number", description: "Sheet ID" },
            startRowIndex: { type: "number", description: "Start row index (0-based, inclusive)" },
            endRowIndex: { type: "number", description: "End row index (0-based, exclusive)" },
            startColumnIndex: { type: "number", description: "Start column index (0-based, inclusive)" },
            endColumnIndex: { type: "number", description: "End column index (0-based, exclusive)" }
          },
          required: ["spreadsheetId", "sheetId", "startRowIndex", "endRowIndex", "startColumnIndex", "endColumnIndex"]
        }
      },
      {
        name: "sheets_deleteDuplicates",
        description: "Remove duplicate rows from a range. Maps directly to DeleteDuplicatesRequest in batchUpdate API.",
        inputSchema: {
          type: "object",
          properties: {
            spreadsheetId: { type: "string", description: "Spreadsheet ID" },
            sheetId: { type: "number", description: "Sheet ID" },
            startRowIndex: { type: "number", description: "Start row index (0-based, inclusive)" },
            endRowIndex: { type: "number", description: "End row index (0-based, exclusive)" },
            startColumnIndex: { type: "number", description: "Start column index (0-based, inclusive)" },
            endColumnIndex: { type: "number", description: "End column index (0-based, exclusive)" },
            comparisonColumns: {
              type: "array",
              description: "Columns to use for duplicate comparison",
              items: {
                type: "object",
                properties: {
                  sheetId: { type: "number", description: "Sheet ID" },
                  dimension: { type: "string", enum: ["ROWS", "COLUMNS"], description: "Dimension type" },
                  startIndex: { type: "number", description: "Start index (0-based, inclusive)" },
                  endIndex: { type: "number", description: "End index (0-based, exclusive)" }
                },
                required: ["sheetId", "dimension", "startIndex", "endIndex"]
              }
            }
          },
          required: ["spreadsheetId", "sheetId", "startRowIndex", "endRowIndex", "startColumnIndex", "endColumnIndex", "comparisonColumns"]
        }
      },
      {
        name: "docs_updateTextStyle",
        description: "Apply text formatting to a range in a Google Doc. Maps directly to UpdateTextStyleRequest in batchUpdate API.",
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
        name: "docs_updateParagraphStyle",
        description: "Apply paragraph formatting to a range in a Google Doc. Maps directly to UpdateParagraphStyleRequest in batchUpdate API.",
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
        name: "docs_get",
        description: `Get a Google Docs document. Maps to documents.get in Google Docs API. Returns complete Document object with all content, styles, and metadata as raw JSON.

⚠️ TOKEN WARNING: Returns full document structure with all formatting metadata. Can consume 25k+ tokens for moderate documents.

WHEN TO USE:
✓ Need detailed formatting information (fonts, colors, styles)
✓ Analyzing document structure (heading hierarchy, table layouts)
✓ Programmatic editing/manipulation of specific elements
✓ Need precise positioning for content insertions
✓ Working with or modifying formatting properties

WHEN NOT TO USE (use drive_exportFile instead):
✗ Only need document content/text
✗ Creating summaries or extracting information
✗ Searching for specific content
✗ Want maximum token efficiency (drive_exportFile to markdown = 60-65% reduction)

For content-only needs, use drive_exportFile with mimeType 'text/markdown' or 'text/plain' instead.`,
        inputSchema: {
          type: "object",
          properties: {
            documentId: { type: "string", description: "The ID of the document" },
            includeTabsContent: { type: "boolean", description: "Whether to include tab content (default: false)", optional: true }
          },
          required: ["documentId"]
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
        name: "slides_updateTextStyle",
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
        name: "slides_updateParagraphStyle",
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
        name: "slides_updateShapeProperties",
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
        name: "slides_updatePageProperties",
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
        name: "slides_createTextBox",
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
        name: "slides_createShape",
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
      },
      {
        name: "slides_createPresentation",
        description: "Create a new Google Slides presentation. Maps directly to presentations.create in Google Slides API. Returns newly created Presentation object with ID, title, and initial slide.",
        inputSchema: {
          type: "object",
          properties: {
            title: { type: "string", description: "Presentation title (optional)" },
            locale: { type: "string", description: "Locale (e.g., 'en_US') (optional)" },
            pageSize: {
              type: "object",
              description: "Page dimensions (optional)",
              properties: {
                width: {
                  type: "object",
                  properties: {
                    magnitude: { type: "number", description: "Width value" },
                    unit: { type: "string", enum: ["EMU", "PT"], description: "Unit: EMU or PT" }
                  },
                  required: ["magnitude", "unit"]
                },
                height: {
                  type: "object",
                  properties: {
                    magnitude: { type: "number", description: "Height value" },
                    unit: { type: "string", enum: ["EMU", "PT"], description: "Unit: EMU or PT" }
                  },
                  required: ["magnitude", "unit"]
                }
              },
              required: ["width", "height"]
            }
          }
        }
      },
      {
        name: "slides_createSlide",
        description: "Create a new slide at specified position. Maps directly to CreateSlideRequest in presentations.batchUpdate. Returns batchUpdate response with new slide objectId.",
        inputSchema: {
          type: "object",
          properties: {
            presentationId: { type: "string", description: "Presentation ID" },
            insertionIndex: { type: "number", description: "Position to insert slide (0-based, optional)" },
            objectId: { type: "string", description: "Optional custom object ID for new slide" },
            slideLayoutReference: {
              type: "object",
              description: "Layout to use (optional)",
              properties: {
                predefinedLayout: { type: "string", description: "Predefined layout name (e.g., 'TITLE_AND_BODY')" },
                layoutId: { type: "string", description: "Custom layout ID" }
              }
            },
            placeholderIdMappings: {
              type: "array",
              description: "Placeholder ID mappings (optional)",
              items: {
                type: "object",
                properties: {
                  layoutPlaceholder: {
                    type: "object",
                    properties: {
                      type: { type: "string", description: "Placeholder type" },
                      index: { type: "number", description: "Placeholder index (optional)" }
                    },
                    required: ["type"]
                  },
                  objectId: { type: "string", description: "Object ID for placeholder" }
                },
                required: ["layoutPlaceholder", "objectId"]
              }
            }
          },
          required: ["presentationId"]
        }
      },
      {
        name: "slides_deleteObject",
        description: "Delete a slide or page element. Maps directly to DeleteObjectRequest in presentations.batchUpdate. Returns batchUpdate response.",
        inputSchema: {
          type: "object",
          properties: {
            presentationId: { type: "string", description: "Presentation ID" },
            objectId: { type: "string", description: "ID of slide or element to delete" }
          },
          required: ["presentationId", "objectId"]
        }
      },
      {
        name: "slides_updateSlidesPosition",
        description: "Reorder slides in presentation. Maps directly to UpdateSlidesPositionRequest in presentations.batchUpdate. Returns batchUpdate response.",
        inputSchema: {
          type: "object",
          properties: {
            presentationId: { type: "string", description: "Presentation ID" },
            slideObjectIds: { type: "array", items: { type: "string" }, description: "Slide IDs in desired order" },
            insertionIndex: { type: "number", description: "Position to move slides to (0-based)" }
          },
          required: ["presentationId", "slideObjectIds", "insertionIndex"]
        }
      },
      {
        name: "slides_duplicateObject",
        description: "Duplicate a slide or page element. Maps directly to DuplicateObjectRequest in presentations.batchUpdate. Returns batchUpdate response with new object ID.",
        inputSchema: {
          type: "object",
          properties: {
            presentationId: { type: "string", description: "Presentation ID" },
            objectId: { type: "string", description: "ID of slide or element to duplicate" },
            objectIds: { type: "object", description: "Optional ID mappings for duplicated objects (record of old ID to new ID)" }
          },
          required: ["presentationId", "objectId"]
        }
      },
      {
        name: "slides_insertText",
        description: "Insert text into a shape or table cell. Maps directly to InsertTextRequest in presentations.batchUpdate. Returns batchUpdate response.",
        inputSchema: {
          type: "object",
          properties: {
            presentationId: { type: "string", description: "Presentation ID" },
            objectId: { type: "string", description: "ID of the shape or table containing the text" },
            text: { type: "string", description: "Text to insert" },
            insertionIndex: { type: "number", description: "Optional 0-based insertion index. If omitted, text is appended." },
            cellLocation: {
              type: "object",
              description: "Optional table cell location. Required if objectId is a table.",
              properties: {
                rowIndex: { type: "number", description: "Row index (0-based)" },
                columnIndex: { type: "number", description: "Column index (0-based)" }
              },
              required: ["rowIndex", "columnIndex"]
            }
          },
          required: ["presentationId", "objectId", "text"]
        }
      },
      {
        name: "slides_deleteText",
        description: "Delete text from a shape or table cell. Maps directly to DeleteTextRequest in presentations.batchUpdate. Returns batchUpdate response.",
        inputSchema: {
          type: "object",
          properties: {
            presentationId: { type: "string", description: "Presentation ID" },
            objectId: { type: "string", description: "ID of the shape or table containing the text" },
            textRange: {
              type: "object",
              description: "Optional text range to delete. If omitted, all text is deleted.",
              properties: {
                startIndex: { type: "number", description: "Start index (0-based, inclusive)" },
                endIndex: { type: "number", description: "End index (0-based, exclusive)" },
                type: { type: "string", enum: ["FIXED_RANGE", "FROM_START_INDEX", "ALL"], description: "Range type" }
              }
            },
            cellLocation: {
              type: "object",
              description: "Optional table cell location. Required if objectId is a table.",
              properties: {
                rowIndex: { type: "number", description: "Row index (0-based)" },
                columnIndex: { type: "number", description: "Column index (0-based)" }
              },
              required: ["rowIndex", "columnIndex"]
            }
          },
          required: ["presentationId", "objectId"]
        }
      },
      {
        name: "slides_replaceAllText",
        description: "Find and replace all instances of text. Maps directly to ReplaceAllTextRequest in presentations.batchUpdate. Returns batchUpdate response with occurrence count.",
        inputSchema: {
          type: "object",
          properties: {
            presentationId: { type: "string", description: "Presentation ID" },
            containsText: {
              type: "object",
              description: "Text search criteria",
              properties: {
                text: { type: "string", description: "Text to search for" },
                matchCase: { type: "boolean", description: "Whether to match case (default: false)" }
              },
              required: ["text"]
            },
            replaceText: { type: "string", description: "Replacement text" },
            pageObjectIds: {
              type: "array",
              items: { type: "string" },
              description: "Optional array of slide IDs to limit search scope"
            }
          },
          required: ["presentationId", "containsText", "replaceText"]
        }
      },
      {
        name: "slides_createParagraphBullets",
        description: "Add bullets to paragraphs. Maps directly to CreateParagraphBulletsRequest in presentations.batchUpdate. Returns batchUpdate response.",
        inputSchema: {
          type: "object",
          properties: {
            presentationId: { type: "string", description: "Presentation ID" },
            objectId: { type: "string", description: "ID of the shape or table containing the text" },
            textRange: {
              type: "object",
              description: "Optional text range. If omitted, applies to all text.",
              properties: {
                startIndex: { type: "number", description: "Start index (0-based, inclusive)" },
                endIndex: { type: "number", description: "End index (0-based, exclusive)" },
                type: { type: "string", enum: ["FIXED_RANGE", "FROM_START_INDEX", "ALL"], description: "Range type" }
              }
            },
            bulletPreset: {
              type: "string",
              enum: [
                "BULLET_DISC_CIRCLE_SQUARE",
                "BULLET_DIAMONDX_ARROW3D_SQUARE",
                "BULLET_CHECKBOX",
                "BULLET_ARROW_DIAMOND_DISC",
                "BULLET_STAR_CIRCLE_SQUARE",
                "BULLET_ARROW3D_CIRCLE_SQUARE",
                "BULLET_LEFTTRIANGLE_DIAMOND_DISC",
                "BULLET_DIAMONDX_HOLLOWDIAMOND_SQUARE",
                "BULLET_DIAMOND_CIRCLE_SQUARE",
                "NUMBERED_DIGIT_ALPHA_ROMAN",
                "NUMBERED_DIGIT_ALPHA_ROMAN_PARENS",
                "NUMBERED_DIGIT_NESTED",
                "NUMBERED_UPPERALPHA_ALPHA_ROMAN",
                "NUMBERED_UPPERROMAN_UPPERALPHA_DIGIT",
                "NUMBERED_ZERODECIMAL_ALPHA_ROMAN"
              ],
              description: "Optional bullet style preset"
            },
            cellLocation: {
              type: "object",
              description: "Optional table cell location. Required if objectId is a table.",
              properties: {
                rowIndex: { type: "number", description: "Row index (0-based)" },
                columnIndex: { type: "number", description: "Column index (0-based)" }
              },
              required: ["rowIndex", "columnIndex"]
            }
          },
          required: ["presentationId", "objectId"]
        }
      },
      {
        name: "slides_updatePageElementTransform",
        description: "Move, scale, rotate, or skew a page element. Maps directly to UpdatePageElementTransformRequest in presentations.batchUpdate. Returns batchUpdate response.",
        inputSchema: {
          type: "object",
          properties: {
            presentationId: { type: "string", description: "Presentation ID" },
            objectId: { type: "string", description: "ID of the page element to transform" },
            transform: {
              type: "object",
              description: "Transformation matrix parameters",
              properties: {
                scaleX: { type: "number", description: "Horizontal scale factor" },
                scaleY: { type: "number", description: "Vertical scale factor" },
                shearX: { type: "number", description: "Horizontal shear factor" },
                shearY: { type: "number", description: "Vertical shear factor" },
                translateX: { type: "number", description: "Horizontal translation" },
                translateY: { type: "number", description: "Vertical translation" },
                unit: { type: "string", enum: ["EMU", "PT"], description: "Unit for translation (EMU or PT)" }
              }
            },
            applyMode: {
              type: "string",
              enum: ["RELATIVE", "ABSOLUTE"],
              description: "Whether to apply transform relative to current state or absolute"
            }
          },
          required: ["presentationId", "objectId", "transform"]
        }
      },
      {
        name: "slides_createImage",
        description: "Insert an image onto a slide. Maps directly to CreateImageRequest in presentations.batchUpdate. Returns batchUpdate response with created image ID.",
        inputSchema: {
          type: "object",
          properties: {
            presentationId: { type: "string", description: "Presentation ID" },
            pageObjectId: { type: "string", description: "Slide ID where image will be inserted" },
            url: { type: "string", format: "uri", description: "Public URL of the image" },
            elementProperties: {
              type: "object",
              description: "Optional element properties (size, transform)",
              properties: {
                pageObjectId: { type: "string", description: "Custom object ID" },
                size: {
                  type: "object",
                  properties: {
                    width: { type: "object", properties: { magnitude: { type: "number" }, unit: { type: "string", enum: ["EMU", "PT"] } } },
                    height: { type: "object", properties: { magnitude: { type: "number" }, unit: { type: "string", enum: ["EMU", "PT"] } } }
                  }
                },
                transform: {
                  type: "object",
                  properties: {
                    scaleX: { type: "number" },
                    scaleY: { type: "number" },
                    translateX: { type: "number" },
                    translateY: { type: "number" },
                    unit: { type: "string", enum: ["EMU", "PT"] }
                  }
                }
              }
            }
          },
          required: ["presentationId", "pageObjectId", "url"]
        }
      },
      {
        name: "slides_createVideo",
        description: "Embed a video on a slide. Maps directly to CreateVideoRequest in presentations.batchUpdate. Supports YouTube and Google Drive videos.",
        inputSchema: {
          type: "object",
          properties: {
            presentationId: { type: "string", description: "Presentation ID" },
            pageObjectId: { type: "string", description: "Slide ID where video will be embedded" },
            source: { type: "string", enum: ["YOUTUBE", "DRIVE"], description: "Video source" },
            id: { type: "string", description: "YouTube video ID or Google Drive file ID" },
            elementProperties: {
              type: "object",
              description: "Optional element properties",
              properties: {
                size: {
                  type: "object",
                  properties: {
                    width: { type: "object", properties: { magnitude: { type: "number" }, unit: { type: "string", enum: ["EMU", "PT"] } } },
                    height: { type: "object", properties: { magnitude: { type: "number" }, unit: { type: "string", enum: ["EMU", "PT"] } } }
                  }
                },
                transform: {
                  type: "object",
                  properties: {
                    scaleX: { type: "number" },
                    scaleY: { type: "number" },
                    translateX: { type: "number" },
                    translateY: { type: "number" },
                    unit: { type: "string", enum: ["EMU", "PT"] }
                  }
                }
              }
            }
          },
          required: ["presentationId", "pageObjectId", "source", "id"]
        }
      },
      {
        name: "slides_createLine",
        description: "Create a line or connector on a slide. Maps directly to CreateLineRequest in presentations.batchUpdate.",
        inputSchema: {
          type: "object",
          properties: {
            presentationId: { type: "string", description: "Presentation ID" },
            pageObjectId: { type: "string", description: "Slide ID where line will be created" },
            lineCategory: { type: "string", enum: ["STRAIGHT", "BENT", "CURVED"], description: "Optional line type" },
            elementProperties: {
              type: "object",
              description: "Optional element properties",
              properties: {
                size: {
                  type: "object",
                  properties: {
                    width: { type: "object", properties: { magnitude: { type: "number" }, unit: { type: "string", enum: ["EMU", "PT"] } } },
                    height: { type: "object", properties: { magnitude: { type: "number" }, unit: { type: "string", enum: ["EMU", "PT"] } } }
                  }
                },
                transform: {
                  type: "object",
                  properties: {
                    scaleX: { type: "number" },
                    scaleY: { type: "number" },
                    translateX: { type: "number" },
                    translateY: { type: "number" },
                    unit: { type: "string", enum: ["EMU", "PT"] }
                  }
                }
              }
            }
          },
          required: ["presentationId", "pageObjectId"]
        }
      },
      {
        name: "slides_createTable",
        description: "Insert a table on a slide. Maps directly to CreateTableRequest in presentations.batchUpdate.",
        inputSchema: {
          type: "object",
          properties: {
            presentationId: { type: "string", description: "Presentation ID" },
            pageObjectId: { type: "string", description: "Slide ID where table will be inserted" },
            rows: { type: "number", minimum: 1, description: "Number of rows" },
            columns: { type: "number", minimum: 1, description: "Number of columns" },
            elementProperties: {
              type: "object",
              description: "Optional element properties",
              properties: {
                size: {
                  type: "object",
                  properties: {
                    width: { type: "object", properties: { magnitude: { type: "number" }, unit: { type: "string", enum: ["EMU", "PT"] } } },
                    height: { type: "object", properties: { magnitude: { type: "number" }, unit: { type: "string", enum: ["EMU", "PT"] } } }
                  }
                },
                transform: {
                  type: "object",
                  properties: {
                    scaleX: { type: "number" },
                    scaleY: { type: "number" },
                    translateX: { type: "number" },
                    translateY: { type: "number" },
                    unit: { type: "string", enum: ["EMU", "PT"] }
                  }
                }
              }
            }
          },
          required: ["presentationId", "pageObjectId", "rows", "columns"]
        }
      },
      {
        name: "slides_createSheetsChart",
        description: "Embed a Google Sheets chart on a slide. Maps directly to CreateSheetsChartRequest in presentations.batchUpdate.",
        inputSchema: {
          type: "object",
          properties: {
            presentationId: { type: "string", description: "Presentation ID" },
            pageObjectId: { type: "string", description: "Slide ID" },
            spreadsheetId: { type: "string", description: "Google Sheets spreadsheet ID" },
            chartId: { type: "number", minimum: 0, description: "Chart ID from the spreadsheet" },
            linkingMode: { type: "string", enum: ["LINKED", "NOT_LINKED_IMAGE"], description: "Optional linking mode" },
            elementProperties: { type: "object", description: "Optional element properties" }
          },
          required: ["presentationId", "pageObjectId", "spreadsheetId", "chartId"]
        }
      },
      {
        name: "slides_refreshSheetsChart",
        description: "Refresh a linked Sheets chart. Maps directly to RefreshSheetsChartRequest in presentations.batchUpdate.",
        inputSchema: {
          type: "object",
          properties: {
            presentationId: { type: "string", description: "Presentation ID" },
            objectId: { type: "string", description: "Chart object ID to refresh" }
          },
          required: ["presentationId", "objectId"]
        }
      },
      {
        name: "slides_updateImageProperties",
        description: "Adjust image properties (brightness, contrast, etc.). Maps directly to UpdateImagePropertiesRequest in presentations.batchUpdate.",
        inputSchema: {
          type: "object",
          properties: {
            presentationId: { type: "string", description: "Presentation ID" },
            objectId: { type: "string", description: "Image object ID" },
            imageProperties: {
              type: "object",
              description: "Image properties to update",
              properties: {
                brightness: { type: "number", minimum: -1, maximum: 1, description: "Brightness (-1 to 1)" },
                contrast: { type: "number", minimum: -1, maximum: 1, description: "Contrast (-1 to 1)" },
                transparency: { type: "number", minimum: 0, maximum: 1, description: "Transparency (0 to 1)" }
              }
            }
          },
          required: ["presentationId", "objectId"]
        }
      },
      {
        name: "slides_updateVideoProperties",
        description: "Configure video playback properties. Maps directly to UpdateVideoPropertiesRequest in presentations.batchUpdate.",
        inputSchema: {
          type: "object",
          properties: {
            presentationId: { type: "string", description: "Presentation ID" },
            objectId: { type: "string", description: "Video object ID" },
            videoProperties: {
              type: "object",
              description: "Video properties to update",
              properties: {
                autoPlay: { type: "boolean", description: "Auto-play on slide show" },
                start: { type: "number", minimum: 0, description: "Start time in seconds" },
                end: { type: "number", minimum: 0, description: "End time in seconds" },
                mute: { type: "boolean", description: "Mute audio" }
              }
            }
          },
          required: ["presentationId", "objectId"]
        }
      },
      {
        name: "slides_deleteParagraphBullets",
        description: "Remove bullets from paragraphs. Maps directly to DeleteParagraphBulletsRequest in presentations.batchUpdate.",
        inputSchema: {
          type: "object",
          properties: {
            presentationId: { type: "string", description: "Presentation ID" },
            objectId: { type: "string", description: "Shape or table object ID" },
            textRange: {
              type: "object",
              description: "Optional text range (defaults to all text)",
              properties: {
                type: { type: "string", enum: ["FIXED_RANGE", "FROM_START_INDEX", "ALL"], description: "Range type" },
                startIndex: { type: "number", minimum: 0, description: "Start index (0-based)" },
                endIndex: { type: "number", minimum: 0, description: "End index (0-based)" }
              }
            },
            cellLocation: {
              type: "object",
              description: "Optional table cell location",
              properties: {
                rowIndex: { type: "number", minimum: 0, description: "Row index (0-based)" },
                columnIndex: { type: "number", minimum: 0, description: "Column index (0-based)" }
              },
              required: ["rowIndex", "columnIndex"]
            }
          },
          required: ["presentationId", "objectId"]
        }
      },
      {
        name: "slides_updateLineProperties",
        description: "Update line styling (weight, dash style, arrows, color). Maps directly to UpdateLinePropertiesRequest in presentations.batchUpdate.",
        inputSchema: {
          type: "object",
          properties: {
            presentationId: { type: "string", description: "Presentation ID" },
            objectId: { type: "string", description: "Line object ID" },
            lineProperties: {
              type: "object",
              description: "Line properties to update",
              properties: {
                weight: { type: "object", description: "Line weight" },
                dashStyle: { type: "string", enum: ["SOLID", "DOT", "DASH", "DASH_DOT", "LONG_DASH", "LONG_DASH_DOT"], description: "Dash style" },
                startArrow: { type: "string", description: "Start arrow style" },
                endArrow: { type: "string", description: "End arrow style" },
                lineFill: { type: "object", description: "Line fill color" },
                link: { type: "object", description: "Optional hyperlink" }
              }
            }
          },
          required: ["presentationId", "objectId"]
        }
      },
      {
        name: "slides_updateLineCategory",
        description: "Change line category (straight, bent, curved). Maps directly to UpdateLineCategoryRequest in presentations.batchUpdate.",
        inputSchema: {
          type: "object",
          properties: {
            presentationId: { type: "string", description: "Presentation ID" },
            objectId: { type: "string", description: "Line object ID" },
            lineCategory: { type: "string", enum: ["STRAIGHT", "BENT", "CURVED"], description: "New line category" }
          },
          required: ["presentationId", "objectId", "lineCategory"]
        }
      },
      {
        name: "slides_rerouteLine",
        description: "Reroute a connector line between shapes. Maps directly to RerouteLineRequest in presentations.batchUpdate.",
        inputSchema: {
          type: "object",
          properties: {
            presentationId: { type: "string", description: "Presentation ID" },
            objectId: { type: "string", description: "Line object ID to reroute" }
          },
          required: ["presentationId", "objectId"]
        }
      },
      {
        name: "slides_insertTableRows",
        description: "Insert rows into a table. Maps directly to InsertTableRowsRequest in presentations.batchUpdate.",
        inputSchema: {
          type: "object",
          properties: {
            presentationId: { type: "string", description: "Presentation ID" },
            tableObjectId: { type: "string", description: "Table object ID" },
            cellLocation: { type: "object", description: "Reference cell location", required: ["rowIndex", "columnIndex"] },
            insertBelow: { type: "boolean", description: "Insert below (true) or above (false)" },
            number: { type: "number", minimum: 1, description: "Number of rows (default: 1)" }
          },
          required: ["presentationId", "tableObjectId", "cellLocation", "insertBelow"]
        }
      },
      {
        name: "slides_insertTableColumns",
        description: "Insert columns into a table. Maps directly to InsertTableColumnsRequest in presentations.batchUpdate.",
        inputSchema: {
          type: "object",
          properties: {
            presentationId: { type: "string", description: "Presentation ID" },
            tableObjectId: { type: "string", description: "Table object ID" },
            cellLocation: { type: "object", description: "Reference cell location", required: ["rowIndex", "columnIndex"] },
            insertRight: { type: "boolean", description: "Insert right (true) or left (false)" },
            number: { type: "number", minimum: 1, description: "Number of columns (default: 1)" }
          },
          required: ["presentationId", "tableObjectId", "cellLocation", "insertRight"]
        }
      },
      {
        name: "slides_deleteTableRow",
        description: "Delete a table row. Maps directly to DeleteTableRowRequest in presentations.batchUpdate.",
        inputSchema: {
          type: "object",
          properties: {
            presentationId: { type: "string", description: "Presentation ID" },
            tableObjectId: { type: "string", description: "Table object ID" },
            cellLocation: { type: "object", description: "Cell in row to delete", required: ["rowIndex", "columnIndex"] }
          },
          required: ["presentationId", "tableObjectId", "cellLocation"]
        }
      },
      {
        name: "slides_deleteTableColumn",
        description: "Delete a table column. Maps directly to DeleteTableColumnRequest in presentations.batchUpdate.",
        inputSchema: {
          type: "object",
          properties: {
            presentationId: { type: "string", description: "Presentation ID" },
            tableObjectId: { type: "string", description: "Table object ID" },
            cellLocation: { type: "object", description: "Cell in column to delete", required: ["rowIndex", "columnIndex"] }
          },
          required: ["presentationId", "tableObjectId", "cellLocation"]
        }
      },
      {
        name: "slides_updateTableCellProperties",
        description: "Update table cell properties (background, alignment). Maps directly to UpdateTableCellPropertiesRequest in presentations.batchUpdate.",
        inputSchema: {
          type: "object",
          properties: {
            presentationId: { type: "string", description: "Presentation ID" },
            objectId: { type: "string", description: "Table object ID" },
            tableRange: { type: "object", description: "Cell range to update" },
            tableCellProperties: { type: "object", description: "Cell properties" }
          },
          required: ["presentationId", "objectId", "tableRange"]
        }
      },
      {
        name: "slides_updateTableBorderProperties",
        description: "Update table border properties. Maps directly to UpdateTableBorderPropertiesRequest in presentations.batchUpdate.",
        inputSchema: {
          type: "object",
          properties: {
            presentationId: { type: "string", description: "Presentation ID" },
            objectId: { type: "string", description: "Table object ID" },
            tableRange: { type: "object", description: "Cell range" },
            borderPosition: { type: "string", enum: ["ALL", "BOTTOM", "INNER", "INNER_HORIZONTAL", "INNER_VERTICAL", "LEFT", "OUTER", "RIGHT", "TOP"], description: "Border position" },
            tableBorderProperties: { type: "object", description: "Border properties" }
          },
          required: ["presentationId", "objectId", "tableRange", "borderPosition"]
        }
      },
      {
        name: "slides_updateTableColumnProperties",
        description: "Update table column properties. Maps directly to UpdateTableColumnPropertiesRequest in presentations.batchUpdate.",
        inputSchema: {
          type: "object",
          properties: {
            presentationId: { type: "string", description: "Presentation ID" },
            objectId: { type: "string", description: "Table object ID" },
            columnIndices: { type: "array", items: { type: "number" }, minItems: 1, description: "Column indices" },
            tableColumnProperties: { type: "object", description: "Column properties (width)" }
          },
          required: ["presentationId", "objectId", "columnIndices", "tableColumnProperties"]
        }
      },
      {
        name: "slides_updateTableRowProperties",
        description: "Update table row properties. Maps directly to UpdateTableRowPropertiesRequest in presentations.batchUpdate.",
        inputSchema: {
          type: "object",
          properties: {
            presentationId: { type: "string", description: "Presentation ID" },
            objectId: { type: "string", description: "Table object ID" },
            rowIndices: { type: "array", items: { type: "number" }, minItems: 1, description: "Row indices" },
            tableRowProperties: { type: "object", description: "Row properties (height)" }
          },
          required: ["presentationId", "objectId", "rowIndices", "tableRowProperties"]
        }
      },
      {
        name: "slides_mergeTableCells",
        description: "Merge table cells. Maps directly to MergeTableCellsRequest in presentations.batchUpdate.",
        inputSchema: {
          type: "object",
          properties: {
            presentationId: { type: "string", description: "Presentation ID" },
            objectId: { type: "string", description: "Table object ID" },
            tableRange: { type: "object", description: "Range of cells to merge (must form rectangle)" }
          },
          required: ["presentationId", "objectId", "tableRange"]
        }
      },
      {
        name: "slides_unmergeTableCells",
        description: "Unmerge table cells. Maps directly to UnmergeTableCellsRequest in presentations.batchUpdate.",
        inputSchema: {
          type: "object",
          properties: {
            presentationId: { type: "string", description: "Presentation ID" },
            objectId: { type: "string", description: "Table object ID" },
            tableRange: { type: "object", description: "Range containing merged cells to unmerge" }
          },
          required: ["presentationId", "objectId", "tableRange"]
        }
      },
      {
        name: "slides_updatePageElementAltText",
        description: "Set alt text for accessibility. Maps directly to UpdatePageElementAltTextRequest in presentations.batchUpdate.",
        inputSchema: {
          type: "object",
          properties: {
            presentationId: { type: "string", description: "Presentation ID" },
            objectId: { type: "string", description: "Element object ID" },
            title: { type: "string", description: "Alt text title" },
            description: { type: "string", description: "Alt text description" }
          },
          required: ["presentationId", "objectId"]
        }
      },
      {
        name: "slides_updatePageElementsZOrder",
        description: "Change z-order (layering) of elements. Maps directly to UpdatePageElementsZOrderRequest in presentations.batchUpdate.",
        inputSchema: {
          type: "object",
          properties: {
            presentationId: { type: "string", description: "Presentation ID" },
            pageElementObjectIds: { type: "array", items: { type: "string" }, minItems: 1, description: "Elements to reorder" },
            operation: { type: "string", enum: ["BRING_TO_FRONT", "SEND_TO_BACK", "BRING_FORWARD", "SEND_BACKWARD"], description: "Z-order operation" }
          },
          required: ["presentationId", "pageElementObjectIds", "operation"]
        }
      },
      {
        name: "slides_groupObjects",
        description: "Group multiple elements together. Maps directly to GroupObjectsRequest in presentations.batchUpdate.",
        inputSchema: {
          type: "object",
          properties: {
            presentationId: { type: "string", description: "Presentation ID" },
            childrenObjectIds: { type: "array", items: { type: "string" }, minItems: 2, description: "Elements to group (minimum 2)" },
            groupObjectId: { type: "string", description: "Optional ID for group" }
          },
          required: ["presentationId", "childrenObjectIds"]
        }
      },
      {
        name: "slides_ungroupObjects",
        description: "Ungroup a group of elements. Maps directly to UngroupObjectsRequest in presentations.batchUpdate.",
        inputSchema: {
          type: "object",
          properties: {
            presentationId: { type: "string", description: "Presentation ID" },
            objectIds: { type: "array", items: { type: "string" }, minItems: 1, description: "Group IDs to ungroup" }
          },
          required: ["presentationId", "objectIds"]
        }
      },
      {
        name: "slides_get",
        description: "Get a Google Slides presentation. Maps directly to presentations.get in Google Slides API. Returns complete Presentation object with all content, slides, and metadata as raw JSON.",
        inputSchema: {
          type: "object",
          properties: {
            presentationId: { type: "string", description: "The ID of the presentation" }
          },
          required: ["presentationId"]
        }
      }
];

// -----------------------------------------------------------------------------
// LIST TOOLS REQUEST HANDLER
// -----------------------------------------------------------------------------
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: TOOLS_LIST
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
      case "server_getInfo": {
        const validation = ServerGetInfoSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const { includeUptime } = validation.data;

        // Build server info response
        const serverInfo: any = {
          server: {
            name: packageJson.name,
            version: VERSION,
            description: packageJson.description,
            packageName: packageJson.name
          },
          project: {
            repository: packageJson.repository?.url || packageJson.repository,
            homepage: packageJson.homepage,
            license: packageJson.license,
            author: packageJson.author
          },
          capabilities: {
            apis: ['Drive', 'Docs', 'Sheets', 'Slides'],
            authentication: 'OAuth2',
            toolCount: TOOLS_LIST.length
          }
        };

        // Add uptime if requested
        if (includeUptime) {
          const uptimeMs = Date.now() - SERVER_START_TIME;
          const uptimeSeconds = Math.floor(uptimeMs / 1000);

          // Format uptime as "Xh Ym Zs"
          const hours = Math.floor(uptimeSeconds / 3600);
          const minutes = Math.floor((uptimeSeconds % 3600) / 60);
          const seconds = uptimeSeconds % 60;

          let formatted = '';
          if (hours > 0) formatted += `${hours}h `;
          if (minutes > 0 || hours > 0) formatted += `${minutes}m `;
          formatted += `${seconds}s`;

          serverInfo.uptime = {
            seconds: uptimeSeconds,
            formatted: formatted.trim(),
            startTime: new Date(SERVER_START_TIME).toISOString()
          };
        }

        log('Server info requested', { includeUptime });

        return {
          content: [{ type: "text", text: JSON.stringify(serverInfo, null, 2) }],
          isError: false
        };
      }

      // Phase 1: Essential Drive API Operations
      case "drive_createFile": {
        const validation = DriveCreateFileSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        const fileMetadata: any = {
          name: args.name,
          mimeType: args.mimeType
        };

        if (args.parents) {
          fileMetadata.parents = args.parents;
        }
        if (args.description) {
          fileMetadata.description = args.description;
        }
        if (args.properties) {
          fileMetadata.properties = args.properties;
        }

        const createParams: any = {
          requestBody: fileMetadata,
          fields: 'id,name,mimeType,parents,createdTime,modifiedTime',
          supportsAllDrives: args.supportsAllDrives !== undefined ? args.supportsAllDrives : true
        };

        const result = await drive.files.create(createParams);

        return {
          content: [{
            type: "text",
            text: JSON.stringify(result.data, null, 2)
          }],
          isError: false
        };
      }

      case "drive_getFile": {
        const validation = DriveGetFileSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        const params: any = {
          fileId: args.fileId,
          supportsAllDrives: args.supportsAllDrives !== undefined ? args.supportsAllDrives : true
        };

        // Ensure we get the trashed field in the response to check it
        if (args.fields) {
          // If user specifies fields, ensure 'trashed' is included
          const fieldsArray = args.fields.split(',').map(f => f.trim());
          if (!fieldsArray.includes('trashed')) {
            fieldsArray.push('trashed');
          }
          params.fields = fieldsArray.join(',');
        } else {
          // If no fields specified, request trashed explicitly
          params.fields = '*';
        }

        const result = await drive.files.get(params);

        // Check if file is trashed and includeTrashed is not explicitly set to true
        const includeTrashed = args.includeTrashed !== undefined ? args.includeTrashed : false;
        if (result.data.trashed && !includeTrashed) {
          return errorResponse(`File ${args.fileId} is in trash. Set includeTrashed=true to retrieve trashed files.`);
        }

        return {
          content: [{
            type: "text",
            text: JSON.stringify(result.data, null, 2)
          }],
          isError: false
        };
      }

      case "drive_updateFile": {
        const validation = DriveUpdateFileSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        const fileMetadata: any = {};

        if (args.name !== undefined) {
          fileMetadata.name = args.name;
        }
        if (args.mimeType !== undefined) {
          fileMetadata.mimeType = args.mimeType;
        }
        if (args.parents !== undefined) {
          fileMetadata.parents = args.parents;
        }
        if (args.trashed !== undefined) {
          fileMetadata.trashed = args.trashed;
        }
        if (args.description !== undefined) {
          fileMetadata.description = args.description;
        }
        if (args.properties !== undefined) {
          fileMetadata.properties = args.properties;
        }

        const updateParams: any = {
          fileId: args.fileId,
          requestBody: fileMetadata,
          fields: 'id,name,mimeType,parents,modifiedTime,trashed',
          supportsAllDrives: args.supportsAllDrives !== undefined ? args.supportsAllDrives : true
        };

        const result = await drive.files.update(updateParams);

        return {
          content: [{
            type: "text",
            text: JSON.stringify(result.data, null, 2)
          }],
          isError: false
        };
      }

      case "drive_deleteFile": {
        const validation = DriveDeleteFileSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        const params: any = {
          fileId: args.fileId,
          supportsAllDrives: args.supportsAllDrives !== undefined ? args.supportsAllDrives : true
        };

        await drive.files.delete(params);

        return {
          content: [{
            type: "text",
            text: JSON.stringify({ success: true, fileId: args.fileId, message: "File permanently deleted" }, null, 2)
          }],
          isError: false
        };
      }

      case "drive_listFiles": {
        const validation = DriveListFilesSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        const params: any = {};

        // Handle query parameter with automatic trash filtering
        let query = args.q || '';

        // Check if query already contains "trashed" filter
        const hasTrashedFilter = /trashed\s*=/.test(query);

        if (!hasTrashedFilter) {
          // Default to excluding trashed files unless explicitly requested
          const includeTrashed = args.includeTrashed !== undefined ? args.includeTrashed : false;
          const trashedFilter = includeTrashed ? 'trashed = true' : 'trashed = false';

          // Append trash filter to query
          if (query.length > 0) {
            query = `(${query}) and ${trashedFilter}`;
          } else {
            query = trashedFilter;
          }
        }

        params.q = query;

        if (args.pageSize) {
          params.pageSize = args.pageSize;
        }
        if (args.pageToken) {
          params.pageToken = args.pageToken;
        }
        if (args.orderBy) {
          params.orderBy = args.orderBy;
        }
        if (args.fields) {
          params.fields = args.fields;
        }
        if (args.spaces) {
          params.spaces = args.spaces;
        }
        if (args.corpora) {
          params.corpora = args.corpora;
        }

        // Default to true for shared drive support
        params.includeItemsFromAllDrives = args.includeItemsFromAllDrives !== undefined ? args.includeItemsFromAllDrives : true;
        params.supportsAllDrives = args.supportsAllDrives !== undefined ? args.supportsAllDrives : true;

        const result = await drive.files.list(params);

        return {
          content: [{
            type: "text",
            text: JSON.stringify(result.data, null, 2)
          }],
          isError: false
        };
      }

      // Phase 2: File Utilities
      case "drive_copyFile": {
        const validation = DriveCopyFileSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        const requestBody: any = {};

        if (args.name) {
          requestBody.name = args.name;
        }
        if (args.parents) {
          requestBody.parents = args.parents;
        }
        if (args.description) {
          requestBody.description = args.description;
        }
        if (args.properties) {
          requestBody.properties = args.properties;
        }

        const params: any = {
          fileId: args.fileId,
          requestBody,
          fields: 'id,name,mimeType,parents,createdTime,modifiedTime',
          supportsAllDrives: args.supportsAllDrives !== undefined ? args.supportsAllDrives : true
        };

        const result = await drive.files.copy(params);

        return {
          content: [{
            type: "text",
            text: JSON.stringify(result.data, null, 2)
          }],
          isError: false
        };
      }

      case "drive_exportFile": {
        const validation = DriveExportFileSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        const exportParams: any = {
          fileId: args.fileId,
          mimeType: args.mimeType,
          supportsAllDrives: args.supportsAllDrives !== undefined ? args.supportsAllDrives : true
        };

        const result = await drive.files.export(exportParams, {
          responseType: 'arraybuffer'
        });

        const buffer = Buffer.from(result.data as ArrayBuffer);
        const isTextFormat = args.mimeType.startsWith('text/') || args.mimeType === 'application/json';
        const contentText = isTextFormat ? buffer.toString('utf-8') : '';

        // Handle returnMode (Issue #26)
        if (args.returnMode === 'summary') {
          // Get file metadata for summary
          const fileInfo = await drive.files.get({
            fileId: args.fileId,
            fields: 'name,mimeType',
            supportsAllDrives: true
          });

          // Cache the content for later Resource access
          if (isTextFormat) {
            cacheStore(args.fileId, { mimeType: args.mimeType }, contentText, 'file');
          }

          const summary = {
            fileName: fileInfo.data.name || 'unknown',
            fileId: args.fileId,
            exportMimeType: args.mimeType,
            characterCount: isTextFormat ? contentText.length : buffer.length,
            isTextFormat,
            resourceUri: isTextFormat
              ? `gdrive://files/${args.fileId}/content/{start}-{end}`
              : null,
            hint: isTextFormat
              ? `Use resources/read with content URI to access data. Example: gdrive://files/${args.fileId}/content/0-5000`
              : 'Binary format - use returnMode: "full" to get base64-encoded content'
          };

          return {
            content: [{
              type: "text",
              text: JSON.stringify(summary, null, 2)
            }],
            isError: false
          };
        }

        // returnMode: 'full' - return complete response with truncation
        const base64Data = buffer.toString('base64');
        const fullResponse = JSON.stringify({
          mimeType: args.mimeType,
          data: base64Data,
          encoding: 'base64'
        }, null, 2);

        const truncated = truncateResponse(fullResponse, {
          hint: `Use returnMode: 'summary' to get metadata and cache content for chunk access via gdrive://files/${args.fileId}/content/{start}-{end}`
        });

        return {
          content: [{
            type: "text",
            text: truncated.text
          }],
          isError: false
        };
      }

      // Phase 3: Comments & Collaboration
      case "drive_createComment": {
        const validation = DriveCreateCommentSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        const requestBody: any = {
          content: args.content
        };

        if (args.anchor) {
          requestBody.anchor = args.anchor;
        }
        if (args.quotedFileContent) {
          requestBody.quotedFileContent = args.quotedFileContent;
        }

        const result = await drive.comments.create({
          fileId: args.fileId,
          requestBody,
          fields: 'id,content,author,createdTime,modifiedTime,resolved'
        });

        return {
          content: [{
            type: "text",
            text: JSON.stringify(result.data, null, 2)
          }],
          isError: false
        };
      }

      case "drive_listComments": {
        const validation = DriveListCommentsSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        const params: any = {
          fileId: args.fileId
        };

        if (args.pageSize) {
          params.pageSize = args.pageSize;
        }
        if (args.pageToken) {
          params.pageToken = args.pageToken;
        }
        if (args.includeDeleted !== undefined) {
          params.includeDeleted = args.includeDeleted;
        }
        if (args.startModifiedTime) {
          params.startModifiedTime = args.startModifiedTime;
        }

        const result = await drive.comments.list(params);

        return {
          content: [{
            type: "text",
            text: JSON.stringify(result.data, null, 2)
          }],
          isError: false
        };
      }

      case "drive_getComment": {
        const validation = DriveGetCommentSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        const params: any = {
          fileId: args.fileId,
          commentId: args.commentId,
          fields: 'id,content,author,createdTime,modifiedTime,resolved,replies'
        };

        if (args.includeDeleted !== undefined) {
          params.includeDeleted = args.includeDeleted;
        }

        const result = await drive.comments.get(params);

        return {
          content: [{
            type: "text",
            text: JSON.stringify(result.data, null, 2)
          }],
          isError: false
        };
      }

      case "drive_updateComment": {
        const validation = DriveUpdateCommentSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        const result = await drive.comments.update({
          fileId: args.fileId,
          commentId: args.commentId,
          requestBody: {
            content: args.content
          },
          fields: 'id,content,author,createdTime,modifiedTime,resolved'
        });

        return {
          content: [{
            type: "text",
            text: JSON.stringify(result.data, null, 2)
          }],
          isError: false
        };
      }

      case "drive_deleteComment": {
        const validation = DriveDeleteCommentSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        await drive.comments.delete({
          fileId: args.fileId,
          commentId: args.commentId
        });

        return {
          content: [{
            type: "text",
            text: JSON.stringify({ success: true, commentId: args.commentId, message: "Comment deleted" }, null, 2)
          }],
          isError: false
        };
      }

      case "drive_createReply": {
        const validation = DriveCreateReplySchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        const requestBody: any = {
          content: args.content
        };

        if (args.action) {
          requestBody.action = args.action;
        }

        const result = await drive.replies.create({
          fileId: args.fileId,
          commentId: args.commentId,
          requestBody,
          fields: 'id,content,author,createdTime,modifiedTime,action'
        });

        return {
          content: [{
            type: "text",
            text: JSON.stringify(result.data, null, 2)
          }],
          isError: false
        };
      }

      case "drive_listReplies": {
        const validation = DriveListRepliesSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        const params: any = {
          fileId: args.fileId,
          commentId: args.commentId
        };

        if (args.pageSize) {
          params.pageSize = args.pageSize;
        }
        if (args.pageToken) {
          params.pageToken = args.pageToken;
        }
        if (args.includeDeleted !== undefined) {
          params.includeDeleted = args.includeDeleted;
        }

        const result = await drive.replies.list(params);

        return {
          content: [{
            type: "text",
            text: JSON.stringify(result.data, null, 2)
          }],
          isError: false
        };
      }

      case "drive_getReply": {
        const validation = DriveGetReplySchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        const params: any = {
          fileId: args.fileId,
          commentId: args.commentId,
          replyId: args.replyId,
          fields: 'id,content,author,createdTime,modifiedTime,action'
        };

        if (args.includeDeleted !== undefined) {
          params.includeDeleted = args.includeDeleted;
        }

        const result = await drive.replies.get(params);

        return {
          content: [{
            type: "text",
            text: JSON.stringify(result.data, null, 2)
          }],
          isError: false
        };
      }

      case "drive_updateReply": {
        const validation = DriveUpdateReplySchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        const requestBody: any = {
          content: args.content
        };

        if (args.action) {
          requestBody.action = args.action;
        }

        const result = await drive.replies.update({
          fileId: args.fileId,
          commentId: args.commentId,
          replyId: args.replyId,
          requestBody,
          fields: 'id,content,author,createdTime,modifiedTime,action'
        });

        return {
          content: [{
            type: "text",
            text: JSON.stringify(result.data, null, 2)
          }],
          isError: false
        };
      }

      case "drive_deleteReply": {
        const validation = DriveDeleteReplySchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        await drive.replies.delete({
          fileId: args.fileId,
          commentId: args.commentId,
          replyId: args.replyId
        });

        return {
          content: [{
            type: "text",
            text: JSON.stringify({ success: true, replyId: args.replyId, message: "Reply deleted" }, null, 2)
          }],
          isError: false
        };
      }

      case "drive_createPermission": {
        const validation = DriveCreatePermissionSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        const requestBody: any = {
          role: args.role,
          type: args.type
        };

        if (args.emailAddress) requestBody.emailAddress = args.emailAddress;
        if (args.domain) requestBody.domain = args.domain;

        const response = await drive.permissions.create({
          fileId: args.fileId,
          requestBody,
          sendNotificationEmail: args.sendNotificationEmail,
          emailMessage: args.emailMessage,
          supportsAllDrives: args.supportsAllDrives !== undefined ? args.supportsAllDrives : true
        });

        return {
          content: [{
            type: "text",
            text: JSON.stringify(response.data, null, 2)
          }],
          isError: false
        };
      }

      case "drive_listPermissions": {
        const validation = DriveListPermissionsSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        const response = await drive.permissions.list({
          fileId: args.fileId,
          pageSize: args.pageSize,
          pageToken: args.pageToken,
          fields: args.fields,
          supportsAllDrives: args.supportsAllDrives !== undefined ? args.supportsAllDrives : true
        });

        return {
          content: [{
            type: "text",
            text: JSON.stringify(response.data, null, 2)
          }],
          isError: false
        };
      }

      case "drive_getPermission": {
        const validation = DriveGetPermissionSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        const response = await drive.permissions.get({
          fileId: args.fileId,
          permissionId: args.permissionId,
          fields: args.fields,
          supportsAllDrives: args.supportsAllDrives !== undefined ? args.supportsAllDrives : true
        });

        return {
          content: [{
            type: "text",
            text: JSON.stringify(response.data, null, 2)
          }],
          isError: false
        };
      }

      case "drive_updatePermission": {
        const validation = DriveUpdatePermissionSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        const requestBody: any = {
          role: args.role
        };

        const response = await drive.permissions.update({
          fileId: args.fileId,
          permissionId: args.permissionId,
          requestBody,
          removeExpiration: args.removeExpiration,
          transferOwnership: args.transferOwnership,
          supportsAllDrives: args.supportsAllDrives !== undefined ? args.supportsAllDrives : true
        });

        return {
          content: [{
            type: "text",
            text: JSON.stringify(response.data, null, 2)
          }],
          isError: false
        };
      }

      case "drive_deletePermission": {
        const validation = DriveDeletePermissionSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        await drive.permissions.delete({
          fileId: args.fileId,
          permissionId: args.permissionId,
          supportsAllDrives: args.supportsAllDrives !== undefined ? args.supportsAllDrives : true
        });

        return {
          content: [{
            type: "text",
            text: JSON.stringify({ success: true, permissionId: args.permissionId, message: "Permission deleted" }, null, 2)
          }],
          isError: false
        };
      }

      case "auth_getStatus": {
        const validation = AuthGetStatusSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        const fields = args.fields || 'user,storageQuota';
        const response = await drive.about.get({ fields });

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              authenticated: true,
              user: response.data.user,
              storageQuota: response.data.storageQuota
            }, null, 2)
          }],
          isError: false
        };
      }

      case "auth_testFileAccess": {
        const validation = AuthTestFileAccessSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        try {
          const fields = args.fields || 'id,name,mimeType,capabilities,permissions,owners';
          const response = await drive.files.get({
            fileId: args.fileId,
            fields,
            supportsAllDrives: true
          });

          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                accessible: true,
                file: {
                  id: response.data.id,
                  name: response.data.name,
                  mimeType: response.data.mimeType
                },
                capabilities: response.data.capabilities,
                yourPermission: response.data.permissions ? response.data.permissions[0] : null,
                owners: response.data.owners
              }, null, 2)
            }],
            isError: false
          };
        } catch (error: any) {
          const errorCode = error.code || error.response?.status || 500;
          const errorMessage = error.message || 'Unknown error';

          // Provide helpful suggestions based on error type
          const suggestions: string[] = [];
          if (errorCode === 404) {
            suggestions.push("Verify the file ID is correct");
            suggestions.push("Check if the file has been deleted or moved to trash");
            suggestions.push(`Ask the owner to share the file with your account`);
          } else if (errorCode === 403) {
            suggestions.push("You don't have permission to access this file");
            suggestions.push(`Ask the owner to share the file with your account`);
            suggestions.push("Use auth_getStatus to verify which account you're using");
          } else if (errorCode === 401) {
            suggestions.push("Your authentication token may have expired");
            suggestions.push("Try re-authenticating with: npm run auth");
          }

          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                accessible: false,
                error: errorMessage,
                errorCode,
                suggestions
              }, null, 2)
            }],
            isError: false  // Return as success with error details for better UX
          };
        }
      }

      case "auth_listScopes": {
        const validation = AuthListScopesSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }

        // Get scopes from the OAuth2 client credentials
        const credentials = authClient.credentials;
        const scopes = credentials.scope?.split(' ') || [];

        const scopeDescriptions: Record<string, string> = {
          'https://www.googleapis.com/auth/drive': 'Full access to Google Drive',
          'https://www.googleapis.com/auth/drive.file': 'Access to files created or opened by this app',
          'https://www.googleapis.com/auth/drive.readonly': 'Read-only access to Google Drive',
          'https://www.googleapis.com/auth/documents': 'Access to Google Docs',
          'https://www.googleapis.com/auth/spreadsheets': 'Access to Google Sheets',
          'https://www.googleapis.com/auth/presentations': 'Access to Google Slides'
        };

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              scopes,
              scopeDescriptions: Object.fromEntries(
                scopes.map(scope => [scope, scopeDescriptions[scope] || 'Unknown scope'])
              ),
              tokenExpiry: credentials.expiry_date ? new Date(credentials.expiry_date).toISOString() : null,
              hasRefreshToken: !!credentials.refresh_token
            }, null, 2)
          }],
          isError: false
        };
      }

      case "auth_clearTokens": {
        const validation = AuthClearTokensSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }

        try {
          // Import TokenManager to clear tokens
          const { TokenManager } = await import('./auth.js');
          const tokenManager = new TokenManager(authClient);
          await tokenManager.clearTokens();
          const tokenPath = tokenManager.getTokenPath();

          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                success: true,
                message: "Authentication tokens cleared successfully",
                tokenPath,
                nextSteps: [
                  "MCP server will automatically re-authenticate on next tool call",
                  "Or manually run: npm run auth"
                ]
              }, null, 2)
            }],
            isError: false
          };
        } catch (error: any) {
          return errorResponse(`Failed to clear tokens: ${error.message || error}`);
        }
      }

      case "sheets_repeatCell": {
        const validation = SheetsRepeatCellSchema.safeParse(request.params.arguments);
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

        // Build userEnteredFormat object dynamically
        const userEnteredFormat: any = {};
        const fields: string[] = [];

        // Cell format fields
        if (args.backgroundColor) {
          userEnteredFormat.backgroundColor = {
            red: args.backgroundColor.red || 0,
            green: args.backgroundColor.green || 0,
            blue: args.backgroundColor.blue || 0
          };
          fields.push('userEnteredFormat.backgroundColor');
        }
        if (args.horizontalAlignment) {
          userEnteredFormat.horizontalAlignment = args.horizontalAlignment;
          fields.push('userEnteredFormat.horizontalAlignment');
        }
        if (args.verticalAlignment) {
          userEnteredFormat.verticalAlignment = args.verticalAlignment;
          fields.push('userEnteredFormat.verticalAlignment');
        }
        if (args.wrapStrategy) {
          userEnteredFormat.wrapStrategy = args.wrapStrategy;
          fields.push('userEnteredFormat.wrapStrategy');
        }

        // Text format fields
        const hasTextFormat = args.bold !== undefined || args.italic !== undefined ||
                             args.strikethrough !== undefined || args.underline !== undefined ||
                             args.fontSize !== undefined || args.fontFamily !== undefined ||
                             args.foregroundColor !== undefined;

        if (hasTextFormat) {
          const textFormat: any = {};
          const textFields: string[] = [];

          if (args.bold !== undefined) {
            textFormat.bold = args.bold;
            textFields.push('bold');
          }
          if (args.italic !== undefined) {
            textFormat.italic = args.italic;
            textFields.push('italic');
          }
          if (args.strikethrough !== undefined) {
            textFormat.strikethrough = args.strikethrough;
            textFields.push('strikethrough');
          }
          if (args.underline !== undefined) {
            textFormat.underline = args.underline;
            textFields.push('underline');
          }
          if (args.fontSize !== undefined) {
            textFormat.fontSize = args.fontSize;
            textFields.push('fontSize');
          }
          if (args.fontFamily !== undefined) {
            textFormat.fontFamily = args.fontFamily;
            textFields.push('fontFamily');
          }
          if (args.foregroundColor) {
            textFormat.foregroundColor = {
              red: args.foregroundColor.red || 0,
              green: args.foregroundColor.green || 0,
              blue: args.foregroundColor.blue || 0
            };
            textFields.push('foregroundColor');
          }

          userEnteredFormat.textFormat = textFormat;
          fields.push('userEnteredFormat.textFormat(' + textFields.join(',') + ')');
        }

        // Number format fields
        if (args.numberFormatPattern) {
          const numberFormat: any = {
            pattern: args.numberFormatPattern
          };
          if (args.numberFormatType) {
            numberFormat.type = args.numberFormatType;
          }
          userEnteredFormat.numberFormat = numberFormat;
          fields.push('userEnteredFormat.numberFormat');
        }

        if (fields.length === 0) {
          return errorResponse("No formatting options specified");
        }

        const requests = [{
          repeatCell: {
            range: gridRange,
            cell: { userEnteredFormat },
            fields: fields.join(',')
          }
        }];

        await sheets.spreadsheets.batchUpdate({
          spreadsheetId: args.spreadsheetId,
          requestBody: { requests }
        });

        return {
          content: [{ type: "text", text: `Applied formatting to range ${args.range}` }],
          isError: false
        };
      }

      case "sheets_updateBorders": {
        const validation = SheetsUpdateBordersSchema.safeParse(request.params.arguments);
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

      case "sheets_mergeCells": {
        const validation = SheetsMergeCellsSchema.safeParse(request.params.arguments);
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

      case "sheets_addConditionalFormatRule": {
        const validation = SheetsAddConditionalFormatRuleSchema.safeParse(request.params.arguments);
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

      // Phase 1: Core Data Operations - Thin Layer Handlers
      case "sheets_getSpreadsheet": {
        const validation = SheetsGetSpreadsheetSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        try {
          const sheets = google.sheets({ version: 'v4', auth: authClient });
          const response = await sheets.spreadsheets.get({
            spreadsheetId: args.spreadsheetId,
            ranges: args.ranges,
            includeGridData: args.includeGridData
          });

          const fullJson = JSON.stringify(response.data, null, 2);

          // Handle returnMode (Issue #26)
          if (args.returnMode === 'summary') {
            // Cache the content for later Resource access
            cacheStore(args.spreadsheetId, response.data, fullJson, 'sheet');

            // Extract sheet names
            const sheetNames = (response.data.sheets || []).map(
              (sheet: any) => sheet.properties?.title || 'Untitled'
            );

            const summary = {
              title: response.data.properties?.title || 'Untitled',
              spreadsheetId: args.spreadsheetId,
              sheetCount: sheetNames.length,
              sheetNames,
              locale: response.data.properties?.locale,
              timeZone: response.data.properties?.timeZone,
              resourceUri: `gdrive://sheets/${args.spreadsheetId}/values/{range}`,
              hint: `Use sheets_batchGetValues to fetch specific ranges, or resources/read with values URI. Example: gdrive://sheets/${args.spreadsheetId}/values/Sheet1!A1:B10`
            };

            return {
              content: [{
                type: "text",
                text: JSON.stringify(summary, null, 2)
              }],
              isError: false
            };
          }

          // returnMode: 'full' - return complete response with truncation
          const truncated = truncateResponse(fullJson, {
            hint: `Use returnMode: 'summary' to get metadata, or sheets_batchGetValues for specific ranges`
          });

          return {
            content: [{ type: "text", text: truncated.text }],
            isError: false
          };
        } catch (error: any) {
          return errorResponse(error.message || 'Failed to get spreadsheet');
        }
      }

      case "sheets_createSpreadsheet": {
        const validation = SheetsCreateSpreadsheetSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        try {
          const sheets = google.sheets({ version: 'v4', auth: authClient });
          const requestBody: any = {
            properties: {
              title: args.title
            }
          };

          if (args.locale) requestBody.properties.locale = args.locale;
          if (args.autoRecalc) requestBody.properties.autoRecalc = args.autoRecalc;
          if (args.timeZone) requestBody.properties.timeZone = args.timeZone;

          const response = await sheets.spreadsheets.create({ requestBody });

          return {
            content: [{
              type: "text",
              text: `Created spreadsheet "${args.title}"\nID: ${response.data.spreadsheetId}\nURL: ${response.data.spreadsheetUrl}`
            }],
            isError: false
          };
        } catch (error: any) {
          return errorResponse(error.message || 'Failed to create spreadsheet');
        }
      }

      case "sheets_appendValues": {
        const validation = SheetsAppendValuesSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        try {
          const sheets = google.sheets({ version: 'v4', auth: authClient });
          const response = await sheets.spreadsheets.values.append({
            spreadsheetId: args.spreadsheetId,
            range: args.range,
            valueInputOption: args.valueInputOption || 'USER_ENTERED',
            insertDataOption: args.insertDataOption,
            requestBody: { values: args.values }
          });

          return {
            content: [{
              type: "text",
              text: `Appended ${args.values.length} rows to ${args.range}\nUpdated range: ${response.data.updates?.updatedRange}`
            }],
            isError: false
          };
        } catch (error: any) {
          return errorResponse(error.message || 'Failed to append values');
        }
      }

      case "sheets_clearValues": {
        const validation = SheetsClearValuesSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        try {
          const sheets = google.sheets({ version: 'v4', auth: authClient });
          const response = await sheets.spreadsheets.values.clear({
            spreadsheetId: args.spreadsheetId,
            range: args.range
          });

          return {
            content: [{
              type: "text",
              text: `Cleared range: ${response.data.clearedRange}`
            }],
            isError: false
          };
        } catch (error: any) {
          return errorResponse(error.message || 'Failed to clear values');
        }
      }

      case "sheets_batchGetValues": {
        const validation = SheetsBatchGetValuesSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        try {
          const sheets = google.sheets({ version: 'v4', auth: authClient });
          const response = await sheets.spreadsheets.values.batchGet({
            spreadsheetId: args.spreadsheetId,
            ranges: args.ranges,
            majorDimension: args.majorDimension,
            valueRenderOption: args.valueRenderOption
          });

          const fullJson = JSON.stringify(response.data, null, 2);

          // Handle returnMode (Issue #26)
          if (args.returnMode === 'summary') {
            // Cache the content for later Resource access
            const cacheKey = `${args.spreadsheetId}:values:${args.ranges.join(',')}`;
            cacheStore(cacheKey, response.data, fullJson, 'sheet');

            // Calculate stats
            let totalCells = 0;
            const rangeStats = (response.data.valueRanges || []).map((vr: any) => {
              const rows = vr.values?.length || 0;
              const cols = rows > 0 ? (vr.values[0]?.length || 0) : 0;
              const cells = rows * cols;
              totalCells += cells;
              return {
                range: vr.range,
                rows,
                columns: cols,
                cells
              };
            });

            const summary = {
              spreadsheetId: args.spreadsheetId,
              rangeCount: rangeStats.length,
              totalCells,
              ranges: rangeStats,
              resourceUri: `gdrive://sheets/${args.spreadsheetId}/values/{range}`,
              hint: `Data cached. Use narrower ranges for specific data, or resources/read with values URI.`
            };

            return {
              content: [{
                type: "text",
                text: JSON.stringify(summary, null, 2)
              }],
              isError: false
            };
          }

          // returnMode: 'full' - return complete response with truncation
          const truncated = truncateResponse(fullJson, {
            hint: `Use returnMode: 'summary' to get metadata, or request narrower ranges`
          });

          return {
            content: [{ type: "text", text: truncated.text }],
            isError: false
          };
        } catch (error: any) {
          return errorResponse(error.message || 'Failed to batch get values');
        }
      }

      case "sheets_batchUpdateValues": {
        const validation = SheetsBatchUpdateValuesSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        try {
          const sheets = google.sheets({ version: 'v4', auth: authClient });
          const response = await sheets.spreadsheets.values.batchUpdate({
            spreadsheetId: args.spreadsheetId,
            requestBody: {
              valueInputOption: args.valueInputOption || 'USER_ENTERED',
              data: args.data
            }
          });

          return {
            content: [{
              type: "text",
              text: `Updated ${response.data.totalUpdatedCells} cells across ${response.data.totalUpdatedSheets} sheets`
            }],
            isError: false
          };
        } catch (error: any) {
          return errorResponse(error.message || 'Failed to batch update values');
        }
      }

      case "sheets_batchClearValues": {
        const validation = SheetsBatchClearValuesSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        try {
          const sheets = google.sheets({ version: 'v4', auth: authClient });
          const response = await sheets.spreadsheets.values.batchClear({
            spreadsheetId: args.spreadsheetId,
            requestBody: { ranges: args.ranges }
          });

          return {
            content: [{
              type: "text",
              text: `Cleared ${response.data.clearedRanges?.length || 0} ranges`
            }],
            isError: false
          };
        } catch (error: any) {
          return errorResponse(error.message || 'Failed to batch clear values');
        }
      }

      case "sheets_addSheet": {
        const validation = SheetsAddSheetSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        try {
          const sheets = google.sheets({ version: 'v4', auth: authClient });

          const properties: any = { title: args.title };
          if (args.index !== undefined) properties.index = args.index;
          if (args.sheetType) properties.sheetType = args.sheetType;
          if (args.hidden !== undefined) properties.hidden = args.hidden;
          if (args.rightToLeft !== undefined) properties.rightToLeft = args.rightToLeft;

          if (args.tabColorRed !== undefined || args.tabColorGreen !== undefined || args.tabColorBlue !== undefined) {
            properties.tabColor = {
              red: args.tabColorRed || 0,
              green: args.tabColorGreen || 0,
              blue: args.tabColorBlue || 0
            };
          }

          if (args.gridRowCount || args.gridColumnCount || args.frozenRowCount !== undefined || args.frozenColumnCount !== undefined) {
            properties.gridProperties = {};
            if (args.gridRowCount) properties.gridProperties.rowCount = args.gridRowCount;
            if (args.gridColumnCount) properties.gridProperties.columnCount = args.gridColumnCount;
            if (args.frozenRowCount !== undefined) properties.gridProperties.frozenRowCount = args.frozenRowCount;
            if (args.frozenColumnCount !== undefined) properties.gridProperties.frozenColumnCount = args.frozenColumnCount;
          }

          const response = await sheets.spreadsheets.batchUpdate({
            spreadsheetId: args.spreadsheetId,
            requestBody: {
              requests: [{ addSheet: { properties } }]
            }
          });

          const addedSheet = response.data.replies?.[0]?.addSheet?.properties;
          return {
            content: [{
              type: "text",
              text: `Added sheet "${args.title}"\nSheet ID: ${addedSheet?.sheetId}`
            }],
            isError: false
          };
        } catch (error: any) {
          return errorResponse(error.message || 'Failed to add sheet');
        }
      }

      case "sheets_deleteSheet": {
        const validation = SheetsDeleteSheetSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        try {
          const sheets = google.sheets({ version: 'v4', auth: authClient });
          await sheets.spreadsheets.batchUpdate({
            spreadsheetId: args.spreadsheetId,
            requestBody: {
              requests: [{ deleteSheet: { sheetId: args.sheetId } }]
            }
          });

          return {
            content: [{ type: "text", text: `Deleted sheet with ID: ${args.sheetId}` }],
            isError: false
          };
        } catch (error: any) {
          return errorResponse(error.message || 'Failed to delete sheet');
        }
      }

      case "sheets_updateSheetProperties": {
        const validation = SheetsUpdateSheetPropertiesSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        try {
          const sheets = google.sheets({ version: 'v4', auth: authClient });

          const properties: any = { sheetId: args.sheetId };
          const fields: string[] = [];

          if (args.title !== undefined) {
            properties.title = args.title;
            fields.push('title');
          }
          if (args.index !== undefined) {
            properties.index = args.index;
            fields.push('index');
          }
          if (args.hidden !== undefined) {
            properties.hidden = args.hidden;
            fields.push('hidden');
          }
          if (args.rightToLeft !== undefined) {
            properties.rightToLeft = args.rightToLeft;
            fields.push('rightToLeft');
          }

          if (args.tabColorRed !== undefined || args.tabColorGreen !== undefined || args.tabColorBlue !== undefined) {
            properties.tabColor = {
              red: args.tabColorRed || 0,
              green: args.tabColorGreen || 0,
              blue: args.tabColorBlue || 0
            };
            fields.push('tabColor');
          }

          if (args.frozenRowCount !== undefined || args.frozenColumnCount !== undefined) {
            properties.gridProperties = {};
            if (args.frozenRowCount !== undefined) {
              properties.gridProperties.frozenRowCount = args.frozenRowCount;
              fields.push('gridProperties.frozenRowCount');
            }
            if (args.frozenColumnCount !== undefined) {
              properties.gridProperties.frozenColumnCount = args.frozenColumnCount;
              fields.push('gridProperties.frozenColumnCount');
            }
          }

          if (fields.length === 0) {
            return errorResponse('No properties specified to update');
          }

          await sheets.spreadsheets.batchUpdate({
            spreadsheetId: args.spreadsheetId,
            requestBody: {
              requests: [{
                updateSheetProperties: {
                  properties,
                  fields: fields.join(',')
                }
              }]
            }
          });

          return {
            content: [{ type: "text", text: `Updated sheet properties for sheet ID: ${args.sheetId}` }],
            isError: false
          };
        } catch (error: any) {
          return errorResponse(error.message || 'Failed to update sheet properties');
        }
      }

      // ========================================
      // Phase 2: Row/Column/Range Operations Handlers
      // ========================================

      case "sheets_insertDimension": {
        const validation = SheetsInsertDimensionSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        try {
          const sheets = google.sheets({ version: 'v4', auth: authClient });

          const insertRequest: any = {
            range: {
              sheetId: args.sheetId,
              dimension: args.dimension,
              startIndex: args.startIndex,
              endIndex: args.endIndex
            }
          };

          if (args.inheritFromBefore !== undefined) {
            insertRequest.inheritFromBefore = args.inheritFromBefore;
          }

          await sheets.spreadsheets.batchUpdate({
            spreadsheetId: args.spreadsheetId,
            requestBody: {
              requests: [{
                insertDimension: insertRequest
              }]
            }
          });

          const count = args.endIndex - args.startIndex;
          const dimensionType = args.dimension === 'ROWS' ? 'rows' : 'columns';
          return {
            content: [{
              type: "text",
              text: `Inserted ${count} ${dimensionType} at index ${args.startIndex} in sheet ID ${args.sheetId}`
            }],
            isError: false
          };
        } catch (error: any) {
          return errorResponse(error.message || 'Failed to insert dimension');
        }
      }

      case "sheets_deleteDimension": {
        const validation = SheetsDeleteDimensionSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        try {
          const sheets = google.sheets({ version: 'v4', auth: authClient });

          await sheets.spreadsheets.batchUpdate({
            spreadsheetId: args.spreadsheetId,
            requestBody: {
              requests: [{
                deleteDimension: {
                  range: {
                    sheetId: args.sheetId,
                    dimension: args.dimension,
                    startIndex: args.startIndex,
                    endIndex: args.endIndex
                  }
                }
              }]
            }
          });

          const count = args.endIndex - args.startIndex;
          const dimensionType = args.dimension === 'ROWS' ? 'rows' : 'columns';
          return {
            content: [{
              type: "text",
              text: `Deleted ${count} ${dimensionType} (indices ${args.startIndex}-${args.endIndex - 1}) from sheet ID ${args.sheetId}`
            }],
            isError: false
          };
        } catch (error: any) {
          return errorResponse(error.message || 'Failed to delete dimension');
        }
      }

      case "sheets_moveDimension": {
        const validation = SheetsMoveDimensionSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        try {
          const sheets = google.sheets({ version: 'v4', auth: authClient });

          await sheets.spreadsheets.batchUpdate({
            spreadsheetId: args.spreadsheetId,
            requestBody: {
              requests: [{
                moveDimension: {
                  source: {
                    sheetId: args.sheetId,
                    dimension: args.dimension,
                    startIndex: args.startIndex,
                    endIndex: args.endIndex
                  },
                  destinationIndex: args.destinationIndex
                }
              }]
            }
          });

          const count = args.endIndex - args.startIndex;
          const dimensionType = args.dimension === 'ROWS' ? 'rows' : 'columns';
          return {
            content: [{
              type: "text",
              text: `Moved ${count} ${dimensionType} (indices ${args.startIndex}-${args.endIndex - 1}) to index ${args.destinationIndex} in sheet ID ${args.sheetId}`
            }],
            isError: false
          };
        } catch (error: any) {
          return errorResponse(error.message || 'Failed to move dimension');
        }
      }

      case "sheets_updateDimensionProperties": {
        const validation = SheetsUpdateDimensionPropertiesSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        try {
          const sheets = google.sheets({ version: 'v4', auth: authClient });

          const properties: any = {};
          const fields: string[] = [];

          if (args.pixelSize !== undefined) {
            properties.pixelSize = args.pixelSize;
            fields.push('pixelSize');
          }

          if (args.hiddenByUser !== undefined) {
            properties.hiddenByUser = args.hiddenByUser;
            fields.push('hiddenByUser');
          }

          await sheets.spreadsheets.batchUpdate({
            spreadsheetId: args.spreadsheetId,
            requestBody: {
              requests: [{
                updateDimensionProperties: {
                  range: {
                    sheetId: args.sheetId,
                    dimension: args.dimension,
                    startIndex: args.startIndex,
                    endIndex: args.endIndex
                  },
                  properties,
                  fields: fields.join(',')
                }
              }]
            }
          });

          const count = args.endIndex - args.startIndex;
          const dimensionType = args.dimension === 'ROWS' ? 'rows' : 'columns';
          const updates: string[] = [];
          if (args.pixelSize !== undefined) updates.push(`size=${args.pixelSize}px`);
          if (args.hiddenByUser !== undefined) updates.push(`hidden=${args.hiddenByUser}`);

          return {
            content: [{
              type: "text",
              text: `Updated ${count} ${dimensionType} (indices ${args.startIndex}-${args.endIndex - 1}): ${updates.join(', ')} in sheet ID ${args.sheetId}`
            }],
            isError: false
          };
        } catch (error: any) {
          return errorResponse(error.message || 'Failed to update dimension properties');
        }
      }

      case "sheets_appendDimension": {
        const validation = SheetsAppendDimensionSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        try {
          const sheets = google.sheets({ version: 'v4', auth: authClient });

          await sheets.spreadsheets.batchUpdate({
            spreadsheetId: args.spreadsheetId,
            requestBody: {
              requests: [{
                appendDimension: {
                  sheetId: args.sheetId,
                  dimension: args.dimension,
                  length: args.length
                }
              }]
            }
          });

          const dimensionType = args.dimension === 'ROWS' ? 'rows' : 'columns';
          return {
            content: [{
              type: "text",
              text: `Appended ${args.length} ${dimensionType} to end of sheet ID ${args.sheetId}`
            }],
            isError: false
          };
        } catch (error: any) {
          return errorResponse(error.message || 'Failed to append dimension');
        }
      }

      case "sheets_insertRange": {
        const validation = SheetsInsertRangeSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        try {
          const sheets = google.sheets({ version: 'v4', auth: authClient });

          await sheets.spreadsheets.batchUpdate({
            spreadsheetId: args.spreadsheetId,
            requestBody: {
              requests: [{
                insertRange: {
                  range: {
                    sheetId: args.sheetId,
                    startRowIndex: args.startRowIndex,
                    endRowIndex: args.endRowIndex,
                    startColumnIndex: args.startColumnIndex,
                    endColumnIndex: args.endColumnIndex
                  },
                  shiftDimension: args.shiftDimension
                }
              }]
            }
          });

          const rows = args.endRowIndex - args.startRowIndex;
          const cols = args.endColumnIndex - args.startColumnIndex;
          return {
            content: [{
              type: "text",
              text: `Inserted range (${rows}x${cols} cells) at R${args.startRowIndex}C${args.startColumnIndex}, shifting ${args.shiftDimension} in sheet ID ${args.sheetId}`
            }],
            isError: false
          };
        } catch (error: any) {
          return errorResponse(error.message || 'Failed to insert range');
        }
      }

      case "sheets_deleteRange": {
        const validation = SheetsDeleteRangeSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        try {
          const sheets = google.sheets({ version: 'v4', auth: authClient });

          await sheets.spreadsheets.batchUpdate({
            spreadsheetId: args.spreadsheetId,
            requestBody: {
              requests: [{
                deleteRange: {
                  range: {
                    sheetId: args.sheetId,
                    startRowIndex: args.startRowIndex,
                    endRowIndex: args.endRowIndex,
                    startColumnIndex: args.startColumnIndex,
                    endColumnIndex: args.endColumnIndex
                  },
                  shiftDimension: args.shiftDimension
                }
              }]
            }
          });

          const rows = args.endRowIndex - args.startRowIndex;
          const cols = args.endColumnIndex - args.startColumnIndex;
          return {
            content: [{
              type: "text",
              text: `Deleted range (${rows}x${cols} cells) at R${args.startRowIndex}C${args.startColumnIndex}, shifting ${args.shiftDimension} in sheet ID ${args.sheetId}`
            }],
            isError: false
          };
        } catch (error: any) {
          return errorResponse(error.message || 'Failed to delete range');
        }
      }

      case "sheets_copyPaste": {
        const validation = SheetsCopyPasteSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        try {
          const sheets = google.sheets({ version: 'v4', auth: authClient });

          const copyPasteRequest: any = {
            source: {
              sheetId: args.sourceSheetId,
              startRowIndex: args.sourceStartRowIndex,
              endRowIndex: args.sourceEndRowIndex,
              startColumnIndex: args.sourceStartColumnIndex,
              endColumnIndex: args.sourceEndColumnIndex
            },
            destination: {
              sheetId: args.destinationSheetId,
              startRowIndex: args.destinationStartRowIndex,
              endRowIndex: args.destinationEndRowIndex,
              startColumnIndex: args.destinationStartColumnIndex,
              endColumnIndex: args.destinationEndColumnIndex
            }
          };

          if (args.pasteType) {
            copyPasteRequest.pasteType = args.pasteType;
          }

          if (args.pasteOrientation) {
            copyPasteRequest.pasteOrientation = args.pasteOrientation;
          }

          await sheets.spreadsheets.batchUpdate({
            spreadsheetId: args.spreadsheetId,
            requestBody: {
              requests: [{
                copyPaste: copyPasteRequest
              }]
            }
          });

          const sourceRows = args.sourceEndRowIndex - args.sourceStartRowIndex;
          const sourceCols = args.sourceEndColumnIndex - args.sourceStartColumnIndex;
          const pasteInfo = args.pasteType ? ` (${args.pasteType})` : '';
          const orientInfo = args.pasteOrientation === 'TRANSPOSE' ? ' with transpose' : '';

          return {
            content: [{
              type: "text",
              text: `Copied ${sourceRows}x${sourceCols} range from sheet ${args.sourceSheetId} to sheet ${args.destinationSheetId}${pasteInfo}${orientInfo}`
            }],
            isError: false
          };
        } catch (error: any) {
          return errorResponse(error.message || 'Failed to copy paste');
        }
      }

      case "sheets_cutPaste": {
        const validation = SheetsCutPasteSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        try {
          const sheets = google.sheets({ version: 'v4', auth: authClient });

          const cutPasteRequest: any = {
            source: {
              sheetId: args.sourceSheetId,
              startRowIndex: args.sourceStartRowIndex,
              endRowIndex: args.sourceEndRowIndex,
              startColumnIndex: args.sourceStartColumnIndex,
              endColumnIndex: args.sourceEndColumnIndex
            },
            destination: {
              sheetId: args.destinationSheetId,
              rowIndex: args.destinationRowIndex,
              columnIndex: args.destinationColumnIndex
            }
          };

          if (args.pasteType) {
            cutPasteRequest.pasteType = args.pasteType;
          }

          await sheets.spreadsheets.batchUpdate({
            spreadsheetId: args.spreadsheetId,
            requestBody: {
              requests: [{
                cutPaste: cutPasteRequest
              }]
            }
          });

          const sourceRows = args.sourceEndRowIndex - args.sourceStartRowIndex;
          const sourceCols = args.sourceEndColumnIndex - args.sourceStartColumnIndex;
          const pasteInfo = args.pasteType ? ` (${args.pasteType})` : '';

          return {
            content: [{
              type: "text",
              text: `Cut ${sourceRows}x${sourceCols} range from sheet ${args.sourceSheetId} to R${args.destinationRowIndex}C${args.destinationColumnIndex} in sheet ${args.destinationSheetId}${pasteInfo}`
            }],
            isError: false
          };
        } catch (error: any) {
          return errorResponse(error.message || 'Failed to cut paste');
        }
      }

      case "sheets_autoResizeDimensions": {
        const validation = SheetsAutoResizeDimensionsSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        try {
          const sheets = google.sheets({ version: 'v4', auth: authClient });

          await sheets.spreadsheets.batchUpdate({
            spreadsheetId: args.spreadsheetId,
            requestBody: {
              requests: [{
                autoResizeDimensions: {
                  dimensions: {
                    sheetId: args.sheetId,
                    dimension: args.dimension,
                    startIndex: args.startIndex,
                    endIndex: args.endIndex
                  }
                }
              }]
            }
          });

          const count = args.endIndex - args.startIndex;
          const dimensionType = args.dimension === 'ROWS' ? 'rows' : 'columns';
          return {
            content: [{
              type: "text",
              text: `Auto-resized ${count} ${dimensionType} (indices ${args.startIndex}-${args.endIndex - 1}) in sheet ID ${args.sheetId}`
            }],
            isError: false
          };
        } catch (error: any) {
          return errorResponse(error.message || 'Failed to auto-resize dimensions');
        }
      }

      // ========================================
      // Phase 3: Advanced Formatting & Validation Handlers
      // ========================================

      case "sheets_unmergeCells": {
        const validation = SheetsUnmergeCellsSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        try {
          const sheets = google.sheets({ version: 'v4', auth: authClient });

          await sheets.spreadsheets.batchUpdate({
            spreadsheetId: args.spreadsheetId,
            requestBody: {
              requests: [{
                unmergeCells: {
                  range: {
                    sheetId: args.sheetId,
                    startRowIndex: args.startRowIndex,
                    endRowIndex: args.endRowIndex,
                    startColumnIndex: args.startColumnIndex,
                    endColumnIndex: args.endColumnIndex
                  }
                }
              }]
            }
          });

          const rows = args.endRowIndex - args.startRowIndex;
          const cols = args.endColumnIndex - args.startColumnIndex;
          return {
            content: [{
              type: "text",
              text: `Unmerged cells in range (${rows}x${cols} cells) at R${args.startRowIndex}C${args.startColumnIndex} in sheet ID ${args.sheetId}`
            }],
            isError: false
          };
        } catch (error: any) {
          return errorResponse(error.message || 'Failed to unmerge cells');
        }
      }

      // ========================================
      // Phase 4: Named Ranges, Sorting & Filtering Handlers
      // ========================================

      case "sheets_addNamedRange": {
        const validation = SheetsAddNamedRangeSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        try {
          const sheets = google.sheets({ version: 'v4', auth: authClient });

          const response = await sheets.spreadsheets.batchUpdate({
            spreadsheetId: args.spreadsheetId,
            requestBody: {
              requests: [{
                addNamedRange: {
                  namedRange: {
                    name: args.name,
                    range: {
                      sheetId: args.sheetId,
                      startRowIndex: args.startRowIndex,
                      endRowIndex: args.endRowIndex,
                      startColumnIndex: args.startColumnIndex,
                      endColumnIndex: args.endColumnIndex
                    }
                  }
                }
              }]
            }
          });

          const namedRangeId = response.data.replies?.[0]?.addNamedRange?.namedRange?.namedRangeId || 'unknown';
          return {
            content: [{
              type: "text",
              text: `Created named range "${args.name}" (ID: ${namedRangeId}) in sheet ID ${args.sheetId}`
            }],
            isError: false
          };
        } catch (error: any) {
          return errorResponse(error.message || 'Failed to add named range');
        }
      }

      case "sheets_deleteNamedRange": {
        const validation = SheetsDeleteNamedRangeSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        try {
          const sheets = google.sheets({ version: 'v4', auth: authClient });

          await sheets.spreadsheets.batchUpdate({
            spreadsheetId: args.spreadsheetId,
            requestBody: {
              requests: [{
                deleteNamedRange: {
                  namedRangeId: args.namedRangeId
                }
              }]
            }
          });

          return {
            content: [{
              type: "text",
              text: `Deleted named range with ID: ${args.namedRangeId}`
            }],
            isError: false
          };
        } catch (error: any) {
          return errorResponse(error.message || 'Failed to delete named range');
        }
      }

      case "sheets_sortRange": {
        const validation = SheetsSortRangeSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        try {
          const sheets = google.sheets({ version: 'v4', auth: authClient });

          await sheets.spreadsheets.batchUpdate({
            spreadsheetId: args.spreadsheetId,
            requestBody: {
              requests: [{
                sortRange: {
                  range: {
                    sheetId: args.sheetId,
                    startRowIndex: args.startRowIndex,
                    endRowIndex: args.endRowIndex,
                    startColumnIndex: args.startColumnIndex,
                    endColumnIndex: args.endColumnIndex
                  },
                  sortSpecs: args.sortSpecs
                }
              }]
            }
          });

          const rows = args.endRowIndex - args.startRowIndex;
          const cols = args.endColumnIndex - args.startColumnIndex;
          const specsDesc = args.sortSpecs.map(s => `col ${s.dimensionIndex} ${s.sortOrder}`).join(', ');
          return {
            content: [{
              type: "text",
              text: `Sorted range (${rows}x${cols} cells) by ${specsDesc} in sheet ID ${args.sheetId}`
            }],
            isError: false
          };
        } catch (error: any) {
          return errorResponse(error.message || 'Failed to sort range');
        }
      }

      case "sheets_setBasicFilter": {
        const validation = SheetsSetBasicFilterSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        try {
          const sheets = google.sheets({ version: 'v4', auth: authClient });

          await sheets.spreadsheets.batchUpdate({
            spreadsheetId: args.spreadsheetId,
            requestBody: {
              requests: [{
                setBasicFilter: {
                  filter: {
                    range: {
                      sheetId: args.sheetId,
                      startRowIndex: args.startRowIndex,
                      endRowIndex: args.endRowIndex,
                      startColumnIndex: args.startColumnIndex,
                      endColumnIndex: args.endColumnIndex
                    }
                  }
                }
              }]
            }
          });

          const rows = args.endRowIndex - args.startRowIndex;
          const cols = args.endColumnIndex - args.startColumnIndex;
          return {
            content: [{
              type: "text",
              text: `Set basic filter on range (${rows}x${cols} cells) in sheet ID ${args.sheetId}`
            }],
            isError: false
          };
        } catch (error: any) {
          return errorResponse(error.message || 'Failed to set basic filter');
        }
      }

      case "sheets_clearBasicFilter": {
        const validation = SheetsClearBasicFilterSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        try {
          const sheets = google.sheets({ version: 'v4', auth: authClient });

          await sheets.spreadsheets.batchUpdate({
            spreadsheetId: args.spreadsheetId,
            requestBody: {
              requests: [{
                clearBasicFilter: {
                  sheetId: args.sheetId
                }
              }]
            }
          });

          return {
            content: [{
              type: "text",
              text: `Cleared basic filter from sheet ID ${args.sheetId}`
            }],
            isError: false
          };
        } catch (error: any) {
          return errorResponse(error.message || 'Failed to clear basic filter');
        }
      }

      case "sheets_findReplace": {
        const validation = SheetsFindReplaceSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        try {
          const sheets = google.sheets({ version: 'v4', auth: authClient });

          const findReplaceRequest: any = {
            find: args.find,
            replacement: args.replacement
          };

          if (args.matchCase !== undefined) findReplaceRequest.matchCase = args.matchCase;
          if (args.matchEntireCell !== undefined) findReplaceRequest.matchEntireCell = args.matchEntireCell;
          if (args.searchByRegex !== undefined) findReplaceRequest.searchByRegex = args.searchByRegex;
          if (args.includeFormulas !== undefined) findReplaceRequest.includeFormulas = args.includeFormulas;
          if (args.allSheets !== undefined) findReplaceRequest.allSheets = args.allSheets;

          if (args.sheetId !== undefined || args.startRowIndex !== undefined) {
            findReplaceRequest.range = {} as any;
            if (args.sheetId !== undefined) findReplaceRequest.range.sheetId = args.sheetId;
            if (args.startRowIndex !== undefined) findReplaceRequest.range.startRowIndex = args.startRowIndex;
            if (args.endRowIndex !== undefined) findReplaceRequest.range.endRowIndex = args.endRowIndex;
            if (args.startColumnIndex !== undefined) findReplaceRequest.range.startColumnIndex = args.startColumnIndex;
            if (args.endColumnIndex !== undefined) findReplaceRequest.range.endColumnIndex = args.endColumnIndex;
          }

          const response = await sheets.spreadsheets.batchUpdate({
            spreadsheetId: args.spreadsheetId,
            requestBody: {
              requests: [{
                findReplace: findReplaceRequest
              }]
            }
          });

          const replacementCount = response.data.replies?.[0]?.findReplace?.occurrencesChanged || 0;
          return {
            content: [{
              type: "text",
              text: `Replaced ${replacementCount} occurrence(s) of "${args.find}" with "${args.replacement}"`
            }],
            isError: false
          };
        } catch (error: any) {
          return errorResponse(error.message || 'Failed to find and replace');
        }
      }

      // ========================================
      // Phase 5: Advanced Operations Handlers
      // ========================================

      case "sheets_textToColumns": {
        const validation = SheetsTextToColumnsSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        try {
          const sheets = google.sheets({ version: 'v4', auth: authClient });

          const textToColumnsRequest: any = {
            source: {
              sheetId: args.sheetId,
              startRowIndex: args.startRowIndex,
              endRowIndex: args.endRowIndex,
              startColumnIndex: args.startColumnIndex,
              endColumnIndex: args.endColumnIndex
            },
            delimiterType: args.delimiterType
          };

          if (args.delimiter !== undefined) {
            textToColumnsRequest.delimiter = args.delimiter;
          }

          await sheets.spreadsheets.batchUpdate({
            spreadsheetId: args.spreadsheetId,
            requestBody: {
              requests: [{
                textToColumns: textToColumnsRequest
              }]
            }
          });

          const rows = args.endRowIndex - args.startRowIndex;
          const cols = args.endColumnIndex - args.startColumnIndex;
          return {
            content: [{
              type: "text",
              text: `Split text to columns in range (${rows}x${cols} cells) using ${args.delimiterType} delimiter in sheet ID ${args.sheetId}`
            }],
            isError: false
          };
        } catch (error: any) {
          return errorResponse(error.message || 'Failed to split text to columns');
        }
      }

      case "sheets_trimWhitespace": {
        const validation = SheetsTrimWhitespaceSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        try {
          const sheets = google.sheets({ version: 'v4', auth: authClient });

          await sheets.spreadsheets.batchUpdate({
            spreadsheetId: args.spreadsheetId,
            requestBody: {
              requests: [{
                trimWhitespace: {
                  range: {
                    sheetId: args.sheetId,
                    startRowIndex: args.startRowIndex,
                    endRowIndex: args.endRowIndex,
                    startColumnIndex: args.startColumnIndex,
                    endColumnIndex: args.endColumnIndex
                  }
                }
              }]
            }
          });

          const rows = args.endRowIndex - args.startRowIndex;
          const cols = args.endColumnIndex - args.startColumnIndex;
          return {
            content: [{
              type: "text",
              text: `Trimmed whitespace in range (${rows}x${cols} cells) in sheet ID ${args.sheetId}`
            }],
            isError: false
          };
        } catch (error: any) {
          return errorResponse(error.message || 'Failed to trim whitespace');
        }
      }

      case "sheets_deleteDuplicates": {
        const validation = SheetsDeleteDuplicatesSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        try {
          const sheets = google.sheets({ version: 'v4', auth: authClient });

          const response = await sheets.spreadsheets.batchUpdate({
            spreadsheetId: args.spreadsheetId,
            requestBody: {
              requests: [{
                deleteDuplicates: {
                  range: {
                    sheetId: args.sheetId,
                    startRowIndex: args.startRowIndex,
                    endRowIndex: args.endRowIndex,
                    startColumnIndex: args.startColumnIndex,
                    endColumnIndex: args.endColumnIndex
                  },
                  comparisonColumns: args.comparisonColumns
                }
              }]
            }
          });

          const duplicatesRemoved = response.data.replies?.[0]?.deleteDuplicates?.duplicatesRemovedCount || 0;
          return {
            content: [{
              type: "text",
              text: `Deleted ${duplicatesRemoved} duplicate row(s) from sheet ID ${args.sheetId}`
            }],
            isError: false
          };
        } catch (error: any) {
          return errorResponse(error.message || 'Failed to delete duplicates');
        }
      }

      case "docs_updateTextStyle": {
        const validation = DocsUpdateTextStyleSchema.safeParse(request.params.arguments);
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

      case "docs_updateParagraphStyle": {
        const validation = DocsUpdateParagraphStyleSchema.safeParse(request.params.arguments);
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

      case "docs_get": {
        const validation = DocsGetSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        const docs = google.docs({ version: 'v1', auth: authClient });
        try {
          const document = await docs.documents.get({
            documentId: args.documentId,
            ...(args.includeTabsContent !== undefined && { includeTabsContent: args.includeTabsContent })
          });

          // Extract text content from document body
          const extractText = (content: any[]): string => {
            let text = '';
            for (const element of content || []) {
              if (element.paragraph?.elements) {
                for (const el of element.paragraph.elements) {
                  if (el.textRun?.content) {
                    text += el.textRun.content;
                  }
                }
              } else if (element.table) {
                // Extract text from table cells
                for (const row of element.table.tableRows || []) {
                  for (const cell of row.tableCells || []) {
                    text += extractText(cell.content);
                  }
                }
              }
            }
            return text;
          };

          const docText = extractText(document.data.body?.content || []);
          const fullJson = JSON.stringify(document.data, null, 2);

          // Handle returnMode (Issue #26)
          if (args.returnMode === 'summary') {
            // Cache the content for later Resource access
            cacheStore(args.documentId, document.data, docText, 'doc');

            // Count sections (headings)
            let sectionCount = 0;
            for (const element of document.data.body?.content || []) {
              if (element.paragraph?.paragraphStyle?.namedStyleType?.startsWith('HEADING')) {
                sectionCount++;
              }
            }

            const summary = {
              title: document.data.title || 'Untitled',
              documentId: args.documentId,
              characterCount: docText.length,
              sectionCount,
              resourceUri: `gdrive://docs/${args.documentId}/chunk/{start}-{end}`,
              hint: 'Use resources/read with chunk URI to access content. Example: gdrive://docs/' + args.documentId + '/chunk/0-5000'
            };

            return {
              content: [{
                type: "text",
                text: JSON.stringify(summary, null, 2)
              }],
              isError: false
            };
          }

          // returnMode: 'full' - return complete response with truncation
          const truncated = truncateResponse(fullJson, {
            hint: `Use returnMode: 'summary' to get metadata and cache content for chunk access via gdrive://docs/${args.documentId}/chunk/{start}-{end}`
          });

          return {
            content: [{
              type: "text",
              text: truncated.text
            }],
            isError: false
          };
        } catch (error: any) {
          return errorResponse(error.message || 'Failed to get document');
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


      case "slides_updateTextStyle": {
        const validation = SlidesUpdateTextStyleSchema.safeParse(request.params.arguments);
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

      case "slides_updateParagraphStyle": {
        const validation = SlidesUpdateParagraphStyleSchema.safeParse(request.params.arguments);
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

      case "slides_updateShapeProperties": {
        const validation = SlidesUpdateShapePropertiesSchema.safeParse(request.params.arguments);
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

      case "slides_updatePageProperties": {
        const validation = SlidesUpdatePagePropertiesSchema.safeParse(request.params.arguments);
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

      case "slides_createTextBox": {
        const validation = SlidesCreateTextBoxSchema.safeParse(request.params.arguments);
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

      case "slides_createShape": {
        const validation = SlidesCreateShapeSchema.safeParse(request.params.arguments);
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

      case "slides_createPresentation": {
        const validation = SlidesCreatePresentationSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        try {
          const slidesService = google.slides({ version: 'v1', auth: authClient });
          const presentation = await slidesService.presentations.create({
            requestBody: {
              title: args.title,
              locale: args.locale,
              pageSize: args.pageSize
            }
          });

          // Return raw API response as JSON
          return {
            content: [{
              type: "text",
              text: JSON.stringify(presentation.data, null, 2)
            }],
            isError: false
          };
        } catch (error: any) {
          return errorResponse(error.message || 'Failed to create presentation');
        }
      }

      case "slides_createSlide": {
        const validation = SlidesCreateSlideSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        try {
          const slidesService = google.slides({ version: 'v1', auth: authClient });
          const response = await slidesService.presentations.batchUpdate({
            presentationId: args.presentationId,
            requestBody: {
              requests: [{
                createSlide: {
                  insertionIndex: args.insertionIndex,
                  objectId: args.objectId,
                  slideLayoutReference: args.slideLayoutReference,
                  placeholderIdMappings: args.placeholderIdMappings
                }
              }]
            }
          });

          // Return raw API response as JSON
          return {
            content: [{
              type: "text",
              text: JSON.stringify(response.data, null, 2)
            }],
            isError: false
          };
        } catch (error: any) {
          return errorResponse(error.message || 'Failed to create slide');
        }
      }

      case "slides_deleteObject": {
        const validation = SlidesDeleteObjectSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        try {
          const slidesService = google.slides({ version: 'v1', auth: authClient });
          const response = await slidesService.presentations.batchUpdate({
            presentationId: args.presentationId,
            requestBody: {
              requests: [{
                deleteObject: {
                  objectId: args.objectId
                }
              }]
            }
          });

          // Return raw API response as JSON
          return {
            content: [{
              type: "text",
              text: JSON.stringify(response.data, null, 2)
            }],
            isError: false
          };
        } catch (error: any) {
          return errorResponse(error.message || 'Failed to delete object');
        }
      }

      case "slides_updateSlidesPosition": {
        const validation = SlidesUpdateSlidesPositionSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        try {
          const slidesService = google.slides({ version: 'v1', auth: authClient });
          const response = await slidesService.presentations.batchUpdate({
            presentationId: args.presentationId,
            requestBody: {
              requests: [{
                updateSlidesPosition: {
                  slideObjectIds: args.slideObjectIds,
                  insertionIndex: args.insertionIndex
                }
              }]
            }
          });

          // Return raw API response as JSON
          return {
            content: [{
              type: "text",
              text: JSON.stringify(response.data, null, 2)
            }],
            isError: false
          };
        } catch (error: any) {
          return errorResponse(error.message || 'Failed to update slides position');
        }
      }

      case "slides_duplicateObject": {
        const validation = SlidesDuplicateObjectSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        try {
          const slidesService = google.slides({ version: 'v1', auth: authClient });
          const response = await slidesService.presentations.batchUpdate({
            presentationId: args.presentationId,
            requestBody: {
              requests: [{
                duplicateObject: {
                  objectId: args.objectId,
                  objectIds: args.objectIds
                }
              }]
            }
          });

          // Return raw API response as JSON
          return {
            content: [{
              type: "text",
              text: JSON.stringify(response.data, null, 2)
            }],
            isError: false
          };
        } catch (error: any) {
          return errorResponse(error.message || 'Failed to duplicate object');
        }
      }

      case "slides_insertText": {
        const validation = SlidesInsertTextSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        try {
          const slidesService = google.slides({ version: 'v1', auth: authClient });

          // Build insertText request
          const insertTextRequest: any = {
            objectId: args.objectId,
            text: args.text
          };

          if (args.insertionIndex !== undefined) {
            insertTextRequest.insertionIndex = args.insertionIndex;
          }

          if (args.cellLocation) {
            insertTextRequest.cellLocation = {
              rowIndex: args.cellLocation.rowIndex,
              columnIndex: args.cellLocation.columnIndex
            };
          }

          const response = await slidesService.presentations.batchUpdate({
            presentationId: args.presentationId,
            requestBody: {
              requests: [{
                insertText: insertTextRequest
              }]
            }
          });

          // Return raw API response as JSON
          return {
            content: [{
              type: "text",
              text: JSON.stringify(response.data, null, 2)
            }],
            isError: false
          };
        } catch (error: any) {
          return errorResponse(error.message || 'Failed to insert text');
        }
      }

      case "slides_deleteText": {
        const validation = SlidesDeleteTextSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        try {
          const slidesService = google.slides({ version: 'v1', auth: authClient });

          // Build deleteText request
          const deleteTextRequest: any = {
            objectId: args.objectId
          };

          if (args.textRange) {
            deleteTextRequest.textRange = {};
            if (args.textRange.startIndex !== undefined) {
              deleteTextRequest.textRange.startIndex = args.textRange.startIndex;
            }
            if (args.textRange.endIndex !== undefined) {
              deleteTextRequest.textRange.endIndex = args.textRange.endIndex;
            }
            if (args.textRange.type) {
              deleteTextRequest.textRange.type = args.textRange.type;
            }
          }

          if (args.cellLocation) {
            deleteTextRequest.cellLocation = {
              rowIndex: args.cellLocation.rowIndex,
              columnIndex: args.cellLocation.columnIndex
            };
          }

          const response = await slidesService.presentations.batchUpdate({
            presentationId: args.presentationId,
            requestBody: {
              requests: [{
                deleteText: deleteTextRequest
              }]
            }
          });

          // Return raw API response as JSON
          return {
            content: [{
              type: "text",
              text: JSON.stringify(response.data, null, 2)
            }],
            isError: false
          };
        } catch (error: any) {
          return errorResponse(error.message || 'Failed to delete text');
        }
      }

      case "slides_replaceAllText": {
        const validation = SlidesReplaceAllTextSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        try {
          const slidesService = google.slides({ version: 'v1', auth: authClient });

          // Build replaceAllText request
          const replaceAllTextRequest: any = {
            containsText: {
              text: args.containsText.text
            },
            replaceText: args.replaceText
          };

          if (args.containsText.matchCase !== undefined) {
            replaceAllTextRequest.containsText.matchCase = args.containsText.matchCase;
          }

          if (args.pageObjectIds) {
            replaceAllTextRequest.pageObjectIds = args.pageObjectIds;
          }

          const response = await slidesService.presentations.batchUpdate({
            presentationId: args.presentationId,
            requestBody: {
              requests: [{
                replaceAllText: replaceAllTextRequest
              }]
            }
          });

          // Return raw API response as JSON
          return {
            content: [{
              type: "text",
              text: JSON.stringify(response.data, null, 2)
            }],
            isError: false
          };
        } catch (error: any) {
          return errorResponse(error.message || 'Failed to replace text');
        }
      }

      case "slides_createParagraphBullets": {
        const validation = SlidesCreateParagraphBulletsSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        try {
          const slidesService = google.slides({ version: 'v1', auth: authClient });

          // Build createParagraphBullets request
          const createParagraphBulletsRequest: any = {
            objectId: args.objectId
          };

          if (args.textRange) {
            createParagraphBulletsRequest.textRange = {};
            if (args.textRange.startIndex !== undefined) {
              createParagraphBulletsRequest.textRange.startIndex = args.textRange.startIndex;
            }
            if (args.textRange.endIndex !== undefined) {
              createParagraphBulletsRequest.textRange.endIndex = args.textRange.endIndex;
            }
            if (args.textRange.type) {
              createParagraphBulletsRequest.textRange.type = args.textRange.type;
            }
          }

          if (args.bulletPreset) {
            createParagraphBulletsRequest.bulletPreset = args.bulletPreset;
          }

          if (args.cellLocation) {
            createParagraphBulletsRequest.cellLocation = {
              rowIndex: args.cellLocation.rowIndex,
              columnIndex: args.cellLocation.columnIndex
            };
          }

          const response = await slidesService.presentations.batchUpdate({
            presentationId: args.presentationId,
            requestBody: {
              requests: [{
                createParagraphBullets: createParagraphBulletsRequest
              }]
            }
          });

          // Return raw API response as JSON
          return {
            content: [{
              type: "text",
              text: JSON.stringify(response.data, null, 2)
            }],
            isError: false
          };
        } catch (error: any) {
          return errorResponse(error.message || 'Failed to create paragraph bullets');
        }
      }

      case "slides_updatePageElementTransform": {
        const validation = SlidesUpdatePageElementTransformSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        try {
          const slidesService = google.slides({ version: 'v1', auth: authClient });

          // Build updatePageElementTransform request
          const updatePageElementTransformRequest: any = {
            objectId: args.objectId,
            transform: {}
          };

          // Add transform properties if provided
          if (args.transform.scaleX !== undefined) {
            updatePageElementTransformRequest.transform.scaleX = args.transform.scaleX;
          }
          if (args.transform.scaleY !== undefined) {
            updatePageElementTransformRequest.transform.scaleY = args.transform.scaleY;
          }
          if (args.transform.shearX !== undefined) {
            updatePageElementTransformRequest.transform.shearX = args.transform.shearX;
          }
          if (args.transform.shearY !== undefined) {
            updatePageElementTransformRequest.transform.shearY = args.transform.shearY;
          }
          if (args.transform.translateX !== undefined) {
            updatePageElementTransformRequest.transform.translateX = args.transform.translateX;
          }
          if (args.transform.translateY !== undefined) {
            updatePageElementTransformRequest.transform.translateY = args.transform.translateY;
          }
          if (args.transform.unit) {
            updatePageElementTransformRequest.transform.unit = args.transform.unit;
          }

          if (args.applyMode) {
            updatePageElementTransformRequest.applyMode = args.applyMode;
          }

          const response = await slidesService.presentations.batchUpdate({
            presentationId: args.presentationId,
            requestBody: {
              requests: [{
                updatePageElementTransform: updatePageElementTransformRequest
              }]
            }
          });

          // Return raw API response as JSON
          return {
            content: [{
              type: "text",
              text: JSON.stringify(response.data, null, 2)
            }],
            isError: false
          };
        } catch (error: any) {
          return errorResponse(error.message || 'Failed to update page element transform');
        }
      }

      case "slides_createImage": {
        const validation = SlidesCreateImageSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        try {
          const slidesService = google.slides({ version: 'v1', auth: authClient });

          // Build createImage request
          const createImageRequest: any = {
            url: args.url
          };

          if (args.elementProperties) {
            createImageRequest.elementProperties = {};
            if (args.elementProperties.pageObjectId) {
              createImageRequest.elementProperties.pageObjectId = args.pageObjectId;
            }
            if (args.elementProperties.size) {
              createImageRequest.elementProperties.size = args.elementProperties.size;
            }
            if (args.elementProperties.transform) {
              createImageRequest.elementProperties.transform = args.elementProperties.transform;
            }
          }

          const response = await slidesService.presentations.batchUpdate({
            presentationId: args.presentationId,
            requestBody: {
              requests: [{
                createImage: createImageRequest
              }]
            }
          });

          // Return raw API response as JSON
          return {
            content: [{
              type: "text",
              text: JSON.stringify(response.data, null, 2)
            }],
            isError: false
          };
        } catch (error: any) {
          return errorResponse(error.message || 'Failed to create image');
        }
      }

      case "slides_createVideo": {
        const validation = SlidesCreateVideoSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        try {
          const slidesService = google.slides({ version: 'v1', auth: authClient });

          const createVideoRequest: any = {
            source: args.source,
            id: args.id
          };

          if (args.elementProperties) {
            createVideoRequest.elementProperties = {};
            if (args.elementProperties.size) {
              createVideoRequest.elementProperties.size = args.elementProperties.size;
            }
            if (args.elementProperties.transform) {
              createVideoRequest.elementProperties.transform = args.elementProperties.transform;
            }
          }

          const response = await slidesService.presentations.batchUpdate({
            presentationId: args.presentationId,
            requestBody: {
              requests: [{
                createVideo: createVideoRequest
              }]
            }
          });

          return {
            content: [{
              type: "text",
              text: JSON.stringify(response.data, null, 2)
            }],
            isError: false
          };
        } catch (error: any) {
          return errorResponse(error.message || 'Failed to create video');
        }
      }

      case "slides_createLine": {
        const validation = SlidesCreateLineSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        try {
          const slidesService = google.slides({ version: 'v1', auth: authClient });

          const createLineRequest: any = {};

          if (args.lineCategory) {
            createLineRequest.lineCategory = args.lineCategory;
          }

          if (args.elementProperties) {
            createLineRequest.elementProperties = {};
            if (args.elementProperties.size) {
              createLineRequest.elementProperties.size = args.elementProperties.size;
            }
            if (args.elementProperties.transform) {
              createLineRequest.elementProperties.transform = args.elementProperties.transform;
            }
          }

          const response = await slidesService.presentations.batchUpdate({
            presentationId: args.presentationId,
            requestBody: {
              requests: [{
                createLine: createLineRequest
              }]
            }
          });

          return {
            content: [{
              type: "text",
              text: JSON.stringify(response.data, null, 2)
            }],
            isError: false
          };
        } catch (error: any) {
          return errorResponse(error.message || 'Failed to create line');
        }
      }

      case "slides_createTable": {
        const validation = SlidesCreateTableSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        try {
          const slidesService = google.slides({ version: 'v1', auth: authClient });

          const createTableRequest: any = {
            rows: args.rows,
            columns: args.columns
          };

          if (args.elementProperties) {
            createTableRequest.elementProperties = {};
            if (args.elementProperties.size) {
              createTableRequest.elementProperties.size = args.elementProperties.size;
            }
            if (args.elementProperties.transform) {
              createTableRequest.elementProperties.transform = args.elementProperties.transform;
            }
          }

          const response = await slidesService.presentations.batchUpdate({
            presentationId: args.presentationId,
            requestBody: {
              requests: [{
                createTable: createTableRequest
              }]
            }
          });

          return {
            content: [{
              type: "text",
              text: JSON.stringify(response.data, null, 2)
            }],
            isError: false
          };
        } catch (error: any) {
          return errorResponse(error.message || 'Failed to create table');
        }
      }

      case "slides_createSheetsChart": {
        const validation = SlidesCreateSheetsChartSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        try {
          const slidesService = google.slides({ version: 'v1', auth: authClient });

          const createSheetsChartRequest: any = {
            spreadsheetId: args.spreadsheetId,
            chartId: args.chartId
          };

          if (args.linkingMode) {
            createSheetsChartRequest.linkingMode = args.linkingMode;
          }

          if (args.elementProperties) {
            createSheetsChartRequest.elementProperties = args.elementProperties;
          }

          const response = await slidesService.presentations.batchUpdate({
            presentationId: args.presentationId,
            requestBody: {
              requests: [{
                createSheetsChart: createSheetsChartRequest
              }]
            }
          });

          return {
            content: [{
              type: "text",
              text: JSON.stringify(response.data, null, 2)
            }],
            isError: false
          };
        } catch (error: any) {
          return errorResponse(error.message || 'Failed to create Sheets chart');
        }
      }

      case "slides_refreshSheetsChart": {
        const validation = SlidesRefreshSheetsChartSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        try {
          const slidesService = google.slides({ version: 'v1', auth: authClient });

          const response = await slidesService.presentations.batchUpdate({
            presentationId: args.presentationId,
            requestBody: {
              requests: [{
                refreshSheetsChart: {
                  objectId: args.objectId
                }
              }]
            }
          });

          return {
            content: [{
              type: "text",
              text: JSON.stringify(response.data, null, 2)
            }],
            isError: false
          };
        } catch (error: any) {
          return errorResponse(error.message || 'Failed to refresh Sheets chart');
        }
      }

      case "slides_updateImageProperties": {
        const validation = SlidesUpdateImagePropertiesSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        try {
          const slidesService = google.slides({ version: 'v1', auth: authClient });

          const updateImagePropertiesRequest: any = {
            objectId: args.objectId
          };

          if (args.imageProperties) {
            updateImagePropertiesRequest.imageProperties = args.imageProperties;
            updateImagePropertiesRequest.fields = Object.keys(args.imageProperties).map(k => `imageProperties.${k}`).join(',');
          }

          const response = await slidesService.presentations.batchUpdate({
            presentationId: args.presentationId,
            requestBody: {
              requests: [{
                updateImageProperties: updateImagePropertiesRequest
              }]
            }
          });

          return {
            content: [{
              type: "text",
              text: JSON.stringify(response.data, null, 2)
            }],
            isError: false
          };
        } catch (error: any) {
          return errorResponse(error.message || 'Failed to update image properties');
        }
      }

      case "slides_updateVideoProperties": {
        const validation = SlidesUpdateVideoPropertiesSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        try {
          const slidesService = google.slides({ version: 'v1', auth: authClient });

          const updateVideoPropertiesRequest: any = {
            objectId: args.objectId
          };

          if (args.videoProperties) {
            updateVideoPropertiesRequest.videoProperties = args.videoProperties;
            updateVideoPropertiesRequest.fields = Object.keys(args.videoProperties).map(k => `videoProperties.${k}`).join(',');
          }

          const response = await slidesService.presentations.batchUpdate({
            presentationId: args.presentationId,
            requestBody: {
              requests: [{
                updateVideoProperties: updateVideoPropertiesRequest
              }]
            }
          });

          return {
            content: [{
              type: "text",
              text: JSON.stringify(response.data, null, 2)
            }],
            isError: false
          };
        } catch (error: any) {
          return errorResponse(error.message || 'Failed to update video properties');
        }
      }

      case "slides_deleteParagraphBullets": {
        const validation = SlidesDeleteParagraphBulletsSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        try {
          const slidesService = google.slides({ version: 'v1', auth: authClient });

          const deleteParagraphBulletsRequest: any = {
            objectId: args.objectId
          };

          if (args.textRange) {
            deleteParagraphBulletsRequest.textRange = args.textRange;
          }

          if (args.cellLocation) {
            deleteParagraphBulletsRequest.cellLocation = args.cellLocation;
          }

          const response = await slidesService.presentations.batchUpdate({
            presentationId: args.presentationId,
            requestBody: {
              requests: [{
                deleteParagraphBullets: deleteParagraphBulletsRequest
              }]
            }
          });

          return {
            content: [{
              type: "text",
              text: JSON.stringify(response.data, null, 2)
            }],
            isError: false
          };
        } catch (error: any) {
          return errorResponse(error.message || 'Failed to delete paragraph bullets');
        }
      }

      case "slides_updateLineProperties": {
        const validation = SlidesUpdateLinePropertiesSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        try {
          const slidesService = google.slides({ version: 'v1', auth: authClient });

          const updateLinePropertiesRequest: any = {
            objectId: args.objectId
          };

          if (args.lineProperties) {
            updateLinePropertiesRequest.lineProperties = args.lineProperties;
            updateLinePropertiesRequest.fields = Object.keys(args.lineProperties).map(k => `lineProperties.${k}`).join(',');
          }

          const response = await slidesService.presentations.batchUpdate({
            presentationId: args.presentationId,
            requestBody: {
              requests: [{
                updateLineProperties: updateLinePropertiesRequest
              }]
            }
          });

          return {
            content: [{
              type: "text",
              text: JSON.stringify(response.data, null, 2)
            }],
            isError: false
          };
        } catch (error: any) {
          return errorResponse(error.message || 'Failed to update line properties');
        }
      }

      case "slides_updateLineCategory": {
        const validation = SlidesUpdateLineCategorySchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        try {
          const slidesService = google.slides({ version: 'v1', auth: authClient });

          const response = await slidesService.presentations.batchUpdate({
            presentationId: args.presentationId,
            requestBody: {
              requests: [{
                updateLineCategory: {
                  objectId: args.objectId,
                  lineCategory: args.lineCategory
                }
              }]
            }
          });

          return {
            content: [{
              type: "text",
              text: JSON.stringify(response.data, null, 2)
            }],
            isError: false
          };
        } catch (error: any) {
          return errorResponse(error.message || 'Failed to update line category');
        }
      }

      case "slides_rerouteLine": {
        const validation = SlidesRerouteLineSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        try {
          const slidesService = google.slides({ version: 'v1', auth: authClient });

          const response = await slidesService.presentations.batchUpdate({
            presentationId: args.presentationId,
            requestBody: {
              requests: [{
                rerouteLine: {
                  objectId: args.objectId
                }
              }]
            }
          });

          return {
            content: [{
              type: "text",
              text: JSON.stringify(response.data, null, 2)
            }],
            isError: false
          };
        } catch (error: any) {
          return errorResponse(error.message || 'Failed to reroute line');
        }
      }

      case "slides_insertTableRows": {
        const validation = SlidesInsertTableRowsSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        try {
          const slidesService = google.slides({ version: 'v1', auth: authClient });

          const insertTableRowsRequest: any = {
            tableObjectId: args.tableObjectId,
            cellLocation: args.cellLocation,
            insertBelow: args.insertBelow
          };

          if (args.number) {
            insertTableRowsRequest.number = args.number;
          }

          const response = await slidesService.presentations.batchUpdate({
            presentationId: args.presentationId,
            requestBody: {
              requests: [{
                insertTableRows: insertTableRowsRequest
              }]
            }
          });

          return {
            content: [{
              type: "text",
              text: JSON.stringify(response.data, null, 2)
            }],
            isError: false
          };
        } catch (error: any) {
          return errorResponse(error.message || 'Failed to insert table rows');
        }
      }

      case "slides_insertTableColumns": {
        const validation = SlidesInsertTableColumnsSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        try {
          const slidesService = google.slides({ version: 'v1', auth: authClient });

          const insertTableColumnsRequest: any = {
            tableObjectId: args.tableObjectId,
            cellLocation: args.cellLocation,
            insertRight: args.insertRight
          };

          if (args.number) {
            insertTableColumnsRequest.number = args.number;
          }

          const response = await slidesService.presentations.batchUpdate({
            presentationId: args.presentationId,
            requestBody: {
              requests: [{
                insertTableColumns: insertTableColumnsRequest
              }]
            }
          });

          return {
            content: [{
              type: "text",
              text: JSON.stringify(response.data, null, 2)
            }],
            isError: false
          };
        } catch (error: any) {
          return errorResponse(error.message || 'Failed to insert table columns');
        }
      }

      case "slides_deleteTableRow": {
        const validation = SlidesDeleteTableRowSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        try {
          const slidesService = google.slides({ version: 'v1', auth: authClient });

          const response = await slidesService.presentations.batchUpdate({
            presentationId: args.presentationId,
            requestBody: {
              requests: [{
                deleteTableRow: {
                  tableObjectId: args.tableObjectId,
                  cellLocation: args.cellLocation
                }
              }]
            }
          });

          return {
            content: [{
              type: "text",
              text: JSON.stringify(response.data, null, 2)
            }],
            isError: false
          };
        } catch (error: any) {
          return errorResponse(error.message || 'Failed to delete table row');
        }
      }

      case "slides_deleteTableColumn": {
        const validation = SlidesDeleteTableColumnSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        try {
          const slidesService = google.slides({ version: 'v1', auth: authClient });

          const response = await slidesService.presentations.batchUpdate({
            presentationId: args.presentationId,
            requestBody: {
              requests: [{
                deleteTableColumn: {
                  tableObjectId: args.tableObjectId,
                  cellLocation: args.cellLocation
                }
              }]
            }
          });

          return {
            content: [{
              type: "text",
              text: JSON.stringify(response.data, null, 2)
            }],
            isError: false
          };
        } catch (error: any) {
          return errorResponse(error.message || 'Failed to delete table column');
        }
      }

      case "slides_updateTableCellProperties": {
        const validation = SlidesUpdateTableCellPropertiesSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        try {
          const slidesService = google.slides({ version: 'v1', auth: authClient });

          const updateTableCellPropertiesRequest: any = {
            objectId: args.objectId,
            tableRange: args.tableRange
          };

          if (args.tableCellProperties) {
            updateTableCellPropertiesRequest.tableCellProperties = args.tableCellProperties;
            updateTableCellPropertiesRequest.fields = Object.keys(args.tableCellProperties).map(k => `tableCellProperties.${k}`).join(',');
          }

          const response = await slidesService.presentations.batchUpdate({
            presentationId: args.presentationId,
            requestBody: {
              requests: [{
                updateTableCellProperties: updateTableCellPropertiesRequest
              }]
            }
          });

          return {
            content: [{
              type: "text",
              text: JSON.stringify(response.data, null, 2)
            }],
            isError: false
          };
        } catch (error: any) {
          return errorResponse(error.message || 'Failed to update table cell properties');
        }
      }

      case "slides_updateTableBorderProperties": {
        const validation = SlidesUpdateTableBorderPropertiesSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        try {
          const slidesService = google.slides({ version: 'v1', auth: authClient });

          const updateTableBorderPropertiesRequest: any = {
            objectId: args.objectId,
            tableRange: args.tableRange,
            borderPosition: args.borderPosition
          };

          if (args.tableBorderProperties) {
            updateTableBorderPropertiesRequest.tableBorderProperties = args.tableBorderProperties;
            updateTableBorderPropertiesRequest.fields = Object.keys(args.tableBorderProperties).map(k => `tableBorderProperties.${k}`).join(',');
          }

          const response = await slidesService.presentations.batchUpdate({
            presentationId: args.presentationId,
            requestBody: {
              requests: [{
                updateTableBorderProperties: updateTableBorderPropertiesRequest
              }]
            }
          });

          return {
            content: [{
              type: "text",
              text: JSON.stringify(response.data, null, 2)
            }],
            isError: false
          };
        } catch (error: any) {
          return errorResponse(error.message || 'Failed to update table border properties');
        }
      }

      case "slides_updateTableColumnProperties": {
        const validation = SlidesUpdateTableColumnPropertiesSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        try {
          const slidesService = google.slides({ version: 'v1', auth: authClient });

          const response = await slidesService.presentations.batchUpdate({
            presentationId: args.presentationId,
            requestBody: {
              requests: [{
                updateTableColumnProperties: {
                  objectId: args.objectId,
                  columnIndices: args.columnIndices,
                  tableColumnProperties: args.tableColumnProperties,
                  fields: 'columnWidth'
                }
              }]
            }
          });

          return {
            content: [{
              type: "text",
              text: JSON.stringify(response.data, null, 2)
            }],
            isError: false
          };
        } catch (error: any) {
          return errorResponse(error.message || 'Failed to update table column properties');
        }
      }

      case "slides_updateTableRowProperties": {
        const validation = SlidesUpdateTableRowPropertiesSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        try {
          const slidesService = google.slides({ version: 'v1', auth: authClient });

          const response = await slidesService.presentations.batchUpdate({
            presentationId: args.presentationId,
            requestBody: {
              requests: [{
                updateTableRowProperties: {
                  objectId: args.objectId,
                  rowIndices: args.rowIndices,
                  tableRowProperties: args.tableRowProperties,
                  fields: 'minRowHeight'
                }
              }]
            }
          });

          return {
            content: [{
              type: "text",
              text: JSON.stringify(response.data, null, 2)
            }],
            isError: false
          };
        } catch (error: any) {
          return errorResponse(error.message || 'Failed to update table row properties');
        }
      }

      case "slides_mergeTableCells": {
        const validation = SlidesMergeTableCellsSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        try {
          const slidesService = google.slides({ version: 'v1', auth: authClient });

          const response = await slidesService.presentations.batchUpdate({
            presentationId: args.presentationId,
            requestBody: {
              requests: [{
                mergeTableCells: {
                  objectId: args.objectId,
                  tableRange: args.tableRange
                }
              }]
            }
          });

          return {
            content: [{
              type: "text",
              text: JSON.stringify(response.data, null, 2)
            }],
            isError: false
          };
        } catch (error: any) {
          return errorResponse(error.message || 'Failed to merge table cells');
        }
      }

      case "slides_unmergeTableCells": {
        const validation = SlidesUnmergeTableCellsSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        try {
          const slidesService = google.slides({ version: 'v1', auth: authClient });

          const response = await slidesService.presentations.batchUpdate({
            presentationId: args.presentationId,
            requestBody: {
              requests: [{
                unmergeTableCells: {
                  objectId: args.objectId,
                  tableRange: args.tableRange
                }
              }]
            }
          });

          return {
            content: [{
              type: "text",
              text: JSON.stringify(response.data, null, 2)
            }],
            isError: false
          };
        } catch (error: any) {
          return errorResponse(error.message || 'Failed to unmerge table cells');
        }
      }

      case "slides_updatePageElementAltText": {
        const validation = SlidesUpdatePageElementAltTextSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        try {
          const slidesService = google.slides({ version: 'v1', auth: authClient });

          const updateRequest: any = {
            objectId: args.objectId
          };

          if (args.title !== undefined) {
            updateRequest.title = args.title;
          }

          if (args.description !== undefined) {
            updateRequest.description = args.description;
          }

          const response = await slidesService.presentations.batchUpdate({
            presentationId: args.presentationId,
            requestBody: {
              requests: [{
                updatePageElementAltText: updateRequest
              }]
            }
          });

          return {
            content: [{
              type: "text",
              text: JSON.stringify(response.data, null, 2)
            }],
            isError: false
          };
        } catch (error: any) {
          return errorResponse(error.message || 'Failed to update page element alt text');
        }
      }

      case "slides_updatePageElementsZOrder": {
        const validation = SlidesUpdatePageElementsZOrderSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        try {
          const slidesService = google.slides({ version: 'v1', auth: authClient });

          const response = await slidesService.presentations.batchUpdate({
            presentationId: args.presentationId,
            requestBody: {
              requests: [{
                updatePageElementsZOrder: {
                  pageElementObjectIds: args.pageElementObjectIds,
                  operation: args.operation
                }
              }]
            }
          });

          return {
            content: [{
              type: "text",
              text: JSON.stringify(response.data, null, 2)
            }],
            isError: false
          };
        } catch (error: any) {
          return errorResponse(error.message || 'Failed to update page elements z-order');
        }
      }

      case "slides_groupObjects": {
        const validation = SlidesGroupObjectsSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        try {
          const slidesService = google.slides({ version: 'v1', auth: authClient });

          const groupRequest: any = {
            childrenObjectIds: args.childrenObjectIds
          };

          if (args.groupObjectId) {
            groupRequest.groupObjectId = args.groupObjectId;
          }

          const response = await slidesService.presentations.batchUpdate({
            presentationId: args.presentationId,
            requestBody: {
              requests: [{
                groupObjects: groupRequest
              }]
            }
          });

          return {
            content: [{
              type: "text",
              text: JSON.stringify(response.data, null, 2)
            }],
            isError: false
          };
        } catch (error: any) {
          return errorResponse(error.message || 'Failed to group objects');
        }
      }

      case "slides_ungroupObjects": {
        const validation = SlidesUngroupObjectsSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        try {
          const slidesService = google.slides({ version: 'v1', auth: authClient });

          const response = await slidesService.presentations.batchUpdate({
            presentationId: args.presentationId,
            requestBody: {
              requests: [{
                ungroupObjects: {
                  objectIds: args.objectIds
                }
              }]
            }
          });

          return {
            content: [{
              type: "text",
              text: JSON.stringify(response.data, null, 2)
            }],
            isError: false
          };
        } catch (error: any) {
          return errorResponse(error.message || 'Failed to ungroup objects');
        }
      }

      case "slides_get": {
        const validation = SlidesGetSchema.safeParse(request.params.arguments);
        if (!validation.success) {
          return errorResponse(validation.error.errors[0].message);
        }
        const args = validation.data;

        try {
          const slidesService = google.slides({ version: 'v1', auth: authClient });
          const presentation = await slidesService.presentations.get({
            presentationId: args.presentationId
          });

          // Return raw API response as JSON
          return {
            content: [{
              type: "text",
              text: JSON.stringify(presentation.data, null, 2)
            }],
            isError: false
          };
        } catch (error: any) {
          return errorResponse(error.message || 'Failed to get presentation');
        }
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
        console.error(`Starting Google Drive Collaboration MCP Server v${VERSION}...`);
        const transport = new StdioServerTransport();
        await server.connect(transport);
        log(`Server v${VERSION} started successfully`);
        
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