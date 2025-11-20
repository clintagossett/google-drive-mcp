# Google Drive API v3 Reference

**Purpose**: Complete audit of Google Drive API v3 for MCP tool implementation
**Scope**: Focus on APIs relevant to Google Docs, Sheets, and Slides file management
**Created**: 2025-11-18
**Related**: Issue #4 - Implement Complete Google Drive API

---

## API Overview

The Google Drive API v3 provides programmatic access to Google Drive file storage and management. For this MCP server, we focus on operations that support working with Docs, Sheets, and Slides files.

**API Documentation**: https://developers.google.com/drive/api/v3/reference

**Key Resources**:
- **Files** - File and folder CRUD operations
- **Permissions** - Sharing and access control
- **Comments** - File comments and discussions
- **Replies** - Comment thread replies

---

## Current MCP Tool Coverage

### ✅ Implemented Tools (22 tools) - 96% of in-scope Drive API

**Phase 1: Essential File Operations** (5 tools):
1. `drive_createFile` - Maps to `files.create`
2. `drive_getFile` - Maps to `files.get`
3. `drive_updateFile` - Maps to `files.update`
4. `drive_deleteFile` - Maps to `files.update` (trash)
5. `drive_listFiles` - Maps to `files.list`

**Phase 2: File Utilities** (2 tools):
6. `drive_copyFile` - Maps to `files.copy`
7. `drive_exportFile` - Maps to `files.export`

**Phase 3: Comments & Collaboration** (10 tools):
8. `drive_createComment` - Maps to `comments.create`
9. `drive_listComments` - Maps to `comments.list`
10. `drive_getComment` - Maps to `comments.get`
11. `drive_updateComment` - Maps to `comments.update`
12. `drive_deleteComment` - Maps to `comments.delete`
13. `drive_createReply` - Maps to `replies.create`
14. `drive_listReplies` - Maps to `replies.list`
15. `drive_getReply` - Maps to `replies.get`
16. `drive_updateReply` - Maps to `replies.update`
17. `drive_deleteReply` - Maps to `replies.delete`

**Phase 4: Sharing & Permissions** (5 tools):
18. `drive_createPermission` - Maps to `permissions.create`
19. `drive_listPermissions` - Maps to `permissions.list`
20. `drive_getPermission` - Maps to `permissions.get`
21. `drive_updatePermission` - Maps to `permissions.update`
22. `drive_deletePermission` - Maps to `permissions.delete`

**Legacy Tools** (compliant with 1:1 design, predating naming convention):
- `search` - Maps to `files.list` with query
- `createTextFile` - Maps to `files.create` (text/plain)
- `updateTextFile` - Maps to `files.update` (text content)
- `createFolder` - Maps to `files.create` (folder MIME type)
- `listFolder` - Maps to `files.list` with parent filter
- `deleteItem` - Maps to `files.update` (move to trash)
- `renameItem` - Maps to `files.update` (name only)
- `moveItem` - Maps to `files.update` (parent change)

**Convenience Tools** (violate 1:1 design, to be deprecated):
- `createGoogleSheet` - Multi-step (Drive + Sheets)
- `updateGoogleSheet` - Multi-step (Sheets only, not Drive)
- `getGoogleSlidesContent` - Custom formatting

### ❌ Not Implemented (1 operation)

**Files Resource**: 1 method remaining (`files.emptyTrash`)

---

## Files Resource (13 methods)

### File CRUD Operations

#### 1. `files.create`
**Description**: Creates a new file or folder

**Parameters**:
- `name` (string): File/folder name
- `mimeType` (string): MIME type
- `parents` (string[]): Parent folder IDs
- `description` (string): Optional description
- `properties` (object): Custom key-value properties
- Media upload: File content (for non-Google Workspace files)

**Current MCP Tool**: `createTextFile`, `createFolder` ✅ (partial coverage)

**Proposed Tool**: `drive_createFile`

