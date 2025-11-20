# Google Sheets API Reference for MCP Implementation

## Document Information

- **API Version**: v4 (Current)
- **Last Verified**: 2025-01-18
- **Official Documentation**: https://developers.google.com/sheets/api/reference/rest
- **Purpose**: Complete audit of Google Sheets API for 1:1 MCP tool mapping

---

## API Compliance Status

**Current MCP Implementation:**
- ✅ 9 high-level tools implemented (create, update, get, formatting)
  - `createGoogleSheet` - Create spreadsheet
  - `updateGoogleSheet` - Update cell values
  - `getGoogleSheetContent` - Get cell values
  - `formatGoogleSheetCells` - Format cells (background, alignment, wrapping)
  - `formatGoogleSheetText` - Text formatting (bold, italic, font, color)
  - `formatGoogleSheetNumbers` - Number formatting (currency, date, percent)
  - `setGoogleSheetBorders` - Cell borders
  - `mergeGoogleSheetCells` - Merge cells
  - `addGoogleSheetConditionalFormat` - Conditional formatting

**Missing Thin-Layer Tools**: ~40+ request types not yet exposed

**API Coverage**: 9/50+ operations (~18%) ⚠️

**Status:** Needs thin-layer implementation for complete API coverage

---

## Spreadsheet-Level Methods

### 1. `spreadsheets.get`
**Description**: Retrieves a spreadsheet's metadata and data

**Request**:
```typescript
{
  spreadsheetId: string;
  ranges?: string[];           // Optional: specific ranges to retrieve
  includeGridData?: boolean;   // Include cell values (default: false)
}
```

**Returns**: Spreadsheet object with:
- Spreadsheet ID, title, locale, timezone
- Properties (autoRecalc, defaultFormat, iterativeCalculation)
- Sheets array (properties, data, merges, conditionalFormats, etc.)
- Named ranges
- Developer metadata

**Current MCP Tool**: Partial via `getGoogleSheetContent` (only gets values)

**Proposed Thin-Layer Tool**: `sheets_getSpreadsheet`

**Example**:
```typescript
{
  spreadsheetId: "abc123",
  includeGridData: true
}
```

---

### 2. `spreadsheets.create`
**Description**: Creates a new spreadsheet

**Request**:
```typescript
{
  properties: {
    title: string;
    locale?: string;           // e.g., "en_US"
    autoRecalc?: enum;         // ON_CHANGE, MINUTE, HOUR
    timeZone?: string;         // e.g., "America/New_York"
    defaultFormat?: CellFormat;
    iterativeCalculationSettings?: {...};
    spreadsheetTheme?: {...};
  };
  sheets?: Sheet[];            // Initial sheets
  namedRanges?: NamedRange[];
}
```

**Returns**: Newly created Spreadsheet object

**Current MCP Tool**: `createGoogleSheet` (simplified)

**Proposed Thin-Layer Tool**: `sheets_createSpreadsheet`

---

### 3. `spreadsheets.batchUpdate`
**Description**: Applies one or more updates to the spreadsheet

**Request**:
```typescript
{
  spreadsheetId: string;
  requests: Request[];          // Array of request objects
  includeSpreadsheetInResponse?: boolean;
  responseRanges?: string[];
  responseIncludeGridData?: boolean;
}
```

**Returns**: BatchUpdateResponse with:
- Spreadsheet ID
- Replies array (responses for each request)
- Updated spreadsheet (if requested)

**Processing**:
- Requests validated before application
- Applied in order specified
- All requests applied atomically

**Current MCP Tool**: Partial (via formatting tools)

**Proposed Thin-Layer Tool**: Individual tools for each request type (see below)

---

## Values Methods (spreadsheets.values.*)

### 4. `spreadsheets.values.get`
**Description**: Returns cell values for a range

**Request**:
```typescript
{
  spreadsheetId: string;
  range: string;                      // A1 notation: "Sheet1!A1:B2"
  majorDimension?: "ROWS" | "COLUMNS";
  valueRenderOption?: "FORMATTED_VALUE" | "UNFORMATTED_VALUE" | "FORMULA";
  dateTimeRenderOption?: "SERIAL_NUMBER" | "FORMATTED_STRING";
}
```

**Returns**: ValueRange object

**Current MCP Tool**: `getGoogleSheetContent` ✅

**Proposed Thin-Layer Tool**: `sheets_getValues`

---

### 5. `spreadsheets.values.update`
**Description**: Sets values in a range

**Request**:
```typescript
{
  spreadsheetId: string;
  range: string;
  valueInputOption: "RAW" | "USER_ENTERED";
  values: any[][];              // 2D array of values
}
```

