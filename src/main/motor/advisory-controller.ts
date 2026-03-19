/**
 * advisory-controller.ts — Solver-backed advisory: validacao + proposta de ciclo.
 *
 * Pipeline (3 fases, todas advisory_only=true = solve_folga_pattern):
 *   Fase A: solver COM pins → valida arranjo atual
 *   Fase B: solver SEM pins, COM folga_fixa/variavel → propoe respeitando preferencias
 *   Fase C: solver SEM pins, SEM folga_fixa/variavel → propoe mudando tudo (destrutivo)
 *
 * Output contem APENAS solver diagnostics. TS diagnostics ficam na AvisosSection.
 * Ciclo e abstrato: feriados e excecoes sao stripados.
 */

import { createHash } from 'node:crypto'
import type {
  AdvisoryStatus,
  AdvisoryDiffItem,
  EscalaAdvisoryInput,
  EscalaAdvisoryOutput,
  SemanaDraftAdvisory,
} from '../../shared/advisory-types'
import type { PreviewDiagnostic } from '../../shared/preview-diagnostics'
import type { SolverInput, DiaSemana, SolverInputDemanda } from '../../shared'
import { buildSolverInput, runSolver, type BuildSolverInputOptions } from './solver-bridge'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DIAS_SEMANA: DiaSemana[] = ['SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB', 'DOM']

const ADVISORY_TIMEOUT_MS = 30_000

// ---------------------------------------------------------------------------
// 1. extractFolgaFromPattern
// ---------------------------------------------------------------------------

/**
 * Converts Phase 1 pattern output (array of {c, d, band} where band=0 is OFF)
 * into fixa/variavel per collaborator.
 *
 * Usa top-2 weekday (excluindo DOM) por frequencia:
 * - 1o mais frequente → fixa
 * - 2o mais frequente → variavel
 */
export function extractFolgaFromPattern(
  pattern: Array<{ c: number; d: number; band: number }>,
  days: string[],
  numColabs: number,
): Array<{ c: number; fixa: DiaSemana | null; variavel: DiaSemana | null }> {
  const totalWeeks = Math.ceil(days.length / 7)
  if (totalWeeks === 0) {
    return Array.from({ length: numColabs }, (_, c) => ({ c, fixa: null, variavel: null }))
  }

  const offsByColab = new Map<number, Map<DiaSemana, number>>()
  for (const { c, d, band } of pattern) {
    if (band !== 0) continue
    if (d < 0 || d >= days.length) continue

    const date = new Date(days[d]! + 'T00:00:00')
    const dowIdx = (date.getDay() + 6) % 7
    const diaSemana = DIAS_SEMANA[dowIdx]!

    let dayMap = offsByColab.get(c)
    if (!dayMap) {
      dayMap = new Map<DiaSemana, number>()
      offsByColab.set(c, dayMap)
    }
    dayMap.set(diaSemana, (dayMap.get(diaSemana) ?? 0) + 1)
  }

  const result: Array<{ c: number; fixa: DiaSemana | null; variavel: DiaSemana | null }> = []

  for (let c = 0; c < numColabs; c++) {
    const dayMap = offsByColab.get(c)
    let fixa: DiaSemana | null = null
    let variavel: DiaSemana | null = null

    if (dayMap) {
      // Top-2 weekday (excl DOM) off days by frequency → fixa (1st) + variavel (2nd)
      const weekdayEntries = [...dayMap.entries()]
        .filter(([dia]) => dia !== 'DOM')
        .sort((a, b) => b[1] - a[1])

      if (weekdayEntries.length >= 1 && weekdayEntries[0]![1] > 0) {
        fixa = weekdayEntries[0]![0]
      }
      if (weekdayEntries.length >= 2 && weekdayEntries[1]![1] > 0) {
        variavel = weekdayEntries[1]![0]
      }
    }

    result.push({ c, fixa, variavel })
  }

  return result
}

// ---------------------------------------------------------------------------
// 2. convertSemanaDraftToDemanda
// ---------------------------------------------------------------------------

