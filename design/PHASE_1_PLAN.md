# Phase 1 Implementation Plan: Core Text & Formatting

## Overview

**Goal**: Implement 6 core low-level Google Docs API tools with complete test coverage

**Status**: Ready to execute

**Prerequisites**: ✅ All complete
- [x] Vitest framework set up
- [x] Test helpers created
- [x] Integration test infrastructure ready
- [x] API reference documented
- [x] Test documents configured

---

## Tools to Implement

### 1. `docs_deleteContentRange`
**Priority**: HIGH
**API**: DeleteContentRangeRequest
**Purpose**: Delete text from documents

### 2. `docs_replaceAllText`
**Priority**: HIGH
**API**: ReplaceAllTextRequest
**Purpose**: Find and replace text

### 3. `docs_updateDocumentStyle`
**Priority**: MEDIUM
**API**: UpdateDocumentStyleRequest
**Purpose**: Document-wide styling (margins, page size)

### 4. `docs_createParagraphBullets`
**Priority**: HIGH
**API**: CreateParagraphBulletsRequest
**Purpose**: Add bullets/numbering to paragraphs

### 5. `docs_deleteParagraphBullets`
**Priority**: MEDIUM
**API**: DeleteParagraphBulletsRequest
**Purpose**: Remove bullets from paragraphs

### 6. `docs_insertPageBreak`
**Priority**: MEDIUM
**API**: InsertPageBreakRequest
**Purpose**: Insert page breaks

---

## Implementation Workflow (Per Tool)

### Step 1: Create Zod Schema
**File**: `src/index.ts` (around line 256)

```typescript
const DocsDeleteContentRangeSchema = z.object({
  documentId: z.string().min(1, "Document ID is required"),
  startIndex: z.number().int().min(1, "Start index must be >= 1"),
  endIndex: z.number().int().min(1, "End index must be >= 1"),
  tabId: z.string().optional(),
});
```

### Step 2: Add Tool Definition
**File**: `src/index.ts` (ListToolsRequestSchema handler, ~line 709)

```typescript
{
  name: "docs_deleteContentRange",
  description: "Deletes content from a Google Doc within the specified range. Cannot delete across table boundaries or in headers/footers/footnotes.",
  inputSchema: {
    type: "object",
    properties: {
      documentId: {
        type: "string",
        description: "The ID of the Google Doc"
      },
      startIndex: {
        type: "number",
        description: "Start position (inclusive, 1-indexed)"
      },
      endIndex: {
        type: "number",
        description: "End position (exclusive, 1-indexed)"
      },
      tabId: {
        type: "string",
        description: "Optional tab ID (defaults to first tab)",
        optional: true
      }
    },
    required: ["documentId", "startIndex", "endIndex"]
  }
}
```

### Step 3: Implement Tool Handler
**File**: `src/index.ts` (CallToolRequestSchema switch, ~line 1379)

```typescript
case "docs_deleteContentRange": {
  const validation = DocsDeleteContentRangeSchema.safeParse(request.params.arguments);
  if (!validation.success) {
    return errorResponse(validation.error.errors[0].message);
  }
  const args = validation.data;

  const docs = google.docs({ version: 'v1', auth: authClient });

  try {
    await docs.documents.batchUpdate({
      documentId: args.documentId,
      requestBody: {
        requests: [
          {
            deleteContentRange: {
              range: {
                startIndex: args.startIndex,
                endIndex: args.endIndex,
                ...(args.tabId && { tabId: args.tabId }),
              },
            },
          },
        ],
      },
    });

    return {
      content: [{
        type: "text",
        text: `Deleted content from index ${args.startIndex} to ${args.endIndex}`,
      }],
      isError: false,
    };
  } catch (error: any) {
    return errorResponse(error.message || 'Failed to delete content');
  }
}
```

