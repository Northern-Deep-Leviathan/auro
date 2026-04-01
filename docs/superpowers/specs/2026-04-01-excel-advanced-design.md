# Advanced Excel Support for OpenCode — Design Specification

**Date:** 2026-04-01
**Status:** Draft
**Supersedes:** 2026-03-15-excel-support-design.md (V1 schema+records approach)
**Author:** AI-assisted design session

---

## 1. Overview

Redesign the Excel tools from a schema+records assumption to a **generic read/write architecture** that handles any Excel layout — tabular data, forms, dashboards, mixed layouts — without assuming file structure. Intelligence moves from the tool layer to a **three-layer skill architecture** where common skills orchestrate reads/writes and business skills deliver user-facing workflows.

### Motivation

The V1 design assumed all Excel files follow a "header row + data records" pattern. Real-world Excel files (e.g., KONE transportation commitment forms with 46 merged cells per sheet, label-value pairs, embedded tables, and reference data) break this assumption. Every cell carries meaning in its spatial position — the tool must preserve that, not flatten it.

### Goals

- Generic read/write tools that make no assumptions about file structure
- Spatial grid rendering that preserves cell positions, merged cell boundaries, and layout relationships
- A skill architecture with common building blocks (read strategy, write strategy, layout classification) and user-facing business skills (analysis)
- Context isolation via subagents — infra skills run in subagents to avoid polluting the main conversation
- All skills accessible to all agents — infra vs business is a design intent distinction, not an access control one

### Non-Goals (This Version)

- Styling (fonts, colors, borders, conditional formatting)
- Charts, images, pivot tables
- In-place cell editing (surgical updates to existing files)
- VBA macros
- Multi-sheet form comparison (future skill)
- Side panel spreadsheet viewer (future)

---

## 2. Architecture: Three Layers

```
┌──────────────────────────────────────────────────────────────┐
│  Layer 3: Business Skills (user-facing)                       │
│                                                               │
│  ┌──────────────────────┐                                     │
│  │  excel-analysis       │  Orchestrates: classify → read →   │
│  │  (SKILL.md)           │  present, via subagents            │
│  └───────┬──────┬────────┘                                    │
│          │      │                                              │
├──────────┼──────┼─────────────────────────────────────────────┤
│  Layer 2: Common/Infra Skills (building blocks)               │
│  All agents, all users — open permissions                     │
│          │      │                                              │
│  ┌───────▼──┐ ┌─▼───────────┐ ┌──────────────────┐           │
│  │ layout-  │ │ read-        │ │ write-           │           │
│  │classifier│ │ strategy     │ │ strategy         │           │
│  │(SKILL.md)│ │ (SKILL.md)   │ │ (SKILL.md)       │           │
│  └───────┬──┘ └──┬───────────┘ └──────────────────┘           │
│          │       │                                             │
├──────────┼───────┼────────────────────────────────────────────┤
│  Layer 1: Generic Tools (pure I/O)                            │
│          │       │                                             │
│  ┌───────▼──┐ ┌──▼──────────┐ ┌───────────────┐              │
│  │ excel_   │ │ excel_read   │ │ excel_write   │              │
│  │ sheets   │ │ (1 sheet,    │ │ (full write,  │              │
│  │(manifest)│ │  grid fmt)   │ │  single call) │              │
│  └──────────┘ └──────────────┘ └───────────────┘              │
└──────────────────────────────────────────────────────────────┘
```

### Design Principles

1. **Tools are pure I/O** — no intelligence, no layout detection, no assumptions
2. **Skills are orchestration** — they decide how to use tools based on context
3. **Common skills are building blocks** — designed to be called by business skills via subagents, but accessible to all agents and users directly
4. **Business skills are workflows** — user-facing, orchestrate common skills into coherent experiences
5. **Subagents for context isolation** — infra skills run in subagents so only results (not raw grid data) enter the main conversation

---

## 3. Layer 1: Generic Tools

### 3.1 `excel_sheets` — Sheet Manifest Discovery

**File:** `packages/opencode/src/tool/excel-sheets.ts`
**Description file:** `packages/opencode/src/tool/excel-sheets.txt`
**Tool ID:** `excel_sheets`
**Permission type:** `"read"` (same as ReadTool)

