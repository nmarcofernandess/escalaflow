#!/usr/bin/env -S npx tsx
/**
 * solver-cli.ts — CLI dev para rodar e inspecionar o motor OR-Tools
 *
 * Uso:
 *   npm run solver:cli -- <setor_id> [data_inicio] [data_fim] [--mode rapido|otimizado] [--json] [--summary] [--dump]
 *
 * Exemplos:
 *   npm run solver:cli -- 2                          # Açougue, período padrão (1 semana)
 *   npm run solver:cli -- 2 2026-03-02 2026-03-08    # Açougue, 1 semana específica
 *   npm run solver:cli -- 1 2026-03-02 2026-04-26 --mode otimizado  # Caixa, 8 semanas
 *   npm run solver:cli -- 2 --json                   # JSON sem comparacao_demanda (~250KB)
 *   npm run solver:cli -- 2 --json-full              # JSON completo (~800KB)
 *   npm run solver:cli -- 2 --summary                # JSON compacto: indicadores + horas (~1KB)
 *   npm run solver:cli -- 2 --dump                   # Salva input JSON em tmp/
 *
 * Requer: app já ter sido rodado ao menos 1x (banco populado em out/data/escalaflow-pg)
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildSolverInput, runSolver } from '../src/main/motor/solver-bridge'
import { initDb, closeDb } from '../src/main/db/pglite'
import { createTables } from '../src/main/db/schema'
import { queryOne, queryAll } from '../src/main/db/query'
import type { SolverOutput, SolverOutputAlocacao } from '../src/shared/types'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')

process.env.ESCALAFLOW_DB_PATH = process.env.ESCALAFLOW_DB_PATH || path.join(rootDir, 'out', 'data', 'escalaflow-pg')

// ---------------------------------------------------------------------------
// ANSI colors
// ---------------------------------------------------------------------------
const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
}

// ---------------------------------------------------------------------------
// Parse args
// ---------------------------------------------------------------------------
const args = process.argv.slice(2)
const flags = new Set(args.filter(a => a.startsWith('--')))
const positional = args.filter(a => !a.startsWith('--'))

const isListCmd = positional[0] === 'list'
const setorId = positional[0] ? parseInt(positional[0], 10) : NaN
const dataInicio = positional[1] ?? (() => {
  // Próxima segunda
  const d = new Date()
  d.setDate(d.getDate() + ((1 + 7 - d.getDay()) % 7 || 7))
  return d.toISOString().slice(0, 10)
})()
const dataFim = positional[2] ?? (() => {
  // 1 semana depois do inicio (domingo)
  const d = new Date(dataInicio)
  d.setDate(d.getDate() + 6)
  return d.toISOString().slice(0, 10)
})()

const VALID_MODES = ['rapido', 'balanceado', 'otimizado', 'maximo'] as const
type SolveModeArg = (typeof VALID_MODES)[number]
const rawMode = flags.has('--mode') ? args[args.indexOf('--mode') + 1] : 'rapido'
if (!VALID_MODES.includes(rawMode as SolveModeArg)) {
  console.error(`\x1b[31mERRO: Modo "${rawMode}" inválido. Use: ${VALID_MODES.join(', ')}\x1b[0m`)
  process.exit(1)
}
const solveMode = rawMode as SolveModeArg
const jsonOnly = flags.has('--json')
const summaryOnly = flags.has('--summary')
const dumpInput = flags.has('--dump')

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DIA_LABELS: Record<number, string> = { 0: 'DOM', 1: 'SEG', 2: 'TER', 3: 'QUA', 4: 'QUI', 5: 'SEX', 6: 'SAB' }

function diaSemanaLabel(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00')
  return DIA_LABELS[d.getDay()] ?? '???'
}

function fmtMinutes(min: number): string {
  const h = Math.floor(min / 60)
  const m = min % 60
  return `${h}h${m.toString().padStart(2, '0')}`
}

function pad(s: string, n: number): string {
  return s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length)
}

function barChart(value: number, max: number, width: number): string {
  const filled = Math.round((value / max) * width)
  return '█'.repeat(Math.min(filled, width)) + '░'.repeat(Math.max(0, width - filled))
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  if (isNaN(setorId) && !isListCmd) {
    console.log(`
${C.bold}${C.cyan}EscalaFlow Solver CLI${C.reset}

${C.bold}Uso:${C.reset}
  npm run solver:cli -- <setor_id> [data_inicio] [data_fim] [flags]

${C.bold}Flags:${C.reset}
  --mode rapido|balanceado|otimizado|maximo   Modo do solver (default: rapido)
  --json                    JSON sem comparacao_demanda (~250KB para 3 meses)
  --json-full               JSON completo com comparacao_demanda (~800KB)
  --summary                 JSON compacto: indicadores + horas/colab (~1KB)
  --dump                    Salva input JSON em tmp/

${C.bold}Exemplos:${C.reset}
  npm run solver:cli -- 2                          ${C.dim}# Açougue, 1 semana${C.reset}
  npm run solver:cli -- 2 2026-03-02 2026-03-08    ${C.dim}# Período específico${C.reset}
  npm run solver:cli -- 1 --mode otimizado         ${C.dim}# Caixa, modo otimizado${C.reset}
  npm run solver:cli -- 2 --dump                   ${C.dim}# Salva input pra debug${C.reset}

${C.bold}Listar setores:${C.reset}
  npm run solver:cli -- list
`)
    process.exit(0)
  }

  // In JSON/summary mode, redirect ALL console.log to stderr so stdout is clean JSON only
  const _origLog = console.log
  if (jsonOnly || summaryOnly) {
    console.log = (...args: any[]) => console.error(...args)
  }

  await initDb()
  await createTables()

  // Comando especial: listar setores
  if (isListCmd) {
    const setores = await queryAll<{ id: number; nome: string; ativo: boolean; hora_abertura: string; hora_fechamento: string }>(
      'SELECT id, nome, ativo, hora_abertura, hora_fechamento FROM setores ORDER BY id'
    )
    const colabs = await queryAll<{ setor_id: number; count: number }>(
      'SELECT setor_id, COUNT(*)::int as count FROM colaboradores WHERE ativo = true GROUP BY setor_id'
    )
    const colabMap = new Map(colabs.map(c => [c.setor_id, c.count]))

    console.log(`\n${C.bold}Setores disponíveis:${C.reset}\n`)
    for (const s of setores) {
      const status = s.ativo ? `${C.green}ATIVO${C.reset}` : `${C.dim}inativo${C.reset}`
      console.log(`  ${C.bold}${s.id}${C.reset} — ${s.nome} [${status}] ${s.hora_abertura}-${s.hora_fechamento} (${colabMap.get(s.id) ?? 0} colabs ativos)`)
    }
    console.log()
    await closeDb()
    return
  }

  // Verificar setor existe
  const setor = await queryOne<{ id: number; nome: string; hora_abertura: string; hora_fechamento: string }>(
    'SELECT id, nome, hora_abertura, hora_fechamento FROM setores WHERE id = $1 AND ativo = TRUE LIMIT 1',
    setorId,
  )
  if (!setor) {
    console.error(`${C.red}ERRO: Setor ${setorId} não encontrado ou inativo.${C.reset}`)
    console.log(`Use ${C.cyan}npm run solver:cli -- list${C.reset} para ver setores disponíveis.`)
    await closeDb()
    process.exit(1)
  }

  if (!jsonOnly) {
    console.log(`\n${C.bold}${C.cyan}╔══════════════════════════════════════════╗${C.reset}`)
    console.log(`${C.bold}${C.cyan}║${C.reset}  ${C.bold}EscalaFlow Solver CLI${C.reset}                    ${C.bold}${C.cyan}║${C.reset}`)
    console.log(`${C.bold}${C.cyan}╚══════════════════════════════════════════╝${C.reset}\n`)
    console.log(`  ${C.bold}Setor:${C.reset}   ${setor.nome} (#${setor.id})`)
    console.log(`  ${C.bold}Período:${C.reset} ${dataInicio} a ${dataFim}`)
    console.log(`  ${C.bold}Modo:${C.reset}    ${solveMode}`)
    console.log(`  ${C.bold}DB:${C.reset}      ${process.env.ESCALAFLOW_DB_PATH}`)
    console.log()
  }

  // Build input
  const t0 = performance.now()
  const payload = await buildSolverInput(setorId, dataInicio, dataFim, [], {
    solveMode,
    nivelRigor: 'ALTO',
  })
  const buildMs = performance.now() - t0

  if (!jsonOnly) {
    console.log(`  ${C.dim}Input gerado em ${Math.round(buildMs)}ms — ${payload.colaboradores.length} colabs, ${payload.demanda.length} segmentos demanda${C.reset}`)
  }

  if (dumpInput) {
    const dumpPath = path.join(rootDir, 'tmp', `solver-input-setor-${setorId}.json`)
    fs.mkdirSync(path.dirname(dumpPath), { recursive: true })
    fs.writeFileSync(dumpPath, JSON.stringify(payload, null, 2), 'utf-8')
    if (!jsonOnly) console.log(`  ${C.green}Input salvo:${C.reset} ${dumpPath}`)
  }

  // Run solver
  if (!jsonOnly && !summaryOnly) {
    console.log(`\n  ${C.yellow}Resolvendo...${C.reset}\n`)
  }

  const t1 = performance.now()
  const motorLines: string[] = []
  const output = await runSolver(payload, 3_660_000, (line) => {
    // Deduplicate: runSolver sends both live stderr AND buffered stderr. Track unique lines.
    if (!motorLines.includes(line)) {
      motorLines.push(line)
      if (!jsonOnly && !summaryOnly) {
        console.log(`  ${C.dim}[motor] ${line}${C.reset}`)
      }
    }
  })
  const solveMs = performance.now() - t1

  // JSON mode: dump and exit (use original stdout, not redirected)
  if (jsonOnly) {
    // --json omits comparacao_demanda (67% do peso ~556KB) — use --json-full if needed
    const { comparacao_demanda: _cd, ...outputCompact } = output
    _origLog(JSON.stringify(flags.has('--json-full') ? output : outputCompact, null, 2))
    await closeDb()
    return
  }

  // Summary mode: compact JSON with just KPIs + diagnostics (~1KB)
  if (summaryOnly) {
    const diag = output.diagnostico
    const summary = {
      status: output.status,
      sucesso: output.sucesso,
      solve_time_ms: Math.round(solveMs),
      indicadores: output.indicadores,
      ciclo: diag ? {
        semanas: diag.cycle_length_weeks ?? null,
        dias: diag.phase1_cycle_days ?? null,
        bandas: diag.phase1_bands_pinned ?? null,
      } : null,
      diagnostico: diag ?? null,
      horas_por_colaborador: (() => {
        const map = new Map<string, number>()
        for (const a of output.alocacoes) {
          if (a.status !== 'TRABALHO') continue
          map.set(a.colaborador, (map.get(a.colaborador) ?? 0) + a.minutos_trabalho)
        }
        return Object.fromEntries([...map.entries()].map(([nome, min]) => [nome, `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}`]))
      })(),
    }
    _origLog(JSON.stringify(summary, null, 2))
    await closeDb()
    return
  }

  // Rich output
  console.log()
  printResultado(output, payload, solveMs)

  await closeDb()
}

// ---------------------------------------------------------------------------
// Rich output formatters
// ---------------------------------------------------------------------------

function printResultado(output: SolverOutput, payload: any, solveMs: number) {
  const { sucesso, status, indicadores, diagnostico, alocacoes, decisoes, comparacao_demanda } = output

  // ── STATUS ──
  const statusColor = sucesso ? (status === 'OPTIMAL' ? C.green : C.yellow) : C.red
  const statusIcon = sucesso ? (status === 'OPTIMAL' ? '✓' : '~') : '✗'
  console.log(`${C.bold}  ── RESULTADO ─────────────────────────────${C.reset}`)
  console.log(`  ${statusColor}${statusIcon} ${status}${C.reset} em ${C.bold}${(solveMs / 1000).toFixed(1)}s${C.reset}`)

  if (diagnostico) {
    // Phase 1 info
    const p1 = diagnostico as any
    if (p1.phase1_status) {
      const p1Color = p1.phase1_status === 'OK' ? C.green : C.yellow
      const p1Time = p1.phase1_solve_time_ms ? `${(p1.phase1_solve_time_ms / 1000).toFixed(1)}s` : '?'
      const p1Cycle = p1.phase1_cycle_days ? `ciclo ${p1.phase1_cycle_days} dias` : ''
      const p1Bands = p1.phase1_bands_pinned
      const bandsStr = p1Bands
        ? ` — ${p1Bands.off} OFF / ${p1Bands.manha} M / ${p1Bands.tarde} T / ${p1Bands.integral} I`
        : ''
      console.log(`  ${C.dim}Phase 1 (Bands):${C.reset} ${p1Color}${p1.phase1_status}${C.reset} — ${p1Time}${p1Cycle ? ` — ${p1Cycle}` : ''}${bandsStr}`)
    }

    if (diagnostico.pass_usado && diagnostico.pass_usado > 1) {
      console.log(`  ${C.yellow}⚠ Pass ${diagnostico.pass_usado} (degradação: ${diagnostico.regras_relaxadas?.join(', ') ?? 'N/A'})${C.reset}`)
    }
    if (diagnostico.modo_emergencia) {
      console.log(`  ${C.bgRed}${C.white} MODO EMERGÊNCIA ${C.reset} — time windows e folga_fixa removidos`)
    }
    if (diagnostico.gap_percent != null) {
      const gapColor = diagnostico.gap_percent === 0 ? C.green : diagnostico.gap_percent < 2 ? C.yellow : C.red
      console.log(`  ${C.dim}Gap:${C.reset} ${gapColor}${diagnostico.gap_percent.toFixed(2)}%${C.reset}${diagnostico.gap_percent === 0 ? ' (provado ótimo)' : ''}`)
    }
    if (diagnostico.cycle_length_weeks) {
      console.log(`  ${C.dim}Ciclo:${C.reset} ${C.cyan}${diagnostico.cycle_length_weeks} semanas${C.reset}`)
    }
    const cap = diagnostico.capacidade_vs_demanda
    if (cap) {
      console.log(`  ${C.dim}Capacidade: ${cap.max_slots_disponiveis} slots dispo / ${cap.total_slots_demanda} slots demanda (ratio ${cap.ratio_cobertura_max.toFixed(2)})${C.reset}`)
    }
  }

  if (!sucesso) {
    if (output.erro) {
      console.log(`\n  ${C.red}${C.bold}ERRO: ${output.erro.mensagem}${C.reset}`)
      if (output.erro.sugestoes?.length) {
        console.log(`  ${C.yellow}Sugestões:${C.reset}`)
        for (const s of output.erro.sugestoes) console.log(`    - ${s}`)
      }
    }
    return
  }

  if (!indicadores || !alocacoes) return

  // ── INDICADORES ──
  console.log(`\n${C.bold}  ── INDICADORES ───────────────────────────${C.reset}`)
  const cobColor = indicadores.cobertura_percent >= 95 ? C.green : indicadores.cobertura_percent >= 80 ? C.yellow : C.red
  const cobEfColor = (indicadores.cobertura_efetiva_percent ?? indicadores.cobertura_percent) >= 97 ? C.green : (indicadores.cobertura_efetiva_percent ?? indicadores.cobertura_percent) >= 90 ? C.yellow : C.red
  console.log(`  Cobertura:    ${cobColor}${indicadores.cobertura_percent}%${C.reset}  ${barChart(indicadores.cobertura_percent, 100, 20)}`)
  if (indicadores.cobertura_efetiva_percent != null && indicadores.cobertura_efetiva_percent !== indicadores.cobertura_percent) {
    console.log(`  Cob. Efetiva: ${cobEfColor}${indicadores.cobertura_efetiva_percent}%${C.reset}  ${barChart(indicadores.cobertura_efetiva_percent, 100, 20)}  ${C.dim}(ignora gaps transição)${C.reset}`)
  }
  console.log(`  Pontuação:    ${C.bold}${indicadores.pontuacao}${C.reset}`)
  console.log(`  Equilíbrio:   ${indicadores.equilibrio}%`)
  console.log(`  Violações:    ${C.red}${indicadores.violacoes_hard} HARD${C.reset} / ${C.yellow}${indicadores.violacoes_soft} SOFT${C.reset}`)

  // ── ESCALA POR PESSOA ──
  const colabNames = new Map(payload.colaboradores.map((c: any) => [c.id, c.nome]))
  const byPerson = new Map<number, SolverOutputAlocacao[]>()
  for (const a of alocacoes) {
    if (!byPerson.has(a.colaborador_id)) byPerson.set(a.colaborador_id, [])
    byPerson.get(a.colaborador_id)!.push(a)
  }

  // Collect unique dates
  const dates = [...new Set(alocacoes.map(a => a.data))].sort()

  console.log(`\n${C.bold}  ── ESCALA POR COLABORADOR ─────────────────${C.reset}`)

  // Header row
  const nameWidth = 12
  const colWidth = 13  // "07:00-19:30" = 11 chars + 2 padding
  let header = `  ${pad('', nameWidth)} │`
  for (const dt of dates) {
    const dia = diaSemanaLabel(dt)
    const dd = dt.slice(8, 10)
    header += pad(` ${dia} ${dd}`, colWidth) + '│'
  }
  header += ` ${C.bold}TOTAL${C.reset}`
  console.log(header)
  console.log(`  ${'─'.repeat(nameWidth)}─┼${('─'.repeat(colWidth) + '┼').repeat(dates.length)} ──────`)

  for (const [colabId, allocs] of byPerson) {
    const nome = colabNames.get(colabId) ?? `#${colabId}`
    const allocByDate = new Map(allocs.map(a => [a.data, a]))
    let totalMin = 0

    let line = `  ${C.bold}${pad(nome, nameWidth)}${C.reset} │`
    for (const dt of dates) {
      const a = allocByDate.get(dt)
      if (!a || a.status === 'FOLGA') {
        line += `${C.blue}${pad('  FOLGA', colWidth)}${C.reset}│`
      } else {
        const mins = a.minutos_trabalho ?? 0
        totalMin += mins
        const hi = a.hora_inicio?.slice(0, 5) ?? '??'
        const hf = a.hora_fim?.slice(0, 5) ?? '??'
        const cell = ` ${hi}-${hf}`
        const minsColor = mins > 540 ? C.yellow : mins < 240 ? C.dim : ''
        line += `${minsColor}${pad(cell, colWidth)}${C.reset}│`
      }
    }

    const horas_contrato = payload.colaboradores.find((c: any) => c.id === colabId)?.horas_semanais ?? 44
    const metaMin = horas_contrato * 60
    // Calcular semanas no período
    const numDays = dates.length
    const numWeeks = Math.max(1, numDays / 7)
    const metaTotal = metaMin * numWeeks
    const delta = totalMin - metaTotal
    const deltaColor = Math.abs(delta) <= 90 * numWeeks ? C.green : C.red
    const deltaSign = delta >= 0 ? '+' : ''

    line += ` ${C.bold}${fmtMinutes(totalMin)}${C.reset} ${deltaColor}(${deltaSign}${delta}min)${C.reset}`
    console.log(line)
  }

  // ── COBERTURA DE DEMANDA ──
  if (comparacao_demanda && comparacao_demanda.length > 0) {
    const byDate = new Map<string, typeof comparacao_demanda>()
    for (const c of comparacao_demanda) {
      if (!byDate.has(c.data)) byDate.set(c.data, [])
      byDate.get(c.data)!.push(c)
    }

    let totalDeficit = 0
    let totalSurplus = 0
    let totalSlots = 0

    console.log(`\n${C.bold}  ── COBERTURA DE DEMANDA ───────────────────${C.reset}`)

    for (const dt of dates) {
      const dia = diaSemanaLabel(dt)
      const dd = dt.slice(8, 10)
      const slots = byDate.get(dt) ?? []
      const deficits = slots.filter(s => s.executado < s.planejado)
      const surpluses = slots.filter(s => s.executado > s.planejado)

      totalSlots += slots.length
      for (const s of deficits) totalDeficit += (s.planejado - s.executado)
      for (const s of surpluses) totalSurplus += (s.executado - s.planejado)

      if (deficits.length === 0) {
        console.log(`  ${C.green}✓${C.reset} ${dia} ${dd} — ${C.green}100% coberto${C.reset} (${slots.length} slots)`)
      } else {
        // Agregar gaps contíguos
        const gaps = aggregateGaps(deficits)
        const pct = ((slots.length - deficits.length) / slots.length * 100).toFixed(0)
        console.log(`  ${C.red}✗${C.reset} ${dia} ${dd} — ${C.red}${pct}% coberto${C.reset} (${deficits.length} slots com falta)`)
        for (const gap of gaps) {
          console.log(`    ${C.red}${gap.inicio}-${gap.fim}: precisa ${gap.planejado}, tem ${gap.executado} (falta ${gap.planejado - gap.executado})${C.reset}`)
        }
      }
    }

    console.log(`\n  ${C.bold}Resumo:${C.reset} ${totalDeficit} slots-pessoa faltando, ${totalSurplus} slots-pessoa excedente`)
  }

  // ── HORAS POR SEMANA (se multi-semana) ──
  if (dates.length > 7) {
    console.log(`\n${C.bold}  ── HORAS POR SEMANA ──────────────────────${C.reset}`)
    // Split dates into 7-day chunks
    const weeks: string[][] = []
    for (let i = 0; i < dates.length; i += 7) {
      weeks.push(dates.slice(i, i + 7))
    }

    for (const [colabId] of byPerson) {
      const nome = colabNames.get(colabId) ?? `#${colabId}`
      const allocs = byPerson.get(colabId)!
      const allocByDate = new Map(allocs.map(a => [a.data, a]))

      let line = `  ${pad(nome, nameWidth)} │`
      for (let w = 0; w < weeks.length; w++) {
        let weekMin = 0
        for (const dt of weeks[w]) {
          const a = allocByDate.get(dt)
          if (a && a.status === 'TRABALHO') weekMin += a.minutos_trabalho ?? 0
        }
        const color = weekMin > 44 * 60 + 90 ? C.red : weekMin < 44 * 60 - 90 ? C.yellow : C.green
        line += ` ${color}${fmtMinutes(weekMin)}${C.reset} │`
      }
      console.log(line)
    }
  }

  console.log()
}

interface AggregatedGap {
  inicio: string
  fim: string
  planejado: number
  executado: number
}

function aggregateGaps(deficits: Array<{ hora_inicio: string; hora_fim: string; planejado: number; executado: number }>): AggregatedGap[] {
  if (deficits.length === 0) return []

  const sorted = [...deficits].sort((a, b) => a.hora_inicio.localeCompare(b.hora_inicio))
  const gaps: AggregatedGap[] = []

  let current: AggregatedGap = {
    inicio: sorted[0].hora_inicio,
    fim: sorted[0].hora_fim,
    planejado: sorted[0].planejado,
    executado: sorted[0].executado,
  }

  for (let i = 1; i < sorted.length; i++) {
    const s = sorted[i]
    if (s.hora_inicio === current.fim && s.planejado === current.planejado && s.executado === current.executado) {
      current.fim = s.hora_fim
    } else {
      gaps.push(current)
      current = { inicio: s.hora_inicio, fim: s.hora_fim, planejado: s.planejado, executado: s.executado }
    }
  }
  gaps.push(current)
  return gaps
}

void main().catch(err => {
  console.error(`${C.red}ERRO FATAL:${C.reset}`, err.message)
  process.exit(1)
})
