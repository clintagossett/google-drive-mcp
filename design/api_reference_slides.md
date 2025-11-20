# Google Slides API Reference for MCP Implementation

## Document Information

- **API Version**: v1 (Current)
- **Last Verified**: 2025-01-18
- **Official Documentation**: https://developers.google.com/slides/api/reference/rest
- **Purpose**: Complete audit of Google Slides API for 1:1 MCP tool mapping

---

## API Compliance Status

**Current MCP Implementation:**
- ✅ 8 high-level tools implemented
  - `createGoogleSlides` - Create presentation (simplified)
  - `updateGoogleSlides` - Update slides (simplified)
  - `getGoogleSlidesContent` - Get presentation content
  - `formatGoogleSlidesText` - Text formatting (bold, italic, font, color)
  - `formatGoogleSlidesParagraph` - Paragraph formatting (alignment, bullets, spacing)
  - `styleGoogleSlidesShape` - Shape styling (fill, outline)
  - `setGoogleSlidesBackground` - Slide background color
  - `createGoogleSlidesTextBox` - Create text box
  - `createGoogleSlidesShape` - Create shape

**Missing Thin-Layer Tools**: ~40+ request types not yet exposed

**API Coverage**: 8/50+ operations (~16%) ⚠️

**Status:** Needs thin-layer implementation for complete API coverage

---

## Presentation-Level Methods

### 1. `presentations.get`
**Description**: Retrieves a presentation's metadata and content

**Request**:
```typescript
{
  presentationId: string;
}
```

**Returns**: Presentation object with:
- Presentation ID, title, locale, page size
- Slides array (layouts, page elements, content)
- Masters and layouts
- Revision ID

**Current MCP Tool**: Partial via `getGoogleSlidesContent`

**Proposed Thin-Layer Tool**: `slides_getPresentation`

---

### 2. `presentations.create`
**Description**: Creates a new presentation

**Request**:
```typescript
{
  title?: string;
  locale?: string;      // e.g., "en_US"
  pageSize?: {
    width: Dimension;
    height: Dimension;
  };
}
```

**Returns**: Newly created Presentation object

**Current MCP Tool**: `createGoogleSlides` (simplified)

**Proposed Thin-Layer Tool**: `slides_createPresentation`

---

### 3. `presentations.batchUpdate`
**Description**: Applies one or more updates to the presentation

**Request**:
```typescript
{
  requests: Request[];  // Array of request objects
  writeControl?: {
    requiredRevisionId?: string;
  };
}
```

**Returns**: BatchUpdateResponse with replies for each request

This is the primary method for all modification operations. Below are all available request types.

---

## Slide Management Requests (5 types)

### 1. `CreateSlideRequest`
**Description**: Creates a new slide at a specified position

**Parameters**:
- `objectId` (string): Optional ID for new slide
- `insertionIndex` (integer): Position (0-based)
- `slideLayoutReference` (LayoutReference): Layout to use
- `placeholderIdMappings` (PlaceholderMapping[]): Placeholder mappings

**Current MCP Tool**: Partial via `createGoogleSlides`

**Proposed Tool**: `slides_createSlide`

**Example**:
```typescript
{
  createSlide: {
    insertionIndex: 1,
    slideLayoutReference: {
      layoutId: "p"  // Predefined layout
    }
  }
}
```

---

### 2. `DeleteObjectRequest`
**Description**: Deletes a page element or slide

**Parameters**:
- `objectId` (string): ID of object to delete

**Current MCP Tool**: ❌ Not implemented

**Proposed Tool**: `slides_deleteObject`

---

### 3. `UpdateSlidesPositionRequest`
**Description**: Reorders slides in the presentation

**Parameters**:
- `slideObjectIds` (string[]): Slides to move (in desired order)
- `insertionIndex` (integer): Where to move them

**Current MCP Tool**: ❌ Not implemented

