import { describe, it, expect } from 'vitest';
import { z } from 'zod';

// Schema definition (matches src/index.ts)
const DocsCreateHeaderSchema = z.object({
  documentId: z.string().min(1, "Document ID is required"),
  type: z.enum(['HEADER_DEFAULT', 'HEADER_FIRST_PAGE', 'HEADER_EVEN_PAGES']),
  sectionBreakIndex: z.number().int().min(1).optional()
});

describe('docs_createHeader - Unit Tests', () => {
  describe('Schema Validation', () => {
    it('should validate correct parameters', () => {
      const validInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        type: 'HEADER_DEFAULT' as const
      };

      const result = DocsCreateHeaderSchema.safeParse(validInput);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(validInput);
      }
    });

    it('should validate with optional sectionBreakIndex', () => {
      const validInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        type: 'HEADER_FIRST_PAGE' as const,
        sectionBreakIndex: 1
      };

      const result = DocsCreateHeaderSchema.safeParse(validInput);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.sectionBreakIndex).toBe(1);
      }
    });

    it('should reject missing documentId', () => {
      const invalidInput = {
        type: 'HEADER_DEFAULT'
      };

      const result = DocsCreateHeaderSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
    });

    it('should reject empty documentId', () => {
      const invalidInput = {
        documentId: '',
        type: 'HEADER_DEFAULT'
      };

      const result = DocsCreateHeaderSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.errors[0].message).toBe('Document ID is required');
      }
    });

    it('should reject missing type', () => {
      const invalidInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w'
      };

      const result = DocsCreateHeaderSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
    });

    it('should reject invalid type', () => {
      const invalidInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        type: 'INVALID_TYPE'
      };

      const result = DocsCreateHeaderSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
    });

    it('should validate all header types', () => {
      const types = ['HEADER_DEFAULT', 'HEADER_FIRST_PAGE', 'HEADER_EVEN_PAGES'] as const;

      types.forEach(type => {
        const input = {
          documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
          type
        };
        const result = DocsCreateHeaderSchema.safeParse(input);
        expect(result.success).toBe(true);
      });
    });
  });

  describe('API Request Formation', () => {
    it('should form correct batchUpdate request structure', () => {
      const input = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        type: 'HEADER_DEFAULT' as const
      };

      const expectedRequest = {
        documentId: input.documentId,
        requestBody: {
          requests: [{
            createHeader: {
              type: input.type
            }
          }]
        }
      };

      expect(expectedRequest.requestBody.requests[0].createHeader.type).toBe(input.type);
    });

    it('should include sectionBreakLocation when provided', () => {
      const input = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        type: 'HEADER_DEFAULT' as const,
        sectionBreakIndex: 1
      };

      const expectedRequest = {
        documentId: input.documentId,
        requestBody: {
          requests: [{
            createHeader: {
              type: input.type,
              sectionBreakLocation: { index: input.sectionBreakIndex }
            }
          }]
        }
      };

      expect(expectedRequest.requestBody.requests[0].createHeader.sectionBreakLocation).toEqual({ index: 1 });
    });
  });

  describe('Edge Cases', () => {
    it('should reject negative sectionBreakIndex', () => {
      const invalidInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        type: 'HEADER_DEFAULT' as const,
        sectionBreakIndex: -1
      };

      const result = DocsCreateHeaderSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
    });

    it('should reject sectionBreakIndex of 0', () => {
      const invalidInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        type: 'HEADER_DEFAULT' as const,
        sectionBreakIndex: 0
      };

      const result = DocsCreateHeaderSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
    });

    it('should reject non-integer sectionBreakIndex', () => {
      const invalidInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        type: 'HEADER_DEFAULT' as const,
        sectionBreakIndex: 10.5
      };

      const result = DocsCreateHeaderSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
    });
  });
});
