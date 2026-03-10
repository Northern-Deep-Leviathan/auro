import { Auth } from "../../auth"
import { Config } from "../../config/config"
import { N8n } from "../../n8n"
import { N8nClient } from "../../n8n/client"
import { UI } from "../ui"
import { cmd } from "./cmd"
import * as prompts from "@clack/prompts"

export const N8nCommand = cmd({
  command: "n8n",
  describe: "manage n8n integration",
  builder: (yargs) => yargs.command(N8nSetupCommand).command(N8nStatusCommand).demandCommand(),
  async handler() {},
})

export const N8nSetupCommand = cmd({
  command: "setup",
  describe: "configure n8n instance connection",
  async handler() {
    UI.empty()
    prompts.intro("N8n Setup")

    const url = await prompts.text({
      message: "n8n instance URL",
      placeholder: "https://your-n8n.example.com",
      validate: (v) => {
        if (!v) return "Required"
        if (!v.startsWith("http://") && !v.startsWith("https://")) return "Must start with http:// or https://"
        return undefined
      },
    })
    if (prompts.isCancel(url)) throw new UI.CancelledError()

    const apiKey = await prompts.password({
      message: "n8n API key",
      validate: (v) => (v && v.length > 0 ? undefined : "Required"),
    })
    if (prompts.isCancel(apiKey)) throw new UI.CancelledError()

    const cleanUrl = url.replace(/\/$/, "")

    const spinner = prompts.spinner()
    spinner.start("Testing connection...")
    try {
      await N8nClient.listWorkflows({ url: cleanUrl, apiKey }, { limit: 1 })
      spinner.stop("Connection successful!")
    } catch (e) {
      spinner.stop("Connection failed: " + (e instanceof Error ? e.message : String(e)), 1)
      prompts.outro("Please check your URL and API key and try again.")
      return
    }

    await Config.updateGlobal({ n8n: { url: cleanUrl } })
    await Auth.set("n8n", { type: "api", key: apiKey })

    prompts.log.success("Configuration saved!")
    prompts.log.info(`Use ${UI.Style.TEXT_NORMAL_BOLD}--agent n8n${UI.Style.TEXT_NORMAL} to start an n8n session.`)
    prompts.outro("Done")
  },
})

export const N8nStatusCommand = cmd({
  command: "status",
  describe: "check n8n connection status",
  async handler() {
    UI.empty()
    prompts.intro("N8n Status")

    try {
      const config = await N8n.getConfig()
      prompts.log.info(`URL: ${config.url}`)

      const spinner = prompts.spinner()
      spinner.start("Checking connection...")
      const result = await N8nClient.listWorkflows(config, { limit: 1 })
      spinner.stop("Connected")
      prompts.log.info(`Workflows available: ${result.data.length > 0 ? "yes" : "none found"}`)
    } catch (e) {
      if (e instanceof N8n.ConfigError) {
        prompts.log.error("Not configured. Run: opencode n8n setup")
      } else {
        prompts.log.error("Connection failed: " + (e instanceof Error ? e.message : String(e)))
      }
    }

    prompts.outro("")
  },
})
