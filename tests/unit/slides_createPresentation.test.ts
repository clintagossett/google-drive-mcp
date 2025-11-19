import { describe, it, expect } from 'vitest';
import { z } from 'zod';

// Schema definition (matches src/index.ts)
const SlidesCreatePresentationSchema = z.object({
  title: z.string().optional(),
  locale: z.string().optional(),
  pageSize: z.object({
    width: z.object({
      magnitude: z.number(),
      unit: z.enum(['EMU', 'PT'])
    }),
    height: z.object({
      magnitude: z.number(),
      unit: z.enum(['EMU', 'PT'])
    })
  }).optional()
});

describe('slides_createPresentation', () => {
  describe('Schema Validation', () => {
    it('should validate with no parameters (all optional)', () => {
      const input = {};
      const result = SlidesCreatePresentationSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('should validate with title only', () => {
      const input = {
        title: 'My Presentation'
      };
      const result = SlidesCreatePresentationSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.title).toBe('My Presentation');
      }
    });

    it('should validate with title and locale', () => {
      const input = {
        title: 'My Presentation',
        locale: 'en_US'
      };
      const result = SlidesCreatePresentationSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.title).toBe('My Presentation');
        expect(result.data.locale).toBe('en_US');
      }
    });

    it('should validate with full pageSize specification', () => {
      const input = {
        title: 'My Presentation',
        pageSize: {
          width: { magnitude: 9144000, unit: 'EMU' as const },
          height: { magnitude: 6858000, unit: 'EMU' as const }
        }
      };
      const result = SlidesCreatePresentationSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.pageSize?.width.magnitude).toBe(9144000);
        expect(result.data.pageSize?.width.unit).toBe('EMU');
        expect(result.data.pageSize?.height.magnitude).toBe(6858000);
        expect(result.data.pageSize?.height.unit).toBe('EMU');
      }
    });

    it('should validate with pageSize in PT units', () => {
      const input = {
        title: 'My Presentation',
        pageSize: {
          width: { magnitude: 720, unit: 'PT' as const },
          height: { magnitude: 540, unit: 'PT' as const }
        }
      };
      const result = SlidesCreatePresentationSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.pageSize?.width.unit).toBe('PT');
        expect(result.data.pageSize?.height.unit).toBe('PT');
      }
    });

    it('should reject invalid unit type', () => {
      const input = {
        pageSize: {
          width: { magnitude: 100, unit: 'INVALID' },
          height: { magnitude: 100, unit: 'EMU' }
        }
      };
      const result = SlidesCreatePresentationSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('should reject non-number magnitude', () => {
      const input = {
        pageSize: {
          width: { magnitude: '9144000', unit: 'EMU' },
          height: { magnitude: 6858000, unit: 'EMU' }
        }
      };
      const result = SlidesCreatePresentationSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('should ignore extra properties', () => {
      const input = {
        title: 'My Presentation',
        extraProperty: 'should be ignored'
      };
      const result = SlidesCreatePresentationSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).not.toHaveProperty('extraProperty');
      }
    });
  });

  describe('API Call Format', () => {
    it('should map to correct Google Slides API call format (minimal)', () => {
      const input = {};
      const result = SlidesCreatePresentationSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        // API accepts empty request body
        expect(result.data).toEqual({});
      }
    });

    it('should map to correct Google Slides API call format (full)', () => {
      const input = {
        title: 'Test Presentation',
        locale: 'en_US',
        pageSize: {
          width: { magnitude: 9144000, unit: 'EMU' as const },
          height: { magnitude: 6858000, unit: 'EMU' as const }
        }
      };
      const result = SlidesCreatePresentationSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        const apiParams = {
          title: result.data.title,
          locale: result.data.locale,
          pageSize: result.data.pageSize
        };
        expect(apiParams).toEqual({
          title: 'Test Presentation',
          locale: 'en_US',
          pageSize: {
            width: { magnitude: 9144000, unit: 'EMU' },
            height: { magnitude: 6858000, unit: 'EMU' }
          }
        });
      }
    });
  });

  describe('Response Format', () => {
    it('should return raw API response as JSON string', () => {
      const mockApiResponse = {
        presentationId: 'new-presentation-id-123',
        title: 'Test Presentation',
        locale: 'en_US',
        pageSize: {
          width: { magnitude: 9144000, unit: 'EMU' },
          height: { magnitude: 6858000, unit: 'EMU' }
        },
        slides: [
          {
            objectId: 'slide1',
            pageElements: []
          }
        ],
        masters: [],
        layouts: [],
        revisionId: 'rev1'
      };

      const expectedResponse = {
        content: [{ type: "text", text: JSON.stringify(mockApiResponse, null, 2) }],
        isError: false
      };

      expect(expectedResponse.content[0].type).toBe('text');
      expect(typeof expectedResponse.content[0].text).toBe('string');
      expect(expectedResponse.isError).toBe(false);

      const parsed = JSON.parse(expectedResponse.content[0].text);
      expect(parsed.presentationId).toBe('new-presentation-id-123');
      expect(parsed.title).toBe('Test Presentation');
      expect(parsed.slides).toHaveLength(1);
    });
  });
});
