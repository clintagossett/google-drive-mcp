import { describe, it, expect } from 'vitest';
import { z } from 'zod';

const DriveGetPermissionSchema = z.object({
  fileId: z.string().min(1, "File ID is required"),
  permissionId: z.string().min(1, "Permission ID is required"),
  fields: z.string().optional(),
  supportsAllDrives: z.boolean().optional()
});

describe('drive_getPermission - Unit Tests', () => {
  it('should validate minimal input', () => {
    const result = DriveGetPermissionSchema.safeParse({
      fileId: 'file-123',
      permissionId: 'perm-456'
    });
    expect(result.success).toBe(true);
  });

  it('should validate with fields', () => {
    const result = DriveGetPermissionSchema.safeParse({
      fileId: 'file-123',
      permissionId: 'perm-456',
      fields: 'id,role,emailAddress'
    });
    expect(result.success).toBe(true);
  });

  it('should validate with supportsAllDrives', () => {
    const result = DriveGetPermissionSchema.safeParse({
      fileId: 'file-123',
      permissionId: 'perm-456',
      supportsAllDrives: true
    });
    expect(result.success).toBe(true);
  });

  it('should reject missing fileId', () => {
    const result = DriveGetPermissionSchema.safeParse({
      permissionId: 'perm-456'
    });
    expect(result.success).toBe(false);
  });

  it('should reject missing permissionId', () => {
    const result = DriveGetPermissionSchema.safeParse({
      fileId: 'file-123'
    });
    expect(result.success).toBe(false);
  });

  it('should reject empty permissionId', () => {
    const result = DriveGetPermissionSchema.safeParse({
      fileId: 'file-123',
      permissionId: ''
    });
    expect(result.success).toBe(false);
  });
});
