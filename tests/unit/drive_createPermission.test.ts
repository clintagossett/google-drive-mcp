import { describe, it, expect } from 'vitest';
import { z } from 'zod';

const DriveCreatePermissionSchema = z.object({
  fileId: z.string().min(1, "File ID is required"),
  role: z.enum(["owner", "organizer", "fileOrganizer", "writer", "commenter", "reader"]),
  type: z.enum(["user", "group", "domain", "anyone"]),
  emailAddress: z.string().email().optional(),
  domain: z.string().optional(),
  sendNotificationEmail: z.boolean().optional(),
  emailMessage: z.string().optional(),
  supportsAllDrives: z.boolean().optional()
});

describe('drive_createPermission - Unit Tests', () => {
  it('should validate minimal user permission', () => {
    const result = DriveCreatePermissionSchema.safeParse({
      fileId: 'file-123',
      role: 'reader',
      type: 'user',
      emailAddress: 'user@example.com'
    });
    expect(result.success).toBe(true);
  });

  it('should validate all role types', () => {
    const roles = ["owner", "organizer", "fileOrganizer", "writer", "commenter", "reader"];
    roles.forEach(role => {
      const result = DriveCreatePermissionSchema.safeParse({
        fileId: 'file-123',
        role,
        type: 'user',
        emailAddress: 'user@example.com'
      });
      expect(result.success).toBe(true);
    });
  });

  it('should validate all permission types', () => {
    const result1 = DriveCreatePermissionSchema.safeParse({
      fileId: 'file-123',
      role: 'reader',
      type: 'user',
      emailAddress: 'user@example.com'
    });
    expect(result1.success).toBe(true);

    const result2 = DriveCreatePermissionSchema.safeParse({
      fileId: 'file-123',
      role: 'reader',
      type: 'group',
      emailAddress: 'group@example.com'
    });
    expect(result2.success).toBe(true);

    const result3 = DriveCreatePermissionSchema.safeParse({
      fileId: 'file-123',
      role: 'reader',
      type: 'domain',
      domain: 'example.com'
    });
    expect(result3.success).toBe(true);

    const result4 = DriveCreatePermissionSchema.safeParse({
      fileId: 'file-123',
      role: 'reader',
      type: 'anyone'
    });
    expect(result4.success).toBe(true);
  });

  it('should validate with notification options', () => {
    const result = DriveCreatePermissionSchema.safeParse({
      fileId: 'file-123',
      role: 'writer',
      type: 'user',
      emailAddress: 'user@example.com',
      sendNotificationEmail: true,
      emailMessage: 'Check out this document!'
    });
    expect(result.success).toBe(true);
  });

  it('should validate with supportsAllDrives', () => {
    const result = DriveCreatePermissionSchema.safeParse({
      fileId: 'file-123',
      role: 'reader',
      type: 'user',
      emailAddress: 'user@example.com',
      supportsAllDrives: true
    });
    expect(result.success).toBe(true);
  });

  it('should reject missing fileId', () => {
    const result = DriveCreatePermissionSchema.safeParse({
      role: 'reader',
      type: 'user',
      emailAddress: 'user@example.com'
    });
    expect(result.success).toBe(false);
  });

  it('should reject invalid role', () => {
    const result = DriveCreatePermissionSchema.safeParse({
      fileId: 'file-123',
      role: 'invalid',
      type: 'user',
      emailAddress: 'user@example.com'
    });
    expect(result.success).toBe(false);
  });

  it('should reject invalid type', () => {
    const result = DriveCreatePermissionSchema.safeParse({
      fileId: 'file-123',
      role: 'reader',
      type: 'invalid',
      emailAddress: 'user@example.com'
    });
    expect(result.success).toBe(false);
  });

  it('should reject invalid email format', () => {
    const result = DriveCreatePermissionSchema.safeParse({
      fileId: 'file-123',
      role: 'reader',
      type: 'user',
      emailAddress: 'not-an-email'
    });
    expect(result.success).toBe(false);
  });
});
