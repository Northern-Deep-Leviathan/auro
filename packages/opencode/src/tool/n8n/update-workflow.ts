import z from "zod"
import { Tool } from "../tool"
import { N8n } from "../../n8n"
import { N8nClient } from "../../n8n/client"

export const N8nUpdateWorkflowTool = Tool.define("n8n_update_workflow", {
  description:
    "Update an existing n8n workflow. You can modify the name, nodes, connections, or settings. Always retrieve the workflow first with n8n_get_workflow to understand the current configuration before updating.",
  parameters: z.object({
    id: z.string().describe("The workflow ID to update"),
    name: z.string().optional().describe("New name for the workflow"),
    nodes: z.array(z.any()).optional().describe("Updated array of node configuration objects"),
    connections: z.any().optional().describe("Updated node connection mappings"),
    settings: z.any().optional().describe("Updated workflow settings"),
  }),
  async execute(params, ctx) {
    const config = await N8n.getConfig()
    await ctx.ask({
      permission: "n8n_write",
      patterns: [params.id],
      always: [],
      metadata: { action: "update_workflow", id: params.id, name: params.name },
    })
    const { id, ...updates } = params
    const result = await N8nClient.updateWorkflow(config, id, updates, ctx.abort)
    return {
      title: `Updated workflow "${result.name}" (ID: ${result.id})`,
      output: JSON.stringify(result, null, 2),
      metadata: { id: result.id, name: result.name },
    }
  },
})
