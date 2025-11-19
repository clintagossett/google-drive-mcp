# Index System Audit - Complete MCP Codebase Analysis

**Date**: 2025-11-18
**Purpose**: Identify all tools using custom/manual index systems vs. Google API indices
**Status**: Complete

---

## Executive Summary

**GOOD NEWS**: The TOC index bug is **isolated to a single tool** - `getGoogleDocContent`.

### Findings:
- ✅ **Only 1 tool** uses custom/manual index counting: `getGoogleDocContent`
- ✅ **0 other tools** have similar bugs
- ✅ **Google Sheets tools**: Use Google's native range notation (A1, B2, etc.) - no custom indices
- ✅ **Google Slides tools**: Use Google's objectId system - no custom indices
- ✅ **Google Docs formatting tools**: Accept user-provided indices, pass directly to API (correct)

### Impact:
- **Scope**: Only `getGoogleDocContent` needs to be fixed
- **Related tools**: `formatGoogleDocText` and `formatGoogleDocParagraph` consume indices but are correct
- **Fix complexity**: Low - single tool fix

---

## Detailed Analysis

### 1. Google Docs Tools

#### `getGoogleDocContent` (BUGGY ❌)
**Location**: `src/index.ts:5727-5782`

**Purpose**: Read document content with character indices for formatting

**Current Implementation**:
```typescript
let currentIndex = 1;  // ← CUSTOM index system (WRONG)
for (const element of document.data.body.content) {
  if (element.paragraph?.elements) {  // ← Only paragraphs
    for (const textElement of element.paragraph.elements) {
      if (textElement.textRun?.content) {
        const text = textElement.textRun.content;
        segments.push({
          text,
          startIndex: currentIndex,      // ← Manual counting
          endIndex: currentIndex + text.length
        });
        currentIndex += text.length;  // ← Manual increment
      }
    }
  }
}
```

**Problem**:
- Creates custom index system starting from 1
- Only counts paragraph text, skips TOC/tables/section breaks
- Indices don't match Google API indices
- Results in offset when used with formatting tools

**What Google API Provides**:
```typescript
// API already has indices!
{
  "paragraph": {
    "elements": [{
      "startIndex": 67,     // ← API provides this
      "endIndex": 78,       // ← API provides this
      "textRun": {
        "content": "TESTMARKER\n"
      }
    }]
  }
}
```

**Fix**: Use `textElement.startIndex` and `textElement.endIndex` from API

---

#### `formatGoogleDocText` (CORRECT ✅)
**Location**: `src/index.ts:5607-5655`

**Purpose**: Apply text formatting (bold, italic, color, etc.)

**Implementation**:
```typescript
await docs.documents.batchUpdate({
  documentId: args.documentId,
  requestBody: {
    requests: [{
      updateTextStyle: {
        range: {
          startIndex: args.startIndex,  // ← Passes user index directly
          endIndex: args.endIndex        // ← No transformation
        },
        textStyle,
        fields: fields.join(',')
      }
    }]
  }
});
```

**Status**: ✅ **CORRECT** - Accepts indices from user, passes to API

**Note**: This tool is correct. The bug is that users get wrong indices from `getGoogleDocContent`.

---

#### `formatGoogleDocParagraph` (CORRECT ✅)
**Location**: `src/index.ts:5657-5725`

**Purpose**: Apply paragraph formatting (headings, alignment, spacing)

**Implementation**:
```typescript
await docs.documents.batchUpdate({
  documentId: args.documentId,
  requestBody: {
    requests: [{
      updateParagraphStyle: {
        range: {
          startIndex: args.startIndex,  // ← Passes user index directly
          endIndex: args.endIndex        // ← No transformation
        },
        paragraphStyle,
        fields: fields.join(',')
      }
    }]
  }
});
```

**Status**: ✅ **CORRECT** - Accepts indices from user, passes to API

---

#### All Google Docs API 1:1 Tools (CORRECT ✅)
**Location**: Various (34 tools total)

**Examples**:
- `docs_deleteContentRange` - Uses `startIndex`/`endIndex` from user
- `docs_createParagraphBullets` - Uses `startIndex`/`endIndex` from user
- `docs_updateTextStyle` - Uses `startIndex`/`endIndex` from user
- `docs_updateSectionStyle` - Uses `startIndex`/`endIndex` from user

**Status**: ✅ **ALL CORRECT** - All accept user-provided indices, pass to API

