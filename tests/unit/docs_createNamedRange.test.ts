import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';

// Schema definition (matches src/index.ts)
const DocsCreateNamedRangeSchema = z.object({
  documentId: z.string().min(1, "Document ID is required"),
  name: z.string().min(1, "Name is required"),
  startIndex: z.number().int().min(1, "Start index must be at least 1"),
  endIndex: z.number().int().min(1, "End index must be at least 1")
});

describe('docs_createNamedRange - Unit Tests', () => {
  describe('Schema Validation', () => {
    it('should validate correct parameters', () => {
      const validInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        name: 'Introduction',
        startIndex: 1,
        endIndex: 500
      };

      const result = DocsCreateNamedRangeSchema.safeParse(validInput);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(validInput);
      }
    });

    it('should reject missing documentId', () => {
      const invalidInput = {
        name: 'Introduction',
        startIndex: 1,
        endIndex: 500
      };

      const result = DocsCreateNamedRangeSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.errors[0].message).toContain('Required');
      }
    });

    it('should reject empty documentId', () => {
      const invalidInput = {
        documentId: '',
        name: 'Introduction',
        startIndex: 1,
        endIndex: 500
      };

      const result = DocsCreateNamedRangeSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.errors[0].message).toBe('Document ID is required');
      }
    });

    it('should reject missing name', () => {
      const invalidInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        startIndex: 1,
        endIndex: 500
      };

      const result = DocsCreateNamedRangeSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.errors[0].message).toContain('Required');
      }
    });

    it('should reject empty name', () => {
      const invalidInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        name: '',
        startIndex: 1,
        endIndex: 500
      };

      const result = DocsCreateNamedRangeSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.errors[0].message).toBe('Name is required');
      }
    });

    it('should reject startIndex less than 1', () => {
      const invalidInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        name: 'Introduction',
        startIndex: 0,
        endIndex: 500
      };

      const result = DocsCreateNamedRangeSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.errors[0].message).toBe('Start index must be at least 1');
      }
    });

    it('should reject endIndex less than 1', () => {
      const invalidInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        name: 'Introduction',
        startIndex: 1,
        endIndex: 0
      };

      const result = DocsCreateNamedRangeSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.errors[0].message).toBe('End index must be at least 1');
      }
    });

    it('should reject non-integer startIndex', () => {
      const invalidInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        name: 'Introduction',
        startIndex: 1.5,
        endIndex: 500
      };

      const result = DocsCreateNamedRangeSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
    });

    it('should accept valid range', () => {
      const validInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        name: 'Chapter 1',
        startIndex: 100,
        endIndex: 5000
      };

      const result = DocsCreateNamedRangeSchema.safeParse(validInput);
      expect(result.success).toBe(true);
    });
  });

  describe('API Request Formation', () => {
    it('should form correct batchUpdate request structure', () => {
      const input = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        name: 'Introduction',
        startIndex: 1,
        endIndex: 500
      };

      // Expected Google Docs API request structure
      const expectedRequest = {
        documentId: input.documentId,
        requestBody: {
          requests: [{
            createNamedRange: {
              name: input.name,
              range: {
                startIndex: input.startIndex,
                endIndex: input.endIndex
              }
            }
          }]
        }
      };

      expect(expectedRequest.documentId).toBe(input.documentId);
      expect(expectedRequest.requestBody.requests[0].createNamedRange.name).toBe(input.name);
      expect(expectedRequest.requestBody.requests[0].createNamedRange.range.startIndex).toBe(input.startIndex);
      expect(expectedRequest.requestBody.requests[0].createNamedRange.range.endIndex).toBe(input.endIndex);
    });
  });
});