**Proposed Tool**: `slides_updateSlidesPosition`

---

### 4. `DuplicateObjectRequest`
**Description**: Duplicates a slide or page element

**Parameters**:
- `objectId` (string): Object to duplicate
- `objectIds` (map<string, string>): ID mappings for duplicates

**Current MCP Tool**: ❌ Not implemented

**Proposed Tool**: `slides_duplicateObject`

---

### 5. `UpdatePagePropertiesRequest`
**Description**: Updates slide properties (background, layout, etc.)

**Parameters**:
- `objectId` (string): Slide object ID
- `pageProperties` (PageProperties): Properties to update
- `fields` (string): Field mask

**Current MCP Tool**: Partial via `setGoogleSlidesBackground`

**Proposed Tool**: `slides_updatePageProperties`

---

## Shape & Element Creation Requests (7 types)

### 6. `CreateShapeRequest`
**Description**: Creates a shape on a slide

**Parameters**:
- `objectId` (string): Optional ID
- `shapeType` (enum): TEXT_BOX, RECTANGLE, ELLIPSE, etc. (75+ types)
- `elementProperties` (PageElementProperties): Position, size, transform

**Current MCP Tool**: `createGoogleSlidesShape`, `createGoogleSlidesTextBox`

**Proposed Tool**: `slides_createShape`

**Shape Types**: TEXT_BOX, RECTANGLE, ROUND_RECTANGLE, ELLIPSE, CLOUD, BENT_ARROW, CURVED_ARROW, STAR, FLOW_CHART_PROCESS, FLOW_CHART_DECISION, and 65+ more

---

### 7. `CreateImageRequest`
**Description**: Inserts an image onto a slide

**Parameters**:
- `objectId` (string): Optional ID
- `url` (string): Image URL
- `elementProperties` (PageElementProperties): Position and size

**Current MCP Tool**: ❌ Not implemented

**Proposed Tool**: `slides_createImage`

---

### 8. `CreateVideoRequest`
**Description**: Adds a video to a slide

**Parameters**:
- `objectId` (string): Optional ID
- `source` (enum): YOUTUBE, DRIVE
- `id` (string): YouTube video ID or Drive file ID
- `elementProperties` (PageElementProperties): Position and size

**Current MCP Tool**: ❌ Not implemented

**Proposed Tool**: `slides_createVideo`

---

### 9. `CreateLineRequest`
**Description**: Creates a line or connector

**Parameters**:
- `objectId` (string): Optional ID
- `lineCategory` (enum): STRAIGHT, BENT, CURVED
- `elementProperties` (PageElementProperties): Position and size

**Current MCP Tool**: ❌ Not implemented

**Proposed Tool**: `slides_createLine`

---

### 10. `CreateTableRequest`
**Description**: Inserts a table onto a slide

**Parameters**:
- `objectId` (string): Optional ID
- `rows` (integer): Number of rows
- `columns` (integer): Number of columns
- `elementProperties` (PageElementProperties): Position and size

**Current MCP Tool**: ❌ Not implemented

**Proposed Tool**: `slides_createTable`

---

### 11. `CreateSheetsChartRequest`
**Description**: Embeds a Google Sheets chart

**Parameters**:
- `objectId` (string): Optional ID
- `spreadsheetId` (string): Source spreadsheet
- `chartId` (integer): Chart ID in spreadsheet
- `linkingMode` (enum): LINKED, NOT_LINKED_IMAGE
- `elementProperties` (PageElementProperties): Position and size

**Current MCP Tool**: ❌ Not implemented

**Proposed Tool**: `slides_createSheetsChart`

---

### 12. `RefreshSheetsChartRequest`
**Description**: Updates a linked Sheets chart with current data

**Parameters**:
- `objectId` (string): Chart object ID

**Current MCP Tool**: ❌ Not implemented

**Proposed Tool**: `slides_refreshSheetsChart`

---

## Text Content Requests (5 types)

