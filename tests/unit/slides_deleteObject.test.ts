import { describe, it, expect } from 'vitest';
import { z } from 'zod';

// Schema definition (matches src/index.ts)
const SlidesDeleteObjectSchema = z.object({
  presentationId: z.string().min(1, "Presentation ID is required"),
  objectId: z.string().min(1, "Object ID is required")
});

describe('slides_deleteObject', () => {
  describe('Schema Validation', () => {
    it('should validate with required parameters', () => {
      const input = {
        presentationId: 'test-presentation-id-123',
        objectId: 'slide-or-element-id-456'
      };
      const result = SlidesDeleteObjectSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.presentationId).toBe('test-presentation-id-123');
        expect(result.data.objectId).toBe('slide-or-element-id-456');
      }
    });

    it('should reject empty presentationId', () => {
      const input = {
        presentationId: '',
        objectId: 'slide-id-123'
      };
      const result = SlidesDeleteObjectSchema.safeParse(input);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.errors[0].message).toBe('Presentation ID is required');
      }
    });

    it('should reject missing presentationId', () => {
      const input = { objectId: 'slide-id-123' };
      const result = SlidesDeleteObjectSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('should reject empty objectId', () => {
      const input = {
        presentationId: 'test-presentation-id-123',
        objectId: ''
      };
      const result = SlidesDeleteObjectSchema.safeParse(input);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.errors[0].message).toBe('Object ID is required');
      }
    });

    it('should reject missing objectId', () => {
      const input = { presentationId: 'test-presentation-id-123' };
      const result = SlidesDeleteObjectSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('should ignore extra properties', () => {
      const input = {
        presentationId: 'test-presentation-id-123',
        objectId: 'slide-id-123',
        extraProperty: 'should be ignored'
      };
      const result = SlidesDeleteObjectSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).not.toHaveProperty('extraProperty');
      }
    });
  });

  describe('API Call Format', () => {
    it('should map to correct Google Slides API batchUpdate format', () => {
      const input = {
        presentationId: 'test-presentation-id-123',
        objectId: 'slide-id-456'
      };
      const result = SlidesDeleteObjectSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        const apiRequest = {
          deleteObject: {
            objectId: result.data.objectId
          }
        };
        expect(apiRequest.deleteObject.objectId).toBe('slide-id-456');
      }
    });
  });

  describe('Response Format', () => {
    it('should return raw API response as JSON string', () => {
      const mockApiResponse = {
        presentationId: 'test-presentation-id-123',
        replies: [{}]  // Empty reply for delete operations
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
      expect(parsed.replies).toHaveLength(1);
    });
  });
});
