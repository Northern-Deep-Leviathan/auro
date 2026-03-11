import z from "zod"
import { Tool } from "../tool"
import { N8n } from "../../n8n"
import { N8nClient } from "../../n8n/client"

export const N8nListExecutionsTool = Tool.define("n8n_list_executions", {
  description:
    "List workflow execution records from the connected n8n instance. Can filter by workflow ID, status, and supports pagination. Use this to monitor workflow runs and debug issues.",
  parameters: z.object({
    limit: z.number().optional().describe("Maximum number of executions to return (default 20)"),
    cursor: z.string().optional().describe("Pagination cursor from a previous response"),
    status: z.enum(["error", "success", "waiting"]).optional().describe("Filter by execution status"),
    workflowId: z.string().optional().describe("Filter executions by workflow ID"),
  }),
  async execute(params, ctx) {
    const config = await N8n.getConfig()
    const result = await N8nClient.listExecutions(
      config,
      {
        limit: params.limit ?? 20,
        cursor: params.cursor,
        status: params.status,
        workflowId: params.workflowId,
      },
      ctx.abort,
    )
    return {
      title: `Listed ${result.data.length} executions`,
      output: JSON.stringify(result, null, 2),
      metadata: { count: result.data.length },
    }
  },
})
