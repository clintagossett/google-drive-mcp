import { describe, it, expect } from 'vitest';
import { z } from 'zod';

const SlidesDeleteTableRowSchema = z.object({
  presentationId: z.string().min(1, "Presentation ID is required"),
  tableObjectId: z.string().min(1, "Table object ID is required"),
  cellLocation: z.object({
    rowIndex: z.number().min(0),
    columnIndex: z.number().min(0)
  })
});

describe('slides_deleteTableRow Schema Validation', () => {
  it('should validate valid input', () => {
    const input = {
      presentationId: 'presentation123',
      tableObjectId: 'table456',
      cellLocation: {
        rowIndex: 1,
        columnIndex: 0
      }
    };
    expect(() => SlidesDeleteTableRowSchema.parse(input)).not.toThrow();
  });

  it('should reject negative rowIndex', () => {
    const input = {
      presentationId: 'presentation123',
      tableObjectId: 'table456',
      cellLocation: {
        rowIndex: -1,
        columnIndex: 0
      }
    };
    expect(() => SlidesDeleteTableRowSchema.parse(input)).toThrow();
  });

  it('should reject missing presentationId', () => {
    const input = {
      tableObjectId: 'table456',
      cellLocation: {
        rowIndex: 0,
        columnIndex: 0
      }
    };
    expect(() => SlidesDeleteTableRowSchema.parse(input)).toThrow(/Required/);
  });

  it('should reject empty presentationId', () => {
    const input = {
      presentationId: '',
      tableObjectId: 'table456',
      cellLocation: {
        rowIndex: 0,
        columnIndex: 0
      }
    };
    expect(() => SlidesDeleteTableRowSchema.parse(input)).toThrow(/Presentation ID is required/);
  });

  it('should reject missing tableObjectId', () => {
    const input = {
      presentationId: 'presentation123',
      cellLocation: {
        rowIndex: 0,
        columnIndex: 0
      }
    };
    expect(() => SlidesDeleteTableRowSchema.parse(input)).toThrow(/Required/);
  });

  it('should reject missing cellLocation', () => {
    const input = {
      presentationId: 'presentation123',
      tableObjectId: 'table456'
    };
    expect(() => SlidesDeleteTableRowSchema.parse(input)).toThrow(/Required/);
  });
});
