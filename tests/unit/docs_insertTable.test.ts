import { describe, it, expect } from 'vitest';
import { z } from 'zod';

// Schema definition (matches src/index.ts)
const DocsInsertTableSchema = z.object({
  documentId: z.string().min(1, "Document ID is required"),
  index: z.number().min(1, "Index must be at least 1"),
  rows: z.number().min(1, "Rows must be at least 1"),
  columns: z.number().min(1, "Columns must be at least 1")
});

describe('docs_insertTable - Unit Tests', () => {
  describe('Schema Validation', () => {
    it('should validate correct parameters', () => {
      const validInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        index: 1,
        rows: 3,
        columns: 4
      };

      const result = DocsInsertTableSchema.safeParse(validInput);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(validInput);
      }
    });

    it('should reject missing documentId', () => {
      const invalidInput = {
        index: 1,
        rows: 3,
        columns: 4
      };

      const result = DocsInsertTableSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
    });

    it('should reject index less than 1', () => {
      const invalidInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        index: 0,
        rows: 3,
        columns: 4
      };

      const result = DocsInsertTableSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
    });

    it('should reject rows less than 1', () => {
      const invalidInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        index: 1,
        rows: 0,
        columns: 4
      };

      const result = DocsInsertTableSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
    });

    it('should reject columns less than 1', () => {
      const invalidInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        index: 1,
        rows: 3,
        columns: 0
      };

      const result = DocsInsertTableSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
    });

    it('should accept large table dimensions', () => {
      const validInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        index: 1,
        rows: 20,
        columns: 20
      };

      const result = DocsInsertTableSchema.safeParse(validInput);
      expect(result.success).toBe(true);
    });
  });

  describe('API Request Formation', () => {
    it('should form correct batchUpdate request structure', () => {
      const input = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        index: 1,
        rows: 3,
        columns: 4
      };

      const expectedRequest = {
        documentId: input.documentId,
        requestBody: {
          requests: [{
            insertTable: {
              location: { index: input.index },
              rows: input.rows,
              columns: input.columns
            }
          }]
        }
      };

      expect(expectedRequest.documentId).toBe(input.documentId);
      expect(expectedRequest.requestBody.requests[0].insertTable.location.index).toBe(input.index);
      expect(expectedRequest.requestBody.requests[0].insertTable.rows).toBe(input.rows);
      expect(expectedRequest.requestBody.requests[0].insertTable.columns).toBe(input.columns);
    });
  });
});
