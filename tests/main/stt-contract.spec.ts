import { describe, expect, it } from 'vitest'
import type {
  SttModelCatalogItem,
  SttModelId,
  SttModelStatus,
  SttPostProcessOptions,
  SttStatus,
  SttTranscriptResult,
} from '../../src/shared/types'

describe('stt shared contract', () => {
  it('exposes the local STT contract types', () => {
    const modelId: SttModelId = 'parakeet-v3-int8'
    const catalogItem: SttModelCatalogItem = {
      id: modelId,
      label: 'Parakeet',
      engine: 'parakeet',
      format: 'sherpa-onnx',
      description: 'ASR',
      url: 'https://example.com/model.tar.bz2',
      filename: 'parakeet',
      size_bytes: 1,
      storage: 'directory',
      languages: ['pt'],
      supports_pt: true,
      asr_only: true,
      recommended: true,
    }
    const modelStatus: SttModelStatus = {
      id: modelId,
      baixado: false,
      caminho: '/tmp/parakeet',
      tamanho_bytes: 1,
    }
    const status: SttStatus = {
      default_model_id: modelId,
      modelos: {
        'parakeet-v3-int8': modelStatus,
        'whisper-small-q5': { ...modelStatus, id: 'whisper-small-q5' },
        'whisper-medium-q5': { ...modelStatus, id: 'whisper-medium-q5' },
      },
      sidecar_path: '/tmp/escalaflow-stt',
      sidecar_disponivel: false,
    }
    const options: SttPostProcessOptions = {
      post_process: true,
      mode: 'rh_notes',
      domain_terms: ['folga', '6x1'],
    }
    const result: SttTranscriptResult = {
      text: 'criar escala do acougue',
      language: 'pt',
      model_id: modelId,
      post_processed: false,
      raw_text: 'criar escala do acougue',
    }

    expect(catalogItem.id).toBe(modelId)
    expect(status.modelos[modelId].baixado).toBe(false)
    expect(options.domain_terms).toContain('6x1')
    expect(result.post_processed).toBe(false)
  })
})
