import { describe, expect, test } from "bun:test"
import path from "path"
import XLSX from "xlsx"
import { ExcelWriteTool } from "../../src/tool/excel-write"
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

describe("ExcelWriteTool basic write", () => {
  test("writes a simple xlsx file", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await ExcelWriteTool.init()
        const result = await tool.execute(
          {
            filePath: path.join(tmp.path, "output.xlsx"),
            sheets: [
              {
                name: "Sheet1",
                headers: ["Name", "Age"],
                rows: [
                  ["Alice", 30],
                  ["Bob", 25],
                ],
              },
            ],
          },
          ctx,
        )
        expect(result.output).toContain("Wrote Excel file successfully")
        expect(result.output).toContain("Sheet1")
        expect(result.output).toContain("2 rows")

        // Verify file was created and is valid
        const wb = XLSX.readFile(path.join(tmp.path, "output.xlsx"))
        expect(wb.SheetNames).toContain("Sheet1")
        const ws = wb.Sheets["Sheet1"]
        expect(ws["A1"].v).toBe("Name")
        expect(ws["B1"].v).toBe("Age")
        expect(ws["A2"].v).toBe("Alice")
        expect(ws["B2"].v).toBe(30)
      },
    })
  })
})

describe("ExcelWriteTool cell types", () => {
  test("writes formula cells (= prefix)", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await ExcelWriteTool.init()
        await tool.execute(
          {
            filePath: path.join(tmp.path, "formulas.xlsx"),
            sheets: [
              {
                name: "Calc",
                headers: ["A", "B", "Sum"],
                rows: [[1, 2, "=A2+B2"]],
              },
            ],
          },
          ctx,
        )

        const wb = XLSX.readFile(path.join(tmp.path, "formulas.xlsx"))
        const ws = wb.Sheets["Calc"]
        expect(ws["C2"].f).toBe("A2+B2")
      },
    })
  })

  test("writes date cells from ISO 8601 strings", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await ExcelWriteTool.init()
        await tool.execute(
          {
            filePath: path.join(tmp.path, "dates.xlsx"),
            sheets: [
              {
                name: "Dates",
                headers: ["Date"],
                rows: [["2025-01-15"]],
              },
            ],
          },
          ctx,
        )

        const wb = XLSX.readFile(path.join(tmp.path, "dates.xlsx"), {
          cellDates: true,
        })
        const ws = wb.Sheets["Dates"]
        expect(ws["A2"].t).toBe("d")
      },
    })
  })

  test("escapes date detection with single-quote prefix", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await ExcelWriteTool.init()
        await tool.execute(
          {
            filePath: path.join(tmp.path, "escape.xlsx"),
            sheets: [
              {
                name: "Escaped",
                headers: ["Text"],
                rows: [["'2025-01-15"]],
              },
            ],
          },
          ctx,
        )

        const wb = XLSX.readFile(path.join(tmp.path, "escape.xlsx"))
        const ws = wb.Sheets["Escaped"]
        expect(ws["A2"].t).toBe("s")
        expect(ws["A2"].v).toBe("2025-01-15")
      },
    })
  })

  test("writes boolean and null cells", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await ExcelWriteTool.init()
        await tool.execute(
          {
            filePath: path.join(tmp.path, "types.xlsx"),
            sheets: [
              {
                name: "Types",
                headers: ["Bool", "Empty"],
                rows: [[true, null]],
              },
            ],
          },
          ctx,
        )

        const wb = XLSX.readFile(path.join(tmp.path, "types.xlsx"))
        const ws = wb.Sheets["Types"]
        expect(ws["A2"].t).toBe("b")
        expect(ws["A2"].v).toBe(true)
        expect(ws["B2"]).toBeUndefined()
      },
    })
  })
})

