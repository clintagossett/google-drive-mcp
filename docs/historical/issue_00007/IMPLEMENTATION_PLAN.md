# Google Slides API Implementation Plan - Issue #7

**Document Version**: 1.0
**Created**: 2025-11-19
**Last Updated**: 2025-11-19
**Status**: 🔄 IN PROGRESS

---

## Executive Summary

**Objective**: Achieve 100% coverage of Google Slides API by implementing 36 missing 1:1 API-mapped tools.

**Current Status**: 7/43 operations implemented (16% coverage)
**Target Status**: 43/43 operations implemented (100% coverage)

**Approach**: 5-phase implementation with per-tool testing following design principles.

---

## Current Implementation Audit

### ✅ Already Implemented (7 tools)

Based on audit of `src/index.ts`:

1. **`slides_get`** (line 8036)
   - Maps to: `presentations.get`
   - Added in: Issue #2 Phase 2
   - Status: ✅ Complete with 7 unit tests

2. **`slides_updateTextStyle`** (line 7596)
   - Maps to: `UpdateTextStyleRequest` in `presentations.batchUpdate`
   - Renamed from: `formatGoogleSlidesText`
   - Status: ✅ Complete

3. **`slides_updateParagraphStyle`** (line 7687)
   - Maps to: `UpdateParagraphStyleRequest` in `presentations.batchUpdate`
   - Renamed from: `formatGoogleSlidesParagraph`
   - Status: ✅ Complete

4. **`slides_updateShapeProperties`** (line 7756)
   - Maps to: `UpdateShapePropertiesRequest` in `presentations.batchUpdate`
   - Renamed from: `styleGoogleSlidesShape`
   - Status: ✅ Complete

5. **`slides_updatePageProperties`** (line 7842)
   - Maps to: `UpdatePagePropertiesRequest` in `presentations.batchUpdate`
   - Renamed from: `setGoogleSlidesBackground`
   - Status: ✅ Complete

6. **`slides_createTextBox`** (line 7882)
   - Maps to: `CreateShapeRequest` with `shapeType: TEXT_BOX`
   - Status: ✅ Complete

7. **`slides_createShape`** (line 7968)
   - Maps to: `CreateShapeRequest`
   - Status: ✅ Complete

**Note**: Legacy tools `createGoogleSlides`, `updateGoogleSlides`, and `getGoogleSlidesContent` were removed in Issue #2 for violating design principles.

---

## Implementation Phases

### Phase 1: Core Slide & Content Operations (10 tools)

**Priority**: HIGH
**Goal**: Core presentation manipulation capabilities

#### Tools to Implement:

1. **`slides_createPresentation`**
   - API: `presentations.create`
   - Parameters: `title`, `locale`, `pageSize`
   - Purpose: Create new presentation with full control

2. **`slides_createSlide`**
   - API: `CreateSlideRequest` in `batchUpdate`
   - Parameters: `presentationId`, `insertionIndex`, `slideLayoutReference`, `objectId`
   - Purpose: Add slide at specific position

3. **`slides_deleteObject`**
   - API: `DeleteObjectRequest` in `batchUpdate`
   - Parameters: `presentationId`, `objectId`
   - Purpose: Delete slide or page element

4. **`slides_updateSlidesPosition`**
   - API: `UpdateSlidesPositionRequest` in `batchUpdate`
   - Parameters: `presentationId`, `slideObjectIds[]`, `insertionIndex`
   - Purpose: Reorder slides

5. **`slides_duplicateObject`**
   - API: `DuplicateObjectRequest` in `batchUpdate`
   - Parameters: `presentationId`, `objectId`, `objectIds` (ID mappings)
   - Purpose: Duplicate slide or element

6. **`slides_insertText`**
   - API: `InsertTextRequest` in `batchUpdate`
   - Parameters: `presentationId`, `objectId`, `text`, `insertionIndex`, `cellLocation`
   - Purpose: Insert text into shape or table cell

7. **`slides_deleteText`**
   - API: `DeleteTextRequest` in `batchUpdate`
   - Parameters: `presentationId`, `objectId`, `textRange`, `cellLocation`
   - Purpose: Delete text from shape or cell

8. **`slides_replaceAllText`**
   - API: `ReplaceAllTextRequest` in `batchUpdate`
   - Parameters: `presentationId`, `containsText`, `replaceText`, `pageObjectIds`
   - Purpose: Find and replace text across presentation

9. **`slides_createParagraphBullets`**
   - API: `CreateParagraphBulletsRequest` in `batchUpdate`
   - Parameters: `presentationId`, `objectId`, `textRange`, `bulletPreset`, `cellLocation`
   - Purpose: Add bullets to paragraphs

