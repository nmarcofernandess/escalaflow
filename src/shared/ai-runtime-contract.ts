export type AiRuntimeReadinessCode =
  | 'configMissing'
  | 'credentialMissing'
  | 'credentialInvalid'
  | 'providerUnreachable'
  | 'rateLimited'
  | 'modelDownloadRequired'
  | 'modelDownloading'
  | 'modelDownloadCanceled'
  | 'modelLoadingFailed'
  | 'modelCorrupt'
  | 'cliMissing'
  | 'toolsUnavailable'
  | 'osUnsupported'
  | 'ready'

export type AiRuntimeUiAction =
  | 'openConfig'
  | 'downloadModel'
  | 'waitDownload'
  | 'retryDownload'
  | 'repairModel'
  | 'copyCommand'
  | 'launchTerminal'

export interface ResolvedAiRuntime {
  provider: 'gemini' | 'openrouter' | 'local' | null
  model: string | null
  displayName: string
  toolsAvailable: boolean
  toolsCount: number
  validatedAt: string | null
  validationTtlMs: number
}

export interface AiTerminalReadiness {
  ok: boolean
  code: AiRuntimeReadinessCode
  label: string
  message: string
  action: AiRuntimeUiAction
  blocksLaunch: boolean
  runtime: ResolvedAiRuntime
  command: string
  cwd: string
}

export const AI_RUNTIME_READINESS_COPY: Record<
  AiRuntimeReadinessCode,
  Omit<AiTerminalReadiness, 'runtime' | 'command' | 'cwd'>
> = {
  configMissing: {
    ok: false,
    code: 'configMissing',
    label: 'IA nao configurada',
    message: 'Configure provider e modelo antes de abrir o Terminal.',
    action: 'openConfig',
    blocksLaunch: true,
  },
  credentialMissing: {
    ok: false,
    code: 'credentialMissing',
    label: 'IA precisa de credencial',
    message: 'Informe a API key/token do provider ativo.',
    action: 'openConfig',
    blocksLaunch: true,
  },
  credentialInvalid: {
    ok: false,
    code: 'credentialInvalid',
    label: 'Credencial invalida',
    message: 'A credencial foi recusada pelo provider.',
    action: 'openConfig',
    blocksLaunch: true,
  },
  providerUnreachable: {
    ok: false,
    code: 'providerUnreachable',
    label: 'Provider indisponivel',
    message: 'Nao foi possivel validar o provider agora.',
    action: 'copyCommand',
    blocksLaunch: true,
  },
  rateLimited: {
    ok: false,
    code: 'rateLimited',
    label: 'Limite de uso atingido',
    message: 'O provider respondeu rate limit. Tente novamente mais tarde.',
    action: 'copyCommand',
    blocksLaunch: true,
  },
  modelDownloadRequired: {
    ok: false,
    code: 'modelDownloadRequired',
    label: 'Modelo local precisa baixar',
    message: 'Baixe o modelo local antes de abrir o Terminal.',
    action: 'downloadModel',
    blocksLaunch: true,
  },
  modelDownloading: {
    ok: false,
    code: 'modelDownloading',
    label: 'Download em progresso',
    message: 'Aguarde o download do modelo local terminar.',
    action: 'waitDownload',
    blocksLaunch: true,
  },
  modelDownloadCanceled: {
    ok: false,
    code: 'modelDownloadCanceled',
    label: 'Download cancelado',
    message: 'Retome ou reinicie o download do modelo local.',
    action: 'retryDownload',
    blocksLaunch: true,
  },
  modelLoadingFailed: {
    ok: false,
    code: 'modelLoadingFailed',
    label: 'Modelo local com erro',
    message: 'O arquivo existe, mas o carregamento falhou.',
    action: 'repairModel',
    blocksLaunch: true,
  },
  modelCorrupt: {
    ok: false,
    code: 'modelCorrupt',
    label: 'Modelo local corrompido',
    message: 'O arquivo local parece incompleto ou invalido.',
    action: 'repairModel',
    blocksLaunch: true,
  },
  cliMissing: {
    ok: false,
    code: 'cliMissing',
    label: 'CLI nao encontrado',
    message: 'O comando do CLI nao esta disponivel neste build.',
    action: 'copyCommand',
    blocksLaunch: true,
  },
  toolsUnavailable: {
    ok: false,
    code: 'toolsUnavailable',
    label: 'Tools indisponiveis',
    message: 'A conversa nao abre como Terminal IA sem acoes de terminal/arquivos disponiveis.',
    action: 'copyCommand',
    blocksLaunch: true,
  },
  osUnsupported: {
    ok: false,
    code: 'osUnsupported',
    label: 'SO nao suportado',
    message: 'Este sistema nao tem abertura automatica configurada. Use o comando manual.',
    action: 'copyCommand',
    blocksLaunch: true,
  },
  ready: {
    ok: true,
    code: 'ready',
    label: 'IA pronta',
    message: 'Provider, modelo, CLI e tools estao prontos para abrir no Terminal.',
    action: 'launchTerminal',
    blocksLaunch: false,
  },
}
