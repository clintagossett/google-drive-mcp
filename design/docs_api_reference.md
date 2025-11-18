# Google Docs API Reference for MCP Implementation

## Document Information

- **API Version**: v1 (Current)
- **Last Verified**: 2025-01-18
- **Official Documentation**: https://developers.google.com/docs/api/reference/rest/v1/documents
- **Purpose**: Complete audit of Google Docs API for 1:1 MCP tool mapping

**Important Note**: This document covers only the **Google Docs API**. Comments are managed through the **Google Drive API** (see `EXTENSION_PLAN.md` for Drive API comments implementation).

---

## API Compliance Status

**Current MCP Implementation:**
- ✅ 2 document-level methods implemented (create, get, update via batchUpdate)
- ✅ 34 batchUpdate request types implemented (ALL PHASES COMPLETE)
  - Phase 1: deleteContentRange, replaceAllText, createParagraphBullets, deleteParagraphBullets, insertPageBreak, updateDocumentStyle
  - Phase 2: insertTable, insertTableRow, insertTableColumn, deleteTableRow, deleteTableColumn, updateTableColumnProperties, updateTableRowStyle, updateTableCellStyle, mergeTableCells, unmergeTableCells, pinTableHeaderRows
  - Phase 3: insertSectionBreak, updateSectionStyle, createHeader, createFooter, deleteHeader, deleteFooter, createFootnote, deletePositionedObject
  - Phase 4: createNamedRange, deleteNamedRange, replaceNamedRangeContent, insertPerson
  - Phase 5: insertInlineImage, replaceImage
  - Legacy: insertText, updateParagraphStyle, updateTextStyle, formatGoogleDocText, formatGoogleDocParagraph

**API Coverage**: 34/34 request types (100%) ✅

**Status:** COMPLETE 1:1 API coverage achieved for all request types

---

## Document-Level Methods

### 1. `documents.get`
**Description**: Retrieves a Google Docs document

**Request**:
```typescript
{
  documentId: string;
  includeTabsContent?: boolean; // Default: false
}
```

**Returns**: Complete Document object with:
- Document ID, title, tabs
- Revision ID
- Body content
- Headers, footers, footnotes
- Styles, lists, named ranges
- Embedded/positioned objects

**Current MCP Tool**: `getGoogleDocContent` ✅

**Proposed Low-Level MCP Tool**: `docs_get`

---

### 2. `documents.create`
**Description**: Creates a new Google Docs document

**Request**:
```typescript
{
  title?: string;
  // Additional Document initialization properties
}
```

**Returns**: Newly created Document object

**Current MCP Tool**: `createGoogleDoc` ✅

**Proposed Low-Level MCP Tool**: `docs_create`

---

### 3. `documents.batchUpdate`
**Description**: Applies one or more updates to the document

**Request**:
```typescript
{
  documentId: string;
  requests: Request[]; // Array of request objects
  writeControl?: WriteControl;
}
```

**Returns**: BatchUpdateResponse with:
- Document ID
- Replies array (responses for each request)
- Updated revision ID

**Processing**:
- Requests validated before application
- Applied in order specified
- All requests applied atomically
- If any request fails, entire batch fails

**Current MCP Tool**: Partial (via `updateGoogleDoc`, `formatGoogleDocText`, `formatGoogleDocParagraph`)

**Proposed Approach**: One MCP tool per request type

---

## batchUpdate Request Types

### Text Operations (3 request types)

#### 1. `InsertTextRequest`
**Description**: Inserts text at the specified location

**Parameters**:
- `location.index` (integer): Position to insert (1-indexed)
- `location.tabId` (string): Tab ID (optional, defaults to first tab)
- `text` (string): Text to insert

**Constraints**:
- Cannot be used inside tables, headers, footers, footnotes

**Current Status**: ✅ Used in `updateGoogleDoc`

**MCP Tool**: `docs_insertText`

**Example**:
```typescript
{
  insertText: {
    location: { index: 1 },
    text: "Hello World"
  }
}
```

---

#### 2. `DeleteContentRangeRequest`
**Description**: Deletes content from the document

**Parameters**:
- `range.startIndex` (integer): Start position (inclusive)
- `range.endIndex` (integer): End position (exclusive)
- `range.tabId` (string): Tab ID (optional)

**Constraints**:
- Cannot delete across table boundaries
- Cannot be used in headers, footers, footnotes

**Current Status**: ✅ Implemented (Phase 1)

**MCP Tool**: `docs_deleteContentRange`

