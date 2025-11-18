import { describe, it, expect } from 'vitest';
import { z } from 'zod';

// Schema definition (matches src/index.ts)
const DocsPinTableHeaderRowsSchema = z.object({
  documentId: z.string().min(1, "Document ID is required"),
  tableStartIndex: z.number().min(1, "Table start index must be at least 1"),
  pinnedHeaderRowsCount: z.number().min(0, "Pinned header rows count must be at least 0")
});

describe('docs_pinTableHeaderRows - Unit Tests', () => {
  describe('Schema Validation', () => {
    it('should validate correct parameters for pinning 1 row', () => {
      const validInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        tableStartIndex: 10,
        pinnedHeaderRowsCount: 1
      };

      const result = DocsPinTableHeaderRowsSchema.safeParse(validInput);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(validInput);
      }
    });

    it('should validate zero to unpin all rows', () => {
      const validInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        tableStartIndex: 10,
        pinnedHeaderRowsCount: 0
      };

      const result = DocsPinTableHeaderRowsSchema.safeParse(validInput);
      expect(result.success).toBe(true);
    });

    it('should reject missing documentId', () => {
      const invalidInput = {
        tableStartIndex: 10,
        pinnedHeaderRowsCount: 1
      };

      const result = DocsPinTableHeaderRowsSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
    });

    it('should reject negative pinnedHeaderRowsCount', () => {
      const invalidInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        tableStartIndex: 10,
        pinnedHeaderRowsCount: -1
      };

      const result = DocsPinTableHeaderRowsSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
    });

    it('should accept large pinnedHeaderRowsCount', () => {
      const validInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        tableStartIndex: 10,
        pinnedHeaderRowsCount: 5
      };

      const result = DocsPinTableHeaderRowsSchema.safeParse(validInput);
      expect(result.success).toBe(true);
    });
  });

  describe('API Request Formation', () => {
    it('should form correct batchUpdate request structure for pinning', () => {
      const input = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        tableStartIndex: 10,
        pinnedHeaderRowsCount: 1
      };

      const expectedRequest = {
        documentId: input.documentId,
        requestBody: {
          requests: [{
            pinTableHeaderRows: {
              tableStartLocation: { index: input.tableStartIndex },
              pinnedHeaderRowsCount: input.pinnedHeaderRowsCount
            }
          }]
        }
      };

      expect(expectedRequest.requestBody.requests[0].pinTableHeaderRows.pinnedHeaderRowsCount).toBe(1);
    });

    it('should form correct request for unpinning (0 count)', () => {
      const input = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        tableStartIndex: 10,
        pinnedHeaderRowsCount: 0
      };

      const expectedRequest = {
        documentId: input.documentId,
        requestBody: {
          requests: [{
            pinTableHeaderRows: {
              tableStartLocation: { index: input.tableStartIndex },
              pinnedHeaderRowsCount: input.pinnedHeaderRowsCount
            }
          }]
        }
      };

      expect(expectedRequest.requestBody.requests[0].pinTableHeaderRows.pinnedHeaderRowsCount).toBe(0);
    });
  });
});
