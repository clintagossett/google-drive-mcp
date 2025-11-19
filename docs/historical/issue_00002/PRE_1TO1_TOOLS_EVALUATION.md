# Evaluation of Pre-1:1 API Design Tools

**Date**: 2025-11-18
**Purpose**: Evaluate all tools built before 1:1 API design principles were established
**Related Issue**: https://github.com/clintagossett/google-drive-mcp/issues/2

---

## Executive Summary

This document evaluates all MCP tools that were implemented before the 1:1 API design principles were formally established (commit 65bf29a, 2025-01-18). The evaluation determines which tools:
- ✅ **Comply** with 1:1 API principles
- ⚠️ **Partially comply** (minor issues)
- ❌ **Violate** 1:1 API principles

### Key Finding

**Out of 31 pre-existing tools**:
- ✅ **8 tools comply** (26%) - Drive file management tools
- ⚠️ **0 tools partially comply** (0%)
- ❌ **23 tools violate** (74%) - All "convenience" document tools

---

## Design Principles Reference

### What is 1:1 API Mapping?

From `design/DESIGN_PRINCIPLES.md`:

**Core Rules**:
1. One Request Type = One Tool (MANDATORY)
2. Transparent Parameter Mapping (MANDATORY)
3. Respect API Boundaries (MANDATORY)
4. Self-Documenting Names (MANDATORY)
5. Thin Wrappers for Low-Level (MANDATORY)

**Allowed in Thin Wrappers**:
- Parameter validation (Zod)
- Parameter transformation (MCP → API format)
- Error wrapping (API error → MCP error)
- Response formatting (API response → MCP response)

**NOT Allowed**:
- Business logic
- Multi-step workflows
- Data transformation beyond format conversion
- Caching or state management

---

## Tool Categories

### Category 1: Drive File Management (8 tools)
**Original Commit**: 395baf6 (Initial code, 2025-07-29)
**Author**: Piotr Agier

Tools:
1. `search`
2. `createTextFile`
3. `updateTextFile`
4. `createFolder`
5. `listFolder`
6. `deleteItem`
7. `renameItem`
8. `moveItem`

### Category 2: Google Docs Convenience (3 tools)
**Original Commit**: d0056a0 (2025-08-01)
**Author**: Piotr Agier

Tools:
1. `createGoogleDoc`
2. `updateGoogleDoc`
3. `formatGoogleDocText`
4. `formatGoogleDocParagraph`

### Category 3: Google Sheets Convenience (7 tools)
**Original Commit**: b0b6753 (2025-08-01)
**Author**: Piotr Agier

Tools:
1. `getGoogleSheetContent`
2. `formatGoogleSheetCells`
3. `formatGoogleSheetText`
4. `formatGoogleSheetNumbers`
5. `setGoogleSheetBorders`
6. `mergeGoogleSheetCells`
7. `addGoogleSheetConditionalFormat`

### Category 4: Google Slides Convenience (9 tools)
**Original Commit**: 61d3ffc (2025-08-01)
**Author**: Piotr Agier

Tools:
1. `createGoogleSlides`
2. `updateGoogleSlides`
3. `getGoogleSlidesContent`
4. `formatGoogleSlidesText`
5. `formatGoogleSlidesParagraph`
6. `styleGoogleSlidesShape`
7. `setGoogleSlidesBackground`
8. `createGoogleSlidesTextBox`
9. `createGoogleSlidesShape`

---

## Detailed Evaluation

### ✅ COMPLIANT: Drive File Management Tools

#### 1. `search`
**Maps to**: `drive.files.list`
**Status**: ✅ **COMPLIANT**

**Analysis**:
- Maps 1:1 to Drive API `files.list` method
- Thin wrapper with parameter transformation
- No business logic, just query formatting
- Returns API response in MCP format

**Code Pattern**:
```typescript
const res = await drive.files.list({
  q: formattedQuery,  // Transformed from user query
  pageSize: 10,
  fields: "files(id, name, mimeType, modifiedTime, size)",
});
return { content: [{ type: "text", text: fileList }] };
```

