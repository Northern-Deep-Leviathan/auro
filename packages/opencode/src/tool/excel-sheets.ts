import z from "zod"
import * as path from "path"
import * as XLSX from "xlsx"
import { Tool } from "./tool"
import { FileTime } from "../file/time"
import DESCRIPTION from "./excel-sheets.txt"
import { Instance } from "../project/instance"
import { assertExternalDirectory } from "./external-directory"
import { ExcelUtil } from "./excel-util"

const MAX_FILE_SIZE = 100 * 1024 * 1024

export const ExcelSheetsTool = Tool.define("excel_sheets", {
  description: DESCRIPTION,
  parameters: z.object({
    filePath: z.string().describe("Absolute path to the spreadsheet file"),
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
      throw new Error(`Error: File is ${sizeMB}MB. Maximum supported size is 100MB.`)
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
        cellFormula: false,
        cellDates: false,
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

    const sheets: Array<{ name: string; rows: number; cols: number; merges: number }> = []

    for (const sheetName of wb.SheetNames) {
      const ws = wb.Sheets[sheetName]
      if (!ws) {
        sheets.push({ name: sheetName, rows: 0, cols: 0, merges: 0 })
        continue
      }
      const ref = ws["!ref"]
      if (!ref) {
        sheets.push({ name: sheetName, rows: 0, cols: 0, merges: 0 })
        continue
      }
      const range = XLSX.utils.decode_range(ref)
      const rows = range.e.r - range.s.r + 1
      const cols = range.e.c - range.s.c + 1
      const mergeCount = ws["!merges"]?.length ?? 0
      sheets.push({ name: sheetName, rows, cols, merges: mergeCount })
    }

    FileTime.read(ctx.sessionID, filepath)

    const sheetXml = sheets
      .map((s) => `  <sheet name="${s.name}" rows="${s.rows}" cols="${s.cols}" merges="${s.merges}" />`)
      .join("\n")

    const output = [
      `<excel_sheets path="${title}">`,
      sheetXml,
      `  <total sheets="${sheets.length}" />`,
      `</excel_sheets>`,
    ].join("\n")

    return {
      title,
      output,
      metadata: {
        sheets,
        totalSheets: sheets.length,
      },
    }
  },
})
