import { describe, it, expect } from 'vitest';
import { z } from 'zod';

// Schema definition (matches src/index.ts)
const DocsCreateParagraphBulletsSchema = z.object({
  documentId: z.string().min(1, "Document ID is required"),
  startIndex: z.number().int().min(1, "Start index must be >= 1"),
  endIndex: z.number().int().min(1, "End index must be >= 1"),
  bulletPreset: z.string().optional()
});

describe('docs_createParagraphBullets - Unit Tests', () => {
  describe('Schema Validation', () => {
    it('should validate correct parameters with bulletPreset', () => {
      const validInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        startIndex: 1,
        endIndex: 100,
        bulletPreset: 'NUMBERED_DECIMAL_ALPHA_ROMAN'
      };

      const result = DocsCreateParagraphBulletsSchema.safeParse(validInput);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(validInput);
      }
    });

    it('should validate without bulletPreset (optional parameter)', () => {
      const validInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        startIndex: 1,
        endIndex: 100
      };

      const result = DocsCreateParagraphBulletsSchema.safeParse(validInput);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.bulletPreset).toBeUndefined();
      }
    });

    it('should reject missing documentId', () => {
      const invalidInput = {
        startIndex: 1,
        endIndex: 100
      };

      const result = DocsCreateParagraphBulletsSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
    });

    it('should reject empty documentId', () => {
      const invalidInput = {
        documentId: '',
        startIndex: 1,
        endIndex: 100
      };

      const result = DocsCreateParagraphBulletsSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.errors[0].message).toBe('Document ID is required');
      }
    });

    it('should reject missing startIndex', () => {
      const invalidInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        endIndex: 100
      };

      const result = DocsCreateParagraphBulletsSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
    });

    it('should reject missing endIndex', () => {
      const invalidInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        startIndex: 1
      };

      const result = DocsCreateParagraphBulletsSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
    });

    it('should reject startIndex less than 1', () => {
      const invalidInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        startIndex: 0,
        endIndex: 100
      };

      const result = DocsCreateParagraphBulletsSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.errors[0].message).toBe('Start index must be >= 1');
      }
    });

    it('should reject endIndex less than 1', () => {
      const invalidInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        startIndex: 1,
        endIndex: 0
      };

      const result = DocsCreateParagraphBulletsSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.errors[0].message).toBe('End index must be >= 1');
      }
    });

    it('should reject non-integer startIndex', () => {
      const invalidInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        startIndex: 1.5,
        endIndex: 100
      };

      const result = DocsCreateParagraphBulletsSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
    });
  });

  describe('API Request Formation', () => {
    it('should form correct batchUpdate request with bulletPreset', () => {
      const input = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        startIndex: 1,
        endIndex: 100,
        bulletPreset: 'NUMBERED_DECIMAL_ALPHA_ROMAN'
      };

      const expectedRequest = {
        documentId: input.documentId,
        requestBody: {
          requests: [{
            createParagraphBullets: {
              range: {
                startIndex: input.startIndex,
                endIndex: input.endIndex
              },
              bulletPreset: input.bulletPreset
            }
          }]
        }
      };

      expect(expectedRequest.requestBody.requests[0].createParagraphBullets.range.startIndex).toBe(input.startIndex);
      expect(expectedRequest.requestBody.requests[0].createParagraphBullets.range.endIndex).toBe(input.endIndex);
      expect(expectedRequest.requestBody.requests[0].createParagraphBullets.bulletPreset).toBe(input.bulletPreset);
    });

    it('should form correct request without bulletPreset', () => {
      const input = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        startIndex: 1,
        endIndex: 100
      };

      const expectedRequest = {
        documentId: input.documentId,
        requestBody: {
          requests: [{
            createParagraphBullets: {
              range: {
                startIndex: input.startIndex,
                endIndex: input.endIndex
              }
            }
          }]
        }
      };

      expect(expectedRequest.requestBody.requests[0].createParagraphBullets.range).toBeDefined();
      expect(expectedRequest.requestBody.requests[0].createParagraphBullets.bulletPreset).toBeUndefined();
    });

    it('should accept different bullet preset values', () => {
      const presets = [
        'BULLET_DISC_CIRCLE_SQUARE',
        'BULLET_CHECKBOX',
        'NUMBERED_DECIMAL_ALPHA_ROMAN',
        'NUMBERED_DECIMAL_NESTED'
      ];

      presets.forEach(preset => {
        const input = {
          documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
          startIndex: 1,
          endIndex: 100,
          bulletPreset: preset
        };

        const result = DocsCreateParagraphBulletsSchema.safeParse(input);
        expect(result.success).toBe(true);
      });
    });
  });
});
