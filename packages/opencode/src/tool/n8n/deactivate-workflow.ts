import z from "zod"
import { Tool } from "../tool"
import { N8n } from "../../n8n"
import { N8nClient } from "../../n8n/client"

export const N8nDeactivateWorkflowTool = Tool.define("n8n_deactivate_workflow", {
  description:
    "Deactivate an n8n workflow so it stops responding to triggers and scheduled events. The workflow configuration is preserved and can be reactivated later.",
  parameters: z.object({
    id: z.string().describe("The workflow ID to deactivate"),
  }),
  async execute(params, ctx) {
    const config = await N8n.getConfig()
    await ctx.ask({
      permission: "n8n_write",
      patterns: [params.id],
      always: [],
      metadata: { action: "deactivate_workflow", id: params.id },
    })
    const result = await N8nClient.deactivateWorkflow(config, params.id, ctx.abort)
    return {
      title: `Deactivated workflow "${result.name}" (ID: ${result.id})`,
      output: JSON.stringify(result, null, 2),
      metadata: { id: result.id, name: result.name, active: result.active },
    }
  },
})