**Returns**: UpdateValuesResponse

**Current MCP Tool**: `updateGoogleSheet` ✅

**Proposed Thin-Layer Tool**: `sheets_updateValues`

---

### 6. `spreadsheets.values.append`
**Description**: Appends values to a sheet

**Request**:
```typescript
{
  spreadsheetId: string;
  range: string;                // Starting range
  valueInputOption: "RAW" | "USER_ENTERED";
  insertDataOption?: "OVERWRITE" | "INSERT_ROWS";
  values: any[][];
}
```

**Returns**: AppendValuesResponse with updates

**Current MCP Tool**: ❌ Not implemented

**Proposed Thin-Layer Tool**: `sheets_appendValues`

---

### 7. `spreadsheets.values.clear`
**Description**: Clears values from a range

**Request**:
```typescript
{
  spreadsheetId: string;
  range: string;
}
```

**Returns**: ClearValuesResponse

**Current MCP Tool**: ❌ Not implemented

**Proposed Thin-Layer Tool**: `sheets_clearValues`

---

### 8. `spreadsheets.values.batchGet`
**Description**: Returns cell values for multiple ranges

**Request**:
```typescript
{
  spreadsheetId: string;
  ranges: string[];
  majorDimension?: "ROWS" | "COLUMNS";
  valueRenderOption?: "FORMATTED_VALUE" | "UNFORMATTED_VALUE" | "FORMULA";
  dateTimeRenderOption?: "SERIAL_NUMBER" | "FORMATTED_STRING";
}
```

**Returns**: BatchGetValuesResponse

**Current MCP Tool**: ❌ Not implemented

**Proposed Thin-Layer Tool**: `sheets_batchGetValues`

---

### 9. `spreadsheets.values.batchUpdate`
**Description**: Sets values in multiple ranges

**Request**:
```typescript
{
  spreadsheetId: string;
  valueInputOption: "RAW" | "USER_ENTERED";
  data: ValueRange[];           // Array of range + values
}
```

**Returns**: BatchUpdateValuesResponse

**Current MCP Tool**: ❌ Not implemented

**Proposed Thin-Layer Tool**: `sheets_batchUpdateValues`

---

### 10. `spreadsheets.values.batchClear`
**Description**: Clears multiple ranges

**Request**:
```typescript
{
  spreadsheetId: string;
  ranges: string[];
}
```

**Returns**: BatchClearValuesResponse

**Current MCP Tool**: ❌ Not implemented

**Proposed Thin-Layer Tool**: `sheets_batchClearValues`

---

## batchUpdate Request Types

### Sheet Management (7 request types)

#### 1. `AddSheetRequest`
**Description**: Adds a new sheet to the spreadsheet

**Parameters**:
- `properties.sheetId` (integer): Optional sheet ID
- `properties.title` (string): Sheet name
- `properties.index` (integer): Position in sheet list
- `properties.sheetType` (enum): GRID, OBJECT
- `properties.gridProperties.rowCount` (integer): Initial rows
- `properties.gridProperties.columnCount` (integer): Initial columns
- `properties.gridProperties.frozenRowCount` (integer): Frozen rows
- `properties.gridProperties.frozenColumnCount` (integer): Frozen columns
- `properties.hidden` (boolean): Hide sheet
- `properties.tabColor` (Color): Tab color
- `properties.rightToLeft` (boolean): RTL direction

**Returns**: `addSheet.properties` in response

**Current MCP Tool**: ❌ Not implemented

**Proposed Tool**: `sheets_addSheet`

**Example**:
```typescript
{
  addSheet: {
    properties: {
      title: "Q1 Data",
      gridProperties: {
        rowCount: 1000,
        columnCount: 26
      }
    }
  }
}
```

---

#### 2. `DeleteSheetRequest`
**Description**: Deletes a sheet from the spreadsheet

**Parameters**:
- `sheetId` (integer): ID of sheet to delete

**Current MCP Tool**: ❌ Not implemented

**Proposed Tool**: `sheets_deleteSheet`

---

#### 3. `UpdateSheetPropertiesRequest`
**Description**: Updates sheet properties

**Parameters**:
- `properties` (SheetProperties): Properties to update
- `fields` (string): Field mask (e.g., "title,gridProperties.frozenRowCount")

**Current MCP Tool**: ❌ Not implemented

**Proposed Tool**: `sheets_updateSheetProperties`

**Example**:
```typescript
{
  updateSheetProperties: {
    properties: {
      sheetId: 0,
      title: "Renamed Sheet",
      gridProperties: {
        frozenRowCount: 1
      }
    },
    fields: "title,gridProperties.frozenRowCount"
  }
}
```

