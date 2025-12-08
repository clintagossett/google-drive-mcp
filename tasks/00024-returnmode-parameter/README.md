# Task 00024: Add returnMode Parameter to Document Tools

**GitHub Issue:** #24
**Epic:** #22 (MCP Best Practices Alignment)
**Phase:** 1 - Fix Context Overflow (CRITICAL)
**Blocked By:** #23 (Cache Infrastructure)
**Blocks:** #26 (Update Priority Tools)

---

## Resume (Start Here)

**Last Updated:** 2025-12-08 (Session 1)

### Current Status: PENDING

**Phase:** Waiting for #23 (Cache Infrastructure) to complete.

### Next Steps

1. Update Zod schemas with `returnMode` parameter
2. Implement summary response format
3. Implement caching on summary mode
4. Preserve legacy behavior for `returnMode: "full"`
5. Update tool descriptions
6. Write tests

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

- [ ] Update Zod schemas with `returnMode` parameter
- [ ] Default behavior returns summary + caches content
- [ ] Summary includes `resourceUri` for chunk access
- [ ] `returnMode: "full"` preserves legacy behavior
- [ ] Tool descriptions updated to explain both modes

---

## Testing

- [ ] Default mode returns summary format
- [ ] Default mode caches content
- [ ] Full mode returns complete response
- [ ] Resource URI in summary is valid and usable
- [ ] Backward compatibility maintained

---

## Files Changed

_(To be filled during implementation)_