export function convertSemanaDraftToDemanda(
  draft: SemanaDraftAdvisory,
  _empresa?: { hora_abertura?: string; hora_fechamento?: string },
): SolverInputDemanda[] {
  const demanda: SolverInputDemanda[] = []

  for (const dia of DIAS_SEMANA) {
    const diaConfig = draft.dias[dia]
    if (!diaConfig || !diaConfig.ativo) continue

    const segmentos = diaConfig.usa_padrao ? draft.padrao.segmentos : diaConfig.segmentos

    for (const seg of segmentos) {
      demanda.push({
        dia_semana: dia,
        hora_inicio: seg.hora_inicio,
        hora_fim: seg.hora_fim,
        min_pessoas: seg.min_pessoas,
        override: seg.override,
      })
    }
  }

  return demanda
}

// ---------------------------------------------------------------------------
// 3. computeAdvisoryInputHash
// ---------------------------------------------------------------------------

export function computeAdvisoryInputHash(input: EscalaAdvisoryInput): string {
  const hashPayload = {
    setor_id: input.setor_id,
    data_inicio: input.data_inicio,
    data_fim: input.data_fim,
    pinned_folga_externo: [...input.pinned_folga_externo].sort(
      (a, b) => a.c - b.c || a.d - b.d || a.band - b.band,
    ),
    current_folgas: [...input.current_folgas]
      .sort((a, b) => a.colaborador_id - b.colaborador_id)
      .map((f) => ({
        colaborador_id: f.colaborador_id,
        fixa: f.fixa,
        variavel: f.variavel,
      })),
    demanda_preview: input.demanda_preview ?? null,
  }

  return createHash('sha256')
    .update(JSON.stringify(hashPayload))
    .digest('hex')
    .slice(0, 16)
}

// ---------------------------------------------------------------------------
// 4. runAdvisory — pipeline de 2 passos
// ---------------------------------------------------------------------------

/**
 * Pipeline com 3 fases progressivas (todas advisory_only=true = solve_folga_pattern):
 *
 * Fase A: solver COM pins → valida arranjo atual
 * Fase B: solver SEM pins, COM folga_fixa/variavel → propoe respeitando preferencias
 * Fase C: solver SEM pins, SEM folga_fixa/variavel → propoe mudando tudo (destrutivo)
 *
 * validate_only=true → para na Fase A (so valida, sem proposta)
 * validate_only=false → roda A, B, C progressivamente ate encontrar solucao
 *
 * Output contem APENAS solver diagnostics. TS diagnostics ficam na AvisosSection.
 */
