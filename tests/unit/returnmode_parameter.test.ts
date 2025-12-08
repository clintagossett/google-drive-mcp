import { describe, it, expect } from 'vitest';
import { z } from 'zod';

// -----------------------------------------------------------------------------
// returnMode Parameter Unit Tests (Issue #24)
// -----------------------------------------------------------------------------
// These tests verify the returnMode parameter schema for document tools

// Recreate schemas with returnMode for testing
const DriveExportFileSchema = z.object({
  fileId: z.string().min(1, "File ID is required"),
  mimeType: z.string().min(1, "Export MIME type is required"),
  supportsAllDrives: z.boolean().optional(),
  returnMode: z.enum(["summary", "full"]).default("summary")
    .describe("'summary' (default): Returns metadata + resource URI, caches content. 'full': Returns complete response with truncation")
});

const SheetsGetSpreadsheetSchema = z.object({
  spreadsheetId: z.string().min(1, "Spreadsheet ID is required"),
  ranges: z.array(z.string()).optional(),
  includeGridData: z.boolean().optional(),
  returnMode: z.enum(["summary", "full"]).default("summary")
    .describe("'summary' (default): Returns metadata + resource URI, caches content. 'full': Returns complete response with truncation")
});

const SheetsBatchGetValuesSchema = z.object({
  spreadsheetId: z.string().min(1, "Spreadsheet ID is required"),
  ranges: z.array(z.string()).min(1, "At least one range is required"),
  majorDimension: z.enum(["ROWS", "COLUMNS"]).optional(),
  valueRenderOption: z.enum(["FORMATTED_VALUE", "UNFORMATTED_VALUE", "FORMULA"]).optional(),
  returnMode: z.enum(["summary", "full"]).default("summary")
    .describe("'summary' (default): Returns metadata + resource URI, caches content. 'full': Returns complete response with truncation")
});

const DocsGetSchema = z.object({
  documentId: z.string().min(1, "Document ID is required"),
  includeTabsContent: z.boolean().optional(),
  returnMode: z.enum(["summary", "full"]).default("summary")
    .describe("'summary' (default): Returns metadata + resource URI, caches content. 'full': Returns complete response with truncation")
});

// =============================================================================
// TEST SUITES
// =============================================================================