**MIME Types**:
- Folders: `application/vnd.google-apps.folder`
- Google Docs: `application/vnd.google-apps.document`
- Google Sheets: `application/vnd.google-apps.spreadsheet`
- Google Slides: `application/vnd.google-apps.presentation`
- Text files: `text/plain`
- Other: Any standard MIME type

---

#### 2. `files.get`
**Description**: Gets a file's metadata or content by ID

**Parameters**:
- `fileId` (string): The file ID
- `fields` (string): Fields to include in response
- `supportsAllDrives` (boolean): Whether to support shared drives
- `acknowledgeAbuse` (boolean): For abuse-flagged files
- `alt=media`: Download file content

**Current MCP Tool**: None ❌

**Proposed Tool**: `drive_getFile`

**Use Cases**:
- Get file metadata (name, mimeType, parents, createdTime, etc.)
- Download file content
- Check file existence
- Get sharing/permission info

---

#### 3. `files.update`
**Description**: Updates a file's metadata and/or content

**Parameters**:
- `fileId` (string): The file to update
- `name` (string): New name
- `mimeType` (string): New MIME type
- `parents` (string[]): New parent folders
- `trashed` (boolean): Move to/from trash
- `description` (string): Update description
- `properties` (object): Update custom properties
- Media upload: New file content

**Current MCP Tool**: `updateTextFile`, `renameItem`, `moveItem`, `deleteItem` ✅ (partial coverage)

**Proposed Tool**: `drive_updateFile`

**Common Update Operations**:
- Rename: Update `name` only
- Move: Update `parents` only
- Trash: Update `trashed` to `true`
- Restore: Update `trashed` to `false`
- Update content: Provide media upload

---

#### 4. `files.delete`
**Description**: Permanently deletes a file (bypasses trash)

**Parameters**:
- `fileId` (string): The file to delete
- `supportsAllDrives` (boolean): Whether to support shared drives

**Current MCP Tool**: None ❌ (we have `deleteItem` which moves to trash)

**Proposed Tool**: `drive_deleteFile`

**Note**: Permanent deletion, cannot be undone. Different from trash.

---

#### 5. `files.list`
**Description**: Lists or searches for files

**Parameters**:
- `q` (string): Query string for filtering
- `pageSize` (number): Max results per page (default 100, max 1000)
- `pageToken` (string): Token for next page
- `orderBy` (string): Sort order
- `fields` (string): Fields to include
- `spaces` (string): Spaces to search (drive, appDataFolder, photos)
- `corpora` (string): Bodies to search (user, domain, drive, allDrives)

**Current MCP Tool**: `search`, `listFolder` ✅ (partial coverage)

**Proposed Tool**: `drive_listFiles`

**Query Operators**:
- `name = 'filename'` - Exact name match
- `name contains 'text'` - Name contains text
- `mimeType = 'type'` - Filter by MIME type
- `'parent-id' in parents` - Files in folder
- `trashed = false` - Exclude trashed
- `modifiedTime > '2024-01-01T00:00:00'` - Date filters

---

#### 6. `files.copy`
**Description**: Creates a copy of a file

**Parameters**:
- `fileId` (string): The file to copy
- `name` (string): Name for the copy
- `parents` (string[]): Parent folders for copy
- `description` (string): Description for copy
- `properties` (object): Custom properties

**Current MCP Tool**: None ❌

**Proposed Tool**: `drive_copyFile`

**Use Cases**:
- Duplicate a file
- Create template instances
- Backup files

---

#### 7. `files.export`
**Description**: Exports a Google Workspace file to another format

**Parameters**:
- `fileId` (string): The file to export
- `mimeType` (string): Export format MIME type

**Current MCP Tool**: ✅ `drive_exportFile` (Phase 2)

**Export Formats**:

