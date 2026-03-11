import { Auth } from "../auth"
import { Config } from "../config/config"
import type { N8nClient } from "./client"

export namespace N8n {
  export class ConfigError extends Error {
    constructor() {
      super("n8n is not configured. Run `opencode n8n setup` to set up your n8n instance.")
      this.name = "N8nConfigError"
    }
  }

  export async function getConfig(): Promise<N8nClient.Config> {
    const cfg = await Config.get()
    const url = cfg.n8n?.url
    const auth = await Auth.get("n8n")
    if (!url || !auth || auth.type !== "api") {
      throw new ConfigError()
    }
    return { url: url.replace(/\/$/, ""), apiKey: auth.key }
  }
}
