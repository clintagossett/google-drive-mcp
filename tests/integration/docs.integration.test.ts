/**
 * Google Docs API Integration Tests
 *
 * Tests Docs API operations against real documents in Shared Drive.
 *
 * Run with: npm run test:integration:docs
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

describe('Docs API Integration Tests', () => {
  let context: TestContext;
  let testDocId: string;

  beforeAll(async () => {
    console.log('\n🚀 Initializing Docs API integration tests...\n');
    context = await initializeTestContext();
    await validateSharedDriveAccess(context);
    await cleanupOrphanedTestFiles(context);

    // Create a test document
    const fileName = generateTestFileName('docs_test', 'gdoc');
    const response = await context.drive.files.create({
      requestBody: {
        name: fileName,
        mimeType: 'application/vnd.google-apps.document',
        parents: [context.config.sharedDrive.testFolderId]
      },
      fields: 'id',
      supportsAllDrives: true
    });

    testDocId = response.data.id;
    trackCreatedFile(context, testDocId);
  }, 30000);

  afterAll(async () => {
    console.log('\n🧹 Cleaning up test files...\n');
    await cleanupTestFiles(context);
  }, 30000);

  describe('Document Structure', () => {
    test('should get document content', async () => {
      const response = await context.docs.documents.get({
        documentId: testDocId
      });

      const doc = response.data;

      expect(doc.documentId).toBe(testDocId);
      expect(doc.title).toBeDefined();
      expect(doc.body).toBeDefined();
      expect(doc.body.content).toBeDefined();
    });
  });

  describe('Content Manipulation', () => {
    test('should insert a table', async () => {
      const requests = [
        {
          insertTable: {
            rows: 3,
            columns: 2,
            location: {
              index: 1
            }
          }
        }
      ];

      const response = await context.docs.documents.batchUpdate({
        documentId: testDocId,
        requestBody: { requests }
      });

      expect(response.data.replies).toBeDefined();
      expect(response.data.replies[0]).toBeDefined();
    });

    test('should insert a page break', async () => {
      // Get current end index
      const docResponse = await context.docs.documents.get({
        documentId: testDocId
      });
      const endIndex = docResponse.data.body.content[docResponse.data.body.content.length - 1].endIndex;

      const requests = [
        {
          insertPageBreak: {
            location: {
              index: endIndex - 1
            }
          }
        }
      ];

      const response = await context.docs.documents.batchUpdate({
        documentId: testDocId,
        requestBody: { requests }
      });

      expect(response.data.replies).toBeDefined();
    });
  });

  describe('Formatting', () => {
    test('should update paragraph style', async () => {
      const requests = [
        {
          updateParagraphStyle: {
            range: {
              startIndex: 1,
              endIndex: 2
            },
            paragraphStyle: {
              namedStyleType: 'HEADING_1'
            },
            fields: 'namedStyleType'
          }
        }
      ];

      const response = await context.docs.documents.batchUpdate({
        documentId: testDocId,
        requestBody: { requests }
      });

      expect(response.data.replies).toBeDefined();
    });
  });

  describe('Document Metadata', () => {
    test('should verify document is in Shared Drive', async () => {
      const fileResponse = await context.drive.files.get({
        fileId: testDocId,
        fields: 'id,name,driveId,capabilities',
        supportsAllDrives: true
      });

      const file = fileResponse.data;

      expect(file.driveId).toBeDefined();
      expect(file.capabilities.canEdit).toBe(true);
    });
  });
});
