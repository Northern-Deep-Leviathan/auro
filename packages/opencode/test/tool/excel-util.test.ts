import { describe, expect, test } from "bun:test"
import XLSX from "xlsx"
import { ExcelUtil } from "../../src/tool/excel-util"

describe("ExcelUtil.defaultRowLimit", () => {
  test("returns DEFAULT_ROW_LIMIT when no model provided", () => {
    const result = ExcelUtil.defaultRowLimit(20, undefined)
    expect(result).toBe(100)
  })

  test("returns DEFAULT_ROW_LIMIT when model has no context limit", () => {
    const result = ExcelUtil.defaultRowLimit(20, { limit: { context: 0 } })
    expect(result).toBe(100)
  })

  test("clamps to minimum 20 rows for small context models", () => {
    const result = ExcelUtil.defaultRowLimit(20, { limit: { context: 8000 } })
    expect(result).toBe(20)
  })

  test("calculates correct default for GPT-4o (128K context, 20 cols)", () => {
    const result = ExcelUtil.defaultRowLimit(20, { limit: { context: 128000 } })
    expect(result).toBe(302)
  })

  test("calculates correct default for Claude Sonnet (200K context, 20 cols)", () => {
    const result = ExcelUtil.defaultRowLimit(20, { limit: { context: 200000 } })
    expect(result).toBe(472)
  })

  test("clamps to maximum 1000 rows for very large context models", () => {
    const result = ExcelUtil.defaultRowLimit(20, { limit: { context: 1000000 } })
    expect(result).toBe(1000)
  })

  test("returns fewer rows for wider tables (25 cols)", () => {
    const result20 = ExcelUtil.defaultRowLimit(20, { limit: { context: 128000 } })
    const result25 = ExcelUtil.defaultRowLimit(25, { limit: { context: 128000 } })
    expect(result25).toBeLessThan(result20)
  })
})

describe("ExcelUtil.detectHeaderRegion", () => {
  function createWorksheet(data: (string | number | null)[][], merges?: XLSX.Range[]): XLSX.WorkSheet {
    const ws = XLSX.utils.aoa_to_sheet(data)
    if (merges) ws["!merges"] = merges
    return ws
  }

  test("detects simple header (no merges, row 0 is header)", () => {
    const ws = createWorksheet([
      ["Name", "Age", "City"],
      ["Alice", 30, "NYC"],
      ["Bob", 25, "LA"],
    ])
    const result = ExcelUtil.detectHeaderRegion(ws)
    expect(result.headerDefinitionRow).toBe(0)
    expect(result.dataStartRow).toBe(1)
    expect(result.titleRows).toHaveLength(0)
    expect(result.subHeaders).toHaveLength(0)
  })

  test("detects title row merged across all columns", () => {
    const ws = createWorksheet([
      ["Annual Report", null, null],
      ["Name", "Age", "City"],
      ["Alice", 30, "NYC"],
    ])
    ws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 2 } }]

    const result = ExcelUtil.detectHeaderRegion(ws)
    expect(result.titleRows).toHaveLength(1)
    expect(result.titleRows[0].value).toBe("Annual Report")
    expect(result.titleRows[0].row).toBe(0)
    expect(result.headerDefinitionRow).toBe(1)
    expect(result.dataStartRow).toBe(2)
  })

  test("detects multi-row header with title and sub-headers", () => {
    const ws = createWorksheet([
      ["2025 Sales", null, null, null, null, null],
      ["Region: East", null, null, "Region: West", null, null],
      [null, null, null, null, null, null],
      ["Product", "Revenue", "Cost", "Product", "Revenue", "Cost"],
      ["Widget", 100, 50, "Gadget", 200, 80],
    ])
    ws["!merges"] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: 5 } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: 2 } },
      { s: { r: 1, c: 3 }, e: { r: 1, c: 5 } },
    ]

    const result = ExcelUtil.detectHeaderRegion(ws)
    expect(result.titleRows).toHaveLength(1)
    expect(result.titleRows[0].value).toBe("2025 Sales")
    expect(result.subHeaders).toHaveLength(2)
    expect(result.subHeaders[0].value).toBe("Region: East")
    expect(result.subHeaders[1].value).toBe("Region: West")
    expect(result.headerDefinitionRow).toBe(3)
    expect(result.dataStartRow).toBe(4)
  })

  test("handles sheet with no data (all empty)", () => {
    const ws = createWorksheet([
      [null, null],
      [null, null],
    ])
    const result = ExcelUtil.detectHeaderRegion(ws)
    expect(result.headerDefinitionRow).toBe(0)
    expect(result.dataStartRow).toBe(0)
  })

  test("handles single-row sheet", () => {
    const ws = createWorksheet([["Only", "Row"]])
    const result = ExcelUtil.detectHeaderRegion(ws)
    expect(result.headerDefinitionRow).toBe(0)
    expect(result.dataStartRow).toBe(1)
  })
})