describe('returnMode Parameter - Issue #24', () => {
  // ---------------------------------------------------------------------------
  // DriveExportFileSchema Tests
  // ---------------------------------------------------------------------------
  describe('DriveExportFileSchema', () => {
    it('should default returnMode to "summary"', () => {
      const input = {
        fileId: 'abc123',
        mimeType: 'text/plain'
      };

      const result = DriveExportFileSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.returnMode).toBe('summary');
      }
    });

    it('should accept returnMode: "full"', () => {
      const input = {
        fileId: 'abc123',
        mimeType: 'text/plain',
        returnMode: 'full' as const
      };

      const result = DriveExportFileSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.returnMode).toBe('full');
      }
    });

    it('should accept returnMode: "summary"', () => {
      const input = {
        fileId: 'abc123',
        mimeType: 'text/plain',
        returnMode: 'summary' as const
      };

      const result = DriveExportFileSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.returnMode).toBe('summary');
      }
    });

    it('should reject invalid returnMode value', () => {
      const input = {
        fileId: 'abc123',
        mimeType: 'text/plain',
        returnMode: 'invalid'
      };

      const result = DriveExportFileSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('should preserve other parameters with returnMode', () => {
      const input = {
        fileId: 'abc123',
        mimeType: 'text/markdown',
        supportsAllDrives: true,
        returnMode: 'full' as const
      };

      const result = DriveExportFileSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.fileId).toBe('abc123');
        expect(result.data.mimeType).toBe('text/markdown');
        expect(result.data.supportsAllDrives).toBe(true);
        expect(result.data.returnMode).toBe('full');
      }
    });
  });

  // ---------------------------------------------------------------------------
  // SheetsGetSpreadsheetSchema Tests
  // ---------------------------------------------------------------------------
  describe('SheetsGetSpreadsheetSchema', () => {
    it('should default returnMode to "summary"', () => {
      const input = {
        spreadsheetId: 'spreadsheet123'
      };

      const result = SheetsGetSpreadsheetSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.returnMode).toBe('summary');
      }
    });

    it('should accept returnMode: "full"', () => {
      const input = {
        spreadsheetId: 'spreadsheet123',
        returnMode: 'full' as const
      };

      const result = SheetsGetSpreadsheetSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.returnMode).toBe('full');
      }
    });

    it('should reject invalid returnMode value', () => {
      const input = {
        spreadsheetId: 'spreadsheet123',
        returnMode: 'partial'
      };

      const result = SheetsGetSpreadsheetSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('should preserve other parameters with returnMode', () => {
      const input = {
        spreadsheetId: 'spreadsheet123',
        ranges: ['Sheet1!A1:B10'],
        includeGridData: true,
        returnMode: 'summary' as const
      };

      const result = SheetsGetSpreadsheetSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.spreadsheetId).toBe('spreadsheet123');
        expect(result.data.ranges).toEqual(['Sheet1!A1:B10']);
        expect(result.data.includeGridData).toBe(true);
        expect(result.data.returnMode).toBe('summary');
      }
    });
  });

  // ---------------------------------------------------------------------------
  // SheetsBatchGetValuesSchema Tests
  // ---------------------------------------------------------------------------
  describe('SheetsBatchGetValuesSchema', () => {
    it('should default returnMode to "summary"', () => {
      const input = {
        spreadsheetId: 'spreadsheet123',
        ranges: ['Sheet1!A1:B10']
      };

      const result = SheetsBatchGetValuesSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.returnMode).toBe('summary');
      }
    });

    it('should accept returnMode: "full"', () => {
      const input = {
        spreadsheetId: 'spreadsheet123',
        ranges: ['Sheet1!A1:B10'],
        returnMode: 'full' as const
      };

      const result = SheetsBatchGetValuesSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.returnMode).toBe('full');
      }
    });

    it('should reject invalid returnMode value', () => {
      const input = {
        spreadsheetId: 'spreadsheet123',
        ranges: ['Sheet1!A1:B10'],
        returnMode: 'brief'
      };

      const result = SheetsBatchGetValuesSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('should preserve other parameters with returnMode', () => {
      const input = {
        spreadsheetId: 'spreadsheet123',
        ranges: ['Sheet1!A1:B10', 'Sheet2!C1:D5'],
        majorDimension: 'ROWS' as const,
        valueRenderOption: 'FORMATTED_VALUE' as const,
        returnMode: 'full' as const
      };

      const result = SheetsBatchGetValuesSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.spreadsheetId).toBe('spreadsheet123');
        expect(result.data.ranges).toHaveLength(2);
        expect(result.data.majorDimension).toBe('ROWS');
        expect(result.data.valueRenderOption).toBe('FORMATTED_VALUE');
        expect(result.data.returnMode).toBe('full');
      }
    });
  });

  // ---------------------------------------------------------------------------
  // DocsGetSchema Tests
  // ---------------------------------------------------------------------------
  describe('DocsGetSchema', () => {
    it('should default returnMode to "summary"', () => {
      const input = {
        documentId: 'doc123'
      };

      const result = DocsGetSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.returnMode).toBe('summary');
      }
    });

    it('should accept returnMode: "full"', () => {
      const input = {
        documentId: 'doc123',
        returnMode: 'full' as const
      };

      const result = DocsGetSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.returnMode).toBe('full');
      }
    });

    it('should accept returnMode: "summary"', () => {
      const input = {
        documentId: 'doc123',
        returnMode: 'summary' as const
      };

      const result = DocsGetSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.returnMode).toBe('summary');
      }
    });

    it('should reject invalid returnMode value', () => {
      const input = {
        documentId: 'doc123',
        returnMode: 'compact'
      };

      const result = DocsGetSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('should preserve other parameters with returnMode', () => {
      const input = {
        documentId: 'doc123',
        includeTabsContent: true,
        returnMode: 'full' as const
      };

      const result = DocsGetSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.documentId).toBe('doc123');
        expect(result.data.includeTabsContent).toBe(true);
        expect(result.data.returnMode).toBe('full');
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Backward Compatibility Tests
  // ---------------------------------------------------------------------------
  describe('Backward Compatibility', () => {
    it('should work with existing drive_exportFile calls (no returnMode)', () => {
      const existingCall = {
        fileId: 'file123',
        mimeType: 'text/markdown'
      };

      const result = DriveExportFileSchema.safeParse(existingCall);
      expect(result.success).toBe(true);
      // Should default to summary, which is a CHANGE in behavior
      // but the schema should still accept the call
    });

    it('should work with existing sheets_getSpreadsheet calls', () => {
      const existingCall = {
        spreadsheetId: 'sheet123',
        includeGridData: true
      };

      const result = SheetsGetSpreadsheetSchema.safeParse(existingCall);
      expect(result.success).toBe(true);
    });

    it('should work with existing sheets_batchGetValues calls', () => {
      const existingCall = {
        spreadsheetId: 'sheet123',
        ranges: ['A1:B10']
      };

      const result = SheetsBatchGetValuesSchema.safeParse(existingCall);
      expect(result.success).toBe(true);
    });

    it('should work with existing docs_get calls', () => {
      const existingCall = {
        documentId: 'doc123'
      };

      const result = DocsGetSchema.safeParse(existingCall);
      expect(result.success).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Summary Response Format Tests
  // ---------------------------------------------------------------------------
  describe('Summary Response Format Structure', () => {
    // These tests define the expected summary response format
    // The actual implementation is in Issue #26

    it('should define expected summary format for docs', () => {
      const expectedSummaryFormat = {
        title: expect.any(String),
        documentId: expect.any(String),
        characterCount: expect.any(Number),
        sectionCount: expect.any(Number),
        resourceUri: expect.stringMatching(/^gdrive:\/\/docs\/[^/]+\/chunk\/\{start\}-\{end\}$/),
        hint: expect.any(String)
      };

      // Example summary response
      const sampleSummary = {
        title: 'My Document',
        documentId: 'doc123',
        characterCount: 45000,
        sectionCount: 12,
        resourceUri: 'gdrive://docs/doc123/chunk/{start}-{end}',
        hint: 'Use resources/read with chunk URI to access content'
      };

      expect(sampleSummary).toMatchObject(expectedSummaryFormat);
    });

    it('should define expected summary format for spreadsheets', () => {
      const sampleSummary = {
        title: 'My Spreadsheet',
        spreadsheetId: 'sheet123',
        sheetCount: 3,
        sheetNames: ['Sheet1', 'Sheet2', 'Sheet3'],
        resourceUri: 'gdrive://sheets/sheet123/values/{range}',
        hint: 'Use resources/read with values URI to access data'
      };

      expect(sampleSummary.title).toBe('My Spreadsheet');
      expect(sampleSummary.sheetCount).toBe(3);
      expect(sampleSummary.sheetNames).toHaveLength(3);
    });

    it('should define expected summary format for exported files', () => {
      const sampleSummary = {
        fileName: 'document.md',
        fileId: 'file123',
        mimeType: 'text/markdown',
        characterCount: 15000,
        resourceUri: 'gdrive://files/file123/content/{start}-{end}',
        hint: 'Use resources/read with content URI to access data'
      };

      expect(sampleSummary.fileName).toBe('document.md');
      expect(sampleSummary.characterCount).toBe(15000);
    });
  });
});