**Verdict**: Proper thin wrapper ✅

---

#### 2. `createTextFile`
**Maps to**: `drive.files.create`
**Status**: ✅ **COMPLIANT**

**Analysis**:
- Maps 1:1 to Drive API `files.create` method
- Pre-flight check (file exists) is defensive, not business logic
- MIME type detection is parameter transformation
- Single API call, simple response

**Code Pattern**:
```typescript
const file = await drive.files.create({
  requestBody: fileMetadata,
  media: { mimeType, body: content }
});
return { content: [{ type: "text", text: `Created file: ${file.data.name}` }] };
```

**Verdict**: Proper thin wrapper ✅

---

#### 3. `updateTextFile`
**Maps to**: `drive.files.update`
**Status**: ✅ **COMPLIANT**

**Analysis**:
- Maps 1:1 to Drive API `files.update` method
- MIME type validation is defensive
- File metadata fetch is verification, not multi-step workflow
- Single update operation

**Verdict**: Proper thin wrapper ✅

---

#### 4. `createFolder`
**Maps to**: `drive.files.create` (with folder MIME type)
**Status**: ✅ **COMPLIANT**

**Analysis**:
- Maps 1:1 to Drive API `files.create` method
- Folder is just a specific MIME type (`application/vnd.google-apps.folder`)
- Single API call

**Verdict**: Proper thin wrapper ✅

---

#### 5. `listFolder`
**Maps to**: `drive.files.list`
**Status**: ✅ **COMPLIANT**

**Analysis**:
- Maps 1:1 to Drive API `files.list` method
- Query construction is parameter transformation
- Pagination support is API parameter passthrough

**Verdict**: Proper thin wrapper ✅

---

#### 6. `deleteItem`
**Maps to**: `drive.files.update` (move to trash)
**Status**: ✅ **COMPLIANT**

**Analysis**:
- Maps 1:1 to Drive API `files.update` method
- Moves to trash (sets `trashed: true`), doesn't permanently delete
- Single API call

**Verdict**: Proper thin wrapper ✅

---

#### 7. `renameItem`
**Maps to**: `drive.files.update`
**Status**: ✅ **COMPLIANT**

**Analysis**:
- Maps 1:1 to Drive API `files.update` method
- Simple metadata update (name field)
- Single API call

**Verdict**: Proper thin wrapper ✅

---

#### 8. `moveItem`
**Maps to**: `drive.files.update`
**Status**: ✅ **COMPLIANT**

**Analysis**:
- Maps 1:1 to Drive API `files.update` method
- Parent folder change is metadata update
- Single API call

**Verdict**: Proper thin wrapper ✅

---

### ❌ VIOLATES: Google Docs Convenience Tools

#### 9. `createGoogleDoc`
**Maps to**: MULTIPLE APIs - `drive.files.create` + `docs.documents.batchUpdate`
**Status**: ❌ **VIOLATES 1:1 PRINCIPLE**

**Violations**:
1. **Multi-step workflow** - Creates file, then updates content (2 API calls)
2. **Business logic** - File existence check, parent folder resolution
3. **Combines Drive + Docs APIs** - Not a single API method
4. **Hidden complexity** - User doesn't know it's doing 2 operations
5. **Automatic formatting** - Forces NORMAL_TEXT style

**Code Pattern**:
```typescript
// Step 1: Check if exists
const existingFileId = await checkFileExists(args.name, parentFolderId);

// Step 2: Create empty doc (Drive API)
const docResponse = await drive.files.create({
  requestBody: { name, mimeType: 'application/vnd.google-apps.document', parents }
});

// Step 3: Insert content (Docs API)
await docs.documents.batchUpdate({
  documentId: doc.id!,
  requestBody: {
    requests: [
      { insertText: { location: { index: 1 }, text: args.content } },
      { updateParagraphStyle: { /* force NORMAL_TEXT */ } }
    ]
  }
});
```

