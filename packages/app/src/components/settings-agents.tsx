import { Component, onMount, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { TextField } from "@opencode-ai/ui/text-field"
import { showToast } from "@opencode-ai/ui/toast"
import { useLanguage } from "@/context/language"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"

interface SettingsRowProps {
  title: string | JSX.Element
  description: string | JSX.Element
  children: JSX.Element
}

const SettingsRow: Component<SettingsRowProps> = (props) => {
  return (
    <div class="flex flex-wrap items-center justify-between gap-4 py-3 border-b border-border-weak-base last:border-none">
      <div class="flex flex-col gap-0.5 min-w-0">
        <span class="text-14-medium text-text-strong">{props.title}</span>
        <span class="text-12-regular text-text-weak">{props.description}</span>
      </div>
      <div class="flex-shrink-0">{props.children}</div>
    </div>
  )
}

export const SettingsAgents: Component = () => {
  const language = useLanguage()
  const globalSDK = useGlobalSDK()
  const globalSync = useGlobalSync()

  const [store, setStore] = createStore({
    url: "",
    apiKey: "",
    testing: false,
    saving: false,
    status: "idle" as "idle" | "connected" | "failed",
    error: undefined as string | undefined,
    urlError: undefined as string | undefined,
    apiKeyError: undefined as string | undefined,
  })

  onMount(async () => {
    try {
      const response = await fetch(`${globalSDK.url}/global/n8n/status`)
      const data = (await response.json()) as { configured: boolean; url?: string }
      if (data.configured && data.url) {
        setStore("url", data.url)
        setStore("status", "connected")
      }
    } catch {
      // ignore — status check is best-effort
    }
  })

  function validateUrl(url: string): boolean {
    if (!url.trim()) {
      setStore("urlError", language.t("settings.agents.n8n.url.error.required"))
      return false
    }
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      setStore("urlError", language.t("settings.agents.n8n.url.error.format"))
      return false
    }
    setStore("urlError", undefined)
    return true
  }

  function validateApiKey(apiKey: string): boolean {
    if (!apiKey.trim()) {
      setStore("apiKeyError", language.t("settings.agents.n8n.apiKey.error.required"))
      return false
    }
    setStore("apiKeyError", undefined)
    return true
  }

  async function testConnection() {
    const urlValid = validateUrl(store.url)
    const apiKeyValid = validateApiKey(store.apiKey)
    if (!urlValid || !apiKeyValid) return

    setStore("testing", true)
    setStore("error", undefined)

    try {
      const response = await fetch(`${globalSDK.url}/global/n8n/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: store.url, apiKey: store.apiKey }),
      })

      if (response.ok) {
        setStore("status", "connected")
        showToast({
          variant: "success",
          icon: "circle-check",
          title: language.t("settings.agents.n8n.toast.testSuccess.title"),
          description: language.t("settings.agents.n8n.toast.testSuccess.description"),
        })
      } else {
        const data = (await response.json().catch(() => ({}))) as { message?: string }
        setStore("status", "failed")
        setStore("error", data.message)
        showToast({
          title: language.t("settings.agents.n8n.toast.testFailed.title"),
          description: data.message,
        })
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unknown error"
      setStore("status", "failed")
      setStore("error", message)
      showToast({
        title: language.t("settings.agents.n8n.toast.testFailed.title"),
        description: message,
      })
    } finally {
      setStore("testing", false)
    }
  }

  async function save() {
    const urlValid = validateUrl(store.url)
    const apiKeyValid = validateApiKey(store.apiKey)
    if (!urlValid || !apiKeyValid) return

    setStore("saving", true)

    try {
      await globalSync.updateConfig({ n8n: { url: store.url } })
      await globalSDK.client.auth.set({
        providerID: "n8n",
        auth: {
          type: "api",
          key: store.apiKey,
        },
      })
      setStore("status", "connected")
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("settings.agents.n8n.toast.saved.title"),
        description: language.t("settings.agents.n8n.toast.saved.description"),
      })
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unknown error"
      showToast({
        title: language.t("settings.agents.n8n.toast.saveFailed.title"),
        description: message,
      })
    } finally {
      setStore("saving", false)
    }
  }

  const statusIndicator = () => {
    if (store.status === "connected") {
      return (
        <div class="flex items-center gap-1.5 text-12-medium text-text-success">
          <Icon name="circle-check" size="small" />
          <span>{language.t("settings.agents.n8n.status.connected")}</span>
        </div>
      )
    }
    if (store.status === "failed") {
      return (
        <div class="flex items-center gap-1.5 text-12-medium text-text-danger">
          <Icon name="warning" size="small" />
          <span>{language.t("settings.agents.n8n.status.failed")}</span>
        </div>
      )
    }
    return (
      <div class="flex items-center gap-1.5 text-12-medium text-text-weak">
        <span>{language.t("settings.agents.n8n.status.notConfigured")}</span>
      </div>
    )
  }

  return (
    <div class="flex flex-col h-full overflow-y-auto no-scrollbar px-4 pb-10 sm:px-10 sm:pb-10">
      <div class="sticky top-0 z-10 bg-[linear-gradient(to_bottom,var(--surface-stronger-non-alpha)_calc(100%_-_24px),transparent)]">
        <div class="flex flex-col gap-1 pt-6 pb-8">
          <h2 class="text-16-medium text-text-strong">{language.t("settings.agents.title")}</h2>
        </div>
      </div>

      <div class="flex flex-col gap-8 w-full">
        <div class="flex flex-col gap-1">
          <div class="flex items-center justify-between pb-2">
            <h3 class="text-14-medium text-text-strong">{language.t("settings.agents.n8n.section.title")}</h3>
            {statusIndicator()}
          </div>

          <p class="text-12-regular text-text-weak pb-2">{language.t("settings.agents.n8n.section.description")}</p>

          <div class="bg-surface-raised-base px-4 rounded-lg">
            <SettingsRow
              title={language.t("settings.agents.n8n.url.title")}
              description={language.t("settings.agents.n8n.url.description")}
            >
              <div class="w-[280px]">
                <TextField
                  value={store.url}
                  onChange={(value) => {
                    setStore("url", value)
                    if (store.urlError) validateUrl(value)
                  }}
                  placeholder={language.t("settings.agents.n8n.url.placeholder")}
                  validationState={store.urlError ? "invalid" : "valid"}
                  error={store.urlError}
                />
              </div>
            </SettingsRow>

            <SettingsRow
              title={language.t("settings.agents.n8n.apiKey.title")}
              description={language.t("settings.agents.n8n.apiKey.description")}
            >
              <div class="w-[280px]">
                <TextField
                  type="password"
                  value={store.apiKey}
                  onChange={(value) => {
                    setStore("apiKey", value)
                    if (store.apiKeyError) validateApiKey(value)
                  }}
                  placeholder={language.t("settings.agents.n8n.apiKey.placeholder")}
                  validationState={store.apiKeyError ? "invalid" : "valid"}
                  error={store.apiKeyError}
                />
              </div>
            </SettingsRow>

            <div class="flex items-center justify-end gap-2 py-3">
              <Button
                size="small"
                variant="secondary"
                disabled={store.testing || store.saving}
                onClick={testConnection}
              >
                {store.testing
                  ? language.t("settings.agents.n8n.testing")
                  : language.t("settings.agents.n8n.test")}
              </Button>
              <Button
                size="small"
                variant="primary"
                disabled={store.testing || store.saving}
                onClick={save}
              >
                {store.saving ? language.t("settings.agents.n8n.saving") : language.t("settings.agents.n8n.save")}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
