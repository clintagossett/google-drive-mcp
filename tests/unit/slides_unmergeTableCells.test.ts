import { describe, it, expect } from 'vitest';
import { z } from 'zod';

const SlidesUnmergeTableCellsSchema = z.object({
  presentationId: z.string().min(1, "Presentation ID is required"),
  objectId: z.string().min(1, "Table object ID is required"),
  tableRange: z.object({
    location: z.object({
      rowIndex: z.number().min(0),
      columnIndex: z.number().min(0)
    }),
    rowSpan: z.number().min(1).optional(),
    columnSpan: z.number().min(1).optional()
  })
});

describe('slides_unmergeTableCells Schema Validation', () => {
  it('should validate with location only', () => {
    const input = {
      presentationId: 'presentation123',
      objectId: 'table456',
      tableRange: {
        location: {
          rowIndex: 0,
          columnIndex: 0
        }
      }
    };
    expect(() => SlidesUnmergeTableCellsSchema.parse(input)).not.toThrow();
  });

  it('should validate with rowSpan and columnSpan', () => {
    const input = {
      presentationId: 'presentation123',
      objectId: 'table456',
      tableRange: {
        location: {
          rowIndex: 1,
          columnIndex: 1
        },
        rowSpan: 2,
        columnSpan: 3
      }
    };
    expect(() => SlidesUnmergeTableCellsSchema.parse(input)).not.toThrow();
  });

  it('should reject zero rowSpan', () => {
    const input = {
      presentationId: 'presentation123',
      objectId: 'table456',
      tableRange: {
        location: {
          rowIndex: 0,
          columnIndex: 0
        },
        rowSpan: 0
      }
    };
    expect(() => SlidesUnmergeTableCellsSchema.parse(input)).toThrow();
  });

  it('should reject negative row index', () => {
    const input = {
      presentationId: 'presentation123',
      objectId: 'table456',
      tableRange: {
        location: {
          rowIndex: -1,
          columnIndex: 0
        }
      }
    };
    expect(() => SlidesUnmergeTableCellsSchema.parse(input)).toThrow();
  });

  it('should reject missing presentationId', () => {
    const input = {
      objectId: 'table456',
      tableRange: {
        location: {
          rowIndex: 0,
          columnIndex: 0
        }
      }
    };
    expect(() => SlidesUnmergeTableCellsSchema.parse(input)).toThrow(/Required/);
  });

  it('should reject empty objectId', () => {
    const input = {
      presentationId: 'presentation123',
      objectId: '',
      tableRange: {
        location: {
          rowIndex: 0,
          columnIndex: 0
        }
      }
    };
    expect(() => SlidesUnmergeTableCellsSchema.parse(input)).toThrow(/Table object ID is required/);
  });

  it('should reject missing tableRange', () => {
    const input = {
      presentationId: 'presentation123',
      objectId: 'table456'
    };
    expect(() => SlidesUnmergeTableCellsSchema.parse(input)).toThrow(/Required/);
  });
});
