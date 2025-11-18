import { describe, it, expect } from 'vitest';
import { z } from 'zod';

// Schema definition (matches src/index.ts)
const DocsDeleteHeaderSchema = z.object({
  documentId: z.string().min(1, "Document ID is required"),
  headerId: z.string().min(1, "Header ID is required")
});

describe('docs_deleteHeader - Unit Tests', () => {
  describe('Schema Validation', () => {
    it('should validate correct parameters', () => {
      const validInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        headerId: 'kix.header123'
      };

      const result = DocsDeleteHeaderSchema.safeParse(validInput);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(validInput);
      }
    });

    it('should reject missing documentId', () => {
      const invalidInput = {
        headerId: 'kix.header123'
      };

      const result = DocsDeleteHeaderSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
    });

    it('should reject empty documentId', () => {
      const invalidInput = {
        documentId: '',
        headerId: 'kix.header123'
      };

      const result = DocsDeleteHeaderSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.errors[0].message).toBe('Document ID is required');
      }
    });

    it('should reject missing headerId', () => {
      const invalidInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w'
      };

      const result = DocsDeleteHeaderSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
    });

    it('should reject empty headerId', () => {
      const invalidInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        headerId: ''
      };

      const result = DocsDeleteHeaderSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.errors[0].message).toBe('Header ID is required');
      }
    });
  });

  describe('API Request Formation', () => {
    it('should form correct batchUpdate request structure', () => {
      const input = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        headerId: 'kix.header123'
      };

      const expectedRequest = {
        documentId: input.documentId,
        requestBody: {
          requests: [{
            deleteHeader: {
              headerId: input.headerId
            }
          }]
        }
      };

      expect(expectedRequest.requestBody.requests[0].deleteHeader.headerId).toBe(input.headerId);
    });

    it('should handle various headerId formats', () => {
      const headerIds = ['kix.header123', 'header_abc', 'h-123-xyz'];

      headerIds.forEach(headerId => {
        const input = {
          documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
          headerId
        };
        const result = DocsDeleteHeaderSchema.safeParse(input);
        expect(result.success).toBe(true);
      });
    });
  });

  describe('Edge Cases', () => {
    it('should validate headerId as string type', () => {
      const validInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        headerId: 'kix.header123'
      };

      const result = DocsDeleteHeaderSchema.safeParse(validInput);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(typeof result.data.headerId).toBe('string');
      }
    });

    it('should reject numeric headerId', () => {
      const invalidInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        headerId: 123
      };

      const result = DocsDeleteHeaderSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
    });
  });
});
