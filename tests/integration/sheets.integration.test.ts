/**
 * Google Sheets API Integration Tests
 *
 * Tests Sheets API operations against real spreadsheets in Shared Drive.
 *
 * Run with: npm run test:integration:sheets
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

describe('Sheets API Integration Tests', () => {
  let context: TestContext;
  let testSpreadsheetId: string;
  let testSheetId: number;

  beforeAll(async () => {
    console.log('\n🚀 Initializing Sheets API integration tests...\n');
    context = await initializeTestContext();
    await validateSharedDriveAccess(context);
    await cleanupOrphanedTestFiles(context);

    // Create a test spreadsheet
    const fileName = generateTestFileName('sheets_test', 'gsheet');
    const response = await context.sheets.spreadsheets.create({
      requestBody: {
        properties: {
          title: fileName
        }
      }
    });

    testSpreadsheetId = response.data.spreadsheetId;
    testSheetId = response.data.sheets[0].properties.sheetId;

    // Move to Shared Drive
    await context.drive.files.update({
      fileId: testSpreadsheetId,
      addParents: context.config.sharedDrive.testFolderId,
      fields: 'id,parents',
      supportsAllDrives: true
    });

    trackCreatedFile(context, testSpreadsheetId);
  }, 30000);

  afterAll(async () => {
    console.log('\n🧹 Cleaning up test files...\n');
    await cleanupTestFiles(context);
  }, 30000);

  describe('Spreadsheet Metadata', () => {
    test('should get spreadsheet properties', async () => {
      const response = await context.sheets.spreadsheets.get({
        spreadsheetId: testSpreadsheetId
      });

      const spreadsheet = response.data;

      expect(spreadsheet.spreadsheetId).toBe(testSpreadsheetId);
      expect(spreadsheet.properties).toBeDefined();
      expect(spreadsheet.sheets).toBeDefined();
      expect(spreadsheet.sheets.length).toBeGreaterThan(0);
    });

    test('should verify spreadsheet is in Shared Drive', async () => {
      const response = await context.drive.files.get({
        fileId: testSpreadsheetId,
        fields: 'id,name,driveId,parents',
        supportsAllDrives: true
      });

      const file = response.data;

      expect(file.driveId).toBeDefined();
      expect(file.parents).toContain(context.config.sharedDrive.testFolderId);
    });
  });

  describe('Sheet Management', () => {
    test('should add a new sheet', async () => {
      const response = await context.sheets.spreadsheets.batchUpdate({
        spreadsheetId: testSpreadsheetId,
        requestBody: {
          requests: [
            {
              addSheet: {
                properties: {
                  title: 'Test Sheet 2'
                }
              }
            }
          ]
        }
      });

      expect(response.data.replies).toBeDefined();
      expect(response.data.replies[0].addSheet).toBeDefined();
    });

    test('should list all sheets', async () => {
      const response = await context.sheets.spreadsheets.get({
        spreadsheetId: testSpreadsheetId
      });

      const sheets = response.data.sheets;

      expect(sheets.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Data Operations', () => {
    test('should write values to cells', async () => {
      const values = [
        ['Header 1', 'Header 2', 'Header 3'],
        ['Row 1 Col 1', 'Row 1 Col 2', 'Row 1 Col 3'],
        ['Row 2 Col 1', 'Row 2 Col 2', 'Row 2 Col 3']
      ];

      const response = await context.sheets.spreadsheets.values.update({
        spreadsheetId: testSpreadsheetId,
        range: 'Sheet1!A1:C3',
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values
        }
      });

      expect(response.data.updatedCells).toBe(9);
      expect(response.data.updatedRows).toBe(3);
      expect(response.data.updatedColumns).toBe(3);
    });

    test('should read values from cells', async () => {
      const response = await context.sheets.spreadsheets.values.get({
        spreadsheetId: testSpreadsheetId,
        range: 'Sheet1!A1:C3'
      });

      const values = response.data.values;

      expect(values).toBeDefined();
      expect(values.length).toBe(3);
      expect(values[0][0]).toBe('Header 1');
    });

    test('should append values to sheet', async () => {
      const values = [
        ['Appended Row 1', 'Data 1', 'Data 2']
      ];

      const response = await context.sheets.spreadsheets.values.append({
        spreadsheetId: testSpreadsheetId,
        range: 'Sheet1!A1',
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values
        }
      });

      expect(response.data.updates).toBeDefined();
      expect(response.data.updates.updatedCells).toBeGreaterThan(0);
    });

    test('should clear values', async () => {
      const response = await context.sheets.spreadsheets.values.clear({
        spreadsheetId: testSpreadsheetId,
        range: 'Sheet1!A5:C5'
      });

      expect(response.data.clearedRange).toBeDefined();
    });
  });

  describe('Batch Operations', () => {
    test('should batch get multiple ranges', async () => {
      const response = await context.sheets.spreadsheets.values.batchGet({
        spreadsheetId: testSpreadsheetId,
        ranges: ['Sheet1!A1:A3', 'Sheet1!B1:B3']
      });

      expect(response.data.valueRanges).toBeDefined();
      expect(response.data.valueRanges.length).toBe(2);
    });

    test('should batch update multiple ranges', async () => {
      const data = [
        {
          range: 'Sheet1!A10',
          values: [['Batch 1']]
        },
        {
          range: 'Sheet1!B10',
          values: [['Batch 2']]
        }
      ];

      const response = await context.sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: testSpreadsheetId,
        requestBody: {
          valueInputOption: 'USER_ENTERED',
          data
        }
      });

      expect(response.data.totalUpdatedCells).toBe(2);
    });
  });

  describe('Formatting', () => {
    test('should format cells', async () => {
      const response = await context.sheets.spreadsheets.batchUpdate({
        spreadsheetId: testSpreadsheetId,
        requestBody: {
          requests: [
            {
              repeatCell: {
                range: {
                  sheetId: testSheetId,
                  startRowIndex: 0,
                  endRowIndex: 1,
                  startColumnIndex: 0,
                  endColumnIndex: 3
                },
                cell: {
                  userEnteredFormat: {
                    backgroundColor: {
                      red: 0.8,
                      green: 0.9,
                      blue: 1.0
                    },
                    textFormat: {
                      bold: true
                    }
                  }
                },
                fields: 'userEnteredFormat(backgroundColor,textFormat)'
              }
            }
          ]
        }
      });

      expect(response.data.replies).toBeDefined();
    });
  });
});