---

#### 4. `DuplicateSheetRequest`
**Description**: Duplicates a sheet

**Parameters**:
- `sourceSheetId` (integer): Sheet to duplicate
- `insertSheetIndex` (integer): Position for new sheet
- `newSheetId` (integer): Optional ID for new sheet
- `newSheetName` (string): Optional name

**Returns**: `duplicateSheet.properties` in response

**Current MCP Tool**: ❌ Not implemented

**Proposed Tool**: `sheets_duplicateSheet`

---

#### 5. `CopyPasteRequest`
**Description**: Copies data/formatting from source to destination

**Parameters**:
- `source` (GridRange): Source range
- `destination` (GridRange): Destination range
- `pasteType` (enum):
  - `PASTE_NORMAL` - All data and formatting
  - `PASTE_VALUES` - Only values
  - `PASTE_FORMAT` - Only formatting
  - `PASTE_NO_BORDERS` - Everything except borders
  - `PASTE_FORMULA` - Only formulas
  - `PASTE_DATA_VALIDATION` - Only validation rules
  - `PASTE_CONDITIONAL_FORMATTING` - Only conditional formatting
- `pasteOrientation` (enum): NORMAL, TRANSPOSE

**Current MCP Tool**: ❌ Not implemented

**Proposed Tool**: `sheets_copyPaste`

**Example**:
```typescript
{
  copyPaste: {
    source: {
      sheetId: 0,
      startRowIndex: 0,
      endRowIndex: 10,
      startColumnIndex: 0,
      endColumnIndex: 5
    },
    destination: {
      sheetId: 0,
      startRowIndex: 20,
      endRowIndex: 30,
      startColumnIndex: 0,
      endColumnIndex: 5
    },
    pasteType: "PASTE_VALUES"
  }
}
```

---

#### 6. `CutPasteRequest`
**Description**: Moves data from source to destination

**Parameters**:
- `source` (GridRange): Source range
- `destination` (GridCoordinate): Destination top-left cell
- `pasteType` (enum): Same as CopyPaste

**Current MCP Tool**: ❌ Not implemented

**Proposed Tool**: `sheets_cutPaste`

---

#### 7. `AutoResizeDimensionsRequest`
**Description**: Auto-resizes column widths or row heights

**Parameters**:
- `dimensions` (DimensionRange): Rows or columns to resize
- `dimensions.sheetId` (integer)
- `dimensions.dimension` (enum): ROWS, COLUMNS
- `dimensions.startIndex` (integer)
- `dimensions.endIndex` (integer)

**Current MCP Tool**: ❌ Not implemented

**Proposed Tool**: `sheets_autoResizeDimensions`

---

### Cell Data Operations (5 request types)

#### 8. `UpdateCellsRequest`
**Description**: Updates cell data, formatting, and properties

**Parameters**:
- `range` (GridRange): Range to update
- `rows` (RowData[]): Cell data
- `fields` (string): Field mask

**Note**: This is the most powerful cell update operation

**Current MCP Tool**: Partial (via formatting tools)

**Proposed Tool**: `sheets_updateCells`

**Example**:
```typescript
{
  updateCells: {
    range: {
      sheetId: 0,
      startRowIndex: 0,
      endRowIndex: 1,
      startColumnIndex: 0,
      endColumnIndex: 2
    },
    rows: [{
      values: [{
        userEnteredValue: { stringValue: "Hello" },
        userEnteredFormat: {
          backgroundColor: { red: 1, green: 0, blue: 0 },
          textFormat: { bold: true }
        }
      }]
    }],
    fields: "userEnteredValue,userEnteredFormat(backgroundColor,textFormat)"
  }
}
```

---

#### 9. `RepeatCellRequest`
**Description**: Updates all cells in range with same data

**Parameters**:
- `range` (GridRange): Range to fill
- `cell` (CellData): Cell data to repeat
- `fields` (string): Field mask

**Current MCP Tool**: ❌ Not implemented

**Proposed Tool**: `sheets_repeatCell`

---

#### 10. `AppendCellsRequest`
**Description**: Appends cells after last row with data

**Parameters**:
- `sheetId` (integer): Sheet to append to
- `rows` (RowData[]): Rows to append
- `fields` (string): Field mask

**Current MCP Tool**: ❌ Not implemented

**Proposed Tool**: `sheets_appendCells`

---

#### 11. `InsertRangeRequest`
**Description**: Inserts empty cells and shifts existing cells

**Parameters**:
- `range` (GridRange): Where to insert
- `shiftDimension` (enum): ROWS, COLUMNS

