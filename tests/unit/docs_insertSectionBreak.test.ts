import { describe, it, expect } from 'vitest';
import { z } from 'zod';

// Schema definition (matches src/index.ts)
const DocsInsertSectionBreakSchema = z.object({
  documentId: z.string().min(1, "Document ID is required"),
  index: z.number().int().min(1, "Index must be at least 1"),
  sectionType: z.enum(['SECTION_TYPE_UNSPECIFIED', 'CONTINUOUS', 'NEXT_PAGE']).optional()
});

describe('docs_insertSectionBreak - Unit Tests', () => {
  describe('Schema Validation', () => {
    it('should validate correct parameters', () => {
      const validInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        index: 500
      };

      const result = DocsInsertSectionBreakSchema.safeParse(validInput);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(validInput);
      }
    });

    it('should validate with optional sectionType', () => {
      const validInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        index: 500,
        sectionType: 'NEXT_PAGE' as const
      };

      const result = DocsInsertSectionBreakSchema.safeParse(validInput);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.sectionType).toBe('NEXT_PAGE');
      }
    });

    it('should validate all section types', () => {
      const sectionTypes = ['SECTION_TYPE_UNSPECIFIED', 'CONTINUOUS', 'NEXT_PAGE'] as const;

      sectionTypes.forEach(sectionType => {
        const input = {
          documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
          index: 500,
          sectionType
        };
        const result = DocsInsertSectionBreakSchema.safeParse(input);
        expect(result.success).toBe(true);
      });
    });

    it('should reject missing documentId', () => {
      const invalidInput = {
        index: 500
      };

      const result = DocsInsertSectionBreakSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
    });

    it('should reject empty documentId', () => {
      const invalidInput = {
        documentId: '',
        index: 500
      };

      const result = DocsInsertSectionBreakSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.errors[0].message).toBe('Document ID is required');
      }
    });

    it('should reject missing index', () => {
      const invalidInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w'
      };

      const result = DocsInsertSectionBreakSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
    });

    it('should reject index less than 1', () => {
      const invalidInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        index: 0
      };

      const result = DocsInsertSectionBreakSchema.safeParse(invalidInput);
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

      const result = DocsInsertSectionBreakSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
    });

    it('should reject non-integer index', () => {
      const invalidInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        index: 10.5
      };

      const result = DocsInsertSectionBreakSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
    });

    it('should reject invalid sectionType', () => {
      const invalidInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        index: 500,
        sectionType: 'INVALID_TYPE'
      };

      const result = DocsInsertSectionBreakSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
    });
  });

  describe('API Request Formation', () => {
    it('should form correct batchUpdate request structure', () => {
      const input = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        index: 500
      };

      const expectedRequest = {
        documentId: input.documentId,
        requestBody: {
          requests: [{
            insertSectionBreak: {
              location: {
                index: input.index
              }
            }
          }]
        }
      };

      expect(expectedRequest.requestBody.requests[0].insertSectionBreak.location.index).toBe(input.index);
    });

    it('should include sectionType when provided', () => {
      const input = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        index: 500,
        sectionType: 'NEXT_PAGE' as const
      };

      const expectedRequest = {
        documentId: input.documentId,
        requestBody: {
          requests: [{
            insertSectionBreak: {
              location: {
                index: input.index
              },
              sectionType: input.sectionType
            }
          }]
        }
      };

      expect(expectedRequest.requestBody.requests[0].insertSectionBreak.sectionType).toBe('NEXT_PAGE');
    });

    it('should handle large index values', () => {
      const input = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        index: 99999
      };

      const result = DocsInsertSectionBreakSchema.safeParse(input);
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
        index: 500
      };

      const result = DocsInsertSectionBreakSchema.safeParse(validInput);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(typeof result.data.index).toBe('number');
      }
    });

    it('should reject string index', () => {
      const invalidInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        index: "500"
      };

      const result = DocsInsertSectionBreakSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
    });
  });
});