10. **`slides_updatePageElementTransform`**
    - API: `UpdatePageElementTransformRequest` in `batchUpdate`
    - Parameters: `presentationId`, `objectId`, `transform`, `applyMode`
    - Purpose: Move, resize, rotate, or shear elements

**Testing per tool**: 5+ unit tests minimum, integration test with public presentation

---

### Phase 2: Shape & Media Creation (8 tools)

**Priority**: HIGH
**Goal**: Complete content creation capabilities

#### Tools to Implement:

11. **`slides_createImage`**
    - API: `CreateImageRequest` in `batchUpdate`
    - Parameters: `presentationId`, `pageObjectId`, `url`, `elementProperties`
    - Purpose: Insert image onto slide

12. **`slides_createVideo`**
    - API: `CreateVideoRequest` in `batchUpdate`
    - Parameters: `presentationId`, `pageObjectId`, `source` (YOUTUBE/DRIVE), `id`, `elementProperties`
    - Purpose: Embed video

13. **`slides_createLine`**
    - API: `CreateLineRequest` in `batchUpdate`
    - Parameters: `presentationId`, `pageObjectId`, `lineCategory`, `elementProperties`
    - Purpose: Create line or connector

14. **`slides_createTable`**
    - API: `CreateTableRequest` in `batchUpdate`
    - Parameters: `presentationId`, `pageObjectId`, `rows`, `columns`, `elementProperties`
    - Purpose: Insert table

15. **`slides_createSheetsChart`**
    - API: `CreateSheetsChartRequest` in `batchUpdate`
    - Parameters: `presentationId`, `pageObjectId`, `spreadsheetId`, `chartId`, `linkingMode`, `elementProperties`
    - Purpose: Embed Sheets chart

16. **`slides_refreshSheetsChart`**
    - API: `RefreshSheetsChartRequest` in `batchUpdate`
    - Parameters: `presentationId`, `objectId`
    - Purpose: Update linked Sheets chart

17. **`slides_updateImageProperties`**
    - API: `UpdateImagePropertiesRequest` in `batchUpdate`
    - Parameters: `presentationId`, `objectId`, `imageProperties` (brightness, contrast, recolor, etc.)
    - Purpose: Adjust image properties

18. **`slides_updateVideoProperties`**
    - API: `UpdateVideoPropertiesRequest` in `batchUpdate`
    - Parameters: `presentationId`, `objectId`, `videoProperties` (outline, autoPlay, start/end times)
    - Purpose: Configure video playback

---

### Phase 3: Text & Line Formatting (4 tools)

**Priority**: MEDIUM
**Goal**: Complete text and line styling

#### Tools to Implement:

19. **`slides_deleteParagraphBullets`**
    - API: `DeleteParagraphBulletsRequest` in `batchUpdate`
    - Parameters: `presentationId`, `objectId`, `textRange`, `cellLocation`
    - Purpose: Remove bullets from paragraphs

20. **`slides_updateLineProperties`**
    - API: `UpdateLinePropertiesRequest` in `batchUpdate`
    - Parameters: `presentationId`, `objectId`, `lineProperties` (weight, dashStyle, startArrow, endArrow, link)
    - Purpose: Style lines and connectors

21. **`slides_updateLineCategory`**
    - API: `UpdateLineCategoryRequest` in `batchUpdate`
    - Parameters: `presentationId`, `objectId`, `lineCategory` (STRAIGHT, BENT, CURVED)
    - Purpose: Change line type

22. **`slides_rerouteLine`**
    - API: `RerouteLineRequest` in `batchUpdate`
    - Parameters: `presentationId`, `objectId`
    - Purpose: Recalculate connector path

---

### Phase 4: Table Operations (10 tools)

**Priority**: MEDIUM
**Goal**: Complete table manipulation

#### Tools to Implement:

23. **`slides_insertTableRows`**
    - API: `InsertTableRowsRequest` in `batchUpdate`
    - Parameters: `presentationId`, `tableObjectId`, `cellLocation`, `insertBelow`, `number`
    - Purpose: Add rows to table

24. **`slides_insertTableColumns`**
    - API: `InsertTableColumnsRequest` in `batchUpdate`
    - Parameters: `presentationId`, `tableObjectId`, `cellLocation`, `insertRight`, `number`
    - Purpose: Add columns to table

25. **`slides_deleteTableRow`**
    - API: `DeleteTableRowRequest` in `batchUpdate`
    - Parameters: `presentationId`, `tableObjectId`, `cellLocation`
    - Purpose: Remove table row

26. **`slides_deleteTableColumn`**
    - API: `DeleteTableColumnRequest` in `batchUpdate`
    - Parameters: `presentationId`, `tableObjectId`, `cellLocation`
    - Purpose: Remove table column

