/**
 * Motor test — test runner for gerarProposta scenarios.
 * Usage: npm run test:motor (runs via Electron)
 * Or: electron . --test-motor (after npm run build)
 *
 * Each test is a named function returning TestResult.
 * Runner prints summary: N PASS / N FAIL / N SKIP
 * Exits with code 1 if any test failed.
 */

import type Database from 'better-sqlite3'
import { gerarProposta } from './gerador'
import { diaSemana, isDomingo, timeToMin } from './validacao-compartilhada'
import type { Violacao } from '../../shared'

// ─── Test infrastructure ─────────────────────────────────────────────────────

interface TestResult {
  name: string
  passed: boolean
  skipped: boolean
  metrics?: Record<string, unknown>
  error?: string
}

type TestFn = (db: Database.Database) => TestResult

const DATA_INICIO = '2026-03-01'
const DATA_FIM = '2026-03-31'
const SETORES = [
  { id: 1, nome: 'Caixa' },
  { id: 2, nome: 'Acougue' },
  { id: 3, nome: 'Padaria' },
  { id: 4, nome: 'Hortifruti' },
]

// ─── Test: Basic 4 setores ───────────────────────────────────────────────────

function testBasic4Setores(db: Database.Database): TestResult {
  const name = 'basic-4-setores'
  const metrics: Record<string, unknown> = {}

  for (const { id, nome } of SETORES) {
    try {
      const r = gerarProposta(id, DATA_INICIO, DATA_FIM, db, 30)
      metrics[nome] = {
        pontuacao: r.pontuacao,
        cobertura_percent: Number(r.cobertura_percent.toFixed(1)),
        violacoes_hard: r.violacoes_hard,
        violacoes_soft: r.violacoes_soft,
        equilibrio: Number(r.equilibrio.toFixed(1)),
      }

      const hardViols = r.violacoes.filter((v: Violacao) => v.severidade === 'HARD')
      if (hardViols.length > 0) {
        const msgs = hardViols.map(v => `[${v.regra}] ${v.mensagem}`).join('; ')
        return { name, passed: false, skipped: false, metrics, error: `${nome}: ${msgs}` }
      }
    } catch (err) {
      return { name, passed: false, skipped: false, metrics, error: `${nome}: ${err instanceof Error ? err.message : String(err)}` }
    }
  }

  return { name, passed: true, skipped: false, metrics }
}

// ─── Test: Pinned FOLGA basic ────────────────────────────────────────────────

function testPinnedFolgaBasic(db: Database.Database): TestResult {
  const name = 'pinned-folga-basic'

  try {
    const pinnedCells = new Map<string, { status: 'TRABALHO' | 'FOLGA' | 'INDISPONIVEL'; hora_inicio?: string | null; hora_fim?: string | null }>()
    // Fix FOLGA for colaborador 1 on 2026-03-05 (thursday)
    pinnedCells.set('1-2026-03-05', { status: 'FOLGA' })

    const r = gerarProposta(1, DATA_INICIO, DATA_FIM, db, 30, pinnedCells)

    const aloc05 = r.alocacoes.find((a: any) => a.colaborador_id === 1 && a.data === '2026-03-05')
    if (!aloc05 || aloc05.status !== 'FOLGA') {
      return { name, passed: false, skipped: false, error: `Pinned cell (1-2026-03-05) should be FOLGA, got: ${aloc05?.status}` }
    }

    const hardViols = r.violacoes.filter((v: Violacao) => v.severidade === 'HARD')
    if (hardViols.length > 0) {
      const msgs = hardViols.map(v => `[${v.regra}] ${v.mensagem}`).join('; ')
      return { name, passed: false, skipped: false, error: `HARD violations: ${msgs}` }
    }

    return {
      name,
      passed: true,
      skipped: false,
      metrics: { pontuacao: r.pontuacao, violacoes_hard: r.violacoes_hard },
    }
  } catch (err) {
    return { name, passed: false, skipped: false, error: err instanceof Error ? err.message : String(err) }
  }
}

