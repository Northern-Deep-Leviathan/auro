export namespace ProviderAllowlist {
  // OPENCODE_PROVIDER_ALLOWLIST is injected at build time via `define`.
  // In dev mode or standard builds it is `undefined` (no filtering).
  // When an allowlist JSON path is provided to the build, it becomes a string[].
  declare const OPENCODE_PROVIDER_ALLOWLIST: string[] | undefined

  const embedded: Set<string> | null = (() => {
    try {
      const list = OPENCODE_PROVIDER_ALLOWLIST
      if (Array.isArray(list)) return new Set(list)
    } catch {}
    return null
  })()

  export function isAllowed(providerID: string): boolean {
    if (!embedded) return true
    return embedded.has(providerID)
  }

  export function getList(): string[] | null {
    if (!embedded) return null
    return [...embedded]
  }

  export function isActive(): boolean {
    return embedded !== null
  }
}
