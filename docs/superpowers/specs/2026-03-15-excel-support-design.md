# Excel Support for OpenCode — Design Specification

**Date:** 2026-03-15 (revised 2026-03-16)
**Status:** Draft (reviewed)
**Author:** AI-assisted design session

---

## 1. Overview

Add native Excel read/write capabilities to OpenCode via two new built-in tools (`excel_read` and `excel_write`) using the SheetJS CE library. The first release (V1) focuses on **data and formulas** — styling, charts, and pivot tables are out of scope.

### Goals

- Read spreadsheet files (`.xlsx`, `.xls`, `.xlsb`, `.ods`, `.csv`, `.numbers`, and 30+ other formats) into structured text the LLM can reason about
- Write `.xlsx` files from structured data the LLM constructs
- Handle complex multi-row merged-cell headers common in enterprise spreadsheets
- Support the full transform pipeline: Read Excel → understand/transform → Write Excel
- Scale gracefully from small tables to 5,000+ row datasets via a tiered strategy

### Non-Goals (V1)

- Styling (fonts, colors, borders, conditional formatting)
- Charts, images, pivot tables
- In-place cell editing (surgical updates to existing files)
- VBA macros
- Multi-language user-facing strings (follows existing CLI English-only pattern)

---

## 2. User Profile & Typical Use Case

| Parameter | Value |
|-----------|-------|
| Columns | 15–25 |
| Rows | Up to 5,000 |
| Header region | Top 1–10 rows, merged cells for titles/topics |
| Real column definitions | Last row of the header region |
| Content | Mixed: names, numbers, dates, short text, formulas |
| Formats used | `.xlsx` (Excel 2019–2025, Excel 365), occasionally `.xls`, `.csv` |

---

## 3. Library Choice: SheetJS CE

**Package:** `xlsx` (npm), version `^0.20.3`
**Size:** ~1.2 MB, pure JavaScript, no native dependencies
**License:** Apache-2.0

### Why SheetJS CE

| Criterion | SheetJS CE | ExcelJS |
|-----------|-----------|---------|
| Read formats | 40+ (`.xls`, `.xlsx`, `.xlsb`, `.ods`, `.numbers`, etc.) | `.xlsx` only |
| Write formats | 20+ (`.xlsx`, `.xls`, `.xlsb`, `.ods`, `.csv`) | `.xlsx`, `.csv` |
| Merged cell support | ✅ Full (`ws['!merges']`) | ✅ Full |
| Formula preservation | ✅ Read/write `cell.f` (no evaluation) | ✅ Read/write |
| Styling in CE | ❌ Data only | ✅ Full |
| Bun compatibility | ✅ Pure JS | ⚠️ 2–5× slower than Node |
| Maintenance | Active (v0.20.3, Jan 2026) | Declining |

SheetJS CE is the right choice because V1 is data-focused and needs broad format support. Styling can be added later via ExcelJS (MIT, full styling support) — SheetJS Pro is intentionally deferred to the lowest-priority version tier (see Section 11).

### Cell Type Mapping

SheetJS uses 6 cell types (`cell.t`):

| `cell.t` | Type | JS value in `cell.v` |
|----------|------|----------------------|
| `"b"` | Boolean | `boolean` |
| `"n"` | Number | `number` (includes dates by default) |
| `"s"` | String | `string` |
| `"d"` | Date | `Date` object (with `cellDates: true`) |
| `"e"` | Error | `number` (error code) |
| `"z"` | Stub | none (blank cell with metadata, requires `sheetStubs: true`) |

Formulas are an overlay: `cell.f` stores the formula string, `cell.t`/`cell.v` store the cached result.

### Merged Cell Representation

`ws['!merges']` is an array of range objects. Each range has `s` (start, top-left) and `e` (end, bottom-right), both zero-indexed. The top-left cell holds the value; covered cells are empty by default.

---

## 4. Tool Design: `ExcelReadTool`

### 4.1 Tool Identity

| Property | Value |
|----------|-------|
| Tool ID | `excel_read` |
| Permission type | `"read"` (same as ReadTool) |
| File | `packages/opencode/src/tool/excel-read.ts` |
| Description file | `packages/opencode/src/tool/excel-read.txt` |

### 4.2 Parameters (Zod Schema)

```typescript
z.object({
  filePath: z.string()
    .describe("Absolute path to the spreadsheet file"),

  sheet: z.string().optional()
    .describe("Sheet name to read. If omitted, reads all sheets"),

  offset: z.number().optional()
    .describe("1-indexed data row to start from (default: 1). "
      + "Header rows are always included regardless of offset"),

  limit: z.number().optional()
    .describe("Max data rows to return. Default is model-aware "
      + "(see Section 4.5). Use 0 for schema-only mode"),

  columns: z.array(z.union([z.string(), z.number()])).optional()
    .describe("Column names (strings) or 0-based column indices (numbers) "
      + "to include. If omitted, includes all columns"),

  format: z.enum(["markdown", "csv", "json"]).optional()
    .describe("Output format for data rows (default: markdown)"),
})
```

### 4.3 Supported Input Formats

**Read AND write:** `.xlsx`, `.xlsm`, `.xlsb`, `.xls` (BIFF2–8), `.csv`, `.ods`, `.numbers`, `.fods`, `.dif`, `.sylk`, `.dbf`, `.wk1`, `.wk3`, `.html`, `.rtf`, `.eth`

**Read only:** `.et`, `.wks`, `.wk2`, `.wk4`, `.123`, `.wq1`, `.wq2`, `.wb1`, `.wb2`, `.wb3`, `.qpw`, `.xlr`

### 4.4 Execution Flow

