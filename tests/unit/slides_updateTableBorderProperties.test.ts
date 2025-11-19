import { describe, it, expect } from 'vitest';
import { z } from 'zod';

const SlidesUpdateTableBorderPropertiesSchema = z.object({
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
  borderPosition: z.enum(['ALL', 'BOTTOM', 'INNER', 'INNER_HORIZONTAL', 'INNER_VERTICAL', 'LEFT', 'OUTER', 'RIGHT', 'TOP']),
  tableBorderProperties: z.object({
    tableBorderFill: z.object({
      solidFill: z.object({
        color: z.object({
          red: z.number().min(0).max(1).optional(),
          green: z.number().min(0).max(1).optional(),
          blue: z.number().min(0).max(1).optional()
        }),
        alpha: z.number().min(0).max(1).optional()
      }).optional()
    }).optional(),
    weight: z.object({
      magnitude: z.number().min(0),
      unit: z.enum(['EMU', 'PT'])
    }).optional(),
    dashStyle: z.enum(['SOLID', 'DOT', 'DASH', 'DASH_DOT', 'LONG_DASH', 'LONG_DASH_DOT']).optional()
  }).optional()
});

describe('slides_updateTableBorderProperties Schema Validation', () => {
  it('should validate with ALL border position', () => {
    const input = {
      presentationId: 'presentation123',
      objectId: 'table456',
      tableRange: {
        location: {
          rowIndex: 0,
          columnIndex: 0
        }
      },
      borderPosition: 'ALL' as const
    };
    expect(() => SlidesUpdateTableBorderPropertiesSchema.parse(input)).not.toThrow();
  });

  it('should validate with INNER_HORIZONTAL border', () => {
    const input = {
      presentationId: 'presentation123',
      objectId: 'table456',
      tableRange: {
        location: {
          rowIndex: 0,
          columnIndex: 0
        }
      },
      borderPosition: 'INNER_HORIZONTAL' as const
    };
    expect(() => SlidesUpdateTableBorderPropertiesSchema.parse(input)).not.toThrow();
  });

  it('should validate with border color and weight', () => {
    const input = {
      presentationId: 'presentation123',
      objectId: 'table456',
      tableRange: {
        location: {
          rowIndex: 0,
          columnIndex: 0
        }
      },
      borderPosition: 'OUTER' as const,
      tableBorderProperties: {
        tableBorderFill: {
          solidFill: {
            color: {
              red: 0.0,
              green: 0.0,
              blue: 0.0
            },
            alpha: 1.0
          }
        },
        weight: {
          magnitude: 10000,
          unit: 'EMU' as const
        }
      }
    };
    expect(() => SlidesUpdateTableBorderPropertiesSchema.parse(input)).not.toThrow();
  });

  it('should validate with dashStyle', () => {
    const input = {
      presentationId: 'presentation123',
      objectId: 'table456',
      tableRange: {
        location: {
          rowIndex: 0,
          columnIndex: 0
        }
      },
      borderPosition: 'TOP' as const,
      tableBorderProperties: {
        dashStyle: 'DASH' as const
      }
    };
    expect(() => SlidesUpdateTableBorderPropertiesSchema.parse(input)).not.toThrow();
  });

  it('should reject invalid border position', () => {
    const input = {
      presentationId: 'presentation123',
      objectId: 'table456',
      tableRange: {
        location: {
          rowIndex: 0,
          columnIndex: 0
        }
      },
      borderPosition: 'INVALID'
    };
    expect(() => SlidesUpdateTableBorderPropertiesSchema.parse(input)).toThrow();
  });

  it('should reject missing borderPosition', () => {
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
    expect(() => SlidesUpdateTableBorderPropertiesSchema.parse(input)).toThrow(/Required/);
  });

  it('should reject missing presentationId', () => {
    const input = {
      objectId: 'table456',
      tableRange: {
        location: {
          rowIndex: 0,
          columnIndex: 0
        }
      },
      borderPosition: 'ALL'
    };
    expect(() => SlidesUpdateTableBorderPropertiesSchema.parse(input)).toThrow(/Required/);
  });
});
