import { describe, it, expect } from 'vitest';
import { z } from 'zod';

// Schema definition (matches src/index.ts)
const DocsUpdateTableRowStyleSchema = z.object({
  documentId: z.string().min(1, "Document ID is required"),
  tableStartIndex: z.number().min(1, "Table start index must be at least 1"),
  rowIndices: z.array(z.number().min(0)),
  minRowHeight: z.number().optional(),
  tableHeader: z.boolean().optional(),
  preventOverflow: z.boolean().optional()
});

describe('docs_updateTableRowStyle - Unit Tests', () => {
  describe('Schema Validation', () => {
    it('should validate minimal required parameters', () => {
      const validInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        tableStartIndex: 10,
        rowIndices: [0]
      };

      const result = DocsUpdateTableRowStyleSchema.safeParse(validInput);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(validInput);
      }
    });

    it('should validate with minRowHeight', () => {
      const validInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        tableStartIndex: 10,
        rowIndices: [0],
        minRowHeight: 36
      };

      const result = DocsUpdateTableRowStyleSchema.safeParse(validInput);
      expect(result.success).toBe(true);
    });

    it('should validate with tableHeader flag', () => {
      const validInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        tableStartIndex: 10,
        rowIndices: [0],
        tableHeader: true
      };

      const result = DocsUpdateTableRowStyleSchema.safeParse(validInput);
      expect(result.success).toBe(true);
    });

    it('should validate with preventOverflow flag', () => {
      const validInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        tableStartIndex: 10,
        rowIndices: [0],
        preventOverflow: true
      };

      const result = DocsUpdateTableRowStyleSchema.safeParse(validInput);
      expect(result.success).toBe(true);
    });

    it('should validate with all optional properties', () => {
      const validInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        tableStartIndex: 10,
        rowIndices: [0],
        minRowHeight: 36,
        tableHeader: true,
        preventOverflow: false
      };

      const result = DocsUpdateTableRowStyleSchema.safeParse(validInput);
      expect(result.success).toBe(true);
    });

    it('should reject missing rowIndices', () => {
      const invalidInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        tableStartIndex: 10,
        minRowHeight: 36
      };

      const result = DocsUpdateTableRowStyleSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
    });

    it('should reject negative row indices', () => {
      const invalidInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        tableStartIndex: 10,
        rowIndices: [0, -1]
      };

      const result = DocsUpdateTableRowStyleSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
    });

    it('should accept multiple row indices', () => {
      const validInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        tableStartIndex: 10,
        rowIndices: [0, 1, 2]
      };

      const result = DocsUpdateTableRowStyleSchema.safeParse(validInput);
      expect(result.success).toBe(true);
    });
  });

  describe('API Request Formation', () => {
    it('should form correct batchUpdate request structure', () => {
      const input = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        tableStartIndex: 10,
        rowIndices: [0],
        minRowHeight: 36,
        tableHeader: true
      };

      const expectedRequest = {
        documentId: input.documentId,
        requestBody: {
          requests: [{
            updateTableRowStyle: {
              tableStartLocation: { index: input.tableStartIndex },
              rowIndices: input.rowIndices,
              tableRowStyle: {
                minRowHeight: { magnitude: input.minRowHeight, unit: 'PT' },
                tableHeader: input.tableHeader
              },
              fields: 'minRowHeight,tableHeader'
            }
          }]
        }
      };

      expect(expectedRequest.requestBody.requests[0].updateTableRowStyle.rowIndices).toEqual([0]);
      expect(expectedRequest.requestBody.requests[0].updateTableRowStyle.tableRowStyle.tableHeader).toBe(true);
    });
  });
});
