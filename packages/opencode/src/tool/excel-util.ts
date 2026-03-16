import * as XLSX from "xlsx"

export namespace ExcelUtil {
  const DEFAULT_ROW_LIMIT = 100

  export function defaultRowLimit(numCols: number, model?: { limit?: { context?: number } }): number {
    const context = model?.limit?.context
    if (!context || context === 0) return DEFAULT_ROW_LIMIT

    const tokensPerRow = (11 * numCols + 2) / 3.5
    const budget = context * 0.15
    const estimated = Math.floor(budget / tokensPerRow)

    return Math.max(20, Math.min(estimated, 1000))
  }

  export interface HeaderRegion {
    titleRows: Array<{ row: number; value: string; mergeRange: string }>
    subHeaders: Array<{
      row: number
      value: string
      mergeRange: string
      columns: [number, number]
    }>
    headerDefinitionRow: number
    dataStartRow: number
  }

  export function detectHeaderRegion(ws: XLSX.WorkSheet): HeaderRegion {
    const merges = ws["!merges"] || []
    const ref = ws["!ref"]
    if (!ref) return { titleRows: [], subHeaders: [], headerDefinitionRow: 0, dataStartRow: 0 }

    const range = XLSX.utils.decode_range(ref)
    const totalCols = range.e.c - range.s.c + 1

    const SCAN_LIMIT = Math.min(10, range.e.r + 1)
    const titleRows: HeaderRegion["titleRows"] = []
    const subHeaders: HeaderRegion["subHeaders"] = []

    for (const merge of merges) {
      if (merge.s.r >= SCAN_LIMIT) continue
      const mergeWidth = merge.e.c - merge.s.c + 1
      const addr = XLSX.utils.encode_cell(merge.s)
      const cell = ws[addr]
      if (!cell || cell.v === undefined) continue

      if (mergeWidth > totalCols * 0.5) {
        titleRows.push({
          row: merge.s.r,
          value: String(cell.v),
          mergeRange: XLSX.utils.encode_range(merge),
        })
      } else if (mergeWidth >= 2) {
        subHeaders.push({
          row: merge.s.r,
          value: String(cell.v),
          mergeRange: XLSX.utils.encode_range(merge),
          columns: [merge.s.c, merge.e.c],
        })
      }
    }

    let maxHeaderMergeRow = -1
    for (const merge of merges) {
      if (merge.s.r < SCAN_LIMIT) {
        maxHeaderMergeRow = Math.max(maxHeaderMergeRow, merge.e.r)
      }
    }

    let headerDefinitionRow = 0
    let maxFilledCells = 0

    const searchStart = maxHeaderMergeRow === -1 ? 0 : Math.max(0, maxHeaderMergeRow - 2)
    const searchEnd = maxHeaderMergeRow === -1 ? SCAN_LIMIT - 1 : Math.min(maxHeaderMergeRow + 2, SCAN_LIMIT - 1)

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

    const dataStartRow = maxFilledCells === 0 ? headerDefinitionRow : headerDefinitionRow + 1

    return { titleRows, subHeaders, headerDefinitionRow, dataStartRow }
  }

  // All spreadsheet formats ExcelReadTool can parse (including text-based CSV)
  export const SPREADSHEET_EXTENSIONS = new Set([
    ".xlsx",
    ".xls",
    ".xlsb",
    ".xlsm",
    ".csv",
    ".ods",
    ".numbers",
    ".fods",
    ".dif",
    ".sylk",
    ".dbf",
    ".wk1",
    ".wk3",
    ".html",
    ".rtf",
    ".eth",
    ".et",
    ".wks",
    ".wk2",
    ".wk4",
    ".123",
    ".wq1",
    ".wq2",
    ".wb1",
    ".wb2",
    ".wb3",
    ".qpw",
    ".xlr",
  ])

  // Binary spreadsheet extensions that should trigger ReadTool redirect
  // Excludes .csv (already readable as text by ReadTool)
  export const REDIRECT_EXTENSIONS = new Set([".xlsx", ".xls", ".xlsb", ".xlsm", ".ods", ".numbers"])

  export const WRITE_EXTENSIONS = new Set([".xlsx", ".xls", ".csv", ".ods"])

  const ERROR_CODES: Record<number, string> = {
    0x00: "#NULL!",
    0x07: "#DIV/0!",
    0x0f: "#VALUE!",
    0x17: "#REF!",
    0x1d: "#NAME?",
    0x24: "#NUM!",
    0x2a: "#N/A",
    0x2b: "#GETTING_DATA",
  }

  export function detectColumnType(values: unknown[]): string {
    if (values.length === 0) return "string"
    const types = new Set(
      values
        .filter((v) => v !== null && v !== undefined && v !== "")
        .map((v) => {
          if (v instanceof Date) return "date"
          if (typeof v === "number") return "number"
          if (typeof v === "boolean") return "boolean"
          return "string"
        }),
    )
    if (types.size === 1) return types.values().next().value!
    return "string"
  }

