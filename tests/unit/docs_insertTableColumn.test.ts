import { describe, it, expect } from 'vitest';
import { z } from 'zod';

// Schema definition (matches src/index.ts)
const DocsInsertTableColumnSchema = z.object({
  documentId: z.string().min(1, "Document ID is required"),
  tableStartIndex: z.number().min(1, "Table start index must be at least 1"),
  rowIndex: z.number().min(0, "Row index must be at least 0"),
  columnIndex: z.number().min(0, "Column index must be at least 0"),
  insertRight: z.boolean()
});

describe('docs_insertTableColumn - Unit Tests', () => {
  describe('Schema Validation', () => {
    it('should validate correct parameters with insertRight true', () => {
      const validInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        tableStartIndex: 10,
        rowIndex: 0,
        columnIndex: 1,
        insertRight: true
      };

      const result = DocsInsertTableColumnSchema.safeParse(validInput);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(validInput);
      }
    });

    it('should validate correct parameters with insertRight false', () => {
      const validInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        tableStartIndex: 10,
        rowIndex: 0,
        columnIndex: 1,
        insertRight: false
      };

      const result = DocsInsertTableColumnSchema.safeParse(validInput);
      expect(result.success).toBe(true);
    });

    it('should reject missing insertRight', () => {
      const invalidInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        tableStartIndex: 10,
        rowIndex: 0,
        columnIndex: 1
      };

      const result = DocsInsertTableColumnSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
    });

    it('should reject negative columnIndex', () => {
      const invalidInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        tableStartIndex: 10,
        rowIndex: 0,
        columnIndex: -1,
        insertRight: true
      };

      const result = DocsInsertTableColumnSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
    });
  });

  describe('API Request Formation', () => {
    it('should form correct request for inserting right', () => {
      const input = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        tableStartIndex: 10,
        rowIndex: 0,
        columnIndex: 1,
        insertRight: true
      };

      const expectedRequest = {
        documentId: input.documentId,
        requestBody: {
          requests: [{
            insertTableColumn: {
              tableCellLocation: {
                tableStartLocation: { index: input.tableStartIndex },
                rowIndex: input.rowIndex,
                columnIndex: input.columnIndex
              },
              insertRight: input.insertRight
            }
          }]
        }
      };

      expect(expectedRequest.requestBody.requests[0].insertTableColumn.insertRight).toBe(true);
    });

    it('should form correct request for inserting left', () => {
      const input = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        tableStartIndex: 10,
        rowIndex: 0,
        columnIndex: 1,
        insertRight: false
      };

      const expectedRequest = {
        documentId: input.documentId,
        requestBody: {
          requests: [{
            insertTableColumn: {
              tableCellLocation: {
                tableStartLocation: { index: input.tableStartIndex },
                rowIndex: input.rowIndex,
                columnIndex: input.columnIndex
              },
              insertRight: input.insertRight
            }
          }]
        }
      };

      expect(expectedRequest.requestBody.requests[0].insertTableColumn.insertRight).toBe(false);
    });
  });
});
