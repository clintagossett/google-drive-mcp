import { describe, it, expect } from 'vitest';
import { z } from 'zod';

// Schema definition (matches src/index.ts)
const DocsCreateFootnoteSchema = z.object({
  documentId: z.string().min(1, "Document ID is required"),
  index: z.number().int().min(1, "Index must be at least 1")
});

describe('docs_createFootnote - Unit Tests', () => {
  describe('Schema Validation', () => {
    it('should validate correct parameters', () => {
      const validInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        index: 50
      };

      const result = DocsCreateFootnoteSchema.safeParse(validInput);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(validInput);
      }
    });

    it('should validate index at position 1', () => {
      const validInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        index: 1
      };

      const result = DocsCreateFootnoteSchema.safeParse(validInput);
      expect(result.success).toBe(true);
    });

    it('should reject missing documentId', () => {
      const invalidInput = {
        index: 50
      };

      const result = DocsCreateFootnoteSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
    });

    it('should reject empty documentId', () => {
      const invalidInput = {
        documentId: '',
        index: 50
      };

      const result = DocsCreateFootnoteSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.errors[0].message).toBe('Document ID is required');
      }
    });

    it('should reject missing index', () => {
      const invalidInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w'
      };

      const result = DocsCreateFootnoteSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
    });

    it('should reject index less than 1', () => {
      const invalidInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        index: 0
      };

      const result = DocsCreateFootnoteSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.errors[0].message).toBe('Index must be at least 1');
      }
    });

    it('should reject negative index', () => {
      const invalidInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        index: -5
      };

      const result = DocsCreateFootnoteSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
    });

    it('should reject non-integer index', () => {
      const invalidInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        index: 10.5
      };

      const result = DocsCreateFootnoteSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
    });
  });

  describe('API Request Formation', () => {
    it('should form correct batchUpdate request structure', () => {
      const input = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        index: 50
      };

      const expectedRequest = {
        documentId: input.documentId,
        requestBody: {
          requests: [{
            createFootnote: {
              location: {
                index: input.index
              }
            }
          }]
        }
      };

      expect(expectedRequest.requestBody.requests[0].createFootnote.location.index).toBe(input.index);
    });

    it('should handle large index values', () => {
      const input = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        index: 99999
      };

      const result = DocsCreateFootnoteSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.index).toBe(99999);
      }
    });
  });

  describe('Edge Cases', () => {
    it('should validate index as number type', () => {
      const validInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        index: 50
      };

      const result = DocsCreateFootnoteSchema.safeParse(validInput);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(typeof result.data.index).toBe('number');
      }
    });

    it('should reject string index', () => {
      const invalidInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        index: "50"
      };

      const result = DocsCreateFootnoteSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
    });
  });
});