### 13. `InsertTextRequest`
**Description**: Inserts text into a shape or table cell

**Parameters**:
- `objectId` (string): Shape or cell ID
- `text` (string): Text to insert
- `insertionIndex` (integer): Where to insert (0-based)
- `cellLocation` (TableCellLocation): For table cells

**Current MCP Tool**: ❌ Not implemented

**Proposed Tool**: `slides_insertText`

---

### 14. `DeleteTextRequest`
**Description**: Deletes text from a shape or table cell

**Parameters**:
- `objectId` (string): Shape or cell ID
- `textRange` (Range): Start and end indices
- `cellLocation` (TableCellLocation): For table cells

**Current MCP Tool**: ❌ Not implemented

**Proposed Tool**: `slides_deleteText`

---

### 15. `ReplaceAllTextRequest`
**Description**: Find and replace text across the presentation

**Parameters**:
- `containsText` (SubstringMatchCriteria): Text to find
- `replaceText` (string): Replacement text
- `pageObjectIds` (string[]): Optional: limit to specific slides

**Current MCP Tool**: ❌ Not implemented

**Proposed Tool**: `slides_replaceAllText`

---

### 16. `UpdateTextStyleRequest`
**Description**: Updates text formatting

**Parameters**:
- `objectId` (string): Shape or cell ID
- `textRange` (Range): Text range to format
- `style` (TextStyle): Font, size, color, bold, italic, etc.
- `fields` (string): Field mask
- `cellLocation` (TableCellLocation): For table cells

**Current MCP Tool**: `formatGoogleSlidesText`

**Proposed Tool**: `slides_updateTextStyle`

---

### 17. `UpdateParagraphStyleRequest`
**Description**: Updates paragraph formatting

**Parameters**:
- `objectId` (string): Shape or cell ID
- `textRange` (Range): Paragraph range
- `style` (ParagraphStyle): Alignment, indentation, spacing, direction
- `fields` (string): Field mask
- `cellLocation` (TableCellLocation): For table cells

**Current MCP Tool**: `formatGoogleSlidesParagraph`

**Proposed Tool**: `slides_updateParagraphStyle`

---

## Bullet & List Requests (1 type)

### 18. `CreateParagraphBulletsRequest`
**Description**: Creates bullets for paragraphs

**Parameters**:
- `objectId` (string): Shape or cell ID
- `textRange` (Range): Paragraphs to bullet
- `bulletPreset` (enum): BULLET_DISC_CIRCLE_SQUARE, NUMBERED_DECIMAL, etc.
- `cellLocation` (TableCellLocation): For table cells

**Current MCP Tool**: Partial via `formatGoogleSlidesParagraph`

**Proposed Tool**: `slides_createParagraphBullets`

---

## Table Modification Requests (10 types)

### 19. `InsertTableRowsRequest`
**Description**: Inserts rows into a table

**Parameters**:
- `tableObjectId` (string): Table ID
- `cellLocation` (TableCellLocation): Reference cell
- `insertBelow` (boolean): Insert below (true) or above (false)
- `number` (integer): How many rows

**Current MCP Tool**: ❌ Not implemented

**Proposed Tool**: `slides_insertTableRows`

---

### 20. `InsertTableColumnsRequest`
**Description**: Inserts columns into a table

**Parameters**:
- `tableObjectId` (string): Table ID
- `cellLocation` (TableCellLocation): Reference cell
- `insertRight` (boolean): Insert right (true) or left (false)
- `number` (integer): How many columns

**Current MCP Tool**: ❌ Not implemented

**Proposed Tool**: `slides_insertTableColumns`

---

### 21. `DeleteTableRowRequest`
**Description**: Deletes a table row

**Parameters**:
- `tableObjectId` (string): Table ID
- `cellLocation` (TableCellLocation): Cell in row to delete

**Current MCP Tool**: ❌ Not implemented

