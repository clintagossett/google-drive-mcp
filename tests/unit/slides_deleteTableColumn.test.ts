import { describe, it, expect } from 'vitest';
import { z } from 'zod';

const SlidesDeleteTableColumnSchema = z.object({
  presentationId: z.string().min(1, "Presentation ID is required"),
  tableObjectId: z.string().min(1, "Table object ID is required"),
  cellLocation: z.object({
    rowIndex: z.number().min(0),
    columnIndex: z.number().min(0)
  })
});

describe('slides_deleteTableColumn Schema Validation', () => {
  it('should validate valid input', () => {
    const input = {
      presentationId: 'presentation123',
      tableObjectId: 'table456',
      cellLocation: {
        rowIndex: 0,
        columnIndex: 1
      }
    };
    expect(() => SlidesDeleteTableColumnSchema.parse(input)).not.toThrow();
  });

  it('should reject negative columnIndex', () => {
    const input = {
      presentationId: 'presentation123',
      tableObjectId: 'table456',
      cellLocation: {
        rowIndex: 0,
        columnIndex: -1
      }
    };
    expect(() => SlidesDeleteTableColumnSchema.parse(input)).toThrow();
  });

  it('should reject missing presentationId', () => {
    const input = {
      tableObjectId: 'table456',
      cellLocation: {
        rowIndex: 0,
        columnIndex: 0
      }
    };
    expect(() => SlidesDeleteTableColumnSchema.parse(input)).toThrow(/Required/);
  });

  it('should reject empty tableObjectId', () => {
    const input = {
      presentationId: 'presentation123',
      tableObjectId: '',
      cellLocation: {
        rowIndex: 0,
        columnIndex: 0
      }
    };
    expect(() => SlidesDeleteTableColumnSchema.parse(input)).toThrow(/Table object ID is required/);
  });

  it('should reject missing cellLocation', () => {
    const input = {
      presentationId: 'presentation123',
      tableObjectId: 'table456'
    };
    expect(() => SlidesDeleteTableColumnSchema.parse(input)).toThrow(/Required/);
  });
});
