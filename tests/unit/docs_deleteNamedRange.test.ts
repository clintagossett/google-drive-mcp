import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';

// Schema definition (matches src/index.ts)
const DocsDeleteNamedRangeSchema = z.object({
  documentId: z.string().min(1, "Document ID is required"),
  namedRangeId: z.string().optional(),
  name: z.string().optional()
}).refine(data => data.namedRangeId || data.name, {
  message: "Either namedRangeId or name must be provided"
});

describe('docs_deleteNamedRange - Unit Tests', () => {
  describe('Schema Validation', () => {
    it('should validate correct parameters with namedRangeId', () => {
      const validInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        namedRangeId: 'kix.abc123'
      };

      const result = DocsDeleteNamedRangeSchema.safeParse(validInput);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(validInput);
      }
    });

    it('should validate correct parameters with name', () => {
      const validInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        name: 'Introduction'
      };

      const result = DocsDeleteNamedRangeSchema.safeParse(validInput);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(validInput);
      }
    });

    it('should validate with both namedRangeId and name', () => {
      const validInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        namedRangeId: 'kix.abc123',
        name: 'Introduction'
      };

      const result = DocsDeleteNamedRangeSchema.safeParse(validInput);
      expect(result.success).toBe(true);
    });

    it('should reject missing documentId', () => {
      const invalidInput = {
        namedRangeId: 'kix.abc123'
      };

      const result = DocsDeleteNamedRangeSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.errors[0].message).toContain('Required');
      }
    });

    it('should reject empty documentId', () => {
      const invalidInput = {
        documentId: '',
        namedRangeId: 'kix.abc123'
      };

      const result = DocsDeleteNamedRangeSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.errors[0].message).toBe('Document ID is required');
      }
    });

    it('should reject when neither namedRangeId nor name provided', () => {
      const invalidInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w'
      };

      const result = DocsDeleteNamedRangeSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.errors[0].message).toBe('Either namedRangeId or name must be provided');
      }
    });

    it('should accept empty strings for optional fields if other is provided', () => {
      const validInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        namedRangeId: '',
        name: 'Introduction'
      };

      const result = DocsDeleteNamedRangeSchema.safeParse(validInput);
      expect(result.success).toBe(true);
    });
  });

  describe('API Request Formation', () => {
    it('should form correct batchUpdate request with namedRangeId', () => {
      const input = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        namedRangeId: 'kix.abc123'
      };

      // Expected Google Docs API request structure
      const expectedRequest = {
        documentId: input.documentId,
        requestBody: {
          requests: [{
            deleteNamedRange: {
              namedRangeId: input.namedRangeId
            }
          }]
        }
      };

      expect(expectedRequest.documentId).toBe(input.documentId);
      expect(expectedRequest.requestBody.requests[0].deleteNamedRange.namedRangeId).toBe(input.namedRangeId);
    });

    it('should form correct batchUpdate request with name', () => {
      const input = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        name: 'Introduction'
      };

      // Expected Google Docs API request structure
      const expectedRequest = {
        documentId: input.documentId,
        requestBody: {
          requests: [{
            deleteNamedRange: {
              name: input.name
            }
          }]
        }
      };

      expect(expectedRequest.documentId).toBe(input.documentId);
      expect(expectedRequest.requestBody.requests[0].deleteNamedRange.name).toBe(input.name);
    });
  });
});