**Example**:
```typescript
{
  deleteContentRange: {
    range: { startIndex: 1, endIndex: 10 }
  }
}
```

---

#### 3. `ReplaceAllTextRequest`
**Description**: Replaces all instances of text matching criteria with replacement text

**Parameters**:
- `containsText.text` (string): Text to search for
- `containsText.matchCase` (boolean): Case-sensitive matching
- `replaceText` (string): Replacement text
- `tabId` (string): Optional tab ID

**Constraints**:
- Replacement text cannot contain newlines
- Limited to ~1000 replacements per request

**Current Status**: ✅ Implemented (Phase 1)

**MCP Tool**: `docs_replaceAllText`

**Example**:
```typescript
{
  replaceAllText: {
    containsText: { text: "old", matchCase: false },
    replaceText: "new"
  }
}
```

---

### Formatting & Styling (3 request types)

#### 4. `UpdateTextStyleRequest`
**Description**: Updates text styling (bold, italic, color, font, etc.)

**Parameters**:
- `range` (Range): Text range to style
- `textStyle` (TextStyle): Style properties to apply
  - `bold` (boolean)
  - `italic` (boolean)
  - `underline` (boolean)
  - `strikethrough` (boolean)
  - `fontSize.magnitude` (number)
  - `fontSize.unit` (enum: PT)
  - `foregroundColor.color.rgbColor` (RgbColor)
  - `backgroundColor.color.rgbColor` (RgbColor)
  - `fontFamily` (string)
  - `link.url` (string)
  - `baselineOffset` (enum: NONE, SUPERSCRIPT, SUBSCRIPT)
- `fields` (string): Field mask (e.g., "bold,italic,fontSize")

**Current Status**: ✅ Implemented in `formatGoogleDocText`

**MCP Tool**: `docs_updateTextStyle`

**Example**:
```typescript
{
  updateTextStyle: {
    range: { startIndex: 1, endIndex: 10 },
    textStyle: { bold: true, fontSize: { magnitude: 14, unit: "PT" } },
    fields: "bold,fontSize"
  }
}
```

---

#### 5. `UpdateParagraphStyleRequest`
**Description**: Updates paragraph-level styling

**Parameters**:
- `range` (Range): Paragraph range
- `paragraphStyle` (ParagraphStyle):
  - `namedStyleType` (enum): NORMAL_TEXT, TITLE, SUBTITLE, HEADING_1-6
  - `alignment` (enum): START, CENTER, END, JUSTIFIED
  - `lineSpacing` (number): Percentage (100 = single-spaced)
  - `direction` (enum): LEFT_TO_RIGHT, RIGHT_TO_LEFT
  - `spacingMode` (enum): NEVER_COLLAPSE, COLLAPSE_LISTS
  - `spaceAbove.magnitude`, `spaceBelow.magnitude` (number)
  - `indentFirstLine`, `indentStart`, `indentEnd` (Dimension)
  - `keepLinesTogether` (boolean)
  - `keepWithNext` (boolean)
  - `avoidWidowAndOrphan` (boolean)
  - `borderBetween`, `borderTop`, `borderBottom`, `borderLeft`, `borderRight` (ParagraphBorder)
  - `tabStops` (TabStop[])
  - `shading.backgroundColor.color.rgbColor` (RgbColor)
- `fields` (string): Field mask

**Current Status**: ✅ Implemented in `formatGoogleDocParagraph`

**MCP Tool**: `docs_updateParagraphStyle`

**Example**:
```typescript
{
  updateParagraphStyle: {
    range: { startIndex: 1, endIndex: 50 },
    paragraphStyle: {
      namedStyleType: "HEADING_1",
      alignment: "CENTER"
    },
    fields: "namedStyleType,alignment"
  }
}
```

---

#### 6. `UpdateDocumentStyleRequest`
**Description**: Updates document-wide default styles

**Parameters**:
- `documentStyle` (DocumentStyle):
  - `background.color.rgbColor` (RgbColor)
  - `pageNumberStart` (integer)
  - `marginTop`, `marginBottom`, `marginRight`, `marginLeft` (Dimension)
  - `pageSize.height`, `pageSize.width` (Dimension)
  - `marginHeader`, `marginFooter` (Dimension)
  - `useEvenPageHeaderFooter` (boolean)
  - `useFirstPageHeaderFooter` (boolean)
  - `defaultHeaderId`, `defaultFooterId` (string)
  - `firstPageHeaderId`, `firstPageFooterId` (string)
  - `evenPageHeaderId`, `evenPageFooterId` (string)
  - `flipPageOrientation` (boolean)