**Proposed Tool**: `slides_deleteTableRow`

---

### 22. `DeleteTableColumnRequest`
**Description**: Deletes a table column

**Parameters**:
- `tableObjectId` (string): Table ID
- `cellLocation` (TableCellLocation): Cell in column to delete

**Current MCP Tool**: ❌ Not implemented

**Proposed Tool**: `slides_deleteTableColumn`

---

### 23. `UpdateTableCellPropertiesRequest`
**Description**: Updates table cell properties

**Parameters**:
- `objectId` (string): Table ID
- `tableRange` (TableRange): Cells to update
- `tableCellProperties` (TableCellProperties): Fill, borders, etc.
- `fields` (string): Field mask

**Current MCP Tool**: ❌ Not implemented

**Proposed Tool**: `slides_updateTableCellProperties`

---

### 24. `UpdateTableBorderPropertiesRequest`
**Description**: Updates table border styling

**Parameters**:
- `objectId` (string): Table ID
- `tableRange` (TableRange): Cells to update
- `borderPosition` (enum): ALL, BOTTOM, INNER, etc.
- `tableBorderProperties` (TableBorderProperties): Color, weight, dash style
- `fields` (string): Field mask

**Current MCP Tool**: ❌ Not implemented

**Proposed Tool**: `slides_updateTableBorderProperties`

---

### 25. `UpdateTableColumnPropertiesRequest`
**Description**: Updates table column properties

**Parameters**:
- `objectId` (string): Table ID
- `columnIndices` (integer[]): Columns to update
- `tableColumnProperties` (TableColumnProperties): Column width
- `fields` (string): Field mask

**Current MCP Tool**: ❌ Not implemented

**Proposed Tool**: `slides_updateTableColumnProperties`

---

### 26. `UpdateTableRowPropertiesRequest`
**Description**: Updates table row properties

**Parameters**:
- `objectId` (string): Table ID
- `rowIndices` (integer[]): Rows to update
- `tableRowProperties` (TableRowProperties): Row height
- `fields` (string): Field mask

**Current MCP Tool**: ❌ Not implemented

**Proposed Tool**: `slides_updateTableRowProperties`

---

### 27. `MergeTableCellsRequest`
**Description**: Merges table cells

**Parameters**:
- `objectId` (string): Table ID
- `tableRange` (TableRange): Cells to merge

**Current MCP Tool**: ❌ Not implemented

**Proposed Tool**: `slides_mergeTableCells`

---

### 28. `UnmergeTableCellsRequest`
**Description**: Unmerges previously merged cells

**Parameters**:
- `objectId` (string): Table ID
- `tableRange` (TableRange): Cells to unmerge

**Current MCP Tool**: ❌ Not implemented

**Proposed Tool**: `slides_unmergeTableCells`

---

## Element Property Requests (7 types)

### 29. `UpdateShapePropertiesRequest`
**Description**: Updates shape properties

**Parameters**:
- `objectId` (string): Shape ID
- `shapeProperties` (ShapeProperties): Fill, outline, shadow, etc.
- `fields` (string): Field mask

**Current MCP Tool**: `styleGoogleSlidesShape`

**Proposed Tool**: `slides_updateShapeProperties`

---

### 30. `UpdateImagePropertiesRequest`
**Description**: Updates image properties

**Parameters**:
- `objectId` (string): Image ID
- `imageProperties` (ImageProperties): Brightness, contrast, recolor, crop
- `fields` (string): Field mask

**Current MCP Tool**: ❌ Not implemented

**Proposed Tool**: `slides_updateImageProperties`

---

### 31. `UpdateVideoPropertiesRequest`
**Description**: Updates video properties

**Parameters**:
- `objectId` (string): Video ID
- `videoProperties` (VideoProperties): Auto-play, start/end time, mute
- `fields` (string): Field mask

**Current MCP Tool**: ❌ Not implemented