**Implementation Pattern** (example from `docs_deleteContentRange`):
```typescript
case "docs_deleteContentRange": {
  const args = DocsDeleteContentRangeSchema.parse(request.params.arguments);

  await docs.documents.batchUpdate({
    documentId: args.documentId,
    requestBody: {
      requests: [{
        deleteContentRange: {
          range: {
            startIndex: args.startIndex,  // ← User provides
            endIndex: args.endIndex
          }
        }
      }]
    }
  });
}
```

**Why they're correct**: They don't generate indices - they accept them from the user and pass to API.

---

### 2. Google Sheets Tools

#### `getGoogleSheetContent` (CORRECT ✅)
**Location**: `src/index.ts:3651-3679`

**Purpose**: Read spreadsheet data

**Implementation**:
```typescript
const sheets = google.sheets({ version: 'v4', auth: authClient });
const response = await sheets.spreadsheets.values.get({
  spreadsheetId: args.spreadsheetId,
  range: args.range  // ← Uses A1 notation (e.g., "Sheet1!A1:C10")
});

const values = response.data.values || [];
values.forEach((row, rowIndex) => {
  content += `Row ${rowIndex + 1}: ${row.join(', ')}\n`;
});
```

**Index System**: Uses **Google Sheets A1 notation** (A1, B2, Sheet1!A1:C10)

**Status**: ✅ **CORRECT** - Uses Google's native range system, no custom indices

---

#### All Google Sheets Formatting Tools (CORRECT ✅)
**Examples**:
- `formatGoogleSheetCells`
- `formatGoogleSheetText`
- `formatGoogleSheetNumbers`
- `sheets_batchUpdateValues`
- `sheets_insertDimension`

**Index System**: All use **GridRange** with 0-based, end-exclusive indices:
```typescript
{
  sheetId: number,
  startRowIndex: 0,      // ← 0-based
  endRowIndex: 10,       // ← Exclusive
  startColumnIndex: 0,
  endColumnIndex: 5
}
```

**Status**: ✅ **ALL CORRECT** - Use Google's GridRange system directly

**Why they're correct**:
- Google Sheets API uses GridRange (not character indices)
- All tools accept GridRange from user, pass to API
- No custom index calculation
- GridRange is always absolute (no TOC-like offsets possible)

---

### 3. Google Slides Tools

#### `getGoogleSlidesContent` (CORRECT ✅)
**Location**: `src/index.ts:7156-7214`

**Purpose**: Read presentation content

**Implementation**:
```typescript
const slidesService = google.slides({ version: 'v1', auth: authClient });
const presentation = await slidesService.presentations.get({
  presentationId: args.presentationId
});

slides.forEach((slide, index) => {
  content += `\nSlide ${index} (ID: ${slide.objectId}):\n`;  // ← Uses objectId

  if (slide.pageElements) {
    slide.pageElements.forEach((element) => {
      content += `  Text Box (ID: ${element.objectId}):\n`;  // ← Uses objectId
      // Extract text but don't calculate indices
      textElements.forEach((textElement) => {
        if (textElement.textRun?.content) {
          text += textElement.textRun.content;
        }
      });
    });
  }
});
```

**Index System**: Uses **Google's objectId system** (e.g., "g123abc", "p456def")

**Status**: ✅ **CORRECT** - Uses Google's object IDs, no custom indices

---

#### `formatGoogleSlidesText` (CORRECT ✅)
**Location**: `src/index.ts:7216-7295`

**Purpose**: Apply text formatting to slides

**Implementation**:
```typescript
const textStyle: any = {};
// ... build style ...

const updateRequests: any[] = [{
  updateTextStyle: {
    objectId: args.objectId,  // ← Uses Google's objectId
    textRange: args.startIndex !== undefined && args.endIndex !== undefined
      ? { startIndex: args.startIndex, endIndex: args.endIndex }  // ← Optional indices
      : undefined,  // ← Or entire object
    style: textStyle,
    fields: fields.join(',')
  }
}];
```

**Index System**:
- Primary: **Google's objectId** to identify elements
- Optional: Character indices within text elements (if specified)

**Status**: ✅ **CORRECT** - Uses Google's objectId + optional character indices

**Why it's correct**:
- Slides API uses objectIds to identify elements (not document-wide indices)
- Character indices are optional and scoped to specific text elements
- No TOC-like offset issues possible (each element is independent)

---

