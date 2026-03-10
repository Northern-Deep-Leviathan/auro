import { abortAfterAny } from "../util/abort"

const DEFAULT_TIMEOUT = 30_000

export namespace N8nClient {
  export interface Config {
    url: string
    apiKey: string
  }

  export interface PaginatedResponse<T> {
    data: T[]
    nextCursor?: string
  }

  export interface Workflow {
    id: string
    name: string
    active: boolean
    createdAt: string
    updatedAt: string
    tags?: Array<{ id: string; name: string }>
    nodes?: any[]
    connections?: Record<string, any>
    settings?: Record<string, any>
    staticData?: any
    versionId?: string
  }

  export interface Execution {
    id: string
    finished: boolean
    mode: string
    startedAt: string
    stoppedAt?: string
    workflowId: string
    status: string
    data?: any
    workflowData?: any
  }

  async function request<T>(
    config: Config,
    method: string,
    path: string,
    body?: unknown,
    abort?: AbortSignal,
  ): Promise<T> {
    const url = `${config.url}/api/v1${path}`
    const { signal, clearTimeout } = abortAfterAny(DEFAULT_TIMEOUT, ...(abort ? [abort] : []))

    try {
      const response = await fetch(url, {
        method,
        signal,
        headers: {
          "X-N8N-API-KEY": config.apiKey,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      })

      if (!response.ok) {
        const text = await response.text().catch(() => "")
        throw new Error(`n8n API error (${response.status}): ${text || response.statusText}`)
      }

      return (await response.json()) as T
    } finally {
      clearTimeout()
    }
  }

  // Workflows

  export async function listWorkflows(
    config: Config,
    params?: { cursor?: string; limit?: number; active?: boolean; tags?: string },
    abort?: AbortSignal,
  ): Promise<PaginatedResponse<Workflow>> {
    const query = new URLSearchParams()
    if (params?.cursor) query.set("cursor", params.cursor)
    if (params?.limit) query.set("limit", params.limit.toString())
    if (params?.active !== undefined) query.set("active", params.active.toString())
    if (params?.tags) query.set("tags", params.tags)
    const qs = query.toString()
    return request(config, "GET", `/workflows${qs ? `?${qs}` : ""}`, undefined, abort)
  }

  export async function getWorkflow(config: Config, id: string, abort?: AbortSignal): Promise<Workflow> {
    return request(config, "GET", `/workflows/${id}`, undefined, abort)
  }

  export async function createWorkflow(
    config: Config,
    workflow: { name: string; nodes: any[]; connections?: any; settings?: any; staticData?: any },
    abort?: AbortSignal,
  ): Promise<Workflow> {
    return request(config, "POST", "/workflows", workflow, abort)
  }

  export async function updateWorkflow(
    config: Config,
    id: string,
    workflow: { name?: string; nodes?: any[]; connections?: any; settings?: any; staticData?: any },
    abort?: AbortSignal,
  ): Promise<Workflow> {
    return request(config, "PUT", `/workflows/${id}`, workflow, abort)
  }

  export async function deleteWorkflow(config: Config, id: string, abort?: AbortSignal): Promise<Workflow> {
    return request(config, "DELETE", `/workflows/${id}`, undefined, abort)
  }

  export async function activateWorkflow(config: Config, id: string, abort?: AbortSignal): Promise<Workflow> {
    return request(config, "PATCH", `/workflows/${id}`, { active: true }, abort)
  }

  export async function deactivateWorkflow(config: Config, id: string, abort?: AbortSignal): Promise<Workflow> {
    return request(config, "PATCH", `/workflows/${id}`, { active: false }, abort)
  }

  // Executions

  export async function listExecutions(
    config: Config,
    params?: { cursor?: string; limit?: number; status?: string; workflowId?: string },
    abort?: AbortSignal,
  ): Promise<PaginatedResponse<Execution>> {
    const query = new URLSearchParams()
    if (params?.cursor) query.set("cursor", params.cursor)
    if (params?.limit) query.set("limit", params.limit.toString())
    if (params?.status) query.set("status", params.status)
    if (params?.workflowId) query.set("workflowId", params.workflowId)
    const qs = query.toString()
    return request(config, "GET", `/executions${qs ? `?${qs}` : ""}`, undefined, abort)
  }

  export async function getExecution(
    config: Config,
    id: string,
    includeData?: boolean,
    abort?: AbortSignal,
  ): Promise<Execution> {
    const query = includeData ? "?includeData=true" : ""
    return request(config, "GET", `/executions/${id}${query}`, undefined, abort)
  }

  export async function deleteExecution(config: Config, id: string, abort?: AbortSignal): Promise<void> {
    await request(config, "DELETE", `/executions/${id}`, undefined, abort)
  }
}
