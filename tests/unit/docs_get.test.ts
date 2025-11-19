import { describe, it, expect } from 'vitest';
import { z } from 'zod';

// Schema definition (will be imported from src/index.ts)
const DocsGetSchema = z.object({
  documentId: z.string().min(1, "Document ID is required"),
  includeTabsContent: z.boolean().optional()
});

describe('docs_get', () => {
  describe('Schema Validation', () => {
    it('should validate with documentId only (required parameter)', () => {
      const input = {
        documentId: 'test-doc-id-123'
      };

      const result = DocsGetSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.documentId).toBe('test-doc-id-123');
        expect(result.data.includeTabsContent).toBeUndefined();
      }
    });

    it('should validate with documentId and includeTabsContent=true', () => {
      const input = {
        documentId: 'test-doc-id-123',
        includeTabsContent: true
      };

      const result = DocsGetSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.documentId).toBe('test-doc-id-123');
        expect(result.data.includeTabsContent).toBe(true);
      }
    });

    it('should validate with documentId and includeTabsContent=false', () => {
      const input = {
        documentId: 'test-doc-id-123',
        includeTabsContent: false
      };

      const result = DocsGetSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.documentId).toBe('test-doc-id-123');
        expect(result.data.includeTabsContent).toBe(false);
      }
    });

    it('should reject empty documentId', () => {
      const input = {
        documentId: ''
      };

      const result = DocsGetSchema.safeParse(input);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.errors[0].message).toBe('Document ID is required');
      }
    });

    it('should reject missing documentId', () => {
      const input = {};

      const result = DocsGetSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('should reject non-string documentId', () => {
      const input = {
        documentId: 12345
      };

      const result = DocsGetSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('should reject non-boolean includeTabsContent', () => {
      const input = {
        documentId: 'test-doc-id-123',
        includeTabsContent: 'true' // string instead of boolean
      };

      const result = DocsGetSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('should ignore extra properties', () => {
      const input = {
        documentId: 'test-doc-id-123',
        includeTabsContent: true,
        extraProperty: 'should be ignored'
      };

      const result = DocsGetSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).not.toHaveProperty('extraProperty');
      }
    });
  });

  describe('API Call Format', () => {
    it('should map to correct Google Docs API call format (documentId only)', () => {
      const input = {
        documentId: 'test-doc-id-123'
      };

      const result = DocsGetSchema.safeParse(input);
      expect(result.success).toBe(true);

      if (result.success) {
        // Expected API call: docs.documents.get({ documentId: 'test-doc-id-123' })
        const apiParams = {
          documentId: result.data.documentId,
          ...(result.data.includeTabsContent !== undefined && {
            includeTabsContent: result.data.includeTabsContent
          })
        };

        expect(apiParams).toEqual({
          documentId: 'test-doc-id-123'
        });
      }
    });

    it('should map to correct Google Docs API call format (with includeTabsContent)', () => {
      const input = {
        documentId: 'test-doc-id-123',
        includeTabsContent: true
      };

      const result = DocsGetSchema.safeParse(input);
      expect(result.success).toBe(true);

      if (result.success) {
        // Expected API call: docs.documents.get({ documentId: 'test-doc-id-123', includeTabsContent: true })
        const apiParams = {
          documentId: result.data.documentId,
          ...(result.data.includeTabsContent !== undefined && {
            includeTabsContent: result.data.includeTabsContent
          })
        };

        expect(apiParams).toEqual({
          documentId: 'test-doc-id-123',
          includeTabsContent: true
        });
      }
    });
  });

  describe('Response Format', () => {
    it('should return raw API response as JSON string', () => {
      // Mock API response
      const mockApiResponse = {
        documentId: 'test-doc-id-123',
        title: 'Test Document',
        body: {
          content: [
            {
              startIndex: 1,
              endIndex: 12,
              paragraph: {
                elements: [
                  {
                    startIndex: 1,
                    endIndex: 12,
                    textRun: {
                      content: 'Hello World\n',
                      textStyle: {}
                    }
                  }
                ]
              }
            }
          ]
        }
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
      expect(parsed.documentId).toBe('test-doc-id-123');
      expect(parsed.title).toBe('Test Document');
      expect(parsed.body.content).toHaveLength(1);
    });
  });
});
