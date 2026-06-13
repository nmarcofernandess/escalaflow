const SHELL_COMMANDS = new Set([
  'cd', 'ls', 'pwd', 'npm', 'npx', 'node', 'git', 'cat', 'rg', 'find', 'open',
  'mkdir', 'rm', 'cp', 'mv', 'echo', 'python', 'python3', 'curl', 'which',
  'whoami', 'date', 'clear', 'exit', 'code', 'pnpm', 'yarn',
])

export function looksLikeChatMessage(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed) return false
  if (/[|&;<>()`$]/.test(trimmed)) return false
  const [first] = trimmed.split(/\s+/)
  if (SHELL_COMMANDS.has(first.toLowerCase())) return false
  return trimmed.includes('?') || trimmed.split(/\s+/).length >= 3
}
