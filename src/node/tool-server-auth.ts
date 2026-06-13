import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const TOOL_SERVER_TOKEN_ENV = 'ESCALAFLOW_TOOL_SERVER_TOKEN'
export const TOOL_SERVER_TOKEN_FILE_ENV = 'ESCALAFLOW_TOOL_SERVER_TOKEN_FILE'

function defaultUserDataDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env.ESCALAFLOW_USER_DATA_DIR) return env.ESCALAFLOW_USER_DATA_DIR
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library/Application Support/EscalaFlow')
  }
  return path.join(os.homedir(), '.config', 'EscalaFlow')
}

export function resolveToolServerTokenPath(env: NodeJS.ProcessEnv = process.env): string {
  return env[TOOL_SERVER_TOKEN_FILE_ENV]?.trim() || path.join(defaultUserDataDir(env), 'tool-server-token')
}

export function readToolServerTokenIfExists(env: NodeJS.ProcessEnv = process.env): string | null {
  const explicit = env[TOOL_SERVER_TOKEN_ENV]?.trim()
  if (explicit) return explicit

  const tokenPath = resolveToolServerTokenPath(env)
  try {
    const token = fs.readFileSync(tokenPath, 'utf8').trim()
    return token || null
  } catch {
    return null
  }
}

export function getOrCreateToolServerToken(env: NodeJS.ProcessEnv = process.env): string {
  const existing = readToolServerTokenIfExists(env)
  if (existing) return existing

  const tokenPath = resolveToolServerTokenPath(env)
  const token = crypto.randomBytes(32).toString('base64url')
  fs.mkdirSync(path.dirname(tokenPath), { recursive: true, mode: 0o700 })
  fs.writeFileSync(tokenPath, `${token}\n`, { mode: 0o600 })
  return token
}

export function buildToolServerAuthHeaders(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const token = readToolServerTokenIfExists(env)
  return token ? { Authorization: `Bearer ${token}` } : {}
}