- `fields` (string): Field mask
- `tabId` (string): Optional

**Current Status**: ✅ Implemented (Phase 1)

**MCP Tool**: `docs_updateDocumentStyle`

**Example**:
```typescript
{
  updateDocumentStyle: {
    documentStyle: {
      marginTop: { magnitude: 72, unit: "PT" }, // 1 inch
      marginBottom: { magnitude: 72, unit: "PT" }
    },
    fields: "marginTop,marginBottom"
  }
}
```

---

### Lists & Bullets (2 request types)

#### 7. `CreateParagraphBulletsRequest`
**Description**: Creates bullets for paragraphs in a range

**Parameters**:
- `range` (Range): Paragraphs to make bulleted
- `bulletPreset` (enum):
  - `BULLET_DISC_CIRCLE_SQUARE`
  - `BULLET_DIAMONDX_ARROW3D_SQUARE`
  - `BULLET_CHECKBOX`
  - `BULLET_ARROW_DIAMOND_DISC`
  - `BULLET_STAR_CIRCLE_SQUARE`
  - `BULLET_ARROW3D_CIRCLE_SQUARE`
  - `BULLET_LEFTTRIANGLE_DIAMOND_DISC`
  - `BULLET_DIAMONDX_HOLLOWDIAMOND_SQUARE`
  - `BULLET_DIAMOND_CIRCLE_SQUARE`
  - `NUMBERED_DECIMAL_ALPHA_ROMAN`
  - `NUMBERED_DECIMAL_ALPHA_ROMAN_PARENS`
  - `NUMBERED_DECIMAL_NESTED`
  - `NUMBERED_UPPERALPHA_ALPHA_ROMAN`
  - `NUMBERED_UPPERROMAN_UPPERALPHA_DECIMAL`
  - `NUMBERED_ZERODECIMAL_ALPHA_ROMAN`

**Current Status**: ✅ Implemented (Phase 1)

**MCP Tool**: `docs_createParagraphBullets`

**Example**:
```typescript
{
  createParagraphBullets: {
    range: { startIndex: 1, endIndex: 100 },
    bulletPreset: "NUMBERED_DECIMAL_ALPHA_ROMAN"
  }
}
```

---

#### 8. `DeleteParagraphBulletsRequest`
**Description**: Removes bullets from paragraphs (preserves indentation)

**Parameters**:
- `range` (Range): Paragraphs to remove bullets from

**Current Status**: ✅ Implemented (Phase 1)

**MCP Tool**: `docs_deleteParagraphBullets`

**Example**:
```typescript
{
  deleteParagraphBullets: {
    range: { startIndex: 1, endIndex: 100 }
  }
}
```

---

### Named Ranges (3 request types)

#### 9. `CreateNamedRangeRequest`
**Description**: Creates a named range referencing content

**Parameters**:
- `name` (string): Name for the range
- `range` (Range): Content to reference

**Returns**: `namedRangeId` in response

**Current Status**: ✅ Implemented (Phase 4)

**MCP Tool**: `docs_createNamedRange` ✅

**Example**:
```typescript
{
  createNamedRange: {
    name: "Introduction",
    range: { startIndex: 1, endIndex: 500 }
  }
}
```

---

#### 10. `DeleteNamedRangeRequest`
**Description**: Deletes a named range (content remains)

**Parameters**:
- `namedRangeId` (string): ID to delete (from create response)
- OR `name` (string): Name to delete

**Current Status**: ✅ Implemented (Phase 4)

**MCP Tool**: `docs_deleteNamedRange` ✅

**Example**:
```typescript
{
  deleteNamedRange: {
    name: "Introduction"
  }
}
```

---

#### 11. `ReplaceNamedRangeContentRequest`
**Description**: Replaces content within named ranges

**Parameters**:
- `namedRangeId` (string): ID of named range
- OR `namedRangeName` (string): Name of named range
- `text` (string): Replacement text
- `tabId` (string): Optional

**Note**: If named range has multiple discontinuous ranges, only first is replaced

**Current Status**: ✅ Implemented (Phase 4)

**MCP Tool**: `docs_replaceNamedRangeContent` ✅

**Example**:
```typescript
{
  replaceNamedRangeContent: {
    namedRangeName: "Introduction",
    text: "New introduction text"
  }
}
```

---

### Table Operations (11 request types)

#### 12. `InsertTableRequest`
**Description**: Inserts a table at specified location

