/**
 * Google Drive API Integration Tests
 *
 * Tests Drive API operations against a real Shared Drive folder.
 * These tests create, modify, and delete real files.
 *
 * Prerequisites:
 * - Configure test-config.json with your Shared Drive folder ID
 * - Authenticate with OAuth (run MCP server first)
 *
 * Run with: npm run test:integration:drive
 */

import {
  initializeTestContext,
  validateSharedDriveAccess,
  generateTestFileName,
  trackCreatedFile,
  cleanupTestFiles,
  cleanupOrphanedTestFiles,
  TestContext
} from './setup';

describe('Drive API Integration Tests', () => {
  let context: TestContext;
  let testFolderId: string;

  beforeAll(async () => {
    console.log('\n🚀 Initializing Drive API integration tests...\n');
    context = await initializeTestContext();
    await validateSharedDriveAccess(context);
    await cleanupOrphanedTestFiles(context);
  }, 30000);

  afterAll(async () => {
    console.log('\n🧹 Cleaning up test files...\n');
    await cleanupTestFiles(context);
  }, 30000);

  describe('Folder Operations', () => {
    test('should create a folder in Shared Drive', async () => {
      const folderName = generateTestFileName('folder', 'dir');

      const response = await context.drive.files.create({
        requestBody: {
          name: folderName,
          mimeType: 'application/vnd.google-apps.folder',
          parents: [context.config.sharedDrive.testFolderId]
        },
        fields: 'id,name,mimeType,parents,driveId',
        supportsAllDrives: true
      });

      const folder = response.data;
      testFolderId = folder.id;
      trackCreatedFile(context, folder.id);

      expect(folder.id).toBeDefined();
      expect(folder.name).toBe(folderName);
      expect(folder.mimeType).toBe('application/vnd.google-apps.folder');
      expect(folder.parents).toContain(context.config.sharedDrive.testFolderId);
      expect(folder.driveId).toBeDefined(); // Confirms it's in a Shared Drive
    });

    test('should list files in Shared Drive folder', async () => {
      const response = await context.drive.files.list({
        q: `'${context.config.sharedDrive.testFolderId}' in parents and trashed=false`,
        fields: 'files(id,name,mimeType)',
        includeItemsFromAllDrives: true,
        supportsAllDrives: true
      });

      expect(response.data.files).toBeDefined();
      expect(Array.isArray(response.data.files)).toBe(true);
      // Should find at least the folder we just created
      expect(response.data.files.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('File Operations', () => {
    test('should create a Google Doc in Shared Drive', async () => {
      const fileName = generateTestFileName('document', 'gdoc');

      const response = await context.drive.files.create({
        requestBody: {
          name: fileName,
          mimeType: 'application/vnd.google-apps.document',
          parents: [context.config.sharedDrive.testFolderId]
        },
        fields: 'id,name,mimeType,parents,createdTime',
        supportsAllDrives: true
      });

      const file = response.data;
      trackCreatedFile(context, file.id);

      expect(file.id).toBeDefined();
      expect(file.name).toBe(fileName);
      expect(file.mimeType).toBe('application/vnd.google-apps.document');
      expect(file.createdTime).toBeDefined();
    });

    test('should get file metadata with supportsAllDrives', async () => {
      // Use the last created file
      const fileId = context.createdFiles[context.createdFiles.length - 1];

      const response = await context.drive.files.get({
        fileId,
        fields: 'id,name,mimeType,capabilities,driveId',
        supportsAllDrives: true
      });

      const file = response.data;

      expect(file.id).toBe(fileId);
      expect(file.driveId).toBeDefined();
      expect(file.capabilities).toBeDefined();
    });

    test('should update file metadata', async () => {
      const fileId = context.createdFiles[context.createdFiles.length - 1];
      const newName = generateTestFileName('updated_document', 'gdoc');

      const response = await context.drive.files.update({
        fileId,
        requestBody: {
          name: newName,
          description: 'Updated via integration test'
        },
        fields: 'id,name,description,modifiedTime',
        supportsAllDrives: true
      });

      const file = response.data;

      expect(file.name).toBe(newName);
      expect(file.description).toBe('Updated via integration test');
      expect(file.modifiedTime).toBeDefined();
    });

    test('should copy file in Shared Drive', async () => {
      const sourceFileId = context.createdFiles[context.createdFiles.length - 1];
      const copyName = generateTestFileName('copy', 'gdoc');

      const response = await context.drive.files.copy({
        fileId: sourceFileId,
        requestBody: {
          name: copyName,
          parents: [context.config.sharedDrive.testFolderId]
        },
        fields: 'id,name,mimeType,parents',
        supportsAllDrives: true
      });

      const copiedFile = response.data;
      trackCreatedFile(context, copiedFile.id);

      expect(copiedFile.id).toBeDefined();
      expect(copiedFile.id).not.toBe(sourceFileId);
      expect(copiedFile.name).toBe(copyName);
    });

    test('should move file to test subfolder', async () => {
      const fileId = context.createdFiles[context.createdFiles.length - 1];
      const currentParents = context.config.sharedDrive.testFolderId;

      const response = await context.drive.files.update({
        fileId,
        addParents: testFolderId,
        removeParents: currentParents,
        fields: 'id,parents',
        supportsAllDrives: true
      });

      const file = response.data;

      expect(file.parents).toContain(testFolderId);
      expect(file.parents).not.toContain(currentParents);
    });

    test('should delete file from Shared Drive', async () => {
      const fileToDelete = context.createdFiles.pop()!;

      await context.drive.files.delete({
        fileId: fileToDelete,
        supportsAllDrives: true
      });

      // Verify file is deleted by trying to get it
      await expect(
        context.drive.files.get({
          fileId: fileToDelete,
          supportsAllDrives: true
        })
      ).rejects.toThrow();
    });
  });

  describe('Search and Query', () => {
    test('should search files by name pattern', async () => {
      const response = await context.drive.files.list({
        q: `name contains 'TEST_' and '${context.config.sharedDrive.testFolderId}' in parents and trashed=false`,
        fields: 'files(id,name)',
        includeItemsFromAllDrives: true,
        supportsAllDrives: true
      });

      expect(response.data.files).toBeDefined();
      expect(response.data.files.length).toBeGreaterThan(0);
      response.data.files.forEach((file: any) => {
        expect(file.name).toContain('TEST_');
      });
    });

    test('should filter by MIME type', async () => {
      const response = await context.drive.files.list({
        q: `mimeType='application/vnd.google-apps.folder' and '${context.config.sharedDrive.testFolderId}' in parents and trashed=false`,
        fields: 'files(id,name,mimeType)',
        includeItemsFromAllDrives: true,
        supportsAllDrives: true
      });

      expect(response.data.files).toBeDefined();
      response.data.files.forEach((file: any) => {
        expect(file.mimeType).toBe('application/vnd.google-apps.folder');
      });
    });
  });

  describe('Permissions', () => {
    test('should verify capabilities for Shared Drive files', async () => {
      const fileId = context.createdFiles[0];

      const response = await context.drive.files.get({
        fileId,
        fields: 'capabilities',
        supportsAllDrives: true
      });

      const capabilities = response.data.capabilities;

      expect(capabilities).toBeDefined();
      expect(capabilities.canEdit).toBeDefined();
      expect(capabilities.canDelete).toBeDefined();
      expect(capabilities.canShare).toBeDefined();
    });
  });
});
