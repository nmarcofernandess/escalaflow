// ============================================================================
// SimulaEscala — Gerador de ciclos T/F em TypeScript puro
// Sem dependencias, sem banco, sem Python. Sub-segundo.
// ============================================================================

export type DiaStatus = 'T' | 'F'

/** Input minimo para fase 1: N pessoas, K no domingo, periodo a exibir */
export interface SimulaCicloFase1Input {
  num_postos: number
  trabalham_domingo: number
  num_meses?: number              // default: 3 — semanas = ~4.33 * num_meses (calendário)
  preflight?: boolean             // default: true — sem TT, H1 <= 6
  /** F/V forcadas por posto (indice 0..N-1). null em cada campo = auto decide. */
  folgas_forcadas?: Array<{
    folga_fixa_dia: number | null    // 0-5 (SEG-SAB) ou null
    folga_variavel_dia: number | null
    /** Se true, pessoa tem folga fixa no domingo — todos domingos F, fora da rotacao */
    folga_fixa_dom?: boolean
  }>
  /** Demanda por dia da semana [SEG, TER, QUA, QUI, SEX, SAB, DOM]. Se fornecido, folgas sao distribuidas nos dias com mais sobra de cobertura. */
  demanda_por_dia?: number[]
}

export interface SimulaCicloSemana {
  dias: DiaStatus[]               // 7 valores: SEG a DOM
  trabalhou_domingo: boolean
  dias_trabalhados: number
  consecutivos_max: number
}

/** Índice 0-5 = SEG-SAB (folga fixa/variável são sempre dia de semana) */
export interface SimulaCicloRow {
  posto: string
  semanas: SimulaCicloSemana[]
  /** Dia da folga fixa (0=SEG .. 5=SAB) */
  folga_fixa_dia: number
  /** Dia da folga variável (0=SEG .. 5=SAB), ou null se só houver uma folga semanal */
  folga_variavel_dia: number | null
}

export interface CoberturaRow {
  semana: number
  cobertura: number[]             // 7 valores: quantos trabalham SEG a DOM
}

export interface SimulaCicloStats {
  folgas_por_pessoa_semana: number
  cobertura_min: number
  cobertura_max: number
  h1_violacoes: number
  domingos_consecutivos_max: number
  sem_TT?: boolean
  sem_H1_violation?: boolean
}

export interface FolgaWarning {
  pessoa: number         // indice no grid (0..N-1)
  dia: number            // 0-5 (SEG-SAB)
  tipo: 'FF_CONFLITO' | 'FV_CONFLITO'
  coberturaRestante: number
  demandaDia: number
}

export interface SimulaCicloOutput {
  sucesso: boolean
  erro?: string
  sugestao?: string
  grid: SimulaCicloRow[]
  cobertura_dia: CoberturaRow[]
  ciclo_semanas: number
  stats: SimulaCicloStats
  folga_warnings?: FolgaWarning[]
}

// gcd exported for heuristica K
export function gcd(a: number, b: number): number {
  a = Math.abs(a)
  b = Math.abs(b)
  while (b) { [a, b] = [b, a % b] }
  return a
}

/** Heuristica: K sugerido para N pessoas (40% alvo, ciclo H <= 7, sem TT) */
export function sugerirK(N: number, maxCiclo = 7): number {
  if (N < 1) return 0
  const kMax = Math.floor(N / 2) // sem TT
  const alvo = Math.round(N * 0.4)
  let melhor = Math.min(alvo, kMax)
  let melhorH = N + 1
  for (let k = 1; k <= kMax; k++) {
    const H = N / gcd(N, k)
    if (H <= maxCiclo && H <= melhorH) {
      const dist = Math.abs(k - alvo)
      const distMelhor = Math.abs(melhor - alvo)
      if (H < melhorH || (H === melhorH && dist <= distMelhor)) {
        melhor = k
        melhorH = H
      }
    }
  }
  if (kMax === 0) return 0
  return melhor > 0 ? melhor : 1
}

/** Build base sunday pattern: d domingos em H semanas, sem TT.
 * Cada pessoa segue o mesmo padrão tipo T F F T F (2 trab em 5 = pos 0 e 3).
 * step = ceil(H/d) garante espaçamento sem dois T seguidos. */