describe("ExcelWriteTool extension handling", () => {
  test("appends .xlsx when no extension provided", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await ExcelWriteTool.init()
        const result = await tool.execute(
          {
            filePath: path.join(tmp.path, "noext"),
            sheets: [{ name: "S", headers: ["A"], rows: [[1]] }],
          },
          ctx,
        )
        expect(result.metadata.filepath).toContain("noext.xlsx")
        expect(await Bun.file(path.join(tmp.path, "noext.xlsx")).exists()).toBe(true)
      },
    })
  })

  test("changes unsupported extension to .xlsx with warning", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await ExcelWriteTool.init()
        const result = await tool.execute(
          {
            filePath: path.join(tmp.path, "report.txt"),
            sheets: [{ name: "S", headers: ["A"], rows: [[1]] }],
          },
          ctx,
        )
        expect(result.output).toContain("Unsupported extension '.txt'")
        expect(result.output).toContain("changed to '.xlsx'")
        expect(await Bun.file(path.join(tmp.path, "report.xlsx")).exists()).toBe(true)
      },
    })
  })

  test("changes .xlsm to .xlsx with macro loss warning", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await ExcelWriteTool.init()
        const result = await tool.execute(
          {
            filePath: path.join(tmp.path, "macros.xlsm"),
            sheets: [{ name: "S", headers: ["A"], rows: [[1]] }],
          },
          ctx,
        )
        expect(result.output).toContain("VBA macros cannot be preserved")
        expect(await Bun.file(path.join(tmp.path, "macros.xlsx")).exists()).toBe(true)
      },
    })
  })

  test("writes CSV format", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await ExcelWriteTool.init()
        await tool.execute(
          {
            filePath: path.join(tmp.path, "out.csv"),
            sheets: [{ name: "S", headers: ["Name"], rows: [["Alice"]] }],
          },
          ctx,
        )
        const content = await Bun.file(path.join(tmp.path, "out.csv")).text()
        expect(content).toContain("Name")
        expect(content).toContain("Alice")
      },
    })
  })
})

describe("ExcelWriteTool multi-sheet", () => {
  test("writes multiple sheets", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await ExcelWriteTool.init()
        const result = await tool.execute(
          {
            filePath: path.join(tmp.path, "multi.xlsx"),
            sheets: [
              { name: "Sales", headers: ["Product"], rows: [["Widget"]] },
              { name: "Summary", headers: ["Total"], rows: [[100]] },
            ],
          },
          ctx,
        )
        expect(result.output).toContain("Sales")
        expect(result.output).toContain("Summary")

        const wb = XLSX.readFile(path.join(tmp.path, "multi.xlsx"))
        expect(wb.SheetNames).toEqual(["Sales", "Summary"])
      },
    })
  })
})

describe("ExcelWriteTool column widths", () => {
  test("applies custom column widths", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await ExcelWriteTool.init()
        await tool.execute(
          {
            filePath: path.join(tmp.path, "widths.xlsx"),
            sheets: [
              {
                name: "W",
                headers: ["Name", "Description"],
                rows: [["Alice", "A long description"]],
                columnWidths: [10, 40],
              },
            ],
          },
          ctx,
        )

        const wb = XLSX.readFile(path.join(tmp.path, "widths.xlsx"), { cellStyles: true })
        const ws = wb.Sheets["W"]
        expect(ws["!cols"]).toBeDefined()
        expect(ws["!cols"]![0].wch).toBe(10)
        expect(ws["!cols"]![1].wch).toBe(40)
      },
    })
  })
})

describe("ExcelWriteTool permissions", () => {
  test("asks for edit permission", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await ExcelWriteTool.init()
        const requests: Array<{ permission: string }> = []
        const testCtx = {
          ...ctx,
          ask: async (req: any) => {
            requests.push(req)
          },
        }
        await tool.execute(
          {
            filePath: path.join(tmp.path, "perm.xlsx"),
            sheets: [{ name: "S", headers: ["A"], rows: [[1]] }],
          },
          testCtx,
        )
        const editReq = requests.find((r) => r.permission === "edit")
        expect(editReq).toBeDefined()
      },
    })
  })
})

describe("ExcelWriteTool error handling", () => {
  test("rejects arrays too large to validate", async () => {
    // Note: Row-count check (> 1,048,576) lives in execute(), but Zod validation
    // happens first in Tool.define and blows the stack for 1M+ element arrays.
    // This test verifies the tool rejects such input before reaching the FS layer.
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await ExcelWriteTool.init()
        const fakeRows: (string | number | boolean | null)[][] = new Array(1048577)
        fakeRows[0] = [1]
        await expect(
          tool.execute(
            {
              filePath: path.join(tmp.path, "huge.xlsx"),
              sheets: [{ name: "S", headers: ["A"], rows: fakeRows }],
            },
            ctx,
          ),
        ).rejects.toThrow()
      },
    })
  })
})

