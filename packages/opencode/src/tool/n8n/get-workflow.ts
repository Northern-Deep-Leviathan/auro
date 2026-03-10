import z from "zod"
import { Tool } from "../tool"
import { N8n } from "../../n8n"
import { N8nClient } from "../../n8n/client"

export const N8nGetWorkflowTool = Tool.define("n8n_get_workflow", {
  description:
    "Get detailed information about a specific n8n workflow by ID, including its nodes, connections, and settings. Use this to inspect workflow configuration before making changes.",
  parameters: z.object({
    id: z.string().describe("The workflow ID to retrieve"),
  }),
  async execute(params, ctx) {
    const config = await N8n.getConfig()
    const result = await N8nClient.getWorkflow(config, params.id, ctx.abort)
    return {
      title: `Workflow "${result.name}" (ID: ${result.id})`,
      output: JSON.stringify(result, null, 2),
      metadata: { id: result.id, name: result.name },
    }
  },
})
