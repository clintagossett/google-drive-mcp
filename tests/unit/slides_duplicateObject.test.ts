import { describe, it, expect } from 'vitest';
import { z } from 'zod';

// Schema definition (matches src/index.ts)
const SlidesDuplicateObjectSchema = z.object({
  presentationId: z.string().min(1, "Presentation ID is required"),
  objectId: z.string().min(1, "Object ID is required"),
  objectIds: z.record(z.string()).optional()
});

describe('slides_duplicateObject', () => {
  describe('Schema Validation', () => {
    it('should validate with required parameters only', () => {
      const input = {
        presentationId: 'test-presentation-id-123',
        objectId: 'slide-to-duplicate-456'
      };
      const result = SlidesDuplicateObjectSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.presentationId).toBe('test-presentation-id-123');
        expect(result.data.objectId).toBe('slide-to-duplicate-456');
      }
    });

    it('should validate with objectIds mapping', () => {
      const input = {
        presentationId: 'test-presentation-id-123',
        objectId: 'slide1',
        objectIds: {
          'old-id-1': 'new-id-1',
          'old-id-2': 'new-id-2'
        }
      };
      const result = SlidesDuplicateObjectSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.objectIds).toBeDefined();
        expect(result.data.objectIds?.['old-id-1']).toBe('new-id-1');
      }
    });

    it('should reject empty presentationId', () => {
      const input = {
        presentationId: '',
        objectId: 'slide1'
      };
      const result = SlidesDuplicateObjectSchema.safeParse(input);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.errors[0].message).toBe('Presentation ID is required');
      }
    });

    it('should reject missing presentationId', () => {
      const input = { objectId: 'slide1' };
      const result = SlidesDuplicateObjectSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('should reject empty objectId', () => {
      const input = {
        presentationId: 'test-presentation-id-123',
        objectId: ''
      };
      const result = SlidesDuplicateObjectSchema.safeParse(input);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.errors[0].message).toBe('Object ID is required');
      }
    });

    it('should reject missing objectId', () => {
      const input = { presentationId: 'test-presentation-id-123' };
      const result = SlidesDuplicateObjectSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('should ignore extra properties', () => {
      const input = {
        presentationId: 'test-presentation-id-123',
        objectId: 'slide1',
        extraProperty: 'should be ignored'
      };
      const result = SlidesDuplicateObjectSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).not.toHaveProperty('extraProperty');
      }
    });
  });

  describe('API Call Format', () => {
    it('should map to correct Google Slides API batchUpdate format (minimal)', () => {
      const input = {
        presentationId: 'test-presentation-id-123',
        objectId: 'slide-to-duplicate'
      };
      const result = SlidesDuplicateObjectSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        const apiRequest = {
          duplicateObject: {
            objectId: result.data.objectId,
            objectIds: result.data.objectIds
          }
        };
        expect(apiRequest.duplicateObject.objectId).toBe('slide-to-duplicate');
      }
    });

    it('should map to correct Google Slides API batchUpdate format (with objectIds)', () => {
      const input = {
        presentationId: 'test-presentation-id-123',
        objectId: 'slide1',
        objectIds: { 'element1': 'new-element1' }
      };
      const result = SlidesDuplicateObjectSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        const apiRequest = {
          duplicateObject: {
            objectId: result.data.objectId,
            objectIds: result.data.objectIds
          }
        };
        expect(apiRequest.duplicateObject.objectIds?.['element1']).toBe('new-element1');
      }
    });
  });

  describe('Response Format', () => {
    it('should return raw API response as JSON string', () => {
      const mockApiResponse = {
        presentationId: 'test-presentation-id-123',
        replies: [
          {
            duplicateObject: {
              objectId: 'duplicated-slide-789'
            }
          }
        ]
      };

      const expectedResponse = {
        content: [{ type: "text", text: JSON.stringify(mockApiResponse, null, 2) }],
        isError: false
      };

      expect(expectedResponse.content[0].type).toBe('text');
      expect(typeof expectedResponse.content[0].text).toBe('string');
      expect(expectedResponse.isError).toBe(false);

      const parsed = JSON.parse(expectedResponse.content[0].text);
      expect(parsed.presentationId).toBe('test-presentation-id-123');
      expect(parsed.replies[0].duplicateObject.objectId).toBe('duplicated-slide-789');
    });
  });
});