**Proposed Tool**: `slides_updateVideoProperties`

---

### 32. `UpdateLinePropertiesRequest`
**Description**: Updates line properties

**Parameters**:
- `objectId` (string): Line ID
- `lineProperties` (LineProperties): Weight, dash style, start/end arrow
- `fields` (string): Field mask

**Current MCP Tool**: ❌ Not implemented

**Proposed Tool**: `slides_updateLineProperties`

---

### 33. `UpdateLineCategoryRequest`
**Description**: Changes line category

**Parameters**:
- `objectId` (string): Line ID
- `lineCategory` (enum): STRAIGHT, BENT, CURVED

**Current MCP Tool**: ❌ Not implemented

**Proposed Tool**: `slides_updateLineCategory`

---

### 34. `RerouteLineRequest`
**Description**: Reroutes a connector line between shapes

**Parameters**:
- `objectId` (string): Line ID

**Current MCP Tool**: ❌ Not implemented

**Proposed Tool**: `slides_rerouteLine`

---

### 35. `UpdatePageElementTransformRequest`
**Description**: Updates element position, size, rotation, or shear

**Parameters**:
- `objectId` (string): Element ID
- `transform` (AffineTransform): Transform matrix
- `applyMode` (enum): RELATIVE, ABSOLUTE

**Current MCP Tool**: ❌ Not implemented

**Proposed Tool**: `slides_updatePageElementTransform`

---

## Element Ordering & Grouping Requests (4 types)

### 36. `UpdatePageElementAltTextRequest`
**Description**: Sets alt text for accessibility

**Parameters**:
- `objectId` (string): Element ID
- `title` (string): Alt text title
- `description` (string): Alt text description

**Current MCP Tool**: ❌ Not implemented

**Proposed Tool**: `slides_updatePageElementAltText`

---

### 37. `UpdatePageElementsZOrderRequest`
**Description**: Changes z-order (layering) of elements

**Parameters**:
- `pageElementObjectIds` (string[]): Elements to reorder
- `operation` (enum): BRING_TO_FRONT, SEND_TO_BACK, BRING_FORWARD, SEND_BACKWARD

**Current MCP Tool**: ❌ Not implemented

**Proposed Tool**: `slides_updatePageElementsZOrder`

---

### 38. `GroupObjectsRequest`
**Description**: Groups multiple elements together

**Parameters**:
- `childrenObjectIds` (string[]): Elements to group
- `groupObjectId` (string): Optional ID for group

**Current MCP Tool**: ❌ Not implemented

**Proposed Tool**: `slides_groupObjects`

---

### 39. `UngroupObjectsRequest`
**Description**: Ungroups a group of elements

**Parameters**:
- `objectIds` (string[]): Group IDs to ungroup

**Current MCP Tool**: ❌ Not implemented

**Proposed Tool**: `slides_ungroupObjects`

---

## Replace Operations (3 types)

### 40. `ReplaceAllShapesWithImageRequest`
**Description**: Replaces all matching shapes with an image

**Parameters**:
- `imageUrl` (string): Image to use
- `imageReplaceMethod` (enum): CENTER_INSIDE, CENTER_CROP
- `containsText` (SubstringMatchCriteria): Match criteria
- `pageObjectIds` (string[]): Optional: limit to specific slides

**Current MCP Tool**: ❌ Not implemented

**Proposed Tool**: `slides_replaceAllShapesWithImage`

---

### 41. `ReplaceAllShapesWithSheetsChartRequest`
**Description**: Replaces all matching shapes with a Sheets chart

**Parameters**:
- `spreadsheetId` (string): Source spreadsheet
- `chartId` (integer): Chart ID
- `linkingMode` (enum): LINKED, NOT_LINKED_IMAGE
- `containsText` (SubstringMatchCriteria): Match criteria
- `pageObjectIds` (string[]): Optional: limit to specific slides

**Current MCP Tool**: ❌ Not implemented

