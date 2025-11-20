# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.0.3] - 2025-11-19

### Fixed
- **drive_getFile**: Now filters out trashed files by default ([#11](https://github.com/clintagossett/google-drive-collaboration-mcp/issues/11))
  - Added `includeTrashed` parameter (optional, defaults to `false`)
  - Returns error if file is in trash unless explicitly requested
  - Automatically includes `trashed` field in API response
- **drive_listFiles**: Now excludes trashed files by default ([#11](https://github.com/clintagossett/google-drive-collaboration-mcp/issues/11))
  - Added `includeTrashed` parameter (optional, defaults to `false`)
  - Automatically appends `trashed = false` to query
  - Smart detection: won't override if user already specified trashed filter

### Changed
- Updated test suite with 2 new unit tests (6 tests for drive_getFile, 11 for drive_listFiles)
- All 1,173 tests passing

## [0.0.2] - 2025-11-18

### Added
- **Google Sheets API - Phase 1** (10 core data operation tools)
  - `sheets_getSpreadsheet` - Get full spreadsheet metadata
  - `sheets_createSpreadsheet` - Create spreadsheet with properties
  - `sheets_appendValues` - Append data to end of sheet
  - `sheets_clearValues` - Clear cell values
  - `sheets_batchGetValues` - Get multiple ranges at once
  - `sheets_batchUpdateValues` - Update multiple ranges at once
  - `sheets_batchClearValues` - Clear multiple ranges at once
  - `sheets_addSheet` - Add new sheet to spreadsheet
  - `sheets_deleteSheet` - Delete sheet by ID
  - `sheets_updateSheetProperties` - Update sheet properties
- 91 unit tests for Sheets API tools (100% passing)

### Changed
- Test suite expanded from 320 to 411 tests

## [0.0.1] - 2025-08-04

### Added
- **Google Drive API** (8 essential file operations)
  - `drive_createFile` - Create files and folders
  - `drive_getFile` - Get file metadata
  - `drive_updateFile` - Update file metadata
  - `drive_deleteFile` - Permanently delete files
  - `drive_listFiles` - List and search files
  - `drive_copyFile` - Copy files
  - `drive_exportFile` - Export Google Workspace files

- **Google Docs API** (34 operations, 100% coverage)
  - Document management (get, create, update)
  - Text formatting and styling
  - Document structure (headers, footers, sections)
  - Tables and table operations
  - Images and positioned objects
  - Named ranges and bookmarks

- **Google Slides API** (27 operations)
  - Presentation management
  - Slide operations
  - Shape and text manipulation
  - Image and video handling
  - Table operations
  - Layout and positioning

- **Comments & Collaboration** (12 operations)
  - Comment CRUD operations
  - Reply management
  - Permission management

- **Authentication**
  - OAuth 2.0 with automatic token refresh
  - Support for both regular and shared drives
  - Service account support

- **Testing**
  - 320 unit tests
  - Integration test framework
  - Test document setup automation

### Documentation
- Comprehensive README with usage examples
- API reference documentation for all supported APIs
- Design principles and coding standards
- Development workflow guidelines

---

## Release Notes

### Version Numbering

This project follows [Semantic Versioning](https://semver.org/):
- **MAJOR** (1.0.0): Incompatible API changes
- **MINOR** (0.1.0): Backwards-compatible functionality additions
- **PATCH** (0.0.1): Backwards-compatible bug fixes

### Upgrade Guide

#### From 0.0.2 to 0.0.3

No breaking changes. Optional new parameters added:
- `drive_getFile`: `includeTrashed` parameter (optional)
- `drive_listFiles`: `includeTrashed` parameter (optional)

**Behavior Change**: These tools now filter out trashed files by default. If you need to access trashed files, add `includeTrashed: true` to your requests.

#### From 0.0.1 to 0.0.2

No breaking changes. Pure additions:
- 10 new Google Sheets tools
- No changes to existing Drive, Docs, or Slides tools

---

## Links

- [GitHub Repository](https://github.com/clintagossett/google-drive-collaboration-mcp)
- [npm Package](https://www.npmjs.com/package/@clintagossett/google-drive-collaboration-mcp)
- [Issue Tracker](https://github.com/clintagossett/google-drive-collaboration-mcp/issues)
- [Contributing Guide](./CONTRIBUTING.md)