describe("ExcelUtil.detectColumnType", () => {
  test("detects string column", () => {
    expect(ExcelUtil.detectColumnType(["hello", "world", "test"])).toBe("string")
  })

  test("detects number column", () => {
    expect(ExcelUtil.detectColumnType([1, 2, 3.14])).toBe("number")
  })

  test("detects boolean column", () => {
    expect(ExcelUtil.detectColumnType([true, false, true])).toBe("boolean")
  })

  test("detects date column", () => {
    expect(ExcelUtil.detectColumnType([new Date("2025-01-01"), new Date("2025-06-15")])).toBe("date")
  })

  test("returns string for mixed types", () => {
    expect(ExcelUtil.detectColumnType(["hello", 42, true])).toBe("string")
  })

  test("returns string for empty array", () => {
    expect(ExcelUtil.detectColumnType([])).toBe("string")
  })
})

describe("ExcelUtil.formatCellValue", () => {
  test("formats string", () => {
    expect(ExcelUtil.formatCellValue("hello", "s")).toBe("hello")
  })

  test("formats number", () => {
    expect(ExcelUtil.formatCellValue(42, "n")).toBe("42")
  })

  test("formats boolean", () => {
    expect(ExcelUtil.formatCellValue(true, "b")).toBe("TRUE")
    expect(ExcelUtil.formatCellValue(false, "b")).toBe("FALSE")
  })

  test("formats date as ISO 8601", () => {
    const d = new Date("2025-01-15T00:00:00Z")
    expect(ExcelUtil.formatCellValue(d, "d")).toBe("2025-01-15")
  })

  test("formats formula with = prefix", () => {
    expect(ExcelUtil.formatCellValue(42, "n", "SUM(A1:A10)")).toBe("=SUM(A1:A10)")
  })

  test("formats error cell", () => {
    expect(ExcelUtil.formatCellValue(15, "e")).toBe("#VALUE!")
  })

  test("formats null/undefined as empty string", () => {
    expect(ExcelUtil.formatCellValue(undefined, "z")).toBe("")
    expect(ExcelUtil.formatCellValue(null, "s")).toBe("")
  })
})

describe("ExcelUtil.formatAsMarkdown", () => {
  test("formats headers and rows as markdown table", () => {
    const result = ExcelUtil.formatAsMarkdown(
      ["Name", "Age"],
      [
        ["Alice", "30"],
        ["Bob", "25"],
      ],
    )
    expect(result).toContain("| Name | Age |")
    expect(result).toContain("|------|-----|")
    expect(result).toContain("| Alice | 30 |")
    expect(result).toContain("| Bob | 25 |")
  })

  test("handles empty data rows array", () => {
    const result = ExcelUtil.formatAsMarkdown(["Name", "Age"], [])
    expect(result).toContain("| Name | Age |")
    expect(result).toContain("|------|-----|")
    const lines = result.trim().split("\n")
    expect(lines).toHaveLength(2)
  })

  test("handles null data rows array", () => {
    const result = ExcelUtil.formatAsMarkdown(["Name", "Age"], [[null, null]] as unknown as string[][])
    expect(result).toContain("| Name | Age |")
    expect(result).toContain("|------|-----|")
    expect(result).toContain("|  |  |")
    const lines = result.trim().split("\n")
    expect(lines).toHaveLength(3)
  })
})

describe("ExcelUtil.formatAsCsv", () => {
  test("formats headers and rows as CSV", () => {
    const result = ExcelUtil.formatAsCsv(
      ["Name", "Age"],
      [
        ["Alice", "30"],
        ["Bob", "25"],
      ],
    )
    expect(result).toContain("Name,Age")
    expect(result).toContain("Alice,30")
  })

  test("quotes values containing commas", () => {
    const result = ExcelUtil.formatAsCsv(["Name", "Description"], [["Alice", "tall, fast"]])
    expect(result).toContain('"tall, fast"')
  })

  test("escapes double quotes in values", () => {
    const result = ExcelUtil.formatAsCsv(["Name", "Quote"], [["Alice", 'She said "hello"']])
    expect(result).toContain('"She said ""hello"""')
  })
})

describe("ExcelUtil.formatAsJson", () => {
  test("formats rows as array of objects", () => {
    const result = ExcelUtil.formatAsJson(
      ["Name", "Age"],
      [
        ["Alice", "30"],
        ["Bob", "25"],
      ],
    )
    const parsed = JSON.parse(result)
    expect(parsed).toHaveLength(2)
    expect(parsed[0]).toEqual({ Name: "Alice", Age: "30" })
    expect(parsed[1]).toEqual({ Name: "Bob", Age: "25" })
  })
})

