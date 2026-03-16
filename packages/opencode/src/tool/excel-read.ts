import z from "zod"
import * as path from "path"
import * as XLSX from "xlsx"
import { Tool } from "./tool"
import { FileTime } from "../file/time"
import DESCRIPTION from "./excel-read.txt"
import { Instance } from "../project/instance"
import { assertExternalDirectory } from "./external-directory"
import { ExcelUtil } from "./excel-util"

const MAX_FILE_SIZE = 100 * 1024 * 1024

export const ExcelReadTool = Tool.define("excel_read", {
  description: DESCRIPTION,
  parameters: z.object({
    filePath: z.string().describe("Absolute path to the spreadsheet file"),
    sheet: z.string().optional().describe("Sheet name to read. If omitted, reads all sheets"),
    offset: z.coerce
      .number()
      .optional()
      .describe("1-indexed data row to start from (default: 1). Header rows are always included regardless of offset"),
    limit: z.coerce
      .number()
      .optional()
      .describe("Max data rows to return. Default is model-aware. Use 0 for schema-only mode"),
    columns: z
      .array(z.union([z.string(), z.number()]))
      .optional()
      .describe("Column names or 0-based indices to include. If omitted, includes all columns"),
    format: z
      .enum(["markdown", "csv", "json"])
      .optional()
      .describe('Output format for data rows (default: "markdown")'),
  }),
  async execute(params, ctx) {
    let filepath = params.filePath
    if (!path.isAbsolute(filepath)) {
      filepath = path.resolve(Instance.directory, filepath)
    }
    const title = path.relative(Instance.worktree, filepath)

    await assertExternalDirectory(ctx, filepath, {
      bypass: Boolean(ctx.extra?.["bypassCwdCheck"]),
    })

    await ctx.ask({
      permission: "read",
      patterns: [filepath],
      always: ["*"],
      metadata: {},
    })

    const exists = await Bun.file(filepath).exists()
    if (!exists) {
      throw new Error(`Error: File not found: ${filepath}`)
    }

    const ext = path.extname(filepath).toLowerCase()
    if (ext && !ExcelUtil.SPREADSHEET_EXTENSIONS.has(ext)) {
      throw new Error(
        `Error: Unsupported file format '${ext}'. Supported: .xlsx, .xls, .xlsb, .xlsm, .csv, .ods, .numbers, and more.`,
      )
    }

    const file = Bun.file(filepath)
    const fileSize = file.size
    if (fileSize > MAX_FILE_SIZE) {
      const sizeMB = (fileSize / (1024 * 1024)).toFixed(1)
      throw new Error(
        `Error: File is ${sizeMB}MB. Maximum supported size is 100MB. For very large files, consider splitting or using a script.`,
      )
    }

    let buffer: ArrayBuffer
    try {
      buffer = await file.arrayBuffer()
    } catch {
      throw new Error(`Error: Failed to read file: ${filepath}`)
    }

    let wb: XLSX.WorkBook
    try {
      wb = XLSX.read(buffer, {
        cellFormula: true,
        cellDates: true,
        sheetStubs: true,
      })
    } catch (e) {
      if (e instanceof Error && e.message.includes("password")) {
        throw new Error("Error: This file is password-protected. SheetJS cannot open encrypted workbooks.")
      }
      throw new Error(
        `Error: Failed to parse spreadsheet: ${e instanceof Error ? e.message : String(e)}. The file may be corrupted.`,
      )
    }

    if (params.sheet && !wb.SheetNames.includes(params.sheet)) {
      throw new Error(`Error: Sheet '${params.sheet}' not found. Available sheets: ${wb.SheetNames.join(", ")}`)
    }

    const sheetsToRead = params.sheet ? [params.sheet] : wb.SheetNames
    const format = params.format ?? "markdown"

    const model = ctx.extra?.model as { limit?: { context?: number } } | undefined

    const schemaSummary = ExcelUtil.buildSchemaSummary(wb, sheetsToRead)

    const sheetOutputs: string[] = []
    const sheetMeta: Array<{
      name: string
      rows: number
      columns: number
      headerRows: number
    }> = []
    let totalRows = 0
    let anyTruncated = false

    for (const sheetName of sheetsToRead) {
      const ws = wb.Sheets[sheetName]
      if (!ws) continue

      const info = ExcelUtil.analyzeSheet(ws, sheetName)
      const ref = ws["!ref"]
      if (!ref) {
        sheetMeta.push({ name: sheetName, rows: 0, columns: 0, headerRows: 0 })
        continue
      }

      const range = XLSX.utils.decode_range(ref)

      let columnIndices: number[] | undefined
      if (params.columns) {
        columnIndices = params.columns.map((col) => {
          if (typeof col === "number") {
            if (col < 0 || col >= info.totalCols) {
              throw new Error(`Error: Column index ${col} is out of range. Valid range: 0-${info.totalCols - 1}`)
            }
            return col
          }
          const idx = info.headerNames.indexOf(col)
          if (idx === -1) {
            throw new Error(`Error: Column '${col}' not found. Available columns: ${info.headerNames.join(", ")}`)
          }
          return idx
        })
      }

      const effectiveHeaders = columnIndices ? columnIndices.map((i) => info.headerNames[i]) : info.headerNames

      const defaultLimit = ExcelUtil.defaultRowLimit(effectiveHeaders.length, model)
      const limit = params.limit !== undefined ? params.limit : defaultLimit
      const offset = params.offset ?? 1

      if (limit === 0) {
        sheetMeta.push({
          name: sheetName,
          rows: info.totalDataRows,
          columns: info.totalCols,
          headerRows: info.dataStartRow,
        })
        totalRows += info.totalDataRows
        continue
      }

      const startRow = info.dataStartRow + (offset - 1)
      if (offset > info.totalDataRows && info.totalDataRows > 0) {
        sheetOutputs.push(
          `<sheet name="${sheetName}">\n` +
            `Warning: Offset ${offset} exceeds total data rows (${info.totalDataRows}). No data rows to show.\n` +
            `</sheet>`,
        )
        sheetMeta.push({
          name: sheetName,
          rows: info.totalDataRows,
          columns: info.totalCols,
          headerRows: info.dataStartRow,
        })
        totalRows += info.totalDataRows
        continue
      }

      const endRow = Math.min(startRow + limit - 1, range.e.r)
      const dataRows: string[][] = []

      for (let r = startRow; r <= endRow; r++) {
        const row: string[] = []
        const cols = columnIndices ?? Array.from({ length: info.totalCols }, (_, i) => i)
        for (const ci of cols) {
          const c = range.s.c + ci
          const addr = XLSX.utils.encode_cell({ r, c })
          const cell = ws[addr]
          if (!cell) {
            row.push("")
          } else {
            row.push(ExcelUtil.formatCellValue(cell.v, cell.t, cell.f))
          }
        }
        dataRows.push(row)
      }

      const rowsShown = dataRows.length
      const rowStart = offset
      const rowEnd = offset + rowsShown - 1
      const truncated = rowEnd < info.totalDataRows

      if (truncated) anyTruncated = true

      let formatted: string
      switch (format) {
        case "csv":
          formatted = ExcelUtil.formatAsCsv(effectiveHeaders, dataRows)
          break
        case "json":
          formatted = ExcelUtil.formatAsJson(effectiveHeaders, dataRows)
          break
        default:
          formatted = ExcelUtil.formatAsMarkdown(effectiveHeaders, dataRows)
      }

      let sheetOutput =
        `<sheet name="${sheetName}">\n` +
        `<data format="${format}" rows="${rowStart}-${rowEnd}" total="${info.totalDataRows}">\n` +
        formatted +
        "\n</data>"

      if (truncated) {
        sheetOutput += `\n(Showing data rows ${rowStart}-${rowEnd} of ${info.totalDataRows}. Use offset=${rowEnd + 1} to continue reading.)`
      }
      if (info.totalDataRows >= 500) {
        sheetOutput += `\n(This sheet has ${info.totalDataRows} rows. For large-scale analysis (aggregation, filtering, statistics), consider writing a TypeScript script using the xlsx package and executing it with BashTool.)`
      }
      if (info.totalCols >= 30) {
        sheetOutput += `\n(This sheet has ${info.totalCols} columns. Consider using the 'columns' parameter to select only relevant columns.)`
      }

      sheetOutput += "\n</sheet>"
      sheetOutputs.push(sheetOutput)

      sheetMeta.push({
        name: sheetName,
        rows: info.totalDataRows,
        columns: info.totalCols,
        headerRows: info.dataStartRow,
      })
      totalRows += info.totalDataRows
    }

    const output = [
      "<excel>",
      `<path>${filepath}</path>`,
      "",
      `<summary>\n${schemaSummary}\n</summary>`,
      "",
      ...sheetOutputs,
      "</excel>",
    ].join("\n")

    const firstSheet = sheetsToRead[0]
    let preview = ""
    if (firstSheet) {
      const ws = wb.Sheets[firstSheet]
      if (ws) {
        const info = ExcelUtil.analyzeSheet(ws, firstSheet)
        const ref = ws["!ref"]
        if (ref) {
          const range = XLSX.utils.decode_range(ref)
          const previewRows: string[][] = []
          for (let r = info.dataStartRow; r <= Math.min(info.dataStartRow + 9, range.e.r); r++) {
            const row: string[] = []
            for (let c = range.s.c; c <= range.e.c; c++) {
              const addr = XLSX.utils.encode_cell({ r, c })
              const cell = ws[addr]
              row.push(cell ? ExcelUtil.formatCellValue(cell.v, cell.t, cell.f) : "")
            }
            previewRows.push(row)
          }
          preview = ExcelUtil.formatAsMarkdown(info.headerNames, previewRows)
        }
      }
    }

    FileTime.read(ctx.sessionID, filepath)

    return {
      title,
      output,
      metadata: {
        preview,
        truncated: anyTruncated,
        sheets: sheetMeta,
        totalRows,
      },
    }
  },
})
