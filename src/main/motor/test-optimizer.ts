#!/usr/bin/env npx tsx
/**
 * Teste standalone do Optimizer v2 — roda direto no terminal.
 *
 * Usage:
 *   npx tsx src/main/motor/test-optimizer.ts [setor_id] [budget_ms]
 *
 * Defaults:
 *   setor_id = 2 (Açougue)
 *   budget_ms = 5000 (5 segundos)
 *
 * O que faz:
 *   1. Gera escala SEM otimizador (budget=0) → baseline
 *   2. Gera escala COM otimizador (budget=N) → otimizado
 *   3. Compara score, deficit, cobertura
 *   4. Mostra telemetria: neighborhoods, SA, stagnation
 *   5. Valida safety net: HARD = 0 em ambos
 */

import { gerarEscalaV3 } from './gerador'
import type { EscalaCompletaV3, Alocacao } from '../../shared'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

// --- Parsear argumentos ---
const args = process.argv.slice(2)
const SETOR_ID = args[0] ? Number(args[0]) : 2
const BUDGET_MS = args[1] ? Number(args[1]) : 5000

const DATA_INICIO = '2026-03-02'  // Segunda
const DATA_FIM = '2026-03-28'      // Sabado

// --- Cores ANSI ---
const RED = '\x1b[31m'
const GREEN = '\x1b[32m'
const YELLOW = '\x1b[33m'
const CYAN = '\x1b[36m'
const BOLD = '\x1b[1m'
const DIM = '\x1b[2m'
const RESET = '\x1b[0m'

function hr(char = '─', len = 60) {
  return DIM + char.repeat(len) + RESET
}

function badge(label: string, value: number | string, color = CYAN) {
  return `  ${DIM}${label}:${RESET} ${color}${value}${RESET}`
}

function statusBadge(passed: boolean, label: string) {
  return passed
    ? `${GREEN}✓ ${label}${RESET}`
    : `${RED}✗ ${label}${RESET}`
}

// --- Init DB (path absoluto pra funcionar fora do Electron) ---
const __filename_test = fileURLToPath(import.meta.url)
const __dirname_test = path.dirname(__filename_test)
const projectRoot = path.resolve(__dirname_test, '../../..')
if (!process.env.ESCALAFLOW_DB_PATH) {
  process.env.ESCALAFLOW_DB_PATH = path.join(projectRoot, 'data', 'escalaflow.db')
}

// Importar DB + schema + seed DEPOIS de setar env
const { createTables } = await import('../db/schema')
const { seedData } = await import('../db/seed')
const { getDb, closeDb } = await import('../db/database')

createTables()
seedData()

const db = getDb()

// Verificar setor existe
const setor = db.prepare('SELECT id, nome, hora_abertura, hora_fechamento FROM setores WHERE id = ?').get(SETOR_ID) as
  | { id: number; nome: string; hora_abertura: string; hora_fechamento: string }
  | undefined

if (!setor) {
  console.error(`${RED}Setor ${SETOR_ID} nao encontrado no banco.${RESET}`)
  const setores = db.prepare('SELECT id, nome FROM setores WHERE ativo = 1').all() as { id: number; nome: string }[]
  console.log(`Setores disponiveis: ${setores.map(s => `${s.id}=${s.nome}`).join(', ')}`)
  closeDb()
  process.exit(1)
}

const colabCount = (db.prepare('SELECT COUNT(*) as c FROM colaboradores WHERE setor_id = ? AND ativo = 1').get(SETOR_ID) as { c: number }).c

console.log(`
${BOLD}╔════════════════════════════════════════════════╗
║  OPTIMIZER v2 TEST — ${setor.nome.padEnd(25)}║
╚════════════════════════════════════════════════╝${RESET}

${badge('Setor', `${setor.nome} (id=${SETOR_ID})`)}
${badge('Periodo', `${DATA_INICIO} → ${DATA_FIM}`)}
${badge('Colaboradores', colabCount)}
${badge('Horario', `${setor.hora_abertura}–${setor.hora_fechamento}`)}
${badge('Budget otimizador', `${BUDGET_MS}ms`)}
`)

