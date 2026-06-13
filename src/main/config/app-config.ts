/**
 * EscalaFlow — Configuracao central do app.
 *
 * Para renomear o projeto:
 * 1. Mude name e icon aqui
 * 2. Mude name e productName em package.json
 * 3. Mude productName e appId em electron-builder.yml
 */

export const APP_CONFIG = {
  /** Nome exibido na sidebar, title bar, wizard */
  name: 'EscalaFlow',

  /** Nome do icone lucide-react pra sidebar header */
  icon: 'Workflow',

  /** Descricao curta (wizard + about) */
  description: 'Escalas CLT offline com IA, RAG e terminal local',

  /** Nome do diretorio PGlite dentro de userData */
  dbName: 'escalaflow-pg',

  /** Tema default no primeiro boot */
  defaultTheme: 'dark' as const,

  /** Paleta de cor default */
  defaultPalette: 'zinc' as const,

  /** Max memorias da IA (manual + auto) */
  maxMemories: 50,

  /** Max resultados de busca hibrida */
  maxSearchResults: 10,

  /** Max rounds de tool calling por mensagem */
  toolMaxSteps: 10,

  /** Threshold de tokens pra compactar sessao */
  compactionThreshold: 30_000,

  /** Env vars pra fallback de API keys */
  envKeys: {
    gemini: 'GOOGLE_API_KEY',
    geminiAlternate: 'GEMINI_API_KEY',
    openrouter: 'OPENROUTER_API_KEY',
  } as Record<string, string>,
}

/**
 * API Gemini direta (Google Generative AI / @ai-sdk/google).
 * Fica ligada por padrão; use `ESCALAFLOW_GEMINI_ENABLE=0` para desligar localmente.
 */
export function isGeminiCloudApiEnabled(): boolean {
  const v = process.env.ESCALAFLOW_GEMINI_ENABLE?.trim().toLowerCase()
  if (v === '0' || v === 'false' || v === 'no') return false
  if (v === '1' || v === 'true' || v === 'yes') return true
  return true
}
