# Autonomous Development Workflow

## Purpose

This document defines the complete workflow for taking a GitHub issue from creation to closure autonomously, following the patterns established in Issues #1, #2, and #4.

---

## Table of Contents

1. [Issue Intake & Planning](#issue-intake--planning)
2. [Phase-Based Execution](#phase-based-execution)
3. [Per-Tool Implementation](#per-tool-implementation)
4. [Testing Requirements](#testing-requirements)
5. [Documentation Updates](#documentation-updates)
6. [GitHub Issue Management](#github-issue-management)
7. [Commit Strategy](#commit-strategy)
8. [Example Workflows](#example-workflows)

---

## Issue Intake & Planning

### Step 1: Read the Issue
```bash
gh issue view <issue-number>
```

**Extract**:
- Problem statement
- Desired outcome
- Acceptance criteria
- Any constraints or requirements

### Step 2: Read Required Documentation (In Order)

**MANDATORY Reading (Do Not Skip)**:
1. `design/DESIGN_PRINCIPLES.md` - Master reference for all decisions
2. `design/LESSONS_LEARNED.md` - Past mistakes to avoid
3. `design/API_MAPPING_STRATEGY.md` - How to map APIs to tools
4. Relevant API reference (`api_reference_docs.md`, `api_reference_sheets.md`, etc.)

### Step 3: Create Historical Documentation Structure

```bash
mkdir -p docs/historical/issue_<number>
touch docs/historical/issue_<number>/README.md
```

**README.md Template**:
```markdown
# Issue #<number>: <Title>

**GitHub Issue**: https://github.com/<org>/<repo>/issues/<number>

**Status**: 🔄 IN PROGRESS

**Purpose**: <One sentence description>

---

## Investigation Documents

### 1. <Document Name>
- **[DOCUMENT.md](./DOCUMENT.md)** - Description

### 2. Decisions Made
- **[DECISIONS.md](./DECISIONS.md)** - All autonomous decisions with rationale

---

## Quick Summary

<High-level overview>

---

## Recommendations

<Action items>

---

**Created**: YYYY-MM-DD
**Last Updated**: YYYY-MM-DD
```

**DECISIONS.md Template**:
```markdown
# Decisions Made During Issue #<number>

This document records all significant decisions made autonomously during implementation.

---

## Decision 1: <Title>

**Date**: YYYY-MM-DD

**Context**: <What led to this decision>

**Options Considered**:
- Option A: <description>
  - Pros: <list>
  - Cons: <list>
- Option B: <description>
  - Pros: <list>
  - Cons: <list>

**Decision**: Chose Option <X>

**Rationale**:
- Reason 1
- Reason 2
- Reference to design principle or past lesson

**Outcome**: <What happened after implementing this decision>

---

## Decision 2: <Title>

...
```

### Step 4: Break Down Into Phases

**Criteria for phases**:
- Each phase should be completable in one session
- Each phase should have clear deliverables
- Phases build on each other
- Each phase should end with working, tested code

**Example Phase Structure**:
```
Phase 1: Investigation & Analysis
Phase 2: Remove/Fix Critical Issues
Phase 3: Implement New Features
Phase 4: Documentation & Cleanup
```

### Step 5: Create Todo List

**CRITICAL**: Follow per-tool testing approach

**✅ CORRECT Todo Structure**:
```
1. Read design principles and understand requirements
2. Investigate <specific area>
3. Document findings
4. Implement tool A (code + tests)
5. Implement tool B (code + tests)
6. Update documentation
```

**❌ WRONG Todo Structure**:
```
1. Implement all tools
2. Test everything at the end
```

Use `TodoWrite` tool to track progress throughout.

---

## Phase-Based Execution

### Phase Start

1. **Post phase plan to GitHub issue**:
```bash
gh issue comment <number> --body "## Phase <N>: <Title>

**Goals**:
- Goal 1
- Goal 2

**Deliverables**:
- Deliverable 1
- Deliverable 2

**Steps**:
1. Step 1
2. Step 2
"
```

2. **Create phase branch (optional)**:
```bash
git checkout -b issue-<number>-phase-<N>
```

### Phase Execution

**For each task in the phase**:

1. Update todo list: Mark as `in_progress`
2. Implement the task
3. Test the task (if code)
4. Verify success
5. Update todo list: Mark as `completed`
6. Commit (if significant milestone)

### Phase Completion

1. **Verify all phase deliverables**:
   - All code implemented
   - All tests passing
   - Documentation updated
   - No regressions

2. **Post phase summary to GitHub**:
```bash
gh issue comment <number> --body "## ✅ Phase <N> Complete

**Completed**:
- [x] Task 1
- [x] Task 2

**Results**:
- Metric 1: Value
- Metric 2: Value

**Commit**: <commit-hash>
"
```

3. **Commit phase work**:
```bash
git commit -m "Issue #<number> Phase <N>: <summary>"
```

---

## Per-Tool Implementation

### The Per-Tool Workflow (MANDATORY)

**For EACH tool, follow this EXACT sequence**:

```
1. Read API documentation for specific request type
2. Write Zod schema with validation (src/index.ts ~line 410)
3. Write 5+ unit tests for schema (tests/unit/<toolname>.test.ts)
4. Run `npm test` - verify tests pass
5. Write tool definition in ListToolsRequest (src/index.ts ~line 1460)
6. Write case handler implementation (src/index.ts ~line 3400)
7. Run `npm test` again - verify all tests still pass
8. Run `npm run build` - verify build succeeds
9. Mark tool as COMPLETE in todo list
10. Move to next tool
```

**NEVER batch implement multiple tools before testing!**

### Code Structure (MANDATORY)

**Every tool must follow this EXACT pattern**:

#### 1. Zod Schema (~line 410)
```typescript
const ToolNameSchema = z.object({
  documentId: z.string().min(1, "Document ID is required"),
  param1: z.string(),
  param2: z.number().optional(),
});
```

#### 2. Tool Definition (~line 1460)
```typescript
{
  name: "api_toolName",
  description: "Clear description. Maps to <RequestType> in <API>. Include constraints.",
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
```

#### 3. Case Handler (~line 3400)
```typescript
case "api_toolName": {
  // 1. Validate
  const validation = ToolNameSchema.safeParse(request.params.arguments);
  if (!validation.success) {
    return errorResponse(validation.error.errors[0].message);
  }
  const args = validation.data;

  // 2. Create API client
  const api = google.api({ version: 'v1', auth: authClient });

  // 3. Execute with error handling
  try {
    const response = await api.method({
      param: args.param,
      requestBody: { /* API request */ }
    });

    // 4. Return success
    return {
      content: [{ type: "text", text: "Success message with details" }],
      isError: false
    };
  } catch (error: any) {
    return errorResponse(error.message || 'Operation failed');
  }
}
```

---

## Testing Requirements

### Unit Tests (Per Tool, MANDATORY)

**Minimum 5 tests per tool**:

1. ✅ Validates required parameters
2. ✅ Validates optional parameters
3. ✅ Calls Google API with correct format
4. ✅ Handles API errors gracefully
5. ✅ Returns valid MCP response format

**Test File Template** (`tests/unit/<toolname>.test.ts`):
```typescript
import { describe, it, expect } from 'vitest';
import { z } from 'zod';

// Schema definition (matches src/index.ts)
const ToolNameSchema = z.object({
  documentId: z.string().min(1, "Document ID is required"),
  param1: z.string()
});

describe('api_toolName', () => {
  describe('Schema Validation', () => {
    it('should validate with required parameters', () => {
      const input = { documentId: 'doc-123', param1: 'value' };
      const result = ToolNameSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('should reject missing required parameters', () => {
      const input = { documentId: 'doc-123' };
      const result = ToolNameSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    // 3+ more tests...
  });

  describe('API Call Format', () => {
    it('should map to correct API call format', () => {
      // Test parameter mapping
    });
  });

  describe('Response Format', () => {
    it('should return valid MCP response', () => {
      // Test response structure
    });
  });
});
```

### Running Tests (After EACH Tool)

```bash
# Run specific tool tests
npm test -- <toolname>.test.ts

# Run all tests
npm test

# Check coverage
npm run test:coverage
```

**Requirements**:
- ✅ All tests must pass
- ✅ Coverage ≥80% for new code
- ✅ No regressions in existing tests

---

## Documentation Updates

### During Implementation

**Update as you go**:

1. **API Reference** (`design/*_api_reference.md`):
   - Mark tool as ✅ Implemented
   - Update implementation count
   - Add commit reference

2. **Historical Documentation** (`docs/historical/issue_<number>/`):
   - Document decisions made
   - Record investigation findings
   - Note any deviations from plan

### End of Phase

**Required updates**:

1. **README.md** (if breaking changes):
   ```markdown
   ## ⚠️ Breaking Changes (Issue #<number>)

   **Date**: YYYY-MM-DD

   ### Removed/Changed:
   - Tool X → Use tool Y instead

   **Why**: Explanation

   **Migration Guide**: Link to issue
   ```

2. **LESSONS_LEARNED.md** (if mistakes made):
   ```markdown
   ## Lesson N: <Title>

   **Date**: YYYY-MM-DD
   **Phase**: <What were you working on?>
   **What Happened**: <Description>

   ### The Mistake
   <What went wrong?>

   ### Root Cause Analysis
   <Why did it happen?>

   ### The Correct Approach
   <What should have been done?>

   ### Commitment Going Forward
   <How to avoid in future?>
   ```

3. **Historical Issue README** (`docs/historical/issue_<number>/README.md`):
   - Update status to ✅ COMPLETE
   - Add final summary
   - Link to commits

---

## GitHub Issue Management

### Issue Comments (Regular Updates)

**When to post updates**:
- ✅ After completing a phase
- ✅ When encountering blockers
- ✅ After significant discoveries
- ✅ Before making major decisions (ask for input)

**Update format**:
```markdown
## 📊 Progress Update

**Current Phase**: Phase N - <title>

**Completed**:
- [x] Task 1
- [x] Task 2

**In Progress**:
- [ ] Task 3

**Next Steps**:
- Step 1
- Step 2

**Blockers**: None / <blocker description>
```

### Autonomous Decision-Making

**For true autonomy, answer your own questions.**

**When questions arise**:

1. **Document the question**:
   ```markdown
   ## Decision Point: <Question>

   **Context**: <What led to this question>

   **Options**:
   - Option A: <description>
     - Pros: <list>
     - Cons: <list>
   - Option B: <description>
     - Pros: <list>
     - Cons: <list>

   **Decision**: Chose Option <X>

   **Rationale**: <Why this is the best choice>
   ```

2. **Make the best decision based on**:
   - Design principles (DESIGN_PRINCIPLES.md)
   - Past lessons (LESSONS_LEARNED.md)
   - API documentation
   - Code consistency
   - User needs (inferred from issue)

3. **Document in historical folder**:
   - Create `docs/historical/issue_<number>/DECISIONS.md`
   - Record all decisions made
   - Include rationale for each

4. **Move forward with confidence**

**Example**:
```markdown
## Decision Point: Should we remove or deprecate tool X?

**Context**: Tool X violates 1:1 API principles but may have users.

**Options**:
- Option A: Deprecate first, remove later
  - Pros: Backward compatibility, migration time
  - Cons: Technical debt, confusing API
- Option B: Remove immediately, document migration
  - Pros: Clean codebase, clear direction
  - Cons: Breaking change

**Decision**: Chose Option B (remove immediately)

**Rationale**:
- Design principles prioritize clean 1:1 mapping
- Proper replacement tools exist (sheets_createSpreadsheet + sheets_appendValues)
- README documents migration path
- Follows pattern from Issue #2 Phase 1
- User can compose operations with 1:1 tools

**Result**: Tool removed, documentation updated, tests passing
```

**Only ask user for input when**:
- ❌ Never for technical implementation details
- ❌ Never for design pattern questions (follow DESIGN_PRINCIPLES.md)
- ❌ Never for which API to use (read API docs)
- ✅ Major product direction changes (e.g., "Should we support API version X?")
- ✅ Business decisions outside your scope (e.g., "Should we monetize?")
- ✅ Deployment/infrastructure changes (e.g., "Should we deploy to prod?")

### Closing Issues

**Before closing, verify**:
- ✅ All acceptance criteria met
- ✅ All tests passing
- ✅ Documentation updated
- ✅ No open questions
- ✅ Code committed and pushed

**Closing comment**:
```bash
gh issue close <number> --comment "✅ Issue complete.

**Summary**: <one-line summary>

**Deliverables**:
- Deliverable 1
- Deliverable 2

**Tests**: X/X passing
**Commits**: <commit-hash>

See final comment above for detailed results."
```

---

## Commit Strategy

### When to Commit

**Commit granularity**:
- ✅ After completing a phase
- ✅ After implementing a group of related tools (with tests)
- ✅ After fixing a bug
- ✅ After major refactoring

**Don't commit**:
- ❌ Partial implementations (unless end of session)
- ❌ Failing tests
- ❌ Broken builds

### Commit Message Format

**Standard format**:
```
Issue #<number> Phase <N>: <Brief summary>

<Detailed description of changes>

Features:
- Feature 1
- Feature 2

Tests:
- X unit tests
- Y integration tests
- Coverage: Z%

Code Metrics:
- Added: X lines
- Removed: Y lines
- Net: +/-N lines

<Additional notes>

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>
```

**Example**:
```bash
git commit -m "$(cat <<'EOF'
Issue #2 Phase 2: Remove remaining design pattern violations

Removed 3 tools that violated 1:1 API mapping principles:
- createGoogleSheet (multi-step workflow)
- updateGoogleSheet (duplicate functionality)
- getGoogleSlidesContent (custom formatting)

Added 1 new tool following 1:1 design:
- slides_get (1:1 mapping to presentations.get API)

Tests:
- 7 new unit tests for slides_get
- All 797 tests passing (100%)
- Build successful

Code Metrics:
- Removed: 128 lines
- Added: 59 lines
- Net: -69 lines

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Example Workflows

### Example 1: Bug Fix (Issue #1)

**Issue**: Index offset bug in documents with TOC

**Workflow**:
```
1. Investigation Phase
   - Read issue description
   - Reproduce bug with test document
   - Document in docs/historical/issue_00001/TOC_BUG_INVESTIGATION.md
   - Post findings to GitHub issue

2. Root Cause Analysis Phase
   - Analyze code in getGoogleDocContent
   - Compare with docs_get approach
   - Document in docs/historical/issue_00001/GETGOOGLEDOCCONTENT_ANALYSIS.md
   - Post root cause to GitHub issue

3. Implementation Phase
   - Remove buggy tool (getGoogleDocContent)
   - Verify docs_get is proper replacement
   - Update tests (all pass)
   - Update README with breaking change
   - Commit: "Remove getGoogleDocContent (violates design principles)"

4. Verification Phase
   - Test with TOC document
   - Verify formatting now works correctly
   - Document in TOC_BUG_FIX_SUMMARY.md
   - Close issue with summary
```

**Key Lessons**:
- Document investigation thoroughly
- Use test documents to verify fix
- Update design docs when violations found

### Example 2: Design Pattern Audit (Issue #2)

**Issue**: Audit original tools for design violations

**Workflow**:
```
1. Planning Phase
   - Read design principles
   - Create evaluation criteria
   - Post plan to GitHub issue

2. Audit Phase
   - Evaluate all 31 tools
   - Document findings in PRE_1TO1_TOOLS_EVALUATION.md
   - Categorize: compliant, borderline, violating
   - Post results to GitHub issue

3. Execution Phase 1
   - Remove 5 critical violations
   - Update tests (all pass)
   - Update README
   - Commit: "Issue #2 Phase 1: Remove critical violations"
   - Post phase 1 complete to GitHub

4. Execution Phase 2
   - Remove remaining 3 violations
   - Implement replacement tool (slides_get)
   - Write 7 tests for new tool
   - Update tests (all 797 pass)
   - Update README
   - Commit: "Issue #2 Phase 2: Remove remaining violations"
   - Post phase 2 complete to GitHub

5. Completion
   - Verify all objectives met
   - Post final summary to GitHub
   - Close issue
```

**Key Lessons**:
- Break into phases for large audits
- Document decisions in historical folder
- Update GitHub after each phase
- Always add replacement before removing

### Example 3: Feature Implementation (Issue #4)

**Issue**: Implement complete Drive API coverage

**Workflow**:
```
1. Planning Phase
   - Audit Drive API reference
   - Count total operations (23 tools)
   - Break into logical phases:
     * Phase 1: Core file operations (7 tools)
     * Phase 2: Export functionality (1 tool)
     * Phase 3: Comments (5 tools)
     * Phase 4: Permissions (5 tools)
   - Post plan to GitHub issue

2. Phase 1 Implementation
   - For each tool:
     a. Write Zod schema
     b. Write 5+ tests
     c. Run tests (must pass)
     d. Write tool definition
     e. Write handler
     f. Run tests again
     g. Mark complete in todo
   - Commit after all 7 tools: "Issue #4 Phase 1: Core file operations"
   - Post phase 1 summary to GitHub

3. Phase 2-4 Implementation
   - Repeat phase 1 pattern for each phase
   - Commit after each phase
   - Post updates to GitHub

4. Completion
   - Verify 23/23 tools implemented
   - All tests passing
   - Update api_reference_drive.md (100% complete)
   - Post final metrics to GitHub
   - Close issue
```

**Key Lessons**:
- Break large features into phases
- Test after EACH tool (not at end)
- Update API reference as you go
- Commit after each phase

---

## Quick Reference Checklist

### Before Starting Any Work
- [ ] Read issue description thoroughly
- [ ] Read DESIGN_PRINCIPLES.md
- [ ] Read LESSONS_LEARNED.md
- [ ] Read relevant API reference
- [ ] Create todo list with per-tool testing

### For Each Tool Implementation
- [ ] Write Zod schema
- [ ] Write 5+ unit tests
- [ ] Run tests (must pass)
- [ ] Write tool definition
- [ ] Write case handler
- [ ] Run tests again (must pass)
- [ ] Run build (must succeed)
- [ ] Mark tool as complete

### Before Committing
- [ ] All tests pass (`npm test`)
- [ ] Build succeeds (`npm run build`)
- [ ] Documentation updated
- [ ] No regressions
- [ ] Meaningful commit message

### Before Closing Issue
- [ ] All acceptance criteria met
- [ ] All tests passing
- [ ] Documentation updated
- [ ] Final summary posted to GitHub
- [ ] Code committed and pushed

---

## Common Pitfalls to Avoid

### ❌ Mistake 1: Batch Testing
**Wrong**: Implement 10 tools, then write all tests
**Right**: Implement 1 tool + tests, verify, then next tool

### ❌ Mistake 2: Skipping Documentation
**Wrong**: "I'll document it later"
**Right**: Update docs as you code

### ❌ Mistake 3: Large Commits
**Wrong**: One commit for entire issue
**Right**: Commit after each phase

### ❌ Mistake 4: No GitHub Updates
**Wrong**: Work silently, post results at end
**Right**: Post updates after each phase

### ❌ Mistake 5: Assuming Requirements
**Wrong**: Guess at ambiguous requirements
**Right**: Use AskUserQuestion tool

### ❌ Mistake 6: Ignoring Design Principles
**Wrong**: "This shortcut will be faster"
**Right**: Follow design principles exactly

---

## Version History

- **v1.1** (2025-11-19): Added autonomous decision-making section
  - Removed AskUserQuestion guidance (too dependent)
  - Added decision documentation process
  - Added DECISIONS.md template
  - Clarified when to involve user (never for technical decisions)
  - Emphasis on answering own questions and documenting rationale

- **v1.0** (2025-11-19): Initial workflow documentation
  - Based on Issues #1, #2, and #4 patterns
  - Includes per-tool testing emphasis
  - Covers full cycle from intake to closure

---

## Summary

**Core Principles for TRUE Autonomy**:
1. 📖 Read design docs FIRST
2. 📝 Plan before implementing
3. 🔄 Break into phases
4. ✅ Test per-tool (not per-phase)
5. 📊 Update GitHub regularly
6. 🤔 **Answer your own questions** (document decisions)
7. 📚 Document as you go
8. ✨ Commit working code
9. 🎯 Verify before closing

**Decision-Making Framework**:
- ✅ **DO**: Make all technical and design decisions autonomously
- ✅ **DO**: Document decisions with rationale in DECISIONS.md
- ✅ **DO**: Follow design principles and past lessons
- ✅ **DO**: Move forward with confidence
- ❌ **DON'T**: Ask user for technical guidance
- ❌ **DON'T**: Ask user about design patterns
- ❌ **DON'T**: Wait for approval on implementation details

**Only involve user for**:
- Major product direction changes
- Business decisions outside technical scope
- Deployment/infrastructure decisions

**Follow this workflow exactly for fully autonomous issue resolution.**
