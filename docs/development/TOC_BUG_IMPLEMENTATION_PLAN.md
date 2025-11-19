# TOC Index Bug - Implementation Plan

**Created**: 2025-11-18
**Status**: Ready for Implementation
**Priority**: High
**Breaking Change**: Yes (indices will change for documents with TOC/tables)

---

## Quick Reference

- **Bug Location**: `src/index.ts:5738-5758` (getGoogleDocContent handler)
- **Root Cause**: Manual index counting instead of using API-provided indices
- **Fix Type**: 3-line code change + validation checks
- **Tests Required**: 5+ unit tests (per design principles)
- **Estimated Effort**: 1-2 hours (code + tests)
- **Risk Level**: Medium (breaking change, but correct behavior)

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Investigation Summary](#investigation-summary)
3. [Implementation Steps](#implementation-steps)
4. [Testing Requirements](#testing-requirements)
5. [Breaking Change Documentation](#breaking-change-documentation)
6. [Deployment Strategy](#deployment-strategy)
7. [Rollback Plan](#rollback-plan)
8. [Success Criteria](#success-criteria)

---

## Prerequisites

### Before Starting

- [x] Root cause identified (see `TOC_BUG_INVESTIGATION.md`)
- [x] Investigation complete and documented
- [ ] Review design principles (`design/DESIGN_PRINCIPLES.md`)
- [ ] Review Google Docs API structure documentation
- [ ] Understand breaking change implications

### Required Knowledge

1. **Google Docs API Structure**:
   - Every `StructuralElement` has `startIndex` and `endIndex` properties
   - These indices are absolute positions in the document
   - They include ALL content: TOC, tables, section breaks, paragraphs
   - Reference: https://developers.google.com/docs/api/concepts/structure

2. **Current Bug Behavior**:
   - `getGoogleDocContent` manually counts indices (wrong)
   - Write operations use API indices (correct)
   - This creates ~1235 char offset in documents with TOC

3. **Design Principles**:
   - Tests are PART of implementation (not deferred)
   - Run `npm test` after each change
   - Breaking changes must be documented

### Development Environment Setup

```bash
# Ensure you're in the project root
cd /Users/clintgossett/Documents/Applied\ Frameworks/projects/google-drive-mcp

# Verify current status
git status  # Should be clean

# Create feature branch
git checkout -b fix/toc-index-bug

# Verify tests pass before starting
npm test  # Should show 625 tests passing

# Verify build works
npm run build
```

---

## Investigation Summary

### The Problem

**Two different index systems are in use:**

1. **Custom Manual Indices** (getGoogleDocContent - WRONG):
   - Manually calculated: `let currentIndex = 1; currentIndex += text.length`
   - Only includes paragraph text
   - Excludes TOC, tables, section breaks
   - Example: "TESTMARKER" appears at index 62

2. **Google API Absolute Indices** (write operations - CORRECT):
   - Official Google Docs document indices from API
   - Includes ALL content (TOC, tables, everything)
   - Example: "TESTMARKER" appears at index 1297

**Result**: ~1235 character offset (size of TOC) when formatting

### The Fix

**Change getGoogleDocContent to use API-provided indices**

**Current Code (WRONG)**:
```typescript
let currentIndex = 1;  // ← Remove this
segments.push({
  startIndex: currentIndex,  // ← WRONG
  endIndex: currentIndex + text.length  // ← WRONG
});
currentIndex += text.length;  // ← Remove this
```

**Fixed Code (CORRECT)**:
```typescript
// Remove manual counting entirely
segments.push({
  startIndex: textElement.startIndex,  // ← Use API index
  endIndex: textElement.endIndex  // ← Use API index
});
```

---

## Implementation Steps

### Step 1: Read Current Implementation

**Action**: Review the exact code that needs to be changed

```bash
# View the handler (lines 5727-5782)
sed -n '5727,5782p' src/index.ts
```

**What to look for**:
- Line ~5738: `let currentIndex = 1;` declaration
- Line ~5751: Manual index assignment in segments.push()
- Line ~5756: Manual index increment

**Expected observations**:
- Manual index counting (`currentIndex` variable)
- Only processes `element.paragraph.elements`
- Doesn't use `textElement.startIndex` or `textElement.endIndex`

### Step 2: Implement the Fix

**File**: `src/index.ts`
**Lines**: 5738-5758 (getGoogleDocContent handler)

**EXACT CODE CHANGE**:

```typescript
// BEFORE (lines 5738-5758):
let currentIndex = 1;
const segments: Array<{text: string, startIndex: number, endIndex: number}> = [];

if (document.data.body?.content) {
  for (const element of document.data.body.content) {
    if (element.paragraph?.elements) {
      for (const textElement of element.paragraph.elements) {
        if (textElement.textRun?.content) {
          const text = textElement.textRun.content;
          segments.push({
            text,
            startIndex: currentIndex,
            endIndex: currentIndex + text.length
          });
          content += text;
          currentIndex += text.length;
        }
      }
    }
  }
}

// AFTER (lines 5738-5758):
const segments: Array<{text: string, startIndex: number, endIndex: number}> = [];

if (document.data.body?.content) {
  for (const element of document.data.body.content) {
    if (element.paragraph?.elements) {
      for (const textElement of element.paragraph.elements) {
        if (textElement.textRun?.content &&
            textElement.startIndex !== undefined &&
            textElement.endIndex !== undefined) {
          segments.push({
            text: textElement.textRun.content,
            startIndex: textElement.startIndex,  // ✅ Use API index
            endIndex: textElement.endIndex        // ✅ Use API index
          });
          content += textElement.textRun.content;
        }
      }
    }
  }
}
```

**Key Changes**:
1. ❌ **Remove**: `let currentIndex = 1;` declaration
2. ✅ **Add**: Check for `textElement.startIndex !== undefined`
3. ✅ **Add**: Check for `textElement.endIndex !== undefined`
4. ✅ **Change**: Use `textElement.startIndex` instead of `currentIndex`
5. ✅ **Change**: Use `textElement.endIndex` instead of `currentIndex + text.length`
6. ❌ **Remove**: `currentIndex += text.length;` increment

**Verification**:
```bash
# After making changes, verify syntax
npm run typecheck

# Should show no errors in src/index.ts
```

### Step 3: Write Unit Tests

**File**: `tests/unit/getGoogleDocContent.test.ts` (CREATE NEW FILE)

**Required Tests** (minimum 5 per design principles):

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { docs_v1 } from '@googleapis/docs';

describe('getGoogleDocContent - Index System', () => {
  let mockDocsGet: any;

  beforeEach(() => {
    mockDocsGet = vi.fn();
  });

  it('should use API-provided indices, not manual counting', async () => {
    // Mock response with API indices
    const mockResponse = {
      data: {
        body: {
          content: [
            {
              paragraph: {
                elements: [
                  {
                    startIndex: 1000,  // API provides this
                    endIndex: 1050,    // API provides this
                    textRun: {
                      content: 'Test content'
                    }
                  }
                ]
              }
            }
          ]
        }
      }
    };

    mockDocsGet.mockResolvedValue(mockResponse);

    // Call the handler (need to extract/expose logic for testing)
    const result = extractContentWithIndices(mockResponse.data);

    // Verify we use API indices (1000-1050), not manual counting (1-12)
    expect(result.segments[0].startIndex).toBe(1000);
    expect(result.segments[0].endIndex).toBe(1050);
  });

  it('should handle documents with TOC by using absolute indices', async () => {
    const mockResponse = {
      data: {
        body: {
          content: [
            {
              startIndex: 1,
              endIndex: 1235,
              tableOfContents: {}  // TOC takes up indices 1-1235
            },
            {
              paragraph: {
                elements: [
                  {
                    startIndex: 1235,  // Content starts after TOC
                    endIndex: 1297,
                    textRun: {
                      content: 'TESTMARKER'
                    }
                  }
                ]
              }
            }
          ]
        }
      }
    };

    mockDocsGet.mockResolvedValue(mockResponse);
    const result = extractContentWithIndices(mockResponse.data);

    // Should use absolute index 1235, not relative index 1
    expect(result.segments[0].startIndex).toBe(1235);
    expect(result.segments[0].endIndex).toBe(1297);
  });

  it('should skip elements without startIndex/endIndex', async () => {
    const mockResponse = {
      data: {
        body: {
          content: [
            {
              paragraph: {
                elements: [
                  {
                    // Missing startIndex and endIndex
                    textRun: {
                      content: 'Should be skipped'
                    }
                  },
                  {
                    startIndex: 100,
                    endIndex: 110,
                    textRun: {
                      content: 'Included'
                    }
                  }
                ]
              }
            }
          ]
        }
      }
    };

    mockDocsGet.mockResolvedValue(mockResponse);
    const result = extractContentWithIndices(mockResponse.data);

    // Should only include element with indices
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0].text).toBe('Included');
    expect(result.segments[0].startIndex).toBe(100);
  });

  it('should handle multiple paragraphs with correct absolute indices', async () => {
    const mockResponse = {
      data: {
        body: {
          content: [
            {
              paragraph: {
                elements: [
                  {
                    startIndex: 10,
                    endIndex: 20,
                    textRun: { content: 'First' }
                  }
                ]
              }
            },
            {
              paragraph: {
                elements: [
                  {
                    startIndex: 50,  // Gap due to TOC/table
                    endIndex: 60,
                    textRun: { content: 'Second' }
                  }
                ]
              }
            }
          ]
        }
      }
    };

    mockDocsGet.mockResolvedValue(mockResponse);
    const result = extractContentWithIndices(mockResponse.data);

    // Indices should reflect gaps (not sequential 1,2,3...)
    expect(result.segments[0].startIndex).toBe(10);
    expect(result.segments[0].endIndex).toBe(20);
    expect(result.segments[1].startIndex).toBe(50);
    expect(result.segments[1].endIndex).toBe(60);
  });

  it('should match indices returned by write operations', async () => {
    // This test verifies read/write index consistency
    const mockResponse = {
      data: {
        body: {
          content: [
            {
              paragraph: {
                elements: [
                  {
                    startIndex: 1297,
                    endIndex: 1307,
                    textRun: { content: 'TESTMARKER' }
                  }
                ]
              }
            }
          ]
        }
      }
    };

    mockDocsGet.mockResolvedValue(mockResponse);
    const result = extractContentWithIndices(mockResponse.data);

    // If we format at these indices, it should hit "TESTMARKER"
    const formatStartIndex = result.segments[0].startIndex;
    const formatEndIndex = result.segments[0].endIndex;

    expect(formatStartIndex).toBe(1297);
    expect(formatEndIndex).toBe(1307);

    // These indices should work directly with formatGoogleDocText
    // (no offset calculation needed)
  });
});
```

**Note**: You may need to refactor `getGoogleDocContent` to extract the content parsing logic into a separate testable function.

**Run Tests**:
```bash
npm test tests/unit/getGoogleDocContent.test.ts
```

**Expected**: All 5+ tests pass

### Step 4: Run Full Test Suite

```bash
# Run all tests
npm test

# Expected output:
# ✓ tests/unit/getGoogleDocContent.test.ts (5 tests)
# ✓ [all other test files]
# Test Files  X passed (X)
# Tests  630+ passed (630+)  ← Should increase from 625

# Verify no regressions
npm run build
```

**If tests fail**:
1. Review error messages
2. Check if the fix broke existing functionality
3. Adjust implementation or tests as needed
4. DO NOT PROCEED until all tests pass

### Step 5: Update Documentation

#### 5a. Update known_issues.md

**File**: `docs/development/known_issues.md`

**Change Line 9**:
```markdown
**Status**: ✅ FIXED in v1.x.x (2025-11-18)
```

**Add after line 14**:
```markdown
**Fix Deployed**: 2025-11-18
**Breaking Change**: Yes - indices now match Google API (documents with TOC will see different indices)
```

**Add new section after line 243**:
```markdown
### Fix Implemented (2025-11-18)

The bug has been fixed by updating `getGoogleDocContent` to use Google API-provided indices instead of manual counting.

**What Changed**:
- ✅ `getGoogleDocContent` now uses `textElement.startIndex` and `textElement.endIndex` from API
- ✅ Read indices now match write indices (no offset needed)
- ✅ Works correctly with TOC, tables, section breaks

**Breaking Change**:
- ⚠️ Indices for documents with TOC/tables will change
- ⚠️ Previous workarounds (adding offsets) must be removed
- ✅ Documents without TOC: No impact

**Migration**:
- Re-call `getGoogleDocContent` to get updated indices
- Remove any manual offset calculations (+1235, etc.)
- Test formatting operations with new indices

**Commit**: [commit hash]
```

#### 5b. Create Migration Guide

**File**: `docs/development/TOC_BUG_MIGRATION_GUIDE.md` (CREATE NEW)

```markdown
# Migration Guide: TOC Index Bug Fix

**Version**: v1.x.x
**Date**: 2025-11-18
**Breaking Change**: Yes

---

## What Changed

The `getGoogleDocContent` tool now returns **Google API absolute indices** instead of custom manual indices.

This fixes a bug where documents with Table of Contents (TOC) had a ~1235 character index offset between read and write operations.

---

## Who Is Affected

### ✅ NOT Affected (No Action Required)

- Documents **without** Table of Contents
- Documents **without** tables or section breaks
- New documents created after this fix
- Code that doesn't save/reference indices

### ⚠️ AFFECTED (Action Required)

- Documents **with** Table of Contents
- Code that saves indices from `getGoogleDocContent` for later use
- Workflows with manual offset calculations (e.g., `+1235`)

---

## Migration Steps

### Step 1: Re-read All Documents

**Before Fix**:
```javascript
const content = await getGoogleDocContent(docId);
// "TESTMARKER" at indices [62-72]
```

**After Fix**:
```javascript
const content = await getGoogleDocContent(docId);
// "TESTMARKER" at indices [1297-1307] ← Changed!
```

**Action**: Call `getGoogleDocContent` again to get updated indices.

### Step 2: Remove Manual Offsets

**Before Fix (workaround)**:
```javascript
const OFFSET = 1235;  // ← Remove this
await formatGoogleDocText({
  startIndex: readIndex + OFFSET,  // ← Remove offset
  endIndex: readIndex + OFFSET,
  ...
});
```

**After Fix (correct)**:
```javascript
await formatGoogleDocText({
  startIndex: readIndex,  // ← Use directly
  endIndex: readEndIndex,
  ...
});
```

**Action**: Remove all manual offset calculations.

### Step 3: Test Formatting Operations

```javascript
// 1. Get content with new indices
const content = await getGoogleDocContent(docId);

// 2. Find text you want to format
const segment = content.segments.find(s => s.text.includes("TESTMARKER"));

// 3. Format using returned indices (no offset!)
await formatGoogleDocText({
  documentId: docId,
  startIndex: segment.startIndex,  // Use directly
  endIndex: segment.endIndex,
  foregroundColor: { red: 1, green: 0, blue: 0 }
});

// 4. Verify: TESTMARKER should turn red
```

---

## Example: Before vs After

### Before Fix (with workaround)

```javascript
// Document with TOC
const content = await getGoogleDocContent(docId);
// Returns: { segments: [{ text: "TESTMARKER", startIndex: 62, endIndex: 72 }] }

// Apply manual offset
const TOC_OFFSET = 1235;
await formatGoogleDocText({
  documentId: docId,
  startIndex: 62 + TOC_OFFSET,  // 1297
  endIndex: 72 + TOC_OFFSET,    // 1307
  bold: true
});
```

### After Fix (no workaround needed)

```javascript
// Document with TOC
const content = await getGoogleDocContent(docId);
// Returns: { segments: [{ text: "TESTMARKER", startIndex: 1297, endIndex: 1307 }] }

// Use indices directly
await formatGoogleDocText({
  documentId: docId,
  startIndex: 1297,  // No offset!
  endIndex: 1307,
  bold: true
});
```

---

## FAQ

**Q: Do I need to update documents without TOC?**
A: No. Documents without TOC will have the same indices before and after the fix.

**Q: What if I have saved indices in a database?**
A: Re-read the document using `getGoogleDocContent` and update your saved indices.

**Q: Will this break my existing workflows?**
A: Only if you're using workarounds (manual offsets). Remove those workarounds.

**Q: How do I know if a document has a TOC?**
A: If read indices previously didn't match write indices, the document has structural elements (TOC/tables).

---

## Support

If you encounter issues after migration:
1. Verify you're using the latest version
2. Re-call `getGoogleDocContent` to refresh indices
3. Remove any manual offset calculations
4. File an issue with reproduction steps

---

**Last Updated**: 2025-11-18
```

#### 5c. Update CHANGELOG

**File**: `CHANGELOG.md` (create if doesn't exist, or add section)

```markdown
## [Unreleased]

### Fixed
- **BREAKING**: Fixed TOC index offset bug in `getGoogleDocContent` ([#XXX](link))
  - Now uses Google API-provided indices instead of manual counting
  - Read indices now match write indices (no offset needed)
  - Documents with Table of Contents will see different index values
  - See `docs/development/TOC_BUG_MIGRATION_GUIDE.md` for migration steps

### Migration Required
- Re-call `getGoogleDocContent` for documents with TOC/tables
- Remove manual offset calculations (e.g., `+1235`)
- Documents without TOC: No changes needed
```

### Step 6: Commit Changes

```bash
# Stage changes
git add src/index.ts
git add tests/unit/getGoogleDocContent.test.ts
git add docs/development/known_issues.md
git add docs/development/TOC_BUG_MIGRATION_GUIDE.md
git add CHANGELOG.md

# Verify staged changes
git status
git diff --staged

# Commit with detailed message
git commit -m "$(cat <<'EOF'
Fix: Correct index system in getGoogleDocContent

BREAKING CHANGE: getGoogleDocContent now returns Google API absolute
indices instead of custom manual indices.

Root Cause:
- getGoogleDocContent manually counted indices (let currentIndex = 1)
- Only included paragraph text, excluded TOC/tables
- Write operations correctly used Google API indices
- This created ~1235 char offset in documents with TOC

Fix:
- Use textElement.startIndex from API (not manual counting)
- Use textElement.endIndex from API (not calculated length)
- Add validation for undefined indices
- Read indices now match write indices exactly

Impact:
- Documents WITHOUT TOC: No impact (indices unchanged)
- Documents WITH TOC: Indices will change (breaking change)
- Manual offset workarounds must be removed

Testing:
- Added 5 unit tests for index system validation
- All 630+ tests passing
- Verified with mock TOC structures

Files Changed:
- src/index.ts (lines 5738-5758): Remove manual counting, use API indices
- tests/unit/getGoogleDocContent.test.ts: New test file (5 tests)
- docs/development/known_issues.md: Mark as FIXED
- docs/development/TOC_BUG_MIGRATION_GUIDE.md: Migration guide
- CHANGELOG.md: Document breaking change

See docs/development/TOC_BUG_INVESTIGATION.md for full analysis.
See docs/development/TOC_BUG_MIGRATION_GUIDE.md for migration steps.

🤖 Generated with Claude Code

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"

# Verify commit
git log -1 --stat
```

---

## Testing Requirements

### Unit Tests (Required)

**Location**: `tests/unit/getGoogleDocContent.test.ts`

**Minimum Tests** (5+ per design principles):
1. ✅ Should use API-provided indices, not manual counting
2. ✅ Should handle documents with TOC using absolute indices
3. ✅ Should skip elements without startIndex/endIndex
4. ✅ Should handle multiple paragraphs with correct absolute indices
5. ✅ Should match indices returned by write operations

**Additional Tests** (recommended):
6. Should handle empty documents
7. Should handle documents with only TOC (no paragraphs)
8. Should handle mixed content (TOC + tables + paragraphs)
9. Should preserve text content accurately
10. Should handle Unicode/emoji in content

### Integration Tests (Manual)

**Test Document Setup**:
```
Document Structure:
[Title]
[Table of Contents - 35 entries]
TESTMARKER ← Target text
Section 1: Content
Section 2: More content
```

**Test Procedure**:

1. **Read Test**:
   ```bash
   # Call getGoogleDocContent
   # Verify "TESTMARKER" indices in response
   # Expected: Should be >1000 (after TOC)
   ```

2. **Write Test**:
   ```bash
   # Use indices from read operation directly
   # Format "TESTMARKER" with bold/color
   # Verify: Correct text is formatted
   ```

3. **Consistency Test**:
   ```bash
   # Read → Format → Read again
   # Verify: Same indices, formatting applied
   ```

**Test Documents**:
- OAuth test doc: `1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w`
- Public test doc: `18iVsRPn2L49sJtbgyvE3sakRG3v3mY--s4z5nPkghaI`
- Original bug report doc: `130QyNt_6z8TJNp04gBqDciiI8MNTf4E7oW0U3S-IB_0`

### Regression Tests

```bash
# Run full test suite
npm test

# Expected:
# - All existing tests still pass (no regressions)
# - New tests pass (5+ tests added)
# - Total: 630+ tests passing

# Run type checking
npm run typecheck

# Run build
npm run build

# All should succeed with no errors
```

---

## Breaking Change Documentation

### What Is Breaking

**Behavior Change**:
- `getGoogleDocContent` now returns different indices for documents with TOC/tables
- Indices are now absolute (Google API indices) instead of relative (custom indices)

**Who Is Affected**:
- Users with documents containing Table of Contents
- Users with documents containing tables or section breaks
- Code that saves/caches indices from previous reads

**Who Is NOT Affected**:
- Documents without TOC/tables (indices unchanged)
- New documents (no existing index references)
- Code that reads and formats immediately (no saved indices)

### Migration Required

**Step 1**: Re-read documents with `getGoogleDocContent`
**Step 2**: Remove manual offset calculations
**Step 3**: Test formatting operations

**See**: `docs/development/TOC_BUG_MIGRATION_GUIDE.md`

### Communication Plan

**Before Release**:
1. Update CHANGELOG.md with breaking change warning
2. Create migration guide
3. Add deprecation notice in documentation

**At Release**:
1. Include migration guide in release notes
2. Tag as breaking change (semver: MAJOR version bump)
3. Update README with migration instructions

**After Release**:
1. Monitor for user issues
2. Provide migration support
3. Update examples/tutorials

---

## Deployment Strategy

### Pre-Deployment Checklist

- [ ] All unit tests pass (630+ tests)
- [ ] Type checking passes (no TypeScript errors)
- [ ] Build succeeds (no compilation errors)
- [ ] Code reviewed and approved
- [ ] Documentation updated (known_issues, migration guide, CHANGELOG)
- [ ] Breaking change clearly communicated

### Version Numbering

**Current**: v1.x.x
**Next**: v2.0.0 (MAJOR version bump due to breaking change)

**Reasoning**: Per semver, breaking changes require MAJOR version increment.

### Deployment Steps

1. **Merge to Main**:
   ```bash
   git checkout master
   git merge fix/toc-index-bug
   ```

2. **Tag Release**:
   ```bash
   git tag -a v2.0.0 -m "Fix TOC index bug (BREAKING CHANGE)"
   git push origin master --tags
   ```

3. **Publish to NPM**:
   ```bash
   npm version major  # 1.x.x → 2.0.0
   npm publish
   ```

4. **Update Documentation**:
   - Update README.md with new version
   - Update examples with corrected usage
   - Add migration guide link to main docs

5. **Announce**:
   - GitHub release notes
   - Update parent project (`af-product-marketing-claude`)

### Post-Deployment Monitoring

**Week 1**:
- Monitor GitHub issues for bug reports
- Check for user confusion about indices
- Provide migration support

**Week 2-4**:
- Gather feedback on breaking change impact
- Update migration guide based on real-world issues
- Consider additional examples if needed

---

## Rollback Plan

### If Critical Issues Arise

**Severity Levels**:

**Level 1: Index values incorrect**
→ Verify fix implementation, check test coverage

**Level 2: Formatting operations fail**
→ Check write operations still use indices correctly

**Level 3: Data corruption or loss**
→ **ROLLBACK IMMEDIATELY**

### Rollback Procedure

```bash
# 1. Revert commit
git revert [commit-hash]

# 2. Deploy previous version
npm version patch  # 2.0.0 → 2.0.1 (revert)
npm publish

# 3. Tag as hotfix
git tag -a v2.0.1 -m "Hotfix: Revert TOC index fix (temporary)"
git push origin master --tags

# 4. Communicate
# - Announce rollback
# - Explain issues encountered
# - Provide timeline for re-fix
```

### Re-Fix Strategy

1. **Analyze**: What went wrong?
2. **Additional Tests**: Add tests for failure case
3. **Re-Implement**: Fix the issue
4. **Extra Testing**: Extended testing period
5. **Re-Deploy**: v2.1.0 with corrected fix

---

## Success Criteria

### Definition of Done

**Code**:
- [x] Fix implemented (3-line change + validation)
- [ ] All tests pass (630+ tests)
- [ ] No TypeScript errors
- [ ] Build succeeds

**Tests**:
- [ ] 5+ unit tests added
- [ ] All tests verify API indices used (not manual)
- [ ] Edge cases covered (missing indices, TOC, tables)
- [ ] No regressions in existing tests

**Documentation**:
- [ ] known_issues.md updated (marked as FIXED)
- [ ] Migration guide created
- [ ] CHANGELOG.md updated
- [ ] Breaking change documented

**Quality**:
- [ ] Code follows design principles
- [ ] No manual index counting
- [ ] Uses API-provided indices exclusively
- [ ] Handles undefined indices gracefully

### Acceptance Tests

**Test 1: Document Without TOC**
```
Given: A document without Table of Contents
When: I call getGoogleDocContent
Then: Indices should be the same as before fix
And: Formatting should work without changes
```

**Test 2: Document With TOC**
```
Given: A document with Table of Contents
When: I call getGoogleDocContent
Then: Indices should be absolute (include TOC offset)
And: Formatting should work without manual offset
```

**Test 3: Read-Write Consistency**
```
Given: Any document structure
When: I read indices with getGoogleDocContent
And: I format using those exact indices
Then: The correct text should be formatted
And: No offset calculation should be needed
```

### Validation

**Before Declaring Success**:
1. Test with original bug report document (`130QyNt_...`)
2. Test with OAuth test document (`1CIeAIWDqN_...`)
3. Test with documents without TOC
4. Verify all 630+ tests pass
5. Build and deploy to test environment
6. Manually verify formatting operations

---

## Timeline Estimate

**Total Effort**: 1-2 hours

**Breakdown**:
- Step 1 (Read code): 5 minutes
- Step 2 (Implement fix): 10 minutes
- Step 3 (Write tests): 30 minutes
- Step 4 (Run tests): 5 minutes
- Step 5 (Documentation): 20 minutes
- Step 6 (Commit): 5 minutes
- Testing/Validation: 15-30 minutes

**Buffer**: +30 minutes for unexpected issues

---

## Risk Assessment

### Low Risks ✅

- **Simple code change** (3 lines)
- **Well-understood problem** (root cause identified)
- **Comprehensive tests** (5+ unit tests)
- **No API changes** (still using same Google API)

### Medium Risks ⚠️

- **Breaking change** (indices will change for TOC documents)
  - *Mitigation*: Clear migration guide, version bump to 2.0.0

- **User workflows may break** (if they saved indices)
  - *Mitigation*: Document migration steps, provide examples

### High Risks 🚨

- **None identified**

### Risk Mitigation

1. **Comprehensive Testing**: 630+ tests ensure no regressions
2. **Documentation**: Migration guide helps users adapt
3. **Version Control**: Semver communicates breaking change
4. **Rollback Plan**: Can revert if critical issues arise

---

## References

### Investigation Documents
- `docs/development/TOC_BUG_INVESTIGATION.md` - Full investigation report
- `docs/development/known_issues.md` - Original bug report

### Design Documents
- `design/DESIGN_PRINCIPLES.md` - Project design principles
- `design/docs_api_reference.md` - Google Docs API reference

### Google Documentation
- [Google Docs API Structure](https://developers.google.com/docs/api/concepts/structure)
- [StructuralElement](https://developers.google.com/docs/api/reference/rest/v1/documents#StructuralElement)

### Test Documents
- OAuth: `1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w`
- Public: `18iVsRPn2L49sJtbgyvE3sakRG3v3mY--s4z5nPkghaI`
- Bug report: `130QyNt_6z8TJNp04gBqDciiI8MNTf4E7oW0U3S-IB_0`

---

## Next Steps

1. **Review this plan** with stakeholders
2. **Create feature branch**: `git checkout -b fix/toc-index-bug`
3. **Follow implementation steps** (Steps 1-6 above)
4. **Run all tests** and verify success criteria
5. **Deploy** following deployment strategy
6. **Monitor** for issues post-deployment

---

**Last Updated**: 2025-11-18
**Status**: Ready for Implementation
**Assignee**: TBD
**Estimated Completion**: 2025-11-XX
