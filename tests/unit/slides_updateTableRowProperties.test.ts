import { describe, it, expect } from 'vitest';
import { z } from 'zod';

const SlidesUpdateTableRowPropertiesSchema = z.object({
  presentationId: z.string().min(1, "Presentation ID is required"),
  objectId: z.string().min(1, "Table object ID is required"),
  rowIndices: z.array(z.number().min(0)).min(1, "At least one row index is required"),
  tableRowProperties: z.object({
    minRowHeight: z.object({
      magnitude: z.number().min(0),
      unit: z.enum(['EMU', 'PT'])
    })
  })
});

describe('slides_updateTableRowProperties Schema Validation', () => {
  it('should validate with single row index', () => {
    const input = {
      presentationId: 'presentation123',
      objectId: 'table456',
      rowIndices: [0],
      tableRowProperties: {
        minRowHeight: {
          magnitude: 50,
          unit: 'PT' as const
        }
      }
    };
    expect(() => SlidesUpdateTableRowPropertiesSchema.parse(input)).not.toThrow();
  });

  it('should validate with multiple row indices', () => {
    const input = {
      presentationId: 'presentation123',
      objectId: 'table456',
      rowIndices: [0, 1, 2, 3],
      tableRowProperties: {
        minRowHeight: {
          magnitude: 150000,
          unit: 'EMU' as const
        }
      }
    };
    expect(() => SlidesUpdateTableRowPropertiesSchema.parse(input)).not.toThrow();
  });

  it('should reject empty rowIndices array', () => {
    const input = {
      presentationId: 'presentation123',
      objectId: 'table456',
      rowIndices: [],
      tableRowProperties: {
        minRowHeight: {
          magnitude: 50,
          unit: 'PT' as const
        }
      }
    };
    expect(() => SlidesUpdateTableRowPropertiesSchema.parse(input)).toThrow(/At least one row index is required/);
  });

  it('should reject negative row index', () => {
    const input = {
      presentationId: 'presentation123',
      objectId: 'table456',
      rowIndices: [-1],
      tableRowProperties: {
        minRowHeight: {
          magnitude: 50,
          unit: 'PT' as const
        }
      }
    };
    expect(() => SlidesUpdateTableRowPropertiesSchema.parse(input)).toThrow();
  });

  it('should reject missing presentationId', () => {
    const input = {
      objectId: 'table456',
      rowIndices: [0],
      tableRowProperties: {
        minRowHeight: {
          magnitude: 50,
          unit: 'PT' as const
        }
      }
    };
    expect(() => SlidesUpdateTableRowPropertiesSchema.parse(input)).toThrow(/Required/);
  });

  it('should reject missing tableRowProperties', () => {
    const input = {
      presentationId: 'presentation123',
      objectId: 'table456',
      rowIndices: [0]
    };
    expect(() => SlidesUpdateTableRowPropertiesSchema.parse(input)).toThrow(/Required/);
  });
});
