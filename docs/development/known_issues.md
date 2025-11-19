# Known Issues with Google Drive MCP Tools

This document tracks known bugs, limitations, and workarounds for the Google Drive MCP server.

---

## CRITICAL: Index Offset Bug with Table of Contents

**Status**: ✅ RESOLVED by removing `getGoogleDocContent` (2025-11-18)
**Severity**: High - Made formatting unusable in documents with TOC
**Discovered**: 2025-11-18
**Root Cause Found**: 2025-11-18
**Resolution**: 2025-11-18 - Removed `getGoogleDocContent` tool (violated 1:1 API design principles)
**Affected Tools**: `getGoogleDocContent` (now removed)
**Reason for Removal**: Tool violated 1:1 API mapping design principles by adding custom processing/filtering

### Problem Description

When a Google Docs document contains a Table of Contents (TOC), there is a **~1235 character index offset** between:
- **Read operations** (`getGoogleDocContent`) - which exclude TOC from indices
- **Write operations** (`formatGoogleDocText`, `formatGoogleDocParagraph`) - which include TOC in indices

This causes all formatting attempts to hit the wrong text location.

### Root Cause Analysis (CONFIRMED)

**Investigation Date**: 2025-11-18
**See**: `docs/workflows/TOC_BUG_INVESTIGATION.md` for complete analysis

**The Real Problem**:
There are TWO different index systems in use:

1. **Custom Manual Indices** (used by `getGoogleDocContent`):
   - Manually calculated by iterating and counting text
   - Starts at 1, increments manually
   - Only includes paragraph text, excludes TOC/tables/section breaks
   - Example: "TESTMARKER" at custom index 62

2. **Google API Absolute Indices** (used by write operations):
   - Official Google Docs document indices from API
   - Includes ALL content (TOC, tables, everything)
   - Example: "TESTMARKER" at API index 1297

**Code Analysis**:
```typescript
// src/index.ts:5738-5758 - THE BUG
let currentIndex = 1;  // ← Manual counting (WRONG)
for (const element of document.data.body.content) {
  if (element.paragraph?.elements) {  // ← Only paragraphs, skips TOC
    for (const textElement of element.paragraph.elements) {
      if (textElement.textRun?.content) {
        segments.push({
          startIndex: currentIndex,  // ← WRONG: Should use element.startIndex
          endIndex: currentIndex + text.length
        });
        currentIndex += text.length;  // ← Manual increment
      }
    }
  }
}
```

**What should happen**: Use `element.startIndex` and `element.endIndex` from the API
**What actually happens**: Manually count and skip non-paragraph elements

**Original hypothesis was BACKWARDS**:
- ❌ We thought: "getGoogleDocContent excludes TOC (correct), write operations include it (wrong)"
- ✅ Reality: "getGoogleDocContent uses custom indices (wrong), write operations use API indices (correct)"

### How to Reproduce

1. **Create a test document** with a Table of Contents:
   ```
   [Document Title]
   [Table of Contents - auto-generated, ~35 entries]

   Section 1: Data Source
   Content here...

   Section 2: Executive Summary
   Content here...
   ```

2. **Add test markers**:
   - Insert unique text like "TESTMARKER" before the first heading
   - Note its position visually (e.g., page 2, first line)

3. **Read the document**:
   ```javascript
   getGoogleDocContent(documentId)
   // Note the index range for "TESTMARKER", e.g., [62-72]
   ```

4. **Try to format at that index**:
   ```javascript
   formatGoogleDocText({
     documentId: documentId,
     startIndex: 62,
     endIndex: 72,
     foregroundColor: { red: 0, green: 1, blue: 0 }  // Green
   })
   ```

5. **Expected**: TESTMARKER turns green
   **Actual**: Text in the TOC turns green, or wrong text in document body

6. **Measure the offset**:
   - Note what text actually turned green
   - Find that text's index in the `getGoogleDocContent` output
   - Calculate: `actual_write_index - read_index = offset`
   - In our test: offset was **1235 characters**

