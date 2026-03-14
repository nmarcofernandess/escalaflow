import { existsSync } from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

/**
 * Resolve the MCP server binary path.
 * Follows the same precedence as resolveSolverPath() in solver-bridge.ts.
 */
export function resolveMcpPath(): string {
  // 1. Explicit env var override
  const explicit = process.env.ESCALAFLOW_MCP_PATH?.trim()
  if (explicit) {
    if (existsSync(explicit)) return explicit
    throw new Error(`ESCALAFLOW_MCP_PATH aponta para arquivo inexistente: ${explicit}`)
  }

  const isWin = process.platform === 'win32'
  const binNames = isWin
    ? ['escalaflow-mcp.exe', 'escalaflow-mcp']
    : ['escalaflow-mcp']

  // Detect packaged Electron context
  let isPackaged = false
  try {
    const electron = require('electron') as { app?: { isPackaged?: boolean } }
    isPackaged = Boolean(electron.app?.isPackaged)
  } catch {
    // not in Electron context
  }

  // 2. Built binary in project root (dev after running mcp:build)
  for (const name of binNames) {
    const devBin = path.join(process.cwd(), 'mcp-bin', name)
    if (existsSync(devBin)) return devBin
  }

  // 3. Production: packaged with Electron resources
  if (isPackaged) {
    for (const name of binNames) {
      const prodBin = path.join(process.resourcesPath, 'mcp-bin', name)
      if (existsSync(prodBin)) return prodBin
    }
  }

  // 4. Fallback dev: source (requires Node + tsx)
  const devSource = path.join(process.cwd(), 'mcp-server', 'index.ts')
  if (existsSync(devSource)) return devSource

  throw new Error(
    'MCP server nao encontrado. Em dev, rode mcp:build ou use mcp:dev. ' +
    'Em producao, o binario deveria estar em Resources/mcp-bin/.'
  )
}

/**
 * Whether the resolved path is the TS source (needs npx tsx) vs compiled binary.
 */
export function isMcpSource(mcpPath: string): boolean {
  return mcpPath.endsWith('.ts')
}
