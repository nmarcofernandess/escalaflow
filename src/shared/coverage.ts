export interface CoberturaDemandaSlot {
  data?: string
  hora_inicio: string
  hora_fim?: string
  planejado: number
  executado: number
  ignorar_cobertura?: boolean
}

export interface CoberturaDemandaResultado {
  cobertura_percent: number
  cobertura_efetiva_percent: number
  slots_total: number
  slots_cobertos: number
  slots_efetivos_cobertos: number
}

const TRANSICAO_FAIXAS: Array<[number, number]> = [
  [7 * 60, 7 * 60 + 30],
  [11 * 60, 12 * 60],
  [19 * 60, 19 * 60 + 30],
]

function timeToMin(time: string): number {
  const [h = 0, m = 0] = time.split(':').map(Number)
  return h * 60 + m
}

export function calcularCoberturaDemanda(
  slots: readonly CoberturaDemandaSlot[],
): CoberturaDemandaResultado {
  let slotsTotal = 0
  let slotsCobertos = 0
  let slotsEfetivosCobertos = 0

  for (const slot of slots) {
    if (slot.ignorar_cobertura) continue

    slotsTotal++
    const coberto = slot.executado >= slot.planejado
    if (coberto) {
      slotsCobertos++
      slotsEfetivosCobertos++
      continue
    }

    const deficit = slot.planejado - slot.executado
    const slotInicioMin = timeToMin(slot.hora_inicio)
    const inTransicao = TRANSICAO_FAIXAS.some(([from, to]) => (
      slotInicioMin >= from && slotInicioMin < to
    ))

    if (inTransicao && deficit === 1) {
      slotsEfetivosCobertos++
    }
  }

  return {
    cobertura_percent: slotsTotal > 0
      ? Math.round((slotsCobertos / slotsTotal) * 100)
      : 100,
    cobertura_efetiva_percent: slotsTotal > 0
      ? Math.round((slotsEfetivosCobertos / slotsTotal) * 100)
      : 100,
    slots_total: slotsTotal,
    slots_cobertos: slotsCobertos,
    slots_efetivos_cobertos: slotsEfetivosCobertos,
  }
}
