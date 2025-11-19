import { describe, it, expect } from 'vitest';
import { z } from 'zod';

const SlidesUpdateTableColumnPropertiesSchema = z.object({
  presentationId: z.string().min(1, "Presentation ID is required"),
  objectId: z.string().min(1, "Table object ID is required"),
  columnIndices: z.array(z.number().min(0)).min(1, "At least one column index is required"),
  tableColumnProperties: z.object({
    columnWidth: z.object({
      magnitude: z.number().min(0),
      unit: z.enum(['EMU', 'PT'])
    })
  })
});

describe('slides_updateTableColumnProperties Schema Validation', () => {
  it('should validate with single column index', () => {
    const input = {
      presentationId: 'presentation123',
      objectId: 'table456',
      columnIndices: [0],
      tableColumnProperties: {
        columnWidth: {
          magnitude: 100,
          unit: 'PT' as const
        }
      }
    };
    expect(() => SlidesUpdateTableColumnPropertiesSchema.parse(input)).not.toThrow();
  });

  it('should validate with multiple column indices', () => {
    const input = {
      presentationId: 'presentation123',
      objectId: 'table456',
      columnIndices: [0, 1, 2],
      tableColumnProperties: {
        columnWidth: {
          magnitude: 200000,
          unit: 'EMU' as const
        }
      }
    };
    expect(() => SlidesUpdateTableColumnPropertiesSchema.parse(input)).not.toThrow();
  });

  it('should reject empty columnIndices array', () => {
    const input = {
      presentationId: 'presentation123',
      objectId: 'table456',
      columnIndices: [],
      tableColumnProperties: {
        columnWidth: {
          magnitude: 100,
          unit: 'PT' as const
        }
      }
    };
    expect(() => SlidesUpdateTableColumnPropertiesSchema.parse(input)).toThrow(/At least one column index is required/);
  });

  it('should reject negative column index', () => {
    const input = {
      presentationId: 'presentation123',
      objectId: 'table456',
      columnIndices: [-1],
      tableColumnProperties: {
        columnWidth: {
          magnitude: 100,
          unit: 'PT' as const
        }
      }
    };
    expect(() => SlidesUpdateTableColumnPropertiesSchema.parse(input)).toThrow();
  });

  it('should reject missing presentationId', () => {
    const input = {
      objectId: 'table456',
      columnIndices: [0],
      tableColumnProperties: {
        columnWidth: {
          magnitude: 100,
          unit: 'PT' as const
        }
      }
    };
    expect(() => SlidesUpdateTableColumnPropertiesSchema.parse(input)).toThrow(/Required/);
  });

  it('should reject missing tableColumnProperties', () => {
    const input = {
      presentationId: 'presentation123',
      objectId: 'table456',
      columnIndices: [0]
    };
    expect(() => SlidesUpdateTableColumnPropertiesSchema.parse(input)).toThrow(/Required/);
  });
});
