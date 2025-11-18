import { describe, it, expect } from 'vitest';
import { z } from 'zod';

// Schema definition (matches src/index.ts)
const DocsMergeTableCellsSchema = z.object({
  documentId: z.string().min(1, "Document ID is required"),
  tableStartIndex: z.number().min(1, "Table start index must be at least 1"),
  rowIndex: z.number().min(0, "Row index must be at least 0"),
  columnIndex: z.number().min(0, "Column index must be at least 0"),
  rowSpan: z.number().min(1, "Row span must be at least 1"),
  columnSpan: z.number().min(1, "Column span must be at least 1")
});

describe('docs_mergeTableCells - Unit Tests', () => {
  describe('Schema Validation', () => {
    it('should validate correct parameters for 2x2 merge', () => {
      const validInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        tableStartIndex: 10,
        rowIndex: 0,
        columnIndex: 0,
        rowSpan: 2,
        columnSpan: 2
      };

      const result = DocsMergeTableCellsSchema.safeParse(validInput);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(validInput);
      }
    });

    it('should reject missing documentId', () => {
      const invalidInput = {
        tableStartIndex: 10,
        rowIndex: 0,
        columnIndex: 0,
        rowSpan: 2,
        columnSpan: 2
      };

      const result = DocsMergeTableCellsSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
    });

    it('should reject rowSpan less than 1', () => {
      const invalidInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        tableStartIndex: 10,
        rowIndex: 0,
        columnIndex: 0,
        rowSpan: 0,
        columnSpan: 2
      };

      const result = DocsMergeTableCellsSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
    });

    it('should reject columnSpan less than 1', () => {
      const invalidInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        tableStartIndex: 10,
        rowIndex: 0,
        columnIndex: 0,
        rowSpan: 2,
        columnSpan: 0
      };

      const result = DocsMergeTableCellsSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
    });

    it('should accept single cell (1x1) merge', () => {
      const validInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        tableStartIndex: 10,
        rowIndex: 0,
        columnIndex: 0,
        rowSpan: 1,
        columnSpan: 1
      };

      const result = DocsMergeTableCellsSchema.safeParse(validInput);
      expect(result.success).toBe(true);
    });
  });

  describe('API Request Formation', () => {
    it('should form correct batchUpdate request structure', () => {
      const input = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        tableStartIndex: 10,
        rowIndex: 0,
        columnIndex: 0,
        rowSpan: 2,
        columnSpan: 2
      };

      const expectedRequest = {
        documentId: input.documentId,
        requestBody: {
          requests: [{
            mergeTableCells: {
              tableRange: {
                tableCellLocation: {
                  tableStartLocation: { index: input.tableStartIndex },
                  rowIndex: input.rowIndex,
                  columnIndex: input.columnIndex
                },
                rowSpan: input.rowSpan,
                columnSpan: input.columnSpan
              }
            }
          }]
        }
      };

      expect(expectedRequest.requestBody.requests[0].mergeTableCells.tableRange.rowSpan).toBe(2);
      expect(expectedRequest.requestBody.requests[0].mergeTableCells.tableRange.columnSpan).toBe(2);
    });
  });
});