**Proposed Tool**: `slides_replaceAllShapesWithSheetsChart`

---

### 42. `ReplaceImageRequest`
**Description**: Replaces an existing image with a new one

**Parameters**:
- `imageObjectId` (string): Image to replace
- `url` (string): New image URL
- `imageReplaceMethod` (enum): CENTER_INSIDE, CENTER_CROP

**Current MCP Tool**: ❌ Not implemented

**Proposed Tool**: `slides_replaceImage`

---

## Summary Statistics

### API Coverage by Category

| Category | Request Types | Implemented | Missing | % Coverage |
|----------|--------------|-------------|---------|-----------|
| **Slide Management** | 5 | 1 | 4 | 20% ⚠️ |
| **Shape & Element Creation** | 7 | 2 | 5 | 29% ⚠️ |
| **Text Content** | 5 | 2 | 3 | 40% ⚠️ |
| **Bullet & List** | 1 | 0 | 1 | 0% ❌ |
| **Table Modification** | 10 | 0 | 10 | 0% ❌ |
| **Element Properties** | 7 | 1 | 6 | 14% ⚠️ |
| **Element Ordering & Grouping** | 4 | 0 | 4 | 0% ❌ |
| **Replace Operations** | 3 | 0 | 3 | 0% ❌ |
| **TOTAL batchUpdate** | **42** | **6** | **36** | **14%** ❌ |

### Presentation Methods Coverage

| Method | Implemented | Status |
|--------|-------------|--------|
| `presentations.get` | Partial | Only gets content, not full metadata |
| `presentations.create` | Partial | Simplified version |
| `presentations.batchUpdate` | Partial | Only 6/42 request types |

---

## Implementation Roadmap

### Phase 1: Core Slide & Content Operations (HIGH PRIORITY)
**Tools to implement (10):**
1. `slides_getPresentation` - Get full presentation metadata
2. `slides_createPresentation` - Full-featured create
3. `slides_createSlide` - Create slide at position
4. `slides_deleteObject` - Delete slide or element
5. `slides_updateSlidesPosition` - Reorder slides
6. `slides_duplicateObject` - Duplicate slide/element
7. `slides_insertText` - Insert text into shape
8. `slides_deleteText` - Delete text from shape
9. `slides_replaceAllText` - Find and replace text
10. `slides_updatePageProperties` - Update slide properties

**Impact**: Covers 80% of core presentation manipulation use cases
**Estimated Effort**: 2-3 days

---

### Phase 2: Shape & Media Creation (HIGH PRIORITY)
**Tools to implement (8):**
11. `slides_createShape` - Create shape (thin layer)
12. `slides_createImage` - Insert image
13. `slides_createVideo` - Insert video
14. `slides_createLine` - Create line/connector
15. `slides_createTable` - Create table
16. `slides_createSheetsChart` - Embed Sheets chart
17. `slides_refreshSheetsChart` - Update Sheets chart
18. `slides_updatePageElementTransform` - Move/resize/rotate elements

**Impact**: Essential for content creation
**Estimated Effort**: 2-3 days

---

### Phase 3: Text & Paragraph Formatting (MEDIUM PRIORITY)
**Tools to implement (4):**
19. `slides_updateTextStyle` - Text formatting (thin layer)
20. `slides_updateParagraphStyle` - Paragraph formatting (thin layer)
21. `slides_createParagraphBullets` - Add bullets
22. `slides_updateShapeProperties` - Shape styling (thin layer)

**Impact**: Professional formatting capabilities
**Estimated Effort**: 1-2 days

---

### Phase 4: Table Operations (MEDIUM PRIORITY)
**Tools to implement (10):**
23. `slides_insertTableRows` - Insert table rows
24. `slides_insertTableColumns` - Insert table columns
25. `slides_deleteTableRow` - Delete table row
26. `slides_deleteTableColumn` - Delete table column
27. `slides_updateTableCellProperties` - Cell formatting
28. `slides_updateTableBorderProperties` - Border styling
29. `slides_updateTableColumnProperties` - Column width
30. `slides_updateTableRowProperties` - Row height
31. `slides_mergeTableCells` - Merge cells
32. `slides_unmergeTableCells` - Unmerge cells