#### Parameters

```typescript
z.object({
  filePath: z.string()
    .describe("Absolute path to the spreadsheet file"),
})
```

#### Execution Flow

```
excel_sheets(filePath)
│
├─ 1. RESOLVE PATH
│     Resolve relative → absolute via Instance.directory
│     assertExternalDirectory() for sandbox check
│
├─ 2. PERMISSION CHECK
│     ctx.ask({ permission: "read", patterns: [filePath], always: ["*"], metadata: {} })
│
├─ 3. VALIDATE FILE
│     Check exists, check extension, check size (< 100 MB)
│
├─ 4. PARSE FILE (headers only, minimal parsing)
│     const buffer = await Bun.file(filePath).arrayBuffer()
│     const wb = XLSX.read(buffer, { cellFormula: false, cellDates: false, sheetStubs: true })
│
├─ 5. BUILD MANIFEST
│     For each sheet: decode range for row/col counts, count merges
│
├─ 6. RECORD FILE READ TIME
│     FileTime.read(ctx.sessionID, filePath)
│
└─ 7. RETURN
      { title, output, metadata }
```

#### Output Format

XML wrapper consistent with ReadTool's `<path>/<type>/<content>` pattern:

```xml
<excel_sheets path="uton_example.xlsx">
  <sheet name="优1" rows="30" cols="22" merges="46" />
  <sheet name="优2" rows="30" cols="22" merges="46" />
  <sheet name="优3" rows="30" cols="22" merges="46" />
  ...
  <sheet name="优21" rows="30" cols="22" merges="46" />
  <total sheets="21" />
</excel_sheets>
```

#### Return Structure

```typescript
{
  title: string,          // relative path, e.g. "data/report.xlsx"
  output: string,         // the XML manifest
  metadata: {
    sheets: Array<{ name: string, rows: number, cols: number, merges: number }>,
    totalSheets: number,
  },
}
```

---

### 3.2 `excel_read` — Single Sheet Grid Reader

Reads **one sheet** and returns its content as a spatial grid. Pure I/O — no layout detection, no schema inference.

**File:** `packages/opencode/src/tool/excel-read.ts` (replaces current implementation)
**Description file:** `packages/opencode/src/tool/excel-read.txt`
**Tool ID:** `excel_read`
**Permission type:** `"read"`

#### Parameters

```typescript
z.object({
  filePath: z.string()
    .describe("Absolute path to the spreadsheet file"),
  sheet: z.string()
    .describe("Sheet name to read (use excel_sheets to discover available sheets)"),
  offset: z.coerce.number().optional()
    .describe("0-indexed row to start from (default: 0)"),
  limit: z.coerce.number().optional()
    .describe("Max rows to return. Default is model-aware. Use 0 for dimensions-only"),
  columns: z.array(z.union([z.string(), z.number()])).optional()
    .describe("Column letters (A, B, C...) or 0-based indices to include"),
})
```

#### Key Changes from V1

| Aspect | V1 (Current) | Advanced (New) |
|--------|-------------|----------------|
| Layout assumption | Schema+records (header row + data rows) | None — pure spatial grid |
| `sheet` parameter | Optional (reads all sheets) | Required (one sheet per call) |
| `offset` semantics | 1-indexed, relative to detected data start row | 0-indexed, relative to raw sheet row 0 |
| `format` parameter | markdown / csv / json | Removed — spatial grid with XML wrapper is the one format |
| Schema summary | Always emitted (column names, types, samples) | Removed — no schema detection at tool level |
| Header detection | `detectHeaderRegion()` algorithm | Removed — skills handle interpretation |
| Multi-sheet output | All sheets in one call | One sheet per call (skills orchestrate multi-sheet) |
| Output format | XML-wrapped markdown table | XML-wrapped spatial grid |

#### Execution Flow

