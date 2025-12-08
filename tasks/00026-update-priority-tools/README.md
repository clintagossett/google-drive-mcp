# Task 00026: Update High-Priority Tools with returnMode

**GitHub Issue:** #26
**Epic:** #22 (MCP Best Practices Alignment)
**Phase:** 1 - Fix Context Overflow (CRITICAL)
**Blocked By:** #23 ✅, #24 ✅, #25 ✅
**Blocks:** None (completes Phase 1)

---

## Resume (Start Here)

**Last Updated:** 2025-12-08

### Current Status: COMPLETE ✅

**Phase:** All 4 high-priority tools updated with returnMode support.

### Summary

Updated 4 tools with returnMode functionality:
- `docs_get` - Summary returns title, characterCount, sectionCount + caches content
- `drive_exportFile` - Summary returns fileName, characterCount + caches text formats
- `sheets_getSpreadsheet` - Summary returns title, sheetCount, sheetNames + caches metadata
- `sheets_batchGetValues` - Summary returns rangeCount, totalCells, range stats + caches values

All tools now:
- Default to "summary" mode (safe by default)
- Cache content for Resource chunk access
- Apply truncation with actionable hints in "full" mode

---

## Objective

Apply the returnMode pattern and truncation to the highest-impact tools causing context overflow.

---

## Tools to Update

### 1. docs_getDocument

- Add returnMode parameter
- Summary: title, documentId, charCount, sectionCount, resourceUri
- Cache: full document object
- Resource: `gdrive://docs/{id}/chunk/{start}-{end}`

### 2. drive_exportFile

- Add returnMode parameter
- Summary: fileName, mimeType, charCount, resourceUri
- Cache: exported content
- Resource: `gdrive://files/{id}/content/{start}-{end}`

### 3. sheets_getSpreadsheet

- Add returnMode parameter
- Summary: title, spreadsheetId, sheetCount, sheetNames
- Cache: full spreadsheet object
- Resource: `gdrive://sheets/{id}/sheet/{sheetId}`

### 4. sheets_batchGetValues

- Add returnMode parameter
- Summary: rangeCount, totalCells, resourceUri
- Cache: all values
- Resource: `gdrive://sheets/{id}/values/{range}`

---

## Deliverables

- [x] `docs_get` updated with returnMode
- [x] `drive_exportFile` updated with returnMode
- [x] `sheets_getSpreadsheet` updated with returnMode
- [x] `sheets_batchGetValues` updated with returnMode
- [ ] Tool descriptions updated (future enhancement)
- [x] All existing tests still pass (1282 tests)
- [x] Schema tests validate returnMode (from #24)

---

## Testing (per tool)

- [x] Summary mode returns correct format
- [x] Summary mode caches content
- [x] Full mode works with truncation
- [x] Resource URI in summary is valid format
- [x] Backward compatibility maintained (existing calls work)

---

## Success Criteria

After this issue is complete:
- ✅ Large documents can be read without context overflow (summary mode default)
- ✅ Agents can access content incrementally via Resources (caching + URI)
- ✅ Legacy `returnMode: "full"` still works (with truncation safety)

---

## Files Changed

| File | Changes |
|------|---------|
| `src/index.ts` | Updated 4 tool handlers: `docs_get`, `drive_exportFile`, `sheets_getSpreadsheet`, `sheets_batchGetValues` with returnMode support, summary responses, caching, and truncation |
