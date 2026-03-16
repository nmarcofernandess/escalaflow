import type { Alocacao, RegraHorarioColaborador } from '@shared/index'

const DAY_LABELS = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB'] as const

export function encontrarDomingoDaSemana(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  const diff = d.getDay()
  d.setDate(d.getDate() - diff)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

export function tipoFolga(
  data: string,
  regra: RegraHorarioColaborador | undefined,
  alocacoes: Alocacao[],
  colaboradorId?: number,
): 'FF' | 'FV' | 'DF' | 'F' {
  const dow = new Date(data + 'T00:00:00').getDay()
  const dayLabel = DAY_LABELS[dow]
  if (regra?.folga_fixa_dia_semana === dayLabel) return 'FF'
  if (regra?.folga_variavel_dia_semana === dayLabel) {
    const domDate = encontrarDomingoDaSemana(data)
    const domAloc = alocacoes.find(a => {
      if (a.data !== domDate) return false
      if (colaboradorId != null && a.colaborador_id !== colaboradorId) return false
      return true
    })
    if (domAloc?.status === 'TRABALHO') return 'FV'
  }
  if (dow === 0) return 'DF'
  return 'F'
}