### Validation Test

```javascript
// Test document structure:
// [start] marker at index 45
// [stop] marker at index 53
// TOC between start and stop (not shown in getGoogleDocContent)
// TESTMARKER at read index 62
// Data Source at read index 73

// Read test
const content = await getGoogleDocContent(docId);
const testMarkerIndex = findIndex(content, "TESTMARKER"); // Returns [62-72]

// Write test WITHOUT offset - FAILS
await formatGoogleDocText({
  documentId: docId,
  startIndex: 62,
  endIndex: 72,
  foregroundColor: { red: 0, green: 1, blue: 0 }
});
// Result: Wrong text turns green (not TESTMARKER)

// Write test WITH offset - WORKS
const OFFSET = 1235;
await formatGoogleDocText({
  documentId: docId,
  startIndex: 62 + OFFSET,  // 1297
  endIndex: 72 + OFFSET,    // 1307
  foregroundColor: { red: 0, green: 1, blue: 0 }
});
// Result: TESTMARKER turns green (correct!)
```

### Impact

- **Documents without TOC**: No issues
- **Documents with TOC**: All formatting operations hit wrong locations
- **User experience**: Formatting appears to work (returns success) but affects wrong text
- **Debugging difficulty**: High - formatting "succeeds" but silently affects wrong content

### Technical Details

**Offset Calculation**:
The offset appears to equal the character count of the entire TOC structure. In our test case:
- TOC had ~35 entries
- Average line length ~60 characters
- Total TOC size: ~1235 characters
- Offset needed: +1235

**Formula for workaround**:
```javascript
writeIndex = readIndex + TOC_SIZE_IN_CHARACTERS
```

**How to calculate TOC size**:
1. Add markers before and after TOC in document manually
2. Use `getGoogleDocContent` to find marker positions
3. The gap between markers reveals TOC is excluded
4. Measure TOC character count manually or programmatically
5. Use that as offset for all write operations

### The Resolution

**Resolution Date**: 2025-11-18
**Action Taken**: Removed `getGoogleDocContent` tool entirely

**Why Removed Instead of Fixed**:
1. Tool violated 1:1 API mapping design principles
2. Added custom processing/filtering of API responses
3. Created convenience wrapper instead of thin API layer
4. See `docs/development/GETGOOGLEDOCCONTENT_ANALYSIS.md` for full analysis

**Proper Approach**:
- Use `docs_get` tool (when implemented) to get raw document structure
- Parse the document structure directly using Google API indices
- No custom index counting or processing needed

**Migration Path**:
- `getGoogleDocContent` users should wait for `docs_get` implementation
- `docs_get` will return complete document structure with all API indices
- AI agents can parse the structure as needed

### Current Status

**Tool Removed**: `getGoogleDocContent` has been removed from the codebase as of 2025-11-18.

**No Workaround Needed**: The bug no longer exists because the tool has been removed.

**Future Implementation**: When `docs_get` is implemented (proper 1:1 API mapping), it will return raw Google API responses with correct indices, eliminating this entire class of bugs.

### Related Issues

- None known at this time

### References

- Google Docs API Structure Documentation: https://developers.google.com/docs/api/concepts/structure
- Specific quote about TOC indices: "The 'personalizing' types for structural elements—`SectionBreak`, `TableOfContents`, `Table`, and `Paragraph`—don't have these indexes because their enclosing `StructuralElement` has these fields."

### Test Case Document

Document ID used for discovery: `130QyNt_6z8TJNp04gBqDciiI8MNTf4E7oW0U3S-IB_0`

Document structure:
- Title: "User Migration Analysis - Platform Shutdown"
- TOC: 35+ entries, ~1235 characters
- Test markers: `[start]` at index 45, `[stop]` at index 53
- First content: "TESTMARKER" at read index 62, write index 1297
- Offset confirmed: 1235 characters

---

**Last Updated**: 2025-11-18
**Reporter**: Claude (via user testing session)
**Priority**: High - blocking reliable formatting in production documents
