#!/usr/bin/env -S npx tsx
/**
 * seed2-cli.ts — Carrega o dataset 2 (dados reais da planilha da Gracinha)
 *
 * Uso:
 *   npm run db:seed2              # carrega seed2 no banco existente
 *   npm run db:seed2 -- --reset   # reseta banco + carrega seed2
 *   npm run db:seed2 -- --dry     # mostra o que faria sem executar
 *
 * Requer: JSONs extraidos em data/seed2/ (rodar extract-xlsx-seed2.py antes)
 */

import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { initDb, closeDb } from '../src/main/db/pglite'
import { createTables } from '../src/main/db/schema'
import { seedCoreData } from '../src/main/db/seed'
import { seedDataset2 } from '../src/main/db/seed2'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')

const args = process.argv.slice(2)
const doReset = args.includes('--reset')
const dryRun = args.includes('--dry')

const dbPath = process.env.ESCALAFLOW_DB_PATH || path.join(rootDir, 'out', 'data', 'escalaflow-pg')
process.env.ESCALAFLOW_DB_PATH = dbPath

const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  red: '\x1b[31m',
}

async function main(): Promise<void> {
  console.log(`${C.cyan}${C.bold}╔══════════════════════════════════════╗${C.reset}`)
  console.log(`${C.cyan}${C.bold}║  SEED2 — Dataset Real Fernandes     ║${C.reset}`)
  console.log(`${C.cyan}${C.bold}╚══════════════════════════════════════╝${C.reset}`)
  console.log()

  // Check JSONs exist
  const seed2Dir = path.join(rootDir, 'data', 'seed2')
  if (!fs.existsSync(seed2Dir)) {
    console.error(`${C.red}[ERRO] Diretorio data/seed2/ nao encontrado.${C.reset}`)
    console.error('Execute primeiro: python3 scripts/extract-xlsx-seed2.py')
    process.exit(1)
  }

  const jsonFiles = fs.readdirSync(seed2Dir).filter(f => f.endsWith('.json'))
  console.log(`${C.green}[OK]${C.reset} ${jsonFiles.length} JSONs encontrados em data/seed2/`)

  if (dryRun) {
    console.log()
    console.log(`${C.yellow}[DRY RUN]${C.reset} Nenhuma alteracao feita no banco.`)
    console.log('Arquivos que seriam processados:')
    for (const f of jsonFiles.sort()) {
      console.log(`  - ${f}`)
    }
    process.exit(0)
  }

  // Reset if requested
  if (doReset) {
    console.log(`${C.yellow}[RESET]${C.reset} Apagando banco em: ${dbPath}`)
    if (fs.existsSync(dbPath)) {
      fs.rmSync(dbPath, { recursive: true, force: true })
    }
    console.log(`${C.green}[OK]${C.reset} Banco apagado`)
  }

  // Init DB
  console.log(`${C.cyan}[DB]${C.reset} Inicializando PGlite em: ${dbPath}`)
  await initDb()

  // Schema
  console.log(`${C.cyan}[SCHEMA]${C.reset} Criando/migrando tabelas...`)
  await createTables()

  // Core seed (contratos, feriados, regras)
  console.log(`${C.cyan}[CORE]${C.reset} Seed de sistema (contratos, feriados, regras)...`)
  await seedCoreData()

  // Dataset 2
  console.log()
  console.log(`${C.cyan}[SEED2]${C.reset} Carregando dataset real Fernandes...`)
  await seedDataset2()

  // Summary
  console.log()
  console.log(`${C.green}${C.bold}═══ RESUMO ═══${C.reset}`)

  const { queryAll } = await import('../src/main/db/query')
  const setores = await queryAll<{ id: number; nome: string }>('SELECT id, nome FROM setores ORDER BY id')
  for (const s of setores) {
    const colabs = await queryAll<{ nome: string; horas_semanais: number }>(
      'SELECT nome, horas_semanais FROM colaboradores WHERE setor_id = $1 AND ativo = true ORDER BY rank',
      s.id,
    )
    const demCount = await queryAll<{ count: number }>(
      'SELECT COUNT(*)::int as count FROM demandas WHERE setor_id = $1',
      s.id,
    )
    console.log(`  ${C.bold}${s.nome}${C.reset} (id=${s.id}): ${colabs.length} colab(s), ${demCount[0]?.count ?? 0} segmentos demanda`)
    for (const c of colabs) {
      console.log(`    - ${c.nome} (${c.horas_semanais}h/sem)`)
    }
  }

  console.log()
  console.log(`${C.green}${C.bold}[DONE]${C.reset} Seed2 carregado com sucesso!`)
  console.log(`${C.cyan}Periodo sugerido para teste:${C.reset} 2026-03-02 a 2026-04-26`)
  console.log(`${C.cyan}Comandos uteis:${C.reset}`)
  console.log(`  npm run solver:cli -- list`)
  console.log(`  npm run solver:cli -- 1 2026-03-02 2026-03-08`)

  await closeDb()
}

main().catch(err => {
  console.error(`${C.red}[FATAL]${C.reset}`, err)
  process.exit(1)
})