**Parameters**:
- `location.index` (integer): Insertion point
- `location.tabId` (string): Optional
- `rows` (integer): Number of rows
- `columns` (integer): Number of columns
- `endOfSegmentLocation.tabId` (string): Insert at end instead of index

**Returns**: `objectId` (table ID) in response

**Current Status**: ✅ Implemented (Phase 1)

**MCP Tool**: `docs_insertTable`

**Example**:
```typescript
{
  insertTable: {
    location: { index: 1 },
    rows: 3,
    columns: 4
  }
}
```

---

#### 13. `InsertTableRowRequest`
**Description**: Inserts empty row into table

**Parameters**:
- `tableCellLocation.tableStartLocation.index` (integer): Table position
- `tableCellLocation.rowIndex` (integer): Row reference (0-indexed)
- `tableCellLocation.columnIndex` (integer): Column reference
- `insertBelow` (boolean): Insert below (true) or above (false) reference row

**Current Status**: ✅ Implemented (Phase 1)

**MCP Tool**: `docs_insertTableRow`

**Example**:
```typescript
{
  insertTableRow: {
    tableCellLocation: {
      tableStartLocation: { index: 10 },
      rowIndex: 1,
      columnIndex: 0
    },
    insertBelow: true
  }
}
```

---

#### 14. `InsertTableColumnRequest`
**Description**: Inserts empty column into table

**Parameters**:
- `tableCellLocation` (TableCellLocation): Reference cell
- `insertRight` (boolean): Insert right (true) or left (false) of reference

**Current Status**: ✅ Implemented (Phase 1)

**MCP Tool**: `docs_insertTableColumn`

**Example**:
```typescript
{
  insertTableColumn: {
    tableCellLocation: {
      tableStartLocation: { index: 10 },
      rowIndex: 0,
      columnIndex: 1
    },
    insertRight: true
  }
}
```

---

#### 15. `DeleteTableRowRequest`
**Description**: Deletes a table row

**Parameters**:
- `tableCellLocation` (TableCellLocation): Cell in row to delete

**Current Status**: ✅ Implemented (Phase 1)

**MCP Tool**: `docs_deleteTableRow`

---

#### 16. `DeleteTableColumnRequest`
**Description**: Deletes a table column

**Parameters**:
- `tableCellLocation` (TableCellLocation): Cell in column to delete

**Current Status**: ✅ Implemented (Phase 1)

**MCP Tool**: `docs_deleteTableColumn`

---

#### 17. `UpdateTableColumnPropertiesRequest`
**Description**: Updates column width and properties

**Parameters**:
- `tableStartLocation.index` (integer): Table position
- `columnIndices` (integer[]): Column indices to update (0-indexed)
- `tableColumnProperties.width.magnitude` (number): Width value
- `tableColumnProperties.width.unit` (enum): PT
- `tableColumnProperties.widthType` (enum): EVENLY_DISTRIBUTED, FIXED_WIDTH
- `fields` (string): Field mask

**Current Status**: ✅ Implemented (Phase 1)

**MCP Tool**: `docs_updateTableColumnProperties`

**Example**:
```typescript
{
  updateTableColumnProperties: {
    tableStartLocation: { index: 10 },
    columnIndices: [0, 1],
    tableColumnProperties: {
      width: { magnitude: 144, unit: "PT" }, // 2 inches
      widthType: "FIXED_WIDTH"
    },
    fields: "width,widthType"
  }
}
```

---

#### 18. `UpdateTableRowStyleRequest`
**Description**: Updates row height and styling

**Parameters**:
- `tableStartLocation.index` (integer): Table position
- `rowIndices` (integer[]): Rows to update
- `tableRowStyle.minRowHeight.magnitude` (number): Min height
- `tableRowStyle.minRowHeight.unit` (enum): PT
- `tableRowStyle.tableHeader` (boolean): Header row flag
- `tableRowStyle.preventOverflow` (boolean): Prevent content overflow
- `fields` (string): Field mask

**Current Status**: ✅ Implemented (Phase 1)

**MCP Tool**: `docs_updateTableRowStyle`

**Example**:
```typescript
{
  updateTableRowStyle: {
    tableStartLocation: { index: 10 },
    rowIndices: [0],
    tableRowStyle: {
      minRowHeight: { magnitude: 36, unit: "PT" },
      tableHeader: true
    },
    fields: "minRowHeight,tableHeader"
  }
}
```

---

#### 19. `UpdateTableCellStyleRequest`
**Description**: Updates cell borders, background, padding

