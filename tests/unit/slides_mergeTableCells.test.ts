import { describe, it, expect } from 'vitest';
import { z } from 'zod';

const SlidesMergeTableCellsSchema = z.object({
  presentationId: z.string().min(1, "Presentation ID is required"),
  objectId: z.string().min(1, "Table object ID is required"),
  tableRange: z.object({
    location: z.object({
      rowIndex: z.number().min(0),
      columnIndex: z.number().min(0)
    }),
    rowSpan: z.number().min(1),
    columnSpan: z.number().min(1)
  })
});

describe('slides_mergeTableCells Schema Validation', () => {
  it('should validate 2x2 cell merge', () => {
    const input = {
      presentationId: 'presentation123',
      objectId: 'table456',
      tableRange: {
        location: {
          rowIndex: 0,
          columnIndex: 0
        },
        rowSpan: 2,
        columnSpan: 2
      }
    };
    expect(() => SlidesMergeTableCellsSchema.parse(input)).not.toThrow();
  });

  it('should validate single row merge (3 columns)', () => {
    const input = {
      presentationId: 'presentation123',
      objectId: 'table456',
      tableRange: {
        location: {
          rowIndex: 1,
          columnIndex: 0
        },
        rowSpan: 1,
        columnSpan: 3
      }
    };
    expect(() => SlidesMergeTableCellsSchema.parse(input)).not.toThrow();
  });

  it('should validate single column merge (4 rows)', () => {
    const input = {
      presentationId: 'presentation123',
      objectId: 'table456',
      tableRange: {
        location: {
          rowIndex: 0,
          columnIndex: 1
        },
        rowSpan: 4,
        columnSpan: 1
      }
    };
    expect(() => SlidesMergeTableCellsSchema.parse(input)).not.toThrow();
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
        rowSpan: 0,
        columnSpan: 2
      }
    };
    expect(() => SlidesMergeTableCellsSchema.parse(input)).toThrow();
  });

  it('should reject zero columnSpan', () => {
    const input = {
      presentationId: 'presentation123',
      objectId: 'table456',
      tableRange: {
        location: {
          rowIndex: 0,
          columnIndex: 0
        },
        rowSpan: 2,
        columnSpan: 0
      }
    };
    expect(() => SlidesMergeTableCellsSchema.parse(input)).toThrow();
  });

  it('should reject missing presentationId', () => {
    const input = {
      objectId: 'table456',
      tableRange: {
        location: {
          rowIndex: 0,
          columnIndex: 0
        },
        rowSpan: 2,
        columnSpan: 2
      }
    };
    expect(() => SlidesMergeTableCellsSchema.parse(input)).toThrow(/Required/);
  });

  it('should reject missing tableRange', () => {
    const input = {
      presentationId: 'presentation123',
      objectId: 'table456'
    };
    expect(() => SlidesMergeTableCellsSchema.parse(input)).toThrow(/Required/);
  });
});
