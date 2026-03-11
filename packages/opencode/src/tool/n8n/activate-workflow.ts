import z from "zod"
import { Tool } from "../tool"
import { N8n } from "../../n8n"
import { N8nClient } from "../../n8n/client"

export const N8nActivateWorkflowTool = Tool.define("n8n_activate_workflow", {
  description:
    "Activate an n8n workflow so it responds to triggers and scheduled events. Make sure the workflow is properly configured and tested before activating.",
  parameters: z.object({
    id: z.string().describe("The workflow ID to activate"),
  }),
  async execute(params, ctx) {
    const config = await N8n.getConfig()
    await ctx.ask({
      permission: "n8n_write",
      patterns: [params.id],
      always: [],
      metadata: { action: "activate_workflow", id: params.id },
    })
    const result = await N8nClient.activateWorkflow(config, params.id, ctx.abort)
    return {
      title: `Activated workflow "${result.name}" (ID: ${result.id})`,
      output: JSON.stringify(result, null, 2),
      metadata: { id: result.id, name: result.name, active: result.active },
    }
  },
})
