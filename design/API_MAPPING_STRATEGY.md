# API to MCP Tool Mapping Strategy

## Overview

This document defines the design pattern for mapping Google APIs to MCP tools in the Google Drive MCP server.

---

## Design Philosophy: Thin Wrapper Approach

### Our Choice: **Thin Wrappers (1:1 API Mapping)**

We use **thin wrappers** for low-level tools, providing:
- ✅ Direct access to Google API capabilities
- ✅ Minimal abstraction layer
- ✅ Maximum flexibility for Claude
- ✅ Complete API surface coverage

**Why Thin Wrappers?**
1. **Claude Never Gets Blocked** - Every API operation is accessible
2. **Composability** - Claude can chain simple operations for complex tasks
3. **Transparency** - Clear mapping between MCP tool and Google API
4. **Maintainability** - Changes in Google API require minimal wrapper updates
5. **Testability** - Each tool has single, well-defined responsibility

---

## Accepted Design Patterns

### Pattern 1: Facade Pattern (Our Primary Approach)

**Definition**: Provide a simplified interface to a complex subsystem

**How We Use It**:
- Each MCP tool is a **facade** over one Google API request type
- Tool names follow convention: `{api}_{operation}` (e.g., `docs_insertText`)
- Parameters map 1:1 to API parameters
- Response wraps API response in MCP protocol format

**Example**:
```typescript
// Google Docs API: DeleteContentRangeRequest
{
  deleteContentRange: {
    range: { startIndex: 1, endIndex: 10 }
  }
}

// MCP Tool: docs_deleteContentRange
{
  documentId: "abc123",
  startIndex: 1,
  endIndex: 10
}
```

**Benefits**:
- Single Responsibility Principle (SRP)
- Interface Segregation Principle (ISP)
- Easy to understand and maintain

**Anti-pattern Avoided**: God Object (one giant tool that does everything)

---

### Pattern 2: Adapter Pattern (For Parameter Translation)

**Definition**: Convert the interface of a class into another interface clients expect

**How We Use It**:
- Translate MCP tool parameters → Google API format
- Handle index conversion (user-friendly → API format)
- Add default values (e.g., tabId defaults to first tab)

**Example**:
```typescript
// User provides (user-friendly):
{ documentId: "abc", startIndex: 1, endIndex: 10 }

// Adapter translates to (API format):
{
  documentId: "abc",
  requestBody: {
    requests: [{
      deleteContentRange: {
        range: { startIndex: 1, endIndex: 10 }
      }
    }]
  }
}
```

---

### Pattern 3: Strategy Pattern (For Different API Versions)

**Definition**: Define a family of algorithms, encapsulate each one, make them interchangeable

**Future Use**:
- When Google releases API v2, we can support both versions
- Tool naming: `docs_v1_insertText` vs `docs_v2_insertText`
- Or use version parameter: `docs_insertText({ version: "v1", ... })`

**Not Currently Used** (only v1 exists)

---

## Mapping Levels

### Level 1: Low-Level (Thin Wrappers) - PRIMARY FOCUS

**Pattern**: 1 Tool = 1 API Request Type

**Naming Convention**: `{api}_{requestType}`
- `docs_insertText` → `InsertTextRequest`
- `docs_deleteContentRange` → `DeleteContentRangeRequest`
- `docs_updateTextStyle` → `UpdateTextStyleRequest`

**Characteristics**:
- Direct parameter mapping
- Minimal business logic
- Maximum flexibility
- Complete API coverage

**Example Tools**:
- `docs_insertText`
- `docs_deleteContentRange`
- `docs_insertTable`
- `docs_updateTableCellStyle`

**Coverage Goal**: 34/34 Google Docs API request types (100%)

---

### Level 2: High-Level (Thick Wrappers) - FUTURE ENHANCEMENT

**Pattern**: 1 Tool = Multiple API Calls + Business Logic

**Naming Convention**: Natural language (no prefix)
- `createFormattedDocument` (creates doc + formats)
- `replaceAndFormat` (find + delete + insert + style)
- `insertStyledTable` (insert table + format cells + add data)

**Characteristics**:
- Convenience methods
- Common workflows
- Composed from low-level tools
- Domain-specific

**Example Tools** (not yet implemented):
- `createFormattedDocument({ title, sections[], styling })`
- `insertStyledTable({ documentId, index, data[][], headerStyle, cellStyle })`
- `createReportSection({ documentId, heading, content, includePageBreak })`

**Coverage Goal**: TBD (based on usage patterns)

---

## API-to-Tool Mapping Rules

### Rule 1: One Request Type = One Tool (Low-Level)

**Good**:
```typescript
// One tool per API request type
docs_insertText(documentId, index, text)
docs_deleteContentRange(documentId, startIndex, endIndex)
docs_updateTextStyle(documentId, range, textStyle, fields)
```

