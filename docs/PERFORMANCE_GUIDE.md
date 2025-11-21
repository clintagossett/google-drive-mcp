# Performance Guide: Optimizing Token Usage

This guide helps both AI agents and human developers make efficient tool choices to minimize context token consumption.

## Overview

Large API responses can quickly fill up the context window, reducing effectiveness in extended conversations. This guide provides practical strategies for choosing the right tools based on your needs.

## Design Philosophy

Rather than creating specialized "light" versions of tools, we enhance tool descriptions to guide intelligent tool selection. This approach:

- **Empowers AI agents** to make smart choices based on clear guidance
- **Reduces maintenance burden** by avoiding tool proliferation
- **Preserves API fidelity** by mapping directly to official APIs
- **Improves user experience** through better token management

## Core Principle: Choose the Right Tool for the Job

### Reading Google Docs Content

#### ❌ Anti-Pattern: Always using `docs_get`

```typescript
// INEFFICIENT: Uses ~26k+ tokens for moderate documents
const doc = await docs_get({ documentId: "..." });
// Extract text from complex structure
const text = extractTextFromDocStructure(doc);
```

#### ✅ Best Practice: Use `drive_exportFile` for content

```typescript
// EFFICIENT: Uses ~9k tokens (65% reduction)
const exported = await drive_exportFile({
  fileId: "...",
  mimeType: "text/markdown"
});
// Decode base64 and use directly
const text = Buffer.from(exported.data, 'base64').toString();
```

**Token Comparison** (meeting transcript example):
```
docs_get:                 ~26,319 tokens (truncated)
drive_exportFile (md):     ~9,435 tokens
Savings:                  ~16,884 tokens (64% reduction)
```

## Tool Selection Decision Tree

### For Google Docs

```
Need to READ document?
├─ Need formatting/structure analysis?
│  └─ Use: docs_get
│     • Returns complete document object
│     • Includes fonts, colors, styles, positioning
│     • Use when: editing, analyzing structure, working with formatting
│
└─ Just need content/text?
   └─ Use: drive_exportFile
      • 60-65% smaller than docs_get
      • Best formats:
        - text/markdown (preserves headings, lists)
        - text/plain (most efficient)
      • Use when: reading, summarizing, searching

Need to EDIT document?
└─ Use: docs_get + editing tools
   • docs_get for structure
   • Use index positions from structure
   • Apply edits with docs_* tools
```

### For Google Sheets

```
Need specific cell values?
├─ Small range (< 100 cells)?
│  └─ Use: sheets_batchGetValues with exact range
│     • Example: "Sheet1!A1:C10"
│
└─ Large dataset?
   └─ Use: Multiple targeted sheets_batchGetValues calls
      • Fetch in chunks
      • Use specific ranges, not entire sheets

Need to list sheets or metadata?
└─ Use: sheets_getSpreadsheet
   • Without includeGridData: true
   • Metadata only, efficient
```

### For Drive Operations

```
Need to list files?
└─ Use: drive_listFiles with:
   • pageSize: 20 (default recommended)
   • Specific query filters
   • fields parameter to limit metadata

Need file metadata?
└─ Use: drive_getFile with fields parameter
   • Only request needed fields
   • Example: "id,name,mimeType,createdTime"
```

## Token Usage Examples

### Real-World Comparison: Meeting Transcript Document

**Document**: 28-minute meeting transcript (~5-6 pages)

| Tool | Token Usage | Use Case |
|------|-------------|----------|
| `docs_get` | ~26,319 tokens | Needed for editing, structure analysis |
| `drive_exportFile` (markdown) | ~9,435 tokens | Perfect for reading, summarizing |
| **Savings** | **64.2% reduction** | Choose based on need |

### When Token Savings Matter Most

1. **Long conversations** - Preserve context window
2. **Multiple document reads** - Aggregate savings
3. **Large documents** - Effect compounds
4. **Iterative analysis** - Repeatedly accessing content

## Best Practices

### 1. Default to Efficiency

When in doubt, start with the most efficient option:
- Reading docs? → `drive_exportFile` (markdown)
- Need to edit? → Then use `docs_get`

### 2. Use Specific Ranges

```typescript
// ❌ Inefficient
sheets_batchGetValues({ ranges: ["Sheet1"] })

// ✅ Efficient
sheets_batchGetValues({ ranges: ["Sheet1!A1:D20"] })
```

### 3. Limit Metadata Fields

```typescript
// ❌ Returns everything
drive_getFile({ fileId: "..." })

// ✅ Returns only needed fields
drive_getFile({
  fileId: "...",
  fields: "id,name,mimeType,createdTime"
})
```

### 4. Use Pagination

```typescript
// ✅ Reasonable page size
drive_listFiles({
  pageSize: 20,
  q: "mimeType='application/vnd.google-apps.document'"
})
```

## For AI Agents: Reading Tool Descriptions

Tool descriptions now include explicit guidance:

- **⚠️ TOKEN WARNING** - Indicates high token usage
- **✨ EFFICIENCY BENEFIT** - Indicates optimization opportunity
- **WHEN TO USE** / **WHEN NOT TO USE** - Clear decision criteria
- **Token reduction percentages** - Quantified benefits

When you see these indicators, factor them into your tool selection.

## For Human Developers: Design Pattern

When adding new tools or APIs:

1. **Identify token-heavy operations** (large responses)
2. **Document efficient alternatives** in tool descriptions
3. **Provide quantified comparisons** (% reduction)
4. **Give clear decision criteria** (when to use what)
5. **Don't create specialized tools** unless absolutely necessary

Example:
```typescript
{
  name: "api_method",
  description: `
⚠️ TOKEN WARNING: Returns large response (~Xk tokens).

WHEN TO USE:
✓ [Specific use case]
✓ [Another use case]

WHEN NOT TO USE (use alternative_method instead):
✗ [Use case better served elsewhere]

For [common use case], use [alternative] instead (X% reduction).
  `
}
```

## Monitoring and Improvement

### Track Token Usage

When you notice token warnings:
1. Note the tool and context
2. Evaluate if there's a more efficient approach
3. Check tool descriptions for guidance
4. Consider if new documentation is needed

### Contribute Improvements

Found a better approach? Update:
- Tool descriptions (src/index.ts)
- This performance guide
- Design principles documentation

## Related Issues

- **Issue #13**: Mitigate large MCP responses that consume context tokens
- See: `docs/historical/issue_00013/RESPONSE_SIZE_MITIGATION.md`

## Summary

**Key Takeaway**: Choose tools based on what you need, not what's available. Reading content? Export it. Need structure? Get the full object. The right tool for the right job saves tokens and preserves context.
