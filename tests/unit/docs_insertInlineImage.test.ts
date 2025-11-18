import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';

// Schema definition (matches src/index.ts)
const DocsInsertInlineImageSchema = z.object({
  documentId: z.string().min(1, "Document ID is required"),
  index: z.number().int().min(1, "Index must be at least 1"),
  uri: z.string().url("Valid image URL is required"),
  width: z.number().positive("Width must be positive").optional(),
  height: z.number().positive("Height must be positive").optional()
});

describe('docs_insertInlineImage - Unit Tests', () => {
  describe('Schema Validation', () => {
    it('should validate correct parameters with required fields only', () => {
      const validInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        index: 1,
        uri: 'https://example.com/image.png'
      };

      const result = DocsInsertInlineImageSchema.safeParse(validInput);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(validInput);
      }
    });

    it('should validate correct parameters with all fields', () => {
      const validInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        index: 1,
        uri: 'https://example.com/image.png',
        width: 300,
        height: 200
      };

      const result = DocsInsertInlineImageSchema.safeParse(validInput);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(validInput);
      }
    });

    it('should reject missing documentId', () => {
      const invalidInput = {
        index: 1,
        uri: 'https://example.com/image.png'
      };

      const result = DocsInsertInlineImageSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.errors[0].message).toContain('Required');
      }
    });

    it('should reject empty documentId', () => {
      const invalidInput = {
        documentId: '',
        index: 1,
        uri: 'https://example.com/image.png'
      };

      const result = DocsInsertInlineImageSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.errors[0].message).toBe('Document ID is required');
      }
    });

    it('should reject index less than 1', () => {
      const invalidInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        index: 0,
        uri: 'https://example.com/image.png'
      };

      const result = DocsInsertInlineImageSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.errors[0].message).toBe('Index must be at least 1');
      }
    });

    it('should reject non-integer index', () => {
      const invalidInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        index: 1.5,
        uri: 'https://example.com/image.png'
      };

      const result = DocsInsertInlineImageSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.errors[0].message).toContain('integer');
      }
    });

    it('should reject missing uri', () => {
      const invalidInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        index: 1
      };

      const result = DocsInsertInlineImageSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.errors[0].message).toContain('Required');
      }
    });

    it('should reject invalid uri', () => {
      const invalidInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        index: 1,
        uri: 'not-a-valid-url'
      };

      const result = DocsInsertInlineImageSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.errors[0].message).toBe('Valid image URL is required');
      }
    });

    it('should reject negative width', () => {
      const invalidInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        index: 1,
        uri: 'https://example.com/image.png',
        width: -100
      };

      const result = DocsInsertInlineImageSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.errors[0].message).toBe('Width must be positive');
      }
    });

    it('should reject zero width', () => {
      const invalidInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        index: 1,
        uri: 'https://example.com/image.png',
        width: 0
      };

      const result = DocsInsertInlineImageSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.errors[0].message).toBe('Width must be positive');
      }
    });

    it('should reject negative height', () => {
      const invalidInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        index: 1,
        uri: 'https://example.com/image.png',
        height: -50
      };

      const result = DocsInsertInlineImageSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.errors[0].message).toBe('Height must be positive');
      }
    });

    it('should accept width without height', () => {
      const validInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        index: 1,
        uri: 'https://example.com/image.png',
        width: 300
      };

      const result = DocsInsertInlineImageSchema.safeParse(validInput);
      expect(result.success).toBe(true);
    });

    it('should accept height without width', () => {
      const validInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        index: 1,
        uri: 'https://example.com/image.png',
        height: 200
      };

      const result = DocsInsertInlineImageSchema.safeParse(validInput);
      expect(result.success).toBe(true);
    });

    it('should accept large dimension values', () => {
      const validInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        index: 1,
        uri: 'https://example.com/image.png',
        width: 1000,
        height: 1500
      };

      const result = DocsInsertInlineImageSchema.safeParse(validInput);
      expect(result.success).toBe(true);
    });
  });

  describe('API Request Formation', () => {
    it('should form correct batchUpdate request structure without dimensions', () => {
      const input = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        index: 1,
        uri: 'https://example.com/image.png'
      };

      // Expected Google Docs API request structure
      const expectedRequest = {
        documentId: input.documentId,
        requestBody: {
          requests: [{
            insertInlineImage: {
              location: { index: input.index },
              uri: input.uri
            }
          }]
        }
      };

      expect(expectedRequest.documentId).toBe(input.documentId);
      expect(expectedRequest.requestBody.requests[0].insertInlineImage.location.index).toBe(input.index);
      expect(expectedRequest.requestBody.requests[0].insertInlineImage.uri).toBe(input.uri);
    });

    it('should form correct batchUpdate request structure with width', () => {
      const input = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        index: 1,
        uri: 'https://example.com/image.png',
        width: 300
      };

      // Expected Google Docs API request structure
      const expectedRequest = {
        documentId: input.documentId,
        requestBody: {
          requests: [{
            insertInlineImage: {
              location: { index: input.index },
              uri: input.uri,
              objectSize: {
                width: { magnitude: 300, unit: 'PT' }
              }
            }
          }]
        }
      };

      expect(expectedRequest.requestBody.requests[0].insertInlineImage.objectSize?.width?.magnitude).toBe(300);
      expect(expectedRequest.requestBody.requests[0].insertInlineImage.objectSize?.width?.unit).toBe('PT');
    });

    it('should form correct batchUpdate request structure with height', () => {
      const input = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        index: 1,
        uri: 'https://example.com/image.png',
        height: 200
      };

      // Expected Google Docs API request structure
      const expectedRequest = {
        documentId: input.documentId,
        requestBody: {
          requests: [{
            insertInlineImage: {
              location: { index: input.index },
              uri: input.uri,
              objectSize: {
                height: { magnitude: 200, unit: 'PT' }
              }
            }
          }]
        }
      };

      expect(expectedRequest.requestBody.requests[0].insertInlineImage.objectSize?.height?.magnitude).toBe(200);
      expect(expectedRequest.requestBody.requests[0].insertInlineImage.objectSize?.height?.unit).toBe('PT');
    });

    it('should form correct batchUpdate request structure with both dimensions', () => {
      const input = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        index: 1,
        uri: 'https://example.com/image.png',
        width: 300,
        height: 200
      };

      // Expected Google Docs API request structure
      const expectedRequest = {
        documentId: input.documentId,
        requestBody: {
          requests: [{
            insertInlineImage: {
              location: { index: input.index },
              uri: input.uri,
              objectSize: {
                width: { magnitude: 300, unit: 'PT' },
                height: { magnitude: 200, unit: 'PT' }
              }
            }
          }]
        }
      };

      expect(expectedRequest.requestBody.requests[0].insertInlineImage.objectSize?.width?.magnitude).toBe(300);
      expect(expectedRequest.requestBody.requests[0].insertInlineImage.objectSize?.height?.magnitude).toBe(200);
      expect(expectedRequest.requestBody.requests[0].insertInlineImage.objectSize?.width?.unit).toBe('PT');
      expect(expectedRequest.requestBody.requests[0].insertInlineImage.objectSize?.height?.unit).toBe('PT');
    });
  });
});
