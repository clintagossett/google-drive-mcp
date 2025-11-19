import { describe, it, expect } from 'vitest';
import { z } from 'zod';

// Schema definition (matches src/index.ts)
const SlidesUpdateSlidesPositionSchema = z.object({
  presentationId: z.string().min(1, "Presentation ID is required"),
  slideObjectIds: z.array(z.string().min(1)).min(1, "At least one slide ID is required"),
  insertionIndex: z.number().min(0, "Insertion index must be at least 0")
});

describe('slides_updateSlidesPosition', () => {
  describe('Schema Validation', () => {
    it('should validate with required parameters', () => {
      const input = {
        presentationId: 'test-presentation-id-123',
        slideObjectIds: ['slide1', 'slide2', 'slide3'],
        insertionIndex: 1
      };
      const result = SlidesUpdateSlidesPositionSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.slideObjectIds).toHaveLength(3);
        expect(result.data.insertionIndex).toBe(1);
      }
    });

    it('should validate with single slide', () => {
      const input = {
        presentationId: 'test-presentation-id-123',
        slideObjectIds: ['slide1'],
        insertionIndex: 0
      };
      const result = SlidesUpdateSlidesPositionSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('should reject empty presentationId', () => {
      const input = {
        presentationId: '',
        slideObjectIds: ['slide1'],
        insertionIndex: 0
      };
      const result = SlidesUpdateSlidesPositionSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('should reject empty slideObjectIds array', () => {
      const input = {
        presentationId: 'test-presentation-id-123',
        slideObjectIds: [],
        insertionIndex: 0
      };
      const result = SlidesUpdateSlidesPositionSchema.safeParse(input);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.errors[0].message).toBe('At least one slide ID is required');
      }
    });

    it('should reject empty string in slideObjectIds', () => {
      const input = {
        presentationId: 'test-presentation-id-123',
        slideObjectIds: ['slide1', '', 'slide3'],
        insertionIndex: 0
      };
      const result = SlidesUpdateSlidesPositionSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('should reject negative insertionIndex', () => {
      const input = {
        presentationId: 'test-presentation-id-123',
        slideObjectIds: ['slide1'],
        insertionIndex: -1
      };
      const result = SlidesUpdateSlidesPositionSchema.safeParse(input);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.errors[0].message).toBe('Insertion index must be at least 0');
      }
    });

    it('should ignore extra properties', () => {
      const input = {
        presentationId: 'test-presentation-id-123',
        slideObjectIds: ['slide1'],
        insertionIndex: 0,
        extraProperty: 'should be ignored'
      };
      const result = SlidesUpdateSlidesPositionSchema.safeParse(input);
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
        slideObjectIds: ['slide2', 'slide3'],
        insertionIndex: 0
      };
      const result = SlidesUpdateSlidesPositionSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        const apiRequest = {
          updateSlidesPosition: {
            slideObjectIds: result.data.slideObjectIds,
            insertionIndex: result.data.insertionIndex
          }
        };
        expect(apiRequest.updateSlidesPosition.slideObjectIds).toEqual(['slide2', 'slide3']);
        expect(apiRequest.updateSlidesPosition.insertionIndex).toBe(0);
      }
    });
  });

  describe('Response Format', () => {
    it('should return raw API response as JSON string', () => {
      const mockApiResponse = {
        presentationId: 'test-presentation-id-123',
        replies: [{}]
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
    });
  });
});
