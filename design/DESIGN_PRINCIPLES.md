# Design Principles & Implementation Rules

## Purpose

This document serves as the **master reference** for all implementation decisions in the Google Drive MCP server. All code changes must adhere to these principles.

**Read this FIRST before implementing any new feature.**

---

## ⚠️ CRITICAL REMINDER: TESTS ARE PART OF IMPLEMENTATION

**A tool is NOT complete until:**
1. ✅ Code is written (schema + definition + handler)
2. ✅ Tests are written (5+ unit tests per tool)
3. ✅ Tests pass (`npm test`)

**Build success ≠ Implementation complete**

If you find yourself thinking "I'll write tests later" or "Tests can wait until the end of the phase":
- 🛑 **STOP**
- 📖 Re-read "Common Mistakes to Avoid - Mistake #1" below
- 🔄 Write the tests NOW, before moving to the next tool

**Lesson from Phase 1 (2025-01-18)**: Implemented 10 tools without tests, had to write 91 tests retroactively. Never again.

---

## Table of Contents

1. [Core Philosophy](#core-philosophy)
2. [API Mapping Rules](#api-mapping-rules)
3. [Code Structure Rules](#code-structure-rules)
4. [Testing Requirements](#testing-requirements)
5. [Naming Conventions](#naming-conventions)
6. [Error Handling](#error-handling)
7. [Documentation Requirements](#documentation-requirements)
8. [Quick Reference Checklist](#quick-reference-checklist)

---

## Core Philosophy

### 1. Claude Must Never Be Blocked

**Principle**: Every Google API operation must be accessible through an MCP tool.

**Implementation**:
- ✅ Implement ALL Google Docs API request types (34 total)
- ✅ Use thin wrappers (1:1 API mapping)
- ✅ Avoid over-abstraction
- ❌ Never hide API capabilities behind convenience methods

**Validation**: Before any release, verify API coverage in `design/api_reference_docs.md`

---

### 2. DRY (Do Not Repeat Yourself)

**Principle**: Each piece of knowledge/logic should exist in exactly one place.

**Implementation**:
- ✅ One tool per API request type (no duplicates)
- ✅ Shared helpers for common operations (resolvePath, checkFileExists)
- ✅ Reusable Zod schemas
- ✅ Common error handling pattern
- ❌ Never copy-paste code between tools

**Validation**: Code reviews check for duplicate logic

---

### 3. Composability Over Complexity

**Principle**: Simple tools that compose are better than complex all-in-one tools.

**Implementation**:
- ✅ Low-level tools do ONE thing well
- ✅ High-level tools (future) compose low-level tools
- ✅ Claude chains operations for complex workflows
- ❌ Never create "do everything" tools

**Example**:
```typescript
// GOOD: Two simple tools
docs_insertText(docId, index, "Header")
docs_updateTextStyle(docId, range, { bold: true })

// BAD: One complex tool
docs_insertFormattedText(docId, index, "Header", { bold: true, size: 14 })
```

---

## API Mapping Rules

**Reference**: See `design/API_MAPPING_STRATEGY.md` for complete details

### Rule 1: One Request Type = One Tool (MANDATORY)

Each Google API request type gets exactly one MCP tool.

**Pattern**:
```
{api}_{requestType} → API Request Type

docs_insertText          → InsertTextRequest
docs_deleteContentRange  → DeleteContentRangeRequest
docs_updateTextStyle     → UpdateTextStyleRequest
```

**Violation Example**:
```typescript
// WRONG: One tool for multiple operations
docs_textOperation({ type: "insert" | "delete", ... })
```

---

### Rule 2: Transparent Parameter Mapping (MANDATORY)

Tool parameters must map clearly to API parameters.

**GOOD**:
```typescript
// MCP Tool
docs_insertTable({ documentId, index, rows, columns })

// Maps to API
{ insertTable: { location: { index }, rows, columns } }
```

**BAD**:
```typescript
// MCP Tool - unclear mapping
docs_insertTable({ documentId, config: "3x4@1" })
```

---

### Rule 3: Respect API Boundaries (MANDATORY)

Keep APIs separated by namespace.

**GOOD**:
```typescript
// Google Docs API
docs_insertText()
docs_updateTextStyle()

// Google Drive API (different namespace)
drive_listComments()
drive_replyToComment()
```

**BAD**:
```typescript
// Mixing APIs - comments are Drive API!
docs_addComment() // WRONG!
```

---

### Rule 4: Self-Documenting Names (MANDATORY)

Tool names must clearly describe what they do.

**GOOD**:
- `docs_insertText` - Obviously inserts text
- `docs_deleteContentRange` - Obviously deletes content
- `docs_updateTableCellStyle` - Obviously updates table cell styling

**BAD**:
- `docs_modify` - Modify what?
- `docs_edit` - Edit what? How?
- `docs_process` - Process what?

---

### Rule 5: Thin Wrappers for Low-Level (MANDATORY)

Low-level tools are thin wrappers with minimal logic.

**Allowed**:
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

## Code Structure Rules

**Reference**: See existing tools in `src/index.ts` for examples

### Rule 1: Consistent Tool Implementation Pattern (MANDATORY)

Every tool must follow this EXACT structure:

```typescript
// 1. Zod Schema (around line 256)
const DocsToolNameSchema = z.object({
  documentId: z.string().min(1, "Document ID is required"),
  param1: z.string(),
  param2: z.number().optional(),
});

// 2. Tool Definition (ListToolsRequestSchema handler, ~line 709)
{
  name: "docs_toolName",
  description: "Clear description of what this does. Include constraints.",
  inputSchema: {
    type: "object",
    properties: {
      documentId: { type: "string", description: "..." },
      param1: { type: "string", description: "..." },
      param2: { type: "number", description: "...", optional: true }
    },
    required: ["documentId", "param1"]
  }
}

// 3. Tool Handler (CallToolRequestSchema switch, ~line 1379)
case "docs_toolName": {
  // Validate
  const validation = DocsToolNameSchema.safeParse(request.params.arguments);
  if (!validation.success) {
    return errorResponse(validation.error.errors[0].message);
  }
  const args = validation.data;

  // Create API client
  const docs = google.docs({ version: 'v1', auth: authClient });

  // Execute
  try {
    const response = await docs.documents.batchUpdate({
      documentId: args.documentId,
      requestBody: {
        requests: [{ /* API request */ }]
      }
    });

    // Return success
    return {
      content: [{ type: "text", text: "Success message with relevant details" }],
      isError: false
    };
  } catch (error: any) {
    return errorResponse(error.message || 'Operation failed');
  }
}
```

**NO EXCEPTIONS** to this pattern.

---

### Rule 2: Error Handling Pattern (MANDATORY)

All tools must use the standard error handling pattern:

```typescript
try {
  // API call
  const response = await apiClient.method(...);

  return {
    content: [{ type: "text", text: "Success message" }],
    isError: false
  };
} catch (error: any) {
  return errorResponse(error.message || 'Descriptive fallback message');
}
```

**Error messages must be**:
- ✅ Specific to the operation
- ✅ Helpful for debugging
- ✅ User-friendly (not technical stack traces)

---

### Rule 3: Location in File (MANDATORY)

**Zod Schemas**: Lines 256-600 (alphabetically sorted by tool name)

**Tool Definitions**: Lines 709-1378 (alphabetically sorted by tool name)

**Tool Handlers**: Lines 1379+ (alphabetically sorted by tool name in switch)

**Helper Functions**: Top of file or dedicated modules

---

## Testing Requirements

**Reference**: See `design/PHASE_1_PLAN.md` for complete testing workflow

### Rule 1: Every Tool Must Have Tests (MANDATORY)

**Unit Tests** (5 minimum per tool):
1. Validates required parameters
2. Validates optional parameters
3. Calls Google API with correct format
4. Handles API errors gracefully
5. Returns valid MCP response format

**Integration Tests** (3 minimum per tool):
1. Works with OAuth document
2. Works with public document
3. Handles error cases

**Manual Tests** (before commit):
1. Test with MCP Inspector
2. Test with both test documents
3. Test edge cases from API constraints

---

### Rule 2: Test File Naming (MANDATORY)

**Unit tests**:
```
tests/unit/{category}-{level}.test.ts

Examples:
tests/unit/docs-lowlevel.test.ts
tests/unit/docs-highlevel.test.ts
tests/unit/sheets-lowlevel.test.ts
```

**Integration tests**:
```
tests/integration/{category}-{level}.integration.test.ts

Examples:
tests/integration/docs-lowlevel.integration.test.ts
```

---

### Rule 3: Test Coverage Requirements (MANDATORY)

Before merging to main:
- ✅ All unit tests pass
- ✅ All integration tests pass (if ENABLE_INTEGRATION_TESTS=true)
- ✅ Code coverage ≥ 80% for new code
- ✅ No regressions in existing tests

Run: `npm run test:coverage` to verify

---

## Naming Conventions

### Tool Names (MANDATORY)

**Low-Level Tools**:
```
Pattern: {api}_{requestType}
Format: lowercase with underscores (snake_case)

Examples:
docs_insertText
docs_deleteContentRange
docs_updateTableCellStyle
drive_listComments
sheets_updateCell
```

**High-Level Tools** (future):
```
Pattern: Natural language describing operation
Format: camelCase

Examples:
createFormattedDocument
insertStyledTable
replaceAndFormat
```

---

### Variable Names (MANDATORY)

**Schema**: `{ToolName}Schema`
```typescript
const DocsInsertTextSchema = z.object({ ... });
const DocsDeleteContentRangeSchema = z.object({ ... });
```

**Tool Arguments**: `args`
```typescript
const args = validation.data;
```

**API Clients**: `{api}` or `{api}Service`
```typescript
const docs = google.docs({ version: 'v1', auth: authClient });
const drive = google.drive({ version: 'v3', auth: authClient });
```

---

### File Names (MANDATORY)

**Design Documents**: `UPPERCASE_WITH_UNDERSCORES.md`
```
design/DESIGN_PRINCIPLES.md
design/PHASE_1_PLAN.md
design/API_MAPPING_STRATEGY.md
```

**API References**: `lowercase_with_underscores.md`
```
design/api_reference_docs.md
design/api_reference_sheets.md
```

**Test Files**: `lowercase-with-dashes.test.ts`
```
tests/unit/docs-lowlevel.test.ts
tests/integration/docs-lowlevel.integration.test.ts
```

---

## Error Handling

### Rule 1: Use errorResponse Helper (MANDATORY)

Always use the `errorResponse` helper for errors:

```typescript
// GOOD
return errorResponse("Document not found");
return errorResponse(error.message || "Failed to update document");

// BAD
return { content: [{ type: "text", text: `Error: ${msg}` }], isError: true };
```

---

### Rule 2: Provide Actionable Error Messages (MANDATORY)

Error messages must help the user fix the problem:

**GOOD**:
```
"Document not found. Verify the document ID is correct and you have access."
"Cannot delete across table boundaries. Adjust startIndex and endIndex."
"Invalid range: endIndex (5) must be greater than startIndex (10)."
```

**BAD**:
```
"Error"
"Failed"
"Invalid input"
```

---

### Rule 3: Catch All API Errors (MANDATORY)

Every API call must be wrapped in try/catch:

```typescript
try {
  const response = await docs.documents.batchUpdate(...);
  return { content: [...], isError: false };
} catch (error: any) {
  return errorResponse(error.message || 'Fallback message');
}
```

**NO EXCEPTIONS** - unhandled errors crash the MCP server.

---

## Documentation Requirements

### Rule 1: Update API Reference After Implementation (MANDATORY)

When implementing a tool:
1. ✅ Mark as implemented in `design/api_reference_docs.md`
2. ✅ Update coverage statistics
3. ✅ Add example usage if helpful

Example:
```markdown
**Current Status**: ✅ Implemented

**Proposed MCP Tool**: `docs_deleteContentRange` ✅
```

---

### Rule 2: Tool Descriptions Must Be Complete (MANDATORY)

Every tool description must include:
1. ✅ What the tool does (brief)
2. ✅ Any constraints or limitations
3. ✅ Link to API docs (if helpful)

Example:
```typescript
{
  name: "docs_deleteContentRange",
  description: "Deletes content from a Google Doc within the specified range. " +
               "Cannot delete across table boundaries or in headers/footers/footnotes. " +
               "See: https://developers.google.com/docs/api/reference/rest/v1/documents/request#DeleteContentRangeRequest",
  inputSchema: { ... }
}
```

---

### Rule 3: Update Test Document Setup Guide (MANDATORY)

If test requirements change:
1. ✅ Update `TEST_DOCUMENT_SETUP.md`
2. ✅ Update `.env.test.example`
3. ✅ Document in commit message

---

## Quick Reference Checklist

Use this checklist when implementing a new tool:

### Before Writing Code
- [ ] Read `design/api_reference_docs.md` for API details
- [ ] Read `design/API_MAPPING_STRATEGY.md` for mapping pattern
- [ ] Read `design/PHASE_1_PLAN.md` (or current phase) for implementation workflow
- [ ] Read this document (`DESIGN_PRINCIPLES.md`) for rules

### During Implementation (PER TOOL, NOT PER PHASE)
- [ ] Follow 3-step pattern: Schema → Definition → Handler
- [ ] Place code in correct file locations (by line number)
- [ ] Use standard error handling (try/catch with errorResponse)
- [ ] Follow naming conventions exactly
- [ ] Write clear, helpful error messages
- [ ] **IMMEDIATELY** write tests for this tool (see Testing section below)
- [ ] Run `npm test` to verify this tool's tests pass
- [ ] **DO NOT** proceed to next tool until tests pass

### Testing (MUST BE DONE PER TOOL, NOT AT END OF PHASE)
- [ ] Write 5+ unit tests (validation, API call, errors, response format)
- [ ] Write 3+ integration tests (OAuth doc, public doc, errors)
- [ ] Run `npm run test:unit` - all pass **for this tool**
- [ ] Run `npm run test:integration` - all pass (if enabled) **for this tool**
- [ ] Run `npm run test:coverage` - ≥80% coverage
- [ ] Test with MCP Inspector manually
- [ ] **CRITICAL**: A tool is NOT complete until tests are written and passing

### Documentation
- [ ] Update `design/api_reference_docs.md` (mark as implemented)
- [ ] Update coverage statistics
- [ ] Add helpful examples if needed
- [ ] Update this checklist if process changed

### Before Commit
- [ ] All tests pass
- [ ] Code follows DRY principle (no duplication)
- [ ] Tool names follow convention
- [ ] Error handling is complete
- [ ] Documentation is updated
- [ ] No regressions in existing tools

### Commit Message Format
```
Add {tool_name} low-level tool

Implements {API Request Type} from Google Docs API v1.

Features:
- {feature 1}
- {feature 2}

Tests:
- {n} unit tests
- {n} integration tests
- Coverage: {percentage}%

Refs: design/api_reference_docs.md #{tool number}
```

---

## Common Mistakes to Avoid

### ❌ Mistake 1: Writing Tests After Implementation is Complete
```
// WRONG WORKFLOW
1. Implement all 10 tools
2. Build succeeds
3. Celebrate and write docs
4. "Oh wait, I forgot tests!"
```

**Why This is Critical**:
- Untested code is incomplete code
- Build success ≠ Implementation complete
- Bugs could exist in parameter mapping, error handling, or API requests
- Wastes time fixing bugs in production that tests would catch

**Solution**: Write tests **immediately** after each tool (or use TDD):
```
// CORRECT WORKFLOW (PER TOOL)
1. Read API documentation
2. Write Zod schema
3. Write 5+ unit tests for schema
4. Write tool definition
5. Write case handler
6. Run `npm test` - verify tests pass
7. Mark tool as complete
8. Move to next tool
```

**Lesson from Phase 1**:
- Implemented 10 tools, celebrated when build succeeded
- Forgot to write tests until asked "all tests passed?"
- Had to write 91 tests retroactively
- This violated the design principles and could have introduced bugs
- **Never skip tests again**

---

### ❌ Mistake 2: God Object Anti-Pattern
```typescript
// WRONG
docs_editDocument({
  operation: "insert" | "delete" | "update",
  // Different params for each operation
})
```

**Solution**: One tool per API request type.

---

### ❌ Mistake 2: Over-Abstraction
```typescript
// WRONG - hides API capabilities
docs_formatText(docId, text, "bold")
```

**Solution**: Expose all API parameters.
```typescript
// RIGHT
docs_updateTextStyle(docId, range, { bold: true, italic: false, fontSize: 14 })
```

---

### ❌ Mistake 3: Inconsistent Error Handling
```typescript
// WRONG
catch (error) {
  return { content: [{ type: "text", text: error }], isError: true };
}
```

**Solution**: Always use errorResponse helper.
```typescript
// RIGHT
catch (error: any) {
  return errorResponse(error.message || 'Failed to update');
}
```

---

### ❌ Mistake 4: Missing Validation
```typescript
// WRONG
case "docs_insertText": {
  const args = request.params.arguments;
  // Use args directly without validation
}
```

**Solution**: Always validate with Zod.
```typescript
// RIGHT
const validation = DocsInsertTextSchema.safeParse(request.params.arguments);
if (!validation.success) {
  return errorResponse(validation.error.errors[0].message);
}
const args = validation.data;
```

---

### ❌ Mistake 5: Vague Tool Names
```typescript
// WRONG
docs_modify()
docs_update()
docs_change()
```

**Solution**: Use self-documenting names.
```typescript
// RIGHT
docs_deleteContentRange()
docs_updateTextStyle()
docs_insertPageBreak()
```

---

### ❌ Mistake 6: Todo List Structure That Encourages Skipping Tests
```
// WRONG TODO STRUCTURE
1. Implement tool A
2. Implement tool B
3. Implement tool C
4. Test all tools  ← Testing as separate step!
```

**Why This is Wrong**:
- Encourages batch implementation without validation
- Creates mental separation between "code" and "tests"
- Violates the principle that tests are part of implementation

**Solution**: Structure todos to include tests per tool:
```
// CORRECT TODO STRUCTURE
1. Implement tool A (code + tests)
2. Implement tool B (code + tests)
3. Implement tool C (code + tests)
```

Or even better (TDD):
```
1. Tool A: Write tests → Write code → Verify tests pass
2. Tool B: Write tests → Write code → Verify tests pass
3. Tool C: Write tests → Write code → Verify tests pass
```

---

## Design Document Index

**Read these documents in order for any new implementation:**

1. **DESIGN_PRINCIPLES.md** (this file) - Read FIRST
2. **LESSONS_LEARNED.md** - Learn from past mistakes (READ THIS!)
3. **API_MAPPING_STRATEGY.md** - Understand mapping pattern
4. **api_reference_docs.md** or **api_reference_sheets.md** - API details for implementation
5. **PHASE_1_PLAN.md** (or current phase) - Step-by-step workflow
6. **TESTING_STRATEGY.md** - Complete testing approach

**Support Documents:**
- `TEST_DOCUMENT_SETUP.md` - Test document configuration
- `EXTENSION_PLAN.md` - Drive API comments plan
- `SERVICE_ACCOUNT_IMPLEMENTATION.md` - Service account auth

---

## Decision Authority

**These rules are MANDATORY and cannot be violated without updating this document.**

If you believe a rule should change:
1. Document the reason
2. Update this file
3. Update any affected code
4. Document in git commit

---

## Version History

- **v1.1** (2025-01-18): Added critical test-first reminders
  - Added prominent warning about tests being part of implementation
  - Added "Mistake #1: Writing Tests After Implementation is Complete"
  - Added "Mistake #6: Todo List Structure That Encourages Skipping Tests"
  - Updated checklist to emphasize per-tool testing
  - Created LESSONS_LEARNED.md to document Phase 1 mistake
  - **Lesson**: Implemented 10 Sheets tools without tests, had to write 91 tests retroactively

- **v1.0** (2025-01-18): Initial design principles
  - Established thin wrapper pattern
  - Defined code structure rules
  - Created testing requirements
  - Documented naming conventions

---

## Summary

**Core Principles**:
1. Claude must never be blocked (complete API coverage)
2. DRY (no duplicate logic)
3. Composability over complexity
4. Thin wrappers for low-level tools
5. Consistent patterns across all code

**Key Rules**:
- 1 API request type = 1 MCP tool
- Follow 3-step implementation pattern (Schema → Definition → Handler)
- 5 unit tests + 3 integration tests per tool
- Use errorResponse helper for all errors
- Update documentation after implementation

**Before ANY implementation, read**:
1. This document
2. `API_MAPPING_STRATEGY.md`
3. `api_reference_docs.md`
4. Current phase plan

**THIS DOCUMENT IS YOUR GUIDE. FOLLOW IT.**