27. **`slides_updateTableCellProperties`**
    - API: `UpdateTableCellPropertiesRequest` in `batchUpdate`
    - Parameters: `presentationId`, `objectId`, `tableRange`, `tableCellProperties` (background, borders, contentAlignment)
    - Purpose: Format table cells

28. **`slides_updateTableBorderProperties`**
    - API: `UpdateTableBorderPropertiesRequest` in `batchUpdate`
    - Parameters: `presentationId`, `objectId`, `tableRange`, `borderPosition`, `tableBorderProperties`
    - Purpose: Style table borders

29. **`slides_updateTableColumnProperties`**
    - API: `UpdateTableColumnPropertiesRequest` in `batchUpdate`
    - Parameters: `presentationId`, `objectId`, `columnIndices[]`, `tableColumnProperties` (columnWidth)
    - Purpose: Set column widths

30. **`slides_updateTableRowProperties`**
    - API: `UpdateTableRowPropertiesRequest` in `batchUpdate`
    - Parameters: `presentationId`, `objectId`, `rowIndices[]`, `tableRowProperties` (minRowHeight)
    - Purpose: Set row heights

31. **`slides_mergeTableCells`**
    - API: `MergeTableCellsRequest` in `batchUpdate`
    - Parameters: `presentationId`, `objectId`, `tableRange`
    - Purpose: Merge table cells

32. **`slides_unmergeTableCells`**
    - API: `UnmergeTableCellsRequest` in `batchUpdate`
    - Parameters: `presentationId`, `objectId`, `objectId` (merged cell ID)
    - Purpose: Unmerge table cells

---

### Phase 5: Advanced Element Operations (14 tools)

**Priority**: LOW
**Goal**: Advanced features for power users

#### Tools to Implement:

33. **`slides_updatePageElementAltText`**
    - API: `UpdatePageElementAltTextRequest` in `batchUpdate`
    - Parameters: `presentationId`, `objectId`, `title`, `description`
    - Purpose: Set accessibility alt text

34. **`slides_updatePageElementsZOrder`**
    - API: `UpdatePageElementsZOrderRequest` in `batchUpdate`
    - Parameters: `presentationId`, `pageElementObjectIds[]`, `operation` (BRING_TO_FRONT, SEND_TO_BACK, etc.)
    - Purpose: Change element layering

35. **`slides_groupObjects`**
    - API: `GroupObjectsRequest` in `batchUpdate`
    - Parameters: `presentationId`, `childrenObjectIds[]`, `groupObjectId`
    - Purpose: Group elements together

36. **`slides_ungroupObjects`**
    - API: `UngroupObjectsRequest` in `batchUpdate`
    - Parameters: `presentationId`, `objectIds[]`
    - Purpose: Ungroup elements

37. **`slides_replaceAllShapesWithImage`**
    - API: `ReplaceAllShapesWithImageRequest` in `batchUpdate`
    - Parameters: `presentationId`, `imageUrl`, `imageReplaceMethod`, `containsText`, `pageObjectIds`
    - Purpose: Bulk replace shapes with image

38. **`slides_replaceAllShapesWithSheetsChart`**
    - API: `ReplaceAllShapesWithSheetsChartRequest` in `batchUpdate`
    - Parameters: `presentationId`, `spreadsheetId`, `chartId`, `linkingMode`, `containsText`, `pageObjectIds`
    - Purpose: Bulk replace shapes with chart

39. **`slides_replaceImage`**
    - API: `ReplaceImageRequest` in `batchUpdate`
    - Parameters: `presentationId`, `imageObjectId`, `url`, `imageReplaceMethod`
    - Purpose: Replace existing image

40. **`slides_deleteParagraphBullets`**
    - API: `DeleteParagraphBulletsRequest` in `batchUpdate`
    - Parameters: `presentationId`, `objectId`, `textRange`, `cellLocation`
    - Purpose: Remove bullets (if not in Phase 3)

---

## Per-Tool Implementation Workflow

**CRITICAL**: Follow this workflow for EACH tool (not per phase!)

### Step 1: Schema Definition
- Add Zod schema to `src/index.ts` (~line 1070+)
- Include all required and optional parameters
- Add descriptive validation messages

### Step 2: Unit Tests (BEFORE handler!)
- Create `tests/unit/[toolname].test.ts`
- Write minimum 5 tests:
  1. Valid parameters test
  2. Missing required parameter test
  3. Invalid parameter type test
  4. Extra properties ignored test
  5. API call format test
- Run `npm test` - verify tests pass

### Step 3: Tool Definition
- Add tool to `ListToolsRequest` handler (~line 3493+)
- Include clear description
- Map Zod schema to inputSchema

### Step 4: Handler Implementation
- Add case to `CallToolRequest` handler (~line 8060+)
- Validate with Zod schema
- Call Google Slides API
- Return raw API response as JSON
- Handle errors gracefully