### Step 4: Write Unit Test
**File**: `tests/unit/docs-lowlevel.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { google } from 'googleapis';

// Mock googleapis
vi.mock('googleapis');

describe('docs_deleteContentRange', () => {
  let mockDocs: any;

  beforeEach(() => {
    mockDocs = {
      documents: {
        batchUpdate: vi.fn().mockResolvedValue({
          data: { documentId: 'doc-123' },
        }),
      },
    };
    vi.mocked(google.docs).mockReturnValue(mockDocs);
  });

  it('validates required parameters', async () => {
    // Test missing parameters
    const invalidInput = { documentId: 'doc-123' };
    // Expect validation error
  });

  it('calls batchUpdate with correct request format', async () => {
    // Call tool with valid input
    // Verify mockDocs.documents.batchUpdate was called with:
    // - Correct documentId
    // - deleteContentRange request
    // - Correct startIndex, endIndex
  });

  it('handles API errors gracefully', async () => {
    mockDocs.documents.batchUpdate.mockRejectedValue(
      new Error('Cannot delete across table boundaries')
    );
    // Verify error response
  });

  it('returns valid MCP response format', async () => {
    // Verify response has content array
    // Verify content[0] has type and text
    // Verify isError is false
  });
});
```

### Step 5: Write Integration Test
**File**: `tests/integration/docs-lowlevel.integration.test.ts`

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createMCPClient, closeMCPClient, callTool } from '../helpers/mcp-client.js';
import { TEST_CONFIG, skipIfNoIntegration } from '../helpers/test-env.js';
import { assertSuccess } from '../helpers/assertions.js';

describe('docs_deleteContentRange Integration', () => {
  let client: any;

  beforeAll(async () => {
    if (skipIfNoIntegration()) return;

    const { client: c } = await createMCPClient({
      serverPath: TEST_CONFIG.serverPath,
      env: {
        GOOGLE_DRIVE_OAUTH_CREDENTIALS: TEST_CONFIG.oauthCredentials,
      },
    });
    client = c;
  });

  afterAll(async () => {
    if (client) await closeMCPClient(client);
  });

  it('should delete content from OAuth document', async () => {
    if (skipIfNoIntegration()) return;

    // 1. Insert test content first
    await callTool(client, 'docs_insertText', {
      documentId: TEST_CONFIG.oauthDocument,
      index: 1,
      text: 'DELETE ME',
    });

    // 2. Delete the content
    const result = await callTool(client, 'docs_deleteContentRange', {
      documentId: TEST_CONFIG.oauthDocument,
      startIndex: 1,
      endIndex: 10,
    });

    assertSuccess(result);

    // 3. Verify deletion by reading document
    const content = await callTool(client, 'getGoogleDocContent', {
      documentId: TEST_CONFIG.oauthDocument,
    });

    expect(content.content[0].text).not.toContain('DELETE ME');
  });

  it('should handle invalid range error', async () => {
    if (skipIfNoIntegration()) return;

    const result = await callTool(client, 'docs_deleteContentRange', {
      documentId: TEST_CONFIG.oauthDocument,
      startIndex: 1000,
      endIndex: 2000,
    });

    expect(result.isError).toBe(true);
  });
});
```

### Step 6: Manual Testing
- Test with MCP Inspector
- Verify with both OAuth and public documents
- Test edge cases

### Step 7: Update Documentation
- Mark tool as implemented in `design/api_reference_docs.md`
- Update coverage statistics

---

## Execution Order

Execute tools in this order (HIGH priority first):

1. **`docs_deleteContentRange`** (Day 1)
   - Fundamental editing operation
   - Dependency for testing other tools

2. **`docs_replaceAllText`** (Day 1)
   - Common find/replace operation
   - Independent of other tools

3. **`docs_createParagraphBullets`** (Day 2)
   - High-value formatting feature
   - No dependencies

4. **`docs_insertPageBreak`** (Day 2)
   - Simple, common operation
   - Good for building confidence

5. **`docs_deleteParagraphBullets`** (Day 3)
   - Pairs with createParagraphBullets
   - Can test both together

6. **`docs_updateDocumentStyle`** (Day 3)
   - More complex (many parameters)
   - Good final challenge for Phase 1

---

## Testing Checklist (Per Tool)

### Unit Tests (5 tests minimum)
- [ ] Validates required parameters
- [ ] Validates optional parameters
- [ ] Calls Google API with correct request format
- [ ] Handles API errors gracefully
- [ ] Returns valid MCP response format

### Integration Tests (3 tests minimum)
- [ ] Works with OAuth document
- [ ] Works with public document
- [ ] Handles error cases (invalid IDs, permission errors)

### Manual Tests
- [ ] Test with MCP Inspector
- [ ] Test with both test documents
- [ ] Test edge cases from API constraints

### Documentation
- [ ] Tool marked as implemented in `api_reference_docs.md`
- [ ] Coverage statistics updated
- [ ] Examples added if needed

---

## Acceptance Criteria for Phase 1 Completion

### Code Quality
- [ ] All 6 tools implemented
- [ ] All tools follow consistent pattern (schema → definition → handler)
- [ ] Error handling implemented for all tools
- [ ] TypeScript types properly used

### Test Coverage
- [ ] ≥30 unit tests (5 per tool)
- [ ] ≥18 integration tests (3 per tool)
- [ ] All tests passing
- [ ] Coverage ≥80% for new code

### Documentation
- [ ] All tools documented in `api_reference_docs.md`
- [ ] Coverage statistics updated (from 9% to ~25%)
- [ ] Examples provided for each tool

### Validation
- [ ] All tools tested with MCP Inspector
- [ ] Both OAuth and public documents tested
- [ ] No regressions in existing tools

---

## File Structure After Phase 1

```
src/
└── index.ts (updated with 6 new tools)