function buildBasePatternDomingos(d: number, H: number): DiaStatus[] {
  const pattern: DiaStatus[] = Array(H).fill('F')
  if (d <= 0) return pattern
  if (d >= H) return pattern.map(() => 'T' as DiaStatus)
  if (d === 1) {
    pattern[0] = 'T'
    return pattern
  }
  // step >= 2 evita TT; step <= (H-1)/(d-1) cabe d T's
  const step = Math.max(2, Math.min(Math.ceil(H / d), Math.floor((H - 1) / (d - 1))))
  for (let i = 0; i < d; i++) {
    const pos = i * step
    if (pos < H) pattern[pos] = 'T'
  }
  return pattern
}

/** Rotate array left by shift */
function rotate<T>(arr: T[], shift: number): T[] {
  const n = arr.length
  if (n === 0) return arr
  const s = ((shift % n) + n) % n
  return [...arr.slice(s), ...arr.slice(0, s)]
}

/** Max consecutive 'T' in a flat array, wrapping around for cycle */
function maxConsecutivosCiclo(flat: DiaStatus[], wrap: boolean): number {
  if (flat.length === 0) return 0
  let max = 0
  let cur = 0
  for (const d of flat) {
    if (d === 'T') { cur++; max = Math.max(max, cur) }
    else cur = 0
  }
  if (wrap && flat[0] === 'T' && flat[flat.length - 1] === 'T') {
    // Count wrap-around
    let tail = 0
    for (let i = flat.length - 1; i >= 0 && flat[i] === 'T'; i--) tail++
    let head = 0
    for (let i = 0; i < flat.length && flat[i] === 'T'; i++) head++
    max = Math.max(max, tail + head)
  }
  return max
}

/** Max consecutive T in sundays only (for TT check) */
function maxDomingosConsecutivos(grid: DiaStatus[][], N: number, weeks: number): number {
  let globalMax = 0
  for (let p = 0; p < N; p++) {
    let consec = 0
    for (let w = 0; w < weeks; w++) {
      if (grid[p][w * 7 + 6] === 'T') {
        consec++
        globalMax = Math.max(globalMax, consec)
      } else {
        consec = 0
      }
    }
  }
  return globalMax
}

/** Max consecutive work days (H1) for a person */
function maxConsecutivosPessoa(flat: DiaStatus[]): number {
  let max = 0, cur = 0
  for (const d of flat) {
    if (d === 'T') { cur++; max = Math.max(max, cur) }
    else cur = 0
  }
  return max
}