**Parameters**:
- `tableStartLocation.index` (integer): Table position
- `tableRange.tableCellLocation` (TableCellLocation): Start cell
- `tableRange.rowSpan`, `tableRange.columnSpan` (integer): Range size
- `tableCellStyle.rowSpan`, `tableCellStyle.columnSpan` (integer)
- `tableCellStyle.backgroundColor.color.rgbColor` (RgbColor)
- `tableCellStyle.borderLeft/Right/Top/Bottom` (TableCellBorder):
  - `color.rgbColor` (RgbColor)
  - `width.magnitude`, `width.unit` (Dimension: PT)
  - `dashStyle` (enum): SOLID, DOT, DASH
- `tableCellStyle.paddingLeft/Right/Top/Bottom.magnitude` (number)
- `tableCellStyle.contentAlignment` (enum): TOP, MIDDLE, BOTTOM
- `fields` (string): Field mask

**Current Status**: ✅ Implemented (Phase 1)

**MCP Tool**: `docs_updateTableCellStyle`

**Example**:
```typescript
{
  updateTableCellStyle: {
    tableStartLocation: { index: 10 },
    tableRange: {
      tableCellLocation: { rowIndex: 0, columnIndex: 0 },
      rowSpan: 1,
      columnSpan: 2
    },
    tableCellStyle: {
      backgroundColor: { color: { rgbColor: { red: 0.9, green: 0.9, blue: 0.9 } } },
      borderBottom: {
        color: { rgbColor: { red: 0, green: 0, blue: 0 } },
        width: { magnitude: 2, unit: "PT" },
        dashStyle: "SOLID"
      }
    },
    fields: "backgroundColor,borderBottom"
  }
}
```

---

#### 20. `MergeTableCellsRequest`
**Description**: Merges multiple table cells into one

**Parameters**:
- `tableRange.tableCellLocation` (TableCellLocation): Start cell
- `tableRange.rowSpan` (integer): Rows to merge
- `tableRange.columnSpan` (integer): Columns to merge

**Note**: Cells must form rectangular region

**Current Status**: ✅ Implemented (Phase 1)

**MCP Tool**: `docs_mergeTableCells`

**Example**:
```typescript
{
  mergeTableCells: {
    tableRange: {
      tableCellLocation: {
        tableStartLocation: { index: 10 },
        rowIndex: 0,
        columnIndex: 0
      },
      rowSpan: 2,
      columnSpan: 2
    }
  }
}
```

---

#### 21. `UnmergeTableCellsRequest`
**Description**: Unmerges previously merged cells

**Parameters**:
- `tableRange` (TableRange): Range containing merged cells

**Current Status**: ✅ Implemented (Phase 1)

**MCP Tool**: `docs_unmergeTableCells`

---

#### 22. `PinTableHeaderRowsRequest`
**Description**: Pins table header rows (repeat on each page)

**Parameters**:
- `tableStartLocation.index` (integer): Table position
- `pinnedHeaderRowsCount` (integer): Number of rows to pin (0 unpins all)

**Current Status**: ✅ Implemented (Phase 1)

**MCP Tool**: `docs_pinTableHeaderRows`

**Example**:
```typescript
{
  pinTableHeaderRows: {
    tableStartLocation: { index: 10 },
    pinnedHeaderRowsCount: 1
  }
}
```

---

### Images (2 request types)

#### 23. `InsertInlineImageRequest`
**Description**: Inserts an inline image

**Parameters**:
- `location.index` (integer): Insertion point
- `uri` (string): Image URL (publicly accessible)
- `objectSize.height.magnitude`, `objectSize.width.magnitude` (number)
- `objectSize.height.unit`, `objectSize.width.unit` (enum): PT
- `endOfSegmentLocation` (EndOfSegmentLocation): Insert at end instead

**Constraints**:
- Max 50MB file size
- Max 25 megapixels
- Supported: PNG, JPEG, GIF, BMP

**Returns**: `objectId` (image ID)

**Current Status**: ✅ Implemented (Phase 5)

**MCP Tool**: `docs_insertInlineImage` ✅

**Example**:
```typescript
{
  insertInlineImage: {
    location: { index: 1 },
    uri: "https://example.com/image.png",
    objectSize: {
      height: { magnitude: 200, unit: "PT" },
      width: { magnitude: 300, unit: "PT" }
    }
  }
}
```

---

#### 24. `ReplaceImageRequest`
**Description**: Replaces existing image with new image