**Bad** (violates Single Responsibility):
```typescript
// God object anti-pattern
docs_editText(documentId, {
  operation: "insert" | "delete" | "update",
  // ... different params for each operation
})
```

---

### Rule 2: Parameter Mapping Should Be Transparent

**Good** (clear mapping):
```typescript
// MCP Tool
docs_insertTable({
  documentId: "abc",
  index: 1,
  rows: 3,
  columns: 4
})

// Maps to API
{
  insertTable: {
    location: { index: 1 },
    rows: 3,
    columns: 4
  }
}
```

**Bad** (hidden complexity):
```typescript
// MCP Tool - unclear what this does
docs_insertTable({
  documentId: "abc",
  config: "3x4@1" // Magic string!
})
```

---

### Rule 3: Tool Names Should Be Self-Documenting

**Good**:
- `docs_insertText` - Obviously inserts text
- `docs_deleteContentRange` - Obviously deletes content
- `docs_updateTableCellStyle` - Obviously updates table cell styling

**Bad**:
- `docs_modify` - What does it modify?
- `docs_edit` - Edit what? How?
- `docs_change` - Too vague

---

### Rule 4: Respect API Boundaries

**Good** (API-aligned):
```typescript
// Google Docs API tools
docs_insertText()
docs_updateTextStyle()

// Google Drive API tools (different namespace)
drive_listComments()
drive_replyToComment()
```

**Bad** (mixed APIs):
```typescript
// Confusing - comments are Drive API, not Docs API
docs_addComment() // WRONG API!
```

---

### Rule 5: Compose, Don't Abstract Away

**Good** (composable):
```typescript
// Let Claude compose operations
await docs_insertText(docId, 1, "Header")
await docs_updateTextStyle(docId, { startIndex: 1, endIndex: 7 }, { bold: true })
await docs_updateParagraphStyle(docId, { startIndex: 1, endIndex: 7 }, { namedStyleType: "HEADING_1" })
```

**Bad** (over-abstracted):
```typescript
// Hides what's happening
await docs_insertFormattedHeader(docId, "Header", { level: 1 })
// What if Claude wants different formatting? Blocked!
```

---

## Advantages of Our Approach

### 1. Complete API Coverage
- Every Google API operation → One MCP tool
- Claude never blocked by missing functionality
- Future API additions easy to integrate

### 2. Testability
- Each tool has single responsibility
- Easy to write focused unit tests
- Clear assertion expectations

### 3. Maintainability
- Tool logic is simple (thin wrapper)
- Changes in Google API → Update one tool
- No complex business logic to debug

### 4. Discoverability
- Tool names match API documentation
- Developers can reference official Google docs
- Claude can learn API patterns

### 5. Composability
- Claude chains simple operations for complex tasks
- Flexibility to create any workflow
- Not limited by our preconceptions

### 6. DRY Principle
- No duplicate logic across tools
- Each API operation implemented once
- High-level tools compose low-level tools (future)

---

## Trade-offs & Limitations

### Trade-off 1: More Tools = More Choice
**Downside**: Claude has 34+ tools to choose from
**Mitigation**: Clear naming convention, good descriptions

### Trade-off 2: Multi-Step Operations
**Downside**: Simple tasks might require multiple tool calls
**Mitigation**: Add high-level convenience tools (Phase 4+)

### Trade-off 3: API Complexity Exposed
**Downside**: Complex APIs (tables, styling) have many parameters
**Mitigation**: Provide good examples, clear documentation

---

## Comparison with Alternatives

### Alternative 1: Thick Wrapper Only (REJECTED)

**What it looks like**:
```typescript
// Only provide high-level tools
createDocument({ title, content, formatting })
updateDocument({ id, changes })
```

**Why Rejected**:
- ❌ Claude blocked when our abstraction doesn't fit
- ❌ Must anticipate all use cases (impossible)
- ❌ Difficult to test complex interactions
- ❌ High maintenance burden

---

### Alternative 2: Generic batchUpdate Tool (REJECTED)

**What it looks like**:
```typescript
docs_batchUpdate(documentId, [
  { insertText: { location: { index: 1 }, text: "Hello" } },
  { updateTextStyle: { range: {...}, style: {...} } }
])
```

**Why Rejected**:
- ❌ Claude must understand Google's nested request format
- ❌ Error messages unclear (which request failed?)
- ❌ No input validation per request type
- ❌ Difficult to provide helpful examples

---

### Alternative 3: Hybrid Approach (OUR CHOICE ✅)

**What it looks like**:
```typescript
// Level 1: Low-level (thin wrappers)
docs_insertText(documentId, index, text)
docs_updateTextStyle(documentId, range, style)

// Level 2: High-level (convenience, future)
createFormattedDocument(title, sections)
```

