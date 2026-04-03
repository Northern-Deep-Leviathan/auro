import { describe, expect, test } from "bun:test"
import path from "path"
import XLSX from "xlsx"
import { ExcelSheetsTool } from "../../src/tool/excel-sheets"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

const ctx = {
  sessionID: "test",
  messageID: "",
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => {},
  ask: async () => {},
}

function createTestXlsx(dir: string, filename: string, data: unknown[][]): string {
  const ws = XLSX.utils.aoa_to_sheet(data)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1")
  const filepath = path.join(dir, filename)
  XLSX.writeFile(wb, filepath)
  return filepath
}

describe("ExcelSheetsTool basic manifest", () => {
  test("returns manifest for single-sheet file", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        createTestXlsx(dir, "single.xlsx", [
          ["Name", "Age"],
          ["Alice", 30],
          ["Bob", 25],
        ])
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await ExcelSheetsTool.init()
        const result = await tool.execute({ filePath: path.join(tmp.path, "single.xlsx") }, ctx)
        expect(result.output).toContain("<excel_sheets")
        expect(result.output).toContain('name="Sheet1"')
        expect(result.output).toContain('rows="3"')
        expect(result.output).toContain('cols="2"')
        expect(result.output).toContain("<total")
        expect(result.output).toContain('sheets="1"')
        expect(result.metadata.totalSheets).toBe(1)
        expect(result.metadata.sheets).toHaveLength(1)
        expect(result.metadata.sheets[0].name).toBe("Sheet1")
        expect(result.metadata.sheets[0].rows).toBe(3)
        expect(result.metadata.sheets[0].cols).toBe(2)
      },
    })
  })

  test("returns manifest for multi-sheet file", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const ws1 = XLSX.utils.aoa_to_sheet([["A"], [1], [2]])
        const ws2 = XLSX.utils.aoa_to_sheet([["B", "C"], [1, 2]])
        const wb = XLSX.utils.book_new()
        XLSX.utils.book_append_sheet(wb, ws1, "Data")
        XLSX.utils.book_append_sheet(wb, ws2, "Summary")
        XLSX.writeFile(wb, path.join(dir, "multi.xlsx"))
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await ExcelSheetsTool.init()
        const result = await tool.execute({ filePath: path.join(tmp.path, "multi.xlsx") }, ctx)
        expect(result.metadata.totalSheets).toBe(2)
        expect(result.metadata.sheets[0].name).toBe("Data")
        expect(result.metadata.sheets[0].rows).toBe(3)
        expect(result.metadata.sheets[0].cols).toBe(1)
        expect(result.metadata.sheets[1].name).toBe("Summary")
        expect(result.metadata.sheets[1].rows).toBe(2)
        expect(result.metadata.sheets[1].cols).toBe(2)
        expect(result.output).toContain('sheets="2"')
      },
    })
  })

  test("reports merge count per sheet", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const ws = XLSX.utils.aoa_to_sheet([
          ["Title", null, null],
          ["A", "B", "C"],
        ])
        ws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 2 } }]
        const wb = XLSX.utils.book_new()
        XLSX.utils.book_append_sheet(wb, ws, "Merged")
        XLSX.writeFile(wb, path.join(dir, "merged.xlsx"))
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await ExcelSheetsTool.init()
        const result = await tool.execute({ filePath: path.join(tmp.path, "merged.xlsx") }, ctx)
        expect(result.metadata.sheets[0].merges).toBe(1)
        expect(result.output).toContain('merges="1"')
      },
    })
  })
})

describe("ExcelSheetsTool error handling", () => {
  test("throws for file not found", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await ExcelSheetsTool.init()
        await expect(
          tool.execute({ filePath: path.join(tmp.path, "nonexistent.xlsx") }, ctx),
        ).rejects.toThrow("File not found")
      },
    })
  })

  test("throws for unsupported format", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "doc.pdf"), "fake")
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await ExcelSheetsTool.init()
        await expect(
          tool.execute({ filePath: path.join(tmp.path, "doc.pdf") }, ctx),
        ).rejects.toThrow("Unsupported file format")
      },
    })
  })

  test("throws for corrupted file", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const corrupt = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0xff, 0xfe, 0x00, 0x00, 0xde, 0xad])
        await Bun.write(path.join(dir, "corrupt.xlsx"), corrupt)
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await ExcelSheetsTool.init()
        await expect(
          tool.execute({ filePath: path.join(tmp.path, "corrupt.xlsx") }, ctx),
        ).rejects.toThrow("Failed to parse spreadsheet")
      },
    })
  })
})

describe("ExcelSheetsTool permissions", () => {
  test("asks for read permission", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        createTestXlsx(dir, "perm.xlsx", [["A"], [1]])
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await ExcelSheetsTool.init()
        const requests: Array<{ permission: string; patterns: string[] }> = []
        const testCtx = {
          ...ctx,
          ask: async (req: any) => {
            requests.push(req)
          },
        }
        await tool.execute({ filePath: path.join(tmp.path, "perm.xlsx") }, testCtx)
        const readReq = requests.find((r) => r.permission === "read")
        expect(readReq).toBeDefined()
        expect(readReq!.patterns[0]).toContain("perm.xlsx")
      },
    })
  })
})
