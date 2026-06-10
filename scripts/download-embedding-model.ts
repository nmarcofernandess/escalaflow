/**
 * Download do modelo de embedding local (multilingual-e5-base ONNX quantizado).
 *
 * Usa @huggingface/transformers que baixa automaticamente do HuggingFace Hub
 * e cacheia em models/embeddings/.
 *
 * Uso: npm run model:download
 */

import path from 'node:path'
import fs from 'node:fs'

const MODEL_DIR = path.join(process.cwd(), 'models', 'embeddings')

async function main() {
  console.log('[model:download] Iniciando download do multilingual-e5-base...')
  console.log(`[model:download] Destino: ${MODEL_DIR}`)

  // Garante diretório existe
  if (!fs.existsSync(MODEL_DIR)) {
    fs.mkdirSync(MODEL_DIR, { recursive: true })
  }

  const { pipeline, env } = await import('@huggingface/transformers')

  // Configura para salvar no diretório local
  env.cacheDir = MODEL_DIR
  env.allowRemoteModels = true // Precisa baixar na primeira vez

  console.log('[model:download] Baixando e inicializando modelo...')
  const extractor = await pipeline('feature-extraction', 'Xenova/multilingual-e5-base', {
    dtype: 'q8' as any, // quantized int8 — bate com o dtype usado pelo app em embeddings.ts
  })

  // Teste rápido
  console.log('[model:download] Testando embedding...')
  const output = await extractor('Teste de embedding local', { pooling: 'mean', normalize: true })
  const dims = (output.data as Float32Array).length
  console.log(`[model:download] OK! Dimensões: ${dims}`)
  if (dims !== 768) {
    throw new Error(`Esperava 768 dimensões, recebeu ${dims}`)
  }

  // Verificar tamanho
  const totalSize = getDirSize(MODEL_DIR)
  console.log(`[model:download] Tamanho total: ${(totalSize / 1024 / 1024).toFixed(1)}MB`)
  console.log('[model:download] Modelo pronto para uso offline.')
}

function getDirSize(dir: string): number {
  let size = 0
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        size += getDirSize(fullPath)
      } else {
        size += fs.statSync(fullPath).size
      }
    }
  } catch { /* ignore */ }
  return size
}

main().catch((err) => {
  console.error('[model:download] ERRO:', err.message)
  process.exitCode = 1
})
// NÃO chamar process.exit() aqui. O onnxruntime-node mantém um thread pool
// nativo ativo; um process.exit() abrupto dispara SIGABRT ("mutex lock
// failed") no teardown e gera o popup "Electron encerrou inesperadamente".
// Deixar o event loop drenar naturalmente encerra limpo.