```
excel_read(filePath, sheet?, offset?, limit?, columns?, format?)
│
├─ 1. RESOLVE PATH
│     Resolve relative → absolute via Instance.directory
│     assertExternalDirectory() for sandbox check
│
├─ 2. PERMISSION CHECK
│     ctx.ask({
│       permission: "read",
│       patterns: [filePath],   // absolute path, matching ReadTool's pattern
│       always: ["*"],
│       metadata: {},
│     })
│
├─ 3. PARSE FILE
│     Check file size: if > 100 MB, throw:
│       "Error: File is {size}MB. Maximum supported size is 100MB.
│        For very large files, consider splitting or using a script."
│     const buffer = await Bun.file(filePath).arrayBuffer()
│     const wb = XLSX.read(buffer, {
│       cellFormula: true,    // preserve formulas
│       cellDates: true,      // parse dates as Date objects
│       sheetStubs: true,     // detect styled-but-empty cells for merge detection
│     })
│
├─ 4. DETECT HEADER REGION (per sheet) — see Section 4.6
│     Analyze top 10 rows + merged cell regions
│     Identify: titleRows, headerDefinitionRow, dataStartRow
│
├─ 5. BUILD SCHEMA SUMMARY (always emitted)
│     For each sheet:
│       - Sheet name, total data rows, total columns
│       - Title/topic from merged cells in header region
│       - Column definitions from headerDefinitionRow:
│         column name, detected type, sample values (first 3 non-empty)
│       - Merged cell annotations
│
├─ 6. EMIT DATA ROWS
│     ├─ If limit=0 → schema only, no data rows
│     ├─ Apply column pruning if `columns` specified
│     ├─ Apply offset (relative to dataStartRow, 1-indexed)
│     ├─ Apply limit (model-aware default, see Section 4.5)
│     ├─ Format as markdown/csv/json per `format` param
│     └─ Append advisory messages:
│         - Pagination hint if not all rows shown
│         - Code generation advisory if total rows ≥ 500
│         - Column count warning if columns ≥ 30
│
├─ 7. RECORD FILE READ TIME
│     FileTime.read(ctx.sessionID, filePath)
│     (Required: without this, a subsequent excel_write to the same file
│      would fail FileTime.assert() with "must read before overwriting")
│
└─ 8. RETURN
      { title, output, metadata }
```

**Notes on patterns NOT carried over from ReadTool:**
- **No `InstructionPrompt.resolve()`** — instruction files (`.opencode`) are for code files, not spreadsheets
- **No `LSP.touchFile()`** — no LSP server understands spreadsheet files

### 4.5 Model-Aware Default Row Limit

Different LLMs have different context windows. The default `limit` adapts based on both model context size **and** the actual column count of the parsed sheet:

```typescript
const DEFAULT_ROW_LIMIT = 100  // fallback for unknown models

function defaultRowLimit(
  numCols: number,
  model?: { limit?: { context?: number } },
): number {
  const context = model?.limit?.context
  if (!context || context === 0) return DEFAULT_ROW_LIMIT

  // Tokens per row depends on actual column count:
  //   chars per row = (11 × numCols + 2)
  //   tokens per row = chars / 3.5
  const tokensPerRow = (11 * numCols + 2) / 3.5

  // Budget: ~15% of context window for Excel data
  const budget = context * 0.15
  const estimated = Math.floor(budget / tokensPerRow)

  // Clamp: minimum 20 rows, maximum 1000 rows
  return Math.max(20, Math.min(estimated, 1000))
}
```

**Note:** The default is computed **after parsing** the file, since `numCols` is only known at that point. If the user provides an explicit `limit` parameter, it always takes precedence.

Resulting defaults for common models (at 20 columns, ~63.4 tokens/row):

| Model | Context | 15% Budget | Default Rows |
|-------|---------|------------|--------------|
| Small/local (8K) | 8,000 | 1,200 tokens | 20 (clamped min) |
| Medium (32K) | 32,000 | 4,800 tokens | 75 |
| GPT-4o (128K) | 128,000 | 19,200 tokens | 302 |
| Claude Sonnet (200K) | 200,000 | 30,000 tokens | 473 |
| Gemini Pro (1M) | 1,000,000 | 150,000 tokens | 1,000 (clamped max) |

At 25 columns (~79.1 tokens/row), defaults are ~20% lower: GPT-4o → 242 rows, Claude → 378 rows.

The model's `limit.context` is available via the `models.dev` catalog, already integrated into OpenCode's provider system. The `limit` parameter always overrides this default.

### 4.6 Merged Cell Header Detection Algorithm

Enterprise spreadsheets commonly have a complex header region:

```
Row 1: [     "2025 Annual Sales Report"     ]  ← merged across all columns (title)
Row 2: [  "Region: East"  ][  "Period: Q1-Q4"  ]  ← merged cells (metadata)
Row 3: (empty row)
Row 4: [ "Product" ][ "Category" ][ ... column headers ... ]  ← real column definitions
Row 5: [ "Widget A" ][ "Electronics" ][ ... data ... ]  ← first data row
```

**Algorithm:**