**Current MCP Tool**: ❌ Not implemented

**Proposed Tool**: `sheets_insertRange`

---

#### 12. `DeleteRangeRequest`
**Description**: Deletes range and shifts remaining cells

**Parameters**:
- `range` (GridRange): Range to delete
- `shiftDimension` (enum): ROWS, COLUMNS

**Current MCP Tool**: ❌ Not implemented

**Proposed Tool**: `sheets_deleteRange`

---

### Row/Column Operations (6 request types)

#### 13. `InsertDimensionRequest`
**Description**: Inserts rows or columns

**Parameters**:
- `range` (DimensionRange): Where to insert
- `inheritFromBefore` (boolean): Inherit formatting from before/after

**Current MCP Tool**: ❌ Not implemented

**Proposed Tool**: `sheets_insertDimension`

---

#### 14. `DeleteDimensionRequest`
**Description**: Deletes rows or columns

**Parameters**:
- `range` (DimensionRange): Rows/columns to delete

**Current MCP Tool**: ❌ Not implemented

**Proposed Tool**: `sheets_deleteDimension`

---

#### 15. `MoveDimensionRequest`
**Description**: Moves rows or columns

**Parameters**:
- `source` (DimensionRange): Rows/columns to move
- `destinationIndex` (integer): Where to move them

**Current MCP Tool**: ❌ Not implemented

**Proposed Tool**: `sheets_moveDimension`

---

#### 16. `UpdateDimensionPropertiesRequest`
**Description**: Updates row heights or column widths

**Parameters**:
- `range` (DimensionRange): Rows/columns to update
- `properties` (DimensionProperties):
  - `pixelSize` (integer): Height/width in pixels
  - `hiddenByFilter` (boolean)
  - `hiddenByUser` (boolean)
  - `developerMetadata` (DeveloperMetadata[])
- `fields` (string): Field mask

**Current MCP Tool**: ❌ Not implemented

**Proposed Tool**: `sheets_updateDimensionProperties`

---

#### 17. `AppendDimensionRequest`
**Description**: Appends rows or columns to end of sheet

**Parameters**:
- `sheetId` (integer): Sheet to append to
- `dimension` (enum): ROWS, COLUMNS
- `length` (integer): Number to append

**Current MCP Tool**: ❌ Not implemented

**Proposed Tool**: `sheets_appendDimension`

---

#### 18. `AutoFillRequest`
**Description**: Fills in more data based on existing pattern

**Parameters**:
- `range` (GridRange): Range to fill
- `sourceAndDestination` (SourceAndDestination):
  - `source` (GridRange): Pattern source
  - `dimension` (enum): ROWS, COLUMNS
  - `fillLength` (integer): How many cells to fill

**Current MCP Tool**: ❌ Not implemented

**Proposed Tool**: `sheets_autoFill`

---

### Formatting Operations (8 request types)

#### 19. `MergeCellsRequest`
**Description**: Merges all cells in range

**Parameters**:
- `range` (GridRange): Range to merge
- `mergeType` (enum):
  - `MERGE_ALL` - Merge all cells
  - `MERGE_COLUMNS` - Merge columns (preserve rows)
  - `MERGE_ROWS` - Merge rows (preserve columns)

**Current MCP Tool**: `mergeGoogleSheetCells` ✅

**Proposed Tool**: `sheets_mergeCells`

---

#### 20. `UnmergeCellsRequest`
**Description**: Unmerges cells in range

**Parameters**:
- `range` (GridRange): Range to unmerge

**Current MCP Tool**: ❌ Not implemented

**Proposed Tool**: `sheets_unmergeCells`

---

#### 21. `UpdateBordersRequest`
**Description**: Updates cell borders

**Parameters**:
- `range` (GridRange): Range to update
- `top`, `bottom`, `left`, `right`, `innerHorizontal`, `innerVertical` (Border):
  - `style` (enum): SOLID, DASHED, DOTTED, DOUBLE, etc.
  - `width` (integer): Pixels
  - `color` (Color)

**Current MCP Tool**: `setGoogleSheetBorders` ✅

**Proposed Tool**: `sheets_updateBorders`

---

#### 22. `AddConditionalFormatRuleRequest`
**Description**: Adds conditional formatting rule

**Parameters**:
- `rule` (ConditionalFormatRule):
  - `ranges` (GridRange[]): Ranges to apply to
  - `booleanRule` OR `gradientRule`: Formatting rule
- `index` (integer): Rule priority

**Current MCP Tool**: `addGoogleSheetConditionalFormat` ✅

**Proposed Tool**: `sheets_addConditionalFormatRule`