#### All Google Slides Formatting Tools (CORRECT ✅)
**Examples**:
- `formatGoogleSlidesParagraph`
- `styleGoogleSlidesShape`
- `setGoogleSlidesBackground`
- `createGoogleSlidesTextBox`
- `createGoogleSlidesShape`

**Index System**: All use **Google's objectId system**

**Status**: ✅ **ALL CORRECT** - Use Google's object IDs, no custom index calculations

---

## Summary: Custom Index Usage

### Tools Using Custom/Manual Index Counting:
1. ❌ **`getGoogleDocContent`** - BUGGY (manual counting from 1)

### Tools Using Google API Indices Correctly:
1. ✅ `formatGoogleDocText` - Accepts user indices, passes to API
2. ✅ `formatGoogleDocParagraph` - Accepts user indices, passes to API
3. ✅ All 34 Google Docs API 1:1 tools - Accept user indices, pass to API

### Tools Using Different Index Systems (Correct):
1. ✅ **Google Sheets tools** - Use A1 notation and GridRange (0-based, end-exclusive)
2. ✅ **Google Slides tools** - Use objectId system (no document-wide indices)

---

## The Bug Flow

### Current (Buggy) Workflow:
```
User: "Format the word TESTMARKER"
  ↓
1. Call getGoogleDocContent (buggy)
   → Returns: TESTMARKER at indices 17-28 (wrong!)
  ↓
2. Call formatGoogleDocText with indices 17-28
   → Formats text at API indices 17-28 (in TOC area)
  ↓
Result: ❌ Wrong text formatted
```

### After Fix:
```
User: "Format the word TESTMARKER"
  ↓
1. Call getGoogleDocContent (fixed)
   → Returns: TESTMARKER at indices 67-78 (correct!)
  ↓
2. Call formatGoogleDocText with indices 67-78
   → Formats text at API indices 67-78 (TESTMARKER)
  ↓
Result: ✅ Correct text formatted
```

---

## Why Other Tools Don't Have This Bug

### Google Sheets:
- Uses **A1 notation** ("A1", "B2:C10") - human-readable, absolute
- Uses **GridRange** - 0-based indices relative to sheet
- No TOC-like structures to skip
- No manual index counting

### Google Slides:
- Uses **objectId** system - unique IDs for each element
- Each element is independent (no document-wide index)
- No TOC-like structures
- No manual index counting

### Google Docs (other tools):
- Accept indices **from user** (don't generate them)
- Pass indices **directly to API** (no transformation)
- Work correctly if given correct indices
- Bug is in the **source** of indices (`getGoogleDocContent`), not the **consumers**

---

## Scope of Fix

### What Needs to Change:
1. ✅ **`getGoogleDocContent`** - Use API indices instead of manual counting

### What Does NOT Need to Change:
1. ✅ `formatGoogleDocText` - Already correct
2. ✅ `formatGoogleDocParagraph` - Already correct
3. ✅ All Google Docs API 1:1 tools - Already correct
4. ✅ All Google Sheets tools - Already correct (different index system)
5. ✅ All Google Slides tools - Already correct (different index system)

### Breaking Change Impact:
- **Affected tools**: 1 (`getGoogleDocContent`)
- **Consumer tools**: 2 (`formatGoogleDocText`, `formatGoogleDocParagraph`) - but they're correct
- **User impact**: Documents **with** TOC will see different indices (breaking change)
- **User impact**: Documents **without** TOC - no change

---

## Recommendations

### Immediate Action:
1. ✅ Fix `getGoogleDocContent` to use API indices
2. ✅ Add 5+ unit tests for index system
3. ✅ Document breaking change
4. ✅ Create migration guide

### Future Considerations:
1. ✅ Add warning to docs about TOC index changes
2. ✅ Consider adding validation to detect index mismatches
3. ✅ Update examples to use fixed indices

### No Action Required:
- ❌ Google Sheets tools - using correct system
- ❌ Google Slides tools - using correct system
- ❌ Google Docs formatting tools - using correct system

---

## Conclusion

**The TOC index bug is completely isolated to `getGoogleDocContent`.**

- Only 1 tool affected
- Fix is straightforward (use API indices)
- No ripple effects to other tools
- Sheets and Slides use different, correct systems
- Impact is limited and well-understood

**Next Step**: Implement the fix as outlined in `TOC_BUG_IMPLEMENTATION_PLAN.md`

---

**Last Updated**: 2025-11-18
**Audited By**: Claude Code
**Tools Analyzed**: 100+ tools across Docs, Sheets, Slides APIs
**Result**: Single point of failure identified
