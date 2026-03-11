import z from "zod"
import { Tool } from "../tool"
import { N8n } from "../../n8n"
import { N8nClient } from "../../n8n/client"

export const N8nCreateWorkflowTool = Tool.define("n8n_create_workflow", {
  description:
    "Create a new workflow in the connected n8n instance. Provide the workflow name and node configurations. The workflow will be created in an inactive state by default.",
  parameters: z.object({
    name: z.string().describe("Name for the new workflow"),
    nodes: z.array(z.any()).describe("Array of node configuration objects"),
    connections: z.any().optional().describe("Node connection mappings"),
    settings: z.any().optional().describe("Workflow settings (e.g., timezone, saveManualExecutions)"),
  }),
  async execute(params, ctx) {
    const config = await N8n.getConfig()
    await ctx.ask({
      permission: "n8n_write",
      patterns: [params.name],
      always: [],
      metadata: { action: "create_workflow", name: params.name },
    })
    const result = await N8nClient.createWorkflow(
      config,
      {
        name: params.name,
        nodes: params.nodes,
        connections: params.connections,
        settings: params.settings,
      },
      ctx.abort,
    )
    return {
      title: `Created workflow "${result.name}" (ID: ${result.id})`,
      output: JSON.stringify(result, null, 2),
      metadata: { id: result.id, name: result.name },
    }
  },
})