**Design Principle Violations**:
- ❌ NOT 1:1 API mapping (combines multiple operations)
- ❌ Contains business logic (existence check)
- ❌ Multi-step workflow
- ❌ Mixes API boundaries (Drive + Docs)

**Proper 1:1 Approach**:
```typescript
// Separate tools:
drive_createFile({ name, mimeType: 'application/vnd.google-apps.document', parents })
docs_insertText({ documentId, index: 1, text })
docs_updateParagraphStyle({ documentId, range, style })
```

**Verdict**: HIGH-LEVEL convenience tool ❌

---

#### 10. `updateGoogleDoc`
**Maps to**: `docs.documents.get` + `docs.documents.batchUpdate`
**Status**: ❌ **VIOLATES 1:1 PRINCIPLE**

**Violations**:
1. **Multi-step workflow** - Gets document, deletes content, inserts new content
2. **Data transformation** - Calculates content length from API response
3. **Hidden operations** - Delete + insert (user expects "update")
4. **Combines multiple requests** - deleteContentRange + insertText

**Code Pattern**:
```typescript
// Step 1: Get document to find content length
const existingDoc = await docs.documents.get({ documentId: args.documentId });
const contentLength = (existingDoc.data.body?.content?.[0]?.endIndex ?? 1) - 1;

// Step 2: Delete and insert in one batchUpdate
await docs.documents.batchUpdate({
  documentId: args.documentId,
  requestBody: {
    requests: [
      { deleteContentRange: { range: { startIndex: 1, endIndex: contentLength } } },
      { insertText: { location: { index: 1 }, text: args.content } }
    ]
  }
});
```

**Design Principle Violations**:
- ❌ NOT 1:1 API mapping
- ❌ Multi-step workflow (get + batchUpdate)
- ❌ Hidden complexity (delete + insert)
- ❌ Data transformation (calculate endIndex)

**Proper 1:1 Approach**:
```typescript
// Separate tools (already exist):
docs_get({ documentId })  // Returns raw doc
docs_deleteContentRange({ documentId, startIndex, endIndex })
docs_insertText({ documentId, index, text })
```

**Verdict**: HIGH-LEVEL convenience tool ❌

---

#### 11. `formatGoogleDocText`
**Maps to**: `docs.documents.batchUpdate` with `updateTextStyle`
**Status**: ⚠️ **BORDERLINE** (leans toward COMPLIANT)

**Analysis**:
- Maps to single API method (`batchUpdate` with `updateTextStyle`)
- Parameters map directly to API
- No multi-step workflow
- No business logic

**Code Pattern**:
```typescript
await docs.documents.batchUpdate({
  documentId: args.documentId,
  requestBody: {
    requests: [{
      updateTextStyle: {
        range: { startIndex, endIndex },
        textStyle: { bold, italic, fontSize, foregroundColor },
        fields: 'bold,italic,fontSize,foregroundColor'
      }
    }]
  }
});
```

**Observation**: This is essentially `docs_updateTextStyle` but with a different name

**Issue**: Name doesn't follow convention
- Current: `formatGoogleDocText`
- Should be: `docs_updateTextStyle`

**Verdict**: Functionally compliant, but naming violation ⚠️

---

#### 12. `formatGoogleDocParagraph`
**Maps to**: `docs.documents.batchUpdate` with `updateParagraphStyle`
**Status**: ⚠️ **BORDERLINE** (leans toward COMPLIANT)

**Analysis**: Same as `formatGoogleDocText` but for paragraphs

**Issue**: Name doesn't follow convention
- Current: `formatGoogleDocParagraph`
- Should be: `docs_updateParagraphStyle`

**Verdict**: Functionally compliant, but naming violation ⚠️

---

### ❌ VIOLATES: Google Sheets Convenience Tools

#### 13. `getGoogleSheetContent`
**Maps to**: `sheets.spreadsheets.values.get`
**Status**: ❌ **VIOLATES 1:1 PRINCIPLE** (borderline)