**Parameters**:
- `imageObjectId` (string): ID of image to replace
- `uri` (string): New image URL
- `imageReplaceMethod` (enum): CENTER_CROP (only option)

**Note**: Some image effects removed to match Docs editor behavior

**Current Status**: ✅ Implemented (Phase 5)

**MCP Tool**: `docs_replaceImage` ✅

**Example**:
```typescript
{
  replaceImage: {
    imageObjectId: "kix.abc123",
    uri: "https://example.com/new-image.png",
    imageReplaceMethod: "CENTER_CROP"
  }
}
```

---

### Page & Section Structure (3 request types)

#### 25. `InsertPageBreakRequest`
**Description**: Inserts page break followed by newline

**Parameters**:
- `location.index` (integer): Insertion point
- `endOfSegmentLocation` (EndOfSegmentLocation): Insert at end instead

**Constraints**:
- Cannot be inside tables, headers, footers, footnotes

**Current Status**: ✅ Implemented (Phase 1)

**MCP Tool**: `docs_insertPageBreak`

**Example**:
```typescript
{
  insertPageBreak: {
    location: { index: 100 }
  }
}
```

---

#### 26. `InsertSectionBreakRequest`
**Description**: Creates new section with independent styling

**Parameters**:
- `location.index` (integer): Insertion point
- `sectionType` (enum):
  - `SECTION_TYPE_UNSPECIFIED`
  - `CONTINUOUS` (section starts on same page)
  - `NEXT_PAGE` (section starts on next page)
- `endOfSegmentLocation` (EndOfSegmentLocation)

**Note**: Sections can have different headers/footers, margins, page orientation

**Current Status**: ✅ Implemented (Phase 1)

**MCP Tool**: `docs_insertSectionBreak`

**Example**:
```typescript
{
  insertSectionBreak: {
    location: { index: 500 },
    sectionType: "NEXT_PAGE"
  }
}
```

---

#### 27. `UpdateSectionStyleRequest`
**Description**: Updates section margins, columns, page size

**Parameters**:
- `range` (Range): Section to update
- `sectionStyle`:
  - `columnSeparatorStyle` (enum): NONE, BETWEEN_EACH_COLUMN
  - `contentDirection` (enum): LEFT_TO_RIGHT, RIGHT_TO_LEFT
  - `defaultHeaderId`, `defaultFooterId` (string)
  - `evenPageHeaderId`, `evenPageFooterId` (string)
  - `firstPageHeaderId`, `firstPageFooterId` (string)
  - `flipPageOrientation` (boolean)
  - `marginTop/Bottom/Right/Left` (Dimension)
  - `marginHeader`, `marginFooter` (Dimension)
  - `pageNumberStart` (integer)
  - `sectionType` (enum): CONTINUOUS, NEXT_PAGE
  - `useFirstPageHeaderFooter` (boolean)
- `fields` (string): Field mask

**Current Status**: ✅ Implemented (Phase 1)

**MCP Tool**: `docs_updateSectionStyle`

**Example**:
```typescript
{
  updateSectionStyle: {
    range: { startIndex: 1, endIndex: 1000 },
    sectionStyle: {
      marginTop: { magnitude: 72, unit: "PT" },
      columnSeparatorStyle: "BETWEEN_EACH_COLUMN"
    },
    fields: "marginTop,columnSeparatorStyle"
  }
}
```

---

### Headers & Footers (4 request types)

#### 28. `CreateHeaderRequest`
**Description**: Creates a header

**Parameters**:
- `type` (enum): HEADER_DEFAULT, HEADER_FIRST_PAGE, HEADER_EVEN_PAGES
- `sectionBreakLocation.index` (integer): Section to apply to (optional)

**Returns**: `headerId`

**Note**: If no section specified, applies to DocumentStyle

**Current Status**: ✅ Implemented (Phase 1)

**MCP Tool**: `docs_createHeader`

**Example**:
```typescript
{
  createHeader: {
    type: "HEADER_DEFAULT",
    sectionBreakLocation: { index: 1 }
  }
}
```

---

#### 29. `CreateFooterRequest`
**Description**: Creates a footer

**Parameters**:
- `type` (enum): FOOTER_DEFAULT, FOOTER_FIRST_PAGE, FOOTER_EVEN_PAGES
- `sectionBreakLocation.index` (integer): Optional

**Returns**: `footerId`

**Current Status**: ✅ Implemented (Phase 1)

**MCP Tool**: `docs_createFooter`

---

#### 30. `DeleteHeaderRequest`
**Description**: Removes a header by ID

