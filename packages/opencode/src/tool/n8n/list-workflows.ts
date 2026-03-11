import z from "zod"
import { Tool } from "../tool"
import { N8n } from "../../n8n"
import { N8nClient } from "../../n8n/client"

export const N8nListWorkflowsTool = Tool.define("n8n_list_workflows", {
  description:
    "List workflows from the connected n8n instance. Returns workflow names, IDs, active status, and tags. Use this to discover available workflows before performing operations on them.",
  parameters: z.object({
    limit: z.number().optional().describe("Maximum number of workflows to return (default 20)"),
    cursor: z.string().optional().describe("Pagination cursor from a previous response"),
    active: z.boolean().optional().describe("Filter by active status (true/false)"),
    tags: z.string().optional().describe("Filter by tag name"),
  }),
  async execute(params, ctx) {
    const config = await N8n.getConfig()
    const result = await N8nClient.listWorkflows(
      config,
      {
        limit: params.limit ?? 20,
        cursor: params.cursor,
        active: params.active,
        tags: params.tags,
      },
      ctx.abort,
    )
    return {
      title: `Listed ${result.data.length} workflows`,
      output: JSON.stringify(result, null, 2),
      metadata: { count: result.data.length },
    }
  },
})
