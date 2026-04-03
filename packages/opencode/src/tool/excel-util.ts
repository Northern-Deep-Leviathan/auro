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

  const CONTENT_WIDTH_CAP = 40
  const COLUMN_SEPARATOR = "  "
  const EMPTY_CELL = "\u00B7"

  export interface SpatialGridOptions {
    startRow: number
    endRow: number
    columns?: number[]
  }

  export function letterToColIndex(letter: string): number {
    let result = 0
    const upper = letter.toUpperCase()
    for (let i = 0; i < upper.length; i++) {
      result = result * 26 + (upper.charCodeAt(i) - 64)
    }
    return result - 1 // 0-indexed
  }

  export function colLetterRange(startCol: number, endCol: number): string {
    const letters: string[] = []
    for (let c = startCol; c <= endCol; c++) {
      letters.push(colLetter(c))
    }
    return letters.join(", ")
  }

  export function colLetter(c: number): string {
    let s = ""
    let n = c
    while (n >= 0) {
      s = String.fromCharCode((n % 26) + 65) + s
      n = Math.floor(n / 26) - 1
    }
    return s
  }

  function isCoveredByMerge(
    merges: XLSX.Range[],
    r: number,
    c: number,
  ): { covered: boolean; isOrigin: boolean; merge?: XLSX.Range } {
    for (const m of merges) {
      if (r >= m.s.r && r <= m.e.r && c >= m.s.c && c <= m.e.c) {
        const isOrigin = r === m.s.r && c === m.s.c
        return { covered: true, isOrigin, merge: m }
      }
    }
    return { covered: false, isOrigin: false }
  }

  function truncateValue(s: string, cap: number): string {
    if (s.length <= cap) return s
    return s.slice(0, cap - 3) + "..."
  }

  export function renderSpatialGrid(ws: XLSX.WorkSheet, opts: SpatialGridOptions): string {
    const ref = ws["!ref"]
    if (!ref) return ""

    const range = XLSX.utils.decode_range(ref)
    const merges = ws["!merges"] || []

    const colIndices = opts.columns ?? Array.from({ length: range.e.c - range.s.c + 1 }, (_, i) => range.s.c + i)

    const rowData: Array<{ rowIdx: number; cells: Map<number, string>; isEmpty: boolean }> = []
    const colWidths = new Map<number, number>()

    for (const ci of colIndices) {
      const letter = colLetter(ci)
      colWidths.set(ci, letter.length)
    }

    for (let r = opts.startRow; r <= opts.endRow && r <= range.e.r; r++) {
      const cells = new Map<number, string>()
      let isEmpty = true

      for (const ci of colIndices) {
        const mergeInfo = isCoveredByMerge(merges, r, ci)

        if (mergeInfo.covered && !mergeInfo.isOrigin) {
          continue
        }

        if (mergeInfo.isOrigin && mergeInfo.merge) {
          const m = mergeInfo.merge
          const addr = XLSX.utils.encode_cell({ r: m.s.r, c: m.s.c })
          const cell = ws[addr]
          const value = cell ? formatCellValue(cell.v, cell.t, cell.f) : ""
          const rangeStr = XLSX.utils.encode_range(m)
          const display = value ? `[== ${truncateValue(value, CONTENT_WIDTH_CAP)} (${rangeStr}) ==]` : EMPTY_CELL
          cells.set(ci, display)
          isEmpty = false
          const w = display.length
          colWidths.set(ci, Math.max(colWidths.get(ci) ?? 0, w))
          continue
        }

        const addr = XLSX.utils.encode_cell({ r, c: ci })
        const cell = ws[addr]
        if (!cell || cell.v === undefined || cell.v === null || cell.v === "") {
          cells.set(ci, EMPTY_CELL)
        } else {
          const raw = formatCellValue(cell.v, cell.t, cell.f)
          const display = truncateValue(raw, CONTENT_WIDTH_CAP)
          cells.set(ci, display)
          isEmpty = false
          const w = display.length
          colWidths.set(ci, Math.max(colWidths.get(ci) ?? 0, w))
        }
      }

      rowData.push({ rowIdx: r, cells, isEmpty })
    }

    for (const [ci, w] of colWidths) {
      colWidths.set(ci, Math.min(w, CONTENT_WIDTH_CAP + 20))
    }

    const lines: string[] = []

    const prefix = "     "
    const headerParts: string[] = []
    for (const ci of colIndices) {
      const letter = colLetter(ci)
      const width = colWidths.get(ci) ?? letter.length
      headerParts.push(letter.padEnd(width))
    }
    lines.push(prefix + headerParts.join(COLUMN_SEPARATOR))

    for (const row of rowData) {
      if (row.isEmpty) {
        lines.push(`R${row.rowIdx}:`)
        continue
      }

      const rowPrefix = `R${row.rowIdx}:`.padEnd(5)
      const cellParts: string[] = []
      for (const ci of colIndices) {
        const width = colWidths.get(ci) ?? 1
        const display = row.cells.get(ci)
        if (display === undefined) {
          cellParts.push(" ".repeat(width))
        } else {
          cellParts.push(display.padEnd(width))
        }
      }
      lines.push(rowPrefix + cellParts.join(COLUMN_SEPARATOR))
    }

    return lines.join("\n")
  }
}