**Google Docs** (8 formats):
- `application/pdf` - PDF (.pdf)
- `application/vnd.openxmlformats-officedocument.wordprocessingml.document` - MS Word (.docx)
- `text/markdown` - **Markdown (.md)** ⬅️ NEW in 2024!
- `text/plain` - Plain text (.txt)
- `application/rtf` - Rich text (.rtf)
- `application/vnd.oasis.opendocument.text` - OpenDocument (.odt)
- `application/zip` - HTML (zipped)
- `application/epub+zip` - EPUB (.epub)

**Google Sheets** (6 formats):
- `application/pdf` - PDF (.pdf)
- `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` - MS Excel (.xlsx)
- `text/csv` - CSV (.csv) - first sheet only
- `text/tab-separated-values` - TSV (.tsv) - first sheet only
- `application/vnd.oasis.opendocument.spreadsheet` - OpenDocument (.ods)
- `application/zip` - HTML (zipped)

**Google Slides** (7 formats):
- `application/pdf` - PDF (.pdf)
- `application/vnd.openxmlformats-officedocument.presentationml.presentation` - MS PowerPoint (.pptx)
- `text/plain` - Plain text (.txt)
- `image/jpeg` - JPEG (.jpg) - first slide only
- `image/png` - PNG (.png) - first slide only
- `image/svg+xml` - SVG (.svg) - first slide only
- `application/vnd.oasis.opendocument.presentation` - OpenDocument (.odp)

**Limitations**:
- Max export size: 10MB
- Returns base64-encoded content
- Image formats (JPEG, PNG, SVG) only export first slide
- CSV/TSV only export first sheet

**Use Cases**:
- Download Docs as PDF or Markdown
- Export Sheets as Excel or CSV
- Convert Slides to PowerPoint or images

**Reference**: https://developers.google.com/drive/api/guides/ref-export-formats

---

#### 8. `files.download` (same as `files.get` with `alt=media`)
**Description**: Downloads file content

**Note**: This is handled by `files.get` with `alt=media` parameter

---

#### 9. `files.emptyTrash`
**Description**: Permanently deletes all trashed files

**Parameters**: None

**Current MCP Tool**: None ❌

**Proposed Tool**: `drive_emptyTrash`

**Warning**: Irreversible operation

---

#### 10. `files.generateIds`
**Description**: Generates file IDs that can be used in create/copy

**Parameters**:
- `count` (number): Number of IDs to generate (default 10, max 1000)
- `space` (string): The space to generate IDs for (default: drive)

**Current MCP Tool**: None ❌

**Proposed Tool**: `drive_generateIds`

**Use Cases**:
- Pre-generate IDs for batch operations
- Create predictable file IDs

---

#### 11. `files.watch`
**Description**: Subscribes to changes on a file

**Parameters**:
- `fileId` (string): The file to watch
- Channel configuration (id, type, address, token, expiration)

**Current MCP Tool**: None ❌

**Proposed Tool**: OUT OF SCOPE (requires webhook setup)

**Reason to Exclude**: Requires external webhook infrastructure, not suitable for MCP tool pattern

---

#### 12. `files.listLabels`
**Description**: Lists labels applied to a file

**Parameters**:
- `fileId` (string): The file ID
- `maxResults` (number): Max labels to return

**Current MCP Tool**: None ❌

**Proposed Tool**: OUT OF SCOPE (labels rarely used for Docs/Sheets/Slides)

**Reason to Exclude**: Labels are advanced Drive feature, not commonly used with Docs/Sheets/Slides

---

#### 13. `files.modifyLabels`
**Description**: Modifies labels applied to a file

**Parameters**:
- `fileId` (string): The file ID
- Label modifications

**Current MCP Tool**: None ❌

**Proposed Tool**: OUT OF SCOPE (labels rarely used for Docs/Sheets/Slides)

**Reason to Exclude**: Labels are advanced Drive feature, not commonly used with Docs/Sheets/Slides

---

## Permissions Resource (5 methods)

**Purpose**: Manage file and folder sharing/access control