```typescript
function detectHeaderRegion(ws: XLSX.WorkSheet): {
  titleRows: Array<{ row: number; value: string; mergeRange: string }>
  subHeaders: Array<{ row: number; value: string; mergeRange: string; columns: [number, number] }>
  headerDefinitionRow: number   // 0-indexed
  dataStartRow: number          // 0-indexed
} {
  const merges = ws["!merges"] || []
  const range = XLSX.utils.decode_range(ws["!ref"]!)
  const totalCols = range.e.c - range.s.c + 1

  // Step 1: Scan top 10 rows for merge patterns
  const SCAN_LIMIT = Math.min(10, range.e.r + 1)
  const titleRows: Array<{ row: number; value: string; mergeRange: string }> = []
  const subHeaders: Array<{ row: number; value: string; mergeRange: string; columns: [number, number] }> = []

  for (const merge of merges) {
    if (merge.s.r >= SCAN_LIMIT) continue
    const mergeWidth = merge.e.c - merge.s.c + 1
    const addr = XLSX.utils.encode_cell(merge.s)
    const cell = ws[addr]
    if (!cell || cell.v === undefined) continue

    if (mergeWidth > totalCols * 0.5) {
      // "Title rows" — merges spanning >50% of columns (full-width titles)
      titleRows.push({
        row: merge.s.r,
        value: String(cell.v),
        mergeRange: XLSX.utils.encode_range(merge),
      })
    } else if (mergeWidth >= 2) {
      // "Sub-headers" — merges spanning 2+ columns but <50%
      // These represent column groupings (e.g., "Financial" spanning Revenue/Cost/Margin)
      subHeaders.push({
        row: merge.s.r,
        value: String(cell.v),
        mergeRange: XLSX.utils.encode_range(merge),
        columns: [merge.s.c, merge.e.c],
      })
    }
  }

  // Step 2: Find the last row involved in any header-region merge
  let maxHeaderMergeRow = -1
  for (const merge of merges) {
    if (merge.s.r < SCAN_LIMIT) {
      maxHeaderMergeRow = Math.max(maxHeaderMergeRow, merge.e.r)
    }
  }

  // Step 3: Find the "definition row" — the last row in the header region
  // that has the most non-empty cells (the real column headers)
  let headerDefinitionRow = 0
  let maxFilledCells = 0

  // If no merges found, search all top rows; otherwise search near the merge boundary
  const searchStart = maxHeaderMergeRow === -1
    ? 0
    : Math.max(0, maxHeaderMergeRow - 2)
  const searchEnd = maxHeaderMergeRow === -1
    ? SCAN_LIMIT
    : Math.min(maxHeaderMergeRow + 2, SCAN_LIMIT)

  for (let r = searchStart; r <= searchEnd; r++) {
    let filled = 0
    for (let c = range.s.c; c <= range.e.c; c++) {
      const addr = XLSX.utils.encode_cell({ r, c })
      const cell = ws[addr]
      if (cell && cell.v !== undefined && cell.v !== "") {
        filled++
      }
    }
    if (filled > maxFilledCells) {
      maxFilledCells = filled
      headerDefinitionRow = r
    }
  }

  // Step 4: Data starts on the row after the header definition
  const dataStartRow = headerDefinitionRow + 1

  return { titleRows, subHeaders, headerDefinitionRow, dataStartRow }
}
```

**Fallback behavior:**
- If no merges exist in top 10 rows → scan all rows 0–9 for the most-filled row as `headerDefinitionRow`, `dataStartRow = headerDefinitionRow + 1`
- If `maxHeaderMergeRow` is -1 (no merges), `searchStart = 0` and `searchEnd = SCAN_LIMIT` (scan all top rows)
- If all top 10 rows are empty → `headerDefinitionRow = 0`, `dataStartRow = 0`
- The user can override by specifying `offset` explicitly

**Sub-header display in schema summary:**
Sub-headers are shown as column groupings to preserve enterprise header structure:
```
  Column groups:
    "Financial" (columns D–F): UnitPrice, Cost, Margin
    "Operations" (columns G–I): Units, Waste, Yield
```

### 4.7 Output Format

```xml
<excel>
<path>/home/user/data/sales-report.xlsx</path>

<summary>
Sheet "Sales": 4,200 data rows × 20 columns
  Title: "2025 Annual Sales Report" (A1:T1)
  Metadata: "Region: East" (A2:J2), "Period: Q1-Q4" (K2:T2)
  Header definition row: 4
  Data starts at row: 5

  | # | Column       | Type    | Sample Values                   |
  |---|--------------|---------|--------------------------------|
  | 1 | ProductID    | number  | 1001, 1002, 1003               |
  | 2 | ProductName  | string  | "Widget A", "Gadget B"         |
  | 3 | Category     | string  | "Electronics", "Hardware"      |
  | 4 | UnitPrice    | number  | 29.99, 149.50, 8.75            |
  | 5 | Quantity     | number  | 100, 50, 2000                  |
  | 6 | Revenue      | formula | =D5*E5, =D6*E6                 |
  | 7 | OrderDate    | date    | 2025-01-15, 2025-02-20         |
  ...
  | 20 | Notes       | string  | "Rush order", "Backordered"    |

Sheet "Returns": 342 data rows × 12 columns
  ...
</summary>

<sheet name="Sales">
<data format="markdown" rows="1-100" total="4200">
| ProductID | ProductName | Category    | UnitPrice | Quantity | Revenue  | OrderDate  | ... |
|-----------|-------------|-------------|-----------|----------|----------|------------|-----|
| 1001      | Widget A    | Electronics | 29.99     | 100      | =D5*E5   | 2025-01-15 | ... |
| 1002      | Gadget B    | Hardware    | 149.50    | 50       | =D6*E6   | 2025-02-20 | ... |
...
</data>
(Showing data rows 1-100 of 4,200. Use offset=101 to continue reading.)
(This sheet has 4,200 rows. For large-scale analysis, consider writing a script
 with BashTool using the xlsx package rather than reading all rows into context.)
</sheet>
</excel>
```

### 4.8 Return Structure

**Important:** Setting `metadata.truncated` opts out of the framework's auto-truncation in `Tool.define()` (see `tool.ts`). This is intentional — ExcelReadTool manages its own output size via the model-aware row limit system. Without this flag, the framework would apply a second layer of truncation (2000 lines / 50 KB cap) which would conflict with the tool's own pagination.

```typescript
{
  title: string,           // relative path from worktree, e.g. "data/sales.xlsx"
  output: string,          // the XML-wrapped content for LLM
  metadata: {
    preview: string,       // first 10 data rows as markdown (for UI)
    truncated: boolean,    // true if not all rows shown
    sheets: Array<{
      name: string,
      rows: number,        // data rows (excluding header region)
      columns: number,
      headerRows: number,  // number of rows in header region
    }>,
    totalRows: number,     // sum of data rows across all sheets
  },
}
```

### 4.9 Limitations

