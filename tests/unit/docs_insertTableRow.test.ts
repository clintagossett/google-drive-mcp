import { describe, it, expect } from 'vitest';
import { z } from 'zod';

// Schema definition (matches src/index.ts)
const DocsInsertTableRowSchema = z.object({
  documentId: z.string().min(1, "Document ID is required"),
  tableStartIndex: z.number().min(1, "Table start index must be at least 1"),
  rowIndex: z.number().min(0, "Row index must be at least 0"),
  columnIndex: z.number().min(0, "Column index must be at least 0"),
  insertBelow: z.boolean()
});

describe('docs_insertTableRow - Unit Tests', () => {
  describe('Schema Validation', () => {
    it('should validate correct parameters with insertBelow true', () => {
      const validInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        tableStartIndex: 10,
        rowIndex: 1,
        columnIndex: 0,
        insertBelow: true
      };

      const result = DocsInsertTableRowSchema.safeParse(validInput);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(validInput);
      }
    });

    it('should validate correct parameters with insertBelow false', () => {
      const validInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        tableStartIndex: 10,
        rowIndex: 1,
        columnIndex: 0,
        insertBelow: false
      };

      const result = DocsInsertTableRowSchema.safeParse(validInput);
      expect(result.success).toBe(true);
    });

    it('should reject missing insertBelow', () => {
      const invalidInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        tableStartIndex: 10,
        rowIndex: 1,
        columnIndex: 0
      };

      const result = DocsInsertTableRowSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
    });

    it('should reject negative rowIndex', () => {
      const invalidInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        tableStartIndex: 10,
        rowIndex: -1,
        columnIndex: 0,
        insertBelow: true
      };

      const result = DocsInsertTableRowSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
    });
  });

  describe('API Request Formation', () => {
    it('should form correct request for inserting below', () => {
      const input = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        tableStartIndex: 10,
        rowIndex: 1,
        columnIndex: 0,
        insertBelow: true
      };

      const expectedRequest = {
        documentId: input.documentId,
        requestBody: {
          requests: [{
            insertTableRow: {
              tableCellLocation: {
                tableStartLocation: { index: input.tableStartIndex },
                rowIndex: input.rowIndex,
                columnIndex: input.columnIndex
              },
              insertBelow: input.insertBelow
            }
          }]
        }
      };

      expect(expectedRequest.requestBody.requests[0].insertTableRow.insertBelow).toBe(true);
    });

    it('should form correct request for inserting above', () => {
      const input = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        tableStartIndex: 10,
        rowIndex: 1,
        columnIndex: 0,
        insertBelow: false
      };

      const expectedRequest = {
        documentId: input.documentId,
        requestBody: {
          requests: [{
            insertTableRow: {
              tableCellLocation: {
                tableStartLocation: { index: input.tableStartIndex },
                rowIndex: input.rowIndex,
                columnIndex: input.columnIndex
              },
              insertBelow: input.insertBelow
            }
          }]
        }
      };

      expect(expectedRequest.requestBody.requests[0].insertTableRow.insertBelow).toBe(false);
    });
  });
});