/** Gerador fase 1: N pessoas, K no domingo, 5x2, sem TT quando preflight ON */
export function gerarCicloFase1(input: SimulaCicloFase1Input): SimulaCicloOutput {
  const N = input.num_postos
  const K = input.trabalham_domingo
  const SEMANAS_POR_MES = 4.33
  const numMeses = input.num_meses ?? 3
  const preflight = input.preflight ?? true

  const emptyOutput = (erro: string, sugestao?: string): SimulaCicloOutput => ({
    sucesso: false,
    erro,
    sugestao,
    grid: [],
    cobertura_dia: [],
    ciclo_semanas: 0,
    stats: {
      folgas_por_pessoa_semana: 0,
      cobertura_min: 0,
      cobertura_max: 0,
      h1_violacoes: 0,
      domingos_consecutivos_max: 0,
      sem_TT: false,
      sem_H1_violation: false,
    },
  })

  if (N < 1) return emptyOutput('Precisa de pelo menos 1 pessoa.')
  if (K > N) return emptyOutput(`Impossivel: ${K} no domingo > ${N} pessoas.`, `Reduza K para no maximo ${N}.`)
  if (K < 0) return emptyOutput('K nao pode ser negativo.')

  const kMaxSemTT = Math.floor(N / 2)
  if (preflight && K > kMaxSemTT) {
    return emptyOutput(
      `Com preflight: impossivel evitar 2 domingos seguidos (TT). K maximo = ${kMaxSemTT}.`,
      `Reduza K para ${kMaxSemTT} ou desative o preflight.`,
    )
  }

  const cicloSemanas = K > 0 ? N / gcd(N, K) : 1
  const weeks = Math.max(1, Math.round(SEMANAS_POR_MES * numMeses))
  const totalDias = weeks * 7

  const nomes = Array.from({ length: N }, (_, i) => `Pessoa ${i + 1}`)

  const grid: DiaStatus[][] = Array.from({ length: N }, () => Array(totalDias).fill('T') as DiaStatus[])

  // --- Step 1: Domingos com padrao sem TT (quando preflight) ou round-robin (quando off) ---
  if (K > 0) {
    if (preflight) {
      const dPerPerson = (K * cicloSemanas) / N // sempre inteiro: K*gcd(N,K)/gcd(N,K)=K
      const H = Math.round(cicloSemanas)
      const basePattern = buildBasePatternDomingos(dPerPerson, H)
      for (let p = 0; p < N; p++) {
        const rotated = rotate(basePattern, p % H)
        for (let w = 0; w < weeks; w++) {
          const weekInCycle = w % H
          grid[p][w * 7 + 6] = rotated[weekInCycle]
        }
      }
    } else {
      const offsPerSunday = N - K
      let sundayPointer = 0
      for (let w = 0; w < weeks; w++) {
        const sundayIdx = w * 7 + 6
        for (let i = 0; i < offsPerSunday; i++) {
          const p = (sundayPointer + i) % N
          grid[p][sundayIdx] = 'F'
        }
        sundayPointer = (sundayPointer + offsPerSunday) % N
      }
    }
  } else {
    for (let w = 0; w < weeks; w++) {
      for (let p = 0; p < N; p++) grid[p][w * 7 + 6] = 'F'
    }
  }

  // --- Step 1 postprocess: folga_fixa_dom overrides — all Sundays F ---
  for (let p = 0; p < N; p++) {
    if (input.folgas_forcadas?.[p]?.folga_fixa_dom) {
      for (let w = 0; w < weeks; w++) {
        grid[p][w * 7 + 6] = 'F'
      }
    }
  }

  // --- Warnings acumulados durante toda a geracao ---
  const folgaWarnings: FolgaWarning[] = []

  // --- Step 1b: Pre-check folgas fixas vs capacidade por dia (nao mata o grid, gera warning) ---
  const DIA_LABELS_LOCAL: string[] = ['SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB']
  if (input.folgas_forcadas && input.demanda_por_dia && input.demanda_por_dia.length >= 6) {
    const forcedFolgasByDay = [0, 0, 0, 0, 0, 0]
    for (const f of input.folgas_forcadas) {
      if (f.folga_fixa_dia != null && f.folga_fixa_dia >= 0 && f.folga_fixa_dia < 6) {
        forcedFolgasByDay[f.folga_fixa_dia]++
      }
    }
    for (let d = 0; d < 6; d++) {
      const maxFolgas = N - (input.demanda_por_dia[d] ?? 0)
      if (forcedFolgasByDay[d] > maxFolgas) {
        // Não mata o grid — registra warning e deixa continuar com déficit visível
        folgaWarnings.push({
          pessoa: -1, // sentinela: afeta o dia todo, não uma pessoa específica
          dia: d,
          tipo: 'FF_CONFLITO',
          coberturaRestante: N - forcedFolgasByDay[d],
          demandaDia: input.demanda_por_dia[d] ?? 0,
        })
      }
    }
  }

  // --- Step 2: Folgas semanais 5x2 (2 por semana) ---
  const hasDemanda = input.demanda_por_dia && input.demanda_por_dia.length >= 6

  // Track folgas assigned per weekday (for demand-aware spreading)
  const folgaCount = [0, 0, 0, 0, 0, 0] // SEG-SAB

  // Pick best folga day considering demand surplus AND already-assigned folgas
  const pickBestFolgaDay = (demanda: number[], exclude: number | null): number => {
    let bestDay = 0
    let bestScore = -Infinity
    for (let d = 0; d < 6; d++) {
      if (d === exclude) continue
      const score = (N - (demanda[d] ?? 0)) - folgaCount[d]
      if (score > bestScore) {
        bestScore = score
        bestDay = d
      }
    }
    return bestDay
  }

  for (let p = 0; p < N; p++) {
    const forcada = input.folgas_forcadas?.[p]
    const isFixaDom = forcada?.folga_fixa_dom === true

    const base1 = forcada?.folga_fixa_dia
      ?? (hasDemanda ? pickBestFolgaDay(input.demanda_por_dia!, null) : (p % 6))
    folgaCount[base1]++

    // Detect FF assignment causing deficit
    if (hasDemanda) {
      const cobRestante = N - folgaCount[base1]
      const demDia = input.demanda_por_dia![base1] ?? 0
      if (cobRestante < demDia) {
        folgaWarnings.push({ pessoa: p, dia: base1, tipo: 'FF_CONFLITO', coberturaRestante: cobRestante, demandaDia: demDia })
      }
    }

    // folga_fixa_dom: variable loses meaning, use a second fixed weekday
    const base2 = isFixaDom ? null
      : (forcada?.folga_variavel_dia
        ?? (hasDemanda ? pickBestFolgaDay(input.demanda_por_dia!, base1) : ((p + 3) % 6)))
    if (base2 != null) {
      folgaCount[base2]++

      // Detect FV assignment causing deficit
      if (hasDemanda) {
        const cobRestante = N - folgaCount[base2]
        const demDia = input.demanda_por_dia![base2] ?? 0
        if (cobRestante < demDia) {
          folgaWarnings.push({ pessoa: p, dia: base2, tipo: 'FV_CONFLITO', coberturaRestante: cobRestante, demandaDia: demDia })
        }
      }
    }

    for (let w = 0; w < weeks; w++) {
      const sundayOff = grid[p][w * 7 + 6] === 'F'
      if (sundayOff) {
        // Não trabalhou DOM → folga no dia fixo (DOM já é folga = 2 folgas)
        grid[p][w * 7 + base1] = 'F'
      } else {
        // Trabalhou DOM → folga no dia fixo + variável (mesma semana)
        grid[p][w * 7 + base1] = 'F'
        if (base2 != null) grid[p][w * 7 + base2] = 'F'
      }
    }
  }

  // --- Step 3: H1 repair (max 6 consecutivos) ---
  const maxConsec = 6
  let h1Violations = 0
  for (let p = 0; p < N; p++) {
    let consec = 0
    for (let d = 0; d < totalDias; d++) {
      if (grid[p][d] === 'T') {
        consec++
        if (consec > maxConsec) {
          h1Violations++
          grid[p][d] = 'F'
          consec = 0
        }
      } else {
        consec = 0
      }
    }
  }

  const maxDomConsec = maxDomingosConsecutivos(grid, N, weeks)
  const semTT = maxDomConsec <= 1
  const semH1 = h1Violations === 0

  // --- Build output ---
  const rows: SimulaCicloRow[] = []
  const cobertura: CoberturaRow[] = []
  let cobMin = N
  let cobMax = 0
  let totalFolgas = 0

  for (let w = 0; w < weeks; w++) {
    const cob = Array(7).fill(0) as number[]
    for (let d = 0; d < 7; d++) {
      for (let p = 0; p < N; p++) {
        if (grid[p][w * 7 + d] === 'T') cob[d]++
      }
      cobMin = Math.min(cobMin, cob[d])
      cobMax = Math.max(cobMax, cob[d])
    }
    cobertura.push({ semana: w + 1, cobertura: cob })
  }

  for (let p = 0; p < N; p++) {
    const semanas: SimulaCicloSemana[] = []
    const folgaCountByWeekday = [0, 0, 0, 0, 0, 0] // SEG-SAB
    for (let w = 0; w < weeks; w++) {
      const dias = grid[p].slice(w * 7, w * 7 + 7) as DiaStatus[]
      for (let d = 0; d < 6; d++) {
        if (dias[d] === 'F') folgaCountByWeekday[d]++
      }
      const trabDom = dias[6] === 'T'
      const trabCount = dias.filter(d => d === 'T').length
      totalFolgas += 7 - trabCount
      const startIdx = Math.max(0, w * 7 - maxConsec)
      const endIdx = Math.min(totalDias, (w + 1) * 7 + maxConsec)
      const consMax = maxConsecutivosPessoa(grid[p].slice(startIdx, endIdx))
      semanas.push({
        dias,
        trabalhou_domingo: trabDom,
        dias_trabalhados: trabCount,
        consecutivos_max: consMax,
      })
    }
    const forcadaOut = input.folgas_forcadas?.[p]
    const sorted = folgaCountByWeekday
      .map((count, dia) => ({ dia, count }))
      .filter(x => x.count > 0)
      .sort((a, b) => b.count - a.count)
    const folga_fixa_dia = forcadaOut?.folga_fixa_dia ?? sorted[0]?.dia ?? 0
    const folga_variavel_dia = forcadaOut?.folga_variavel_dia ?? sorted[1]?.dia ?? null
    rows.push({ posto: nomes[p], semanas, folga_fixa_dia, folga_variavel_dia })
  }

  const folgasMedia = totalFolgas / (N * weeks)

  return {
    sucesso: true,
    grid: rows,
    cobertura_dia: cobertura,
    ciclo_semanas: cicloSemanas,
    stats: {
      folgas_por_pessoa_semana: Math.round(folgasMedia * 10) / 10,
      cobertura_min: cobMin,
      cobertura_max: cobMax,
      h1_violacoes: h1Violations,
      domingos_consecutivos_max: maxDomConsec,
      sem_TT: semTT,
      sem_H1_violation: semH1,
    },
    folga_warnings: folgaWarnings.length > 0 ? folgaWarnings : undefined,
  }
}

