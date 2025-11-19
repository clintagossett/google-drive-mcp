import { describe, it, expect } from 'vitest';
import { z } from 'zod';

const DriveUpdatePermissionSchema = z.object({
  fileId: z.string().min(1, "File ID is required"),
  permissionId: z.string().min(1, "Permission ID is required"),
  role: z.enum(["owner", "organizer", "fileOrganizer", "writer", "commenter", "reader"]),
  removeExpiration: z.boolean().optional(),
  transferOwnership: z.boolean().optional(),
  supportsAllDrives: z.boolean().optional()
});

describe('drive_updatePermission - Unit Tests', () => {
  it('should validate minimal input', () => {
    const result = DriveUpdatePermissionSchema.safeParse({
      fileId: 'file-123',
      permissionId: 'perm-456',
      role: 'writer'
    });
    expect(result.success).toBe(true);
  });

  it('should validate all role types', () => {
    const roles = ["owner", "organizer", "fileOrganizer", "writer", "commenter", "reader"];
    roles.forEach(role => {
      const result = DriveUpdatePermissionSchema.safeParse({
        fileId: 'file-123',
        permissionId: 'perm-456',
        role
      });
      expect(result.success).toBe(true);
    });
  });

  it('should validate with removeExpiration', () => {
    const result = DriveUpdatePermissionSchema.safeParse({
      fileId: 'file-123',
      permissionId: 'perm-456',
      role: 'reader',
      removeExpiration: true
    });
    expect(result.success).toBe(true);
  });

  it('should validate with transferOwnership', () => {
    const result = DriveUpdatePermissionSchema.safeParse({
      fileId: 'file-123',
      permissionId: 'perm-456',
      role: 'owner',
      transferOwnership: true
    });
    expect(result.success).toBe(true);
  });

  it('should validate with supportsAllDrives', () => {
    const result = DriveUpdatePermissionSchema.safeParse({
      fileId: 'file-123',
      permissionId: 'perm-456',
      role: 'writer',
      supportsAllDrives: true
    });
    expect(result.success).toBe(true);
  });

  it('should reject missing role', () => {
    const result = DriveUpdatePermissionSchema.safeParse({
      fileId: 'file-123',
      permissionId: 'perm-456'
    });
    expect(result.success).toBe(false);
  });

  it('should reject invalid role', () => {
    const result = DriveUpdatePermissionSchema.safeParse({
      fileId: 'file-123',
      permissionId: 'perm-456',
      role: 'invalid'
    });
    expect(result.success).toBe(false);
  });

  it('should reject missing fileId', () => {
    const result = DriveUpdatePermissionSchema.safeParse({
      permissionId: 'perm-456',
      role: 'writer'
    });
    expect(result.success).toBe(false);
  });

  it('should reject missing permissionId', () => {
    const result = DriveUpdatePermissionSchema.safeParse({
      fileId: 'file-123',
      role: 'writer'
    });
    expect(result.success).toBe(false);
  });
});
