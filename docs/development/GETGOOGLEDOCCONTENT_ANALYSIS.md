# getGoogleDocContent Analysis - Should It Exist?

**Date**: 2025-11-18
**Question**: Should `getGoogleDocContent` even be used? Is there another tool that does the same thing?

---

## TL;DR

**Answer**: `getGoogleDocContent` is a **convenience wrapper** that serves a specific purpose, but it's **redundant** with the proper 1:1 API approach.

**Recommendation**:
- ✅ **Keep it** for backward compatibility (it's now fixed)
- ✅ **Consider adding `docs_get`** as the proper 1:1 API tool
- ✅ **Document the difference** between the two approaches

---

## What getGoogleDocContent Does

### Purpose (from description)
> "Get content of a Google Doc with text indices for formatting"

### What it actually does
1. Calls `documents.get` API
2. Extracts only paragraph text content
3. Returns formatted text with indices for each segment
4. Designed to work with `formatGoogleDocText` and `formatGoogleDocParagraph`

### Example Output
```
Document content with indices:

[1-2] \n
[67-79] Introduction\n
[79-115] This is the introduction section.\n

Total segments: 16
```

---

## The Proper 1:1 API Approach

### What SHOULD exist (per design principles)

According to `design/docs_api_reference.md`:

```markdown
### 1. `documents.get`
**Description**: Retrieves a Google Docs document

**Returns**: Complete Document object with:
- Document ID, title, tabs
- Revision ID
- Body content
- Headers, footers, footnotes
- Styles, lists, named ranges
- Embedded/positioned objects

**Current MCP Tool**: `getGoogleDocContent` ✅
**Proposed Low-Level MCP Tool**: `docs_get`
```

### What `docs_get` would do
1. Call `documents.get` API
2. Return **raw API response** (complete Document object)
3. No processing, no formatting
4. Let the AI agent parse it however it wants

---

## Comparison

| Feature | getGoogleDocContent | docs_get (proposed) |
|---------|-------------------|-------------------|
| **API Call** | `documents.get` | `documents.get` |
| **Returns** | Formatted text with indices | Raw API response |
| **Processing** | Extracts paragraph text only | None (raw JSON) |
| **Use Case** | Quick formatting workflow | Full document inspection |
| **Design Pattern** | Convenience wrapper | 1:1 API mapping |
| **Follows Design Principles** | ❌ No (adds abstraction) | ✅ Yes (thin layer) |

---

## The Problem with getGoogleDocContent

### Design Principle Violation

From `DESIGN_PRINCIPLES.md`:
> **Thin Layer, Not Abstraction Layer**
> - Each tool should map 1:1 to a Google API method
> - Don't add custom logic or transformations
> - Let AI agents compose simple operations

`getGoogleDocContent`:
- ❌ Adds custom formatting logic
- ❌ Filters response (only paragraphs)
- ❌ Transforms data (segments with indices)
- ❌ Not a 1:1 API mapping

### Why It Exists

**Historical context**:
- Created by original author (Piotr Agier, Aug 2025)
- Designed for easy formatting workflow
- Predates the 1:1 API design principles
- Was the only way to get document content

**It's a legacy tool from before the 1:1 API approach was adopted.**

---

## Use Cases

### When to use getGoogleDocContent
- ✅ Quick "read and format" workflows
- ✅ When you only care about paragraph text
- ✅ When you want pre-formatted output
- ✅ Backward compatibility

### When to use docs_get (if implemented)
- ✅ Need complete document structure
- ✅ Need headers, footers, TOC, tables
- ✅ Need document metadata (revision, title)
- ✅ Custom parsing logic
- ✅ Following 1:1 API design principles

---

## Recommendation

### Option 1: Keep Both (Recommended)

**Keep `getGoogleDocContent`**:
- ✅ It's fixed and working correctly
- ✅ Provides convenience for common use case
- ✅ Backward compatible
- ⚠️ Mark as "legacy" or "convenience" tool

**Add `docs_get`**:
- ✅ Follows design principles (1:1 API)
- ✅ Provides raw API access
- ✅ More flexible and powerful
- ✅ Future-proof

**Document the difference**:
```markdown
## Reading Google Docs

### Quick formatting (legacy)
- `getGoogleDocContent` - Returns formatted text with indices
- Best for: Simple read-and-format workflows
- Returns: Pre-formatted text segments

### Full document access (1:1 API)
- `docs_get` - Returns raw Google API response
- Best for: Complete document inspection, custom parsing
- Returns: Complete Document object
```

### Option 2: Deprecate getGoogleDocContent

**Replace with `docs_get`**:
- ✅ Follows design principles
- ✅ More flexible
- ❌ Breaking change for existing users
- ❌ Loses convenience
- ❌ AI agents need to parse raw response

**Deprecation path**:
1. Add `docs_get` as preferred tool
2. Mark `getGoogleDocContent` as deprecated
3. Provide migration guide
4. Remove in v3.0.0

### Option 3: Keep Only getGoogleDocContent

**Arguments for**:
- ✅ It's fixed and working
- ✅ Convenient for users
- ❌ Violates design principles
- ❌ Less flexible
- ❌ Not future-proof

**Not recommended** - goes against established design principles

---

## Implementation: Adding docs_get

If we add `docs_get`, here's what it would look like:

### Tool Definition
```typescript
{
  name: "docs_get",
  description: "Get a Google Docs document. Maps to documents.get in Google Docs API. Returns complete Document object with all content, styles, and metadata.",
  inputSchema: {
    type: "object",
    properties: {
      documentId: {
        type: "string",
        description: "The ID of the document"
      },
      includeTabsContent: {
        type: "boolean",
        description: "Whether to include tab content (default: false)",
        optional: true
      }
    },
    required: ["documentId"]
  }
}
```

### Handler Implementation
```typescript
case "docs_get": {
  const validation = DocsGetSchema.safeParse(request.params.arguments);
  if (!validation.success) {
    return errorResponse(validation.error.errors[0].message);
  }
  const args = validation.data;

  const docs = google.docs({ version: 'v1', auth: authClient });
  const document = await docs.documents.get({
    documentId: args.documentId,
    includeTabsContent: args.includeTabsContent
  });

  return {
    content: [{
      type: "text",
      text: JSON.stringify(document.data, null, 2)
    }],
    isError: false
  };
}
```

### Effort
- **Schema**: 5 lines
- **Tool definition**: 15 lines
- **Handler**: 20 lines
- **Tests**: 10 tests
- **Total**: ~1 hour

---

## Impact Analysis

### If we keep only getGoogleDocContent
- ✅ No changes needed
- ✅ Works correctly (now fixed)
- ❌ Violates design principles
- ❌ Can't access full document structure

### If we add docs_get
- ✅ Follows design principles
- ✅ Provides full API access
- ✅ No breaking changes (both can coexist)
- ⚠️ Need to document when to use each

### If we replace with docs_get
- ✅ Follows design principles
- ❌ Breaking change
- ❌ More complex for simple use cases
- ❌ Need migration guide

---

## Conclusion

### My Recommendation

**Add `docs_get` while keeping `getGoogleDocContent`**:

1. **Add `docs_get`** as the proper 1:1 API tool
2. **Keep `getGoogleDocContent`** for convenience/backward compatibility
3. **Document both** with clear use case guidance
4. **Mark `getGoogleDocContent`** as "convenience wrapper" in docs

### Rationale

- ✅ Best of both worlds
- ✅ Follows design principles (via `docs_get`)
- ✅ Maintains convenience (via `getGoogleDocContent`)
- ✅ No breaking changes
- ✅ Clear migration path if we want to deprecate later

### Next Steps (if agreed)

1. Create `DocsGetSchema`
2. Add `docs_get` tool definition
3. Implement `docs_get` handler
4. Write 10+ unit tests
5. Update documentation
6. Commit as enhancement (not breaking change)

---

## Questions for User

1. **Should we add `docs_get`?**
   - Yes → Implement it
   - No → Document why we're keeping only the wrapper

2. **Should we deprecate `getGoogleDocContent`?**
   - Yes → Add deprecation notice, plan removal
   - No → Keep both, document use cases

3. **Documentation strategy?**
   - Mark `getGoogleDocContent` as "legacy convenience"?
   - Or keep it as primary tool?

---

**Last Updated**: 2025-11-18
**Status**: Analysis complete, awaiting decision
