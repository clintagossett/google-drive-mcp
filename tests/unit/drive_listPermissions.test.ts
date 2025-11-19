import { describe, it, expect } from 'vitest';
import { z } from 'zod';

const DriveListPermissionsSchema = z.object({
  fileId: z.string().min(1, "File ID is required"),
  pageSize: z.number().min(1).max(100).optional(),
  pageToken: z.string().optional(),
  fields: z.string().optional(),
  supportsAllDrives: z.boolean().optional()
});

describe('drive_listPermissions - Unit Tests', () => {
  it('should validate minimal input', () => {
    const result = DriveListPermissionsSchema.safeParse({
      fileId: 'file-123'
    });
    expect(result.success).toBe(true);
  });

  it('should validate with pageSize', () => {
    const result = DriveListPermissionsSchema.safeParse({
      fileId: 'file-123',
      pageSize: 50
    });
    expect(result.success).toBe(true);
  });

  it('should validate with pageToken', () => {
    const result = DriveListPermissionsSchema.safeParse({
      fileId: 'file-123',
      pageToken: 'token-abc'
    });
    expect(result.success).toBe(true);
  });

  it('should validate with fields', () => {
    const result = DriveListPermissionsSchema.safeParse({
      fileId: 'file-123',
      fields: 'permissions(id,role,emailAddress)'
    });
    expect(result.success).toBe(true);
  });

  it('should validate with supportsAllDrives', () => {
    const result = DriveListPermissionsSchema.safeParse({
      fileId: 'file-123',
      supportsAllDrives: true
    });
    expect(result.success).toBe(true);
  });

  it('should reject pageSize below 1', () => {
    const result = DriveListPermissionsSchema.safeParse({
      fileId: 'file-123',
      pageSize: 0
    });
    expect(result.success).toBe(false);
  });

  it('should reject pageSize above 100', () => {
    const result = DriveListPermissionsSchema.safeParse({
      fileId: 'file-123',
      pageSize: 101
    });
    expect(result.success).toBe(false);
  });

  it('should reject missing fileId', () => {
    const result = DriveListPermissionsSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});
