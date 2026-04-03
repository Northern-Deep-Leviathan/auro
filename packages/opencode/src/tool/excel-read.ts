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
    sheet: z.string().describe("Sheet name to read. Use excel_sheets to discover available sheets"),
    offset: z.coerce
      .number()
      .optional()
      .describe("0-indexed row to start from (relative to raw sheet row 0). Default: 0"),
    limit: z.coerce
      .number()
      .optional()
      .describe("Max rows to return. Default is model-aware. Use 0 for dimensions-only mode"),
    columns: z
      .array(z.union([z.string(), z.number()]))
      .optional()
      .describe("Column letters (e.g. 'A', 'C') or 0-based indices to include. If omitted, includes all columns"),
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

    if (!wb.SheetNames.includes(params.sheet)) {
      throw new Error(`Error: Sheet '${params.sheet}' not found. Available sheets: ${wb.SheetNames.join(", ")}`)
    }

    const ws = wb.Sheets[params.sheet]
    if (!ws) {
      throw new Error(`Error: Sheet '${params.sheet}' not found. Available sheets: ${wb.SheetNames.join(", ")}`)
    }

    const ref = ws["!ref"]
    if (!ref) {
      const output = [
        `<excel_read path="${filepath}" sheet="${params.sheet}">`,
        `<dimensions rows="0" cols="0" merges="0" />`,
        `</excel_read>`,
      ].join("\n")

      FileTime.read(ctx.sessionID, filepath)

      return {
        title,
        output,
        metadata: {
          truncated: false,
          rows: 0,
          cols: 0,
          merges: 0,
          hasMore: false,
          outputRows: 0,
        },
      }
    }

    const range = XLSX.utils.decode_range(ref)
    const totalRows = range.e.r - range.s.r + 1
    const totalCols = range.e.c - range.s.c + 1
    const mergeCount = (ws["!merges"] || []).length

    const model = ctx.extra?.model as { limit?: { context?: number } } | undefined

    // Resolve column indices
    let columnIndices: number[] | undefined
    if (params.columns) {
      columnIndices = params.columns.map((col) => {
        if (typeof col === "number") {
          const absCol = range.s.c + col
          if (absCol < range.s.c || absCol > range.e.c) {
            throw new Error(`Error: Column index ${col} is out of range. Valid range: 0-${totalCols - 1}`)
          }
          return absCol
        }
        const idx = ExcelUtil.letterToColIndex(col)
        if (idx < range.s.c || idx > range.e.c) {
          throw new Error(
            `Error: Column '${col}' is out of range. Valid columns: ${ExcelUtil.colLetterRange(range.s.c, range.e.c)}`,
          )
        }
        return idx
      })
    }

    const effectiveCols = columnIndices ? columnIndices.length : totalCols
    const defaultLimit = ExcelUtil.defaultRowLimit(effectiveCols, model)
    const limit = params.limit !== undefined ? params.limit : defaultLimit
    const offset = params.offset ?? 0

    const startRow = range.s.r + offset

    // Dimensions-only mode
    if (limit === 0) {
      const output = [
        `<excel_read path="${filepath}" sheet="${params.sheet}">`,
        `<dimensions rows="${totalRows}" cols="${totalCols}" merges="${mergeCount}" />`,
        `</excel_read>`,
      ].join("\n")

      FileTime.read(ctx.sessionID, filepath)

      return {
        title,
        output,
        metadata: {
          truncated: false,
          rows: totalRows,
          cols: totalCols,
          merges: mergeCount,
          hasMore: false,
          outputRows: 0,
        },
      }
    }

    // Offset beyond available rows
    if (startRow > range.e.r) {
      const output = [
        `<excel_read path="${filepath}" sheet="${params.sheet}">`,
        `<dimensions rows="${totalRows}" cols="${totalCols}" merges="${mergeCount}" />`,
        `Warning: offset ${offset} exceeds total rows (${totalRows}). No rows to show.`,
        `</excel_read>`,
      ].join("\n")

      FileTime.read(ctx.sessionID, filepath)

      return {
        title,
        output,
        metadata: {
          truncated: false,
          rows: totalRows,
          cols: totalCols,
          merges: mergeCount,
          hasMore: false,
          outputRows: 0,
        },
      }
    }

    const endRow = Math.min(startRow + limit - 1, range.e.r)
    const outputRows = endRow - startRow + 1
    const hasMore = endRow < range.e.r
    const truncated = hasMore

    const grid = ExcelUtil.renderSpatialGrid(ws, {
      startRow,
      endRow,
      columns: columnIndices,
    })

    const parts: string[] = [
      `<excel_read path="${filepath}" sheet="${params.sheet}">`,
      `<dimensions rows="${totalRows}" cols="${totalCols}" merges="${mergeCount}" />`,
      `<grid>`,
      grid,
      `</grid>`,
    ]

    const nextOffset = offset + outputRows
    parts.push(`<pagination offset="${offset}" limit="${limit}" hasMore="${hasMore}" nextOffset="${nextOffset}" />`)

    if (truncated) {
      parts.push(`(Showing rows ${offset}-${offset + outputRows - 1} of ${totalRows}. Use offset=${nextOffset} to continue reading.)`)
    }
    if (totalRows >= 500) {
      parts.push(
        `(This sheet has ${totalRows} rows. For large-scale analysis, consider writing a TypeScript script using the xlsx package and executing it with BashTool.)`,
      )
    }
    if (totalCols >= 30) {
      parts.push(`(This sheet has ${totalCols} columns. Consider using the 'columns' parameter to select only relevant columns.)`)
    }

    parts.push(`</excel_read>`)

    const output = parts.join("\n")

    FileTime.read(ctx.sessionID, filepath)

    return {
      title,
      output,
      metadata: {
        truncated,
        rows: totalRows,
        cols: totalCols,
        merges: mergeCount,
        hasMore,
        outputRows,
      },
    }
  },
})
