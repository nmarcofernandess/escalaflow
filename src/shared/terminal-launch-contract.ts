import { APP_IDENTITY } from './app-identity'

export const AI_TERMINAL_COMMAND_ARGS = ['chat', '--attach'] as const

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

export function buildAiTerminalCommand(input?: { projectCwd?: string }): string {
  const cliScript = input?.projectCwd
    ? `npm --prefix ${shellQuote(input.projectCwd)} run cli`
    : APP_IDENTITY.cliNpmScript
  return `${cliScript} -- ${AI_TERMINAL_COMMAND_ARGS.join(' ')}`
}

export function buildAiTerminalSingleShotCommand(message: string, input?: { projectCwd?: string }): string {
  const escaped = message.replace(/'/g, `'\\''`)
  const cliScript = input?.projectCwd
    ? `npm --prefix ${shellQuote(input.projectCwd)} run cli`
    : APP_IDENTITY.cliNpmScript
  return `${cliScript} -- chat '${escaped}'`
}

export const AI_TERMINAL_COPY = {
  title: APP_IDENTITY.terminalAgentName,
  description: `Abre o ${APP_IDENTITY.assistantName} configurado no Terminal do sistema.`,
  primaryAction: 'Abrir IA no Terminal do Sistema',
  configureAction: 'Configurar IA',
  copyCommandAction: 'Copiar comando',
  noConfig: 'Configure uma IA para abrir no Terminal.',
  manualFallback: 'Cole este comando no Terminal do sistema se a abertura automatica for bloqueada.',
} as const
