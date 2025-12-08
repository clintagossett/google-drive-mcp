# Task 00026: Update High-Priority Tools with returnMode

**GitHub Issue:** #26
**Epic:** #22 (MCP Best Practices Alignment)
**Phase:** 1 - Fix Context Overflow (CRITICAL)
**Blocked By:** #23, #24, #25
**Blocks:** None (completes Phase 1)

---

## Resume (Start Here)

**Last Updated:** 2025-12-08 (Session 1)

### Current Status: PENDING

**Phase:** Waiting for #23, #24, #25 to complete.

### Next Steps

1. Update `docs_getDocument` with returnMode
2. Update `drive_exportFile` with returnMode
3. Update `sheets_getSpreadsheet` with returnMode
4. Update `sheets_batchGetValues` with returnMode
5. Update tool descriptions
6. Write tests for both modes
7. Verify backward compatibility

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

- [ ] `docs_getDocument` updated with returnMode
- [ ] `drive_exportFile` updated with returnMode
- [ ] `sheets_getSpreadsheet` updated with returnMode
- [ ] `sheets_batchGetValues` updated with returnMode
- [ ] Tool descriptions updated
- [ ] All existing tests still pass
- [ ] New tests for both modes

---

## Testing (per tool)

- [ ] Summary mode returns correct format
- [ ] Summary mode caches content
- [ ] Full mode works with truncation
- [ ] Resource URI access works
- [ ] Backward compatibility maintained

---

## Success Criteria

After this issue is complete:
- Large documents can be read without context overflow
- Agents can access content incrementally via Resources
- Legacy `returnMode: "full"` still works (with truncation safety)

---

## Files Changed

_(To be filled during implementation)_
