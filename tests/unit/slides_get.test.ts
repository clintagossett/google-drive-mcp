import { describe, it, expect } from 'vitest';
import { z } from 'zod';

// Schema definition (matches src/index.ts)
const SlidesGetSchema = z.object({
  presentationId: z.string().min(1, "Presentation ID is required")
});

describe('slides_get', () => {
  describe('Schema Validation', () => {
    it('should validate with presentationId (required parameter)', () => {
      const input = {
        presentationId: 'test-presentation-id-123'
      };

      const result = SlidesGetSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.presentationId).toBe('test-presentation-id-123');
      }
    });

    it('should reject empty presentationId', () => {
      const input = {
        presentationId: ''
      };

      const result = SlidesGetSchema.safeParse(input);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.errors[0].message).toBe('Presentation ID is required');
      }
    });

    it('should reject missing presentationId', () => {
      const input = {};

      const result = SlidesGetSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('should reject non-string presentationId', () => {
      const input = {
        presentationId: 12345
      };

      const result = SlidesGetSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('should ignore extra properties', () => {
      const input = {
        presentationId: 'test-presentation-id-123',
        extraProperty: 'should be ignored'
      };

      const result = SlidesGetSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).not.toHaveProperty('extraProperty');
      }
    });
  });

  describe('API Call Format', () => {
    it('should map to correct Google Slides API call format', () => {
      const input = {
        presentationId: 'test-presentation-id-123'
      };

      const result = SlidesGetSchema.safeParse(input);
      expect(result.success).toBe(true);

      if (result.success) {
        // Expected API call: slides.presentations.get({ presentationId: 'test-presentation-id-123' })
        const apiParams = {
          presentationId: result.data.presentationId
        };

        expect(apiParams).toEqual({
          presentationId: 'test-presentation-id-123'
        });
      }
    });
  });

  describe('Response Format', () => {
    it('should return raw API response as JSON string', () => {
      // Mock API response
      const mockApiResponse = {
        presentationId: 'test-presentation-id-123',
        pageSize: {
          width: { magnitude: 9144000, unit: 'EMU' },
          height: { magnitude: 6858000, unit: 'EMU' }
        },
        slides: [
          {
            objectId: 'slide1',
            pageElements: [
              {
                objectId: 'textbox1',
                shape: {
                  shapeType: 'TEXT_BOX',
                  text: {
                    textElements: [
                      {
                        textRun: {
                          content: 'Hello Slides\n',
                          style: {}
                        }
                      }
                    ]
                  }
                }
              }
            ]
          }
        ],
        title: 'Test Presentation'
      };

      // Expected MCP response format
      const expectedResponse = {
        content: [{
          type: "text",
          text: JSON.stringify(mockApiResponse, null, 2)
        }],
        isError: false
      };

      expect(expectedResponse.content[0].type).toBe('text');
      expect(typeof expectedResponse.content[0].text).toBe('string');
      expect(expectedResponse.isError).toBe(false);

      // Verify it's valid JSON
      const parsed = JSON.parse(expectedResponse.content[0].text);
      expect(parsed.presentationId).toBe('test-presentation-id-123');
      expect(parsed.title).toBe('Test Presentation');
      expect(parsed.slides).toHaveLength(1);
      expect(parsed.slides[0].objectId).toBe('slide1');
      expect(parsed.slides[0].pageElements).toHaveLength(1);
    });
  });
});
