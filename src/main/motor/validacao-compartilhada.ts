import { CLT, type DiaSemana } from '../../shared'
import type { Demanda, Violacao, Indicadores } from '../../shared'

// ─── Tipos compartilhados ───────────────────────────────────────────────────

export interface ColabValidacao {
  id: number
  nome: string
  sexo: 'M' | 'F'
  horas_semanais: number
  prefere_turno: 'MANHA' | 'TARDE' | null
  evitar_dia_semana: DiaSemana | null
  max_minutos_dia: number
  dias_trabalho: number
  trabalha_domingo: boolean
}

export interface CelulaValidacao {
  status: string
  hora_inicio: string | null
  hora_fim: string | null
  minutos: number | null
}

export interface LookbackData {
  diasConsec: number
  domConsec: number
}

// ─── Helpers de data/hora compartilhados ────────────────────────────────────

const JS_DAY_MAP: DiaSemana[] = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB']

export function diaSemana(dateStr: string): DiaSemana {
  return JS_DAY_MAP[new Date(dateStr + 'T12:00:00').getDay()]
}

export function isDomingo(dateStr: string): boolean {
  return new Date(dateStr + 'T12:00:00').getDay() === 0
}

export function timeToMin(time: string): number {
  const [h, m] = time.split(':').map(Number)
  return h * 60 + m
}