### Step 5: Verification
- Run `npm test` - ALL tests must pass
- Run `npm run build` - build must succeed
- Test manually with Claude Code if needed

### Step 6: Commit
- Commit with message: `feat: Implement slides_[toolname] (Issue #7 Phase N)`
- ONE commit per tool OR per logical grouping of 2-3 related tools

---

## Testing Strategy

### Unit Tests (Per Tool)
Minimum 5 tests per tool:
1. **Schema validation** - Valid parameters accepted
2. **Required validation** - Missing required params rejected
3. **Type validation** - Wrong types rejected
4. **Extra properties** - Extra params ignored
5. **API format** - Maps correctly to Google API

### Integration Tests (Per Phase)
After each phase completion:
1. Test with public presentation (for CI/CD)
2. Test with OAuth presentation (for local dev)
3. Verify all phase tools work together
4. Check error handling with invalid IDs

### Test Documents
- **Public Test Presentation**: TBD (create during Phase 1)
- **OAuth Test Presentation**: `1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w` (if applicable)

---

## API Constraints & Gotchas

### Text Indices
- **0-based** (unlike Docs API which is 1-indexed!)
- Example: First character is index 0

### Dimensions (EMU)
- **1 inch = 914,400 EMU**
- **1 cm = 360,000 EMU**
- **1 point = 12,700 EMU**
- Standard slide: 9,144,000 × 6,858,000 EMU (10" × 7.5")

### Element IDs
- Auto-generated format: `g<hex>` (e.g., `g1a2b3c4d5`)
- Must be unique within presentation
- Can provide custom IDs (recommended for testing)

### Batch Requests
- Maximum 500 requests per `batchUpdate` call
- Requests processed atomically (all or nothing)
- Field masks required for most update operations

### Tables
- Minimum: 1 row × 1 column
- Maximum: 20 rows × 20 columns
- Cell location: `{rowIndex: 0, columnIndex: 0}` (0-based)

### Images & Videos
- Images: Must be publicly accessible URL
- Videos: Only YouTube and Google Drive supported
- Video format: `source` (YOUTUBE/DRIVE) + `id`

---

## Decision Log

### Decision 1: Use slides_get instead of slides_getPresentation
**Context**: API reference proposed `slides_getPresentation` but `slides_get` already exists.

**Options**:
- A: Keep `slides_get`, update documentation
- B: Rename to `slides_getPresentation` for clarity

**Decision**: Option A (keep `slides_get`)

**Rationale**:
- Already implemented and tested in Issue #2 Phase 2
- Follows pattern from Docs API (`docs_get`, not `docs_getDocument`)
- Follows pattern from Sheets API (`sheets_getSpreadsheet` because API is `spreadsheets.get`)
- Slides API is `presentations.get`, so `slides_get` is appropriate shorthand
- Renaming would break existing usage

**Result**: Documentation updated, `slides_getPresentation` removed from Phase 1

---

### Decision 2: Phase Order
**Context**: Multiple phases could be implemented in different orders.

**Options**:
- A: Phases 1-5 as documented (core → media → formatting → tables → advanced)
- B: Phases by frequency of use
- C: Phases by API category grouping

**Decision**: Option A (phases 1-5 as documented)

**Rationale**:
- Phase 1 provides core manipulation (create, delete, reorder slides)
- Phase 2 enables content creation (images, videos, tables, charts)
- Phase 3 completes formatting capabilities
- Phase 4 provides table manipulation (builds on Phase 2)
- Phase 5 adds power-user features
- This order maximizes incremental value

---

## Completion Criteria

### Per Tool
- ✅ Zod schema implemented
- ✅ 5+ unit tests written and passing
- ✅ Tool definition added
- ✅ Handler implemented
- ✅ All tests passing (`npm test`)
- ✅ Build succeeds (`npm run build`)
- ✅ Committed to git

### Per Phase
- ✅ All phase tools completed
- ✅ Integration tests passing
- ✅ Phase commit pushed to git
- ✅ GitHub issue updated with progress

### Issue Complete
- ✅ All 5 phases completed (36 tools implemented)
- ✅ Total 43 Slides tools (7 existing + 36 new)
- ✅ Test coverage ≥80%
- ✅ README.md updated
- ✅ Completion summary posted to GitHub issue #7
- ✅ Issue closed

---

## Notes

- **Autonomy**: This is an autonomous implementation. Technical decisions will be documented in this file, not presented to user.
- **Testing**: Per-tool testing is MANDATORY. No batch testing.
- **Naming**: All tools prefixed with `slides_` following existing pattern.
- **API Mapping**: Strict 1:1 mapping to Google Slides API. No convenience functions.
- **Error Handling**: Return clear error messages, never crash the server.

---

**Last Updated**: 2025-11-19
**Next Update**: After Phase 1 completion
