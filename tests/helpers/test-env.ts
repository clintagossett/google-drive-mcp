/**
 * Test environment configuration
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env.test file
dotenv.config({ path: path.join(__dirname, '../../.env.test') });

export const TEST_CONFIG = {
  // OAuth-protected test resources
  oauthDocument: process.env.TEST_DOCUMENT_ID_OAUTH || '',
  oauthFolder: process.env.TEST_FOLDER_ID_OAUTH || '',
  oauthSpreadsheet: process.env.TEST_SPREADSHEET_ID_OAUTH || '',
  oauthPresentation: process.env.TEST_PRESENTATION_ID_OAUTH || '',

  // Public/service account test resources
  publicDocument: process.env.TEST_DOCUMENT_ID_PUBLIC || '',
  publicFolder: process.env.TEST_FOLDER_ID_PUBLIC || '',
  publicSpreadsheet: process.env.TEST_SPREADSHEET_ID_PUBLIC || '',
  publicPresentation: process.env.TEST_PRESENTATION_ID_PUBLIC || '',

  // OAuth credentials
  oauthCredentials: process.env.GOOGLE_DRIVE_OAUTH_CREDENTIALS || '',
  tokenPath: process.env.GOOGLE_DRIVE_MCP_TOKEN_PATH || '',

  // Service account credentials
  serviceAccountKey: process.env.GOOGLE_SERVICE_ACCOUNT_KEY || '',
  serviceAccountKeyPath: process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH || '',

  // Feature flags
  enableIntegrationTests: process.env.ENABLE_INTEGRATION_TESTS === 'true',
  enablePerformanceTests: process.env.ENABLE_PERFORMANCE_TESTS === 'true',

  // Server path
  serverPath: path.join(__dirname, '../../dist/index.js'),
};

/**
 * Check if integration tests should run
 */
export function shouldRunIntegrationTests(): boolean {
  return TEST_CONFIG.enableIntegrationTests && !!TEST_CONFIG.oauthDocument;
}

/**
 * Skip test if integration tests are not enabled
 */
export function skipIfNoIntegration() {
  if (!shouldRunIntegrationTests()) {
    console.warn('Skipping integration test - ENABLE_INTEGRATION_TESTS not set or test resources missing');
    return true;
  }
  return false;
}