describe("ExcelWriteTool round-trip", () => {
  test("write then read preserves data integrity", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const writeTool = await ExcelWriteTool.init()
        const readTool = await ExcelReadTool.init()

        // Write
        await writeTool.execute(
          {
            filePath: path.join(tmp.path, "roundtrip.xlsx"),
            sheets: [
              {
                name: "Data",
                headers: ["Name", "Score", "Active"],
                rows: [
                  ["Alice", 95, true],
                  ["Bob", 87, false],
                  ["Carol", 92, true],
                ],
              },
            ],
          },
          ctx,
        )

        // Read back
        const result = await readTool.execute({ filePath: path.join(tmp.path, "roundtrip.xlsx") }, ctx)

        expect(result.output).toContain("Alice")
        expect(result.output).toContain("95")
        expect(result.output).toContain("Bob")
        expect(result.output).toContain("87")
        expect(result.metadata.sheets[0].rows).toBe(3)
        expect(result.metadata.sheets[0].columns).toBe(3)
      },
    })
  })
})

describe("ExcelWriteTool overwrite protection", () => {
  test("redirects to timestamped filename when file already exists", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        // Create existing file
        const originalPath = path.join(tmp.path, "existing.xlsx")
        const tool = await ExcelWriteTool.init()
        await tool.execute(
          {
            filePath: originalPath,
            sheets: [{ name: "S", headers: ["A"], rows: [[1]] }],
          },
          ctx,
        )

        // Read the original so FileTime is satisfied
        const readTool = await ExcelReadTool.init()
        await readTool.execute({ filePath: originalPath }, ctx)

        // Write again to the same path — should redirect
        const result = await tool.execute(
          {
            filePath: originalPath,
            sheets: [{ name: "S", headers: ["B"], rows: [[2]] }],
          },
          ctx,
        )

        // Original file should be untouched
        const originalWb = XLSX.readFile(originalPath)
        expect(originalWb.Sheets["S"]["A1"].v).toBe("A")

        // Result should indicate redirect
        expect(result.metadata.redirected).toBe(true)
        expect(result.metadata.requestedPath).toBe(originalPath)
        expect(result.metadata.filepath).not.toBe(originalPath)
        expect(result.metadata.filepath).toContain("existing_")
        expect(result.metadata.filepath).toEndWith(".xlsx")
        expect(result.output).toContain("already exists")

        // Redirected file should have the new data
        const newWb = XLSX.readFile(result.metadata.filepath)
        expect(newWb.Sheets["S"]["A1"].v).toBe("B")
      },
    })
  })

  test("writes directly when file does not exist", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await ExcelWriteTool.init()
        const filePath = path.join(tmp.path, "brand-new.xlsx")
        const result = await tool.execute(
          {
            filePath,
            sheets: [{ name: "S", headers: ["A"], rows: [[1]] }],
          },
          ctx,
        )

        expect(result.metadata.redirected).toBe(false)
        expect(result.metadata.filepath).toBe(filePath)
        expect(result.output).not.toContain("already exists")
      },
    })
  })

  test("preserves extension in timestamped redirect for CSV", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await ExcelWriteTool.init()
        const csvPath = path.join(tmp.path, "data.csv")

        // Create existing CSV
        await tool.execute(
          {
            filePath: csvPath,
            sheets: [{ name: "S", headers: ["A"], rows: [[1]] }],
          },
          ctx,
        )

        // Write again — should redirect with .csv extension
        const result = await tool.execute(
          {
            filePath: csvPath,
            sheets: [{ name: "S", headers: ["B"], rows: [[2]] }],
          },
          ctx,
        )

        expect(result.metadata.redirected).toBe(true)
        expect(result.metadata.filepath).toContain("data_")
        expect(result.metadata.filepath).toEndWith(".csv")
      },
    })
  })
})