---

#### 23. `UpdateConditionalFormatRuleRequest`
**Description**: Updates existing conditional format rule

**Parameters**:
- `sheetId` (integer): Sheet containing rule
- `index` (integer): Rule index
- `rule` (ConditionalFormatRule): New rule
- `newIndex` (integer): Optional new priority

**Current MCP Tool**: ❌ Not implemented

**Proposed Tool**: `sheets_updateConditionalFormatRule`

---

#### 24. `DeleteConditionalFormatRuleRequest`
**Description**: Deletes conditional format rule

**Parameters**:
- `sheetId` (integer): Sheet containing rule
- `index` (integer): Rule index to delete

**Current MCP Tool**: ❌ Not implemented

**Proposed Tool**: `sheets_deleteConditionalFormatRule`

---

#### 25. `SetBasicFilterRequest`
**Description**: Sets or updates basic filter

**Parameters**:
- `filter` (BasicFilter):
  - `range` (GridRange): Range to filter
  - `sortSpecs` (SortSpec[]): Sort specifications
  - `criteria` (map): Filter criteria per column

**Current MCP Tool**: ❌ Not implemented

**Proposed Tool**: `sheets_setBasicFilter`

---

#### 26. `ClearBasicFilterRequest`
**Description**: Removes basic filter from sheet

**Parameters**:
- `sheetId` (integer): Sheet to clear filter from

**Current MCP Tool**: ❌ Not implemented

**Proposed Tool**: `sheets_clearBasicFilter`

---

### Data Validation (3 request types)

#### 27. `SetDataValidationRequest`
**Description**: Sets data validation for range

**Parameters**:
- `range` (GridRange): Range to validate
- `rule` (DataValidationRule):
  - `condition` (BooleanCondition): Validation condition
  - `inputMessage` (string): Help text
  - `strict` (boolean): Reject invalid input
  - `showCustomUi` (boolean): Show dropdown

**Current MCP Tool**: ❌ Not implemented

**Proposed Tool**: `sheets_setDataValidation`

**Example**:
```typescript
{
  setDataValidation: {
    range: {
      sheetId: 0,
      startRowIndex: 1,
      endRowIndex: 100,
      startColumnIndex: 0,
      endColumnIndex: 1
    },
    rule: {
      condition: {
        type: "NUMBER_BETWEEN",
        values: [
          { userEnteredValue: "1" },
          { userEnteredValue: "100" }
        ]
      },
      inputMessage: "Enter a number between 1 and 100",
      strict: true
    }
  }
}
```

---

#### 28. `AddProtectedRangeRequest`
**Description**: Protects a range from editing

**Parameters**:
- `protectedRange` (ProtectedRange):
  - `range` (GridRange): Range to protect
  - `description` (string): Protection description
  - `warningOnly` (boolean): Show warning vs block edits
  - `editors` (Editors): Who can edit
  - `namedRangeId` (string): Optional named range

**Returns**: `addProtectedRange.protectedRange` in response

**Current MCP Tool**: ❌ Not implemented

**Proposed Tool**: `sheets_addProtectedRange`

---

#### 29. `UpdateProtectedRangeRequest`
**Description**: Updates protected range

**Parameters**:
- `protectedRange` (ProtectedRange): Updated protection
- `fields` (string): Field mask

**Current MCP Tool**: ❌ Not implemented

**Proposed Tool**: `sheets_updateProtectedRange`

---

#### 30. `DeleteProtectedRangeRequest`
**Description**: Removes range protection

**Parameters**:
- `protectedRangeId` (integer): ID from add response

**Current MCP Tool**: ❌ Not implemented

**Proposed Tool**: `sheets_deleteProtectedRange`

---

### Named Ranges (3 request types)

#### 31. `AddNamedRangeRequest`
**Description**: Creates a named range

**Parameters**:
- `namedRange` (NamedRange):
  - `name` (string): Range name
  - `range` (GridRange): Range to name
  - `namedRangeId` (string): Optional ID

**Returns**: `addNamedRange.namedRange` in response

**Current MCP Tool**: ❌ Not implemented

**Proposed Tool**: `sheets_addNamedRange`

---

#### 32. `UpdateNamedRangeRequest`
**Description**: Updates named range

**Parameters**:
- `namedRange` (NamedRange): Updated range
- `fields` (string): Field mask

**Current MCP Tool**: ❌ Not implemented

**Proposed Tool**: `sheets_updateNamedRange`

---

#### 33. `DeleteNamedRangeRequest`
**Description**: Deletes named range

**Parameters**:
- `namedRangeId` (string): ID to delete

**Current MCP Tool**: ❌ Not implemented