// ============================================================================
// Sugerir TS hierarquico — step-by-step de baixo pra cima
// ============================================================================

export interface SugerirTSResult {
  resultado: SimulaCicloOutput
  /** Quantas pessoas foram liberadas (0 = sem mudanca, N = tudo livre) */
  liberados: number
}

/**
 * Tenta resolver deficits liberando folgas progressivamente de baixo pra cima.
 * Indice 0 = rank mais alto (preserva). Indice N-1 = rank mais baixo (libera primeiro).
 * Retorna o PRIMEIRO resultado sem deficit de cobertura.
 */
export function sugerirTSHierarquico(input: {
  folgas: Array<{
    folga_fixa_dia: number | null
    folga_variavel_dia: number | null
    folga_fixa_dom?: boolean
  }>
  num_postos: number
  trabalham_domingo: number
  num_meses?: number
  demanda_por_dia?: number[]
}): SugerirTSResult {
  const N = input.num_postos

  for (let step = 0; step <= N; step++) {
    const folgas = input.folgas.map((f, idx) => {
      if (step > 0 && idx >= N - step) {
        return {
          folga_fixa_dia: null as number | null,
          folga_variavel_dia: null as number | null,
          folga_fixa_dom: f.folga_fixa_dom,
        }
      }
      return { ...f }
    })

    const result = gerarCicloFase1({
      num_postos: N,
      trabalham_domingo: input.trabalham_domingo,
      num_meses: input.num_meses,
      folgas_forcadas: folgas,
      demanda_por_dia: input.demanda_por_dia,
    })

    if (!result.sucesso) continue

    const hasDeficit = result.cobertura_dia.some((sem) =>
      sem.cobertura.some((cob, idx) => cob < (input.demanda_por_dia?.[idx] ?? 0)),
    )

    if (!hasDeficit) {
      return { resultado: result, liberados: step }
    }
  }

  // Nenhuma tentativa resolveu — retorna tudo livre (preservando folga_fixa_dom)
  const fallbackFolgas = input.folgas.map((f) => ({
    folga_fixa_dia: null as number | null,
    folga_variavel_dia: null as number | null,
    folga_fixa_dom: f.folga_fixa_dom,
  }))
  const fallbackResult = gerarCicloFase1({
    num_postos: N,
    trabalham_domingo: input.trabalham_domingo,
    num_meses: input.num_meses,
    folgas_forcadas: fallbackFolgas,
    demanda_por_dia: input.demanda_por_dia,
  })

  return { resultado: fallbackResult, liberados: N }
}

