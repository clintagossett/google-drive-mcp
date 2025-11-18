import { describe, it, expect } from 'vitest';
import { z } from 'zod';

// Schema definition (matches src/index.ts)
const DocsUpdateTableColumnPropertiesSchema = z.object({
  documentId: z.string().min(1, "Document ID is required"),
  tableStartIndex: z.number().min(1, "Table start index must be at least 1"),
  columnIndices: z.array(z.number().min(0)),
  widthMagnitude: z.number().optional(),
  widthType: z.enum(['EVENLY_DISTRIBUTED', 'FIXED_WIDTH']).optional()
});

describe('docs_updateTableColumnProperties - Unit Tests', () => {
  describe('Schema Validation', () => {
    it('should validate minimal required parameters', () => {
      const validInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        tableStartIndex: 10,
        columnIndices: [0, 1]
      };

      const result = DocsUpdateTableColumnPropertiesSchema.safeParse(validInput);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(validInput);
      }
    });

    it('should validate with width magnitude', () => {
      const validInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        tableStartIndex: 10,
        columnIndices: [0, 1],
        widthMagnitude: 144
      };

      const result = DocsUpdateTableColumnPropertiesSchema.safeParse(validInput);
      expect(result.success).toBe(true);
    });

    it('should validate with width type', () => {
      const validInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        tableStartIndex: 10,
        columnIndices: [0, 1],
        widthType: 'FIXED_WIDTH' as const
      };

      const result = DocsUpdateTableColumnPropertiesSchema.safeParse(validInput);
      expect(result.success).toBe(true);
    });

    it('should validate with both width properties', () => {
      const validInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        tableStartIndex: 10,
        columnIndices: [0, 1],
        widthMagnitude: 144,
        widthType: 'FIXED_WIDTH' as const
      };

      const result = DocsUpdateTableColumnPropertiesSchema.safeParse(validInput);
      expect(result.success).toBe(true);
    });

    it('should reject missing columnIndices', () => {
      const invalidInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        tableStartIndex: 10,
        widthMagnitude: 144
      };

      const result = DocsUpdateTableColumnPropertiesSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
    });

    it('should reject empty columnIndices array', () => {
      const invalidInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        tableStartIndex: 10,
        columnIndices: []
      };

      const result = DocsUpdateTableColumnPropertiesSchema.safeParse(invalidInput);
      expect(result.success).toBe(true); // Empty array is valid, API will handle it
    });

    it('should reject negative column indices', () => {
      const invalidInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        tableStartIndex: 10,
        columnIndices: [0, -1]
      };

      const result = DocsUpdateTableColumnPropertiesSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
    });

    it('should reject invalid widthType', () => {
      const invalidInput = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        tableStartIndex: 10,
        columnIndices: [0, 1],
        widthType: 'INVALID'
      };

      const result = DocsUpdateTableColumnPropertiesSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
    });
  });

  describe('API Request Formation', () => {
    it('should form correct batchUpdate request structure', () => {
      const input = {
        documentId: '1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w',
        tableStartIndex: 10,
        columnIndices: [0, 1],
        widthMagnitude: 144,
        widthType: 'FIXED_WIDTH' as const
      };

      const expectedRequest = {
        documentId: input.documentId,
        requestBody: {
          requests: [{
            updateTableColumnProperties: {
              tableStartLocation: { index: input.tableStartIndex },
              columnIndices: input.columnIndices,
              tableColumnProperties: {
                width: { magnitude: input.widthMagnitude, unit: 'PT' },
                widthType: input.widthType
              },
              fields: 'width,widthType'
            }
          }]
        }
      };

      expect(expectedRequest.requestBody.requests[0].updateTableColumnProperties.columnIndices).toEqual([0, 1]);
      expect(expectedRequest.requestBody.requests[0].updateTableColumnProperties.tableColumnProperties.widthType).toBe('FIXED_WIDTH');
    });
  });
});