tests/
├── unit/
│   ├── example.test.ts (existing)
│   └── docs-lowlevel.test.ts (NEW - 30 tests)
├── integration/
│   └── docs-lowlevel.integration.test.ts (NEW - 18 tests)
└── helpers/ (existing)

design/
├── api_reference_docs.md (updated)
└── PHASE_1_PLAN.md (this file)
```

---

## Success Metrics

**Before Phase 1**:
- Google Docs API coverage: 3/34 tools (9%)
- Unit tests: 0
- Integration tests: 1 smoke test

**After Phase 1**:
- Google Docs API coverage: 9/34 tools (26%)
- Unit tests: 30+
- Integration tests: 18+
- Test framework: Fully operational
- CI/CD: Ready for automation

---

## Risks & Mitigation

### Risk 1: API Rate Limits
**Impact**: Integration tests fail
**Mitigation**: Run tests sequentially (`threads: false` in vitest config)

### Risk 2: Test Documents Modified by Other Processes
**Impact**: Flaky tests
**Mitigation**: Reset document state in `beforeEach` hooks

### Risk 3: Complex API Parameters
**Impact**: Time overrun
**Mitigation**: Start with simple tools (deleteContentRange, insertPageBreak)

### Risk 4: OAuth Token Expiry During Tests
**Impact**: Test failures
**Mitigation**: Token refresh handled automatically by google-auth-library

---

## Next Steps After Phase 1

1. Commit all changes
2. Push to GitHub
3. Review test coverage report
4. Plan Phase 2 (Tables - 11 tools)
5. Consider setting up CI/CD with GitHub Actions

---

## Estimated Timeline

- **Day 1**: Tools 1-2 (delete, replaceAll) - 4 hours
- **Day 2**: Tools 3-4 (bullets, pageBreak) - 4 hours
- **Day 3**: Tools 5-6 (deleteBullets, documentStyle) - 4 hours
- **Day 4**: Documentation, cleanup, validation - 2 hours

**Total**: ~14 hours over 4 days

---

## Ready to Execute

All prerequisites complete:
✅ Test framework installed and validated
✅ Test helpers created
✅ API reference documented
✅ Test documents configured
✅ Implementation pattern established

**Status**: READY TO BEGIN PHASE 1 🚀
