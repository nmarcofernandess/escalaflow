/**
 * setup.mjs — Bootstrap do ambiente de desenvolvimento do EscalaFlow.
 *
 * Roda automaticamente no `postinstall` (depois de `npm install`) e também
 * pode ser chamado manualmente com `npm run setup`.
 *
 * O que faz (tudo idempotente — re-rodar é seguro e barato):
 *   1. Cria a venv Python (.venv) e instala OR-Tools (solver/requirements.txt).
 *   2. Baixa o modelo de embeddings local (ONNX q8) para o RAG offline.
 *
 * Filosofia: clone → `npm install` → `npm run dev`. Sem passos manuais,
 * sem env var no shell, sem "funciona na minha máquina".
 *
 * Em CI (env CI=1) ou com ESCALAFLOW_SKIP_SETUP=1 não faz nada — o pipeline
 * de release tem o próprio Python/PyInstaller e não precisa de venv nem modelo.
 */

import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const IS_WIN = process.platform === 'win32'

const C = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  green: '\x1b[32m', yellow: '\x1b[33m', red: '\x1b[31m', cyan: '\x1b[36m',
}
const ok = (m) => console.log(`  ${C.green}✓${C.reset} ${m}`)
const warn = (m) => console.log(`  ${C.yellow}⚠${C.reset} ${m}`)
const fail = (m) => console.log(`  ${C.red}✗${C.reset} ${m}`)
const step = (m) => console.log(`\n${C.bold}${C.cyan}▸ ${m}${C.reset}`)

const VENV_DIR = path.join(ROOT, '.venv')
const VENV_PY = IS_WIN
  ? path.join(VENV_DIR, 'Scripts', 'python.exe')
  : path.join(VENV_DIR, 'bin', 'python')
const MODEL_FILE = path.join(
  ROOT, 'models', 'embeddings', 'Xenova', 'multilingual-e5-base', 'onnx', 'model_quantized.onnx',
)

// Estado para o resumo final
const report = { python: 'pendente', model: 'pendente' }

/** Roda um comando silencioso e retorna true se exit 0. */
function quiet(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: 'ignore', ...opts })
  return r.status === 0
}

/** Acha um Python base (>=3.9) para criar a venv. Retorna o comando ou null. */
function findBasePython() {
  const candidates = IS_WIN
    ? ['python', 'py']
    : ['python3.12', 'python3.11', 'python3.10', 'python3.9', 'python3', '/usr/bin/python3', '/opt/homebrew/bin/python3']
  for (const cmd of candidates) {
    if (quiet(cmd, ['-c', 'import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)'])) {
      return cmd
    }
  }
  return null
}

function setupPython() {
  step('Python + OR-Tools (motor de escalas)')

  // Já pronto? venv existe e importa ortools.
  if (existsSync(VENV_PY) && quiet(VENV_PY, ['-c', 'import ortools'])) {
    ok('venv .venv já configurada com OR-Tools')
    report.python = 'ok'
    return
  }

  const basePy = findBasePython()
  if (!basePy) {
    fail('Nenhum Python 3.9+ encontrado no sistema.')
    console.log(`    ${C.dim}Instale o Python 3 (recomendado 3.12) e rode 'npm run setup' de novo.${C.reset}`)
    console.log(`    ${C.dim}macOS: 'brew install python@3.12'  •  https://www.python.org/downloads/${C.reset}`)
    report.python = 'faltando-python'
    return
  }

  if (!existsSync(VENV_PY)) {
    console.log(`  ${C.dim}Criando venv com ${basePy}...${C.reset}`)
    if (!quiet(basePy, ['-m', 'venv', VENV_DIR])) {
      fail('Falha ao criar a venv. Verifique o módulo venv do Python.')
      report.python = 'falha-venv'
      return
    }
  }

  console.log(`  ${C.dim}Instalando OR-Tools (pode levar ~1 min)...${C.reset}`)
  quiet(VENV_PY, ['-m', 'pip', 'install', '--upgrade', 'pip', '--quiet'])
  const pip = spawnSync(VENV_PY, ['-m', 'pip', 'install', '-r', path.join('solver', 'requirements.txt'), '--quiet'], {
    cwd: ROOT, stdio: 'inherit',
  })
  if (pip.status !== 0) {
    fail('pip install falhou (rede? versão de Python?).')
    report.python = 'falha-pip'
    return
  }

  if (quiet(VENV_PY, ['-c', 'import ortools'])) {
    ok('venv .venv criada e OR-Tools instalado')
    report.python = 'ok'
  } else {
    fail('OR-Tools não importável após instalação.')
    report.python = 'falha-import'
  }
}

function setupModel() {
  step('Modelo de embeddings (busca semântica / IA offline)')

  if (existsSync(MODEL_FILE)) {
    ok('modelo ONNX já presente em models/embeddings')
    report.model = 'ok'
    return
  }

  console.log(`  ${C.dim}Baixando ~280MB do HuggingFace (uma vez só)...${C.reset}`)
  // tsx PURO (node), nunca via electron — ELECTRON_RUN_AS_NODE + onnxruntime
  // crasha no teardown e gera o popup "Electron encerrou inesperadamente".
  const tsx = path.join(ROOT, 'node_modules', '.bin', IS_WIN ? 'tsx.cmd' : 'tsx')
  const dl = spawnSync(tsx, [path.join('scripts', 'download-embedding-model.ts')], {
    cwd: ROOT, stdio: 'inherit',
  })
  if (dl.status === 0 && existsSync(MODEL_FILE)) {
    ok('modelo baixado e validado')
    report.model = 'ok'
  } else {
    warn('download do modelo não concluiu. O app funciona, mas a busca semântica fica degradada (só FTS).')
    console.log(`    ${C.dim}Rode 'npm run setup' de novo quando tiver internet estável.${C.reset}`)
    report.model = 'pendente'
  }
}

function summary() {
  const label = (s) => s === 'ok'
    ? `${C.green}pronto${C.reset}`
    : s === 'pendente'
      ? `${C.yellow}pendente${C.reset}`
      : `${C.red}${s}${C.reset}`
  console.log(`\n${C.bold}── Setup EscalaFlow ──${C.reset}`)
  console.log(`  Motor (Python/OR-Tools): ${label(report.python)}`)
  console.log(`  Embeddings (RAG):        ${label(report.model)}`)
  if (report.python === 'ok') {
    console.log(`\n  ${C.green}Tudo pronto.${C.reset} Rode ${C.bold}npm run dev${C.reset} para abrir o app.`)
  } else {
    console.log(`\n  ${C.yellow}Motor ainda não está pronto${C.reset} — veja as instruções acima e rode ${C.bold}npm run setup${C.reset}.`)
  }
  console.log('')
}

function main() {
  if (process.env.CI || process.env.ESCALAFLOW_SKIP_SETUP) {
    console.log('[setup] CI/skip detectado — pulando bootstrap de ambiente.')
    return
  }
  console.log(`${C.bold}EscalaFlow · configurando ambiente de desenvolvimento${C.reset}`)
  try {
    setupPython()
  } catch (err) {
    fail(`Erro inesperado no setup do Python: ${err.message}`)
    report.python = 'erro'
  }
  try {
    setupModel()
  } catch (err) {
    warn(`Erro inesperado no download do modelo: ${err.message}`)
    report.model = 'erro'
  }
  summary()
  // Nunca falha o `npm install`: bootstrap é best-effort, o resumo diz o que falta.
}

main()
