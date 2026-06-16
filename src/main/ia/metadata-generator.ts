import { generateText } from 'ai'
import { buildModelFactory } from './config'
import { assertIaRouteReady } from './routing'
import { buildRouteBackedIaConfig, getActiveIaConfig, type ReadyAiRoute } from './route-config'
import type { IaConfiguracao } from '../../shared/types'
import type { AiRouteResolution } from '../../shared/ia-routing-contract'

export interface RagMetadataSuggestion {
  titulo: string
  quando_consultar: string
}

export interface RagMetadataResult extends RagMetadataSuggestion {
  route: AiRouteResolution
}

export interface RagTextCorrectionResult {
  resultado: string
  route: AiRouteResolution
}

function capText(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized.length <= maxLength ? normalized : normalized.slice(0, maxLength).trim()
}

function extractJsonObject(raw: string): string {
  const first = raw.indexOf('{')
  const last = raw.lastIndexOf('}')
  if (first < 0 || last <= first) {
    throw new Error('Resposta de metadata não contém JSON válido.')
  }
  return raw.slice(first, last + 1)
}

function assertCloudRoute(route: AiRouteResolution): asserts route is AiRouteResolution & {
  provider: 'gemini' | 'openrouter'
  model: string
} {
  if (route.provider !== 'gemini' && route.provider !== 'openrouter') {
    throw new Error(`Rota ${route.label} não é cloud.`)
  }
  if (!route.model) {
    throw new Error(`Rota ${route.label} não definiu modelo.`)
  }
}

export function parseMetadataSuggestion(raw: unknown): RagMetadataSuggestion {
  if (typeof raw !== 'string' || !raw.trim()) {
    throw new Error('Resposta de metadata vazia ou não textual.')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(extractJsonObject(raw))
  } catch {
    throw new Error('Resposta de metadata não contém JSON válido.')
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Resposta de metadata precisa ser um objeto JSON.')
  }

  const record = parsed as Record<string, unknown>
  const titulo = typeof record.titulo === 'string' ? capText(record.titulo, 120) : ''
  const quandoConsultar = typeof record.quando_consultar === 'string'
    ? capText(record.quando_consultar, 280)
    : ''

  if (!titulo || !quandoConsultar) {
    throw new Error('Resposta de metadata precisa conter titulo e quando_consultar.')
  }

  return {
    titulo,
    quando_consultar: quandoConsultar,
  }
}

function buildMetadataPrompt(texto: string, fileNameFallback: string): string {
  return [
    'Gere metadados de RAG para o documento abaixo.',
    'Responda APENAS com um objeto JSON válido, sem markdown e sem texto fora do JSON.',
    'Formato obrigatório: {"titulo":"...","quando_consultar":"..."}',
    'titulo: título curto e específico, máximo 120 caracteres.',
    'quando_consultar: frase prática dizendo quando a IA deve consultar o documento, máximo 280 caracteres.',
    `Nome de arquivo fallback: ${fileNameFallback}`,
    '',
    texto.slice(0, 8000),
  ].join('\n')
}

function buildCorrectionPrompt(texto: string): string {
  return [
    'Corrija ortografia e gramática do texto abaixo sem mudar o conteúdo, a intenção ou a formatação.',
    'Responda apenas com o texto corrigido.',
    '',
    texto.slice(0, 12000),
  ].join('\n')
}

// Shared cloud generation path used by both metadata and text-correction.
// route is already ready (provider/model present); assertCloudRoute guards against a local route.
async function generateCloudText(
  prompt: string,
  route: ReadyAiRoute,
  configForCloud?: IaConfiguracao,
): Promise<string> {
  assertCloudRoute(route)
  const config = configForCloud ?? await getActiveIaConfig()
  if (!config) throw new Error('Assistente IA não configurado para rota cloud.')
  const cloudConfig = buildRouteBackedIaConfig(config, route)
  const factory = buildModelFactory(cloudConfig)
  if (!factory) throw new Error(`Provider ${route.provider}/${route.model} indisponível para gerar texto.`)

  const result = await generateText({
    model: factory.createModel(factory.modelo),
    prompt,
  })
  return result.text
}

export async function generateRagMetadata(
  input: { texto: string; fileNameFallback: string },
  configForCloud?: IaConfiguracao,
): Promise<RagMetadataResult> {
  const route = await assertIaRouteReady('rag_metadata', { validateLocal: true })
  const prompt = buildMetadataPrompt(input.texto, input.fileNameFallback)

  const raw = route.provider === 'local'
    ? await (async () => {
        const { localLlmGenerateJson, LOCAL_MODELS } = await import('./local-llm')
        return localLlmGenerateJson(prompt, { modelId: asLocalModelId(route.model, LOCAL_MODELS), maxTokens: 512 })
      })()
    : await generateCloudText(prompt, route, configForCloud)

  return {
    ...parseMetadataSuggestion(raw),
    route,
  }
}

export async function generateRagTextCorrection(
  texto: string,
  configForCloud?: IaConfiguracao,
): Promise<RagTextCorrectionResult> {
  const route = await assertIaRouteReady('rag_metadata', { validateLocal: true })
  const prompt = buildCorrectionPrompt(texto)

  if (route.provider === 'local') {
    const { localLlmChat } = await import('./local-llm')
    // EscalaFlow's localLlmChat resolves the single active local model (no modelId override
    // param like FlowKit); route.model is already validated as that model, so behavior matches.
    const result = await localLlmChat(prompt, [], `rag-text-correction-${Date.now()}`)
    return { resultado: result.resposta.trim(), route }
  }

  const raw = await generateCloudText(prompt, route, configForCloud)
  return { resultado: raw.trim(), route }
}

// EscalaFlow's local-llm.ts does not export asLocalModelId (FlowKit does). Narrow inline against
// LOCAL_MODELS so a route-resolved model string is safely typed before calling localLlmGenerateJson.
function asLocalModelId<T extends Record<string, unknown>>(value: string, models: T): keyof T {
  if (Object.prototype.hasOwnProperty.call(models, value)) {
    return value as keyof T
  }
  throw new Error(`Modelo local desconhecido: "${value}".`)
}
