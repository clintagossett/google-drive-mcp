# Integration Tests

This directory contains integration tests that validate the Google Drive MCP server against real Google Drive, Docs, Sheets, and Slides APIs using a Shared Drive folder.

## ⚠️ Important Notes

- **These tests create real files** in your Shared Drive
- **Opt-in only** - These tests do NOT run with `npm test`
- **Requires OAuth authentication** - You must authenticate the MCP server first
- **Requires Shared Drive access** - You need a folder in a Google Workspace Shared Drive
- **May incur API quota usage** - Google Workspace APIs have usage quotas

## Setup

### 1. Create a Test Folder in Shared Drive

1. Open Google Drive in your browser
2. Navigate to a Shared Drive where you have edit permissions
3. Create a new folder named "MCP Integration Tests" (or any name you prefer)
4. Copy the folder ID from the URL (e.g., `https://drive.google.com/drive/folders/YOUR_FOLDER_ID`)

### 2. Configure Test Settings

```bash
# Copy the template configuration
cp tests/integration/test-config.template.json tests/integration/test-config.json

# Edit the configuration
# Replace YOUR_SHARED_DRIVE_FOLDER_ID with your actual folder ID
```

Example `test-config.json`:
```json
{
  "sharedDrive": {
    "testFolderId": "17NGLmi_62A6kbLEyovUndt6Ifo8BIvgE",
    "testFolderName": "MCP Integration Tests"
  },
  "testSettings": {
    "cleanupAfterTests": true,
    "preserveTestArtifacts": false,
    "verbose": true,
    "testFilePrefix": "TEST_",
    "maxTestRuntime": 300000
  },
  "oauth": {
    "credentialsPath": "~/.config/google-drive-mcp/tokens.json"
  }
}
```

### 3. Authenticate the MCP Server

If you haven't already authenticated:

```bash
# Build and start the server
npm run build

# Test with Claude Code or use the MCP Inspector
# This will trigger OAuth flow and create tokens
```

## Running Tests

### Run All Integration Tests

```bash
npm run test:integration
```

### Run Specific Test Suites

```bash
# Test Drive API only
npm run test:integration:drive

# Test Docs API only
npm run test:integration:docs

# Test Sheets API only
npm run test:integration:sheets

# Test Slides API only
npm run test:integration:slides
```

### Run All Tests (Unit + Integration)

```bash
npm run test:all
```

## Test Coverage

### Drive API Tests (`drive.integration.test.ts`)

- ✅ Create folder in Shared Drive
- ✅ List files with `supportsAllDrives`
- ✅ Create Google Doc
- ✅ Get file metadata
- ✅ Update file metadata
- ✅ Copy file
- ✅ Move file between folders
- ✅ Search files by name/type
- ✅ Delete file
- ✅ Verify Shared Drive capabilities

### Docs API Tests (`docs.integration.test.ts`)

- ✅ Get document structure
- ✅ Insert table
- ✅ Insert page break
- ✅ Update paragraph formatting
- ✅ Verify document in Shared Drive

### Sheets API Tests (`sheets.integration.test.ts`)

- ✅ Get spreadsheet properties
- ✅ Add new sheet
- ✅ Write values to cells
- ✅ Read values from cells
- ✅ Append values
- ✅ Clear values
- ✅ Batch get multiple ranges
- ✅ Batch update multiple ranges
- ✅ Apply cell formatting
- ✅ Verify spreadsheet in Shared Drive

### Slides API Tests (`slides.integration.test.ts`)

- ✅ Get presentation properties
- ✅ Create new slide
- ✅ Insert text box
- ✅ Insert shape
- ✅ Update page background
- ✅ Delete slide
- ✅ Verify presentation in Shared Drive

## Test File Management

### Automatic Cleanup

By default, all test files are automatically deleted after tests complete:

```json
{
  "testSettings": {
    "cleanupAfterTests": true
  }
}
```

### Preserve Test Artifacts

To keep test files for inspection (useful for debugging):

```json
{
  "testSettings": {
    "cleanupAfterTests": false,
    "preserveTestArtifacts": true
  }
}
```

### Orphaned File Cleanup

The test suite automatically detects and cleans up orphaned test files from previous runs before starting new tests.

### Test File Naming

All test files are prefixed with `TEST_` and include a timestamp:
- `TEST_document_1737321234567.gdoc`
- `TEST_folder_1737321234568.dir`
- `TEST_sheets_test_1737321234569.gsheet`

## Troubleshooting

### Configuration Not Found

```
Error: Integration test configuration not found!
```

**Solution**: Copy `test-config.template.json` to `test-config.json` and configure your Shared Drive folder ID.

### OAuth Tokens Not Found

```
Error: OAuth tokens not found at ~/.config/google-drive-mcp/tokens.json
```

**Solution**: Authenticate the MCP server first by running it with Claude Code or using the MCP Inspector.

### Permission Denied

```
Error: No permission to create files in this folder
```

**Solution**: Ensure you have edit permissions in the Shared Drive folder.

### Not a Shared Drive Folder

```
Error: Configured folder is not in a Shared Drive
```

**Solution**: The folder ID must point to a folder inside a Google Workspace Shared Drive, not a personal "My Drive" folder.

## CI/CD Integration

These tests are designed for local development and should NOT run in CI/CD by default. If you want to run them in CI:

1. Set up a service account with Shared Drive access
2. Store test configuration as secrets
3. Use a dedicated test folder
4. Enable cleanup after tests

## Configuration Reference

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `sharedDrive.testFolderId` | string | required | Shared Drive folder ID for tests |
| `sharedDrive.testFolderName` | string | | Display name for reference |
| `testSettings.cleanupAfterTests` | boolean | `true` | Delete test files after completion |
| `testSettings.preserveTestArtifacts` | boolean | `false` | Keep failed test artifacts |
| `testSettings.verbose` | boolean | `true` | Print detailed test output |
| `testSettings.testFilePrefix` | string | `"TEST_"` | Prefix for all test files |
| `testSettings.maxTestRuntime` | number | `300000` | Max test runtime in ms (5 min) |
| `oauth.credentialsPath` | string | `"~/.config/google-drive-mcp/tokens.json"` | OAuth token file path |

## Security

⚠️ **NEVER commit `test-config.json` to version control!**

The file is automatically gitignored to prevent accidental commits of Shared Drive folder IDs.

## Support

If you encounter issues with integration tests:

1. Check the troubleshooting section above
2. Verify your Shared Drive permissions
3. Ensure OAuth tokens are valid
4. Review test output with `verbose: true`
5. Report issues at: https://github.com/clintagossett/google-drive-mcp/issues