**Violations**:
1. **Custom formatting** - Returns formatted string instead of raw API response
2. **Data transformation** - Converts 2D array to custom text format

**Code Pattern**:
```typescript
const result = await sheets.spreadsheets.values.get({
  spreadsheetId: args.spreadsheetId,
  range: args.range
});

// Custom formatting (NOT raw API response)
let content = `Sheet content for range ${args.range}:\n\n`;
result.data.values?.forEach((row, i) => {
  content += `Row ${i + 1}: ${row.join(' | ')}\n`;
});

return { content: [{ type: "text", text: content }] };
```

**Design Principle Violations**:
- ❌ Data transformation beyond format conversion
- ❌ Custom output format (should return raw API response)

**Proper 1:1 Approach**:
```typescript
// Return raw API response
const result = await sheets.spreadsheets.values.get({ spreadsheetId, range });
return { content: [{ type: "text", text: JSON.stringify(result.data, null, 2) }] };
```

**Note**: We already have proper 1:1 tools:
- `sheets_batchGetValues` - Returns raw response ✅

**Verdict**: Violates (custom formatting) ❌

---

#### 14-19. `formatGoogleSheetCells`, `formatGoogleSheetText`, `formatGoogleSheetNumbers`, `setGoogleSheetBorders`, `mergeGoogleSheetCells`, `addGoogleSheetConditionalFormat`

**Maps to**: `sheets.spreadsheets.batchUpdate` with various request types
**Status**: ⚠️ **BORDERLINE** (same as Docs formatting tools)

**Analysis**: Similar to `formatGoogleDocText` - functionally correct 1:1 mapping but naming convention violation

**Proper Names**:
- `formatGoogleSheetCells` → `sheets_updateCells` (already exists as part of 1:1 tools)
- `formatGoogleSheetText` → `sheets_formatTextStyle`
- etc.

**Verdict**: Functionally compliant, naming violations ⚠️

---

### ❌ VIOLATES: Google Slides Convenience Tools

#### 20. `createGoogleSlides`
**Maps to**: Multiple APIs - `drive.files.create` + `slides.presentations.batchUpdate`
**Status**: ❌ **VIOLATES 1:1 PRINCIPLE**

**Violations**: Same as `createGoogleDoc`
- Multi-step workflow
- Combines Drive + Slides APIs
- Business logic (file existence check)

**Verdict**: HIGH-LEVEL convenience tool ❌

---

#### 21. `updateGoogleSlides`
**Maps to**: Multiple Slides API calls
**Status**: ❌ **VIOLATES 1:1 PRINCIPLE**

**Violations**: Same as `updateGoogleDoc`
- Multi-step workflow
- Hidden delete + recreate operations

**Verdict**: HIGH-LEVEL convenience tool ❌

---

#### 22-28. Slides Formatting Tools
**Status**: ⚠️ **BORDERLINE** (same as Docs/Sheets formatting)

**Verdict**: Functionally compliant, naming violations ⚠️

---

## Summary Table