**Parameters**:
- `headerId` (string): ID from createHeader response

**Current Status**: ✅ Implemented (Phase 1)

**MCP Tool**: `docs_deleteHeader`

**Example**:
```typescript
{
  deleteHeader: {
    headerId: "kix.header123"
  }
}
```

---

#### 31. `DeleteFooterRequest`
**Description**: Removes a footer by ID

**Parameters**:
- `footerId` (string): ID from createFooter response

**Current Status**: ✅ Implemented (Phase 1)

**MCP Tool**: `docs_deleteFooter`

---

### Footnotes (1 request type)

#### 32. `CreateFootnoteRequest`
**Description**: Inserts footnote reference with space and newline

**Parameters**:
- `location.index` (integer): Insertion point
- `endOfSegmentLocation` (EndOfSegmentLocation): Insert at end

**Returns**: `footnoteId`

**Note**: Footnote segment contains space + newline, ready for content

**Current Status**: ✅ Implemented (Phase 1)

**MCP Tool**: `docs_createFootnote`

**Example**:
```typescript
{
  createFootnote: {
    location: { index: 50 }
  }
}
```

---

### Other Elements (2 request types)

#### 33. `DeletePositionedObjectRequest`
**Description**: Removes floating objects (images, shapes)

**Parameters**:
- `objectId` (string): ID of positioned object to delete

**Current Status**: ✅ Implemented (Phase 1)

**MCP Tool**: `docs_deletePositionedObject`

**Example**:
```typescript
{
  deletePositionedObject: {
    objectId: "kix.positioned123"
  }
}
```

---

#### 34. `InsertPersonRequest`
**Description**: Inserts person mention/chip

**Parameters**:
- `location.index` (integer): Insertion point
- `person.personProperties.email` (string): Email to mention

**Note**: Person chips link to Google Workspace contacts

**Current Status**: ✅ Implemented (Phase 4)

**MCP Tool**: `docs_insertPerson` ✅

**Example**:
```typescript
{
  insertPerson: {
    location: { index: 1 },
    person: {
      personProperties: {
        email: "user@example.com"
      }
    }
  }
}
```

---

## Summary Statistics

### Total API Coverage

| Category | Request Types | Implemented | Missing | % Coverage |
|----------|--------------|-------------|---------|-----------|
| **Text Operations** | 3 | 3 | 0 | 100% ✅ |
| **Formatting & Styling** | 3 | 3 | 0 | 100% ✅ |
| **Lists & Bullets** | 2 | 2 | 0 | 100% ✅ |
| **Named Ranges** | 3 | 3 | 0 | 100% ✅ |
| **Table Operations** | 11 | 11 | 0 | 100% ✅ |
| **Images** | 2 | 2 | 0 | 100% ✅ |
| **Page & Section** | 3 | 3 | 0 | 100% ✅ |
| **Headers & Footers** | 4 | 4 | 0 | 100% ✅ |
| **Footnotes** | 1 | 1 | 0 | 100% ✅ |
| **Other Elements** | 2 | 2 | 0 | 100% ✅ |
| **TOTAL** | **34** | **34** | **0** | **100%** ✅ |

### Document-Level Methods

| Method | Implemented | Status |
|--------|-------------|--------|
| `documents.get` | ✅ | `getGoogleDocContent` |
| `documents.create` | ✅ | `createGoogleDoc` |
| `documents.batchUpdate` | ✅ COMPLETE | All 34/34 request types |

---

## Implementation Roadmap

### Phase 1: Core Text & Formatting ✅ COMPLETE
**Tools implemented (6/6):**
1. `docs_deleteContentRange` ✅ - Delete text
2. `docs_replaceAllText` ✅ - Find/replace
3. `docs_updateDocumentStyle` ✅ - Document-wide styling
4. `docs_createParagraphBullets` ✅ - Add bullets/numbering
5. `docs_deleteParagraphBullets` ✅ - Remove bullets
6. `docs_insertPageBreak` ✅ - Page breaks

**Impact**: Covers 80% of common document editing tasks
**Status**: All tools implemented and tested

---

### Phase 2: Tables ✅ COMPLETE
**Tools implemented (11/11):**
7. `docs_insertTable` ✅
8. `docs_insertTableRow` ✅
9. `docs_insertTableColumn` ✅
10. `docs_deleteTableRow` ✅
11. `docs_deleteTableColumn` ✅
12. `docs_updateTableColumnProperties` ✅
13. `docs_updateTableRowStyle` ✅
14. `docs_updateTableCellStyle` ✅
15. `docs_mergeTableCells` ✅
16. `docs_unmergeTableCells` ✅
17. `docs_pinTableHeaderRows` ✅

