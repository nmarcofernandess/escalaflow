import type Database from 'better-sqlite3'
import { CLT, DIAS_SEMANA, type DiaSemana } from '@escalaflow/shared'
import type { Setor, Demanda, Excecao, Alocacao, Violacao } from '@escalaflow/shared'

// ─── Tipos internos do motor ────────────────────────────────────────────────

interface ColabComContrato {
  id: number
  setor_id: number
  tipo_contrato_id: number
  nome: string
  sexo: 'M' | 'F'
  horas_semanais: number
  rank: number
  prefere_turno: 'MANHA' | 'TARDE' | null
  evitar_dia_semana: DiaSemana | null
  ativo: boolean
  dias_trabalho: number
  trabalha_domingo: boolean
  max_minutos_dia: number
}

interface Celula {
  status: 'TRABALHO' | 'FOLGA' | 'INDISPONIVEL'
  hora_inicio: string | null
  hora_fim: string | null
  minutos: number | null
}

export interface MotorResultado {
  alocacoes: Omit<Alocacao, 'id' | 'escala_id'>[]
  violacoes: Violacao[]
  pontuacao: number
  cobertura_percent: number
  violacoes_hard: number
  violacoes_soft: number
  equilibrio: number
}

// ─── Helpers de data/hora ───────────────────────────────────────────────────

function dateRange(inicio: string, fim: string): string[] {
  const dates: string[] = []
  const d = new Date(inicio + 'T12:00:00')
  const end = new Date(fim + 'T12:00:00')
  while (d <= end) {
    dates.push(d.toISOString().split('T')[0])
    d.setDate(d.getDate() + 1)
  }
  return dates
}

const JS_DAY_MAP: DiaSemana[] = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB']

function diaSemana(dateStr: string): DiaSemana {
  return JS_DAY_MAP[new Date(dateStr + 'T12:00:00').getDay()]
}

function isDomingo(dateStr: string): boolean {
  return new Date(dateStr + 'T12:00:00').getDay() === 0
}

function timeToMin(time: string): number {
  const [h, m] = time.split(':').map(Number)
  return h * 60 + m
}