| Tool | API Mapping | Workflow | Business Logic | Naming | Verdict |
|------|-------------|----------|----------------|--------|---------|
| **Drive File Management (8 tools)** |
| search | ✅ 1:1 | ✅ Single | ✅ None | ✅ Good | ✅ COMPLIANT |
| createTextFile | ✅ 1:1 | ✅ Single | ✅ Defensive only | ✅ Good | ✅ COMPLIANT |
| updateTextFile | ✅ 1:1 | ✅ Single | ✅ Defensive only | ✅ Good | ✅ COMPLIANT |
| createFolder | ✅ 1:1 | ✅ Single | ✅ None | ✅ Good | ✅ COMPLIANT |
| listFolder | ✅ 1:1 | ✅ Single | ✅ None | ✅ Good | ✅ COMPLIANT |
| deleteItem | ✅ 1:1 | ✅ Single | ✅ None | ✅ Good | ✅ COMPLIANT |
| renameItem | ✅ 1:1 | ✅ Single | ✅ None | ✅ Good | ✅ COMPLIANT |
| moveItem | ✅ 1:1 | ✅ Single | ✅ None | ✅ Good | ✅ COMPLIANT |
| **Google Docs Convenience (4 tools)** |
| createGoogleDoc | ❌ Multi-API | ❌ Multi-step | ❌ Yes | ❌ Wrong | ❌ VIOLATES |
| updateGoogleDoc | ❌ Multi-API | ❌ Multi-step | ❌ Yes | ❌ Wrong | ❌ VIOLATES |
| formatGoogleDocText | ✅ 1:1 | ✅ Single | ✅ None | ⚠️ Convention | ⚠️ BORDERLINE |
| formatGoogleDocParagraph | ✅ 1:1 | ✅ Single | ✅ None | ⚠️ Convention | ⚠️ BORDERLINE |
| **Google Sheets Convenience (7 tools)** |
| getGoogleSheetContent | ✅ 1:1 | ✅ Single | ✅ None | ❌ Wrong | ❌ VIOLATES |
| formatGoogleSheetCells | ✅ 1:1 | ✅ Single | ✅ None | ⚠️ Convention | ⚠️ BORDERLINE |
| formatGoogleSheetText | ✅ 1:1 | ✅ Single | ✅ None | ⚠️ Convention | ⚠️ BORDERLINE |
| formatGoogleSheetNumbers | ✅ 1:1 | ✅ Single | ✅ None | ⚠️ Convention | ⚠️ BORDERLINE |
| setGoogleSheetBorders | ✅ 1:1 | ✅ Single | ✅ None | ⚠️ Convention | ⚠️ BORDERLINE |
| mergeGoogleSheetCells | ✅ 1:1 | ✅ Single | ✅ None | ⚠️ Convention | ⚠️ BORDERLINE |
| addGoogleSheetConditionalFormat | ✅ 1:1 | ✅ Single | ✅ None | ⚠️ Convention | ⚠️ BORDERLINE |
| **Google Slides Convenience (9 tools)** |
| createGoogleSlides | ❌ Multi-API | ❌ Multi-step | ❌ Yes | ❌ Wrong | ❌ VIOLATES |
| updateGoogleSlides | ❌ Multi-API | ❌ Multi-step | ❌ Yes | ❌ Wrong | ❌ VIOLATES |
| getGoogleSlidesContent | ❌ Custom format | ✅ Single | ✅ None | ❌ Wrong | ❌ VIOLATES |
| formatGoogleSlidesText | ✅ 1:1 | ✅ Single | ✅ None | ⚠️ Convention | ⚠️ BORDERLINE |
| formatGoogleSlidesParagraph | ✅ 1:1 | ✅ Single | ✅ None | ⚠️ Convention | ⚠️ BORDERLINE |
| styleGoogleSlidesShape | ✅ 1:1 | ✅ Single | ✅ None | ⚠️ Convention | ⚠️ BORDERLINE |
| setGoogleSlidesBackground | ✅ 1:1 | ✅ Single | ✅ None | ⚠️ Convention | ⚠️ BORDERLINE |
| createGoogleSlidesTextBox | ✅ 1:1 | ✅ Single | ✅ None | ⚠️ Convention | ⚠️ BORDERLINE |
| createGoogleSlidesShape | ✅ 1:1 | ✅ Single | ✅ None | ⚠️ Convention | ⚠️ BORDERLINE |

---

## Recommendations

### Critical Violations (5 tools) - Recommend Removal

1. **`createGoogleDoc`** - ❌ Remove
   - Reason: Multi-step workflow, mixes Drive + Docs APIs
   - Replacement: Use `drive_createFile` + `docs_insertText` + `docs_updateParagraphStyle`

2. **`updateGoogleDoc`** - ❌ Remove
   - Reason: Multi-step workflow, hidden operations
   - Replacement: Use `docs_get` + `docs_deleteContentRange` + `docs_insertText`