| Limitation | Reason | Mitigation |
|------------|--------|------------|
| No chart data extraction | SheetJS CE doesn't parse charts | V3: ExcelJS or chart image extraction |
| No conditional formatting rules | V1 is data-focused | V3: add `--show-formatting` flag |
| Merged cells in data region displayed as empty | SheetJS stores value in top-left only | Fill merged cells during parse (propagate value) |
| Large datasets (5K+ rows) degrade LLM reasoning | Fundamental LLM context/attention limitation | 4-tier strategy: schema → paginate → filter → code-gen |
| Wide tables (30+ cols) are token-expensive | ~10K tokens for 100×30 | `columns` param for pruning; warn at 30+ cols |
| Date ambiguity | Excel stores dates as serial numbers | Use `cellDates: true`; show ISO 8601 format |
| Password-protected files | SheetJS CE has limited password support | Clear error: "File is password-protected" |
| Header detection heuristic may fail | Unusual layouts may not match the algorithm | User can override with explicit `offset` |
| No formula evaluation | SheetJS CE reads formulas but doesn't compute | Show formula string; note "values computed when opened in Excel" |

---

## 5. Tool Design: `ExcelWriteTool`

### 5.1 Tool Identity

| Property | Value |
|----------|-------|
| Tool ID | `excel_write` |
| Permission type | `"edit"` (same as WriteTool) |
| File | `packages/opencode/src/tool/excel-write.ts` |
| Description file | `packages/opencode/src/tool/excel-write.txt` |

### 5.2 Parameters (Zod Schema)

```typescript
z.object({
  filePath: z.string()
    .describe("Absolute output path. Supported extensions: .xlsx, .xls, .csv, .ods. "
      + "If no extension or unsupported extension, defaults to .xlsx"),

  sheets: z.array(z.object({
    name: z.string()
      .describe("Sheet name"),

    headers: z.array(z.string())
      .describe("Column header names"),

    rows: z.array(z.array(z.union([
      z.string(),
      z.number(),
      z.boolean(),
      z.null(),
    ]))).describe(
      "2D array of cell values. Conventions: "
      + "strings starting with '=' are formulas (e.g. '=SUM(A1:A10)'); "
      + "strings matching YYYY-MM-DD are written as Excel date cells; "
      + "null produces an empty cell."
    ),

    columnWidths: z.array(z.number()).optional()
      .describe("Column widths in characters (optional)"),
  })).describe("Array of sheets to create"),
})
```

**Cell type conventions (4 Zod types cover all 6 Excel types):**

| Zod Type | Input Example | Excel Cell Result |
|----------|---------------|-------------------|
| `z.string()` | `"Hello"` | String cell (`t:"s"`) |
| `z.string()` | `"=SUM(A1:A10)"` | Formula cell (`f:"SUM(A1:A10)"`) |
| `z.string()` | `"2025-01-15"` | Date cell (`t:"d"`) — validated via `Date.parse()` |
| `z.string()` | `"'2025-01-15"` | String cell (`t:"s"`, value `"2025-01-15"`) — single-quote prefix escapes date detection |
| `z.number()` | `42`, `3.14` | Number cell (`t:"n"`) |
| `z.boolean()` | `true`, `false` | Boolean cell (`t:"b"`) |
| `z.null()` | `null` | Empty cell |

### 5.3 Execution Flow

```
excel_write({ filePath, sheets })
│
├─ 1. VALIDATE & NORMALIZE PATH
│     Resolve relative → absolute via Instance.directory
│     If no extension → append ".xlsx"
│     If unsupported extension → change to ".xlsx", emit warning
│     Infer bookType from final extension:
│       .xlsx → "xlsx", .xls → "biff8", .csv → "csv", .ods → "ods"
│     assertExternalDirectory() for sandbox check
│
├─ 1b. OVERWRITE PROTECTION (if file already exists)
│     V1 does not support in-place editing. To prevent accidental data loss,
│     if the target file already exists, automatically redirect to a new
│     timestamped path:
│       report.xlsx → report_2026-03-16_143052.xlsx
│     Format: {stem}_{YYYY-MM-DD_HHmmss}{ext}
│     Emit advisory: "File 'report.xlsx' already exists. Writing to
│       'report_2026-03-16_143052.xlsx' to preserve the original.
│       Direct overwrite will be supported when in-place editing ships (V2)."
│     The LLM-provided filePath is treated as the *intended* path;
│     the actual written path is returned in the response and metadata.
│
├─ 2. BUILD WORKBOOK
│     const wb = XLSX.utils.book_new()
│     For each sheet definition:
│       ├─ Build AOA (array-of-arrays): [headers, ...rows]
│       ├─ const ws = XLSX.utils.aoa_to_sheet(aoa)
│       ├─ Post-process cells:
│       │   ├─ Strings starting with "=" → set cell.f, clear cell.v
│       │   ├─ Strings matching ISO 8601 date → convert to Date:
│       │   │     Regex: /^\d{4}-\d{2}-\d{2}$/
│       │   │     MUST validate with Date.parse() — reject "9999-99-99" etc.
│       │   │     Escape hatch: prefix with ' (single quote) to force string
│       │   │     e.g., "'2025-01-15" → written as literal string "2025-01-15"
│       │   └─ Apply columnWidths to ws['!cols'] if provided
│       └─ XLSX.utils.book_append_sheet(wb, ws, name)
│
├─ 3. PERMISSION CHECK
│     Generate preview: sheet names, row counts, first 3 rows per sheet
│     If file exists: note overwrite
│     ctx.ask({
│       permission: "edit",
│       patterns: [relativePath],
│       always: ["*"],
│       metadata: { filepath, preview }
│     })
│
├─ 4. WRITE FILE (always a new file after step 1b)
│     const buffer = XLSX.write(wb, { type: "buffer", bookType })
│     await Bun.write(actualPath, buffer)
│     // actualPath = filePath if new file, or timestamped path if original existed
│
├─ 5. PUBLISH EVENTS
│     Bus.publish(File.Event.Edited, { file: actualPath })
│     Bus.publish(FileWatcher.Event.Updated, {
│       file: actualPath,
│       event: "add",   // always "add" — V1 never overwrites
│     })
│     FileTime.read(sessionID, actualPath)
│
└─ 6. RETURN
      {
        title: "sales-report_2026-03-16_143052.xlsx",
        output: "Wrote Excel file successfully.\n"
          + "  Path: sales-report_2026-03-16_143052.xlsx\n"
          + "  (Original 'sales-report.xlsx' preserved)\n"
          + "  Sheet 'Sales': 4,200 rows × 20 columns\n"
          + "  Sheet 'Summary': 5 rows × 3 columns\n"
          + "  Formulas will be calculated when opened in Excel.",
        metadata: {
          filepath: actualPath,       // actual written path
          requestedPath: filePath,    // LLM's original requested path
          redirected: exists,         // true if path was timestamped
          sheets: [...],
        }
      }
```

