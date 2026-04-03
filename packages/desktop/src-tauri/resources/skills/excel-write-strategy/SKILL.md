---
name: excel-write-strategy
description: Orchestrate Excel writes efficiently — direct write for small data, code generation for large data. Use when the user wants to write data to an Excel file.
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