**Proposed Tool**: `sheets_deleteNamedRange`

---

### Sorting & Filtering (2 request types)

#### 34. `SortRangeRequest`
**Description**: Sorts data in a range

**Parameters**:
- `range` (GridRange): Range to sort
- `sortSpecs` (SortSpec[]):
  - `dimensionIndex` (integer): Column to sort by
  - `sortOrder` (enum): ASCENDING, DESCENDING

**Current MCP Tool**: ❌ Not implemented

**Proposed Tool**: `sheets_sortRange`

---

#### 35. `AddFilterViewRequest`
**Description**: Creates a filter view

**Parameters**:
- `filter` (FilterView):
  - `title` (string): Filter view name
  - `range` (GridRange): Range to filter
  - `sortSpecs` (SortSpec[]): Sort specifications
  - `criteria` (map): Filter criteria

**Returns**: `addFilterView.filter` in response

**Current MCP Tool**: ❌ Not implemented

**Proposed Tool**: `sheets_addFilterView`

---

### Chart Operations (4 request types)

#### 36. `AddChartRequest`
**Description**: Adds a chart to the sheet

**Parameters**:
- `chart` (EmbeddedChart):
  - `spec` (ChartSpec): Chart specifications
  - `position` (EmbeddedObjectPosition): Chart position

**Returns**: `addChart.chart` in response

**Current MCP Tool**: ❌ Not implemented

**Proposed Tool**: `sheets_addChart`

---

#### 37. `UpdateChartSpecRequest`
**Description**: Updates chart specifications

**Parameters**:
- `chartId` (integer): Chart to update
- `spec` (ChartSpec): New specifications

**Current MCP Tool**: ❌ Not implemented

**Proposed Tool**: `sheets_updateChartSpec`

---

#### 38. `UpdateEmbeddedObjectPositionRequest`
**Description**: Moves or resizes chart

**Parameters**:
- `objectId` (integer): Chart or image ID
- `newPosition` (EmbeddedObjectPosition)
- `fields` (string): Field mask

**Current MCP Tool**: ❌ Not implemented

**Proposed Tool**: `sheets_updateEmbeddedObjectPosition`

---

#### 39. `DeleteEmbeddedObjectRequest`
**Description**: Deletes chart or image

**Parameters**:
- `objectId` (integer): Object to delete

**Current MCP Tool**: ❌ Not implemented

**Proposed Tool**: `sheets_deleteEmbeddedObject`

---

### Other Operations (11 request types)

#### 40. `FindReplaceRequest`
**Description**: Finds and replaces text/values

**Parameters**:
- `find` (string): Text to find
- `replacement` (string): Replacement text
- `matchCase` (boolean): Case-sensitive
- `matchEntireCell` (boolean): Whole cell match
- `searchByRegex` (boolean): Use regex
- `includeFormulas` (boolean): Search formulas
- `range` (GridRange): Optional search range
- `sheetId` (integer): Optional sheet
- `allSheets` (boolean): Search all sheets

**Returns**: Number of replacements made

**Current MCP Tool**: ❌ Not implemented

**Proposed Tool**: `sheets_findReplace`

---

#### 41. `TextToColumnsRequest`
**Description**: Splits text in cells into columns

**Parameters**:
- `source` (GridRange): Source cells
- `delimiter` (string): Split delimiter
- `delimiterType` (enum): COMMA, SEMICOLON, PERIOD, SPACE, CUSTOM, AUTODETECT

**Current MCP Tool**: ❌ Not implemented

**Proposed Tool**: `sheets_textToColumns`

---

#### 42. `PasteDataRequest`
**Description**: Pastes data (TSV format)

**Parameters**:
- `coordinate` (GridCoordinate): Paste location
- `data` (string): TSV data
- `type` (enum): PASTE_NORMAL, PASTE_VALUES, etc.
- `delimiter` (string): Optional delimiter
- `html` (boolean): Data is HTML

**Current MCP Tool**: ❌ Not implemented

**Proposed Tool**: `sheets_pasteData`

---

#### 43. `RandomizeRangeRequest`
**Description**: Randomizes order of rows in range

**Parameters**:
- `range` (GridRange): Range to randomize

**Current MCP Tool**: ❌ Not implemented

**Proposed Tool**: `sheets_randomizeRange`

---

#### 44. `TrimWhitespaceRequest`
**Description**: Removes leading/trailing whitespace

**Parameters**:
- `range` (GridRange): Range to trim

**Current MCP Tool**: ❌ Not implemented

**Proposed Tool**: `sheets_trimWhitespace`

---

