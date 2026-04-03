import { describe, expect, test } from "bun:test"
import path from "path"
import XLSX from "xlsx"
import { ExcelReadTool } from "../../src/tool/excel-read"
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

function createTestXlsx(dir: string, filename: string, data: unknown[][], sheetName = "Sheet1"): string {
  const ws = XLSX.utils.aoa_to_sheet(data)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, sheetName)
  const filepath = path.join(dir, filename)
  XLSX.writeFile(wb, filepath)
  return filepath
}

describe("spatial grid output", () => {
  test("reads a simple xlsx file and returns spatial grid", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        createTestXlsx(dir, "test.xlsx", [
          ["Name", "Age", "City"],
          ["Alice", 30, "NYC"],
          ["Bob", 25, "LA"],
        ])
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await ExcelReadTool.init()
        const result = await tool.execute({ filePath: path.join(tmp.path, "test.xlsx"), sheet: "Sheet1" }, ctx)
        expect(result.output).toContain("<excel_read")
        expect(result.output).toContain("</excel_read>")
        expect(result.output).toContain("<grid>")
        expect(result.output).toContain("</grid>")
        expect(result.output).toContain("<dimensions")
        expect(result.output).toContain("Name")
        expect(result.output).toContain("Alice")
        expect(result.output).toContain("Bob")
        expect(result.metadata.rows).toBe(3)
        expect(result.metadata.cols).toBe(3)
      },
    })
  })

  test("renders merged cells in spatial grid", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const ws = XLSX.utils.aoa_to_sheet([
          ["Title Here", null, null],
          ["Name", "Age", "City"],
          ["Alice", 30, "NYC"],
        ])
        ws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 2 } }]
        const wb = XLSX.utils.book_new()
        XLSX.utils.book_append_sheet(wb, ws, "Sheet1")
        XLSX.writeFile(wb, path.join(dir, "merged.xlsx"))
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await ExcelReadTool.init()
        const result = await tool.execute({ filePath: path.join(tmp.path, "merged.xlsx"), sheet: "Sheet1" }, ctx)
        expect(result.output).toContain("[== Title Here (A1:C1) ==]")
        expect(result.metadata.merges).toBe(1)
      },
    })
  })

  test("renders empty cells as middle dot", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        createTestXlsx(dir, "empty.xlsx", [
          ["A", null, "C"],
          [1, null, 3],
        ])
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await ExcelReadTool.init()
        const result = await tool.execute({ filePath: path.join(tmp.path, "empty.xlsx"), sheet: "Sheet1" }, ctx)
        expect(result.output).toContain("\u00B7")
      },
    })
  })
})

describe("dimensions-only mode", () => {
  test("limit=0 returns dimensions only (no grid)", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        createTestXlsx(dir, "dims.xlsx", [
          ["Name", "Age"],
          ["Alice", 30],
          ["Bob", 25],
        ])
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await ExcelReadTool.init()
        const result = await tool.execute(
          { filePath: path.join(tmp.path, "dims.xlsx"), sheet: "Sheet1", limit: 0 },
          ctx,
        )
        expect(result.output).toContain("<dimensions")
        expect(result.output).not.toContain("<grid>")
        expect(result.metadata.rows).toBe(3)
        expect(result.metadata.cols).toBe(2)
        expect(result.metadata.outputRows).toBe(0)
        expect(result.metadata.hasMore).toBe(false)
      },
    })
  })
})

describe("pagination", () => {
  test("respects offset and limit", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const data: unknown[][] = [["ID", "Value"]]
        for (let i = 1; i <= 50; i++) data.push([i, `val${i}`])
        createTestXlsx(dir, "pagination.xlsx", data)
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await ExcelReadTool.init()
        const result = await tool.execute(
          { filePath: path.join(tmp.path, "pagination.xlsx"), sheet: "Sheet1", offset: 5, limit: 5 },
          ctx,
        )
        expect(result.output).toContain("<pagination")
        expect(result.output).toContain('offset="5"')
        expect(result.output).toContain('limit="5"')
        expect(result.output).toContain('hasMore="true"')
        expect(result.metadata.hasMore).toBe(true)
        expect(result.metadata.outputRows).toBe(5)
      },
    })
  })

  test("hasMore is false when all rows are shown", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        createTestXlsx(dir, "small.xlsx", [
          ["Name", "Age"],
          ["Alice", 30],
        ])
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await ExcelReadTool.init()
        const result = await tool.execute(
          { filePath: path.join(tmp.path, "small.xlsx"), sheet: "Sheet1" },
          ctx,
        )
        expect(result.output).toContain('hasMore="false"')
        expect(result.metadata.hasMore).toBe(false)
        expect(result.metadata.outputRows).toBe(2)
      },
    })
  })

  test("offset exceeding rows shows warning", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        createTestXlsx(dir, "offset-exceed.xlsx", [
          ["Name"],
          ["Alice"],
          ["Bob"],
        ])
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await ExcelReadTool.init()
        const result = await tool.execute(
          { filePath: path.join(tmp.path, "offset-exceed.xlsx"), sheet: "Sheet1", offset: 100 },
          ctx,
        )
        expect(result.output).toContain("Warning")
        expect(result.output).toContain("exceeds total rows")
        expect(result.metadata.outputRows).toBe(0)
        expect(result.metadata.hasMore).toBe(false)
      },
    })
  })
})

