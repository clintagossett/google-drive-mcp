# Issue #2: Evaluation of Pre-1:1 API Design Tools

**GitHub Issue**: https://github.com/clintagossett/google-drive-mcp/issues/2

**Status**: 🔄 IN PROGRESS

**Purpose**: Evaluate all tools built before 1:1 API design principles, determine compliance, recommend actions

---

## Investigation Documents

### 1. Tool Evaluation Report
- **[PRE_1TO1_TOOLS_EVALUATION.md](./PRE_1TO1_TOOLS_EVALUATION.md)** - Complete evaluation of 31 pre-existing tools

---

## Quick Summary

**Evaluation Results** (31 tools total):
- ✅ **8 tools COMPLIANT** (26%) - All Drive file management tools
- ⚠️ **16 tools BORDERLINE** (52%) - Formatting tools with naming violations
- ❌ **5 tools VIOLATE** (16%) - Convenience tools with multi-step workflows
- 📝 **2 tools REMOVED** (6%) - Already removed (getGoogleDocContent, getGoogleSlidesContent in some commits)

### Critical Violations (Recommend Removal)

1. **`createGoogleDoc`** - Multi-step workflow (Drive + Docs APIs)
2. **`updateGoogleDoc`** - Multi-step workflow (get + delete + insert)
3. **`createGoogleSlides`** - Multi-step workflow (Drive + Slides APIs)
4. **`updateGoogleSlides`** - Multi-step workflow (hidden operations)
5. **`getGoogleSheetContent`** - Custom formatting (not raw API response)

### Borderline Cases (Recommend Deprecate/Rename)

16 formatting tools:
- Functionally correct (1:1 API mapping)
- Naming convention violations
- Examples: `formatGoogleDocText` (should be `docs_updateTextStyle`)

### Compliant Tools (Keep As-Is)

8 Drive file management tools:
- `search`, `createTextFile`, `updateTextFile`, `createFolder`
- `listFolder`, `deleteItem`, `renameItem`, `moveItem`

---

## Recommendations

### Phase 1: Deprecation
- Mark 5 critical violations as deprecated
- Mark 16 borderline tools as deprecated
- Document replacements
- Keep functional for backward compatibility

### Phase 2: Migration Guide
- Document how to replace each tool
- Provide code examples
- Update README

### Phase 3: Removal (v3.0.0)
- Remove deprecated tools in next major version
- Clear migration path
- Announce in release notes

---

**Created**: 2025-11-18
**Last Updated**: 2025-11-18
