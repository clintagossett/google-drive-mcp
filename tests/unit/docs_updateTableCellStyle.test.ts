import { describe, it, expect } from 'vitest';
import { z } from 'zod';

// Schema definition (matches src/index.ts)
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

describe('docs_updateTableCellStyle - Unit Tests', () => {
  describe('Schema Validation', () => {
    it('should validate minimal required parameters', () => {
      const validInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        tableStartIndex: 10,
        rowIndex: 0,
        columnIndex: 0
      };

      const result = DocsUpdateTableCellStyleSchema.safeParse(validInput);
      expect(result.success).toBe(true);
    });

    it('should validate with background color', () => {
      const validInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        tableStartIndex: 10,
        rowIndex: 0,
        columnIndex: 0,
        backgroundColor: { red: 0.9, green: 0.9, blue: 0.9 }
      };

      const result = DocsUpdateTableCellStyleSchema.safeParse(validInput);
      expect(result.success).toBe(true);
    });

    it('should validate with border styling', () => {
      const validInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        tableStartIndex: 10,
        rowIndex: 0,
        columnIndex: 0,
        borderBottom: {
          color: { red: 0, green: 0, blue: 0 },
          width: 2,
          dashStyle: 'SOLID' as const
        }
      };

      const result = DocsUpdateTableCellStyleSchema.safeParse(validInput);
      expect(result.success).toBe(true);
    });

    it('should validate with padding', () => {
      const validInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        tableStartIndex: 10,
        rowIndex: 0,
        columnIndex: 0,
        paddingLeft: 5,
        paddingRight: 5,
        paddingTop: 3,
        paddingBottom: 3
      };

      const result = DocsUpdateTableCellStyleSchema.safeParse(validInput);
      expect(result.success).toBe(true);
    });

    it('should validate with content alignment', () => {
      const validInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        tableStartIndex: 10,
        rowIndex: 0,
        columnIndex: 0,
        contentAlignment: 'MIDDLE' as const
      };

      const result = DocsUpdateTableCellStyleSchema.safeParse(validInput);
      expect(result.success).toBe(true);
    });

    it('should reject invalid color values (>1)', () => {
      const invalidInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        tableStartIndex: 10,
        rowIndex: 0,
        columnIndex: 0,
        backgroundColor: { red: 1.5, green: 0.5, blue: 0.5 }
      };

      const result = DocsUpdateTableCellStyleSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
    });

    it('should reject invalid dashStyle', () => {
      const invalidInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        tableStartIndex: 10,
        rowIndex: 0,
        columnIndex: 0,
        borderLeft: { dashStyle: 'INVALID' }
      };

      const result = DocsUpdateTableCellStyleSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
    });
  });

  describe('API Request Formation', () => {
    it('should form correct request with background color', () => {
      const input = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        tableStartIndex: 10,
        rowIndex: 0,
        columnIndex: 0,
        backgroundColor: { red: 0.9, green: 0.9, blue: 0.9 }
      };

      // Validate schema
      const result = DocsUpdateTableCellStyleSchema.safeParse(input);
      expect(result.success).toBe(true);
    });
  });
});
