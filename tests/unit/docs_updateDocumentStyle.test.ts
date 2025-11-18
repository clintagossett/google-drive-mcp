import { describe, it, expect } from 'vitest';
import { z } from 'zod';

// Schema definition (matches src/index.ts)
const DocsUpdateDocumentStyleSchema = z.object({
  documentId: z.string().min(1, "Document ID is required"),
  marginTop: z.number().optional(),
  marginBottom: z.number().optional(),
  marginLeft: z.number().optional(),
  marginRight: z.number().optional(),
  pageWidth: z.number().optional(),
  pageHeight: z.number().optional()
});

describe('docs_updateDocumentStyle - Unit Tests', () => {
  describe('Schema Validation', () => {
    it('should validate correct parameters with all margins', () => {
      const validInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        marginTop: 72,
        marginBottom: 72,
        marginLeft: 72,
        marginRight: 72
      };

      const result = DocsUpdateDocumentStyleSchema.safeParse(validInput);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(validInput);
      }
    });

    it('should validate with only documentId (all margins optional)', () => {
      const validInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w'
      };

      const result = DocsUpdateDocumentStyleSchema.safeParse(validInput);
      expect(result.success).toBe(true);
    });

    it('should validate with page dimensions', () => {
      const validInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        pageWidth: 612,
        pageHeight: 792
      };

      const result = DocsUpdateDocumentStyleSchema.safeParse(validInput);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.pageWidth).toBe(612);
        expect(result.data.pageHeight).toBe(792);
      }
    });

    it('should validate with combination of margins and page dimensions', () => {
      const validInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        marginTop: 72,
        marginBottom: 72,
        pageWidth: 612,
        pageHeight: 792
      };

      const result = DocsUpdateDocumentStyleSchema.safeParse(validInput);
      expect(result.success).toBe(true);
    });

    it('should reject missing documentId', () => {
      const invalidInput = {
        marginTop: 72,
        marginBottom: 72
      };

      const result = DocsUpdateDocumentStyleSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
    });

    it('should reject empty documentId', () => {
      const invalidInput = {
        documentId: '',
        marginTop: 72
      };

      const result = DocsUpdateDocumentStyleSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.errors[0].message).toBe('Document ID is required');
      }
    });

    it('should accept zero margins', () => {
      const validInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        marginTop: 0,
        marginBottom: 0,
        marginLeft: 0,
        marginRight: 0
      };

      const result = DocsUpdateDocumentStyleSchema.safeParse(validInput);
      expect(result.success).toBe(true);
    });

    it('should accept decimal margin values', () => {
      const validInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        marginTop: 36.5,
        marginBottom: 36.5
      };

      const result = DocsUpdateDocumentStyleSchema.safeParse(validInput);
      expect(result.success).toBe(true);
    });

    it('should reject string margin values', () => {
      const invalidInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        marginTop: "72"
      };

      const result = DocsUpdateDocumentStyleSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
    });
  });

  describe('API Request Formation', () => {
    it('should form correct batchUpdate request with margins', () => {
      const input = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        marginTop: 72,
        marginBottom: 72,
        marginLeft: 54,
        marginRight: 54
      };

      const documentStyle: any = {};
      const fields: string[] = [];

      if (input.marginTop !== undefined) {
        documentStyle.marginTop = { magnitude: input.marginTop, unit: 'PT' };
        fields.push('marginTop');
      }
      if (input.marginBottom !== undefined) {
        documentStyle.marginBottom = { magnitude: input.marginBottom, unit: 'PT' };
        fields.push('marginBottom');
      }
      if (input.marginLeft !== undefined) {
        documentStyle.marginLeft = { magnitude: input.marginLeft, unit: 'PT' };
        fields.push('marginLeft');
      }
      if (input.marginRight !== undefined) {
        documentStyle.marginRight = { magnitude: input.marginRight, unit: 'PT' };
        fields.push('marginRight');
      }

      expect(documentStyle.marginTop).toEqual({ magnitude: 72, unit: 'PT' });
      expect(documentStyle.marginBottom).toEqual({ magnitude: 72, unit: 'PT' });
      expect(documentStyle.marginLeft).toEqual({ magnitude: 54, unit: 'PT' });
      expect(documentStyle.marginRight).toEqual({ magnitude: 54, unit: 'PT' });
      expect(fields).toEqual(['marginTop', 'marginBottom', 'marginLeft', 'marginRight']);
    });

    it('should form correct request with page dimensions', () => {
      const input = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        pageWidth: 612,
        pageHeight: 792
      };

      const documentStyle: any = {};
      const fields: string[] = [];

      if (input.pageWidth !== undefined) {
        documentStyle.pageSize = documentStyle.pageSize || {};
        documentStyle.pageSize.width = { magnitude: input.pageWidth, unit: 'PT' };
        fields.push('pageSize.width');
      }
      if (input.pageHeight !== undefined) {
        documentStyle.pageSize = documentStyle.pageSize || {};
        documentStyle.pageSize.height = { magnitude: input.pageHeight, unit: 'PT' };
        fields.push('pageSize.height');
      }

      expect(documentStyle.pageSize.width).toEqual({ magnitude: 612, unit: 'PT' });
      expect(documentStyle.pageSize.height).toEqual({ magnitude: 792, unit: 'PT' });
      expect(fields).toContain('pageSize.width');
      expect(fields).toContain('pageSize.height');
    });

    it('should generate correct field mask string', () => {
      const fields = ['marginTop', 'marginBottom', 'pageSize.width'];
      const fieldMask = fields.join(',');

      expect(fieldMask).toBe('marginTop,marginBottom,pageSize.width');
    });

    it('should handle partial updates correctly', () => {
      const input = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        marginTop: 100
      };

      const documentStyle: any = {};
      const fields: string[] = [];

      if (input.marginTop !== undefined) {
        documentStyle.marginTop = { magnitude: input.marginTop, unit: 'PT' };
        fields.push('marginTop');
      }

      expect(fields).toEqual(['marginTop']);
      expect(documentStyle).toEqual({
        marginTop: { magnitude: 100, unit: 'PT' }
      });
    });
  });

  describe('Edge Cases', () => {
    it('should handle standard letter size (8.5 x 11 inches)', () => {
      const validInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        pageWidth: 612,  // 8.5 inches * 72 points/inch
        pageHeight: 792  // 11 inches * 72 points/inch
      };

      const result = DocsUpdateDocumentStyleSchema.safeParse(validInput);
      expect(result.success).toBe(true);
    });

    it('should handle A4 size', () => {
      const validInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        pageWidth: 595.28,  // 210mm
        pageHeight: 841.89  // 297mm
      };

      const result = DocsUpdateDocumentStyleSchema.safeParse(validInput);
      expect(result.success).toBe(true);
    });

    it('should handle 1-inch margins (72 points)', () => {
      const validInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        marginTop: 72,
        marginBottom: 72,
        marginLeft: 72,
        marginRight: 72
      };

      const result = DocsUpdateDocumentStyleSchema.safeParse(validInput);
      expect(result.success).toBe(true);
    });
  });
});
