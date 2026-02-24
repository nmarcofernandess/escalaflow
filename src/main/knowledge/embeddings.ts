import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

/**
 * Embedding local via @huggingface/transformers (ONNX Runtime).
 * Modelo: multilingual-e5-small (384 dims, ~118MB quantizado).
 *
 * ZERO deps externas: funciona offline, sem API key, sem internet.
 * Graceful degradation: retorna null se modelo indisponível.
 */

let _extractor: any = null

function resolveModelPath(): string {
  try {
    const electron = require('electron') as { app?: { isPackaged?: boolean } }
    if (electron.app?.isPackaged) {
      return path.join(process.resourcesPath, 'models', 'embeddings')
    }
  } catch {
    // fallback para modo Node (test runner, scripts)
  }
  return path.join(__dirname, '../../models/embeddings')
}

async function getExtractor(): Promise<any> {
  if (_extractor) return _extractor

  const { pipeline, env } = await import('@huggingface/transformers')

  const modelPath = resolveModelPath()
  env.localModelPath = modelPath
  env.allowRemoteModels = false

  _extractor = await pipeline('feature-extraction', 'Xenova/multilingual-e5-small', {
    dtype: 'q8' as any, // quantized int8
  } as any)

  return _extractor
}

/**
 * Gera embedding para um texto. Retorna null se modelo indisponível.
 * Graceful degradation: NUNCA lança erro — retorna null.
 */
export async function generateEmbedding(text: string): Promise<number[] | null> {
  try {
    const ext = await getExtractor()
    const output = await ext(text, { pooling: 'mean', normalize: true })
    return Array.from(output.data as Float32Array)
  } catch (err) {
    console.warn('[knowledge:embeddings] Modelo local indisponível:', (err as Error).message)
    return null
  }
}

/**
 * Gera embeddings em lote. Retorna null se modelo indisponível.
 * Processa sequencialmente para controle de memória.
 * Graceful degradation: NUNCA lança erro — retorna null.
 */
export async function generateEmbeddings(texts: string[]): Promise<number[][] | null> {
  try {
    const ext = await getExtractor()
    const results: number[][] = []
    for (const text of texts) {
      const output = await ext(text, { pooling: 'mean', normalize: true })
      results.push(Array.from(output.data as Float32Array))
    }
    return results
  } catch (err) {
    console.warn('[knowledge:embeddings] Modelo local indisponível:', (err as Error).message)
    return null
  }
}