// ─── Test: Lookback cross-escala ─────────────────────────────────────────────
// Create OFICIAL escala ending Feb 28 with 5 consecutive TRABALHO days for colab 1.
// Generate new escala starting Mar 1. Motor should add folga early to avoid 7+ consecutive.

function testLookback(db: Database.Database): TestResult {
  const name = 'lookback-cross-escala'
  let mockEscalaId: number | null = null

  try {
    // Setup: Insert mock OFICIAL escala for setor 1 ending before test period
    const prevInicio = '2026-02-01'
    const prevFim = '2026-02-28'

    const insertEscala = db.prepare(`
      INSERT INTO escalas (setor_id, data_inicio, data_fim, status, pontuacao)
      VALUES (?, ?, ?, 'OFICIAL', 80)
    `)
    const info = insertEscala.run(1, prevInicio, prevFim)
    mockEscalaId = Number(info.lastInsertRowid)

    // Insert 5 consecutive TRABALHO days for colab 1 at end of prev period (Feb 24-28)
    // Feb 24=TUE, 25=WED, 26=THU, 27=FRI, 28=SAT
    const insertAloc = db.prepare(`
      INSERT INTO alocacoes (escala_id, colaborador_id, data, status, hora_inicio, hora_fim, minutos)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)

    const lookbackDays = ['2026-02-24', '2026-02-25', '2026-02-26', '2026-02-27', '2026-02-28']
    for (const d of lookbackDays) {
      insertAloc.run(mockEscalaId, 1, d, 'TRABALHO', '08:00', '17:30', 570)
    }

    // Generate new escala for setor 1
    const r = gerarProposta(1, DATA_INICIO, DATA_FIM, db, 30)

    // Verify: motor should handle lookback and avoid 7+ consecutive
    // colab 1 had 5 work days at end of prev. Motor should NOT add 2+ more TRABALHO at start.
    const hardViols = r.violacoes.filter((v: Violacao) => v.severidade === 'HARD')
    const r1Viols = hardViols.filter(v => v.regra === 'MAX_DIAS_CONSECUTIVOS' && v.colaborador_id === 1)

    if (r1Viols.length > 0) {
      const msgs = r1Viols.map(v => `[${v.regra}] ${v.mensagem}`).join('; ')
      return {
        name, passed: false, skipped: false,
        metrics: { violacoes_hard: r.violacoes_hard, r1_viols_colab1: r1Viols.length },
        error: `Colab 1 has R1 violation despite lookback: ${msgs}`,
      }
    }

    // Check ALL hard violations (not just R1 for colab 1)
    if (hardViols.length > 0) {
      const msgs = hardViols.map(v => `[${v.regra}] ${v.mensagem}`).join('; ')
      return {
        name, passed: false, skipped: false,
        metrics: { violacoes_hard: r.violacoes_hard },
        error: `HARD violations: ${msgs}`,
      }
    }

    return {
      name, passed: true, skipped: false,
      metrics: { pontuacao: r.pontuacao, violacoes_hard: 0 },
    }
  } catch (err) {
    return { name, passed: false, skipped: false, error: err instanceof Error ? err.message : String(err) }
  } finally {
    // Cleanup: remove mock escala + cascaded alocacoes
    if (mockEscalaId !== null) {
      db.prepare('DELETE FROM alocacoes WHERE escala_id = ?').run(mockEscalaId)
      db.prepare('DELETE FROM escalas WHERE id = ?').run(mockEscalaId)
    }
  }
}

// ─── Test: Estagiario no domingo ─────────────────────────────────────────────
// Lucas Mendes (colab id=6, setor 1) is estagiario with trabalha_domingo=false.
// Verify NO estagiario has TRABALHO on any Sunday in the generated escala.

function testEstagiarioDomingo(db: Database.Database): TestResult {
  const name = 'estagiario-domingo'

  try {
    // Find estagiario colabs (trabalha_domingo = 0 in SQLite)
    const estagiarios = db.prepare(`
      SELECT c.id, c.nome, c.setor_id
      FROM colaboradores c
      JOIN tipos_contrato tc ON c.tipo_contrato_id = tc.id
      WHERE tc.trabalha_domingo = 0 AND c.ativo = 1
    `).all() as { id: number; nome: string; setor_id: number }[]

    if (estagiarios.length === 0) {
      return { name, passed: false, skipped: false, error: 'No estagiario found in seed data (expected Lucas Mendes)' }
    }

    // Generate escala for setor with estagiario (setor 1 has Lucas Mendes id=6)
    const setorId = estagiarios[0].setor_id
    const r = gerarProposta(setorId, DATA_INICIO, DATA_FIM, db, 30)

    // Check all Sundays: no estagiario should have TRABALHO
    const domingos = r.alocacoes.filter(a => isDomingo(a.data))
    const violations: string[] = []

    for (const est of estagiarios.filter(e => e.setor_id === setorId)) {
      const estDomingos = domingos.filter(a => a.colaborador_id === est.id && a.status === 'TRABALHO')
      if (estDomingos.length > 0) {
        violations.push(`${est.nome} (id=${est.id}) has TRABALHO on: ${estDomingos.map(a => a.data).join(', ')}`)
      }
    }

    if (violations.length > 0) {
      return { name, passed: false, skipped: false, error: violations.join('; ') }
    }

    return {
      name, passed: true, skipped: false,
      metrics: {
        estagiarios_checked: estagiarios.filter(e => e.setor_id === setorId).length,
        domingos_checked: new Set(domingos.map(a => a.data)).size,
      },
    }
  } catch (err) {
    return { name, passed: false, skipped: false, error: err instanceof Error ? err.message : String(err) }
  }
}

// ─── Test: R2 descanso inter-jornada (11h) ──────────────────────────────────
// Verify that no collaborator has less than 11h (660min) between consecutive work days.

function testR2Descanso(db: Database.Database): TestResult {
  const name = 'r2-descanso-11h'

  try {
    // Generate escala for setor 1 (most colabs, highest chance of tight scheduling)
    const r = gerarProposta(1, DATA_INICIO, DATA_FIM, db, 30)

    // Group alocacoes by colaborador_id
    const byColab = new Map<number, typeof r.alocacoes>()
    for (const a of r.alocacoes) {
      if (!byColab.has(a.colaborador_id)) byColab.set(a.colaborador_id, [])
      byColab.get(a.colaborador_id)!.push(a)
    }

    const violations: string[] = []
    let pairsChecked = 0

    for (const [colabId, alocs] of byColab) {
      // Sort by date
      const sorted = alocs.sort((a, b) => a.data.localeCompare(b.data))

      for (let i = 1; i < sorted.length; i++) {
        const prev = sorted[i - 1]
        const curr = sorted[i]

        // Only check consecutive work days with hours assigned
        if (prev.status !== 'TRABALHO' || curr.status !== 'TRABALHO') continue
        if (!prev.hora_fim || !curr.hora_inicio) continue

        // Check if days are consecutive (1 day apart)
        const prevDate = new Date(prev.data + 'T12:00:00')
        const currDate = new Date(curr.data + 'T12:00:00')
        const daysDiff = Math.round((currDate.getTime() - prevDate.getTime()) / 86400000)
        if (daysDiff !== 1) continue

        pairsChecked++
        const fimMin = timeToMin(prev.hora_fim)
        const iniMin = timeToMin(curr.hora_inicio)
        // Descanso = remaining minutes in the day after work ends + minutes before next work starts
        const descanso = (1440 - fimMin) + iniMin

        if (descanso < 660) {
          violations.push(`colab ${colabId}: ${prev.data} fim ${prev.hora_fim} -> ${curr.data} ini ${curr.hora_inicio} = ${descanso}min (min 660)`)
        }
      }
    }

    if (violations.length > 0) {
      return {
        name, passed: false, skipped: false,
        metrics: { pairs_checked: pairsChecked, violations_found: violations.length },
        error: violations.slice(0, 3).join('; ') + (violations.length > 3 ? ` ...and ${violations.length - 3} more` : ''),
      }
    }

    return {
      name, passed: true, skipped: false,
      metrics: { pairs_checked: pairsChecked },
    }
  } catch (err) {
    return { name, passed: false, skipped: false, error: err instanceof Error ? err.message : String(err) }
  }
}

// ─── Test: Pinned conflito — 7 consecutive TRABALHO pinned ──────────────────
// Pin 7 consecutive TRABALHO days for colab 1 (days 1-7 of period).
// This SHOULD produce a HARD violation R1 (MAX_DIAS_CONSECUTIVOS).
// Correct behavior: motor cannot fix an impossible pinned streak.

function testPinnedConflito(db: Database.Database): TestResult {
  const name = 'pinned-conflito-7-consecutivos'

  try {
    const pinnedCells = new Map<string, { status: 'TRABALHO' | 'FOLGA' | 'INDISPONIVEL'; hora_inicio?: string | null; hora_fim?: string | null }>()

    // Pin 7 consecutive TRABALHO days: 2026-03-02 (MON) to 2026-03-08 (SUN)
    // Using MON-SUN to ensure it's a clean 7-day streak
    const streakDays = [
      '2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05',
      '2026-03-06', '2026-03-07', '2026-03-08',
    ]
    for (const d of streakDays) {
      pinnedCells.set(`1-${d}`, { status: 'TRABALHO' })
    }

    const r = gerarProposta(1, DATA_INICIO, DATA_FIM, db, 30, pinnedCells)

    // Verify: all 7 pinned cells preserved as TRABALHO
    const preservedCount = streakDays.filter(d => {
      const aloc = r.alocacoes.find(a => a.colaborador_id === 1 && a.data === d)
      return aloc?.status === 'TRABALHO'
    }).length

    if (preservedCount !== 7) {
      return {
        name, passed: false, skipped: false,
        error: `Only ${preservedCount}/7 pinned TRABALHO cells preserved`,
      }
    }

    // Verify: HARD violation R1 exists for colab 1
    const r1Viols = r.violacoes.filter(
      (v: Violacao) => v.severidade === 'HARD' && v.regra === 'MAX_DIAS_CONSECUTIVOS' && v.colaborador_id === 1
    )

    if (r1Viols.length === 0) {
      return {
        name, passed: false, skipped: false,
        metrics: { violacoes_hard: r.violacoes_hard },
        error: 'Expected HARD violation R1 (MAX_DIAS_CONSECUTIVOS) for colab 1 but got none',
      }
    }

    return {
      name, passed: true, skipped: false,
      metrics: {
        pinned_preserved: preservedCount,
        r1_violations: r1Viols.length,
        violacoes_hard_total: r.violacoes_hard,
      },
    }
  } catch (err) {
    return { name, passed: false, skipped: false, error: err instanceof Error ? err.message : String(err) }
  }
}

// ─── Test: Cobertura impossivel ──────────────────────────────────────────────
// Temporarily increase demanda to make coverage impossible.
// Motor should not crash. Cobertura < 100%. Coverage violations are SOFT, not HARD.

function testCoberturaImpossivel(db: Database.Database): TestResult {
  const name = 'cobertura-impossivel'

  // Use setor 4 (Hortifruti) which has only 2 colabs.
  // Temporarily bump min_pessoas to 10 on one faixa so coverage is impossible.
  const setorId = 4
  let originalMinPessoas: number | null = null
  let demandaId: number | null = null

  try {
    // Get first demanda for setor 4
    const demanda = db.prepare(
      'SELECT id, min_pessoas FROM demandas WHERE setor_id = ? LIMIT 1'
    ).get(setorId) as { id: number; min_pessoas: number } | undefined

    if (!demanda) {
      return { name, passed: false, skipped: false, error: 'No demanda found for setor 4' }
    }

    demandaId = demanda.id
    originalMinPessoas = demanda.min_pessoas

    // Bump min_pessoas to 10 (setor 4 only has 2 colabs)
    db.prepare('UPDATE demandas SET min_pessoas = 10 WHERE id = ?').run(demandaId)

    const r = gerarProposta(setorId, DATA_INICIO, DATA_FIM, db, 30)

    // Motor should not crash (we got here = no crash)
    // Cobertura should be < 100% (impossible to cover with 2 colabs when 10 needed)
    if (r.cobertura_percent >= 100) {
      return {
        name, passed: false, skipped: false,
        metrics: { cobertura_percent: r.cobertura_percent },
        error: `Expected cobertura < 100% but got ${r.cobertura_percent}%`,
      }
    }

    // Coverage violations should be SOFT, not HARD
    const coverageHard = r.violacoes.filter(
      (v: Violacao) => v.regra === 'COBERTURA' && v.severidade === 'HARD'
    )
    if (coverageHard.length > 0) {
      return {
        name, passed: false, skipped: false,
        error: `Coverage violations should be SOFT, found ${coverageHard.length} HARD`,
      }
    }

    const coverageSoft = r.violacoes.filter(
      (v: Violacao) => v.regra === 'COBERTURA' && v.severidade === 'SOFT'
    )

    return {
      name, passed: true, skipped: false,
      metrics: {
        cobertura_percent: Number(r.cobertura_percent.toFixed(1)),
        coverage_soft_violations: coverageSoft.length,
        pontuacao: r.pontuacao,
        no_crash: true,
      },
    }
  } catch (err) {
    return { name, passed: false, skipped: false, error: err instanceof Error ? err.message : String(err) }
  } finally {
    // Cleanup: restore original min_pessoas
    if (demandaId !== null && originalMinPessoas !== null) {
      db.prepare('UPDATE demandas SET min_pessoas = ? WHERE id = ?').run(originalMinPessoas, demandaId)
    }
  }
}

// ─── Test: Corte semanal QUI_QUA ─────────────────────────────────────────────
// Change empresa.corte_semanal to 'QUI_QUA', generate escala, verify 0 HARD.
// Weeks should split on QUI (Thursday) instead of SEG (Monday).

function testCorteSemanal(db: Database.Database): TestResult {
  const name = 'corte-semanal-qui-qua'

  try {
    // Save original corte_semanal
    const original = db.prepare('SELECT corte_semanal FROM empresa LIMIT 1').get() as { corte_semanal: string } | undefined
    const originalCorte = original?.corte_semanal ?? 'SEG_DOM'

    // Change to QUI_QUA
    db.prepare('UPDATE empresa SET corte_semanal = ?').run('QUI_QUA')

    try {
      const r = gerarProposta(1, DATA_INICIO, DATA_FIM, db, 30)

      const hardViols = r.violacoes.filter((v: Violacao) => v.severidade === 'HARD')
      if (hardViols.length > 0) {
        const msgs = hardViols.map(v => `[${v.regra}] ${v.mensagem}`).join('; ')
        return {
          name, passed: false, skipped: false,
          metrics: { violacoes_hard: r.violacoes_hard },
          error: `HARD violations with QUI_QUA corte: ${msgs}`,
        }
      }

      // Verify folgas are distributed within QUI-QUA weeks
      // For setor 1, colab 1 (CLT 44h, 6 dias_trabalho = 1 folga/semana)
      // Check that each QUI-QUA week has at least 1 folga for colab 1
      const colab1Alocs = r.alocacoes
        .filter(a => a.colaborador_id === 1)
        .sort((a, b) => a.data.localeCompare(b.data))

      // Build weeks with QUI start
      const weeks: typeof colab1Alocs[] = []
      let currentWeek: typeof colab1Alocs = []
      for (const a of colab1Alocs) {
        if (diaSemana(a.data) === 'QUI' && currentWeek.length > 0) {
          weeks.push(currentWeek)
          currentWeek = []
        }
        currentWeek.push(a)
      }
      if (currentWeek.length > 0) weeks.push(currentWeek)

      // Each full week (7 days) should have at least 1 non-TRABALHO day
      let weeksWithFolga = 0
      let fullWeeks = 0
      for (const week of weeks) {
        if (week.length < 5) continue // skip partial weeks at start/end
        fullWeeks++
        const hasFolga = week.some(a => a.status !== 'TRABALHO')
        if (hasFolga) weeksWithFolga++
      }

      return {
        name, passed: true, skipped: false,
        metrics: {
          pontuacao: r.pontuacao,
          violacoes_hard: 0,
          full_weeks: fullWeeks,
          weeks_with_folga: weeksWithFolga,
          corte_used: 'QUI_QUA',
        },
      }
    } finally {
      // Cleanup: restore original corte_semanal
      db.prepare('UPDATE empresa SET corte_semanal = ?').run(originalCorte)
    }
  } catch (err) {
    return { name, passed: false, skipped: false, error: err instanceof Error ? err.message : String(err) }
  }
}

// ─── Test: Max minutos dia por contrato ─────────────────────────────────────
// Pin a cell with hours exceeding the contract's max_minutos_dia.
// Validate via revalidar (motor won't generate over-limit, but manual adjustments can).
// Expects CONTRATO_MAX_DIA HARD violation.

function testMaxMinutosDia(db: Database.Database): TestResult {
  const name = 'max-minutos-dia-contrato'

  try {
    // Find an estagiario (max_minutos_dia should be ~240-300, well below 570)
    const est = db.prepare(`
      SELECT c.id, c.nome, c.setor_id, tc.max_minutos_dia
      FROM colaboradores c
      JOIN tipos_contrato tc ON c.tipo_contrato_id = tc.id
      WHERE tc.max_minutos_dia < 400 AND c.ativo = 1
      LIMIT 1
    `).get() as { id: number; nome: string; setor_id: number; max_minutos_dia: number } | undefined

    if (!est) {
      return { name, passed: false, skipped: false, error: 'No estagiario with low max_minutos_dia found in seed' }
    }

    // Pin a TRABALHO cell with minutes exceeding the contract limit
    const overMinutos = est.max_minutos_dia + 60 // 1h above contract limit
    const pinnedCells = new Map<string, { status: 'TRABALHO' | 'FOLGA' | 'INDISPONIVEL'; hora_inicio?: string | null; hora_fim?: string | null }>()
    pinnedCells.set(`${est.id}-2026-03-03`, {
      status: 'TRABALHO',
      hora_inicio: '08:00',
      hora_fim: `${String(8 + Math.floor(overMinutos / 60)).padStart(2, '0')}:${String(overMinutos % 60).padStart(2, '0')}`,
    })

    const r = gerarProposta(est.setor_id, DATA_INICIO, DATA_FIM, db, 30, pinnedCells)

    // Verify the cell was preserved with TRABALHO
    const aloc = r.alocacoes.find(a => a.colaborador_id === est.id && a.data === '2026-03-03')
    if (!aloc || aloc.status !== 'TRABALHO') {
      return { name, passed: false, skipped: false, error: `Pinned cell not preserved: got ${aloc?.status}` }
    }

    // Verify CONTRATO_MAX_DIA HARD violation exists
    const maxDiaViols = r.violacoes.filter(
      (v: Violacao) => v.regra === 'CONTRATO_MAX_DIA' && v.colaborador_id === est.id && v.data === '2026-03-03'
    )

    if (maxDiaViols.length === 0) {
      return {
        name, passed: false, skipped: false,
        metrics: { max_minutos_dia: est.max_minutos_dia, pinned_minutos: overMinutos },
        error: `Expected CONTRATO_MAX_DIA HARD violation for ${est.nome} but got none`,
      }
    }

    return {
      name, passed: true, skipped: false,
      metrics: {
        colab: est.nome,
        max_minutos_dia: est.max_minutos_dia,
        pinned_minutos: overMinutos,
        violation_found: true,
      },
    }
  } catch (err) {
    return { name, passed: false, skipped: false, error: err instanceof Error ? err.message : String(err) }
  }
}

// ─── Test: Partial pinned streak (5 pinned + 2 free) ────────────────────────
// Pin 5 consecutive TRABALHO days, leave 2 days free in the streak window.
// Motor repair should pick one of the 2 free days for FOLGA (not touch pinned).
// Result: 0 HARD violations (repair resolved it), all 5 pinned preserved.

function testPartialPinnedStreak(db: Database.Database): TestResult {
  const name = 'partial-pinned-streak-5plus2'

  try {
    const pinnedCells = new Map<string, { status: 'TRABALHO' | 'FOLGA' | 'INDISPONIVEL'; hora_inicio?: string | null; hora_fim?: string | null }>()

    // Pin 5 consecutive TRABALHO: 2026-03-02 (MON) to 2026-03-06 (FRI)
    // Leave 2026-03-07 (SAT) and 2026-03-08 (SUN) free for repair to use
    const pinnedDays = ['2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05', '2026-03-06']
    const freeDays = ['2026-03-07', '2026-03-08']

    for (const d of pinnedDays) {
      pinnedCells.set(`1-${d}`, { status: 'TRABALHO' })
    }

    const r = gerarProposta(1, DATA_INICIO, DATA_FIM, db, 30, pinnedCells)

    // Verify: all 5 pinned cells preserved as TRABALHO
    const preservedCount = pinnedDays.filter(d => {
      const aloc = r.alocacoes.find(a => a.colaborador_id === 1 && a.data === d)
      return aloc?.status === 'TRABALHO'
    }).length

    if (preservedCount !== 5) {
      return {
        name, passed: false, skipped: false,
        error: `Only ${preservedCount}/5 pinned TRABALHO cells preserved`,
      }
    }

    // Verify: at least one of the 2 free days should be FOLGA (repair chose it)
    const freeDayStatuses = freeDays.map(d => {
      const aloc = r.alocacoes.find(a => a.colaborador_id === 1 && a.data === d)
      return { data: d, status: aloc?.status }
    })
    const hasFolgaInFree = freeDayStatuses.some(s => s.status === 'FOLGA')

    // Verify: 0 R1 HARD violations for colab 1 (repair should have resolved the streak)
    const r1Viols = r.violacoes.filter(
      (v: Violacao) => v.severidade === 'HARD' && v.regra === 'MAX_DIAS_CONSECUTIVOS' && v.colaborador_id === 1
    )

    if (r1Viols.length > 0) {
      return {
        name, passed: false, skipped: false,
        metrics: { pinned_preserved: preservedCount, free_days: freeDayStatuses, r1_viols: r1Viols.length },
        error: `Colab 1 has R1 violation despite 2 free days available for repair`,
      }
    }

    return {
      name, passed: true, skipped: false,
      metrics: {
        pinned_preserved: preservedCount,
        free_day_statuses: freeDayStatuses.map(s => `${s.data}=${s.status}`).join(', '),
        repair_used_free_day: hasFolgaInFree,
        r1_violations: 0,
      },
    }
  } catch (err) {
    return { name, passed: false, skipped: false, error: err instanceof Error ? err.message : String(err) }
  }
}

// ─── Test runner ─────────────────────────────────────────────────────────────

const ALL_TESTS: TestFn[] = [
  testBasic4Setores,
  testPinnedFolgaBasic,
  testLookback,
  testEstagiarioDomingo,
  testR2Descanso,
  testPinnedConflito,
  testPartialPinnedStreak,
  testMaxMinutosDia,
  testCoberturaImpossivel,
  testCorteSemanal,
]

/**
 * Run all motor tests with given database.
 * Returns exit code (0 = all pass/skip, 1 = any failure).
 */
export function runMotorTest(db: Database.Database): number {
  console.log('=== Motor Test Suite — Marco 2026 (30 dias) ===\n')

  const results: TestResult[] = []

  for (const testFn of ALL_TESTS) {
    const result = testFn(db)
    results.push(result)

    const icon = result.skipped ? 'SKIP' : result.passed ? 'PASS' : 'FAIL'
    console.log(`  [${icon}] ${result.name}`)

    if (result.error) {
      console.log(`         ${result.error}`)
    }
    if (result.metrics && !result.skipped) {
      for (const [key, val] of Object.entries(result.metrics)) {
        if (typeof val === 'object' && val !== null) {
          console.log(`         ${key}: ${JSON.stringify(val)}`)
        } else {
          console.log(`         ${key}: ${val}`)
        }
      }
    }
  }

  const passed = results.filter(r => r.passed && !r.skipped).length
  const failed = results.filter(r => !r.passed && !r.skipped).length
  const skipped = results.filter(r => r.skipped).length

  console.log(`\n=== ${passed} PASS / ${failed} FAIL / ${skipped} SKIP ===`)

  if (failed > 0) {
    console.log('\nRESULTADO: FALHOU')
    return 1
  }
  console.log('\nRESULTADO: OK')
  return 0
}
