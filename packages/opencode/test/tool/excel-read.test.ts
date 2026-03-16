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

function createTestXlsx(dir: string, filename: string, data: unknown[][]): string {
  const ws = XLSX.utils.aoa_to_sheet(data)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1")
  const filepath = path.join(dir, filename)
  XLSX.writeFile(wb, filepath)
  return filepath
}

describe("ExcelReadTool basic read", () => {
  test("reads a simple xlsx file and returns schema + data", async () => {
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
        const result = await tool.execute({ filePath: path.join(tmp.path, "test.xlsx") }, ctx)
        expect(result.output).toContain("<excel>")
        expect(result.output).toContain("</excel>")
        expect(result.output).toContain("<summary>")
        expect(result.output).toContain("Name")
        expect(result.output).toContain("Age")
        expect(result.output).toContain("City")
        expect(result.output).toContain("Alice")
        expect(result.output).toContain("Bob")
        expect(result.metadata.sheets).toHaveLength(1)
        expect(result.metadata.sheets[0].name).toBe("Sheet1")
        expect(result.metadata.sheets[0].rows).toBe(2)
        expect(result.metadata.sheets[0].columns).toBe(3)
      },
    })
  })
})

describe("ExcelReadTool pagination", () => {
  test("respects custom limit", async () => {
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
        const result = await tool.execute({ filePath: path.join(tmp.path, "pagination.xlsx"), limit: 5 }, ctx)
        expect(result.output).toContain('rows="1-5"')
        expect(result.output).toContain('total="50"')
        expect(result.output).toContain("Use offset=6 to continue reading")
        expect(result.metadata.truncated).toBe(true)
      },
    })
  })

  test("respects offset parameter", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const data: unknown[][] = [["ID", "Value"]]
        for (let i = 1; i <= 20; i++) data.push([i, `val${i}`])
        createTestXlsx(dir, "offset.xlsx", data)
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await ExcelReadTool.init()
        const result = await tool.execute({ filePath: path.join(tmp.path, "offset.xlsx"), offset: 10, limit: 5 }, ctx)
        expect(result.output).toContain('rows="10-14"')
        expect(result.output).toContain("val10")
        expect(result.output).not.toContain("val9")
        expect(result.output).toContain("val14")
      },
    })
  })

  test("schema-only mode with limit=0", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        createTestXlsx(dir, "schema.xlsx", [
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
        const result = await tool.execute({ filePath: path.join(tmp.path, "schema.xlsx"), limit: 0 }, ctx)
        expect(result.output).toContain("<summary>")
        expect(result.output).toContain("Name")
        expect(result.output).toContain("Age")
        expect(result.output).not.toContain("<data")
      },
    })
  })
})

describe("ExcelReadTool column filtering", () => {
  test("filters columns by name", async () => {
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
          { filePath: path.join(tmp.path, "cols.xlsx"), columns: ["Name", "City"] },
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
        const result = await tool.execute({ filePath: path.join(tmp.path, "cols-idx.xlsx"), columns: [0, 2] }, ctx)
        expect(result.output).toContain("Name")
        expect(result.output).toContain("City")
        expect(result.output).toContain("Alice")
        expect(result.output).toContain("NYC")
      },
    })
  })

  test("throws for invalid column name", async () => {
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
          tool.execute({ filePath: path.join(tmp.path, "cols-err.xlsx"), columns: ["NonExistent"] }, ctx),
        ).rejects.toThrow("Column 'NonExistent' not found")
      },
    })
  })
})

