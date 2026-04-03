import z from "zod"
import * as path from "path"
import * as XLSX from "xlsx"
import { Tool } from "./tool"
import { Bus } from "../bus"
import { File } from "../file"
import { FileWatcher } from "../file/watcher"
import { FileTime } from "../file/time"
import { Filesystem } from "../util/filesystem"
import DESCRIPTION from "./excel-write.txt"
import { Instance } from "../project/instance"
import { assertExternalDirectory } from "./external-directory"
import { ExcelUtil } from "./excel-util"

const MAX_XLSX_ROWS = 1048576
const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/

const BOOK_TYPE_MAP: Record<string, XLSX.BookType> = {
  ".xlsx": "xlsx",
  ".xls": "biff8",
  ".csv": "csv",
  ".ods": "ods",
}

function timestampedPath(filepath: string): string {
  const dir = path.dirname(filepath)
  const ext = path.extname(filepath)
  const stem = path.basename(filepath, ext)
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, "0")
  const ts =
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
    `_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  return path.join(dir, `${stem}_${ts}${ext}`)
}

export const ExcelWriteTool = Tool.define("excel_write", {
  description: DESCRIPTION,
  parameters: z.object({
    filePath: z
      .string()
      .describe(
        "Absolute output path. Supported extensions: .xlsx, .xls, .csv, .ods. " +
          "If no extension or unsupported extension, defaults to .xlsx",
      ),
    sheets: z
      .array(
        z.object({
          name: z.string().describe("Sheet name"),
          headers: z.array(z.string()).describe("Column header names"),
          rows: z
            .array(z.array(z.union([z.string(), z.number(), z.boolean(), z.null()])))
            .describe(
              "2D array of cell values. Conventions: " +
                "strings starting with '=' are formulas (e.g. '=SUM(A1:A10)'); " +
                "strings matching YYYY-MM-DD are written as Excel date cells; " +
                "null produces an empty cell.",
            ),
          columnWidths: z.array(z.number()).optional().describe("Column widths in characters (optional)"),
        }),
      )
      .describe("Array of sheets to create"),
  }),
  async execute(params, ctx) {
    let filepath = params.filePath
    if (!path.isAbsolute(filepath)) {
      filepath = path.resolve(Instance.directory, filepath)
    }

    // Normalize extension
    let ext = path.extname(filepath).toLowerCase()
    let warning = ""

    if (!ext) {
      filepath += ".xlsx"
      ext = ".xlsx"
    } else if (!ExcelUtil.WRITE_EXTENSIONS.has(ext)) {
      const oldExt = ext
      if (oldExt === ".xlsm") {
        warning =
          "Note: Extension '.xlsm' was changed to '.xlsx'. " +
          "VBA macros cannot be preserved by the tool. Data and formulas are retained."
      } else {
        warning =
          `Note: Unsupported extension '${oldExt}' was changed to '.xlsx'. ` + "Supported: .xlsx, .xls, .csv, .ods"
      }
      filepath = filepath.slice(0, -oldExt.length) + ".xlsx"
      ext = ".xlsx"
    }

    const bookType = BOOK_TYPE_MAP[ext] ?? "xlsx"

    await assertExternalDirectory(ctx, filepath)

    // Validate row counts
    for (const sheet of params.sheets) {
      if (sheet.rows.length > MAX_XLSX_ROWS) {
        throw new Error(
          `Error: Sheet '${sheet.name}' has ${sheet.rows.length} rows, ` +
            `exceeding the XLSX limit of ${MAX_XLSX_ROWS.toLocaleString()}.`,
        )
      }
    }

    // Build workbook
    const wb = XLSX.utils.book_new()

    for (const sheet of params.sheets) {
      const aoa: unknown[][] = [sheet.headers, ...sheet.rows]
      const ws = XLSX.utils.aoa_to_sheet(aoa)

      // Post-process cells for formulas and dates
      const range = XLSX.utils.decode_range(ws["!ref"]!)
      for (let r = range.s.r + 1; r <= range.e.r; r++) {
        for (let c = range.s.c; c <= range.e.c; c++) {
          const addr = XLSX.utils.encode_cell({ r, c })
          const cell = ws[addr]
          if (!cell) continue

          if (typeof cell.v === "string") {
            if (cell.v.startsWith("=")) {
              cell.f = cell.v.slice(1)
              // SheetJS CE 0.18 drops formula-only cells; keep a cached value
              cell.v = 0
              cell.t = "n"
            } else if (cell.v.startsWith("'") && ISO_DATE_REGEX.test(cell.v.slice(1))) {
              // Escape hatch: single-quote prefix forces string
              cell.v = cell.v.slice(1)
              cell.t = "s"
            } else if (ISO_DATE_REGEX.test(cell.v)) {
              const parsed = Date.parse(cell.v)
              if (!isNaN(parsed)) {
                cell.v = new Date(parsed)
                cell.t = "d"
              }
            }
          }
        }
      }

      // Apply column widths
      if (sheet.columnWidths) {
        ws["!cols"] = sheet.columnWidths.map((w) => ({ wch: w }))
      }

      XLSX.utils.book_append_sheet(wb, ws, sheet.name)
    }

    // Overwrite protection: redirect to timestamped filename if file exists
    const exists = await Filesystem.exists(filepath)
    let actualPath = filepath
    let redirectWarning = ""

    if (exists) {
      actualPath = timestampedPath(filepath)
      const originalName = path.basename(filepath)
      const newName = path.basename(actualPath)
      redirectWarning =
        `Note: File '${originalName}' already exists. Writing to '${newName}' to preserve the original. ` +
        "Direct overwrite will be supported when in-place editing ships (V2)."
    }

    // Permission check with preview
    const previewLines = params.sheets.map((s) => {
      const firstRows = s.rows.slice(0, 3).map((row) => row.map((v) => (v === null ? "" : String(v))).join(", "))
      return (
        `Sheet "${s.name}": ${s.rows.length} rows × ${s.headers.length} columns\n` +
        `  Headers: ${s.headers.join(", ")}\n` +
        firstRows.map((r) => `  ${r}`).join("\n")
      )
    })

    const relativePath = path.relative(Instance.worktree, actualPath)
    await ctx.ask({
      permission: "edit",
      patterns: [relativePath],
      always: ["*"],
      metadata: {
        filepath: actualPath,
        preview: previewLines.join("\n\n"),
      },
    })

    // Write file with lock to prevent concurrent write races
    await FileTime.withLock(actualPath, async () => {
      const buffer = XLSX.write(wb, { type: "buffer", bookType })
      await Bun.write(actualPath, buffer)

      await Bus.publish(File.Event.Edited, { file: actualPath })
      await Bus.publish(FileWatcher.Event.Updated, {
        file: actualPath,
        event: "add",
      })
      FileTime.read(ctx.sessionID, actualPath)
    })

    // Build output
    const sheetSummaries = params.sheets
      .map((s) => `  Sheet '${s.name}': ${s.rows.length} rows × ${s.headers.length} columns`)
      .join("\n")

    let output = `Wrote Excel file successfully.\n${sheetSummaries}`

    if (exists) {
      output += `\n  Path: ${path.basename(actualPath)}`
      output += `\n  (Original '${path.basename(filepath)}' preserved)`
    }

    const hasFormulas = params.sheets.some((s) =>
      s.rows.some((row) => row.some((cell) => typeof cell === "string" && cell.startsWith("="))),
    )
    if (hasFormulas) {
      output += "\n  Formulas will be calculated when opened in Excel."
    }

    if (warning) {
      output = `${warning}\n\n${output}`
    }

    if (redirectWarning) {
      output = `${redirectWarning}\n\n${output}`
    }

    return {
      title: relativePath,
      output,
      metadata: {
        filepath: actualPath,
        requestedPath: filepath,
        redirected: exists,
        sheets: params.sheets.map((s) => ({
          name: s.name,
          rows: s.rows.length,
          columns: s.headers.length,
        })),
      },
    }
  },
})
