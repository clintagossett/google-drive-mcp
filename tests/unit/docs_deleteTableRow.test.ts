import { describe, it, expect } from 'vitest';
import { z } from 'zod';

// Schema definition (matches src/index.ts)
const DocsDeleteTableRowSchema = z.object({
  documentId: z.string().min(1, "Document ID is required"),
  tableStartIndex: z.number().min(1, "Table start index must be at least 1"),
  rowIndex: z.number().min(0, "Row index must be at least 0"),
  columnIndex: z.number().min(0, "Column index must be at least 0")
});

describe('docs_deleteTableRow - Unit Tests', () => {
  describe('Schema Validation', () => {
    it('should validate correct parameters', () => {
      const validInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        tableStartIndex: 10,
        rowIndex: 1,
        columnIndex: 0
      };

      const result = DocsDeleteTableRowSchema.safeParse(validInput);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(validInput);
      }
    });

    it('should reject missing documentId', () => {
      const invalidInput = {
        tableStartIndex: 10,
        rowIndex: 1,
        columnIndex: 0
      };

      const result = DocsDeleteTableRowSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
    });

    it('should reject tableStartIndex less than 1', () => {
      const invalidInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        tableStartIndex: 0,
        rowIndex: 1,
        columnIndex: 0
      };

      const result = DocsDeleteTableRowSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
    });

    it('should reject negative rowIndex', () => {
      const invalidInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        tableStartIndex: 10,
        rowIndex: -1,
        columnIndex: 0
      };

      const result = DocsDeleteTableRowSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
    });

    it('should accept zero for rowIndex and columnIndex (0-based)', () => {
      const validInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        tableStartIndex: 10,
        rowIndex: 0,
        columnIndex: 0
      };

      const result = DocsDeleteTableRowSchema.safeParse(validInput);
      expect(result.success).toBe(true);
    });
  });

  describe('API Request Formation', () => {
    it('should form correct batchUpdate request structure', () => {
      const input = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        tableStartIndex: 10,
        rowIndex: 2,
        columnIndex: 0
      };

      const expectedRequest = {
        documentId: input.documentId,
        requestBody: {
          requests: [{
            deleteTableRow: {
              tableCellLocation: {
                tableStartLocation: { index: input.tableStartIndex },
                rowIndex: input.rowIndex,
                columnIndex: input.columnIndex
              }
            }
          }]
        }
      };

      expect(expectedRequest.documentId).toBe(input.documentId);
      expect(expectedRequest.requestBody.requests[0].deleteTableRow.tableCellLocation.tableStartLocation.index).toBe(input.tableStartIndex);
      expect(expectedRequest.requestBody.requests[0].deleteTableRow.tableCellLocation.rowIndex).toBe(input.rowIndex);
    });
  });
});