describe("ExcelReadTool output formats", () => {
  test("outputs CSV format", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        createTestXlsx(dir, "csv.xlsx", [
          ["Name", "Age"],
          ["Alice", 30],
        ])
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await ExcelReadTool.init()
        const result = await tool.execute({ filePath: path.join(tmp.path, "csv.xlsx"), format: "csv" }, ctx)
        expect(result.output).toContain('format="csv"')
        expect(result.output).toContain("Name,Age")
      },
    })
  })

  test("outputs JSON format", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        createTestXlsx(dir, "json.xlsx", [
          ["Name", "Age"],
          ["Alice", 30],
        ])
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await ExcelReadTool.init()
        const result = await tool.execute({ filePath: path.join(tmp.path, "json.xlsx"), format: "json" }, ctx)
        expect(result.output).toContain('format="json"')
        const jsonMatch = result.output.match(/<data[^>]*>\n([\s\S]*?)\n<\/data>/)
        expect(jsonMatch).toBeTruthy()
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[1])
          expect(parsed[0].Name).toBe("Alice")
        }
      },
    })
  })
})

describe("ExcelReadTool error handling", () => {
  test("throws for file not found", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await ExcelReadTool.init()
        await expect(tool.execute({ filePath: path.join(tmp.path, "nonexistent.xlsx") }, ctx)).rejects.toThrow(
          "File not found",
        )
      },
    })
  })

  test("throws for invalid sheet name", async () => {
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
        // Write binary garbage with PK header (ZIP magic bytes) but invalid content
        const corrupt = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0xff, 0xfe, 0x00, 0x00, 0xde, 0xad])
        await Bun.write(path.join(dir, "corrupt.xlsx"), corrupt)
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await ExcelReadTool.init()
        await expect(tool.execute({ filePath: path.join(tmp.path, "corrupt.xlsx") }, ctx)).rejects.toThrow(
          "Failed to parse spreadsheet",
        )
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
        await expect(tool.execute({ filePath: path.join(tmp.path, "doc.pdf") }, ctx)).rejects.toThrow(
          "Unsupported file format '.pdf'",
        )
      },
    })
  })
})

describe("ExcelReadTool permissions", () => {
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
        await tool.execute({ filePath: path.join(tmp.path, "perm.xlsx") }, testCtx)
        const readReq = requests.find((r) => r.permission === "read")
        expect(readReq).toBeDefined()
        expect(readReq!.patterns[0]).toContain("perm.xlsx")
      },
    })
  })
})

describe("ExcelReadTool specific sheet", () => {
  test("reads only the specified sheet", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const ws1 = XLSX.utils.aoa_to_sheet([["A"], [1]])
        const ws2 = XLSX.utils.aoa_to_sheet([["B"], [2]])
        const wb = XLSX.utils.book_new()
        XLSX.utils.book_append_sheet(wb, ws1, "First")
        XLSX.utils.book_append_sheet(wb, ws2, "Second")
        XLSX.writeFile(wb, path.join(dir, "multi.xlsx"))
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await ExcelReadTool.init()
        const result = await tool.execute({ filePath: path.join(tmp.path, "multi.xlsx"), sheet: "Second" }, ctx)
        expect(result.output).toContain('<sheet name="Second">')
        expect(result.output).not.toContain('<sheet name="First">')
      },
    })
  })

  test("reads all sheets when sheet param is omitted", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const ws1 = XLSX.utils.aoa_to_sheet([["A"], [1]])
        const ws2 = XLSX.utils.aoa_to_sheet([["B"], [2]])
        const wb = XLSX.utils.book_new()
        XLSX.utils.book_append_sheet(wb, ws1, "First")
        XLSX.utils.book_append_sheet(wb, ws2, "Second")
        XLSX.writeFile(wb, path.join(dir, "all-sheets.xlsx"))
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await ExcelReadTool.init()
        const result = await tool.execute({ filePath: path.join(tmp.path, "all-sheets.xlsx") }, ctx)
        expect(result.output).toContain('<sheet name="First">')
        expect(result.output).toContain('<sheet name="Second">')
        expect(result.metadata.sheets).toHaveLength(2)
      },
    })
  })
})

describe("ExcelReadTool model-aware limit", () => {
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
        const result = await tool.execute({ filePath: path.join(tmp.path, "large.xlsx") }, ctxSmallModel)
        // context=900 → budget=135 → tokensPerRow≈6.86 → estimated=19 → clamped to min 20
        expect(result.output).toContain('rows="1-20"')
        expect(result.metadata.truncated).toBe(true)
      },
    })
  })
})
