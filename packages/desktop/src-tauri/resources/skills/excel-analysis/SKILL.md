---
name: excel-analysis
description: Analyze spreadsheet files — classify layout, read content with the appropriate strategy, and present findings. Use when the user wants to analyze, understand, or extract information from an Excel file.
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

**TABULAR** -> mode: PAGINATE

  task({ agent: "general", description:
    "Invoke the excel-read-strategy skill.
     filePath: '{filePath}', sheet: '{sheetName}', mode: PAGINATE,
     purpose: '{user's intent}'" })

**FORM** -> mode: FULL

  task({ agent: "general", description:
    "Invoke the excel-read-strategy skill.
     filePath: '{filePath}', sheet: '{sheetName}', mode: FULL,
     purpose: 'extract all key-value pairs and form structure'" })

**MIXED** -> mode: FULL

  task({ agent: "general", description:
    "Invoke the excel-read-strategy skill.
     filePath: '{filePath}', sheet: '{sheetName}', mode: FULL,
     purpose: 'identify form regions and tabular regions'" })

**SPARSE** -> mode: SPARSE

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