```
excel_read(filePath, sheet, offset?, limit?, columns?)
│
├─ 1. RESOLVE PATH + PERMISSION CHECK (same as V1)
│
├─ 2. PARSE FILE
│     const buffer = await Bun.file(filePath).arrayBuffer()
│     const wb = XLSX.read(buffer, {
│       cellFormula: true, cellDates: true, sheetStubs: true,
│     })
│
├─ 3. VALIDATE SHEET
│     If sheet not in wb.SheetNames → error with available sheets list
│
├─ 4. If limit=0 → DIMENSIONS-ONLY MODE
│     Return <dimensions> tag only, no grid content
│     Useful for skills to check size before reading
│
├─ 5. RENDER SPATIAL GRID
│     ├─ For each row in [offset, offset+limit):
│     │   ├─ For each column (or filtered columns):
│     │   │   ├─ Check if cell is covered by a merge → suppress
│     │   │   ├─ Check if cell is merge origin → render as [== content (range) ==]
│     │   │   ├─ Check if cell is empty → render as ·
│     │   │   └─ Otherwise → render cell value via formatCellValue()
│     │   └─ Emit row as "R{n}: cell1  cell2  cell3  ..."
│     └─ Prepend column header line (A, B, C, ...)
│
├─ 6. WRAP IN XML
│     <excel_read path="..." sheet="...">
│       <dimensions rows="N" cols="N" merges="N" />
│       <grid rows="start-end" total="N">
│       ...spatial grid...
│       </grid>
│       <pagination hasMore="bool" nextOffset="N" remaining="N" />
│     </excel_read>
│
├─ 7. FileTime.read(ctx.sessionID, filePath)
│
└─ 8. RETURN { title, output, metadata }
```

#### Spatial Grid Format Specification

**Column headers:** Shown once at the top, aligned with cell content.

```
     A                         B                              C         D
```

**Row format:** `R{n}:` prefix (0-indexed matching Excel), followed by cell values aligned under column headers.

```
R0:  [== TRANSPORTATION COMMITMENT 委托运输单 (A1:H1) ==]
R1:  ·                         ·                              ·         ·
R2:  Assignee 受托人            [== 上海优通供应链管理有限公司 (B3:D3) ==]
```

**Merged cells:** Rendered as `[== content (range) ==]` at the merge origin position. Cells covered by the merge are suppressed (not shown as `·`).

**Empty cells:** Shown as `·` (middle dot, U+00B7) to preserve column alignment.

**Entirely empty rows:** Shown as blank lines (not repeated `·`).

**Column alignment:** Each column's display width is determined by the maximum content width in that column (capped at 40 characters). Content exceeding the cap is truncated with `...`. Columns are separated by two spaces. This produces readable alignment without excessive whitespace for sparse sheets.

**Cell values:** Formatted using existing `formatCellValue()`:
- Dates → ISO 8601 (`2025-01-15`)
- Formulas → `=SUM(A1:A10)` (formula string, not computed value)
- Booleans → `TRUE` / `FALSE`
- Errors → `#DIV/0!`, `#REF!`, etc.
- Numbers → as-is
- Strings → as-is

#### Output Examples

**Dimensions-only mode (limit=0):**

```xml
<excel_read path="uton_example.xlsx" sheet="优1">
  <dimensions rows="30" cols="22" merges="46" />
</excel_read>
```

**Full sheet read (form-type, small sheet):**

```xml
<excel_read path="uton_example.xlsx" sheet="优1">
  <dimensions rows="30" cols="22" merges="46" />
  <grid rows="0-29" total="30">
       A                         B                                    C         D         E                             F
  R0:  [== TRANSPORTATION COMMITMENT 委托运输单 (A1:H1) ==]
  R1:  ·                         ·                                    ·         ·         ·                             ·
  R2:  Assignee 受托人            [== 上海优通供应链管理有限公司 (B3:D3) ==]                  Entrusting Party 委托人       [== KONE Elevators (F3:J3) ==]
  R3:  Consignee 收货人           [== 厦门市湖里区2024P07... (B4:D4) ==]                    Contact 收货联络人及电话       [== 邹晗/1364600... (F4:J4) ==]
  ...
  R11: Item                       Material Description                 ·         Packaging Mode                        # Packages  Weight/KG  Volume/M3  Remark
  R12: 序号                       货物名称                              ·         包装方式                               包装件数     重量        体积       备注
  R13: 1                          ·                                    ·         ·                                     47          23539.4    56.375
  ...
  </grid>
  <pagination hasMore="false" />
</excel_read>
```