#### 45. `DeleteDuplicatesRequest`
**Description**: Removes duplicate rows

**Parameters**:
- `range` (GridRange): Range to deduplicate
- `comparisonColumns` (DimensionRange[]): Columns to compare

**Current MCP Tool**: ❌ Not implemented

**Proposed Tool**: `sheets_deleteDuplicates`

---

#### 46-50. Additional Operations
- `AddBandingRequest` - Add alternating colors
- `UpdateBandingRequest` - Update banding
- `DeleteBandingRequest` - Remove banding
- `CreateDeveloperMetadataRequest` - Add metadata
- `UpdateDeveloperMetadataRequest` - Update metadata
- `DeleteDeveloperMetadataRequest` - Delete metadata

**Current MCP Tool**: ❌ Not implemented

---

## Summary Statistics

### API Coverage by Category

| Category | Request Types | Implemented | Missing | % Coverage |
|----------|--------------|-------------|---------|-----------|
| **Sheet Management** | 7 | 0 | 7 | 0% ❌ |
| **Cell Data Operations** | 5 | 1 | 4 | 20% ⚠️ |
| **Row/Column Operations** | 6 | 0 | 6 | 0% ❌ |
| **Formatting Operations** | 8 | 3 | 5 | 38% ⚠️ |
| **Data Validation** | 4 | 0 | 4 | 0% ❌ |
| **Named Ranges** | 3 | 0 | 3 | 0% ❌ |
| **Sorting & Filtering** | 2 | 0 | 2 | 0% ❌ |
| **Chart Operations** | 4 | 0 | 4 | 0% ❌ |
| **Other Operations** | 11 | 0 | 11 | 0% ❌ |
| **TOTAL batchUpdate** | **50** | **4** | **46** | **8%** ❌ |

### Values Methods Coverage

| Method | Implemented | Status |
|--------|-------------|--------|
| `spreadsheets.values.get` | ✅ | `getGoogleSheetContent` |
| `spreadsheets.values.update` | ✅ | `updateGoogleSheet` |
| `spreadsheets.values.append` | ❌ | Not implemented |
| `spreadsheets.values.clear` | ❌ | Not implemented |
| `spreadsheets.values.batchGet` | ❌ | Not implemented |
| `spreadsheets.values.batchUpdate` | ❌ | Not implemented |
| `spreadsheets.values.batchClear` | ❌ | Not implemented |

### Spreadsheet Methods Coverage

| Method | Implemented | Status |
|--------|-------------|--------|
| `spreadsheets.get` | Partial | Only gets values, not metadata |
| `spreadsheets.create` | Partial | Simplified version |
| `spreadsheets.batchUpdate` | Partial | Only formatting tools |

---

## Implementation Roadmap

### Phase 1: Core Data Operations
**Priority**: HIGH
**Tools to implement (10):**
1. `sheets_getSpreadsheet` - Get full spreadsheet metadata
2. `sheets_createSpreadsheet` - Full-featured create
3. `sheets_appendValues` - Append data to sheet
4. `sheets_clearValues` - Clear cell values
5. `sheets_batchGetValues` - Get multiple ranges
6. `sheets_batchUpdateValues` - Update multiple ranges
7. `sheets_batchClearValues` - Clear multiple ranges
8. `sheets_addSheet` - Add new sheet
9. `sheets_deleteSheet` - Delete sheet
10. `sheets_updateSheetProperties` - Update sheet properties

**Impact**: Covers 80% of data manipulation use cases
**Estimated Effort**: 2-3 days

---

### Phase 2: Row/Column/Range Operations
**Priority**: HIGH
**Tools to implement (10):**
11. `sheets_insertDimension` - Insert rows/columns
12. `sheets_deleteDimension` - Delete rows/columns
13. `sheets_moveDimension` - Move rows/columns
14. `sheets_updateDimensionProperties` - Set row height/column width
15. `sheets_appendDimension` - Append rows/columns
16. `sheets_insertRange` - Insert cells and shift
17. `sheets_deleteRange` - Delete cells and shift
18. `sheets_copyPaste` - Copy/paste with options
19. `sheets_cutPaste` - Cut/paste
20. `sheets_autoResizeDimensions` - Auto-resize columns/rows

**Impact**: Essential for sheet structure manipulation
**Estimated Effort**: 2-3 days

---

