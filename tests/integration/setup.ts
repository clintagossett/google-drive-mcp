/**
 * Integration Test Setup Utilities
 *
 * Provides helper functions for:
 * - Loading test configuration
 * - Validating Shared Drive access
 * - Creating and cleaning up test resources
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { google } from 'googleapis';

export interface TestConfig {
  sharedDrive: {
    testFolderId: string;
    testFolderName: string;
    description?: string;
  };
  testSettings: {
    cleanupAfterTests: boolean;
    preserveTestArtifacts: boolean;
    verbose: boolean;
    testFilePrefix: string;
    maxTestRuntime: number;
  };
  oauth: {
    credentialsPath: string;
  };
}

export interface TestContext {
  config: TestConfig;
  drive: any;
  docs: any;
  sheets: any;
  slides: any;
  createdFiles: string[];
}

/**
 * Load test configuration from test-config.json
 */
export function loadTestConfig(): TestConfig {
  const configPath = join(__dirname, 'test-config.json');

  if (!existsSync(configPath)) {
    throw new Error(
      'Integration test configuration not found!\n' +
      'Please copy test-config.template.json to test-config.json and configure your Shared Drive folder ID.\n' +
      `Expected config at: ${configPath}`
    );
  }

  const configContent = readFileSync(configPath, 'utf-8');
  const config = JSON.parse(configContent) as TestConfig;

  // Validate configuration
  if (config.sharedDrive.testFolderId === 'REPLACE_WITH_YOUR_SHARED_DRIVE_FOLDER_ID') {
    throw new Error(
      'Please configure your Shared Drive folder ID in test-config.json!\n' +
      'Replace REPLACE_WITH_YOUR_SHARED_DRIVE_FOLDER_ID with your actual Shared Drive folder ID.'
    );
  }

  return config;
}

/**
 * Initialize test context with authenticated Google API clients
 */
export async function initializeTestContext(): Promise<TestContext> {
  const config = loadTestConfig();

  // Load OAuth credentials
  const auth = new google.auth.OAuth2();
  const tokenPath = config.oauth.credentialsPath.replace('~', process.env.HOME || '');

  if (!existsSync(tokenPath)) {
    throw new Error(
      `OAuth tokens not found at ${tokenPath}\n` +
      'Please authenticate the MCP server first: npm run build && <test with Claude Code>'
    );
  }

  const tokens = JSON.parse(readFileSync(tokenPath, 'utf-8'));
  auth.setCredentials(tokens);

  // Initialize API clients
  const drive = google.drive({ version: 'v3', auth });
  const docs = google.docs({ version: 'v1', auth });
  const sheets = google.sheets({ version: 'v4', auth });
  const slides = google.slides({ version: 'v1', auth });

  return {
    config,
    drive,
    docs,
    sheets,
    slides,
    createdFiles: []
  };
}

/**
 * Validate Shared Drive access
 */
export async function validateSharedDriveAccess(context: TestContext): Promise<void> {
  const { drive, config } = context;

  try {
    const response = await drive.files.get({
      fileId: config.sharedDrive.testFolderId,
      fields: 'id,name,mimeType,capabilities,driveId',
      supportsAllDrives: true
    });

    const folder = response.data;

    if (folder.mimeType !== 'application/vnd.google-apps.folder') {
      throw new Error(`Configured ID is not a folder: ${folder.mimeType}`);
    }

    if (!folder.driveId) {
      throw new Error('Configured folder is not in a Shared Drive');
    }

    if (!folder.capabilities?.canAddChildren) {
      throw new Error('No permission to create files in this folder');
    }

    if (config.testSettings.verbose) {
      console.log('✓ Shared Drive access validated');
      console.log(`  Folder: ${folder.name}`);
      console.log(`  Drive ID: ${folder.driveId}`);
      console.log(`  Permissions: canAddChildren=${folder.capabilities.canAddChildren}, canDelete=${folder.capabilities.canDelete}`);
    }
  } catch (error: any) {
    throw new Error(
      `Failed to access Shared Drive folder: ${error.message}\n` +
      `Folder ID: ${config.sharedDrive.testFolderId}\n` +
      'Please verify the folder ID and permissions.'
    );
  }
}

/**
 * Generate a unique test file name
 */
export function generateTestFileName(prefix: string, extension: string): string {
  const timestamp = Date.now();
  return `TEST_${prefix}_${timestamp}.${extension}`;
}

/**
 * Track created file for cleanup
 */
export function trackCreatedFile(context: TestContext, fileId: string): void {
  context.createdFiles.push(fileId);
}

/**
 * Clean up all created test files
 */
export async function cleanupTestFiles(context: TestContext): Promise<void> {
  if (!context.config.testSettings.cleanupAfterTests) {
    if (context.config.testSettings.verbose) {
      console.log('⚠ Cleanup skipped (cleanupAfterTests=false)');
      console.log(`  ${context.createdFiles.length} test files left in folder`);
    }
    return;
  }

  const { drive, createdFiles } = context;
  let deleted = 0;
  let failed = 0;

  for (const fileId of createdFiles) {
    try {
      await drive.files.delete({
        fileId,
        supportsAllDrives: true
      });
      deleted++;
    } catch (error: any) {
      failed++;
      if (context.config.testSettings.verbose) {
        console.warn(`  ⚠ Failed to delete ${fileId}: ${error.message}`);
      }
    }
  }

  if (context.config.testSettings.verbose) {
    console.log(`✓ Cleanup complete: ${deleted} deleted, ${failed} failed`);
  }
}

/**
 * Clean up orphaned test files from previous test runs
 */
export async function cleanupOrphanedTestFiles(context: TestContext): Promise<void> {
  const { drive, config } = context;

  try {
    const response = await drive.files.list({
      q: `'${config.sharedDrive.testFolderId}' in parents and name contains '${config.testSettings.testFilePrefix}' and trashed=false`,
      fields: 'files(id,name,createdTime)',
      includeItemsFromAllDrives: true,
      supportsAllDrives: true
    });

    const orphanedFiles = response.data.files || [];

    if (orphanedFiles.length === 0) {
      if (config.testSettings.verbose) {
        console.log('✓ No orphaned test files found');
      }
      return;
    }

    if (config.testSettings.verbose) {
      console.log(`⚠ Found ${orphanedFiles.length} orphaned test files`);
    }

    let deleted = 0;
    for (const file of orphanedFiles) {
      try {
        await drive.files.delete({
          fileId: file.id,
          supportsAllDrives: true
        });
        deleted++;
      } catch (error: any) {
        if (config.testSettings.verbose) {
          console.warn(`  ⚠ Failed to delete orphaned file ${file.name}: ${error.message}`);
        }
      }
    }

    if (config.testSettings.verbose) {
      console.log(`✓ Cleaned up ${deleted}/${orphanedFiles.length} orphaned files`);
    }
  } catch (error: any) {
    if (config.testSettings.verbose) {
      console.warn(`⚠ Failed to cleanup orphaned files: ${error.message}`);
    }
  }
}