// ═══════════════════════════════════════════════════════════════
// 1. BASELINE — sem otimizador
// ═══════════════════════════════════════════════════════════════

console.log(hr('═'))
console.log(`${BOLD}  1. BASELINE (sem otimizador)${RESET}`)
console.log(hr())

process.env.ESCALAFLOW_OPTIMIZER_BUDGET_MS = '0'
const t0 = performance.now()
const resultBase = gerarEscalaV3(db, {
  setor_id: SETOR_ID,
  data_inicio: DATA_INICIO,
  data_fim: DATA_FIM,
})
const tBase = performance.now() - t0

if (!resultBase.sucesso) {
  console.error(`${RED}  Motor FALHOU (baseline): ${resultBase.erro?.mensagem}${RESET}`)
  closeDb()
  process.exit(1)
}

const escBase = resultBase.escala!
printEscalaResumo(escBase, tBase, 'BASELINE')

// ═══════════════════════════════════════════════════════════════
// 2. OTIMIZADO — com budget
// ═══════════════════════════════════════════════════════════════

console.log(hr('═'))
console.log(`${BOLD}  2. OTIMIZADO (budget=${BUDGET_MS}ms)${RESET}`)
console.log(hr())

process.env.ESCALAFLOW_OPTIMIZER_BUDGET_MS = String(BUDGET_MS)
const t1 = performance.now()
const resultOtim = gerarEscalaV3(db, {
  setor_id: SETOR_ID,
  data_inicio: DATA_INICIO,
  data_fim: DATA_FIM,
})
const tOtim = performance.now() - t1

if (!resultOtim.sucesso) {
  console.error(`${RED}  Motor FALHOU (otimizado): ${resultOtim.erro?.mensagem}${RESET}`)
  closeDb()
  process.exit(1)
}

const escOtim = resultOtim.escala!
printEscalaResumo(escOtim, tOtim, 'OTIMIZADO')

// ═══════════════════════════════════════════════════════════════
// 3. TELEMETRIA DO OTIMIZADOR
// ═══════════════════════════════════════════════════════════════

if (escOtim.timing) {
  console.log(hr('═'))
  console.log(`${BOLD}  3. TELEMETRIA DO OTIMIZADOR${RESET}`)
  console.log(hr())

  console.log(badge('Tempo otimizacao', `${escOtim.timing.otimizacao_ms?.toFixed(0) ?? '?'}ms`))
  console.log(badge('Moves aceitos', escOtim.timing.otimizacao_moves ?? 0))

  if (escOtim.timing.otimizacao_temperature != null) {
    console.log(badge('Temperatura final', escOtim.timing.otimizacao_temperature.toFixed(4)))
  }
  if (escOtim.timing.otimizacao_stagnation != null) {
    console.log(badge('Eventos stagnation', escOtim.timing.otimizacao_stagnation))
  }

  if (escOtim.timing.otimizacao_neighborhoods) {
    console.log(`\n  ${BOLD}Vizinhancas:${RESET}`)
    const nh = escOtim.timing.otimizacao_neighborhoods
    const names = Object.keys(nh).sort()
    const maxLen = Math.max(...names.map(n => n.length))

    for (const name of names) {
      const stats = nh[name]
      const rate = stats.attempts > 0 ? ((stats.accepted / stats.attempts) * 100).toFixed(1) : '0.0'
      const bar = '█'.repeat(Math.min(20, stats.accepted))
      const padName = name.padEnd(maxLen)
      console.log(`    ${DIM}${padName}${RESET}  ${CYAN}${String(stats.accepted).padStart(3)}${RESET}/${String(stats.attempts).padStart(4)}  ${YELLOW}${rate.padStart(5)}%${RESET}  ${GREEN}${bar}${RESET}`)
    }
  }

  // Timing completo das fases
  console.log(`\n  ${BOLD}Timing fases:${RESET}`)
  const phases = [
    ['Fase 0 (preflight)', escOtim.timing.fase0_ms],
    ['Fase 1 (grid)', escOtim.timing.fase1_ms],
    ['Fase 2 (folgas)', escOtim.timing.fase2_ms],
    ['Fase 3 (horas)', escOtim.timing.fase3_ms],
    ['Fase 4 (horarios)', escOtim.timing.fase4_ms],
    ['Fase 5 (almoco)', escOtim.timing.fase5_ms],
    ['Fase 6 (otimizar)', escOtim.timing.fase6_ms],
    ['Fase 7 (pontuar)', escOtim.timing.fase7_ms],
  ] as [string, number][]

  for (const [label, ms] of phases) {
    const pct = escOtim.timing.total_ms > 0 ? ((ms / escOtim.timing.total_ms) * 100).toFixed(0) : '0'
    const barLen = Math.min(30, Math.round(ms / Math.max(1, escOtim.timing.total_ms) * 30))
    const bar = '▓'.repeat(barLen) + '░'.repeat(30 - barLen)
    console.log(`    ${DIM}${label.padEnd(20)}${RESET} ${CYAN}${ms.toFixed(0).padStart(6)}ms${RESET} ${DIM}${pct.padStart(3)}%${RESET} ${bar}`)
  }
  console.log(`    ${BOLD}${'TOTAL'.padEnd(20)}${RESET} ${BOLD}${escOtim.timing.total_ms.toFixed(0).padStart(6)}ms${RESET}`)
}

