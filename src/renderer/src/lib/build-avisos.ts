import type { Aviso } from '@/componentes/AvisosSection'
import type { AvisoEscala } from '@/store/appDataStore'
import type { PreviewDiagnostic } from '@shared/index'

// ---------------------------------------------------------------------------
// Params for buildPreviewAvisos — mirrors the useMemo dependencies from
// SetorDetalhe.tsx.  Pure function, zero hooks.
// ---------------------------------------------------------------------------

export interface BuildPreviewAvisosParams {
  previewDiagnostics: PreviewDiagnostic[]
  storePreviewAvisos: AvisoEscala[]
  avisosOperacao: AvisoEscala[]
  semTitular: number
  foraDoPreview: number
  setorNome?: string
  advisoryDiagnostics?: PreviewDiagnostic[]
}

/**
 * Builds the unified list of preview avisos shown in the AvisosSection.
 *
 * Merges four sources:
 *  1. PreviewDiagnostics (capacity, domingo_ciclo, etc)
 *  2. simulacaoPreview counters (semTitular, foraDoPreview)
 *  3. Store preview avisos (derivados)
 *  4. Operacao avisos (preflight, solver feedback)
 *
 * Deduplicates by id.
 */
export function buildPreviewAvisos({
  previewDiagnostics,
  storePreviewAvisos,
  avisosOperacao,
  semTitular,
  foraDoPreview,
  setorNome,
  advisoryDiagnostics,
}: BuildPreviewAvisosParams): Aviso[] {
  const entries: Aviso[] = []

  for (const diagnostic of previewDiagnostics) {
    entries.push({
      id: `diagnostic_${diagnostic.code}`,
      nivel: diagnostic.severity === 'error' ? 'error' : diagnostic.severity === 'warning' ? 'warning' : 'info',
      titulo: diagnostic.title,
      descricao: diagnostic.detail,
      contexto_ia: `Diagnostico de preview: ${diagnostic.title}. ${diagnostic.detail}`,
    })
  }

  if (semTitular > 0) {
    entries.push({
      id: 'preview_sem_titular',
      nivel: 'info',
      titulo: `${semTitular} posto(s) ativo(s) ainda sem titular.`,
      descricao: 'Posto sem titular nao entra na geracao nem na validacao. Anexe alguem ao posto para ele contar na escala.',
      contexto_ia: 'Existem postos ativos sem titular; eles ficam fora da escala.',
    })
  }

  if (foraDoPreview > 0) {
    entries.push({
      id: 'preview_intermitentes',
      nivel: 'info',
      titulo: `${foraDoPreview} participante(s) intermitente(s) ficaram fora do preview.`,
      descricao: 'Intermitente nao entra no ciclo automatico de folgas do painel setorial.',
      contexto_ia: 'Participantes intermitentes foram ignorados no preview setorial.',
    })
  }

  for (const aviso of storePreviewAvisos) {
    entries.push({
      id: `store_${aviso.id}`,
      nivel: aviso.nivel === 'erro' ? 'error' : aviso.nivel === 'aviso' ? 'warning' : 'info',
      titulo: aviso.titulo,
      descricao: aviso.detalhe ?? '',
      contexto_ia: `Aviso do setor ${setorNome ?? ''}: ${aviso.titulo}. ${aviso.detalhe ?? ''}`,
    })
  }

  for (const aviso of avisosOperacao) {
    entries.push({
      id: `operacao_${aviso.id}`,
      nivel: aviso.nivel === 'erro' ? 'error' : aviso.nivel === 'aviso' ? 'warning' : 'info',
      titulo: aviso.titulo,
      descricao: aviso.detalhe ?? '',
      contexto_ia: `Aviso de operacao: ${aviso.titulo}. ${aviso.detalhe ?? ''}`,
    })
  }

  // Advisory diagnostics tem precedencia sobre preview diagnostics com mesmo codigo base
  if (advisoryDiagnostics && advisoryDiagnostics.length > 0) {
    const advisoryBaseCodes = new Set(
      advisoryDiagnostics.map((d) => d.code.replace('ADVISORY_', '')),
    )
    // Remove preview diagnostics que o advisory ja cobre
    const filtered = entries.filter((e) => {
      if (!e.id.startsWith('diagnostic_')) return true
      const baseCode = e.id.replace('diagnostic_', '')
      return !advisoryBaseCodes.has(baseCode)
    })
    entries.length = 0
    entries.push(...filtered)
  }

  if (advisoryDiagnostics) {
    for (const diagnostic of advisoryDiagnostics) {
      entries.push({
        id: `advisory_${diagnostic.code}`,
        nivel: diagnostic.severity === 'error' ? 'error' : diagnostic.severity === 'warning' ? 'warning' : 'info',
        titulo: diagnostic.title,
        descricao: diagnostic.detail,
        contexto_ia: `Diagnostico do advisory solver: ${diagnostic.title}. ${diagnostic.detail}`,
      })
    }
  }

  return [...new Map(entries.map((item) => [item.id, item])).values()]
}
