import type Database from 'better-sqlite3'
import { CLT, type DiaSemana, type StatusAlocacao } from '../../shared'
import type { Setor, Demanda, Excecao, Alocacao, Violacao } from '../../shared'

export type PinnedCell = { status: StatusAlocacao; hora_inicio?: string | null; hora_fim?: string | null }
import {
  diaSemana, isDomingo, timeToMin, minToTime, dateRange, getWeeks,
  validarRegras, calcularIndicadores, calcMetaDiariaMin,
  type CelulaValidacao,
} from './validacao-compartilhada'

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

// ─── Helpers exclusivos do gerador ──────────────────────────────────────────

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
  tolerancia_min?: number,
  pinnedCells?: Map<string, PinnedCell>
): MotorResultado {
  // ─── Validacao de inputs ────────────────────────────────────────────────────
  const setorCheck = db.prepare('SELECT id FROM setores WHERE id = ? AND ativo = 1').get(setor_id) as { id: number } | undefined
  if (!setorCheck) throw new Error('Setor nao encontrado ou inativo')

  if (data_inicio > data_fim) throw new Error('Data inicio deve ser anterior a data fim')

  const colabCount = db.prepare('SELECT COUNT(*) as c FROM colaboradores WHERE setor_id = ? AND ativo = 1').get(setor_id) as { c: number }
  if (colabCount.c === 0) throw new Error('Setor nao tem colaboradores ativos')

  const isPinned = (colabId: number, date: string) =>
    pinnedCells?.has(`${colabId}-${date}`) ?? false
  const getPinned = (colabId: number, date: string) =>
    pinnedCells?.get(`${colabId}-${date}`)

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

  // Empresa config: corte_semanal
  const empresa = db.prepare('SELECT corte_semanal FROM empresa LIMIT 1').get() as { corte_semanal: string } | undefined
  const corteSemanal = empresa?.corte_semanal ?? 'SEG_DOM'

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
      const pinned = getPinned(c.id, d)
      const temExcecao = excecoes.some(
        e => e.colaborador_id === c.id && e.data_inicio <= d && e.data_fim >= d
      )
      const statusDefault = temExcecao ? 'INDISPONIVEL' : 'TRABALHO'
      const status = pinned ? pinned.status : statusDefault
      mapa.set(d, {
        status,
        hora_inicio: pinned?.hora_inicio ?? null,
        hora_fim: pinned?.hora_fim ?? null,
        minutos: null,
      })
    }
    resultado.set(c.id, mapa)
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FASE 3 — DISTRIBUICAO DE FOLGAS (SEG-SAB; domingo fica pra FASE 4)
  // ═══════════════════════════════════════════════════════════════════════════

  // Stagger: rastreia quantos colabs ja folgam em cada dia pra distribuir
  const folgasPorDia = new Map<string, number>()

  for (const c of colaboradores) {
    const mapa = resultado.get(c.id)!
    const folgasSemana = 7 - c.dias_trabalho
    let consecutivos = lookback.get(c.id)!.diasConsec
    const weeks = getWeeks(dias, corteSemanal)

    // Colabs sem domingo: marcar DOM como FOLGA imediatamente (exceto pinned — validacao flagga depois)
    if (!c.trabalha_domingo) {
      for (const d of dias) {
        if (isDomingo(d) && mapa.get(d)!.status !== 'INDISPONIVEL' && !isPinned(c.id, d)) {
          mapa.get(d)!.status = 'FOLGA'
        }
      }
    }

    for (const week of weeks) {
      // Dias disponiveis pra FASE 3 = nao-INDISPONIVEL, nao-domingo, e NAO pinned (pinned = immovable)
      const weekDays = c.trabalha_domingo
        ? week.filter(d => !isDomingo(d) && mapa.get(d)!.status !== 'INDISPONIVEL' && !isPinned(c.id, d))
        : week.filter(d => !isDomingo(d) && mapa.get(d)!.status !== 'INDISPONIVEL' && mapa.get(d)!.status !== 'FOLGA' && !isPinned(c.id, d))

      // Folgas ja garantidas (INDISPONIVEL + domingos-folga + pinned FOLGA)
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
      const staggerPenalty = Math.max(20, 300 / colaboradores.length)
      const scored = weekDays.map(d => {
        const ds = diaSemana(d)
        let score = 0
        if (c.evitar_dia_semana && ds === c.evitar_dia_semana) score += 100
        score -= demandaTotalDia(demandas, ds) // menor demanda = melhor pra folga
        // Stagger: penalizar dias onde muitos colabs ja folgam (relativo ao tamanho do setor)
        score -= (folgasPorDia.get(d) || 0) * staggerPenalty
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

      // Se violou, redistribuir com safety — preferir scored (evitar_dia_semana) ao escolher onde quebrar
      if (violou) {
        folgaSet.clear()
        tempConsec = consecutivos
        const diasParaFolga: string[] = []
        for (const d of week) {
          const cel = mapa.get(d)!
          if (cel.status === 'INDISPONIVEL' || cel.status === 'FOLGA') {
            tempConsec = 0; continue
          }
          tempConsec++
          if (tempConsec > CLT.MAX_DIAS_CONSECUTIVOS && weekDays.includes(d)) {
            diasParaFolga.push(d)
            tempConsec = 0
          }
        }
        // Ordenar por score (melhor pra folga primeiro) e atribuir ate folgasNecessarias
        const diasOrdenados = diasParaFolga
          .map(d => ({ date: d, score: scored.find(s => s.date === d)?.score ?? -Infinity }))
          .sort((a, b) => b.score - a.score)
        for (let i = 0; i < Math.min(folgasNecessarias, diasOrdenados.length); i++) {
          folgaSet.add(diasOrdenados[i].date)
        }
        // Preencher se faltou
        for (const s of scored) {
          if (folgaSet.size >= folgasNecessarias) break
          if (!folgaSet.has(s.date)) folgaSet.add(s.date)
        }
      }

      // Aplicar folgas + atualizar stagger counter
      for (const d of folgaSet) {
        mapa.get(d)!.status = 'FOLGA'
        folgasPorDia.set(d, (folgasPorDia.get(d) || 0) + 1)
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
      // Sem demanda no domingo — todos folgam (exceto pinned)
      for (const c of colabsDomingo) {
        if (isPinned(c.id, domingo)) continue
        const cel = resultado.get(c.id)!.get(domingo)!
        if (cel.status !== 'INDISPONIVEL') {
          cel.status = 'FOLGA'
          domConsecState.set(c.id, 0)
        }
      }
      continue
    }

    // Disponiveis: nao INDISPONIVEL, nao pinned, e dentro do limite de domingos consecutivos
    const disponiveis = colabsDomingo.filter(c => {
      if (isPinned(c.id, domingo)) return false
      const cel = resultado.get(c.id)!.get(domingo)!
      if (cel.status === 'INDISPONIVEL') return false
      const max = CLT.MAX_DOMINGOS_CONSECUTIVOS[c.sexo]
      return domConsecState.get(c.id)! < max
    })

    const toSchedule = Math.min(maxNeeded, disponiveis.length)
    const scheduled = new Set<number>()
    let scheduledM = 0
    let scheduledF = 0

    for (let i = 0; i < toSchedule; i++) {
      const remaining = disponiveis.filter(c => !scheduled.has(c.id))
      remaining.sort((a, b) => {
        const diff = domTotalState.get(a.id)! - domTotalState.get(b.id)!
        if (diff !== 0) return diff
        // Empatados: preferir sexo sub-representado (equilibrio M/F)
        const aPref = (a.sexo === 'F' && scheduledF <= scheduledM) || (a.sexo === 'M' && scheduledM <= scheduledF) ? 1 : 0
        const bPref = (b.sexo === 'F' && scheduledF <= scheduledM) || (b.sexo === 'M' && scheduledM <= scheduledF) ? 1 : 0
        if (aPref !== bPref) return bPref - aPref
        return b.rank - a.rank
      })
      const c = remaining[0]
      scheduled.add(c.id)
      if (c.sexo === 'M') scheduledM++; else scheduledF++
      resultado.get(c.id)!.get(domingo)!.status = 'TRABALHO'
      domConsecState.set(c.id, domConsecState.get(c.id)! + 1)
      domTotalState.set(c.id, domTotalState.get(c.id)! + 1)
    }

    // Nao-escalados → FOLGA no domingo, reset consecutivo (exceto pinned)
    for (const c of colabsDomingo) {
      if (isPinned(c.id, domingo)) {
        const cel = resultado.get(c.id)!.get(domingo)!
        if (cel.status === 'TRABALHO') {
          domConsecState.set(c.id, domConsecState.get(c.id)! + 1)
          domTotalState.set(c.id, domTotalState.get(c.id)! + 1)
        } else {
          domConsecState.set(c.id, 0)
        }
        continue
      }
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
  // Quando forcar FOLGA, preferir o dia que honra evitar_dia_semana ou tem menor demanda.

  for (const c of colaboradores) {
    const mapa = resultado.get(c.id)!
    let consec = lookback.get(c.id)!.diasConsec

    for (let dIdx = 0; dIdx < dias.length; dIdx++) {
      const d = dias[dIdx]
      const cel = mapa.get(d)!
      if (cel.status === 'TRABALHO') {
        consec++
        if (!isPinned(c.id, d) && consec > CLT.MAX_DIAS_CONSECUTIVOS) {
          const streakStart = Math.max(0, dIdx - 6)
          const streakDays = dias.slice(streakStart, dIdx + 1)
          const scored = streakDays.map(date => {
            const ds = diaSemana(date)
            let score = 0
            if (c.evitar_dia_semana && ds === c.evitar_dia_semana) score += 100
            score -= demandaTotalDia(demandas, ds)
            return { date, score }
          })
          // Filtrar pinned cells — nao podem ser forcadas a FOLGA pelo repair
          const unpinned = scored.filter(s => !isPinned(c.id, s.date))
          if (unpinned.length === 0) {
            // Todos os dias do streak sao pinned — skip repair.
            // FASE 6 validacao vai flaggar a violacao R1 (gestora decidiu, ela assume).
            continue
          }
          unpinned.sort((a, b) => b.score - a.score)
          const bestDay = unpinned[0].date
          const bestCel = mapa.get(bestDay)!
          bestCel.status = 'FOLGA'
          bestCel.hora_inicio = null
          bestCel.hora_fim = null
          bestCel.minutos = null
          const bestIdx = dias.indexOf(bestDay)
          consec = dIdx - bestIdx
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
      const cel = resultado.get(c.id)!.get(d)!
      // Pinned TRABALHO com horas ja definidas — nao sobrescrever; so contar cobertura
      if (isPinned(c.id, d) && cel.hora_inicio && cel.hora_fim) {
        for (const faixa of faixas) {
          const fIni = timeToMin(faixa.hora_inicio)
          const fFim = timeToMin(faixa.hora_fim)
          const celIni = timeToMin(cel.hora_inicio)
          const celFim = timeToMin(cel.hora_fim)
          if (celIni < fFim && celFim > fIni) {
            const key = `${d}|${faixa.id}`
            bandaCount.set(key, (bandaCount.get(key) || 0) + 1)
          }
        }
        cel.minutos = timeToMin(cel.hora_fim) - timeToMin(cel.hora_inicio)
        continue
      }

      const metaDiariaMin = calcMetaDiariaMin(c.horas_semanais, c.dias_trabalho)
      const duracao = Math.min(metaDiariaMin, c.max_minutos_dia)

      // R2 safety: descanso inter-jornada minimo vs dia anterior
      let minIniDescanso = setorIniMin
      const dIdx = dias.indexOf(d)
      if (dIdx > 0) {
        const ontem = dias[dIdx - 1]
        const celOntem = resultado.get(c.id)!.get(ontem)!
        if (celOntem.status === 'TRABALHO' && celOntem.hora_fim) {
          const fimOntemMin = timeToMin(celOntem.hora_fim)
          // descanso necessario = 660min (11h). Inicio hoje >= fimOntem + 660 - 1440
          const minInicio = fimOntemMin + CLT.MIN_DESCANSO_ENTRE_JORNADAS_MIN - 1440
          if (minInicio > minIniDescanso) {
            minIniDescanso = minInicio
          }
        }
      }

      if (faixas.length === 0) {
        const ini = Math.max(setorIniMin, minIniDescanso)
        const fim = Math.min(ini + duracao, setorFimMin)
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

      let bestIni = Math.max(setorIniMin, minIniDescanso)
      let bestFim = Math.min(bestIni + duracao, setorFimMin)
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

        // Clamp ao descanso inter-jornada R2
        if (ini < minIniDescanso) {
          ini = minIniDescanso
          fim = Math.min(ini + duracao, setorFimMin)
        }

        // Pontuar: MAX deficit proporcional entre faixas cobertas
        // Usar MAX (nao SUM) evita que cobrir 2 bandas tenha vantagem desproporcional
        // sobre a preferencia de turno do colaborador
        let maxDeficitPct = 0
        let coversMultiple = 0
        let sumDeficit = 0
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
              sumDeficit += deficit
            }
          }
        }
        // Score: max deficit + bonus por multiplas bandas + tie-break por soma de deficit
        let score = maxDeficitPct + (coversMultiple > 1 ? 15 : 0) + sumDeficit * 0.01

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
  // FASE 6 + 7 — VALIDACAO (R1-R8) + SCORING (via modulo compartilhado)
  // ═══════════════════════════════════════════════════════════════════════════

  const TOLERANCIA_MIN = tolerancia_min ?? 30
  const resultadoValidacao = resultado as Map<number, Map<string, CelulaValidacao>>
  const violacoes = validarRegras(colaboradores, resultadoValidacao, demandas, dias, lookback, TOLERANCIA_MIN, corteSemanal)
  const indicadores = calcularIndicadores(colaboradores, resultadoValidacao, demandas, dias, violacoes)

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
    pontuacao: indicadores.pontuacao,
    cobertura_percent: indicadores.cobertura_percent,
    violacoes_hard: indicadores.violacoes_hard,
    violacoes_soft: indicadores.violacoes_soft,
    equilibrio: indicadores.equilibrio,
  }
}