// ============================================================================
// Conversor Nivel 1 → formato EscalaCicloResumo
// ============================================================================

import type { Escala, Alocacao, Colaborador, Funcao, DiaSemana, RegraHorarioColaborador } from './index'

const DIAS_IDX_TO_DIASEMANA: DiaSemana[] = ['SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB', 'DOM']

export function converterNivel1ParaEscala(
  output: SimulaCicloOutput,
  postosElegiveis: Array<{ funcao: Funcao; titular: Colaborador }>,
  setorId: number,
  periodo: { data_inicio: string; data_fim: string },
): { escala: Escala; alocacoes: Alocacao[]; regras: RegraHorarioColaborador[] } {
  const escala: Escala = {
    id: -1,
    setor_id: setorId,
    data_inicio: periodo.data_inicio,
    data_fim: periodo.data_fim,
    status: 'RASCUNHO',
    pontuacao: null,
    criada_em: new Date().toISOString(),
  }

  const alocacoes: Alocacao[] = []
  const regras: RegraHorarioColaborador[] = []
  let fakeAlocId = -1

  const start = new Date(`${periodo.data_inicio}T00:00:00`)
  const end = new Date(`${periodo.data_fim}T00:00:00`)

  for (let rowIdx = 0; rowIdx < output.grid.length; rowIdx++) {
    const row = output.grid[rowIdx]
    const postoInfo = postosElegiveis[rowIdx]
    if (!postoInfo) continue

    const colabId = postoInfo.titular.id

    // Alocacoes: 1 por dia
    const cursor = new Date(start)
    let weekIdx = 0
    let dayIdx = 0
    while (cursor <= end) {
      const isoDate = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`
      const semana = row.semanas[weekIdx]
      if (semana && dayIdx < semana.dias.length) {
        alocacoes.push({
          id: fakeAlocId--,
          escala_id: -1,
          colaborador_id: colabId,
          data: isoDate,
          status: semana.dias[dayIdx] === 'T' ? 'TRABALHO' : 'FOLGA',
          hora_inicio: null,
          hora_fim: null,
          minutos: null,
        })
      }
      dayIdx++
      if (dayIdx >= 7) { dayIdx = 0; weekIdx++ }
      cursor.setDate(cursor.getDate() + 1)
    }

    // Regra com F/V
    regras.push({
      id: -colabId,
      colaborador_id: colabId,
      dia_semana_regra: null,
      ativo: true,
      perfil_horario_id: null,
      inicio: null,
      fim: null,
      preferencia_turno_soft: null,
      folga_fixa_dia_semana: DIAS_IDX_TO_DIASEMANA[row.folga_fixa_dia] ?? null,
      folga_variavel_dia_semana: row.folga_variavel_dia != null
        ? DIAS_IDX_TO_DIASEMANA[row.folga_variavel_dia] ?? null
        : null,
    })
  }

  return { escala, alocacoes, regras }
}

// ============================================================================
// Conversor Preview T/F → pinned_folga_externo do solver
// ============================================================================

/**
 * Converte preview T/F para formato pinned_folga_externo do solver.
 * TS nao sabe de bandas (manha/tarde) — usa band=3 (INTEGRAL) para T e band=0 (OFF) para F.
 * O solver Phase 2 decide a banda real baseado na demanda.
 */
export function converterPreviewParaPinned(
  output: SimulaCicloOutput,
  postosElegiveis: Array<{ funcao: { id: number }; titular: { id: number } }>,
): Array<{ c: number; d: number; band: number }> {
  const pinned: Array<{ c: number; d: number; band: number }> = []

  for (let rowIdx = 0; rowIdx < output.grid.length; rowIdx++) {
    const row = output.grid[rowIdx]
    if (!postosElegiveis[rowIdx]) continue

    // c = index in the collaborator array (same order as postosElegiveis → solver input)
    const c = rowIdx
    let dayCounter = 0

    for (const semana of row.semanas) {
      for (const status of semana.dias) {
        pinned.push({
          c,
          d: dayCounter,
          band: status === 'T' ? 3 : 0, // 3=INTEGRAL, 0=OFF (TS nao sabe de bandas)
        })
        dayCounter++
      }
    }
  }

  return pinned
}