// ═══════════════════════════════════════════════════════════════
// 4. COMPARACAO FINAL
// ═══════════════════════════════════════════════════════════════

console.log(hr('═'))
console.log(`${BOLD}  4. COMPARACAO${RESET}`)
console.log(hr())

const deltaScore = escOtim.indicadores.pontuacao - escBase.indicadores.pontuacao
const deltaCob = escOtim.indicadores.cobertura_percent - escBase.indicadores.cobertura_percent
const deltaHard = escOtim.indicadores.violacoes_hard - escBase.indicadores.violacoes_hard

const cmpDeficit = calcDeficit(escOtim) - calcDeficit(escBase)

console.log(`
  ${BOLD}Metrica${RESET}           ${DIM}Baseline${RESET}    ${DIM}Otimizado${RESET}   ${DIM}Delta${RESET}
  ${'─'.repeat(55)}
  Score             ${String(escBase.indicadores.pontuacao).padStart(6)}      ${String(escOtim.indicadores.pontuacao).padStart(6)}      ${colorDelta(deltaScore, true)}
  Cobertura %       ${escBase.indicadores.cobertura_percent.toFixed(1).padStart(6)}      ${escOtim.indicadores.cobertura_percent.toFixed(1).padStart(6)}      ${colorDelta(deltaCob, true)}
  HARD violations   ${String(escBase.indicadores.violacoes_hard).padStart(6)}      ${String(escOtim.indicadores.violacoes_hard).padStart(6)}      ${colorDelta(deltaHard, false)}
  SOFT violations   ${String(escBase.indicadores.violacoes_soft).padStart(6)}      ${String(escOtim.indicadores.violacoes_soft).padStart(6)}      ${colorDelta(escOtim.indicadores.violacoes_soft - escBase.indicadores.violacoes_soft, false)}
  Deficit slots     ${String(calcDeficit(escBase)).padStart(6)}      ${String(calcDeficit(escOtim)).padStart(6)}      ${colorDelta(cmpDeficit, false)}
  Tempo total       ${tBase.toFixed(0).padStart(5)}ms     ${tOtim.toFixed(0).padStart(5)}ms     ${DIM}+${(tOtim - tBase).toFixed(0)}ms${RESET}
`)

// ═══════════════════════════════════════════════════════════════
// 5. VALIDACAO SAFETY NET
// ═══════════════════════════════════════════════════════════════

console.log(hr('═'))
console.log(`${BOLD}  5. SAFETY NET${RESET}`)
console.log(hr())

const checks = [
  { label: 'Baseline HARD = 0', pass: escBase.indicadores.violacoes_hard === 0 },
  { label: 'Otimizado HARD = 0', pass: escOtim.indicadores.violacoes_hard === 0 },
  { label: 'Score nao piorou', pass: escOtim.indicadores.pontuacao >= escBase.indicadores.pontuacao },
  { label: 'Otimizacao_moves > 0', pass: (escOtim.timing?.otimizacao_moves ?? 0) > 0 },
  { label: 'Cobertura nao caiu', pass: escOtim.indicadores.cobertura_percent >= escBase.indicadores.cobertura_percent - 0.1 },
]