**Impact**: Complete table manipulation
**Estimated Effort**: 2-3 days

---

### Phase 5: Advanced Element Operations (LOW PRIORITY)
**Tools to implement (10):**
33. `slides_updateImageProperties` - Image adjustments
34. `slides_updateVideoProperties` - Video settings
35. `slides_updateLineProperties` - Line styling
36. `slides_updateLineCategory` - Line type
37. `slides_rerouteLine` - Reroute connector
38. `slides_updatePageElementAltText` - Accessibility
39. `slides_updatePageElementsZOrder` - Layering
40. `slides_groupObjects` - Group elements
41. `slides_ungroupObjects` - Ungroup elements
42. `slides_replaceAllShapesWithImage` - Bulk replace with image
43. `slides_replaceAllShapesWithSheetsChart` - Bulk replace with chart
44. `slides_replaceImage` - Replace image

**Impact**: Advanced features for power users
**Estimated Effort**: 2-3 days

---

## Testing Strategy

For each new thin-layer tool:

1. **Unit Test** - Mock Google API, validate request format (5+ tests minimum)
2. **Integration Test** - Real API call with OAuth document
3. **Integration Test** - Real API call with public document
4. **Error Handling Test** - Invalid parameters
5. **MCP Protocol Test** - Response format validation

---

## API Constraints & Gotchas

### General Constraints
- Batch requests processed atomically (all or nothing)
- Field masks required for most update operations
- Object IDs must be unique within a presentation
- Maximum 500 requests per batchUpdate call

### Specific Constraints
- **Text Indices**: 0-based (unlike Docs which is 1-indexed)
- **Element IDs**: Auto-generated if not provided (format: `g<hex>`)
- **Dimensions**: Specified in EMU (1 EMU = 1/360000 cm = 1/914400 inch)
- **Tables**: Minimum 1 row, 1 column; maximum 20 columns, 20 rows
- **Images**: Must be publicly accessible URL or base64 encoded
- **Videos**: Only YouTube and Google Drive sources supported

### Common Patterns
- **TableCellLocation**: `{rowIndex: 0, columnIndex: 0}` (0-based)
- **Range**: `{startIndex: 0, endIndex: 5, type: "FIXED_RANGE"}`
- **PageElementProperties**: `{pageObjectId, size, transform}`

---

## Dimension Units (EMU)

**EMU (English Metric Units)**: The standard unit for sizes and positions in Slides API

**Conversions**:
- 1 inch = 914,400 EMU
- 1 cm = 360,000 EMU
- 1 point = 12,700 EMU

**Standard slide sizes**:
- Standard (4:3): 9,144,000 × 6,858,000 EMU (10" × 7.5")
- Widescreen (16:9): 9,144,000 × 5,143,500 EMU (10" × 5.625")

**Helper for common sizes**:
- 1 inch = 914400 EMU
- Half inch = 457200 EMU
- Quarter inch = 228600 EMU

---

## Next Steps

1. ✅ **Complete Phase 1 of Sheets API** (10 tools) - DONE
2. 🔄 **Complete Phase 2 of Sheets API** (10 tools) - IN PROGRESS
3. **Start Slides Phase 1** (10 core tools)
4. Continue with remaining Sheets phases
5. Continue with remaining Slides phases
6. Implement Google Drive Comments API (3 tools)

---

## Change Log

- **2025-01-18**: Initial document created
  - Documented all 42 batchUpdate request types
  - Identified 8 existing high-level tools
  - Proposed 5-phase implementation plan (44 new tools)
  - Added API constraints and dimension reference
