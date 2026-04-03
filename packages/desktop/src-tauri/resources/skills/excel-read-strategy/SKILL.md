---
name: excel-read-strategy
description: Orchestrate Excel reads with progressive disclosure — full, paginated, or sparse mode. Use when the user wants to read contents of a sheet for an Excel file.
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