### 5.4 File Extension & Overwrite Handling

**Extension normalization:**

| Input Path | Final Path | Action |
|------------|-----------|--------|
| `report.xlsx` | `report.xlsx` | No change (if file doesn't exist) |
| `report.csv` | `report.csv` | No change (if file doesn't exist) |
| `report` | `report.xlsx` | Appended `.xlsx` |
| `report.txt` | `report.xlsx` | Changed to `.xlsx` + warning |
| `report.pdf` | `report.xlsx` | Changed to `.xlsx` + warning |
| `report.xlsm` | `report.xlsx` | Changed to `.xlsx` + warning about macro loss |

**Overwrite protection (V1):**

If the resolved path already exists, the filename is automatically suffixed with a timestamp to prevent data loss:

| Input Path | File Exists? | Actual Written Path | Advisory |
|------------|:---:|-----------|---------|
| `report.xlsx` | No | `report.xlsx` | (none) |
| `report.xlsx` | Yes | `report_2026-03-16_143052.xlsx` | "File 'report.xlsx' already exists. Writing to 'report_2026-03-16_143052.xlsx' to preserve the original." |
| `data.csv` | Yes | `data_2026-03-16_143052.csv` | Same pattern |

**Timestamp format:** `{stem}_{YYYY-MM-DD_HHmmss}{ext}` using local time.

**Rationale:** Excel files are binary — unlike text files, there is no `git diff` safety net, no undo, and no way to recover lost data from a careless overwrite. Until V2 ships in-place editing with proper merge/diff semantics, V1 always writes to a new file when the target exists. This is a deliberate divergence from `WriteTool`'s overwrite behavior because the risk profile is fundamentally different for binary files.

Warning message (extension): `"Note: Unsupported extension '.txt' was changed to '.xlsx'. Supported: .xlsx, .xls, .csv, .ods"`
Warning message (`.xlsm`): `"Note: Extension '.xlsm' was changed to '.xlsx'. VBA macros cannot be preserved by SheetJS CE. Data and formulas are retained."`

### 5.5 Concurrent Write Safety

Consider wrapping the write operation with `FileTime.withLock(filePath, async () => { ... })` to serialize concurrent writes. While V1 never overwrites existing files (timestamps guarantee unique filenames), there is a theoretical race condition if two write calls for the same new file execute within the same second. The lock prevents this. `edit.ts` already uses this pattern, and Excel writes can be slower than text writes (large binary serialization).

### 5.6 Write Scope

**V1: New file creation only.** No overwriting, no in-place cell editing.

When the target file already exists, V1 automatically redirects to a timestamped filename (see Section 5.4). The original file is never modified. This is a safety-first approach for binary files that cannot be diffed or version-controlled like text.

**V2 candidate: `ExcelEditTool`** for surgical operations (add/remove rows, update specific cells, add sheets to existing workbook). Once V2 ships with proper in-place editing semantics, the overwrite protection can be relaxed to allow direct overwrites with user confirmation, matching `WriteTool`'s behavior.

### 5.7 Limitations

| Limitation | Reason | Mitigation |
|------------|--------|------------|
| No styling (fonts, colors, borders) | SheetJS CE limitation; V1 data-focused | V3: ExcelJS (MIT) for write path |
| No charts or images | SheetJS CE limitation | V3: ExcelJS or user adds in Excel after opening |
| No data validation rules | V1 scope cut | V4: SheetJS Pro |
| No pivot tables | SheetJS CE limitation | User creates in Excel |
| Formula values not computed | SheetJS doesn't evaluate formulas | Advisory: "Formulas calculated when opened in Excel" |
| Max ~1M rows per sheet | XLSX format limit (1,048,576 rows) | Validate and error clearly |
| No diff preview for binary | Can't show unified text diff for `.xlsx` | Show structured preview in permission dialog |
| No direct overwrite (V1) | Binary files have no diff/undo safety net | Auto-redirect to timestamped filename; V2 will support overwrite with in-place editing |
| Full overwrite only | V1 scope — no surgical edits | V2: ExcelEditTool |

---

## 6. Integration with Existing Code

### 6.1 ReadTool Redirect for Spreadsheet Files

**`packages/opencode/src/file/index.ts`** — **Do NOT modify `binaryExtensions`.** The `File.read()` function is used by the Web UI's file browser, which has no need to parse Excel files. Spreadsheet extensions remain binary in that context.

**`packages/opencode/src/tool/read.ts`** — Add a spreadsheet extension check **before** `isBinaryFile()`:
- `.xls`, `.xlsx`, `.xlsb`, `.xlsm`, `.ods`, `.numbers` are NOT in `isBinaryFile()`'s switch statement today (they fall through to the byte-sampling heuristic), so there is nothing to "remove"
- Add a new early-return check for these extensions that returns a **redirect message** as a successful tool result:
```
"This is a spreadsheet file. Use the excel_read tool to read it."
```
This teaches the LLM to use the correct tool without failing. The file is NOT read as text — the redirect is returned immediately upon extension detection.

### 6.2 Tool Registration

**`packages/opencode/src/tool/registry.ts`** — Add after WriteTool:

```typescript
import { ExcelReadTool } from "./excel-read"
import { ExcelWriteTool } from "./excel-write"

// In all():
..., WriteTool, ExcelReadTool, ExcelWriteTool, TaskTool, ...
```

### 6.3 Permission System

Both tools use existing permission types — no new types needed:

| Tool | Permission | `always` Pattern | Behavior |
|------|-----------|-----------------|----------|
| `excel_read` | `"read"` | `["*"]` | Same as ReadTool |
| `excel_write` | `"edit"` | `["*"]` | Same as WriteTool |

Both also call `assertExternalDirectory()` for paths outside the project, triggering `"external_directory"` permission.

**Required change in `permission/next.ts`:** Add `"excel_write"` to the `EDIT_TOOLS` array so that config rules targeting `edit` permission (e.g., `{ edit: "deny" }`) also apply to `excel_write`:
```typescript
const EDIT_TOOLS = ["edit", "write", "patch", "multiedit", "excel_write"]
```
Without this change, a config rule like `{ edit: "deny" }` would block `write` and `edit` but would **not** block `excel_write`.

The 3-layer permission evaluation applies:
1. **Config ruleset** — from `opencode.jsonc` (global/project/per-agent)
2. **Session-scoped approvals** — "Always Allow" clicks
3. **Default** — `"ask"` (prompt user)

### 6.4 New File Structure

```
packages/opencode/src/tool/
├── excel-read.ts          # ExcelReadTool implementation
├── excel-read.txt         # LLM-facing description
├── excel-write.ts         # ExcelWriteTool implementation
├── excel-write.txt        # LLM-facing description
└── excel-util.ts          # Shared: header detection, type detection, formatting
```

### 6.5 Dependency

Add to `packages/opencode/package.json`:
```json
{
  "xlsx": "^0.20.3"
}
```

Size: ~1.2 MB, pure JavaScript, no native bindings, Bun compatible.

### 6.6 UI Integration (Desktop & Web App)

**Current state:** The Desktop and Web UI have **no spreadsheet viewing capability**. When `excel_read` returns a result, the UI falls through to `GenericTool` (shows only the tool name, not the output). In the side panel, `.xlsx` files are classified as binary and show a "binary file, cannot display" placeholder.

**Key UI infrastructure already available:**

| Component | Location | Relevance |
|-----------|----------|-----------|
| `ToolRegistry.register()` | `packages/ui/src/components/message-part.tsx` | Custom tool rendering — `edit`, `bash`, `read` use it, but `excel_read`/`excel_write` are **not registered** |
| `Markdown` component (GFM tables) | `packages/ui/src/components/markdown.tsx` | Can render markdown tables natively via `marked` — **zero new deps needed** |
| `FileMedia` component | `packages/ui/src/components/file-media.tsx` | Handles images, audio, SVG — but **not spreadsheets** |
| Side panel file tabs | `packages/app/src/pages/session/session-side-panel.tsx` | `FileTabContent` renders opened files — binary fallback for `.xlsx` |
| `BasicTool` wrapper | `packages/ui/src/components/basic-tool.tsx` | Collapsible tool display used by most tools |

**V1: Register tool UI components (ship with V1, no new dependencies):**

Register `excel_read` and `excel_write` in the UI `ToolRegistry` to render tool output as markdown tables via the existing `Markdown` component:

```typescript
// In packages/ui/src/components/message-part.tsx (or a new excel-tool-ui.tsx)

ToolRegistry.register({
  name: "excel_read",
  render: (props) => (
    <BasicTool {...props}>
      <Markdown text={props.output} />
    </BasicTool>
  ),
})

ToolRegistry.register({
  name: "excel_write",
  render: (props) => (
    <BasicTool {...props}>
      <Markdown text={props.output} />
    </BasicTool>
  ),
})
```

This immediately makes Excel tool results visible in the chat as styled HTML tables — the `ExcelReadTool`'s markdown table output renders through the existing `Markdown` pipeline. No new npm dependencies required.

**V1.2: Side panel spreadsheet viewer (see Section 11):**

A richer experience for the side panel file viewer requires:

1. Add a `"spreadsheet"` media kind in `FileMedia` (`packages/ui/src/components/file-media.tsx`) for `.xlsx`, `.xls`, `.csv`, `.ods` extensions
2. Add a server endpoint (or extend the existing file read API) that returns pre-parsed sheet data as JSON
3. Create a `SpreadsheetViewer` component using **TanStack Table v8** (~14KB, MIT, headless) + existing TailwindCSS — supports sheet tab switching, column sorting, virtual scrolling
4. Wire into `FileTabContent` as an alternative to the binary placeholder

TanStack Table v8 is recommended over heavier alternatives (AG Grid, Handsontable) because it is headless (UI-agnostic), tiny (~14KB), MIT-licensed, and aligns with the codebase's SolidJS + TailwindCSS patterns. Full-featured spreadsheet UIs (Luckysheet, fortune-sheet) are overkill for a read-only preview.

**Note:** The Tauri desktop app renders all content via a platform-native WebView (Chromium/WebKit), so any web-based library works identically in desktop and web contexts.

---

## 7. The 4-Tier Large File Strategy

This is the core design for handling context window limitations with large spreadsheets.

### Tier Overview

```
User: "Analyze this 5,000-row sales spreadsheet"
│
├─ Tier 1 (Schema): Agent calls excel_read("sales.xlsx", limit=0)
│   → Schema summary only (~300-500 tokens)
│   → Agent understands structure without seeing data
│
├─ Tier 2 (Paginate): Agent calls excel_read("sales.xlsx")
│   → Schema + first N rows (model-aware default)
│   → Agent explores data page by page via offset/limit
│
├─ Tier 3 (Filter): Agent calls excel_read(..., columns=["Name","Revenue"])
│   → Column pruning reduces tokens per row
│   → Focused on relevant data only
│
└─ Tier 4 (Code Gen): Agent writes a script
    → BashTool("bun run analyze.ts")
    → Script uses SheetJS directly for aggregation/filtering
    → Only computed results enter context
```

### Token Budget Estimates (Recalculated for 15–25 Column Use Case)

**Formula:**
```
Characters ≈ (numRows + 2) × (11 × numCols + 2)
Tokens (data) ≈ Characters / 3.5
Tokens (schema) ≈ 20 × numCols
Total Tokens ≈ Tokens (data) + Tokens (schema)
```

Where: 11 = avg cell content (8 chars) + markdown overhead (3 chars per cell), 3.5 = chars-per-token ratio for markdown tables, 20 = tokens per column in schema summary (column name + type + sample values).

**For 20 columns (midpoint of 15–25 range):**

Characters per row = (11 × 20 + 2) = 222. Header = 2 rows × 222 = 444.

| Rows | Characters | Tokens (data) | + Schema (~400) | Total |
|------|-----------|---------------|-----------------|-------|
| 50 | (52 × 222) = 11,544 | 3,298 | 400 | **~3,700** |
| 100 | (102 × 222) = 22,644 | 6,470 | 400 | **~6,900** |
| 200 | (202 × 222) = 44,844 | 12,813 | 400 | **~13,200** |
| 500 | (502 × 222) = 111,444 | 31,841 | 400 | **~32,200** |
| 1,000 | (1002 × 222) = 222,444 | 63,555 | 400 | **~64,000** |

**For 25 columns:**

Characters per row = (11 × 25 + 2) = 277. Header = 2 rows × 277 = 554.

| Rows | Characters | Tokens (data) | + Schema (~500) | Total |
|------|-----------|---------------|-----------------|-------|
| 100 | (102 × 277) = 28,254 | 8,073 | 500 | **~8,600** |
| 500 | (502 × 277) = 139,054 | 39,730 | 500 | **~40,200** |
| 1,000 | (1002 × 277) = 277,554 | 79,301 | 500 | **~79,800** |

**Implications for the default limit (using corrected formula from Section 4.5):**

At 20 columns, `tokensPerRow ≈ (11×20+2)/3.5 ≈ 63.4`:

| Model | Context | 15% Budget | Default Rows (20 cols) | % Context Used |
|-------|---------|------------|----------------------|----------------|
| GPT-4o (128K) | 128,000 | 19,200 | ~302 | ~15% |
| Claude Sonnet (200K) | 200,000 | 30,000 | ~473 | ~15% |
| Gemini Pro (1M) | 1,000,000 | 150,000 | ~1,000 (capped) | ~6.3% |

### Pagination Model

Pagination shows one page per tool call. Previous pages remain in conversation history as prior tool results. The existing compaction system manages growing context.

For truly large analysis (500+ rows), the Tier 4 code-generation advisory guides the agent to write analysis scripts rather than paginating through thousands of rows.

### Advisory Messages

| Condition | Message |
|-----------|---------|
| Not all rows shown | `"Showing data rows {start}-{end} of {total}. Use offset={end+1} to continue reading."` |
| Total rows ≥ 500 | `"This sheet has {N} rows. For large-scale analysis (aggregation, filtering, statistics), consider writing a TypeScript script using the xlsx package and executing it with BashTool."` |
| Columns ≥ 30 | `"This sheet has {N} columns. Consider using the 'columns' parameter to select only relevant columns."` |

---

## 8. Error Handling

All error messages are in English, consistent with the existing CLI/core pattern.

| Scenario | Error Message |
|----------|--------------|
| File not found | `"Error: File not found: {filePath}"` |
| File too large | `"Error: File is {size}MB. Maximum supported size is 100MB."` |
| Password-protected | `"Error: This file is password-protected. SheetJS cannot open encrypted workbooks."` |
| Corrupt/unreadable | `"Error: Failed to parse spreadsheet: {sheetjs_error}. The file may be corrupted."` |
| Unsupported read format | `"Error: Unsupported file format '{ext}'. Supported: .xlsx, .xls, .xlsb, .xlsm, .csv, .ods, .numbers, and more."` |
| Sheet not found | `"Error: Sheet '{name}' not found. Available sheets: {list}"` |
| Column not found | `"Error: Column '{name}' not found. Available columns: {list}"` |
| Offset beyond data | `"Warning: Offset {N} exceeds total data rows ({total}). No data rows to show."` |
| Write: row count exceeds XLSX limit | `"Error: Sheet '{name}' has {N} rows, exceeding the XLSX limit of 1,048,576."` |
| Write: file exists (overwrite protection) | `"Note: File '{name}' already exists. Writing to '{name_YYYY-MM-DD_HHmmss}.xlsx' to preserve the original. Direct overwrite will be supported when in-place editing ships (V2)."` |
| Write: extension auto-corrected | `"Note: Unsupported extension '{ext}' was changed to '.xlsx'. Supported: .xlsx, .xls, .csv, .ods"` |
| Write: formulas advisory | `"Formulas will be calculated when the file is opened in Excel."` |

---

## 9. Internationalization

**V1: English-only** — consistent with all existing tools in `packages/opencode`.

The current architecture:

| Layer | i18n Status |
|-------|------------|
| Web App (`packages/app`) | ✅ 17 locales via `@solid-primitives/i18n` |
| UI Components (`packages/ui`) | ✅ 17 locales |
| CLI/Core (`packages/opencode`) | ❌ English-only |
| Tool descriptions (`.txt` files) | ❌ English-only |

All existing tool `.txt` descriptions, error messages, hints, and system prompts in `packages/opencode` are hardcoded English. Excel tools follow this pattern.

**Note:** The LLM naturally responds in the user's language regardless of English tool output. The user-facing Web App UI already has localization for 17 languages.

If a project-wide CLI i18n initiative is undertaken in the future, Excel tools would adopt it alongside all other tools.

---

## 10. Testing Strategy

### Test Location

`packages/opencode/test/tool/excel-read.test.ts` and `packages/opencode/test/tool/excel-write.test.ts`

Follows the existing pattern: tests in `packages/opencode/test/` mirror `src/` structure.

### Test Fixtures

Small fixture files in `packages/opencode/test/tool/fixture/` or generated in-memory using SheetJS in `beforeAll` blocks.

### Test Cases

**ExcelReadTool:**

| Category | Cases |
|----------|-------|
| Basic read | Single sheet, multi-sheet, empty sheet, single cell |
| Merged header detection | Title row merged across all cols, multi-row header, no merges (fallback) |
| Header edge cases | Non-string headers (numbers, dates, booleans), blank header cells, duplicate names |
| Pagination | Default model-aware limit, custom offset+limit, offset beyond end, limit=0 schema-only |
| Column filtering | Select by name, select by index, mixed, invalid column names, invalid indices |
| Output formats | Markdown (default), CSV, JSON |
| Schema summary | Type detection (string, number, date, boolean, formula), sample values |
| Formulas | Read formula strings, preserve `=SUM(A1:A10)` format, display cached values |
| Format support | `.xlsx`, `.xls`, `.csv`, `.ods` reading |
| Large files | In-memory generated 1K-row file, advisory message at 500+ rows, 30+ col warning |
| Error handling | File not found, corrupted file, password-protected, unsupported extension, sheet not found |
| Permissions | Verify `ctx.ask()` called with `permission: "read"` |
| ReadTool redirect | ReadTool on `.xlsx` returns helpful redirect message |

**ExcelWriteTool:**

| Category | Cases |
|----------|-------|
| Basic write | Single sheet, multi-sheet, verify file is valid XLSX |
| Cell types | String, number, boolean, null, formula (`=` prefix), date (ISO 8601) |
| Output formats | `.xlsx`, `.xls`, `.csv`, `.ods` |
| Extension handling | No extension → `.xlsx`, unsupported → `.xlsx` + warning |
| Overwrite protection | Existing file → timestamped filename, original preserved, advisory emitted, metadata.redirected=true |
| Overwrite protection (new file) | Non-existing file → written directly, metadata.redirected=false |
| Timestamp uniqueness | Two rapid writes to same path produce distinct timestamped filenames |
| Column widths | Custom widths applied correctly |
| Error handling | Path validation, row count exceeds limit |
| Permissions | Verify `ctx.ask()` called with `permission: "edit"` |
| Events | Verify `File.Event.Edited` and `FileWatcher.Event.Updated` published |
| Round-trip | Write then read, verify data integrity |

### Running Tests

```bash
cd packages/opencode
bun test test/tool/excel-read.test.ts --timeout 30000
bun test test/tool/excel-write.test.ts --timeout 30000
```

---

## 11. Future Roadmap (Out of Scope for V1)

Versions are ordered by priority. SheetJS Pro-dependent features are intentionally deferred to V4 (lowest priority) to avoid Pro license dependency for as long as possible.

### V1.1 — Data Enhancements (High Priority)

| Feature | Approach |
|---------|----------|
| Row filtering (`filter` param) | Add basic equality/contains filters to `excel_read` |
| Streaming read for 100K+ rows | SheetJS stream API for memory efficiency |

### V1.2 — Desktop/Web UI Panel Preview (High Priority)

| Feature | Approach |
|---------|----------|
| Side panel spreadsheet viewer | `SpreadsheetViewer` component with TanStack Table v8 (~14KB, MIT, headless) + TailwindCSS |
| `FileMedia` spreadsheet kind | Add `"spreadsheet"` media kind for `.xlsx`/`.xls`/`.csv`/`.ods` in `file-media.tsx` |
| Server-side parsed data endpoint | Extend file read API to return pre-parsed sheet data as JSON |

See Section 6.6 for implementation details.

### V2 — Editing & i18n (Medium Priority)

| Feature | Approach |
|---------|----------|
| In-place cell editing (`ExcelEditTool`) | Read-modify-write with surgical cell operations |
| CLI/Core i18n | Project-wide initiative, not Excel-specific |

### V3 — Styling & Charts via ExcelJS (Low Priority, No Pro License)

These features use **ExcelJS** (MIT, active) instead of SheetJS Pro, avoiding a paid license dependency. ExcelJS is ~2–5x slower than Node on Bun but adequate for the write path where performance is less critical.

| Feature | Approach |
|---------|----------|
| Styling (fonts, colors, borders) | ExcelJS for write path — full styling API, MIT license |
| Chart creation | ExcelJS or template-based approach |

### V4 — SheetJS Pro Features (Lowest Priority)

These features genuinely require SheetJS Pro or deep OOXML knowledge. Deferred to the lowest priority due to licensing cost and complexity.

| Feature | Approach |
|---------|----------|
| Data validation rules | SheetJS Pro |
| Image extraction from sheets | SheetJS Pro or custom OOXML parsing |
| Pivot table creation | Deep OOXML knowledge or Pro library |

---

## Appendix A: SheetJS Parse Options Used

```typescript
XLSX.read(buffer, {
  cellFormula: true,     // preserve cell.f (formula strings)
  cellDates: true,       // parse dates as Date objects (cell.t = "d")
  sheetStubs: true,      // include blank cells with metadata (for merge detection)
  // cellNF: false,      // default: don't need number format strings for V1
  // cellStyles: false,  // default: no styling in V1
})
```

## Appendix B: Format Compatibility Matrix

| Source | Read | Write | Notes |
|--------|------|-------|-------|
| Excel Desktop 2019–2025 (.xlsx) | ✅ | ✅ | Standard OOXML |
| Excel 365 cloud (.xlsx) | ✅ | ✅ | Standard OOXML |
| Legacy Excel 97-2004 (.xls) | ✅ | ✅ | BIFF8 |
| Legacy Excel 5.0/95 (.xls) | ✅ | ✅ | BIFF5 |
| Excel Binary (.xlsb) | ✅ | ✅ | BIFF12 |
| Excel with Macros (.xlsm) | ✅ | ✅ | Macros not preserved |
| LibreOffice (.ods) | ✅ | ✅ | OpenDocument |
| Apple Numbers (.numbers) | ✅ | ✅ | iWork 2013+ |
| Google Sheets export (.xlsx) | ✅ | N/A | Standard OOXML |
| CSV/TSV | ✅ | ✅ | Delimiter-separated |

## Appendix C: Token Budget Quick Reference

**Formula:** `Tokens ≈ ((rows + 2) × (11 × cols + 2)) / 3.5 + (20 × cols)`

| Columns | 100 rows | 500 rows | 1,000 rows | 5,000 rows |
|---------|----------|----------|------------|------------|
| 15 | ~5,100 | ~24,100 | ~47,900 | ~237,900 |
| 20 | ~6,900 | ~32,200 | ~64,000 | ~317,400 |
| 25 | ~8,500 | ~40,100 | ~79,700 | ~396,100 |
