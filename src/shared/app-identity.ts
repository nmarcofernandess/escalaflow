export const APP_IDENTITY = {
  appName: 'EscalaFlow',
  productName: 'EscalaFlow',
  assistantName: 'Assistente IA',
  terminalAgentName: 'Assistente IA no Terminal',
  cliName: 'escalaflow',
  cliDisplayName: 'EscalaFlow CLI',
  cliNpmScript: 'npm run cli',
  enableTerminalLauncher: true,
} as const

export type AppIdentity = typeof APP_IDENTITY