**Paginated read (large tabular sheet):**

```xml
<excel_read path="sales.xlsx" sheet="Sales">
  <dimensions rows="5000" cols="20" merges="0" />
  <grid rows="0-99" total="5000">
       A          B              C            D          E
  R0:  ProductID  ProductName    Category     UnitPrice  Quantity
  R1:  1001       Widget A       Electronics  29.99      100
  R2:  1002       Gadget B       Hardware     149.50     50
  ...
  </grid>
  <pagination hasMore="true" nextOffset="100" remaining="4900" />
</excel_read>
```

#### Model-Aware Default Row Limit

Retained from V1 with the same formula, applied after parsing:

```typescript
function defaultRowLimit(
  numCols: number,
  model?: { limit?: { context?: number } },
): number {
  const context = model?.limit?.context
  if (!context || context === 0) return 100

  const tokensPerRow = (11 * numCols + 2) / 3.5
  const budget = context * 0.15
  const estimated = Math.floor(budget / tokensPerRow)

  return Math.max(20, Math.min(estimated, 1000))
}
```

#### Return Structure

```typescript
{
  title: string,           // relative path
  output: string,          // XML-wrapped spatial grid
  metadata: {
    truncated: boolean,    // true if not all rows shown (opts out of framework auto-truncation)
    rows: number,          // total rows in sheet
    cols: number,          // total columns in sheet
    merges: number,        // merge count
    hasMore: boolean,      // true if pagination has more rows
    outputRows: number,    // rows actually returned
  },
}
```

---

### 3.3 `excel_write` — Full Write (Simplified)

Single-call full write. Unchanged from V1 design except: chunked/incremental writing is removed. Context efficiency for large writes is handled at the skill layer (subagent isolation or code generation via BashTool).

**File:** `packages/opencode/src/tool/excel-write.ts`
**Description file:** `packages/opencode/src/tool/excel-write.txt`
**Tool ID:** `excel_write`
**Permission type:** `"edit"`

#### Parameters

```typescript
z.object({
  filePath: z.string()
    .describe("Absolute output path. Supported: .xlsx, .xls, .csv, .ods. "
      + "If no extension or unsupported extension, defaults to .xlsx"),

  sheets: z.array(z.object({
    name: z.string()
      .describe("Sheet name"),
    headers: z.array(z.string())
      .describe("Column header names"),
    rows: z.array(z.array(z.union([
      z.string(), z.number(), z.boolean(), z.null(),
    ]))).describe(
      "2D array of cell values. Conventions: "
      + "strings starting with '=' are formulas; "
      + "strings matching YYYY-MM-DD are written as date cells; "
      + "null produces an empty cell."
    ),
    columnWidths: z.array(z.number()).optional()
      .describe("Column widths in characters"),
  })).describe("Array of sheets to create"),
})
```

#### Execution Flow

Same as V1 (Section 5.3 of the original design):
1. Validate & normalize path (extension handling, overwrite protection with timestamp)
2. Build workbook from sheets array
3. Permission check with preview
4. Write file
5. Publish events, record FileTime
6. Return result with metadata

#### Context Efficiency Strategy

The write tool itself is simple. Context-efficient writing for large datasets is handled at the skill layer:

- **Small datasets (< 200 rows):** Skill invokes `excel_write` directly in a subagent
- **Large datasets (200+ rows):** Skill generates a TypeScript script using the `xlsx` package, executes via BashTool — only the script enters context, not the data

---

### 3.4 Integration Changes

#### ReadTool Redirect

**`packages/opencode/src/tool/read.ts`** — Add spreadsheet extension check before `isBinaryFile()`:

```
"This is a spreadsheet file. Use the excel_sheets tool to discover sheets,
 then excel_read to read a specific sheet."
```

#### Tool Registration

**`packages/opencode/src/tool/registry.ts`** — Add `ExcelSheetsTool` alongside existing Excel tools:

```typescript
import { ExcelSheetsTool } from "./excel-sheets"

// In all():
..., WriteTool, ExcelSheetsTool, ExcelReadTool, ExcelWriteTool, TaskTool, ...
```

#### Permission System

**`packages/opencode/src/permission/next.ts`** — `EDIT_TOOLS` array already includes `"excel_write"`. No changes needed. `excel_sheets` and `excel_read` use `"read"` permission (same as ReadTool).

#### New File Structure

```
packages/opencode/src/tool/
├── excel-sheets.ts        # NEW: sheet manifest tool
├── excel-sheets.txt       # NEW: LLM-facing description
├── excel-read.ts          # REWRITTEN: spatial grid, single sheet
├── excel-read.txt         # UPDATED: describes spatial grid output
├── excel-write.ts         # SIMPLIFIED: single-call full write
├── excel-write.txt        # UPDATED: simplified description
└── excel-util.ts          # REWRITTEN: spatial grid renderer, merge handling
```

---

## 4. Layer 2: Common/Infra Skills

Common skills are building blocks designed to be called by business skills via subagents (TaskTool). They are **accessible to all agents and all users** — the distinction between common and business skills is design intent, not access control.

All skills use the standard `"ask"` permission flow. Users can set `"excel-*": "allow"` in their config to auto-approve all Excel skills.

### Skill File Locations

```
packages/desktop/src-tauri/resources/skills/
├── excel-layout-classifier/SKILL.md
├── excel-read-strategy/SKILL.md
├── excel-write-strategy/SKILL.md
└── excel-analysis/SKILL.md
```

Shipped via the `OPENCODE_BUILTIN_SKILLS_PATH` mechanism (Tauri resource bundling). Users can override any skill by creating a same-named skill in `.opencode/skill/`.

---

### 4.1 `excel-layout-classifier` — Sheet Layout Type Detection

Classifies a single sheet's layout as one of four types.

```markdown
---
name: excel-layout-classifier
description: Classify an Excel sheet's layout type as tabular, form, mixed, or sparse.
---

# Excel Layout Classifier

Classify the layout type of a single Excel sheet by reading a small sample
and analyzing its structure.

## Input

The caller provides:
- `filePath` — path to the Excel file
- `sheet` — sheet name to classify

## Process

1. Call `excel_read(filePath, sheet, limit=20)` to sample the first 20 rows
2. Note the merge count from the `<dimensions>` tag
3. Analyze the spatial grid and classify:

### TABULAR
- One row has most columns filled (the header row)
- Subsequent rows have consistent fill patterns (data rows)
- Few or no merged cells (< 3 merges)
- Column values in each row follow the same type pattern

### FORM
- Heavy merge usage (> 10 merges)
- Label-value pairs: a text cell adjacent to a data/merged cell
- Low row-to-row consistency (each row has different structure)
- Multiple sections with different purposes
- Usually < 50 rows total

### MIXED
- Has both form-like regions (merged cells, labels) AND tabular regions
- Typically: form header at top, data table in middle, footer at bottom
- Some rows have merges, others have consistent columnar data

### SPARSE
- Low overall fill rate (< 30% of cells non-empty)
- Scattered data points without consistent row/column patterns
- Isolated cell clusters with gaps between them

## Output

Return:
- `layoutType`: "tabular" | "form" | "mixed" | "sparse"
- `confidence`: "high" | "medium" | "low"
- `evidence`: brief explanation of why this classification was chosen
- `recommendations`: suggested read mode (FULL / PAGINATE / SPARSE)
```

---

### 4.2 `excel-read-strategy` — Progressive Disclosure Read

Orchestrates how to read Excel content based on the caller's intent. Supports three read modes.