**Impact**: Essential for data presentation, reports, structured content
**Status**: All tools implemented and tested

---

### Phase 3: Advanced Structure ✅ COMPLETE
**Tools implemented (8/8):**
18. `docs_insertSectionBreak` ✅
19. `docs_updateSectionStyle` ✅
20. `docs_createHeader` ✅
21. `docs_createFooter` ✅
22. `docs_deleteHeader` ✅
23. `docs_deleteFooter` ✅
24. `docs_createFootnote` ✅
25. `docs_deletePositionedObject` ✅

**Impact**: Professional document formatting
**Status**: All tools implemented and tested

---

### Phase 4: Power User Features ✅ COMPLETE
**Tools implemented (4/4):**
26. `docs_createNamedRange` ✅
27. `docs_deleteNamedRange` ✅
28. `docs_replaceNamedRangeContent` ✅
29. `docs_insertPerson` ✅

**Impact**: Advanced workflows, automation
**Status**: All tools implemented and tested

---

### Phase 5: Images & Media ✅ COMPLETE
**Tools implemented (2/2):**
30. `docs_insertInlineImage` ✅
31. `docs_replaceImage` ✅

**Impact**: Visual content support
**Status**: All tools implemented and tested

---

## Testing Strategy Per Tool

For each new low-level tool, implement:

1. **Unit test** - Mock Google API, validate request format
2. **Integration test** - Real API call with OAuth document
3. **Integration test** - Real API call with public document
4. **Error handling test** - Invalid parameters
5. **MCP protocol test** - Response format validation

---

## API Constraints & Gotchas

### General Constraints
- Many operations cannot occur inside tables, equations, footnotes, headers, footers
- Tab ID defaults to first tab when omitted
- Requests in batchUpdate applied atomically (all or nothing)
- Field masks required for update operations

### Specific Constraints
- **Images**: Max 50MB, 25MP, must be publicly accessible
- **ReplaceAllText**: ~1000 replacements limit, no newlines in replacement
- **Tables**: Cells must form rectangular region for merging
- **Named Ranges**: Multi-range replacements only affect first range

### Index Behavior
- Google Docs uses **1-based indexing** (starts at 1, not 0)
- Table row/column indices use **0-based indexing**
- `endIndex` is **exclusive** in ranges

---

## Maintenance Notes

**Update Schedule**: Review quarterly for new API features

**Next Review**: 2025-04-18

**Changelog**:
- 2025-01-18: Initial audit, v1 API, 34 request types documented

---

## Related APIs Not Covered Here

### Google Drive API - Comments
**Location**: Separate API (Google Drive v3)
**Implementation Plan**: See `EXTENSION_PLAN.md`
**Methods**:
- `comments.list` - List comments on a file
- `comments.create` - Create anchored or unanchored comment
- `comments.get` - Get specific comment
- `comments.update` - Update comment content
- `comments.delete` - Delete comment
- `replies.create` - Reply to comment (enables resolution)
- `replies.list` - List replies on a comment
- `replies.get` - Get specific reply
- `replies.update` - Update reply
- `replies.delete` - Delete reply

**Key Features**:
- Anchored comments (linked to specific document locations)
- Unanchored comments (document-level)
- Comment resolution (via replies with `action: "resolve"`)
- **Required**: Must set `fields` parameter for all methods except delete

**Proposed MCP Tools** (from EXTENSION_PLAN.md):
- `listComments` - List comments on a Google Drive file
- `replyToComment` - Reply to a specific comment
- `resolveComment` - Mark comment as resolved

**Status**: Planned, not yet implemented

### Google Docs API - Suggestions
**Location**: Google Docs API v1 (same as this document)
**Documentation**: https://developers.google.com/workspace/docs/api/how-tos/suggestions
**Methods**: Part of `documents.get` and `documents.batchUpdate`

**Key Features**:
- Suggestions are deferred edits awaiting approval
- `suggestionState` parameter controls view mode:
  - `SUGGESTIONS_INLINE` - Show suggestions inline
  - `PREVIEW_SUGGESTIONS_ACCEPTED` - Show with all accepted
  - `PREVIEW_WITHOUT_SUGGESTIONS` - Hide suggestions
- Suggestions can be accepted/rejected via `batchUpdate`

**Status**: Not prioritized for current implementation
