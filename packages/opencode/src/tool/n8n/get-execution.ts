import z from "zod"
import { Tool } from "../tool"
import { N8n } from "../../n8n"
import { N8nClient } from "../../n8n/client"

export const N8nGetExecutionTool = Tool.define("n8n_get_execution", {
  description:
    "Get detailed information about a specific workflow execution by ID. Optionally include the full execution data (input/output of each node) for debugging.",
  parameters: z.object({
    id: z.string().describe("The execution ID to retrieve"),
    includeData: z
      .boolean()
      .optional()
      .describe("Include full execution data with node inputs/outputs (default false)"),
  }),
  async execute(params, ctx) {
    const config = await N8n.getConfig()
    const result = await N8nClient.getExecution(config, params.id, params.includeData, ctx.abort)
    return {
      title: `Execution ${result.id} (${result.status})`,
      output: JSON.stringify(result, null, 2),
      metadata: { id: result.id, status: result.status, workflowId: result.workflowId },
    }
  },
})