```markdown
---
name: excel-read-strategy
description: Orchestrate Excel reads with progressive disclosure — full, paginated, or sparse mode.
---

# Excel Read Strategy

Orchestrate reading Excel sheet content using the appropriate strategy.
The caller specifies a read mode and target sheet.

## Input

The caller provides:
- `filePath` — path to the Excel file
- `sheet` — sheet name to read
- `mode` — one of: FULL, PAGINATE, SPARSE
- `purpose` — what the caller needs the data for

## Read Modes

### FULL Mode

Read the entire sheet content. Use when:
- The sheet is a form (every cell matters)
- The sheet is small (< 100 rows)
- The caller explicitly needs all content

Steps:
1. Call `excel_read(filePath, sheet)` with no offset/limit
2. Return the complete spatial grid to the caller

### PAGINATE Mode

Progressive disclosure for large sheets. Use when:
- The caller wants analysis, statistics, or pattern discovery
- The sheet has many rows (> 100)

Steps:
1. Call `excel_read(filePath, sheet, limit=0)` to get dimensions
2. Calculate page size based on column count and context budget:
   - Budget: ~15% of model context for Excel data
   - Page size: budget / (estimated tokens per row)
   - Minimum 20 rows, maximum 500 rows per page
3. Read first page: `excel_read(filePath, sheet, offset=0, limit=pageSize)`
4. Based on the purpose:
   - If scanning for patterns: continue reading pages until pattern is clear
   - If computing statistics: read all pages, accumulate results
   - If searching for specific data: read pages until found
5. Summarize findings and return to caller

### SPARSE Mode

Focus on non-empty cells only. Use when:
- The sheet is a dashboard or summary with scattered data
- The caller wants to find relationships between data points

Steps:
1. Call `excel_read(filePath, sheet)` to get full grid
2. Parse the spatial grid output
3. Identify non-empty cell clusters (groups of adjacent non-empty cells)
4. For each cluster: extract position, content, and relationship to
   other clusters
5. Return cluster summary to caller

## Output

Return a structured summary including:
- The read mode used
- Sheet dimensions
- The actual content (full grid, paginated summary, or cluster analysis)
- Observations about the data structure
```

---

### 4.3 `excel-write-strategy` — Write Orchestration

Guides efficient Excel file creation.

```markdown
---
name: excel-write-strategy
description: Orchestrate Excel writes efficiently — direct write for small data, code generation for large data.
---

# Excel Write Strategy

Orchestrate writing Excel files with the right approach based on data size.

## Input

The caller provides:
- `filePath` — output path
- `sheets` — sheet definitions with headers and data
- `purpose` — what the output file is for

## Strategy

### Small datasets (< 200 rows total across all sheets)

Write in a single `excel_write` call with all sheets and rows.

### Large datasets (200+ rows)

The context cost of producing all rows in a single tool call is high.
Instead:
1. Write a TypeScript script that generates the Excel file
2. The script uses the `xlsx` package directly
3. Execute the script with BashTool
4. This keeps the tool call small (just the script) while producing
   arbitrarily large output files

### Form-style output

When the caller needs a document layout (not tabular data):
1. Structure the sheets array to match the desired spatial layout
2. Use `excel_write` with headers and rows arranged positionally

## Output

Return:
- The path of the written file
- Sheet summary (names, row counts)
- Any warnings (extension changes, overwrite redirects)
```

---

## 5. Layer 3: Business Skills

### 5.1 `excel-analysis` — User-Facing Analysis Workflow

The first user-facing skill. Orchestrates layout classification, appropriate read strategy, and presentation.

