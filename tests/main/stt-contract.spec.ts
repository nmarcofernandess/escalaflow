import { describe, expect, it } from 'vitest'
import type {
  SttModelCatalogItem,
  SttModelId,
  SttModelStatus,
  SttStatus,
  SttTranscriptResult,
} from '../../src/shared/types'
import { transcribeWavBase64 } from '../../src/main/stt/download'

describe('stt shared contract', () => {
  it('models Parakeet as transcript-first local STT', () => {
    const modelId: SttModelId = 'parakeet-v3-int8'
    const catalogItem: SttModelCatalogItem = {
      id: modelId,
      label: 'Parakeet V3 int8',
      engine: 'parakeet',
      format: 'sherpa-onnx',
      description: 'ASR local',
      url: 'https://example.com/parakeet.tar.gz',
      filename: 'parakeet',
      size_bytes: 1,
      storage: 'directory',
      ram_minima_gb: 2,
      languages: ['pt'],
      supports_pt: true,
      supports_translation: false,
      supports_language_hint: false,
      asr_only: true,
      recommended: true,
      notes: 'local',
    }
    const modelStatus: SttModelStatus = {
      id: modelId,
      label: 'Parakeet V3 int8',
      baixado: false,
      path: '/tmp/parakeet',
      caminho: '/tmp/parakeet',
      size_bytes: 1,
      tamanho_bytes: 1,
      notes: 'local',
    }
    const status: SttStatus = {
      disponivel: false,
      active_model_id: modelId,
      default_model_id: modelId,
      modelos: { 'parakeet-v3-int8': modelStatus },
      sidecar_path: '/tmp/escalaflow-stt',
      sidecar_disponivel: false,
      reason: 'missing_sidecar',
    }
    const result: SttTranscriptResult = {
      text: 'Preciso cadastrar uma escala seis por um para o setor de acougue.',
      raw_text: 'Preciso cadastrar uma escala seis por um para o setor de acougue.',
      model_id: modelId,
      duration_ms: 1200,
      audio_duration_ms: 4500,
      language: 'pt',
      post_processed: false,
    }

    expect(catalogItem.id).toBe(modelId)
    expect(status.modelos[modelId].baixado).toBe(false)
    expect(result.model_id).toBe('parakeet-v3-int8')
    expect(result.post_processed).toBe(false)
  })

  it('rejects inert post-processing options instead of pretending to polish the transcript', async () => {
    await expect(transcribeWavBase64({
      wav_base64: 'UklGRg==',
      post_process: true,
      mode: 'clean_prompt',
      domain_terms: ['folga', '6x1'],
    })).rejects.toThrow('Polimento de texto STT ainda nao esta implementado')
  })
})
