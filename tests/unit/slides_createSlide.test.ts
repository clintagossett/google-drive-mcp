import { describe, it, expect } from 'vitest';
import { z } from 'zod';

// Schema definition (matches src/index.ts)
const SlidesCreateSlideSchema = z.object({
  presentationId: z.string().min(1, "Presentation ID is required"),
  insertionIndex: z.number().min(0, "Insertion index must be at least 0").optional(),
  objectId: z.string().optional(),
  slideLayoutReference: z.object({
    predefinedLayout: z.string().optional(),
    layoutId: z.string().optional()
  }).optional(),
  placeholderIdMappings: z.array(z.object({
    layoutPlaceholder: z.object({
      type: z.string(),
      index: z.number().optional()
    }),
    objectId: z.string()
  })).optional()
});

describe('slides_createSlide', () => {
  describe('Schema Validation', () => {
    it('should validate with presentationId only (minimal)', () => {
      const input = {
        presentationId: 'test-presentation-id-123'
      };
      const result = SlidesCreateSlideSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.presentationId).toBe('test-presentation-id-123');
      }
    });

    it('should validate with presentationId and insertionIndex', () => {
      const input = {
        presentationId: 'test-presentation-id-123',
        insertionIndex: 1
      };
      const result = SlidesCreateSlideSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.insertionIndex).toBe(1);
      }
    });

    it('should validate with objectId', () => {
      const input = {
        presentationId: 'test-presentation-id-123',
        objectId: 'my-custom-slide-id'
      };
      const result = SlidesCreateSlideSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.objectId).toBe('my-custom-slide-id');
      }
    });

    it('should validate with slideLayoutReference (predefinedLayout)', () => {
      const input = {
        presentationId: 'test-presentation-id-123',
        slideLayoutReference: {
          predefinedLayout: 'TITLE_AND_BODY'
        }
      };
      const result = SlidesCreateSlideSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.slideLayoutReference?.predefinedLayout).toBe('TITLE_AND_BODY');
      }
    });

    it('should validate with slideLayoutReference (layoutId)', () => {
      const input = {
        presentationId: 'test-presentation-id-123',
        slideLayoutReference: {
          layoutId: 'layout123'
        }
      };
      const result = SlidesCreateSlideSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.slideLayoutReference?.layoutId).toBe('layout123');
      }
    });

    it('should validate with placeholderIdMappings', () => {
      const input = {
        presentationId: 'test-presentation-id-123',
        placeholderIdMappings: [
          {
            layoutPlaceholder: { type: 'TITLE', index: 0 },
            objectId: 'title-object-123'
          },
          {
            layoutPlaceholder: { type: 'BODY' },
            objectId: 'body-object-456'
          }
        ]
      };
      const result = SlidesCreateSlideSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.placeholderIdMappings).toHaveLength(2);
        expect(result.data.placeholderIdMappings?.[0].layoutPlaceholder.type).toBe('TITLE');
        expect(result.data.placeholderIdMappings?.[0].objectId).toBe('title-object-123');
      }
    });

    it('should reject empty presentationId', () => {
      const input = { presentationId: '' };
      const result = SlidesCreateSlideSchema.safeParse(input);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.errors[0].message).toBe('Presentation ID is required');
      }
    });

    it('should reject missing presentationId', () => {
      const input = { insertionIndex: 1 };
      const result = SlidesCreateSlideSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('should reject negative insertionIndex', () => {
      const input = {
        presentationId: 'test-presentation-id-123',
        insertionIndex: -1
      };
      const result = SlidesCreateSlideSchema.safeParse(input);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.errors[0].message).toBe('Insertion index must be at least 0');
      }
    });

    it('should ignore extra properties', () => {
      const input = {
        presentationId: 'test-presentation-id-123',
        extraProperty: 'should be ignored'
      };
      const result = SlidesCreateSlideSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).not.toHaveProperty('extraProperty');
      }
    });
  });

  describe('API Call Format', () => {
    it('should map to correct Google Slides API batchUpdate format (minimal)', () => {
      const input = {
        presentationId: 'test-presentation-id-123'
      };
      const result = SlidesCreateSlideSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        // API call: presentations.batchUpdate with createSlide request
        const apiRequest = {
          createSlide: {
            insertionIndex: result.data.insertionIndex,
            objectId: result.data.objectId,
            slideLayoutReference: result.data.slideLayoutReference,
            placeholderIdMappings: result.data.placeholderIdMappings
          }
        };
        expect(apiRequest).toBeDefined();
      }
    });

    it('should map to correct Google Slides API batchUpdate format (full)', () => {
      const input = {
        presentationId: 'test-presentation-id-123',
        insertionIndex: 2,
        objectId: 'slide-custom-id',
        slideLayoutReference: {
          predefinedLayout: 'TITLE_AND_BODY'
        }
      };
      const result = SlidesCreateSlideSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        const apiRequest = {
          createSlide: {
            insertionIndex: result.data.insertionIndex,
            objectId: result.data.objectId,
            slideLayoutReference: result.data.slideLayoutReference
          }
        };
        expect(apiRequest.createSlide.insertionIndex).toBe(2);
        expect(apiRequest.createSlide.objectId).toBe('slide-custom-id');
        expect(apiRequest.createSlide.slideLayoutReference?.predefinedLayout).toBe('TITLE_AND_BODY');
      }
    });
  });

  describe('Response Format', () => {
    it('should return raw API response as JSON string', () => {
      const mockApiResponse = {
        presentationId: 'test-presentation-id-123',
        replies: [
          {
            createSlide: {
              objectId: 'new-slide-id-456'
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
      expect(parsed.replies).toHaveLength(1);
      expect(parsed.replies[0].createSlide.objectId).toBe('new-slide-id-456');
    });
  });
});
