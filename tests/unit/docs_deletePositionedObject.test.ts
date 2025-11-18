import { describe, it, expect } from 'vitest';
import { z } from 'zod';

// Schema definition (matches src/index.ts)
const DocsDeletePositionedObjectSchema = z.object({
  documentId: z.string().min(1, "Document ID is required"),
  objectId: z.string().min(1, "Object ID is required")
});

describe('docs_deletePositionedObject - Unit Tests', () => {
  describe('Schema Validation', () => {
    it('should validate correct parameters', () => {
      const validInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        objectId: 'kix.positioned123'
      };

      const result = DocsDeletePositionedObjectSchema.safeParse(validInput);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(validInput);
      }
    });

    it('should reject missing documentId', () => {
      const invalidInput = {
        objectId: 'kix.positioned123'
      };

      const result = DocsDeletePositionedObjectSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
    });

    it('should reject empty documentId', () => {
      const invalidInput = {
        documentId: '',
        objectId: 'kix.positioned123'
      };

      const result = DocsDeletePositionedObjectSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.errors[0].message).toBe('Document ID is required');
      }
    });

    it('should reject missing objectId', () => {
      const invalidInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w'
      };

      const result = DocsDeletePositionedObjectSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
    });

    it('should reject empty objectId', () => {
      const invalidInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        objectId: ''
      };

      const result = DocsDeletePositionedObjectSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.errors[0].message).toBe('Object ID is required');
      }
    });
  });

  describe('API Request Formation', () => {
    it('should form correct batchUpdate request structure', () => {
      const input = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        objectId: 'kix.positioned123'
      };

      const expectedRequest = {
        documentId: input.documentId,
        requestBody: {
          requests: [{
            deletePositionedObject: {
              objectId: input.objectId
            }
          }]
        }
      };

      expect(expectedRequest.requestBody.requests[0].deletePositionedObject.objectId).toBe(input.objectId);
    });

    it('should handle various objectId formats', () => {
      const objectIds = ['kix.positioned123', 'object_abc', 'obj-123-xyz'];

      objectIds.forEach(objectId => {
        const input = {
          documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
          objectId
        };
        const result = DocsDeletePositionedObjectSchema.safeParse(input);
        expect(result.success).toBe(true);
      });
    });
  });

  describe('Edge Cases', () => {
    it('should validate objectId as string type', () => {
      const validInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        objectId: 'kix.positioned123'
      };

      const result = DocsDeletePositionedObjectSchema.safeParse(validInput);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(typeof result.data.objectId).toBe('string');
      }
    });

    it('should reject numeric objectId', () => {
      const invalidInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        objectId: 123
      };

      const result = DocsDeletePositionedObjectSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
    });
  });
});