describe("column filtering", () => {
  test("filters columns by letter", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        createTestXlsx(dir, "cols.xlsx", [
          ["Name", "Age", "City", "Country"],
          ["Alice", 30, "NYC", "USA"],
          ["Bob", 25, "LA", "USA"],
        ])
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await ExcelReadTool.init()
        const result = await tool.execute(
          { filePath: path.join(tmp.path, "cols.xlsx"), sheet: "Sheet1", columns: ["A", "C"] },
          ctx,
        )
        expect(result.output).toContain("Name")
        expect(result.output).toContain("City")
        expect(result.output).toContain("Alice")
        expect(result.output).toContain("NYC")
      },
    })
  })

  test("filters columns by index", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        createTestXlsx(dir, "cols-idx.xlsx", [
          ["Name", "Age", "City"],
          ["Alice", 30, "NYC"],
        ])
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await ExcelReadTool.init()
        const result = await tool.execute(
          { filePath: path.join(tmp.path, "cols-idx.xlsx"), sheet: "Sheet1", columns: [0, 2] },
          ctx,
        )
        expect(result.output).toContain("Name")
        expect(result.output).toContain("City")
        expect(result.output).toContain("Alice")
        expect(result.output).toContain("NYC")
      },
    })
  })

  test("throws for invalid column letter", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        createTestXlsx(dir, "cols-err.xlsx", [
          ["Name", "Age"],
          ["Alice", 30],
        ])
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await ExcelReadTool.init()
        await expect(
          tool.execute({ filePath: path.join(tmp.path, "cols-err.xlsx"), sheet: "Sheet1", columns: ["Z"] }, ctx),
        ).rejects.toThrow("out of range")
      },
    })
  })
})

describe("error handling", () => {
  test("throws for file not found", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await ExcelReadTool.init()
        await expect(
          tool.execute({ filePath: path.join(tmp.path, "nonexistent.xlsx"), sheet: "Sheet1" }, ctx),
        ).rejects.toThrow("File not found")
      },
    })
  })

  test("throws for sheet not found", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        createTestXlsx(dir, "sheets.xlsx", [["A"], [1]])
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await ExcelReadTool.init()
        await expect(
          tool.execute({ filePath: path.join(tmp.path, "sheets.xlsx"), sheet: "NoSuchSheet" }, ctx),
        ).rejects.toThrow("Sheet 'NoSuchSheet' not found")
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
        const tool = await ExcelReadTool.init()
        await expect(
          tool.execute({ filePath: path.join(tmp.path, "corrupt.xlsx"), sheet: "Sheet1" }, ctx),
        ).rejects.toThrow("Failed to parse spreadsheet")
      },
    })
  })

  test("throws for unsupported file format", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "doc.pdf"), "fake pdf content")
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await ExcelReadTool.init()
        await expect(
          tool.execute({ filePath: path.join(tmp.path, "doc.pdf"), sheet: "Sheet1" }, ctx),
        ).rejects.toThrow("Unsupported file format '.pdf'")
      },
    })
  })
})

describe("permissions", () => {
  test("asks for read permission", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        createTestXlsx(dir, "perm.xlsx", [["A"], [1]])
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await ExcelReadTool.init()
        const requests: Array<{ permission: string; patterns: string[] }> = []
        const testCtx = {
          ...ctx,
          ask: async (req: any) => {
            requests.push(req)
          },
        }
        await tool.execute({ filePath: path.join(tmp.path, "perm.xlsx"), sheet: "Sheet1" }, testCtx)
        const readReq = requests.find((r) => r.permission === "read")
        expect(readReq).toBeDefined()
        expect(readReq!.patterns[0]).toContain("perm.xlsx")
      },
    })
  })
})

describe("model-aware limit", () => {
  test("uses model context window for default row limit", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const data: unknown[][] = [["ID", "Value"]]
        for (let i = 1; i <= 200; i++) data.push([i, `val${i}`])
        createTestXlsx(dir, "large.xlsx", data)
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await ExcelReadTool.init()
        const ctxSmallModel = {
          ...ctx,
          extra: { model: { limit: { context: 900 } } },
        }
        const result = await tool.execute(
          { filePath: path.join(tmp.path, "large.xlsx"), sheet: "Sheet1" },
          ctxSmallModel,
        )
        // context=900 -> budget=135 -> tokensPerRow~6.86 -> estimated=19 -> clamped to min 20
        expect(result.metadata.outputRows).toBe(20)
        expect(result.metadata.hasMore).toBe(true)
        expect(result.metadata.truncated).toBe(true)
      },
    })
  })
})