### 14. `permissions.create`
**Description**: Grants access to a file or folder

**Parameters**:
- `fileId` (string): The file to share
- `role` (enum): Access level - `owner`, `organizer`, `fileOrganizer`, `writer`, `commenter`, `reader`
- `type` (enum): Permission type - `user`, `group`, `domain`, `anyone`
- `emailAddress` (string): For user/group types
- `domain` (string): For domain type
- `sendNotificationEmail` (boolean): Send email notification
- `emailMessage` (string): Custom message in notification

**Current MCP Tool**: ✅ `drive_createPermission` (Phase 4)

**Use Cases**:
- Share file with specific user
- Make file public
- Share with domain

---

### 15. `permissions.delete`
**Description**: Removes access to a file or folder

**Parameters**:
- `fileId` (string): The file
- `permissionId` (string): The permission to remove
- `supportsAllDrives` (boolean): Support shared drives

**Current MCP Tool**: ✅ `drive_deletePermission` (Phase 4)

**Use Cases**:
- Revoke user access
- Remove public sharing

---

### 16. `permissions.get`
**Description**: Gets details of a specific permission

**Parameters**:
- `fileId` (string): The file
- `permissionId` (string): The permission ID
- `fields` (string): Fields to include
- `supportsAllDrives` (boolean): Support shared drives

**Current MCP Tool**: ✅ `drive_getPermission` (Phase 4)

---

### 17. `permissions.list`
**Description**: Lists all permissions for a file

**Parameters**:
- `fileId` (string): The file
- `pageSize` (number): Max results
- `pageToken` (string): Pagination token
- `fields` (string): Fields to include
- `supportsAllDrives` (boolean): Support shared drives

**Current MCP Tool**: ✅ `drive_listPermissions` (Phase 4)

**Use Cases**:
- See who has access
- Audit sharing settings

---

### 18. `permissions.update`
**Description**: Updates a permission (e.g., change role)

**Parameters**:
- `fileId` (string): The file
- `permissionId` (string): The permission to update
- `role` (enum): New role
- `removeExpiration` (boolean): Remove expiration
- `transferOwnership` (boolean): Transfer ownership

**Current MCP Tool**: ✅ `drive_updatePermission` (Phase 4)

**Use Cases**:
- Change user from viewer to editor
- Transfer file ownership

---

## Comments Resource (5 methods)

**Purpose**: Manage comments on files (important for Docs/Sheets/Slides collaboration)

### 19. `comments.create`
**Description**: Adds a comment to a file

**Parameters**:
- `fileId` (string): The file to comment on
- `content` (string): Comment text
- `anchor` (object): Optional location in document (for Docs)
- `quotedFileContent` (object): Quoted text being commented on

**Current MCP Tool**: None ❌

**Proposed Tool**: `drive_createComment`

**Use Cases**:
- Add feedback to document
- Ask questions on specific content
- Suggest changes

---

### 20. `comments.delete`
**Description**: Deletes a comment

**Parameters**:
- `fileId` (string): The file
- `commentId` (string): The comment to delete

**Current MCP Tool**: None ❌

**Proposed Tool**: `drive_deleteComment`

---

### 21. `comments.get`
**Description**: Gets a comment by ID

**Parameters**:
- `fileId` (string): The file
- `commentId` (string): The comment ID
- `includeDeleted` (boolean): Include deleted comments

**Current MCP Tool**: None ❌

**Proposed Tool**: `drive_getComment`

---

### 22. `comments.list`
**Description**: Lists all comments on a file

**Parameters**:
- `fileId` (string): The file
- `pageSize` (number): Max results (default 20, max 100)
- `pageToken` (string): Pagination token
- `includeDeleted` (boolean): Include deleted comments
- `startModifiedTime` (string): Filter by modification time

**Current MCP Tool**: None ❌

**Proposed Tool**: `drive_listComments`

**Use Cases**:
- Review all feedback
- Track unresolved comments
- Export comment history