let allPassed = true
for (const { label, pass } of checks) {
  console.log(`  ${statusBadge(pass, label)}`)
  if (!pass) allPassed = false
}

console.log()
if (allPassed) {
  console.log(`${GREEN}${BOLD}  ✓ TODOS OS CHECKS PASSARAM${RESET}`)
} else {
  console.log(`${RED}${BOLD}  ✗ ALGUM CHECK FALHOU — INVESTIGAR${RESET}`)
}

// ═══════════════════════════════════════════════════════════════
// 6. AMOSTRA DE ALOCACOES (primeiros 3 dias)
// ═══════════════════════════════════════════════════════════════

console.log()
console.log(hr('═'))
console.log(`${BOLD}  6. AMOSTRA (primeiros 3 dias, otimizado)${RESET}`)
console.log(hr())

const diasUnicos = [...new Set(escOtim.alocacoes.map(a => a.data))].sort().slice(0, 3)
for (const dia of diasUnicos) {
  console.log(`\n  ${BOLD}${dia}${RESET}`)
  const alocsDia = escOtim.alocacoes
    .filter(a => a.data === dia)
    .sort((a, b) => (a.hora_inicio ?? 'ZZ').localeCompare(b.hora_inicio ?? 'ZZ'))

  for (const a of alocsDia) {
    if (a.status === 'TRABALHO') {
      const almoco = a.hora_almoco_inicio ? ` ${DIM}(alm ${a.hora_almoco_inicio}-${a.hora_almoco_fim})${RESET}` : ''
      console.log(`    ${GREEN}▪${RESET} ${a.hora_inicio}-${a.hora_fim} ${DIM}(${a.minutos_trabalho ?? a.minutos}min)${RESET}${almoco}`)
    } else {
      console.log(`    ${DIM}▫ ${a.status}${RESET}`)
    }
  }
}

console.log(`\n${hr('═')}`)

closeDb()
process.exit(allPassed ? 0 : 1)

// ═══════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════

function printEscalaResumo(esc: EscalaCompletaV3, timeMs: number, label: string) {
  const hard = esc.indicadores.violacoes_hard
  const soft = esc.indicadores.violacoes_soft
  const trabalho = esc.alocacoes.filter((a: Alocacao) => a.status === 'TRABALHO').length
  const folga = esc.alocacoes.filter((a: Alocacao) => a.status === 'FOLGA').length

  console.log(badge('Score', esc.indicadores.pontuacao, hard > 0 ? RED : GREEN))
  console.log(badge('Cobertura', `${esc.indicadores.cobertura_percent.toFixed(1)}%`))
  console.log(badge('HARD', hard, hard > 0 ? RED : GREEN))
  console.log(badge('SOFT', soft, soft > 0 ? YELLOW : GREEN))
  console.log(badge('Alocacoes', `${trabalho} trabalho + ${folga} folga`))
  console.log(badge('Antipatterns', esc.antipatterns?.length ?? 0))
  console.log(badge('Tempo total', `${timeMs.toFixed(0)}ms`))

  if (hard > 0) {
    console.log(`\n  ${RED}Violacoes HARD:${RESET}`)
    for (const v of esc.violacoes.filter(v => v.severidade === 'HARD').slice(0, 5)) {
      console.log(`    ${RED}• ${v.regra}:${RESET} ${v.mensagem}`)
    }
  }
}

function calcDeficit(esc: EscalaCompletaV3): number {
  return esc.comparacao_demanda
    .filter(s => s.delta < 0)
    .reduce((acc, s) => acc + Math.abs(s.delta), 0)
}

function colorDelta(delta: number, higherIsBetter: boolean): string {
  const sign = delta > 0 ? '+' : ''
  const formatted = `${sign}${typeof delta === 'number' && !Number.isInteger(delta) ? delta.toFixed(1) : delta}`
  if (delta === 0) return `${DIM}${formatted.padStart(6)}${RESET}`
  const good = higherIsBetter ? delta > 0 : delta < 0
  return `${good ? GREEN : RED}${formatted.padStart(6)}${RESET}`
}
