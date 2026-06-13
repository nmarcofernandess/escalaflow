import { statSync } from 'node:fs'
import path from 'node:path'

export function resolveExistingDirectory(cwd: string): string {
  const resolved = path.resolve(cwd)
  let stat: ReturnType<typeof statSync>
  try {
    stat = statSync(resolved)
  } catch {
    throw new Error(`Diretorio nao encontrado: ${resolved}`)
  }
  if (!stat.isDirectory()) throw new Error(`Diretorio nao encontrado: ${resolved}`)
  return resolved
}
