import { describe, it, expect } from 'vitest';
import { z } from 'zod';

const SlidesUpdateTableCellPropertiesSchema = z.object({
  presentationId: z.string().min(1, "Presentation ID is required"),
  objectId: z.string().min(1, "Table object ID is required"),
  tableRange: z.object({
    location: z.object({
      rowIndex: z.number().min(0),
      columnIndex: z.number().min(0)
    }),
    rowSpan: z.number().min(1).optional(),
    columnSpan: z.number().min(1).optional()
  }),
  tableCellProperties: z.object({
    tableCellBackgroundFill: z.object({
      solidFill: z.object({
        color: z.object({
          red: z.number().min(0).max(1).optional(),
          green: z.number().min(0).max(1).optional(),
          blue: z.number().min(0).max(1).optional()
        }),
        alpha: z.number().min(0).max(1).optional()
      }).optional()
    }).optional(),
    contentAlignment: z.enum(['TOP', 'MIDDLE', 'BOTTOM']).optional()
  }).optional()
});

describe('slides_updateTableCellProperties Schema Validation', () => {
  it('should validate minimal valid input', () => {
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
    expect(() => SlidesUpdateTableCellPropertiesSchema.parse(input)).not.toThrow();
  });

  it('should validate with background fill', () => {
    const input = {
      presentationId: 'presentation123',
      objectId: 'table456',
      tableRange: {
        location: {
          rowIndex: 0,
          columnIndex: 0
        }
      },
      tableCellProperties: {
        tableCellBackgroundFill: {
          solidFill: {
            color: {
              red: 1.0,
              green: 0.5,
              blue: 0.2
            },
            alpha: 0.8
          }
        }
      }
    };
    expect(() => SlidesUpdateTableCellPropertiesSchema.parse(input)).not.toThrow();
  });

  it('should validate with content alignment', () => {
    const input = {
      presentationId: 'presentation123',
      objectId: 'table456',
      tableRange: {
        location: {
          rowIndex: 0,
          columnIndex: 0
        }
      },
      tableCellProperties: {
        contentAlignment: 'MIDDLE' as const
      }
    };
    expect(() => SlidesUpdateTableCellPropertiesSchema.parse(input)).not.toThrow();
  });

  it('should validate with rowSpan and columnSpan', () => {
    const input = {
      presentationId: 'presentation123',
      objectId: 'table456',
      tableRange: {
        location: {
          rowIndex: 0,
          columnIndex: 0
        },
        rowSpan: 2,
        columnSpan: 3
      }
    };
    expect(() => SlidesUpdateTableCellPropertiesSchema.parse(input)).not.toThrow();
  });

  it('should reject invalid alignment', () => {
    const input = {
      presentationId: 'presentation123',
      objectId: 'table456',
      tableRange: {
        location: {
          rowIndex: 0,
          columnIndex: 0
        }
      },
      tableCellProperties: {
        contentAlignment: 'INVALID'
      }
    };
    expect(() => SlidesUpdateTableCellPropertiesSchema.parse(input)).toThrow();
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
    expect(() => SlidesUpdateTableCellPropertiesSchema.parse(input)).toThrow(/Required/);
  });

  it('should reject missing tableRange', () => {
    const input = {
      presentationId: 'presentation123',
      objectId: 'table456'
    };
    expect(() => SlidesUpdateTableCellPropertiesSchema.parse(input)).toThrow(/Required/);
  });
});