```markdown
---
name: excel-analysis
description: Analyze spreadsheet files — classify layout, read content with the appropriate strategy, and present findings.
---

# Excel Analysis

Use this skill when asked to analyze, understand, or extract information
from spreadsheet files (.xlsx, .xls, .csv, .ods, etc.).

## Workflow

### Step 1: Discover Sheets

Call `excel_sheets(filePath)` to get the sheet manifest.

Always ask the user which sheet to analyze. Present the available sheets
and default to the first sheet:

  "This file has N sheets: Sheet1, Sheet2, Sheet3, ...
   Which sheet would you like to analyze? (default: Sheet1)"

Use the user's chosen sheet, or the first sheet if they confirm the default.

### Step 2: Classify Layout

Dispatch a subagent via TaskTool to classify the sheet:

  task({ agent: "general", description:
    "Invoke the excel-layout-classifier skill to classify the layout of
     sheet '{sheetName}' in file '{filePath}'. Return the layout type,
     confidence, and recommended read mode." })

### Step 3: Read with Appropriate Strategy

Based on the classification result, dispatch a subagent via TaskTool:

**TABULAR →** mode: PAGINATE

  task({ agent: "general", description:
    "Invoke the excel-read-strategy skill.
     filePath: '{filePath}', sheet: '{sheetName}', mode: PAGINATE,
     purpose: '{user's intent}'" })

**FORM →** mode: FULL

  task({ agent: "general", description:
    "Invoke the excel-read-strategy skill.
     filePath: '{filePath}', sheet: '{sheetName}', mode: FULL,
     purpose: 'extract all key-value pairs and form structure'" })

**MIXED →** mode: FULL

  task({ agent: "general", description:
    "Invoke the excel-read-strategy skill.
     filePath: '{filePath}', sheet: '{sheetName}', mode: FULL,
     purpose: 'identify form regions and tabular regions'" })

**SPARSE →** mode: SPARSE

  task({ agent: "general", description:
    "Invoke the excel-read-strategy skill.
     filePath: '{filePath}', sheet: '{sheetName}', mode: SPARSE,
     purpose: 'identify data clusters and relationships'" })

### Step 4: Present Findings

Based on the subagent results:

- **Tabular**: summary statistics, patterns, or specific records
- **Form**: extracted key-value data organized by sections
- **Mixed**: form data and tabular data presented separately
- **Sparse**: discovered data clusters and their relationships

Always respond in the user's language.
```

---

## 6. Error Handling

All error messages in English, consistent with existing CLI/core pattern.

| Scenario | Tool | Error Message |
|----------|------|---------------|
| File not found | excel_sheets, excel_read | `"Error: File not found: {filePath}"` |
| File too large | excel_sheets, excel_read | `"Error: File is {size}MB. Maximum supported size is 100MB."` |
| Password-protected | excel_sheets, excel_read | `"Error: This file is password-protected. SheetJS cannot open encrypted workbooks."` |
| Corrupt/unreadable | excel_sheets, excel_read | `"Error: Failed to parse spreadsheet: {error}. The file may be corrupted."` |
| Unsupported format | excel_sheets, excel_read | `"Error: Unsupported file format '{ext}'. Supported: .xlsx, .xls, .xlsb, .xlsm, .csv, .ods, .numbers, and more."` |
| Sheet not found | excel_read | `"Error: Sheet '{name}' not found. Available sheets: {list}"` |
| Column not found | excel_read | `"Error: Column '{name}' not found. Available columns: {list}"` |
| Offset beyond data | excel_read | `"Warning: Offset {N} exceeds total rows ({total}). No rows to show."` |
| Write: row limit | excel_write | `"Error: Sheet '{name}' has {N} rows, exceeding the XLSX limit of 1,048,576."` |
| Write: file exists | excel_write | `"Note: File '{name}' already exists. Writing to '{timestamped}' to preserve the original."` |
| Write: bad extension | excel_write | `"Note: Unsupported extension '{ext}' was changed to '.xlsx'. Supported: .xlsx, .xls, .csv, .ods"` |

---

## 7. Testing Strategy

### Test Location

```
packages/opencode/test/tool/
├── excel-sheets.test.ts
├── excel-read.test.ts
└── excel-write.test.ts
```

### Test Cases

**ExcelSheetsTool:**

| Category | Cases |
|----------|-------|
| Basic manifest | Single sheet, multi-sheet, empty workbook |
| Manifest accuracy | Row/col counts, merge counts match actual file |
| Format support | .xlsx, .xls, .csv, .ods |
| Error handling | File not found, corrupted, password-protected |
| Permissions | Verify `ctx.ask()` called with `permission: "read"` |

**ExcelReadTool:**

| Category | Cases |
|----------|-------|
| Spatial grid | Simple cells, mixed types (string, number, date, boolean, formula, error) |
| Merged cells | Merge origin shows content+range, covered cells suppressed |
| Empty cells | Empty cells as `·`, entirely empty rows as blank lines |
| Dimensions-only | `limit=0` returns `<dimensions>` only |
| Pagination | offset/limit, hasMore/nextOffset, offset beyond end |
| Column filtering | By letter (A, B, C), by index (0, 1, 2), invalid column |
| Sheet validation | Sheet not found error with available sheets list |
| Form-type files | KONE transportation form renders correctly with all merges |
| Tabular files | Standard header+rows renders as spatial grid |
| XML output | Correct XML wrapper structure |
| ReadTool redirect | ReadTool on .xlsx returns redirect message |