### Phase 3: Advanced Formatting & Validation
**Priority**: MEDIUM
**Tools to implement (12):**
21. `sheets_updateCells` - Low-level cell update
22. `sheets_repeatCell` - Fill range with same data
23. `sheets_appendCells` - Append cell data
24. `sheets_unmergeCells` - Unmerge cells
25. `sheets_updateBorders` - Update borders (thin layer)
26. `sheets_addConditionalFormatRule` - Add conditional format (thin)
27. `sheets_updateConditionalFormatRule` - Update rule
28. `sheets_deleteConditionalFormatRule` - Delete rule
29. `sheets_setDataValidation` - Set validation rules
30. `sheets_addProtectedRange` - Protect range
31. `sheets_updateProtectedRange` - Update protection
32. `sheets_deleteProtectedRange` - Remove protection

**Impact**: Professional spreadsheet features
**Estimated Effort**: 3-4 days

---

### Phase 4: Named Ranges, Sorting & Filtering
**Priority**: MEDIUM
**Tools to implement (9):**
33. `sheets_addNamedRange` - Create named range
34. `sheets_updateNamedRange` - Update named range
35. `sheets_deleteNamedRange` - Delete named range
36. `sheets_sortRange` - Sort data
37. `sheets_setBasicFilter` - Set filter
38. `sheets_clearBasicFilter` - Clear filter
39. `sheets_addFilterView` - Add filter view
40. `sheets_findReplace` - Find and replace
41. `sheets_autoFill` - Auto-fill pattern

**Impact**: Power user features
**Estimated Effort**: 2-3 days

---

### Phase 5: Charts & Advanced Operations
**Priority**: LOW
**Tools to implement (9):**
42. `sheets_addChart` - Add chart
43. `sheets_updateChartSpec` - Update chart
44. `sheets_updateEmbeddedObjectPosition` - Move chart/image
45. `sheets_deleteEmbeddedObject` - Delete chart/image
46. `sheets_textToColumns` - Split text
47. `sheets_pasteData` - Paste TSV data
48. `sheets_randomizeRange` - Randomize rows
49. `sheets_trimWhitespace` - Trim whitespace
50. `sheets_deleteDuplicates` - Remove duplicates

**Impact**: Specialized use cases
**Estimated Effort**: 2-3 days

---

## Testing Strategy

For each new thin-layer tool:

1. **Unit Test** - Mock Google API, validate request format
2. **Integration Test** - Real API call with OAuth document
3. **Integration Test** - Real API call with public document
4. **Error Handling Test** - Invalid parameters
5. **MCP Protocol Test** - Response format validation

---

## API Constraints & Gotchas

### General Constraints
- Batch requests processed atomically (all or nothing)
- Field masks required for most update operations
- Grid coordinates are 0-indexed (unlike Docs which is 1-indexed)
- Ranges can be A1 notation OR GridRange objects

### Specific Constraints
- **Cell Updates**: Max 5 million cells per batchUpdate
- **Named Ranges**: Names must be unique per spreadsheet
- **Protected Ranges**: Can overlap but priority matters
- **Data Validation**: Strict mode rejects invalid input, non-strict warns
- **Conditional Formatting**: Max 500 rules per sheet

### A1 Notation
- `Sheet1!A1` - Single cell
- `Sheet1!A1:B2` - Range
- `Sheet1!A:A` - Entire column
- `Sheet1!1:1` - Entire row
- `Sheet1` - Entire sheet

### GridRange vs A1 Notation
- **GridRange**: 0-indexed, end-exclusive, precise
- **A1 Notation**: Human-readable, easier for simple ranges

---

## Maintenance Notes

**Update Schedule**: Review quarterly for new API features

**Next Review**: 2025-04-18

**Changelog**:
- 2025-01-18: Initial audit, v4 API, ~50 request types documented

---

## Implementation Plan Summary

**Total Tools to Implement**: 50+
**Current Status**: 9 high-level tools (18% coverage)
**Target**: 100% thin-layer API coverage

**Phases**:
1. Core Data Operations (10 tools) - 2-3 days
2. Row/Column/Range Operations (10 tools) - 2-3 days
3. Advanced Formatting & Validation (12 tools) - 3-4 days
4. Named Ranges, Sorting & Filtering (9 tools) - 2-3 days
5. Charts & Advanced Operations (9 tools) - 2-3 days

**Total Estimated Effort**: 11-16 days

**Dependencies**:
- Follow design principles from `DESIGN_PRINCIPLES.md`
- Use API mapping strategy from `API_MAPPING_STRATEGY.md`
- Reuse test framework from Docs implementation

---

## Related Documentation

- **Official API**: https://developers.google.com/sheets/api/reference/rest
- **Design Principles**: `design/DESIGN_PRINCIPLES.md`
- **API Mapping Strategy**: `design/API_MAPPING_STRATEGY.md`
- **Docs API Reference**: `design/api_reference_docs.md` (reference implementation)