export async function runAdvisory(
  input: EscalaAdvisoryInput,
): Promise<EscalaAdvisoryOutput> {
  // ═══════════════════════════════════════════════════════════════════════════
  // 1. Build solver input COM pins do TS
  // ═══════════════════════════════════════════════════════════════════════════

  const options: BuildSolverInputOptions = {
    solveMode: input.solve_mode ?? 'rapido',
    ...(input.max_time_seconds != null ? { maxTimeSeconds: input.max_time_seconds } : {}),
    ...(input.rules_override ? { rulesOverride: input.rules_override } : {}),
    pinnedFolgaExterno: input.pinned_folga_externo.length > 0
      ? input.pinned_folga_externo
      : undefined,
  }

  const solverInput = await buildSolverInput(
    input.setor_id,
    input.data_inicio,
    input.data_fim,
    [],
    options,
  )

  if (input.demanda_preview) {
    solverInput.demanda = convertSemanaDraftToDemanda(input.demanda_preview)
  }

  // Ciclo e abstrato — strip feriados e excecoes
  solverInput.feriados = []
  solverInput.excecoes = []
  solverInput.config.advisory_only = true

  const colabIdMap = solverInput.colaboradores.map((c) => c.id)

  // ═══════════════════════════════════════════════════════════════════════════
  // 2. TS diagnostics pass through
  // ═══════════════════════════════════════════════════════════════════════════

  // ═══════════════════════════════════════════════════════════════════════════
  // Helpers: build input pra cada fase
  // ═══════════════════════════════════════════════════════════════════════════

  // Fase B: sem pins, mantém folga_fixa/variavel dos colaboradores
  const buildFaseBInput = (): SolverInput => {
    const { pinned_folga_externo: _dropped, ...cleanConfig } =
      solverInput.config as Record<string, unknown>
    return {
      ...solverInput,
      config: { ...cleanConfig, advisory_only: true } as SolverInput['config'],
    }
  }

  // Fase C: sem pins, SEM folga_fixa/variavel (solver decide TUDO — destrutivo)
  const buildFaseCInput = (): SolverInput => {
    const { pinned_folga_externo: _dropped, ...cleanConfig } =
      solverInput.config as Record<string, unknown>
    return {
      ...solverInput,
      colaboradores: solverInput.colaboradores.map((c) => ({
        ...c,
        folga_fixa_dia_semana: null,
        folga_variavel_dia_semana: null,
      })),
      config: { ...cleanConfig, advisory_only: true } as SolverInput['config'],
    }
  }

  // Helper: extract diff from solver pattern
  const buildDiffFromPattern = (
    pattern: Array<{ c: number; d: number; band: number }>,
  ): AdvisoryDiffItem[] => {
    const days = generateDaysList(input.data_inicio, input.data_fim)
    const proposed = extractFolgaFromPattern(pattern, days, colabIdMap.length)
    return proposed.map(({ c, fixa, variavel }) => {
      const colabId = colabIdMap[c] ?? -1
      const cur = input.current_folgas.find((f) => f.colaborador_id === colabId)
      const colab = solverInput.colaboradores[c]
      return {
        colaborador_id: colabId,
        nome: colab?.nome ?? `Colaborador ${colabId}`,
        posto_apelido: '',
        fixa_atual: cur?.fixa ?? null,
        fixa_proposta: fixa,
        variavel_atual: cur?.variavel ?? null,
        variavel_proposta: variavel,
      }
    })
  }

  const hasMeaningfulChanges = (diff: AdvisoryDiffItem[]): boolean =>
    diff.some((d) => d.fixa_atual !== d.fixa_proposta || d.variavel_atual !== d.variavel_proposta)

  // ═══════════════════════════════════════════════════════════════════════════
  // FASE A: Solver COM pins → valida arranjo atual
  // ═══════════════════════════════════════════════════════════════════════════

  let isCurrentValid = false
  let proposal: EscalaAdvisoryOutput['proposal'] | undefined
  let fallback: EscalaAdvisoryOutput['fallback'] | undefined
  const solverDiagnostics: PreviewDiagnostic[] = []

  try {
    console.log('[advisory] Fase A: validando arranjo com pins...')
    const pinnedResult = await runSolver(solverInput, ADVISORY_TIMEOUT_MS)
    console.log(`[advisory] Fase A: sucesso=${pinnedResult.sucesso}, status=${pinnedResult.status}`)

    const solverSucceeded = pinnedResult.sucesso && pinnedResult.status !== 'INFEASIBLE'

    if (!solverSucceeded) {
      isCurrentValid = false
      solverDiagnostics.push({
        code: 'VALIDACAO_INVIAVEL',
        severity: 'error',
        gate: 'BLOCK',
        title: 'O arranjo de folgas atual nao e viavel para o periodo selecionado.',
        detail: pinnedResult.erro?.mensagem
          ?? 'Com as restricoes de jornada e demanda, este arranjo de folgas nao funciona.',
        source: 'advisory_current',
      })
    } else {
      // Phase 1 OK = cobertura por dia GARANTIDA (add_min_headcount_per_day e HARD)
      isCurrentValid = true
    }
  } catch (err: any) {
    console.error('[advisory] Fase A crashed:', err?.message ?? err)
    solverDiagnostics.push({
      code: 'VALIDACAO_ERRO',
      severity: 'error',
      gate: 'BLOCK',
      title: 'Erro ao validar o arranjo.',
      detail: err?.message ?? 'Erro desconhecido na validacao.',
      source: 'advisory_current',
    })
  }

  // Se validate_only → para aqui. Nao propoe nada.
  if (input.validate_only) {
    return {
      status: isCurrentValid ? 'CURRENT_VALID' : 'NO_PROPOSAL',
      diagnostics: solverDiagnostics,
      ...(!isCurrentValid ? { fallback: { should_open_ia: true, reason: 'Arranjo nao viavel.', diagnosis_payload: null } } : {}),
    }
  }

  // Se Fase A OK no Sugerir → tentar Fase B pra ver se tem algo melhor
  // Se Fase A falhou → Fase B tenta resolver

  // ═══════════════════════════════════════════════════════════════════════════
  // FASE B: Solver FREE (OFFICIAL) → proposta dentro das regras
  // ═══════════════════════════════════════════════════════════════════════════

  let faseBResolveu = false
  try {
    console.log('[advisory] Fase B: free solve (sem pins, com folga fixa/variavel)...')
    const freeResult = await runSolver(buildFaseBInput(), ADVISORY_TIMEOUT_MS)
    console.log(`[advisory] Fase B: sucesso=${freeResult.sucesso}, status=${freeResult.status}`)

    if (freeResult.sucesso && freeResult.status !== 'INFEASIBLE' && freeResult.advisory_pattern) {
      faseBResolveu = true
      const diff = buildDiffFromPattern(freeResult.advisory_pattern)

      if (hasMeaningfulChanges(diff)) {
        proposal = { diff }
      }
      // Se sem mudancas e Fase A OK → solver concorda, sem proposta
      // Se sem mudancas e Fase A falhou → solver TAMBEM nao conseguiu com as mesmas folgas
    }
  } catch (err: any) {
    console.error('[advisory] Fase B crashed:', err?.message ?? err)
  }

  // Se Fase B resolveu (com ou sem proposta) E Fase A OK → resultado final
  if (isCurrentValid && faseBResolveu) {
    return {
      status: proposal ? 'PROPOSAL_VALID' : 'CURRENT_VALID',
      diagnostics: solverDiagnostics,
      ...(proposal ? { proposal } : {}),
    }
  }

  // Se Fase B resolveu E Fase A falhou
  if (!isCurrentValid && faseBResolveu) {
    if (proposal) {
      // Solver encontrou arranjo diferente que funciona
      return { status: 'PROPOSAL_VALID', diagnostics: solverDiagnostics, proposal }
    }
    // Solver livre chegou no mesmo padrao mas conseguiu resolver (distribuicao dia-a-dia diferente)
    // O padrao semanal funciona — o problema era nos pins exatos do TS, nao nas folgas
    return { status: 'CURRENT_VALID', diagnostics: [] }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FASE C: Solver FREE (EXPLORATORY) → pode mexer em folga fixa/variavel
  // ═══════════════════════════════════════════════════════════════════════════

  try {
    console.log('[advisory] Fase C: free solve (sem pins, sem folga fixa/variavel — destrutivo)...')
    const exploResult = await runSolver(buildFaseCInput(), ADVISORY_TIMEOUT_MS)
    console.log(`[advisory] Fase C: sucesso=${exploResult.sucesso}, status=${exploResult.status}`)

    if (exploResult.sucesso && exploResult.status !== 'INFEASIBLE' && exploResult.advisory_pattern) {
      const diff = buildDiffFromPattern(exploResult.advisory_pattern)

      if (hasMeaningfulChanges(diff)) {
        solverDiagnostics.push({
          code: 'PROPOSTA_EXPLORATORY',
          severity: 'warning',
          gate: 'ALLOW',
          title: 'Para encontrar solucao, foi necessario flexibilizar regras.',
          detail: 'A proposta pode incluir mudancas em folgas fixas de colaboradores. Revise com cuidado.',
          source: 'advisory_proposal',
        })
        proposal = { diff }
      }
    }
  } catch (err: any) {
    console.error('[advisory] Fase C crashed:', err?.message ?? err)
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Resultado final
  // ═══════════════════════════════════════════════════════════════════════════

  if (proposal) {
    return { status: 'PROPOSAL_VALID', diagnostics: solverDiagnostics, proposal }
  }

  // Nenhuma fase resolveu
  fallback = {
    should_open_ia: true,
    reason: 'Nenhum arranjo viavel foi encontrado mesmo com flexibilizacao de regras.',
    diagnosis_payload: null,
  }

  return { status: 'NO_PROPOSAL', diagnostics: solverDiagnostics, fallback }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateDaysList(dataInicio: string, dataFim: string): string[] {
  const days: string[] = []
  const start = new Date(dataInicio + 'T00:00:00')
  const end = new Date(dataFim + 'T00:00:00')
  const d = new Date(start)
  while (d <= end) {
    days.push(d.toISOString().slice(0, 10))
    d.setDate(d.getDate() + 1)
  }
  return days
}
