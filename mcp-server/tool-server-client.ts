export const DEFAULT_TOOL_SERVER_URL = 'http://127.0.0.1:17380'

export type McpToolCatalogItem = {
  name: string
  description: string
  parameters: Record<string, unknown>
}

export function resolveMcpToolServerUrl(env: NodeJS.ProcessEnv = process.env): string {
  return env.ESCALAFLOW_TOOL_SERVER || env.ESCALAFLOW_URL || DEFAULT_TOOL_SERVER_URL
}

export function parseMcpToolCatalogResponse(
  payload: unknown,
  status: number,
): McpToolCatalogItem[] {
  if (status < 200 || status >= 300) {
    const message = payload && typeof payload === 'object' && 'message' in payload
      ? String((payload as { message?: unknown }).message)
      : JSON.stringify(payload)
    throw new Error(`Falha ao carregar tools (HTTP ${status}): ${message}`)
  }
  if (!Array.isArray(payload)) {
    throw new Error('Catalogo de tools invalido recebido do EscalaFlow.')
  }
  return payload as McpToolCatalogItem[]
}
