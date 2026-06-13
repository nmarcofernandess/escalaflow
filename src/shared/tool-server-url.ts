export const DEFAULT_TOOL_SERVER_PORT = 17380
export const DEFAULT_TOOL_SERVER_HOST = '127.0.0.1'

export function resolveToolServerPort(env: Record<string, string | undefined> = process.env): number {
  const raw = env.ESCALAFLOW_TOOL_SERVER_PORT?.trim()
  if (!raw) return DEFAULT_TOOL_SERVER_PORT
  const parsed = Number(raw)
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 65_535
    ? parsed
    : DEFAULT_TOOL_SERVER_PORT
}

export function resolveToolServerUrl(env: Record<string, string | undefined> = process.env): string {
  const explicit = env.ESCALAFLOW_TOOL_SERVER?.trim()
  if (explicit) return explicit.replace(/\/$/, '')
  return `http://${DEFAULT_TOOL_SERVER_HOST}:${resolveToolServerPort(env)}`
}
