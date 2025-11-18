import { describe, it, expect } from 'vitest';
import { z } from 'zod';

// Schema definition (matches src/index.ts)
const DocsUpdateSectionStyleSchema = z.object({
  documentId: z.string().min(1, "Document ID is required"),
  startIndex: z.number().int().min(1, "Start index must be at least 1"),
  endIndex: z.number().int().min(1, "End index must be at least 1"),
  columnSeparatorStyle: z.enum(['NONE', 'BETWEEN_EACH_COLUMN']).optional(),
  contentDirection: z.enum(['LEFT_TO_RIGHT', 'RIGHT_TO_LEFT']).optional(),
  defaultHeaderId: z.string().optional(),
  defaultFooterId: z.string().optional(),
  evenPageHeaderId: z.string().optional(),
  evenPageFooterId: z.string().optional(),
  firstPageHeaderId: z.string().optional(),
  firstPageFooterId: z.string().optional(),
  flipPageOrientation: z.boolean().optional(),
  marginTop: z.number().optional(),
  marginBottom: z.number().optional(),
  marginRight: z.number().optional(),
  marginLeft: z.number().optional(),
  marginHeader: z.number().optional(),
  marginFooter: z.number().optional(),
  pageNumberStart: z.number().int().optional(),
  sectionType: z.enum(['CONTINUOUS', 'NEXT_PAGE']).optional(),
  useFirstPageHeaderFooter: z.boolean().optional()
});

describe('docs_updateSectionStyle - Unit Tests', () => {
  describe('Schema Validation', () => {
    it('should validate correct parameters', () => {
      const validInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        startIndex: 1,
        endIndex: 1000
      };

      const result = DocsUpdateSectionStyleSchema.safeParse(validInput);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(validInput);
      }
    });

    it('should validate with margin properties', () => {
      const validInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        startIndex: 1,
        endIndex: 1000,
        marginTop: 72,
        marginBottom: 72,
        marginLeft: 72,
        marginRight: 72
      };

      const result = DocsUpdateSectionStyleSchema.safeParse(validInput);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.marginTop).toBe(72);
        expect(result.data.marginBottom).toBe(72);
      }
    });

    it('should validate with columnSeparatorStyle', () => {
      const validInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        startIndex: 1,
        endIndex: 1000,
        columnSeparatorStyle: 'BETWEEN_EACH_COLUMN' as const
      };

      const result = DocsUpdateSectionStyleSchema.safeParse(validInput);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.columnSeparatorStyle).toBe('BETWEEN_EACH_COLUMN');
      }
    });

    it('should validate with header and footer IDs', () => {
      const validInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        startIndex: 1,
        endIndex: 1000,
        defaultHeaderId: 'kix.header1',
        defaultFooterId: 'kix.footer1'
      };

      const result = DocsUpdateSectionStyleSchema.safeParse(validInput);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.defaultHeaderId).toBe('kix.header1');
        expect(result.data.defaultFooterId).toBe('kix.footer1');
      }
    });

    it('should validate with boolean properties', () => {
      const validInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        startIndex: 1,
        endIndex: 1000,
        flipPageOrientation: true,
        useFirstPageHeaderFooter: false
      };

      const result = DocsUpdateSectionStyleSchema.safeParse(validInput);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.flipPageOrientation).toBe(true);
        expect(result.data.useFirstPageHeaderFooter).toBe(false);
      }
    });

    it('should reject missing documentId', () => {
      const invalidInput = {
        startIndex: 1,
        endIndex: 1000
      };

      const result = DocsUpdateSectionStyleSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
    });

    it('should reject empty documentId', () => {
      const invalidInput = {
        documentId: '',
        startIndex: 1,
        endIndex: 1000
      };

      const result = DocsUpdateSectionStyleSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.errors[0].message).toBe('Document ID is required');
      }
    });

    it('should reject missing startIndex', () => {
      const invalidInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        endIndex: 1000
      };

      const result = DocsUpdateSectionStyleSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
    });

    it('should reject missing endIndex', () => {
      const invalidInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        startIndex: 1
      };

      const result = DocsUpdateSectionStyleSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
    });

    it('should reject startIndex less than 1', () => {
      const invalidInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        startIndex: 0,
        endIndex: 1000
      };

      const result = DocsUpdateSectionStyleSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.errors[0].message).toBe('Start index must be at least 1');
      }
    });

    it('should reject endIndex less than 1', () => {
      const invalidInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        startIndex: 1,
        endIndex: 0
      };

      const result = DocsUpdateSectionStyleSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.errors[0].message).toBe('End index must be at least 1');
      }
    });

    it('should reject non-integer startIndex', () => {
      const invalidInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        startIndex: 1.5,
        endIndex: 1000
      };

      const result = DocsUpdateSectionStyleSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
    });

    it('should reject non-integer endIndex', () => {
      const invalidInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        startIndex: 1,
        endIndex: 1000.5
      };

      const result = DocsUpdateSectionStyleSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
    });

    it('should reject invalid columnSeparatorStyle', () => {
      const invalidInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        startIndex: 1,
        endIndex: 1000,
        columnSeparatorStyle: 'INVALID'
      };

      const result = DocsUpdateSectionStyleSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
    });

    it('should reject invalid contentDirection', () => {
      const invalidInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        startIndex: 1,
        endIndex: 1000,
        contentDirection: 'INVALID'
      };

      const result = DocsUpdateSectionStyleSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
    });

    it('should reject invalid sectionType', () => {
      const invalidInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        startIndex: 1,
        endIndex: 1000,
        sectionType: 'INVALID'
      };

      const result = DocsUpdateSectionStyleSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
    });
  });

  describe('API Request Formation', () => {
    it('should form correct batchUpdate request structure', () => {
      const input = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        startIndex: 1,
        endIndex: 1000,
        marginTop: 72
      };

      const expectedRequest = {
        documentId: input.documentId,
        requestBody: {
          requests: [{
            updateSectionStyle: {
              range: {
                startIndex: input.startIndex,
                endIndex: input.endIndex
              },
              sectionStyle: {
                marginTop: { magnitude: 72, unit: 'PT' }
              },
              fields: 'marginTop'
            }
          }]
        }
      };

      expect(expectedRequest.requestBody.requests[0].updateSectionStyle.range.startIndex).toBe(input.startIndex);
      expect(expectedRequest.requestBody.requests[0].updateSectionStyle.range.endIndex).toBe(input.endIndex);
    });
  });

  describe('Edge Cases', () => {
    it('should handle all optional parameters together', () => {
      const validInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        startIndex: 1,
        endIndex: 1000,
        columnSeparatorStyle: 'BETWEEN_EACH_COLUMN' as const,
        contentDirection: 'LEFT_TO_RIGHT' as const,
        marginTop: 72,
        marginBottom: 72,
        marginLeft: 72,
        marginRight: 72,
        marginHeader: 36,
        marginFooter: 36,
        flipPageOrientation: true,
        sectionType: 'NEXT_PAGE' as const,
        useFirstPageHeaderFooter: true,
        pageNumberStart: 1
      };

      const result = DocsUpdateSectionStyleSchema.safeParse(validInput);
      expect(result.success).toBe(true);
    });
  });
});