3. **`createGoogleSlides`** - ❌ Remove
   - Reason: Multi-step workflow, mixes Drive + Slides APIs
   - Replacement: Use Drive + Slides 1:1 tools

4. **`updateGoogleSlides`** - ❌ Remove
   - Reason: Multi-step workflow, hidden operations
   - Replacement: Use Slides 1:1 tools

5. **`getGoogleSheetContent`** - ❌ Remove
   - Reason: Custom formatting, not raw API response
   - Replacement: Use `sheets_batchGetValues` (already exists)

### Borderline Cases (16 tools) - Recommend Rename/Deprecate

**Formatting tools** with naming violations:
- Functionally correct (1:1 API mapping)
- Wrong naming convention
- Already have proper 1:1 equivalents in new tools

**Options**:
1. **Deprecate** - Mark as deprecated, keep for backward compatibility
2. **Rename** - Change to proper convention (`docs_*`, `sheets_*`, `slides_*`)
3. **Remove** - If proper equivalents exist

**List**:
- `formatGoogleDocText` → Deprecate (use `docs_updateTextStyle`)
- `formatGoogleDocParagraph` → Deprecate (use `docs_updateParagraphStyle`)
- `formatGoogleSheetCells` → Check if `sheets_*` equivalent exists
- (etc., 16 total)

### Compliant Tools (8 tools) - Keep As-Is

All Drive file management tools are compliant ✅
- No changes needed
- Well-designed thin wrappers
- Follow best practices

---

## Migration Strategy

### Phase 1: Mark Critical Violations as Deprecated
- Add deprecation notices to tool descriptions
- Document replacements in tool descriptions
- Keep tools functional for backward compatibility

### Phase 2: Create Replacement Documentation
- Document how to replace each deprecated tool
- Provide code examples
- Update README with migration guide

### Phase 3: Remove Deprecated Tools (Breaking Change)
- Remove in next major version (v3.0.0)
- Clear migration path documented
- Announce in release notes

---

## Impact Analysis

### Users Affected
- Anyone using convenience tools (`createGoogleDoc`, `updateGoogleDoc`, etc.)
- Estimated: High (these were likely primary use case tools)

### Migration Difficulty
- **Low effort** - Replacement tools already exist
- **High conceptual** - Users must understand composition vs convenience

### Example Migration

**Before (using convenience tool)**:
```javascript
createGoogleDoc({
  name: "My Document",
  content: "Hello World",
  parentFolderId: "folder-id"
})
```

**After (using 1:1 tools)**:
```javascript
// Step 1: Create empty doc
const doc = await drive_createFile({
  name: "My Document",
  mimeType: "application/vnd.google-apps.document",
  parents: ["folder-id"]
});

// Step 2: Add content
await docs_insertText({
  documentId: doc.id,
  index: 1,
  text: "Hello World"
});

// Step 3: Format as normal text
await docs_updateParagraphStyle({
  documentId: doc.id,
  startIndex: 1,
  endIndex: 12,
  namedStyleType: "NORMAL_TEXT"
});
```

**Benefits of New Approach**:
- ✅ Explicit operations (user knows what's happening)
- ✅ Composable (can customize each step)
- ✅ Follows 1:1 API principles
- ✅ Easier to debug (can inspect after each step)

---

## Lessons Learned

1. **Convenience ≠ Good Design**
   - Convenience tools hide complexity
   - Composition of simple tools is better
   - Users should orchestrate, not tools

2. **API Boundaries Matter**
   - Don't mix Drive + Docs + Sheets in one tool
   - Keep API namespaces separate
   - Respect Google's API design

3. **Naming Conventions Are Critical**
   - `formatGoogleDocText` is vague
   - `docs_updateTextStyle` is explicit
   - Consistency helps users understand capabilities

4. **Design Principles Should Come First**
   - Establishing principles early prevents technical debt
   - Retrofitting is harder than building correctly
   - Document decisions before implementing

---

**Last Updated**: 2025-11-18
**Status**: Analysis complete, recommendations ready for Issue #2
