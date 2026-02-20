import type {
  ColabMotor,
  CelulaMotor,
  SlotGrid,
  Feriado,
} from '../validacao-compartilhada'
import {
  CLT,
  isDomingo,
  timeToMin,
  isAprendiz,
  isEstagiario,
  isFeriadoProibido,
  isFeriadoSemCCT,
} from '../validacao-compartilhada'

export function cloneResultadoMap(
  input: Map<number, Map<string, CelulaMotor>>,
): Map<number, Map<string, CelulaMotor>> {
  const output = new Map<number, Map<string, CelulaMotor>>()
  for (const [colabId, mapaDias] of input.entries()) {
    const mapaClone = new Map<string, CelulaMotor>()
    for (const [data, cel] of mapaDias.entries()) {
      mapaClone.set(data, { ...cel })
    }
    output.set(colabId, mapaClone)
  }
  return output
}

export function overwriteResultadoMap(
  target: Map<number, Map<string, CelulaMotor>>,
  source: Map<number, Map<string, CelulaMotor>>,
): void {
  target.clear()
  for (const [colabId, mapaDias] of source.entries()) {
    const mapaClone = new Map<string, CelulaMotor>()
    for (const [data, cel] of mapaDias.entries()) {
      mapaClone.set(data, { ...cel })
    }
    target.set(colabId, mapaClone)
  }
}

export function getDayBounds(grid: SlotGrid[], data: string): { inicio: number; fim: number } | null {
  const slotsDia = grid.filter(s => s.data === data && !s.dia_fechado && !s.feriado_proibido)
  if (slotsDia.length === 0) return null

  let inicio = Number.POSITIVE_INFINITY
  let fim = 0
  for (const slot of slotsDia) {
    inicio = Math.min(inicio, timeToMin(slot.hora_inicio))
    fim = Math.max(fim, timeToMin(slot.hora_fim))
  }

  if (!Number.isFinite(inicio) || fim <= inicio) return null
  return { inicio, fim }
}

export function isPinnedCell(
  pinnedMap: Map<string, unknown>,
  colaboradorId: number,
  data: string,
): boolean {
  return pinnedMap.has(`${colaboradorId}-${data}`)
}

export function checkInterjornada(
  resultado: Map<number, Map<string, CelulaMotor>>,
  colaboradorId: number,
  dias: string[],
  data: string,
  novoInicioMin: number,
  novoFimMin: number,
): boolean {
  const mapa = resultado.get(colaboradorId)
  if (!mapa) return false
  const idx = dias.indexOf(data)
  if (idx < 0) return false

  const prevData = idx > 0 ? dias[idx - 1] : null
  const nextData = idx < dias.length - 1 ? dias[idx + 1] : null
  const prev = prevData ? mapa.get(prevData) : null
  const next = nextData ? mapa.get(nextData) : null

  if (prev?.status === 'TRABALHO' && prev.hora_fim) {
    const descansoPrev = (24 * 60 - timeToMin(prev.hora_fim)) + novoInicioMin
    if (descansoPrev < CLT.MIN_DESCANSO_ENTRE_JORNADAS_MIN) return false
  }

  if (next?.status === 'TRABALHO' && next.hora_inicio) {
    const descansoNext = (24 * 60 - novoFimMin) + timeToMin(next.hora_inicio)
    if (descansoNext < CLT.MIN_DESCANSO_ENTRE_JORNADAS_MIN) return false
  }

  return true
}

export function canWorkBasic(
  colab: ColabMotor,
  data: string,
  feriados: Feriado[],
  resultado?: Map<number, Map<string, CelulaMotor>>,
  dias?: string[],
): boolean {
  // Guardrail expandido antes de validar HARD completo.

  // H11-H14: Aprendiz — NUNCA domingo, feriado, noturno
  if (isAprendiz(colab)) {
    if (isDomingo(data)) return false
    if (isFeriadoProibido(data, feriados)) return false
    if (isFeriadoSemCCT(data, feriados)) return false
    // Qualquer feriado é proibido pra aprendiz
    if (feriados.some(f => f.data === data)) return false
  }

  // H15-H16: Estagiário — NUNCA feriado proibido
  if (isEstagiario(colab)) {
    if (isFeriadoProibido(data, feriados)) return false
  }

  // H17: Feriado proibido — ninguem trabalha (25/12, 01/01)
  if (isFeriadoProibido(data, feriados)) return false

  // H18: Feriado sem CCT — ninguem trabalha
  if (isFeriadoSemCCT(data, feriados)) return false

  // H1: Max 6 dias consecutivos — se já tem 6, não pode ativar folga
  if (resultado && dias) {
    const idx = dias.indexOf(data)
    if (idx >= 0) {
      const mapa = resultado.get(colab.id)
      if (mapa) {
        let consec = 0
        for (let i = idx - 1; i >= 0; i--) {
          const cel = mapa.get(dias[i])
          if (cel?.status === 'TRABALHO') consec++
          else break
        }
        if (consec >= CLT.MAX_DIAS_CONSECUTIVOS) return false
      }
    }
  }

  return true
}
