type SegmentoPersistido = {
  hora_inicio: string
  hora_fim: string
  min_pessoas: number
  override: boolean
}

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/

export function parseDemandaPadraoSegmentos(raw: string | null | undefined): SegmentoPersistido[] {
  if (!raw) return []

  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []

    return parsed.flatMap((item) => {
      if (!item || typeof item !== 'object') return []
      const candidate = item as Record<string, unknown>
      const horaInicio = typeof candidate.hora_inicio === 'string' ? candidate.hora_inicio : ''
      const horaFim = typeof candidate.hora_fim === 'string' ? candidate.hora_fim : ''
      const minPessoas = typeof candidate.min_pessoas === 'number' ? candidate.min_pessoas : Number.NaN
      if (!TIME_RE.test(horaInicio) || !TIME_RE.test(horaFim) || !Number.isInteger(minPessoas) || minPessoas < 1) {
        return []
      }
      return [{
        hora_inicio: horaInicio,
        hora_fim: horaFim,
        min_pessoas: minPessoas,
        override: Boolean(candidate.override),
      }]
    })
  } catch {
    return []
  }
}

export function stringifyDemandaPadraoSegmentos(segmentos: SegmentoPersistido[]): string {
  return JSON.stringify(segmentos.map((seg) => ({
    hora_inicio: seg.hora_inicio,
    hora_fim: seg.hora_fim,
    min_pessoas: seg.min_pessoas,
    override: Boolean(seg.override),
  })))
}