describe("ExcelUtil.SPREADSHEET_EXTENSIONS", () => {
  test("contains common spreadsheet extensions", () => {
    expect(ExcelUtil.SPREADSHEET_EXTENSIONS.has(".xlsx")).toBe(true)
    expect(ExcelUtil.SPREADSHEET_EXTENSIONS.has(".xls")).toBe(true)
    expect(ExcelUtil.SPREADSHEET_EXTENSIONS.has(".xlsb")).toBe(true)
    expect(ExcelUtil.SPREADSHEET_EXTENSIONS.has(".xlsm")).toBe(true)
    expect(ExcelUtil.SPREADSHEET_EXTENSIONS.has(".ods")).toBe(true)
    expect(ExcelUtil.SPREADSHEET_EXTENSIONS.has(".numbers")).toBe(true)
    expect(ExcelUtil.SPREADSHEET_EXTENSIONS.has(".csv")).toBe(true)
  })

  test("does not contain non-spreadsheet extensions", () => {
    expect(ExcelUtil.SPREADSHEET_EXTENSIONS.has(".txt")).toBe(false)
    expect(ExcelUtil.SPREADSHEET_EXTENSIONS.has(".pdf")).toBe(false)
  })
})

describe("ExcelUtil.REDIRECT_EXTENSIONS", () => {
  test("contains binary spreadsheet extensions", () => {
    expect(ExcelUtil.REDIRECT_EXTENSIONS.has(".xlsx")).toBe(true)
    expect(ExcelUtil.REDIRECT_EXTENSIONS.has(".xls")).toBe(true)
    expect(ExcelUtil.REDIRECT_EXTENSIONS.has(".xlsb")).toBe(true)
    expect(ExcelUtil.REDIRECT_EXTENSIONS.has(".ods")).toBe(true)
    expect(ExcelUtil.REDIRECT_EXTENSIONS.has(".numbers")).toBe(true)
  })

  test("does not contain csv (text-based format)", () => {
    expect(ExcelUtil.REDIRECT_EXTENSIONS.has(".csv")).toBe(false)
  })
})

describe("ExcelUtil.buildSchemaSummary", () => {
  test("builds summary for simple sheet", () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ["Name", "Age", "City"],
      ["Alice", 30, "NYC"],
      ["Bob", 25, "LA"],
      ["Carol", 35, "Chicago"],
    ])
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, "People")

    const result = ExcelUtil.buildSchemaSummary(wb)
    expect(result).toContain('Sheet "People"')
    expect(result).toContain("3 data rows")
    expect(result).toContain("3 columns")
    expect(result).toContain("Name")
    expect(result).toContain("Age")
    expect(result).toContain("City")
    expect(result).toContain("string")
    expect(result).toContain("number")
  })

  test("includes title from merged cells", () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ["Annual Report", null, null],
      ["Name", "Age", "City"],
      ["Alice", 30, "NYC"],
    ])
    ws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 2 } }]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, "Report")

    const result = ExcelUtil.buildSchemaSummary(wb)
    expect(result).toContain("Annual Report")
  })

  test("includes sample values (up to 3)", () => {
    const ws = XLSX.utils.aoa_to_sheet([["Name"], ["Alice"], ["Bob"], ["Carol"], ["Dave"]])
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, "Names")

    const result = ExcelUtil.buildSchemaSummary(wb)
    expect(result).toContain("Alice")
    expect(result).toContain("Bob")
    expect(result).toContain("Carol")
    expect(result).not.toContain("Dave")
  })

  test("handles multi-sheet workbook", () => {
    const ws1 = XLSX.utils.aoa_to_sheet([["A"], [1], [2]])
    const ws2 = XLSX.utils.aoa_to_sheet([["B"], [3], [4]])
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws1, "Sheet1")
    XLSX.utils.book_append_sheet(wb, ws2, "Sheet2")

    const result = ExcelUtil.buildSchemaSummary(wb)
    expect(result).toContain('Sheet "Sheet1"')
    expect(result).toContain('Sheet "Sheet2"')
  })

  test("detects formula columns in schema summary", () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ["A", "B", "Sum"],
      [1, 2, null],
      [3, 4, null],
    ])
    // Manually set formula cells (aoa_to_sheet doesn't create formulas)
    ws["C2"] = { t: "n", v: 3, f: "A2+B2" }
    ws["C3"] = { t: "n", v: 7, f: "A3+B3" }
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, "Formulas")

    const result = ExcelUtil.buildSchemaSummary(wb)
    expect(result).toContain("formula")
    expect(result).toContain("=A2+B2")
  })
})
