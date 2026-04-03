---
name: excel-layout-classifier
description: Classify an Excel sheet's layout type as tabular, form, mixed, or sparse. Use when the user wants to identify/classify/categorize the layout of a sheet.
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
- Few or no merged cells (< 5 merges)
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