**Why Chosen**:
- ✅ Best of both worlds
- ✅ Complete API coverage (never blocked)
- ✅ Convenience when patterns emerge
- ✅ Clear separation of concerns

---

## Implementation Guidelines

### For Low-Level Tools (Now)

1. **Name**: `{api}_{requestType}` (lowercase, snake_case)
2. **Parameters**: Match API 1:1, flatten when sensible
3. **Validation**: Zod schema for all parameters
4. **Error Handling**: Wrap API errors with context
5. **Response**: Success message + relevant IDs
6. **Documentation**: Link to official API docs

### For High-Level Tools (Future)

1. **Name**: Natural language (e.g., `createFormattedTable`)
2. **Implementation**: Compose low-level tools
3. **When**: Only after observing common usage patterns
4. **Validation**: Ensure low-level coverage exists first

---

## Real-World Examples

### Example 1: Table Creation

**Low-Level Approach** (6 tool calls):
```typescript
// 1. Create table
await docs_insertTable(docId, index, 3, 4)

// 2-4. Add content
await docs_insertText(docId, cellIndex1, "Header 1")
await docs_insertText(docId, cellIndex2, "Header 2")
await docs_insertText(docId, cellIndex3, "Data")

// 5-6. Style table
await docs_updateTableCellStyle(docId, headerRange, headerStyle)
await docs_updateTableRowStyle(docId, [0], { tableHeader: true })
```

**High-Level Approach** (future, 1 tool call):
```typescript
// Convenience wrapper
await insertStyledTable(docId, index, {
  headers: ["Col 1", "Col 2"],
  data: [["A", "B"], ["C", "D"]],
  headerStyle: { backgroundColor: "#cccccc", bold: true }
})
```

**Both valid!** Low-level gives control, high-level gives convenience.

---

### Example 2: Find and Replace

**Current** (high-level exists):
```typescript
// Already implemented as high-level
await docs_replaceAllText(docId, "old text", "new text", { matchCase: true })
```

**Could also do low-level**:
```typescript
// If we wanted more control
const matches = await docs_findText(docId, "old text") // hypothetical
for (const match of matches) {
  await docs_deleteContentRange(docId, match.start, match.end)
  await docs_insertText(docId, match.start, "new text")
}
```

**Both patterns coexist!**

---

## Naming Convention Summary

| Type | Pattern | Example | API |
|------|---------|---------|-----|
| **Low-Level** | `{api}_{operation}` | `docs_insertText` | Google Docs API v1 |
| **High-Level** | Natural language | `createFormattedDocument` | Composed from low-level |
| **Drive API** | `drive_{operation}` | `drive_listComments` | Google Drive API v3 |
| **Sheets API** | `sheets_{operation}` | `sheets_updateCell` | Google Sheets API v4 |

---

## Success Metrics

### Phase 1-2 (Current)
- **Coverage**: 100% of Google Docs API batchUpdate requests (34 tools)
- **Pattern**: Thin wrappers only
- **Naming**: `docs_{requestType}`

### Phase 3-4 (Future)
- **Coverage**: Add high-level convenience tools
- **Pattern**: Thick wrappers composing thin wrappers
- **Naming**: Natural language

### Phase 5+ (Future)
- **Coverage**: Extend to Sheets, Slides, Drive APIs
- **Pattern**: Same thin + thick approach
- **Naming**: `{api}_{operation}` for thin, natural for thick

---

## References

### Design Patterns
- **Facade Pattern**: GoF Design Patterns
- **Adapter Pattern**: GoF Design Patterns
- **Single Responsibility Principle**: SOLID principles
- **Interface Segregation Principle**: SOLID principles

### API Design
- Google Docs API Reference: https://developers.google.com/docs/api/reference/rest/v1/documents
- MCP Protocol Specification: https://modelcontextprotocol.io

### Industry Best Practices
- Thin vs Thick Wrappers in AI (Medium, 2025)
- What Makes a Good API Wrapper (Wynn Netherland)
- Essential Patterns: Clients and Wrappers (Selleo/Medium)

---

## Conclusion

Our **thin wrapper (1:1 API mapping)** approach provides:

✅ **Complete coverage** - Every API operation accessible
✅ **Never blocked** - Claude can always accomplish tasks
✅ **Composable** - Simple operations combine for complex workflows
✅ **Maintainable** - Clear, single-responsibility tools
✅ **Testable** - Each tool has focused tests
✅ **Future-proof** - Easy to add convenience wrappers later

This is the **generally accepted design pattern** for API wrappers when:
- You want complete API coverage
- Users need maximum flexibility
- You can't predict all use cases
- Maintainability matters

**Status**: This is our official mapping strategy for all Google API integrations.