function minToTime(min: number): string {
  const h = Math.floor(min / 60)
  const m = min % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/** Agrupa datas em semanas (SEG como inicio de semana) */
function getWeeks(dates: string[]): string[][] {
  const weeks: string[][] = []
  let current: string[] = []
  for (const d of dates) {
    if (diaSemana(d) === 'SEG' && current.length > 0) {
      weeks.push(current)
      current = []
    }
    current.push(d)
  }
  if (current.length > 0) weeks.push(current)
  return weeks
}

/** Soma de min_pessoas das faixas de demanda que cobrem um dia da semana */
function demandaTotalDia(demandas: Demanda[], dia: DiaSemana): number {
  return demandas
    .filter(d => d.dia_semana === dia || d.dia_semana === null)
    .reduce((sum, d) => sum + d.min_pessoas, 0)
}

/** Max min_pessoas de qualquer faixa para o dia */
function demandaMaxFaixa(demandas: Demanda[], dia: DiaSemana): number {
  return demandas
    .filter(d => d.dia_semana === dia || d.dia_semana === null)
    .reduce((max, d) => Math.max(max, d.min_pessoas), 0)
}

// ─── MOTOR PRINCIPAL ────────────────────────────────────────────────────────

export function gerarProposta(
  setor_id: number,
  data_inicio: string,
  data_fim: string,
  db: Database.Database,
  tolerancia_min?: number
): MotorResultado {

  // ═══════════════════════════════════════════════════════════════════════════
  // FASE 1 — PREPARACAO (com lookback)
  // ═══════════════════════════════════════════════════════════════════════════

  const setor = db.prepare('SELECT * FROM setores WHERE id = ?').get(setor_id) as Setor

  const colaboradores = db.prepare(`
    SELECT c.*, tc.dias_trabalho, tc.trabalha_domingo, tc.max_minutos_dia
    FROM colaboradores c
    JOIN tipos_contrato tc ON c.tipo_contrato_id = tc.id
    WHERE c.setor_id = ? AND c.ativo = 1
    ORDER BY c.rank DESC
  `).all(setor_id) as ColabComContrato[]

  const demandas = db.prepare(
    'SELECT * FROM demandas WHERE setor_id = ?'
  ).all(setor_id) as Demanda[]

  const colabIds = colaboradores.map(c => c.id)
  const excecoes: Excecao[] = colabIds.length > 0
    ? db.prepare(`
        SELECT * FROM excecoes
        WHERE colaborador_id IN (${colabIds.map(() => '?').join(',')})
          AND data_inicio <= ? AND data_fim >= ?
      `).all(...colabIds, data_fim, data_inicio) as Excecao[]
    : []

  // Lookback: escala OFICIAL anterior
  const escalaAnterior = db.prepare(`
    SELECT * FROM escalas
    WHERE setor_id = ? AND status = 'OFICIAL' AND data_fim < ?
    ORDER BY data_fim DESC LIMIT 1
  `).get(setor_id, data_inicio) as { id: number } | undefined

  const lookback = new Map<number, { diasConsec: number; domConsec: number }>()

  if (escalaAnterior) {
    const lb = new Date(data_inicio + 'T12:00:00')
    lb.setDate(lb.getDate() - 7)
    const lbStr = lb.toISOString().split('T')[0]

    const prevAlocs = db.prepare(`
      SELECT * FROM alocacoes
      WHERE escala_id = ? AND data >= ?
      ORDER BY data DESC
    `).all(escalaAnterior.id, lbStr) as Alocacao[]

    for (const c of colaboradores) {
      const mine = prevAlocs
        .filter(a => a.colaborador_id === c.id)
        .sort((a, b) => b.data.localeCompare(a.data))

      let diasConsec = 0
      for (const a of mine) {
        if (a.status === 'TRABALHO') diasConsec++
        else break
      }

      let domConsec = 0
      for (const a of mine.filter(a => isDomingo(a.data))) {
        if (a.status === 'TRABALHO') domConsec++
        else break
      }

      lookback.set(c.id, { diasConsec, domConsec })
    }
  }

  for (const c of colaboradores) {
    if (!lookback.has(c.id)) {
      lookback.set(c.id, { diasConsec: 0, domConsec: 0 })
    }
  }

  const dias = dateRange(data_inicio, data_fim)

  // ═══════════════════════════════════════════════════════════════════════════
  // FASE 2 — MAPA DE DISPONIBILIDADE
  // ═══════════════════════════════════════════════════════════════════════════

  const resultado = new Map<number, Map<string, Celula>>()

  for (const c of colaboradores) {
    const mapa = new Map<string, Celula>()
    for (const d of dias) {
      const temExcecao = excecoes.some(
        e => e.colaborador_id === c.id && e.data_inicio <= d && e.data_fim >= d
      )
      mapa.set(d, {
        status: temExcecao ? 'INDISPONIVEL' : 'TRABALHO',
        hora_inicio: null, hora_fim: null, minutos: null,
      })
    }
    resultado.set(c.id, mapa)
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FASE 3 — DISTRIBUICAO DE FOLGAS (SEG-SAB; domingo fica pra FASE 4)
  // ═══════════════════════════════════════════════════════════════════════════

  for (const c of colaboradores) {
    const mapa = resultado.get(c.id)!
    const folgasSemana = 7 - c.dias_trabalho
    let consecutivos = lookback.get(c.id)!.diasConsec
    const weeks = getWeeks(dias)

    // Colabs sem domingo: marcar DOM como FOLGA imediatamente
    if (!c.trabalha_domingo) {
      for (const d of dias) {
        if (isDomingo(d) && mapa.get(d)!.status !== 'INDISPONIVEL') {
          mapa.get(d)!.status = 'FOLGA'
        }
      }
    }

    for (const week of weeks) {
      // Dias disponiveis pra FASE 3 = nao-INDISPONIVEL e nao-domingo (se trabalha_domingo)
      // Para quem NAO trabalha domingo, domingo ja ta FOLGA
      const weekDays = c.trabalha_domingo
        ? week.filter(d => !isDomingo(d) && mapa.get(d)!.status !== 'INDISPONIVEL')
        : week.filter(d => !isDomingo(d) && mapa.get(d)!.status !== 'INDISPONIVEL' && mapa.get(d)!.status !== 'FOLGA')

      // Folgas ja garantidas nesta semana (INDISPONIVEL + domingos-folga)
      const restJaGarantido = week.filter(d => {
        const cel = mapa.get(d)!
        return cel.status === 'INDISPONIVEL' || cel.status === 'FOLGA'
      }).length

      let folgasNecessarias = Math.max(0, folgasSemana - restJaGarantido)
      // Proporção pra semanas parciais
      if (week.length < 7) {
        folgasNecessarias = Math.max(0, Math.round(folgasSemana * week.length / 7) - restJaGarantido)
      }
      folgasNecessarias = Math.min(folgasNecessarias, weekDays.length)

      if (folgasNecessarias <= 0) {
        // Atualizar consecutivos
        for (const d of week) {
          const cel = mapa.get(d)!
          if (cel.status === 'TRABALHO') consecutivos++
          else consecutivos = 0
        }
        continue
      }

      // Pontuar cada dia pra escolher melhor folga
      const scored = weekDays.map(d => {
        const ds = diaSemana(d)
        let score = 0
        if (c.evitar_dia_semana && ds === c.evitar_dia_semana) score += 100
        score -= demandaTotalDia(demandas, ds) // menor demanda = melhor pra folga
        return { date: d, score }
      })
      scored.sort((a, b) => b.score - a.score)

      // Primeira tentativa: top-scored
      const folgaSet = new Set(scored.slice(0, folgasNecessarias).map(s => s.date))

      // Checar constraint de 6 dias consecutivos
      let tempConsec = consecutivos
      let violou = false
      for (const d of week) {
        const cel = mapa.get(d)!
        if (cel.status === 'INDISPONIVEL' || cel.status === 'FOLGA' || folgaSet.has(d)) {
          tempConsec = 0
        } else {
          tempConsec++
          if (tempConsec > CLT.MAX_DIAS_CONSECUTIVOS) { violou = true; break }
        }
      }

      // Se violou, redistribuir com safety
      if (violou) {
        folgaSet.clear()
        tempConsec = consecutivos
        let assigned = 0
        for (const d of week) {
          const cel = mapa.get(d)!
          if (cel.status === 'INDISPONIVEL' || cel.status === 'FOLGA') {
            tempConsec = 0; continue
          }
          tempConsec++
          if (tempConsec >= CLT.MAX_DIAS_CONSECUTIVOS && assigned < folgasNecessarias && weekDays.includes(d)) {
            folgaSet.add(d); assigned++; tempConsec = 0
          }
        }
        // Preencher se faltou
        for (const s of scored) {
          if (folgaSet.size >= folgasNecessarias) break
          if (!folgaSet.has(s.date)) folgaSet.add(s.date)
        }
      }

      // Aplicar folgas
      for (const d of folgaSet) {
        mapa.get(d)!.status = 'FOLGA'
      }

      // Atualizar consecutivos pro fim da semana
      consecutivos = 0
      for (let i = week.length - 1; i >= 0; i--) {
        const cel = mapa.get(week[i])!
        if (cel.status === 'TRABALHO') consecutivos++
        else break
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FASE 4 — RODIZIO DE DOMINGO (com lookback)
  // ═══════════════════════════════════════════════════════════════════════════

  const domingos = dias.filter(d => isDomingo(d))
  const colabsDomingo = colaboradores.filter(c => c.trabalha_domingo)

  const domConsecState = new Map<number, number>()
  const domTotalState = new Map<number, number>()
  for (const c of colabsDomingo) {
    domConsecState.set(c.id, lookback.get(c.id)!.domConsec)
    domTotalState.set(c.id, 0)
  }

  for (const domingo of domingos) {
    const maxNeeded = demandaMaxFaixa(demandas, 'DOM')
    if (maxNeeded === 0) {
      // Sem demanda no domingo — todos folgam
      for (const c of colabsDomingo) {
        const cel = resultado.get(c.id)!.get(domingo)!
        if (cel.status !== 'INDISPONIVEL') {
          cel.status = 'FOLGA'
          domConsecState.set(c.id, 0)
        }
      }
      continue
    }

    // Disponiveis: nao INDISPONIVEL e dentro do limite de domingos consecutivos
    const disponiveis = colabsDomingo.filter(c => {
      const cel = resultado.get(c.id)!.get(domingo)!
      if (cel.status === 'INDISPONIVEL') return false
      const max = CLT.MAX_DOMINGOS_CONSECUTIVOS[c.sexo]
      return domConsecState.get(c.id)! < max
    })

    // Ordenar: menos domingos trabalhados → rank maior
    disponiveis.sort((a, b) => {
      const diff = domTotalState.get(a.id)! - domTotalState.get(b.id)!
      if (diff !== 0) return diff
      return b.rank - a.rank
    })

    const toSchedule = Math.min(maxNeeded, disponiveis.length)
    const scheduled = new Set<number>()

    for (let i = 0; i < toSchedule; i++) {
      const c = disponiveis[i]
      scheduled.add(c.id)
      resultado.get(c.id)!.get(domingo)!.status = 'TRABALHO'
      domConsecState.set(c.id, domConsecState.get(c.id)! + 1)
      domTotalState.set(c.id, domTotalState.get(c.id)! + 1)
    }

    // Nao-escalados → FOLGA no domingo, reset consecutivo
    for (const c of colabsDomingo) {
      if (!scheduled.has(c.id)) {
        const cel = resultado.get(c.id)!.get(domingo)!
        if (cel.status !== 'INDISPONIVEL') {
          cel.status = 'FOLGA'
          domConsecState.set(c.id, 0)
        }
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FASE 4.5 — REPAIR: corrigir >6 dias consecutivos (pos-domingo)
  // ═══════════════════════════════════════════════════════════════════════════
  // FASE 3 distribui folgas em SEG-SAB, FASE 4 decide domingos.
  // A combinacao pode gerar streaks >6. Este pass corrige.

  for (const c of colaboradores) {
    const mapa = resultado.get(c.id)!
    let consec = lookback.get(c.id)!.diasConsec

    for (const d of dias) {
      const cel = mapa.get(d)!
      if (cel.status === 'TRABALHO') {
        consec++
        if (consec > CLT.MAX_DIAS_CONSECUTIVOS) {
          cel.status = 'FOLGA'
          cel.hora_inicio = null; cel.hora_fim = null; cel.minutos = null
          consec = 0
        }
      } else {
        consec = 0
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FASE 5 — ALOCACAO DE HORARIOS (cobertura-first + preferencia + rank)
  // ═══════════════════════════════════════════════════════════════════════════
  // Estrategia: para cada dia, testa multiplos horarios de inicio por colab
  // e escolhe o que mais preenche deficit de cobertura nas faixas.
  // O bandaCount agora rastreia cobertura REAL (overlap), nao so a faixa "escolhida".

  const bandaCount = new Map<string, number>()
  const setorIniMin = timeToMin(setor.hora_abertura)
  const setorFimMin = timeToMin(setor.hora_fechamento)

  for (const d of dias) {
    const ds = diaSemana(d)
    const colabsDia = colaboradores
      .filter(c => resultado.get(c.id)!.get(d)!.status === 'TRABALHO')
      .sort((a, b) => b.rank - a.rank)

    const faixas = demandas.filter(dem => dem.dia_semana === ds || dem.dia_semana === null)

    for (const c of colabsDia) {
      const metaDiariaMin = Math.round((c.horas_semanais * 60) / c.dias_trabalho)
      const duracao = Math.min(metaDiariaMin, c.max_minutos_dia)

      if (faixas.length === 0) {
        const ini = setorIniMin
        const fim = Math.min(ini + duracao, setorFimMin)
        const cel = resultado.get(c.id)!.get(d)!
        cel.hora_inicio = minToTime(ini)
        cel.hora_fim = minToTime(fim)
        cel.minutos = fim - ini
        continue
      }

      // Gerar candidatos de horario: inicio E fim de cada faixa + turno noite
      const startTimes = new Set<number>()
      for (const f of faixas) {
        startTimes.add(timeToMin(f.hora_inicio))
        // Terminar no fim da faixa (maximiza cobertura no final dela)
        startTimes.add(Math.max(setorIniMin, timeToMin(f.hora_fim) - duracao))
      }
      // Turno noturno: comecar de tras pra frente
      startTimes.add(Math.max(setorIniMin, setorFimMin - duracao))

      let bestIni = setorIniMin
      let bestFim = Math.min(setorIniMin + duracao, setorFimMin)
      let bestScore = -Infinity

      for (const rawIni of startTimes) {
        let ini = rawIni
        let fim = ini + duracao

        // Clamp ao setor
        if (fim > setorFimMin) {
          fim = setorFimMin
          ini = Math.max(setorIniMin, setorFimMin - duracao)
        }
        if (ini < setorIniMin) {
          ini = setorIniMin
          fim = Math.min(setorFimMin, setorIniMin + duracao)
        }

        // Pontuar: MAX deficit proporcional entre faixas cobertas
        // Usar MAX (nao SUM) evita que cobrir 2 bandas tenha vantagem desproporcional
        // sobre a preferencia de turno do colaborador
        let maxDeficitPct = 0
        let coversMultiple = 0
        for (const faixa of faixas) {
          const fIni = timeToMin(faixa.hora_inicio)
          const fFim = timeToMin(faixa.hora_fim)
          if (ini < fFim && fim > fIni) {
            const key = `${d}|${faixa.id}`
            const jaAlocados = bandaCount.get(key) || 0
            const deficit = faixa.min_pessoas - jaAlocados
            if (deficit > 0) {
              maxDeficitPct = Math.max(maxDeficitPct, (deficit / faixa.min_pessoas) * 100)
              coversMultiple++
            }
          }
        }
        // Score: max deficit + small bonus por cobrir multiplas bandas com deficit
        let score = maxDeficitPct + (coversMultiple > 1 ? 15 : 0)

        // Preferencia de turno (peso forte o suficiente pra competir com coverage)
        if (c.prefere_turno === 'MANHA' && ini < 720) score += 40
        else if (c.prefere_turno === 'TARDE' && ini >= 720) score += 40

        // Tie-breaking awareness: MANHA prefere mais cedo, TARDE/sem pref prefere mais tarde
        const preferEarlier = c.prefere_turno === 'MANHA'
        const tieWins = preferEarlier ? ini < bestIni : ini > bestIni
        if (score > bestScore || (score === bestScore && tieWins)) {
          bestScore = score
          bestIni = ini
          bestFim = fim
        }
      }

      const cel = resultado.get(c.id)!.get(d)!
      cel.hora_inicio = minToTime(bestIni)
      cel.hora_fim = minToTime(bestFim)
      cel.minutos = bestFim - bestIni

      // Atualizar bandaCount pra TODAS as faixas que o shift cobre (overlap real)
      for (const faixa of faixas) {
        const fIni = timeToMin(faixa.hora_inicio)
        const fFim = timeToMin(faixa.hora_fim)
        if (bestIni < fFim && bestFim > fIni) {
          const key = `${d}|${faixa.id}`
          bandaCount.set(key, (bandaCount.get(key) || 0) + 1)
        }
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FASE 6 — VALIDACAO (R1-R8)
  // ═══════════════════════════════════════════════════════════════════════════

  const violacoes: Violacao[] = []
  const TOLERANCIA_MIN = tolerancia_min ?? 30

  for (const c of colaboradores) {
    const mapa = resultado.get(c.id)!
    const diasOrdered = [...mapa.entries()].sort((a, b) => a[0].localeCompare(b[0]))

    // R1: Max dias consecutivos
    let consec = lookback.get(c.id)!.diasConsec
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
    let domC = lookback.get(c.id)!.domConsec
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

    // R4: Max jornada diaria
    for (const [d, cel] of diasOrdered) {
      if (cel.status === 'TRABALHO' && cel.minutos && cel.minutos > CLT.MAX_JORNADA_DIARIA_MIN) {
        violacoes.push({
          severidade: 'HARD', regra: 'MAX_JORNADA_DIARIA',
          colaborador_id: c.id, colaborador_nome: c.nome,
          mensagem: `${c.nome}: ${cel.minutos}min em ${d} (max ${CLT.MAX_JORNADA_DIARIA_MIN}min)`,
          data: d,
        })
      }
    }

    // R5: Meta semanal (SOFT) — escala a meta pra semanas parciais
    const weeks = getWeeks(dias)
    for (const week of weeks) {
      // Semanas muito curtas (< 4 dias) nao tem como avaliar meta
      if (week.length < 4) continue

      let totalMin = 0
      for (const d of week) {
        const cel = mapa.get(d)
        if (cel && cel.status === 'TRABALHO' && cel.minutos) totalMin += cel.minutos
      }
      const weekRatio = week.length / 7
      const metaScaled = Math.round(c.horas_semanais * 60 * weekRatio)
      // Tolerancia proporcionalmente mais generosa pra semanas parciais
      const tolScaled = Math.round(TOLERANCIA_MIN * (1 / weekRatio))
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

  // ═══════════════════════════════════════════════════════════════════════════
  // FASE 7 — SCORING
  // ═══════════════════════════════════════════════════════════════════════════

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
  const cobertura = totalFaixas > 0 ? (faixasAtendidas / totalFaixas) * 100 : 100

  const hardCount = violacoes.filter(v => v.severidade === 'HARD').length
  const softCount = violacoes.filter(v => v.severidade === 'SOFT').length

  // Equilibrio: desvio padrao de minutos totais entre colaboradores
  const minutosPerColab = colaboradores.map(c => {
    let total = 0
    for (const d of dias) {
      const cel = resultado.get(c.id)!.get(d)!
      if (cel.minutos) total += cel.minutos
    }
    return total
  })
  const avg = minutosPerColab.reduce((s, v) => s + v, 0) / (minutosPerColab.length || 1)
  const variance = minutosPerColab.reduce((s, v) => s + (v - avg) ** 2, 0) / (minutosPerColab.length || 1)
  const equilibrio = Math.max(0, 100 - Math.sqrt(variance) * 0.5)

  const pontuacao = Math.round(
    cobertura * 0.4 +
    (hardCount === 0 ? 100 : 0) * 0.3 +
    equilibrio * 0.2 +
    Math.max(0, 100 - softCount * 10) * 0.1
  )

  // ═══════════════════════════════════════════════════════════════════════════
  // OUTPUT
  // ═══════════════════════════════════════════════════════════════════════════

  const alocacoes: Omit<Alocacao, 'id' | 'escala_id'>[] = []
  for (const c of colaboradores) {
    for (const d of dias) {
      const cel = resultado.get(c.id)!.get(d)!
      alocacoes.push({
        colaborador_id: c.id,
        data: d,
        status: cel.status,
        hora_inicio: cel.hora_inicio,
        hora_fim: cel.hora_fim,
        minutos: cel.minutos,
      })
    }
  }

  return {
    alocacoes,
    violacoes,
    pontuacao,
    cobertura_percent: Math.round(cobertura * 100) / 100,
    violacoes_hard: hardCount,
    violacoes_soft: softCount,
    equilibrio: Math.round(equilibrio * 100) / 100,
  }
}