---

### 23. `comments.update`
**Description**: Updates a comment

**Parameters**:
- `fileId` (string): The file
- `commentId` (string): The comment to update
- `content` (string): New comment text

**Current MCP Tool**: None ❌

**Proposed Tool**: `drive_updateComment`

---

## Replies Resource (5 methods)

**Purpose**: Manage replies to comments (comment threads)

### 24. `replies.create`
**Description**: Adds a reply to a comment

**Parameters**:
- `fileId` (string): The file
- `commentId` (string): The comment to reply to
- `content` (string): Reply text
- `action` (enum): Optional action - `resolve`, `reopen`

**Current MCP Tool**: None ❌

**Proposed Tool**: `drive_createReply`

**Use Cases**:
- Respond to feedback
- Mark comment as resolved
- Continue discussion

---

### 25. `replies.delete`
**Description**: Deletes a reply

**Parameters**:
- `fileId` (string): The file
- `commentId` (string): The comment
- `replyId` (string): The reply to delete

**Current MCP Tool**: None ❌

**Proposed Tool**: `drive_deleteReply`

---

### 26. `replies.get`
**Description**: Gets a reply by ID

**Parameters**:
- `fileId` (string): The file
- `commentId` (string): The comment
- `replyId` (string): The reply ID
- `includeDeleted` (boolean): Include deleted replies

**Current MCP Tool**: None ❌

**Proposed Tool**: `drive_getReply`

---

### 27. `replies.list`
**Description**: Lists all replies to a comment

**Parameters**:
- `fileId` (string): The file
- `commentId` (string): The comment
- `pageSize` (number): Max results (default 20, max 100)
- `pageToken` (string): Pagination token
- `includeDeleted` (boolean): Include deleted replies

**Current MCP Tool**: None ❌

**Proposed Tool**: `drive_listReplies`

**Use Cases**:
- View comment thread
- Track resolution history

---

### 28. `replies.update`
**Description**: Updates a reply

**Parameters**:
- `fileId` (string): The file
- `commentId` (string): The comment
- `replyId` (string): The reply to update
- `content` (string): New reply text
- `action` (enum): Optional action - `resolve`, `reopen`

**Current MCP Tool**: None ❌

**Proposed Tool**: `drive_updateReply`

---

## Implementation Priority

### Phase 1: Essential File Operations ✅ COMPLETE
**Impact**: Replace convenience tools, enable proper Docs/Sheets/Slides workflow
**Tools implemented (5/5)**:
1. ✅ `drive_createFile` - Complete file creation (all MIME types)
2. ✅ `drive_getFile` - Get file metadata
3. ✅ `drive_updateFile` - Complete file updates
4. ✅ `drive_deleteFile` - Permanent deletion
5. ✅ `drive_listFiles` - Complete search/list with all query options

**Benefits**:
- Replaces `createGoogleDoc`, `createGoogleSlides` convenience tools
- Enables proper 1:1 API workflow
- Full control over file properties

**Status**: Committed in `7055306` with 38 tests

---

### Phase 2: File Utilities ✅ COMPLETE
**Impact**: Common file operations
**Tools implemented (2/2)**:
6. ✅ `drive_copyFile` - Duplicate files
7. ✅ `drive_exportFile` - Export to different formats (21 total formats including Markdown!)

**Benefits**:
- Template duplication
- Format conversion (Docs→PDF/Markdown, Sheets→Excel/CSV, Slides→PowerPoint/Images)

**Status**: Committed in `7055306` with 15 tests

---

### Phase 3: Comments & Collaboration ✅ COMPLETE
**Impact**: Critical for Docs/Sheets/Slides review workflows
**Tools implemented (10/10)**:
8. ✅ `drive_createComment` - Add comments
9. ✅ `drive_listComments` - View all comments
10. ✅ `drive_getComment` - Get comment details
11. ✅ `drive_updateComment` - Edit comments
12. ✅ `drive_deleteComment` - Remove comments
13. ✅ `drive_createReply` - Reply to comments
14. ✅ `drive_listReplies` - View reply threads
15. ✅ `drive_getReply` - Get reply details
16. ✅ `drive_updateReply` - Edit replies
17. ✅ `drive_deleteReply` - Remove replies

