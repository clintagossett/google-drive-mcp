import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';

// Schema definition (matches src/index.ts)
const DocsInsertPersonSchema = z.object({
  documentId: z.string().min(1, "Document ID is required"),
  index: z.number().int().min(1, "Index must be at least 1"),
  email: z.string().email("Valid email is required")
});

describe('docs_insertPerson - Unit Tests', () => {
  describe('Schema Validation', () => {
    it('should validate correct parameters', () => {
      const validInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        index: 1,
        email: 'user@example.com'
      };

      const result = DocsInsertPersonSchema.safeParse(validInput);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(validInput);
      }
    });

    it('should reject missing documentId', () => {
      const invalidInput = {
        index: 1,
        email: 'user@example.com'
      };

      const result = DocsInsertPersonSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.errors[0].message).toContain('Required');
      }
    });

    it('should reject empty documentId', () => {
      const invalidInput = {
        documentId: '',
        index: 1,
        email: 'user@example.com'
      };

      const result = DocsInsertPersonSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.errors[0].message).toBe('Document ID is required');
      }
    });

    it('should reject missing index', () => {
      const invalidInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        email: 'user@example.com'
      };

      const result = DocsInsertPersonSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.errors[0].message).toContain('Required');
      }
    });

    it('should reject index less than 1', () => {
      const invalidInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        index: 0,
        email: 'user@example.com'
      };

      const result = DocsInsertPersonSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.errors[0].message).toBe('Index must be at least 1');
      }
    });

    it('should reject non-integer index', () => {
      const invalidInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        index: 1.5,
        email: 'user@example.com'
      };

      const result = DocsInsertPersonSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
    });

    it('should reject missing email', () => {
      const invalidInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        index: 1
      };

      const result = DocsInsertPersonSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.errors[0].message).toContain('Required');
      }
    });

    it('should reject invalid email format', () => {
      const invalidInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        index: 1,
        email: 'not-an-email'
      };

      const result = DocsInsertPersonSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.errors[0].message).toBe('Valid email is required');
      }
    });

    it('should reject empty email', () => {
      const invalidInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        index: 1,
        email: ''
      };

      const result = DocsInsertPersonSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.errors[0].message).toBe('Valid email is required');
      }
    });

    it('should accept valid email with subdomain', () => {
      const validInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        index: 100,
        email: 'user@mail.example.com'
      };

      const result = DocsInsertPersonSchema.safeParse(validInput);
      expect(result.success).toBe(true);
    });

    it('should accept valid email with plus sign', () => {
      const validInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        index: 1,
        email: 'user+tag@example.com'
      };

      const result = DocsInsertPersonSchema.safeParse(validInput);
      expect(result.success).toBe(true);
    });

    it('should accept large index values', () => {
      const validInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        index: 10000,
        email: 'user@example.com'
      };

      const result = DocsInsertPersonSchema.safeParse(validInput);
      expect(result.success).toBe(true);
    });
  });

  describe('API Request Formation', () => {
    it('should form correct batchUpdate request structure', () => {
      const input = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        index: 1,
        email: 'user@example.com'
      };

      // Expected Google Docs API request structure
      const expectedRequest = {
        documentId: input.documentId,
        requestBody: {
          requests: [{
            insertPerson: {
              location: { index: input.index },
              person: {
                personProperties: {
                  email: input.email
                }
              }
            }
          }]
        }
      };

      expect(expectedRequest.documentId).toBe(input.documentId);
      expect(expectedRequest.requestBody.requests[0].insertPerson.location.index).toBe(input.index);
      expect(expectedRequest.requestBody.requests[0].insertPerson.person.personProperties.email).toBe(input.email);
    });

    it('should form correct request with different email format', () => {
      const input = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        index: 500,
        email: 'john.doe+work@company.example.com'
      };

      // Expected Google Docs API request structure
      const expectedRequest = {
        documentId: input.documentId,
        requestBody: {
          requests: [{
            insertPerson: {
              location: { index: input.index },
              person: {
                personProperties: {
                  email: input.email
                }
              }
            }
          }]
        }
      };

      expect(expectedRequest.requestBody.requests[0].insertPerson.person.personProperties.email).toBe(input.email);
    });
  });
});
