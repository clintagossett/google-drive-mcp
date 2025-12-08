# Task 00024: Add returnMode Parameter to Document Tools

**GitHub Issue:** #24
**Epic:** #22 (MCP Best Practices Alignment)
**Phase:** 1 - Fix Context Overflow (CRITICAL)
**Blocked By:** #23 (Cache Infrastructure) ✅
**Blocks:** #26 (Update Priority Tools)

---

## Resume (Start Here)

**Last Updated:** 2025-12-08

### Current Status: COMPLETE ✅

**Phase:** Schema changes implemented and tested.

### Summary

Added returnMode parameter to 4 high-priority tool schemas:
- `docs_get` (DocsGetSchema)
- `drive_exportFile` (DriveExportFileSchema)
- `sheets_getSpreadsheet` (SheetsGetSpreadsheetSchema)
- `sheets_batchGetValues` (SheetsBatchGetValuesSchema)

All default to "summary" mode for safe operation. 25 unit tests passing.

---

## Objective

Add `returnMode` parameter to document-reading tools that defaults to safe behavior, preventing context overflow.

---

## Affected Tools

| Tool | Current Behavior | New Default |
|------|------------------|-------------|
| `docs_getDocument` | Returns full JSON | Summary + cache |
| `drive_exportFile` | Returns full content | Summary + cache |
| `sheets_getSpreadsheet` | Returns full metadata | Summary + cache |
| `sheets_batchGetValues` | Returns all values | Summary + cache |

---

## Schema Change

```typescript
returnMode: z.enum(["summary", "full"]).default("summary")
  .describe("'summary' (default): Returns metadata, caches content for Resource access. 'full': Returns complete response (may cause context overflow)")
```

---

## Summary Response Format

```json
{
  "title": "Document Title",
  "documentId": "abc123",
  "characterCount": 45000,
  "sectionCount": 12,
  "resourceUri": "gdrive://docs/abc123/chunk/{start}-{end}",
  "hint": "Use resources/read with chunk URI to access content"
}
```

---

## Deliverables

- [x] Update Zod schemas with `returnMode` parameter
- [x] Default behavior set to "summary" (safe by default)
- [ ] Summary includes `resourceUri` for chunk access (implemented in #26)
- [ ] `returnMode: "full"` preserves legacy behavior (implemented in #26)
- [ ] Tool descriptions updated to explain both modes (implemented in #26)

---

## Testing

- [x] Default mode returns "summary" as default
- [x] Schemas accept both "summary" and "full" values
- [x] Schemas reject invalid returnMode values
- [x] Backward compatibility maintained (existing calls still valid)
- [x] All parameters preserved when returnMode specified

**Test Results:** 25 tests added, all passing (1282 total tests in suite)

---

## Files Changed

| File | Changes |
|------|---------|
| `src/index.ts` | Added `returnMode` parameter to 4 schemas: DocsGetSchema, DriveExportFileSchema, SheetsGetSpreadsheetSchema, SheetsBatchGetValuesSchema |
| `tests/unit/returnmode_parameter.test.ts` | New file with 25 unit tests covering: default values, valid/invalid values, parameter preservation, backward compatibility, summary format structure |
