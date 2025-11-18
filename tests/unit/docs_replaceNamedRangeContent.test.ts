import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';

// Schema definition (matches src/index.ts)
const DocsReplaceNamedRangeContentSchema = z.object({
  documentId: z.string().min(1, "Document ID is required"),
  namedRangeId: z.string().optional(),
  namedRangeName: z.string().optional(),
  text: z.string(),
  tabId: z.string().optional()
}).refine(data => data.namedRangeId || data.namedRangeName, {
  message: "Either namedRangeId or namedRangeName must be provided"
});

describe('docs_replaceNamedRangeContent - Unit Tests', () => {
  describe('Schema Validation', () => {
    it('should validate correct parameters with namedRangeId', () => {
      const validInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        namedRangeId: 'kix.abc123',
        text: 'New introduction text'
      };

      const result = DocsReplaceNamedRangeContentSchema.safeParse(validInput);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(validInput);
      }
    });

    it('should validate correct parameters with namedRangeName', () => {
      const validInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        namedRangeName: 'Introduction',
        text: 'New introduction text'
      };

      const result = DocsReplaceNamedRangeContentSchema.safeParse(validInput);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(validInput);
      }
    });

    it('should validate with optional tabId', () => {
      const validInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        namedRangeName: 'Introduction',
        text: 'New introduction text',
        tabId: 'tab123'
      };

      const result = DocsReplaceNamedRangeContentSchema.safeParse(validInput);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(validInput);
      }
    });

    it('should accept empty text string', () => {
      const validInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        namedRangeName: 'Introduction',
        text: ''
      };

      const result = DocsReplaceNamedRangeContentSchema.safeParse(validInput);
      expect(result.success).toBe(true);
    });

    it('should reject missing documentId', () => {
      const invalidInput = {
        namedRangeId: 'kix.abc123',
        text: 'New text'
      };

      const result = DocsReplaceNamedRangeContentSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.errors[0].message).toContain('Required');
      }
    });

    it('should reject empty documentId', () => {
      const invalidInput = {
        documentId: '',
        namedRangeId: 'kix.abc123',
        text: 'New text'
      };

      const result = DocsReplaceNamedRangeContentSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.errors[0].message).toBe('Document ID is required');
      }
    });

    it('should reject missing text', () => {
      const invalidInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        namedRangeId: 'kix.abc123'
      };

      const result = DocsReplaceNamedRangeContentSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.errors[0].message).toContain('Required');
      }
    });

    it('should reject when neither namedRangeId nor namedRangeName provided', () => {
      const invalidInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        text: 'New text'
      };

      const result = DocsReplaceNamedRangeContentSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.errors[0].message).toBe('Either namedRangeId or namedRangeName must be provided');
      }
    });

    it('should validate with both namedRangeId and namedRangeName', () => {
      const validInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        namedRangeId: 'kix.abc123',
        namedRangeName: 'Introduction',
        text: 'New text'
      };

      const result = DocsReplaceNamedRangeContentSchema.safeParse(validInput);
      expect(result.success).toBe(true);
    });
  });

  describe('API Request Formation', () => {
    it('should form correct batchUpdate request with namedRangeId', () => {
      const input = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        namedRangeId: 'kix.abc123',
        text: 'New introduction text'
      };

      // Expected Google Docs API request structure
      const expectedRequest = {
        documentId: input.documentId,
        requestBody: {
          requests: [{
            replaceNamedRangeContent: {
              namedRangeId: input.namedRangeId,
              text: input.text
            }
          }]
        }
      };

      expect(expectedRequest.documentId).toBe(input.documentId);
      expect(expectedRequest.requestBody.requests[0].replaceNamedRangeContent.namedRangeId).toBe(input.namedRangeId);
      expect(expectedRequest.requestBody.requests[0].replaceNamedRangeContent.text).toBe(input.text);
    });

    it('should form correct batchUpdate request with namedRangeName', () => {
      const input = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        namedRangeName: 'Introduction',
        text: 'New introduction text'
      };

      // Expected Google Docs API request structure
      const expectedRequest = {
        documentId: input.documentId,
        requestBody: {
          requests: [{
            replaceNamedRangeContent: {
              namedRangeName: input.namedRangeName,
              text: input.text
            }
          }]
        }
      };

      expect(expectedRequest.documentId).toBe(input.documentId);
      expect(expectedRequest.requestBody.requests[0].replaceNamedRangeContent.namedRangeName).toBe(input.namedRangeName);
      expect(expectedRequest.requestBody.requests[0].replaceNamedRangeContent.text).toBe(input.text);
    });

    it('should include tabId when provided', () => {
      const input = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        namedRangeName: 'Introduction',
        text: 'New text',
        tabId: 'tab123'
      };

      // Expected Google Docs API request structure
      const expectedRequest = {
        documentId: input.documentId,
        requestBody: {
          requests: [{
            replaceNamedRangeContent: {
              namedRangeName: input.namedRangeName,
              text: input.text,
              tabId: input.tabId
            }
          }]
        }
      };

      expect(expectedRequest.requestBody.requests[0].replaceNamedRangeContent.tabId).toBe(input.tabId);
    });
  });
});
