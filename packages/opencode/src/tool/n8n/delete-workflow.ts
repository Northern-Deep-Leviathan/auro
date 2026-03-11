import z from "zod"
import { Tool } from "../tool"
import { N8n } from "../../n8n"
import { N8nClient } from "../../n8n/client"

export const N8nDeleteWorkflowTool = Tool.define("n8n_delete_workflow", {
  description:
    "Permanently delete an n8n workflow by ID. This action cannot be undone. Consider deactivating the workflow first if you are unsure.",
  parameters: z.object({
    id: z.string().describe("The workflow ID to delete"),
  }),
  async execute(params, ctx) {
    const config = await N8n.getConfig()
    await ctx.ask({
      permission: "n8n_write",
      patterns: [params.id],
      always: [],
      metadata: { action: "delete_workflow", id: params.id },
    })
    const result = await N8nClient.deleteWorkflow(config, params.id, ctx.abort)
    return {
      title: `Deleted workflow "${result.name}" (ID: ${result.id})`,
      output: JSON.stringify(result, null, 2),
      metadata: { id: result.id, name: result.name },
    }
  },
})