**Benefits**:
- Automated review workflows
- Comment management
- Feedback tracking
- Essential for document collaboration

**Status**: Committed in `7055306` with 64 tests

---

### Phase 4: Sharing & Permissions (MEDIUM)
**Impact**: Important for collaboration and access control
**Tools to implement (5)**:
18. `drive_createPermission` - Share files
19. `drive_deletePermission` - Revoke access
20. `drive_getPermission` - Check permission details
21. `drive_listPermissions` - Audit sharing
22. `drive_updatePermission` - Change access levels

**Benefits**:
- Programmatic sharing
- Access control automation
- Security auditing

---

### Phase 5: Advanced Operations (LOW)
**Impact**: Nice-to-have features
**Tools to implement (1)**:
23. `drive_emptyTrash` - Bulk delete trashed files

**Out of Scope**:
- `drive_generateIds` - Rarely needed, can use auto-generated IDs
- `files.watch` - Requires webhook infrastructure
- `files.listLabels` / `files.modifyLabels` - Rarely used with Docs/Sheets/Slides

---

## Summary Statistics

**Total Drive API Methods**: 28
**In Scope**: 23 methods (82%)
**Out of Scope**: 5 methods (18%) - webhooks, labels, ID generation

**Current Coverage**: 22 tools (96% of in-scope) ✅
**To Implement**: 1 tool (4% of in-scope)

**Breakdown by Resource**:
- **Files**: 7/9 in-scope methods implemented (78%) ✅ Phase 1 & 2 complete
- **Permissions**: 5/5 methods implemented (100%) ✅ Phase 4 complete
- **Comments**: 5/5 methods implemented (100%) ✅ Phase 3 complete
- **Replies**: 5/5 methods implemented (100%) ✅ Phase 3 complete

**Implementation Status**:
- ✅ **Phase 1 COMPLETE** (5 tools) - Essential File Operations
- ✅ **Phase 2 COMPLETE** (2 tools) - File Utilities
- ✅ **Phase 3 COMPLETE** (10 tools) - Comments & Collaboration
- ✅ **Phase 4 COMPLETE** (5 tools) - Sharing & Permissions
- ⏭️ **Phase 5 PENDING** (1 tool) - Advanced Operations

---

## Design Considerations

### 1:1 API Mapping
All new tools should follow the `drive_{method}` naming convention and map directly to a single Drive API method.

**Examples**:
- `drive_createFile` → `files.create`
- `drive_listComments` → `comments.list`
- `drive_createPermission` → `permissions.create`

### Thin Wrappers Only
- Validate parameters with Zod schemas
- Call Drive API method
- Return raw API response (as JSON)
- No business logic, no multi-step operations

### Parameter Naming
Use Drive API parameter names directly (e.g., `fileId`, `mimeType`, `pageToken`) for consistency with official documentation.

### Error Handling
Let Drive API errors pass through to client for proper error handling at the MCP level.

---

## Next Steps

1. ✅ Complete this API audit
2. ⏭️ Implement Phase 1 tools (5 essential file operations)
3. ⏭️ Write tests for Phase 1 tools (5+ tests per tool minimum)
4. ⏭️ Implement Phase 2-4 tools (17 additional tools)
5. ⏭️ Deprecate/remove convenience tools (`createGoogleDoc`, `updateGoogleDoc`, etc.)
6. ⏭️ Update README with complete Drive API coverage

---

**Created**: 2025-11-18
**Related Issues**: #4 (Drive API implementation), #2 (Deprecate convenience tools)
**Reference**: https://developers.google.com/drive/api/v3/reference
