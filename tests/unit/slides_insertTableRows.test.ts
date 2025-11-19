import { describe, it, expect } from 'vitest';
import { z } from 'zod';

const SlidesInsertTableRowsSchema = z.object({
  presentationId: z.string().min(1, "Presentation ID is required"),
  tableObjectId: z.string().min(1, "Table object ID is required"),
  cellLocation: z.object({
    rowIndex: z.number().min(0),
    columnIndex: z.number().min(0)
  }),
  insertBelow: z.boolean(),
  number: z.number().min(1, "Number of rows must be at least 1").optional()
});

describe('slides_insertTableRows Schema Validation', () => {
  it('should validate with insertBelow true', () => {
    const input = {
      presentationId: 'presentation123',
      tableObjectId: 'table456',
      cellLocation: {
        rowIndex: 0,
        columnIndex: 0
      },
      insertBelow: true
    };
    expect(() => SlidesInsertTableRowsSchema.parse(input)).not.toThrow();
  });

  it('should validate with insertBelow false', () => {
    const input = {
      presentationId: 'presentation123',
      tableObjectId: 'table456',
      cellLocation: {
        rowIndex: 1,
        columnIndex: 2
      },
      insertBelow: false
    };
    expect(() => SlidesInsertTableRowsSchema.parse(input)).not.toThrow();
  });

  it('should validate with number parameter', () => {
    const input = {
      presentationId: 'presentation123',
      tableObjectId: 'table456',
      cellLocation: {
        rowIndex: 0,
        columnIndex: 0
      },
      insertBelow: true,
      number: 3
    };
    expect(() => SlidesInsertTableRowsSchema.parse(input)).not.toThrow();
  });

  it('should reject zero rows', () => {
    const input = {
      presentationId: 'presentation123',
      tableObjectId: 'table456',
      cellLocation: {
        rowIndex: 0,
        columnIndex: 0
      },
      insertBelow: true,
      number: 0
    };
    expect(() => SlidesInsertTableRowsSchema.parse(input)).toThrow(/Number of rows must be at least 1/);
  });

  it('should reject negative rowIndex', () => {
    const input = {
      presentationId: 'presentation123',
      tableObjectId: 'table456',
      cellLocation: {
        rowIndex: -1,
        columnIndex: 0
      },
      insertBelow: true
    };
    expect(() => SlidesInsertTableRowsSchema.parse(input)).toThrow();
  });

  it('should reject missing presentationId', () => {
    const input = {
      tableObjectId: 'table456',
      cellLocation: {
        rowIndex: 0,
        columnIndex: 0
      },
      insertBelow: true
    };
    expect(() => SlidesInsertTableRowsSchema.parse(input)).toThrow(/Required/);
  });

  it('should reject empty presentationId', () => {
    const input = {
      presentationId: '',
      tableObjectId: 'table456',
      cellLocation: {
        rowIndex: 0,
        columnIndex: 0
      },
      insertBelow: true
    };
    expect(() => SlidesInsertTableRowsSchema.parse(input)).toThrow(/Presentation ID is required/);
  });

  it('should reject missing tableObjectId', () => {
    const input = {
      presentationId: 'presentation123',
      cellLocation: {
        rowIndex: 0,
        columnIndex: 0
      },
      insertBelow: true
    };
    expect(() => SlidesInsertTableRowsSchema.parse(input)).toThrow(/Required/);
  });

  it('should reject missing cellLocation', () => {
    const input = {
      presentationId: 'presentation123',
      tableObjectId: 'table456',
      insertBelow: true
    };
    expect(() => SlidesInsertTableRowsSchema.parse(input)).toThrow(/Required/);
  });

  it('should reject missing insertBelow', () => {
    const input = {
      presentationId: 'presentation123',
      tableObjectId: 'table456',
      cellLocation: {
        rowIndex: 0,
        columnIndex: 0
      }
    };
    expect(() => SlidesInsertTableRowsSchema.parse(input)).toThrow(/Required/);
  });
});
