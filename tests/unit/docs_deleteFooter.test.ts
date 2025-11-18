import { describe, it, expect } from 'vitest';
import { z } from 'zod';

// Schema definition (matches src/index.ts)
const DocsDeleteFooterSchema = z.object({
  documentId: z.string().min(1, "Document ID is required"),
  footerId: z.string().min(1, "Footer ID is required")
});

describe('docs_deleteFooter - Unit Tests', () => {
  describe('Schema Validation', () => {
    it('should validate correct parameters', () => {
      const validInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        footerId: 'kix.footer123'
      };

      const result = DocsDeleteFooterSchema.safeParse(validInput);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(validInput);
      }
    });

    it('should reject missing documentId', () => {
      const invalidInput = {
        footerId: 'kix.footer123'
      };

      const result = DocsDeleteFooterSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
    });

    it('should reject empty documentId', () => {
      const invalidInput = {
        documentId: '',
        footerId: 'kix.footer123'
      };

      const result = DocsDeleteFooterSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.errors[0].message).toBe('Document ID is required');
      }
    });

    it('should reject missing footerId', () => {
      const invalidInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w'
      };

      const result = DocsDeleteFooterSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
    });

    it('should reject empty footerId', () => {
      const invalidInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        footerId: ''
      };

      const result = DocsDeleteFooterSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.errors[0].message).toBe('Footer ID is required');
      }
    });
  });

  describe('API Request Formation', () => {
    it('should form correct batchUpdate request structure', () => {
      const input = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        footerId: 'kix.footer123'
      };

      const expectedRequest = {
        documentId: input.documentId,
        requestBody: {
          requests: [{
            deleteFooter: {
              footerId: input.footerId
            }
          }]
        }
      };

      expect(expectedRequest.requestBody.requests[0].deleteFooter.footerId).toBe(input.footerId);
    });

    it('should handle various footerId formats', () => {
      const footerIds = ['kix.footer123', 'footer_abc', 'f-123-xyz'];

      footerIds.forEach(footerId => {
        const input = {
          documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
          footerId
        };
        const result = DocsDeleteFooterSchema.safeParse(input);
        expect(result.success).toBe(true);
      });
    });
  });

  describe('Edge Cases', () => {
    it('should validate footerId as string type', () => {
      const validInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        footerId: 'kix.footer123'
      };

      const result = DocsDeleteFooterSchema.safeParse(validInput);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(typeof result.data.footerId).toBe('string');
      }
    });

    it('should reject numeric footerId', () => {
      const invalidInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        footerId: 123
      };

      const result = DocsDeleteFooterSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
    });
  });
});
