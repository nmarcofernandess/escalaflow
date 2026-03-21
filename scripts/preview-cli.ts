#!/usr/bin/env -S npx tsx
/**
 * preview-cli.ts — CLI dev para inspecionar o preview de ciclo Fase 1 de um setor
 *
 * Uso:
 *   npm run preview:cli -- <setor_id>           # preview rico (rich output)
 *   npm run preview:cli -- <setor_id> --json    # JSON do ContextBundle
 *   npm run preview:cli -- <setor_id> --context # briefing markdown da IA
 *   npm run preview:cli -- list                 # lista setores
 *
 * Exemplos:
 *   npm run preview:cli -- 2           # Açougue, preview rico
 *   npm run preview:cli -- 2 --json    # JSON do bundle completo
 *   npm run preview:cli -- 2 --context # markdown injetado na IA
 *   npm run preview:cli -- list        # lista setores disponíveis
 *
 * Requer: app já ter sido rodado ao menos 1x (banco populado em out/data/escalaflow-pg)
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { initDb, closeDb } from '../src/main/db/pglite'
import { createTables } from '../src/main/db/schema'
import { queryOne, queryAll } from '../src/main/db/query'
import { buildContextBundle, renderContextBriefing } from '../src/main/ia/discovery'
import type { IaContexto } from '../src/shared/types'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')

process.env.ESCALAFLOW_DB_PATH =
  process.env.ESCALAFLOW_DB_PATH || path.join(rootDir, 'out', 'data', 'escalaflow-pg')

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
const flags = new Set(args.filter((a) => a.startsWith('--')))
const positional: string[] = args.filter((a) => !a.startsWith('--'))

const isListCmd = positional[0] === 'list'
const setorId = positional[0] ? parseInt(positional[0], 10) : NaN
const jsonOnly = flags.has('--json')
const contextOnly = flags.has('--context')

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pad(s: string, n: number): string {
  return s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length)
}

function barChart(value: number, max: number, width: number): string {
  if (max === 0) return '░'.repeat(width)
  const filled = Math.round((value / max) * width)
  return '█'.repeat(Math.min(filled, width)) + '░'.repeat(Math.max(0, width - filled))
}

function coberturaColor(cobertura: number, demanda: number): string {
  if (demanda === 0) return C.dim
  const pct = cobertura / demanda
  if (pct >= 1.0) return C.green
  if (pct >= 0.75) return C.yellow
  return C.red
}

function coberturaIcon(cobertura: number, demanda: number): string {
  if (demanda === 0) return '·'
  const pct = cobertura / demanda
  if (pct >= 1.0) return '✓'
  if (pct >= 0.75) return '~'
  return '✗'
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  if (isNaN(setorId) && !isListCmd) {
    console.log(`
${C.bold}${C.cyan}EscalaFlow Preview CLI${C.reset}

${C.bold}Uso:${C.reset}
  npm run preview:cli -- <setor_id> [flags]

${C.bold}Flags:${C.reset}
  --json       JSON do ContextBundle completo
  --context    Briefing markdown que a IA recebe

${C.bold}Exemplos:${C.reset}
  npm run preview:cli -- 2           ${C.dim}# Açougue, preview rico${C.reset}
  npm run preview:cli -- 2 --json    ${C.dim}# JSON do bundle${C.reset}
  npm run preview:cli -- 2 --context ${C.dim}# Markdown da IA${C.reset}

${C.bold}Listar setores:${C.reset}
  npm run preview:cli -- list
`)
    process.exit(0)
  }

  // Em JSON/context mode, redireciona console.log para stderr para manter stdout limpo
  const _origLog = console.log
  if (jsonOnly || contextOnly) {
    console.log = (...a: any[]) => console.error(...a)
  }

  await initDb()
  await createTables()

  // Comando especial: listar setores
  if (isListCmd) {
    const setores = await queryAll<{
      id: number
      nome: string
      ativo: boolean
      hora_abertura: string
      hora_fechamento: string
    }>('SELECT id, nome, ativo, hora_abertura, hora_fechamento FROM setores ORDER BY id')

    const colabs = await queryAll<{ setor_id: number; count: number }>(
      'SELECT setor_id, COUNT(*)::int as count FROM colaboradores WHERE ativo = true GROUP BY setor_id',
    )
    const colabMap = new Map(colabs.map((c) => [c.setor_id, c.count]))

    console.log(`\n${C.bold}Setores disponíveis:${C.reset}\n`)
    for (const s of setores) {
      const status = s.ativo ? `${C.green}ATIVO${C.reset}` : `${C.dim}inativo${C.reset}`
      console.log(
        `  ${C.bold}${s.id}${C.reset} — ${s.nome} [${status}] ${s.hora_abertura}-${s.hora_fechamento} (${colabMap.get(s.id) ?? 0} colabs ativos)`,
      )
    }
    console.log()
    await closeDb()
    return
  }

  // Verificar setor existe
  const setor = await queryOne<{
    id: number
    nome: string
    hora_abertura: string
    hora_fechamento: string
  }>(
    'SELECT id, nome, hora_abertura, hora_fechamento FROM setores WHERE id = $1 AND ativo = TRUE LIMIT 1',
    setorId,
  )

  if (!setor) {
    console.error(`${C.red}ERRO: Setor ${setorId} não encontrado ou inativo.${C.reset}`)
    console.log(`Use ${C.cyan}npm run preview:cli -- list${C.reset} para ver setores disponíveis.`)
    await closeDb()
    process.exit(1)
  }

  if (!jsonOnly && !contextOnly) {
    console.log(`\n${C.bold}${C.cyan}╔══════════════════════════════════════════╗${C.reset}`)
    console.log(
      `${C.bold}${C.cyan}║${C.reset}  ${C.bold}EscalaFlow Preview CLI${C.reset}                   ${C.bold}${C.cyan}║${C.reset}`,
    )
    console.log(`${C.bold}${C.cyan}╚══════════════════════════════════════════╝${C.reset}\n`)
    console.log(`  ${C.bold}Setor:${C.reset}   ${setor.nome} (#${setor.id})`)
    console.log(`  ${C.bold}Horário:${C.reset} ${setor.hora_abertura}–${setor.hora_fechamento}`)
    console.log(`  ${C.bold}DB:${C.reset}      ${process.env.ESCALAFLOW_DB_PATH}`)
    console.log()
  }

  // Montar contexto e chamar buildContextBundle
  const contexto: IaContexto = {
    pagina: 'setor_detalhe',
    rota: `/setores/${setorId}`,
    setor_id: setorId,
  }

  const t0 = performance.now()
  const bundle = await buildContextBundle(contexto)
  const buildMs = performance.now() - t0

  if (!bundle) {
    console.error(`${C.red}ERRO: buildContextBundle retornou null para setor ${setorId}.${C.reset}`)
    await closeDb()
    process.exit(1)
  }

  if (!jsonOnly && !contextOnly) {
    console.log(`  ${C.dim}Bundle gerado em ${Math.round(buildMs)}ms${C.reset}\n`)
  }

  // Modo --json: dump do bundle completo
  if (jsonOnly) {
    _origLog(JSON.stringify(bundle, null, 2))
    await closeDb()
    return
  }

  // Modo --context: briefing markdown da IA
  if (contextOnly) {
    const briefing = renderContextBriefing(bundle)
    _origLog(briefing)
    await closeDb()
    return
  }

  // Modo padrão: rich output
  printPreview(bundle, setor.nome, setor.id)

  await closeDb()
}

// ---------------------------------------------------------------------------
// Rich output
// ---------------------------------------------------------------------------

function printPreview(
  bundle: Awaited<ReturnType<typeof buildContextBundle>> & {},
  nomeSetor: string,
  idSetor: number,
) {
  const preview = bundle.setor?.preview

  // ── CABEÇALHO SETOR ──
  console.log(`${C.bold}  ── SETOR ──────────────────────────────────${C.reset}`)
  console.log(`  ${C.bold}${nomeSetor}${C.reset} (#${idSetor})`)

  const numColabs = bundle.setores_lista.find((s) => s.id === idSetor)?.colabs ?? '?'
  console.log(`  Colaboradores ativos: ${C.bold}${numColabs}${C.reset}`)

  if (!preview) {
    console.log(
      `\n  ${C.yellow}⚠ Preview indisponível.${C.reset} O setor pode não ter colaboradores suficientes ou demanda configurada.`,
    )
    printGlobal(bundle)
    return
  }

  // ── CICLO ──
  console.log(`\n${C.bold}  ── CICLO ──────────────────────────────────${C.reset}`)
  console.log(`  Ciclo:              ${C.bold}${C.cyan}${preview.ciclo_semanas} semana(s)${C.reset}`)

  const cobMediaPct = Math.round(preview.cobertura_media * 100)
  const cobColor =
    cobMediaPct >= 100 ? C.green : cobMediaPct >= 75 ? C.yellow : C.red
  console.log(
    `  Cobertura média:    ${cobColor}${cobMediaPct}%${C.reset}  ${barChart(cobMediaPct, 100, 20)}`,
  )
  console.log(
    `  Déficit máximo:     ${preview.deficit_max > 0 ? C.red : C.green}${preview.deficit_max} pessoa(s)${C.reset}`,
  )

  // ── COBERTURA POR DIA ──
  console.log(`\n${C.bold}  ── COBERTURA POR DIA ──────────────────────${C.reset}`)

  const maxDemanda = Math.max(...preview.cobertura_por_dia.map((d) => d.demanda), 1)

  for (const d of preview.cobertura_por_dia) {
    const icon = coberturaIcon(d.cobertura, d.demanda)
    const color = coberturaColor(d.cobertura, d.demanda)
    const pctStr =
      d.demanda > 0 ? `${Math.round((d.cobertura / d.demanda) * 100)}%` : 'N/A'
    const bar = barChart(d.cobertura, maxDemanda, 16)

    console.log(
      `  ${color}${icon}${C.reset} ${pad(d.dia, 3)} │ ${color}${bar}${C.reset} ${pad(String(d.cobertura), 4)} / ${d.demanda} ${C.dim}(${pctStr})${C.reset}`,
    )
  }

  // ── FOLGAS FIXAS ──
  if (preview.ff_distribuicao && Object.keys(preview.ff_distribuicao).length > 0) {
    console.log(`\n${C.bold}  ── FOLGAS FIXAS POR DIA ────────────────────${C.reset}`)
    for (const [dia, qt] of Object.entries(preview.ff_distribuicao)) {
      const bar = barChart(qt as number, numColabs as number || 10, 12)
      console.log(`  ${pad(dia, 3)} │ ${C.blue}${bar}${C.reset} ${qt}`)
    }
  }

  // ── WARNINGS ──
  if (preview.warnings.length > 0) {
    console.log(`\n${C.bold}  ── AVISOS ──────────────────────────────────${C.reset}`)
    for (const w of preview.warnings) {
      console.log(`  ${C.yellow}⚠${C.reset} ${w}`)
    }
  }

  // ── RESUMO GLOBAL ──
  printGlobal(bundle)

  console.log()
}

function printGlobal(bundle: NonNullable<Awaited<ReturnType<typeof buildContextBundle>>>) {
  console.log(`\n${C.bold}  ── RESUMO GLOBAL ───────────────────────────${C.reset}`)
  console.log(`  Setores:     ${bundle.global.setores}`)
  console.log(`  Colaboradores: ${bundle.global.colaboradores}`)
  console.log(
    `  Escalas:     ${bundle.global.rascunhos} rascunho(s) / ${bundle.global.oficiais} oficial(is)`,
  )

  if (bundle.feriados_proximos.length > 0) {
    console.log(`\n  ${C.bold}Feriados próximos (30 dias):${C.reset}`)
    for (const f of bundle.feriados_proximos) {
      const flag = f.proibido ? ` ${C.red}(PROIBIDO TRABALHAR)${C.reset}` : ''
      console.log(`    ${C.dim}${f.data}${C.reset} — ${f.nome}${flag}`)
    }
  }
}

void main().catch((err) => {
  console.error(`${C.red}ERRO FATAL:${C.reset}`, err.message)
  process.exit(1)
})