  export function formatCellValue(value: unknown, cellType: string, formula?: string): string {
    if (formula) return `=${formula}`
    if (value === null || value === undefined) return ""
    switch (cellType) {
      case "b":
        return value ? "TRUE" : "FALSE"
      case "d":
        if (value instanceof Date) return value.toISOString().split("T")[0]
        return String(value)
      case "e":
        return ERROR_CODES[value as number] ?? "#ERROR!"
      case "z":
        return ""
      default:
        return String(value)
    }
  }

  export function formatAsMarkdown(headers: string[], rows: string[][]): string {
    const headerLine = `| ${headers.join(" | ")} |`
    const separator = `|${headers.map((h) => "-".repeat(Math.max(h.length, 3) + 2)).join("|")}|`
    const dataLines = rows.map((row) => `| ${row.join(" | ")} |`)
    return [headerLine, separator, ...dataLines].join("\n")
  }

  function csvEscape(value: string): string {
    if (value.includes(",") || value.includes('"') || value.includes("\n")) {
      return `"${value.replace(/"/g, '""')}"`
    }
    return value
  }

  export function formatAsCsv(headers: string[], rows: string[][]): string {
    const headerLine = headers.map(csvEscape).join(",")
    const dataLines = rows.map((row) => row.map(csvEscape).join(","))
    return [headerLine, ...dataLines].join("\n")
  }

  export function formatAsJson(headers: string[], rows: string[][]): string {
    const objects = rows.map((row) => {
      const obj: Record<string, string> = {}
      for (let i = 0; i < headers.length; i++) {
        obj[headers[i]] = row[i] ?? ""
      }
      return obj
    })
    return JSON.stringify(objects, null, 2)
  }

  export interface SheetInfo {
    name: string
    header: HeaderRegion
    headerNames: string[]
    dataStartRow: number
    totalDataRows: number
    totalCols: number
  }

  export function analyzeSheet(ws: XLSX.WorkSheet, sheetName: string): SheetInfo {
    const header = detectHeaderRegion(ws)
    const ref = ws["!ref"]
    if (!ref) {
      return {
        name: sheetName,
        header,
        headerNames: [],
        dataStartRow: 0,
        totalDataRows: 0,
        totalCols: 0,
      }
    }
    const range = XLSX.utils.decode_range(ref)
    const totalCols = range.e.c - range.s.c + 1

    const headerNames: string[] = []
    for (let c = range.s.c; c <= range.e.c; c++) {
      const addr = XLSX.utils.encode_cell({ r: header.headerDefinitionRow, c })
      const cell = ws[addr]
      headerNames.push(cell && cell.v !== undefined ? String(cell.v) : `Column${c + 1}`)
    }

    const totalDataRows = Math.max(0, range.e.r - header.dataStartRow + 1)

    return {
      name: sheetName,
      header,
      headerNames,
      dataStartRow: header.dataStartRow,
      totalDataRows,
      totalCols,
    }
  }

  export function buildSchemaSummary(wb: XLSX.WorkBook, sheetNames?: string[]): string {
    const parts: string[] = []
    const sheets = sheetNames ?? wb.SheetNames

    for (const sheetName of sheets) {
      const ws = wb.Sheets[sheetName]
      if (!ws) continue

      const info = analyzeSheet(ws, sheetName)
      const ref = ws["!ref"]
      const range = ref ? XLSX.utils.decode_range(ref) : null

      let sheetSummary = `Sheet "${sheetName}": ${info.totalDataRows} data rows × ${info.totalCols} columns`

      for (const title of info.header.titleRows) {
        sheetSummary += `\n  Title: "${title.value}" (${title.mergeRange})`
      }
      for (const sub of info.header.subHeaders) {
        sheetSummary += `\n  Group: "${sub.value}" (${sub.mergeRange})`
      }

      sheetSummary += `\n  Header definition row: ${info.header.headerDefinitionRow + 1}`
      sheetSummary += `\n  Data starts at row: ${info.dataStartRow + 1}`

      if (range && info.totalDataRows > 0) {
        sheetSummary += "\n\n  | # | Column | Type | Sample Values |"
        sheetSummary += "\n  |---|--------|------|---------------|"

        for (let ci = 0; ci < info.headerNames.length; ci++) {
          const colIdx = (range?.s.c ?? 0) + ci
          const sampleValues: unknown[] = []
          const sampleRaw: unknown[] = []
          let hasFormula = false
          for (let r = info.dataStartRow; r <= range.e.r && sampleValues.length < 3; r++) {
            const addr = XLSX.utils.encode_cell({ r, c: colIdx })
            const cell = ws[addr]
            if (cell && cell.v !== undefined && cell.v !== "") {
              if (cell.f) hasFormula = true
              sampleValues.push(cell.f ? `=${cell.f}` : cell.v)
              sampleRaw.push(cell.v)
            }
          }

          const type = hasFormula ? "formula" : detectColumnType(sampleRaw)

          const samples = sampleValues.map((v) => (typeof v === "string" ? `"${v}"` : String(v))).join(", ")

          sheetSummary += `\n  | ${ci + 1} | ${info.headerNames[ci]} | ${type} | ${samples} |`
        }
      }

      parts.push(sheetSummary)
    }

    return parts.join("\n\n")
  }
}
