import { describe, it, expect } from 'vitest';
import { z } from 'zod';

const SlidesInsertTableColumnsSchema = z.object({
  presentationId: z.string().min(1, "Presentation ID is required"),
  tableObjectId: z.string().min(1, "Table object ID is required"),
  cellLocation: z.object({
    rowIndex: z.number().min(0),
    columnIndex: z.number().min(0)
  }),
  insertRight: z.boolean(),
  number: z.number().min(1, "Number of columns must be at least 1").optional()
});

describe('slides_insertTableColumns Schema Validation', () => {
  it('should validate with insertRight true', () => {
    const input = {
      presentationId: 'presentation123',
      tableObjectId: 'table456',
      cellLocation: {
        rowIndex: 0,
        columnIndex: 0
      },
      insertRight: true
    };
    expect(() => SlidesInsertTableColumnsSchema.parse(input)).not.toThrow();
  });

  it('should validate with insertRight false', () => {
    const input = {
      presentationId: 'presentation123',
      tableObjectId: 'table456',
      cellLocation: {
        rowIndex: 1,
        columnIndex: 2
      },
      insertRight: false
    };
    expect(() => SlidesInsertTableColumnsSchema.parse(input)).not.toThrow();
  });

  it('should validate with number parameter', () => {
    const input = {
      presentationId: 'presentation123',
      tableObjectId: 'table456',
      cellLocation: {
        rowIndex: 0,
        columnIndex: 0
      },
      insertRight: true,
      number: 2
    };
    expect(() => SlidesInsertTableColumnsSchema.parse(input)).not.toThrow();
  });

  it('should reject zero columns', () => {
    const input = {
      presentationId: 'presentation123',
      tableObjectId: 'table456',
      cellLocation: {
        rowIndex: 0,
        columnIndex: 0
      },
      insertRight: true,
      number: 0
    };
    expect(() => SlidesInsertTableColumnsSchema.parse(input)).toThrow(/Number of columns must be at least 1/);
  });

  it('should reject negative columnIndex', () => {
    const input = {
      presentationId: 'presentation123',
      tableObjectId: 'table456',
      cellLocation: {
        rowIndex: 0,
        columnIndex: -1
      },
      insertRight: true
    };
    expect(() => SlidesInsertTableColumnsSchema.parse(input)).toThrow();
  });

  it('should reject missing presentationId', () => {
    const input = {
      tableObjectId: 'table456',
      cellLocation: {
        rowIndex: 0,
        columnIndex: 0
      },
      insertRight: true
    };
    expect(() => SlidesInsertTableColumnsSchema.parse(input)).toThrow(/Required/);
  });

  it('should reject empty tableObjectId', () => {
    const input = {
      presentationId: 'presentation123',
      tableObjectId: '',
      cellLocation: {
        rowIndex: 0,
        columnIndex: 0
      },
      insertRight: true
    };
    expect(() => SlidesInsertTableColumnsSchema.parse(input)).toThrow(/Table object ID is required/);
  });

  it('should reject missing cellLocation', () => {
    const input = {
      presentationId: 'presentation123',
      tableObjectId: 'table456',
      insertRight: true
    };
    expect(() => SlidesInsertTableColumnsSchema.parse(input)).toThrow(/Required/);
  });

  it('should reject missing insertRight', () => {
    const input = {
      presentationId: 'presentation123',
      tableObjectId: 'table456',
      cellLocation: {
        rowIndex: 0,
        columnIndex: 0
      }
    };
    expect(() => SlidesInsertTableColumnsSchema.parse(input)).toThrow(/Required/);
  });
});