**ExcelWriteTool:**

| Category | Cases |
|----------|-------|
| Basic write | Single sheet, multi-sheet, valid XLSX output |
| Cell types | String, number, boolean, null, formula, date |
| Overwrite protection | Existing file → timestamped, original preserved |
| Extension handling | No ext → .xlsx, unsupported → .xlsx + warning |
| Round-trip | Write then read, verify data integrity |
| Error handling | Path validation, row count exceeds limit |
| Permissions | Verify `ctx.ask()` with `permission: "edit"` |

### Running Tests

```bash
cd packages/opencode
bun test test/tool/excel-sheets.test.ts --timeout 30000
bun test test/tool/excel-read.test.ts --timeout 30000
bun test test/tool/excel-write.test.ts --timeout 30000
```

---

## 8. Dependency

**SheetJS CE** — unchanged from V1:

```json
{ "xlsx": "^0.20.3" }
```

~1.2 MB, pure JavaScript, no native bindings, Bun compatible.

---

## 9. Future Skills Roadmap

The extensible skill directory structure supports adding more Excel skills:

```
packages/desktop/src-tauri/resources/skills/
├── excel-layout-classifier/SKILL.md    ← V1: shipped
├── excel-read-strategy/SKILL.md        ← V1: shipped
├── excel-write-strategy/SKILL.md       ← V1: shipped
├── excel-analysis/SKILL.md             ← V1: shipped
├── excel-multi-sheet-compare/SKILL.md  ← Future: compare sheets
├── excel-transform/SKILL.md            ← Future: read → transform → write
├── excel-reporting/SKILL.md            ← Future: generate reports
└── excel-data-extraction/SKILL.md      ← Future: extract structured data
```

Each skill is a separate SKILL.md in its own subdirectory, discovered automatically by the skill system. Users can override any skill by creating a same-named skill in `.opencode/skill/`.

---

## Appendix A: Comparison with V1 Design

| Aspect | V1 (2026-03-15) | Advanced (This Spec) |
|--------|-----------------|---------------------|
| Layout assumption | Schema + records | None (generic spatial grid) |
| Tool count | 2 (excel_read, excel_write) | 3 (excel_sheets, excel_read, excel_write) |
| Intelligence location | In the tool (header detection, schema summary) | In skills (layout classifier, read strategy) |
| Multi-sheet handling | All sheets in one call, smart sampling | One sheet per call, skills orchestrate |
| Output format | XML + markdown table | XML + spatial grid |
| Skill layer | None | 4 skills (3 common + 1 business) |
| Context isolation | None | Subagents for infra skills |
| Write model | Single call (chunked was proposed, dropped) | Single call (same, context handled at skill layer) |
| Form support | Poor (header detection fails) | Native (spatial grid preserves all positions) |

## Appendix B: Token Budget for Spatial Grid

**Formula for spatial grid:**
```
Characters per row ≈ 6 (prefix "R{n}: ") + sum of cell widths + separators
Tokens ≈ Characters / 3.5
```

For the KONE transportation form (30 rows × 22 cols, ~15 chars avg per non-empty cell, ~40% fill rate):

| Sheet Count | Tokens per Sheet | Total Tokens |
|-------------|-----------------|-------------|
| 1 sheet | ~1,500–2,000 | ~2,000 |
| 5 sheets (via subagents) | ~1,500–2,000 each | ~2,000 in main context |
| 21 sheets (via subagents) | ~1,500–2,000 each | ~2,000 in main context |

Context isolation via subagents means the main agent only sees the summary result, regardless of how many sheets were processed.

For tabular files (1,000 rows × 20 cols, paginated at 100 rows):

| Page | Tokens |
|------|--------|
| Single page (100 rows) | ~6,000–7,000 |
| Dimensions-only | ~50 |
| Full 1,000 rows (via subagent) | ~60,000 in subagent, summary in main |