export function minToTime(min: number): string {
  const h = Math.floor(min / 60)
  const m = min % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

export function dateRange(inicio: string, fim: string): string[] {
  const dates: string[] = []
  const d = new Date(inicio + 'T12:00:00')
  const end = new Date(fim + 'T12:00:00')
  while (d <= end) {
    dates.push(d.toISOString().split('T')[0])
    d.setDate(d.getDate() + 1)
  }
  return dates
}

/** Agrupa datas em semanas, iniciando no dia definido pelo corte_semanal.
 *  corte_semanal segue o formato do schema: 'SEG_DOM', 'QUI_QUA', etc.
 *  Os primeiros 3 caracteres indicam o dia de inicio da semana.
 *  Default: 'SEG' (segunda) para backward compatibility. */
export function getWeeks(dates: string[], corte_semanal?: string): string[][] {
  const startDay: DiaSemana = corte_semanal
    ? (corte_semanal.slice(0, 3) as DiaSemana)
    : 'SEG'
  const weeks: string[][] = []
  let current: string[] = []
  for (const d of dates) {
    if (diaSemana(d) === startDay && current.length > 0) {
      weeks.push(current)
      current = []
    }
    current.push(d)
  }
  if (current.length > 0) weeks.push(current)
  return weeks
}

// ─── Meta diaria compartilhada ───────────────────────────────────────────────

/** Calcula meta diaria em minutos a partir do contrato do colaborador.
 *  Usada pelo gerador (FASE 5 — alocacao de horarios) para definir duracao do turno. */
export function calcMetaDiariaMin(horas_semanais: number, dias_trabalho: number): number {
  return Math.round((horas_semanais * 60) / dias_trabalho)
}

// ─── Validacao R1-R8 ────────────────────────────────────────────────────────

export function validarRegras(
  colaboradores: ColabValidacao[],
  resultado: Map<number, Map<string, CelulaValidacao>>,
  demandas: Demanda[],
  dias: string[],
  lookback: Map<number, LookbackData>,
  tolerancia_min: number,
  corte_semanal?: string,
): Violacao[] {
  const violacoes: Violacao[] = []
  const domingos = dias.filter(d => isDomingo(d))

  for (const c of colaboradores) {
    const mapa = resultado.get(c.id)!
    const diasOrdered = [...mapa.entries()].sort((a, b) => a[0].localeCompare(b[0]))

    // R1: Max dias consecutivos
    let consec = lookback.get(c.id)?.diasConsec ?? 0
    for (const [d, cel] of diasOrdered) {
      if (cel.status === 'TRABALHO') {
        consec++
        if (consec > CLT.MAX_DIAS_CONSECUTIVOS) {
          violacoes.push({
            severidade: 'HARD', regra: 'MAX_DIAS_CONSECUTIVOS',
            colaborador_id: c.id, colaborador_nome: c.nome,
            mensagem: `${c.nome} trabalhou ${consec} dias seguidos (max ${CLT.MAX_DIAS_CONSECUTIVOS})`,
            data: d,
          })
        }
      } else { consec = 0 }
    }

    // R2: Min descanso entre jornadas
    let prevFim: number | null = null
    let prevData: string | null = null
    for (const [d, cel] of diasOrdered) {
      if (cel.status === 'TRABALHO' && cel.hora_fim) {
        if (prevFim !== null && prevData !== null) {
          const p = new Date(prevData + 'T12:00:00')
          const curr = new Date(d + 'T12:00:00')
          const daysDiff = Math.round((curr.getTime() - p.getTime()) / 86400000)
          if (daysDiff === 1) {
            const descanso = (1440 - prevFim) + timeToMin(cel.hora_inicio!)
            if (descanso < CLT.MIN_DESCANSO_ENTRE_JORNADAS_MIN) {
              violacoes.push({
                severidade: 'HARD', regra: 'DESCANSO_ENTRE_JORNADAS',
                colaborador_id: c.id, colaborador_nome: c.nome,
                mensagem: `${c.nome}: so ${descanso}min entre ${prevData} e ${d} (min ${CLT.MIN_DESCANSO_ENTRE_JORNADAS_MIN}min)`,
                data: d,
              })
            }
          }
        }
        prevFim = timeToMin(cel.hora_fim)
        prevData = d
      } else { prevFim = null; prevData = null }
    }

    // R3: Rodizio de domingo
    let domC = lookback.get(c.id)?.domConsec ?? 0
    const maxDom = CLT.MAX_DOMINGOS_CONSECUTIVOS[c.sexo]
    for (const d of domingos) {
      const cel = mapa.get(d)
      if (cel && cel.status === 'TRABALHO') {
        domC++
        if (domC > maxDom) {
          violacoes.push({
            severidade: 'HARD', regra: 'RODIZIO_DOMINGO',
            colaborador_id: c.id, colaborador_nome: c.nome,
            mensagem: `${c.nome}: ${domC} domingos seguidos (max ${maxDom})`,
            data: d,
          })
        }
      } else { domC = 0 }
    }

    // R3b: Estagiario no domingo (HARD) — contrato proibe trabalho dominical
    if (!c.trabalha_domingo) {
      for (const d of domingos) {
        const cel = mapa.get(d)
        if (cel && cel.status === 'TRABALHO') {
          violacoes.push({
            severidade: 'HARD', regra: 'ESTAGIARIO_DOMINGO',
            colaborador_id: c.id, colaborador_nome: c.nome,
            mensagem: `${c.nome}: escalado no domingo ${d} mas contrato proibe (trabalha_domingo=false)`,
            data: d,
          })
        }
      }
    }

    // R4: Max jornada diaria (usa o limite mais restritivo entre CLT global e contrato)
    const limiteMaxDia = Math.min(CLT.MAX_JORNADA_DIARIA_MIN, c.max_minutos_dia)
    for (const [d, cel] of diasOrdered) {
      if (cel.status === 'TRABALHO' && cel.minutos && cel.minutos > limiteMaxDia) {
        const regra = limiteMaxDia < CLT.MAX_JORNADA_DIARIA_MIN ? 'CONTRATO_MAX_DIA' : 'MAX_JORNADA_DIARIA'
        violacoes.push({
          severidade: 'HARD', regra,
          colaborador_id: c.id, colaborador_nome: c.nome,
          mensagem: `${c.nome}: ${cel.minutos}min em ${d} (max ${limiteMaxDia}min)`,
          data: d,
        })
      }
    }

    // R5: Meta semanal (SOFT)
    // Tolerancia absorve variacao natural do rodizio de domingo (1 dia inteiro)
    const metaDiariaMin = Math.round((c.horas_semanais * 60) / 7)
    const tolBase = Math.max(tolerancia_min, metaDiariaMin)
    const weeks = getWeeks(dias, corte_semanal)
    for (const week of weeks) {
      if (week.length < 4) continue

      let totalMin = 0
      for (const d of week) {
        const cel = mapa.get(d)
        if (cel && cel.status === 'TRABALHO' && cel.minutos) totalMin += cel.minutos
      }
      const weekRatio = week.length / 7
      const metaScaled = Math.round(c.horas_semanais * 60 * weekRatio)
      const tolScaled = Math.round(tolBase * (1 / weekRatio))
      if (Math.abs(totalMin - metaScaled) > tolScaled) {
        violacoes.push({
          severidade: 'SOFT', regra: 'META_SEMANAL',
          colaborador_id: c.id, colaborador_nome: c.nome,
          mensagem: `${c.nome}: ${Math.round(totalMin / 60)}h na semana (meta ~${Math.round(metaScaled / 60)}h)`,
          data: week[0],
        })
      }
    }

    // R6: Preferencia de dia (SOFT)
    if (c.evitar_dia_semana) {
      const count = diasOrdered.filter(
        ([d, cel]) => cel.status === 'TRABALHO' && diaSemana(d) === c.evitar_dia_semana
      ).length
      if (count > 0) {
        violacoes.push({
          severidade: 'SOFT', regra: 'PREFERENCIA_DIA',
          colaborador_id: c.id, colaborador_nome: c.nome,
          mensagem: `${c.nome} trabalhou ${count}x em ${c.evitar_dia_semana} (prefere folga)`,
          data: null,
        })
      }
    }

    // R7: Preferencia de turno (SOFT)
    if (c.prefere_turno) {
      for (const [d, cel] of diasOrdered) {
        if (cel.status !== 'TRABALHO' || !cel.hora_inicio) continue
        const hi = timeToMin(cel.hora_inicio)
        if (c.prefere_turno === 'MANHA' && hi >= 720) {
          violacoes.push({
            severidade: 'SOFT', regra: 'PREFERENCIA_TURNO',
            colaborador_id: c.id, colaborador_nome: c.nome,
            mensagem: `${c.nome}: alocado a tarde em ${d} (prefere manha)`,
            data: d,
          })
        } else if (c.prefere_turno === 'TARDE' && hi < 720) {
          violacoes.push({
            severidade: 'SOFT', regra: 'PREFERENCIA_TURNO',
            colaborador_id: c.id, colaborador_nome: c.nome,
            mensagem: `${c.nome}: alocado de manha em ${d} (prefere tarde)`,
            data: d,
          })
        }
      }
    }
  }

  // R8: Cobertura por faixa (SOFT)
  for (const d of dias) {
    const ds = diaSemana(d)
    const faixasDia = demandas.filter(dem => dem.dia_semana === ds || dem.dia_semana === null)

    for (const faixa of faixasDia) {
      let alocados = 0
      for (const c of colaboradores) {
        const cel = resultado.get(c.id)!.get(d)!
        if (cel.status === 'TRABALHO' && cel.hora_inicio && cel.hora_fim) {
          const pIni = timeToMin(cel.hora_inicio)
          const pFim = timeToMin(cel.hora_fim)
          const fIni = timeToMin(faixa.hora_inicio)
          const fFim = timeToMin(faixa.hora_fim)
          if (pIni < fFim && pFim > fIni) alocados++
        }
      }
      if (alocados < faixa.min_pessoas) {
        violacoes.push({
          severidade: 'SOFT', regra: 'COBERTURA',
          colaborador_id: null, colaborador_nome: '',
          mensagem: `${d} ${faixa.hora_inicio}-${faixa.hora_fim}: ${alocados}/${faixa.min_pessoas} pessoas`,
          data: d,
        })
      }
    }
  }

  return violacoes
}

// ─── Scoring ────────────────────────────────────────────────────────────────

export function calcularIndicadores(
  colaboradores: ColabValidacao[],
  resultado: Map<number, Map<string, CelulaValidacao>>,
  demandas: Demanda[],
  dias: string[],
  violacoes: Violacao[],
): Indicadores {
  // Cobertura %
  let totalFaixas = 0
  let faixasAtendidas = 0
  for (const d of dias) {
    const ds = diaSemana(d)
    for (const faixa of demandas.filter(dem => dem.dia_semana === ds || dem.dia_semana === null)) {
      totalFaixas++
      let alocados = 0
      for (const c of colaboradores) {
        const cel = resultado.get(c.id)!.get(d)!
        if (cel.status === 'TRABALHO' && cel.hora_inicio && cel.hora_fim) {
          const pIni = timeToMin(cel.hora_inicio)
          const pFim = timeToMin(cel.hora_fim)
          if (pIni < timeToMin(faixa.hora_fim) && pFim > timeToMin(faixa.hora_inicio)) alocados++
        }
      }
      if (alocados >= faixa.min_pessoas) faixasAtendidas++
    }
  }
  const cobertura_percent = totalFaixas > 0 ? (faixasAtendidas / totalFaixas) * 100 : 100

  const violacoes_hard = violacoes.filter(v => v.severidade === 'HARD').length
  const violacoes_soft = violacoes.filter(v => v.severidade === 'SOFT').length

  // Equilibrio: desvio padrao do % da meta atingida (normalizado por contrato)
  const semanas = Math.max(1, dias.length / 7)
  const percMeta = colaboradores.map(c => {
    let totalMin = 0
    for (const d of dias) {
      const cel = resultado.get(c.id)!.get(d)!
      if (cel.minutos) totalMin += cel.minutos
    }
    const metaMin = c.horas_semanais * semanas * 60
    return metaMin > 0 ? (totalMin / metaMin) * 100 : 100
  })
  const avg = percMeta.reduce((s, v) => s + v, 0) / (percMeta.length || 1)
  const variance = percMeta.reduce((s, v) => s + (v - avg) ** 2, 0) / (percMeta.length || 1)
  const equilibrio = Math.max(0, 100 - Math.sqrt(variance) * 2)

  const pontuacao = Math.round(
    cobertura_percent * 0.4 +
    (violacoes_hard === 0 ? 100 : 0) * 0.3 +
    equilibrio * 0.2 +
    Math.max(0, 100 - violacoes_soft * 10) * 0.1
  )

  return {
    cobertura_percent: Math.round(cobertura_percent * 100) / 100,
    violacoes_hard,
    violacoes_soft,
    equilibrio: Math.round(equilibrio * 100) / 100,
    pontuacao,
  }
}
