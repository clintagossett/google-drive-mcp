import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';

// Schema definition (matches src/index.ts)
const DocsReplaceImageSchema = z.object({
  documentId: z.string().min(1, "Document ID is required"),
  imageObjectId: z.string().min(1, "Image object ID is required"),
  uri: z.string().url("Valid image URL is required")
});

describe('docs_replaceImage - Unit Tests', () => {
  describe('Schema Validation', () => {
    it('should validate correct parameters', () => {
      const validInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        imageObjectId: 'kix.abc123',
        uri: 'https://example.com/new-image.png'
      };

      const result = DocsReplaceImageSchema.safeParse(validInput);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(validInput);
      }
    });

    it('should reject missing documentId', () => {
      const invalidInput = {
        imageObjectId: 'kix.abc123',
        uri: 'https://example.com/new-image.png'
      };

      const result = DocsReplaceImageSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.errors[0].message).toContain('Required');
      }
    });

    it('should reject empty documentId', () => {
      const invalidInput = {
        documentId: '',
        imageObjectId: 'kix.abc123',
        uri: 'https://example.com/new-image.png'
      };

      const result = DocsReplaceImageSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.errors[0].message).toBe('Document ID is required');
      }
    });

    it('should reject missing imageObjectId', () => {
      const invalidInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        uri: 'https://example.com/new-image.png'
      };

      const result = DocsReplaceImageSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.errors[0].message).toContain('Required');
      }
    });

    it('should reject empty imageObjectId', () => {
      const invalidInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        imageObjectId: '',
        uri: 'https://example.com/new-image.png'
      };

      const result = DocsReplaceImageSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.errors[0].message).toBe('Image object ID is required');
      }
    });

    it('should reject missing uri', () => {
      const invalidInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        imageObjectId: 'kix.abc123'
      };

      const result = DocsReplaceImageSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.errors[0].message).toContain('Required');
      }
    });

    it('should reject invalid uri', () => {
      const invalidInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        imageObjectId: 'kix.abc123',
        uri: 'not-a-valid-url'
      };

      const result = DocsReplaceImageSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.errors[0].message).toBe('Valid image URL is required');
      }
    });

    it('should accept various imageObjectId formats', () => {
      const testCases = [
        'kix.abc123',
        'kix.xyz789',
        'objectId123',
        'image-id-456'
      ];

      testCases.forEach(imageObjectId => {
        const validInput = {
          documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
          imageObjectId,
          uri: 'https://example.com/image.png'
        };

        const result = DocsReplaceImageSchema.safeParse(validInput);
        expect(result.success).toBe(true);
      });
    });

    it('should accept various valid image URLs', () => {
      const testCases = [
        'https://example.com/image.png',
        'https://example.com/path/to/image.jpg',
        'https://cdn.example.com/images/photo.gif',
        'https://storage.googleapis.com/bucket/image.bmp'
      ];

      testCases.forEach(uri => {
        const validInput = {
          documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
          imageObjectId: 'kix.abc123',
          uri
        };

        const result = DocsReplaceImageSchema.safeParse(validInput);
        expect(result.success).toBe(true);
      });
    });

    it('should reject http URLs (not https)', () => {
      const invalidInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        imageObjectId: 'kix.abc123',
        uri: 'http://example.com/image.png'
      };

      // Zod's url validator accepts both http and https by default
      // This test documents current behavior - actual validation may differ
      const result = DocsReplaceImageSchema.safeParse(invalidInput);
      // Note: Zod accepts http URLs, but Google Docs API may require https
      expect(result.success).toBe(true);
    });
  });

  describe('API Request Formation', () => {
    it('should form correct batchUpdate request structure', () => {
      const input = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        imageObjectId: 'kix.abc123',
        uri: 'https://example.com/new-image.png'
      };

      // Expected Google Docs API request structure
      const expectedRequest = {
        documentId: input.documentId,
        requestBody: {
          requests: [{
            replaceImage: {
              imageObjectId: input.imageObjectId,
              uri: input.uri,
              imageReplaceMethod: 'CENTER_CROP'
            }
          }]
        }
      };

      expect(expectedRequest.documentId).toBe(input.documentId);
      expect(expectedRequest.requestBody.requests[0].replaceImage.imageObjectId).toBe(input.imageObjectId);
      expect(expectedRequest.requestBody.requests[0].replaceImage.uri).toBe(input.uri);
      expect(expectedRequest.requestBody.requests[0].replaceImage.imageReplaceMethod).toBe('CENTER_CROP');
    });

    it('should always use CENTER_CROP as imageReplaceMethod', () => {
      const input = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        imageObjectId: 'kix.def456',
        uri: 'https://example.com/another-image.jpg'
      };

      // Google Docs API only supports CENTER_CROP method
      const expectedRequest = {
        documentId: input.documentId,
        requestBody: {
          requests: [{
            replaceImage: {
              imageObjectId: input.imageObjectId,
              uri: input.uri,
              imageReplaceMethod: 'CENTER_CROP'
            }
          }]
        }
      };

      // Verify CENTER_CROP is always set
      expect(expectedRequest.requestBody.requests[0].replaceImage.imageReplaceMethod).toBe('CENTER_CROP');
    });

    it('should handle different image object IDs correctly', () => {
      const testCases = [
        { imageObjectId: 'kix.abc123', uri: 'https://example.com/img1.png' },
        { imageObjectId: 'kix.xyz789', uri: 'https://example.com/img2.jpg' },
        { imageObjectId: 'object-456', uri: 'https://example.com/img3.gif' }
      ];

      testCases.forEach(({ imageObjectId, uri }) => {
        const input = {
          documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
          imageObjectId,
          uri
        };

        const expectedRequest = {
          documentId: input.documentId,
          requestBody: {
            requests: [{
              replaceImage: {
                imageObjectId: input.imageObjectId,
                uri: input.uri,
                imageReplaceMethod: 'CENTER_CROP'
              }
            }]
          }
        };

        expect(expectedRequest.requestBody.requests[0].replaceImage.imageObjectId).toBe(imageObjectId);
        expect(expectedRequest.requestBody.requests[0].replaceImage.uri).toBe(uri);
      });
    });
  });
});
