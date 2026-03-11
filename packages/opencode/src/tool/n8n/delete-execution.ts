import z from "zod"
import { Tool } from "../tool"
import { N8n } from "../../n8n"
import { N8nClient } from "../../n8n/client"

export const N8nDeleteExecutionTool = Tool.define("n8n_delete_execution", {
  description:
    "Delete a workflow execution record by ID. This removes the execution history entry permanently. Use this to clean up old or unnecessary execution records.",
  parameters: z.object({
    id: z.string().describe("The execution ID to delete"),
  }),
  async execute(params, ctx) {
    const config = await N8n.getConfig()
    await ctx.ask({
      permission: "n8n_write",
      patterns: [params.id],
      always: [],
      metadata: { action: "delete_execution", id: params.id },
    })
    await N8nClient.deleteExecution(config, params.id, ctx.abort)
    return {
      title: `Deleted execution ${params.id}`,
      output: `Execution ${params.id} has been deleted successfully.`,
      metadata: { id: params.id },
    }
  },
})
