/**
 * solver-bridge.ts — Bridge entre Node.js (main process) e Python OR-Tools solver
 *
 * Arquitetura: spawn(binário) + stdin(JSON) → stdout(JSON)
 * Python = função pura. TS = orquestrador (DB, persistência, IPC).
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { getDb } from '../db/database'
import type {
  SolverInput,
  SolverOutput,
  SolverInputColab,
  SolverInputDemanda,
  SolverInputHint,
  PinnedCell,
} from '../../shared'

const require = createRequire(import.meta.url)

type RegimeEscalaInput = '5X2' | '6X1'

export interface BuildSolverInputOptions {
  regimesOverride?: Array<{ colaborador_id: number; regime_escala: RegimeEscalaInput }>
  hintsEscalaId?: number
}

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

export function resolveSolverPath(): string {
  const isWin = process.platform === 'win32'
  const binNames = isWin
    ? ['escalaflow-solver.exe', 'escalaflow-solver']
    : ['escalaflow-solver']

  // 1. Built binary (PyInstaller) in project
  for (const name of binNames) {
    const devBin = path.join(process.cwd(), 'solver-bin', name)
    if (existsSync(devBin)) {
      return devBin
    }
  }

  // 2. Dev fallback: run Python directly
  const devPython = path.join(process.cwd(), 'solver', 'solver_ortools.py')
  if (existsSync(devPython)) {
    return devPython
  }

  // 3. Production: packaged with Electron
  try {
    const electron = require('electron') as { app?: { isPackaged?: boolean } }
    if (electron.app?.isPackaged) {
      for (const name of binNames) {
        const prodBin = path.join(process.resourcesPath, 'solver-bin', name)
        if (existsSync(prodBin)) {
          return prodBin
        }
      }
    }
  } catch {
    // not in Electron context
  }

  throw new Error(
    'Solver nao encontrado. Em dev, certifique-se de que solver/solver_ortools.py existe. ' +
    'Em producao, rode solver:build antes de empacotar.'
  )
}

/**
 * Detect whether the solver path is a Python script or a compiled binary.
 */
function isPythonScript(solverPath: string): boolean {
  return solverPath.endsWith('.py')
}

// ---------------------------------------------------------------------------
// Build SolverInput from DB
// ---------------------------------------------------------------------------

export function buildSolverInput(
  setorId: number,
  dataInicio: string,
  dataFim: string,
  pinnedCells?: PinnedCell[],
  options: BuildSolverInputOptions = {},
): SolverInput {
  const db = getDb()
  const overrideByColab = new Map<number, RegimeEscalaInput>(
    (options.regimesOverride ?? []).map((o) => [o.colaborador_id, o.regime_escala]),
  )

  // Empresa
  const emp = db.prepare('SELECT * FROM empresa LIMIT 1').get() as {
    tolerancia_semanal_min: number
    min_intervalo_almoco_min: number
    usa_cct_intervalo_reduzido: number
    grid_minutos: number
  } | undefined

  // Setor
  const setor = db.prepare('SELECT * FROM setores WHERE id = ?').get(setorId) as {
    id: number
    hora_abertura: string
    hora_fechamento: string
    piso_operacional?: number
  } | undefined
  if (!setor) throw new Error(`Setor ${setorId} nao encontrado`)

  // Colaboradores + TipoContrato
  const colabRows = db.prepare(`
    SELECT c.id, c.nome, c.sexo, c.horas_semanais, c.rank, c.prefere_turno, c.evitar_dia_semana,
           c.tipo_trabalhador, c.funcao_id, tc.regime_escala, tc.dias_trabalho, tc.max_minutos_dia, tc.trabalha_domingo
    FROM colaboradores c
    JOIN tipos_contrato tc ON tc.id = c.tipo_contrato_id
    WHERE c.setor_id = ? AND c.ativo = 1
    ORDER BY c.rank DESC
  `).all(setorId) as Array<{
    id: number; nome: string; sexo: string; horas_semanais: number; rank: number;
    prefere_turno: string | null; evitar_dia_semana: string | null;
    tipo_trabalhador: string | null; funcao_id: number | null;
    regime_escala: '5X2' | '6X1' | null;
    dias_trabalho: number; max_minutos_dia: number; trabalha_domingo: number;
  }>

  const colaboradores: SolverInputColab[] = colabRows.map(r => {
    const regimeEfetivo = overrideByColab.get(r.id) ?? r.regime_escala ?? (r.dias_trabalho <= 5 ? '5X2' : '6X1')
    const diasTrabalhoEfetivo = regimeEfetivo === '5X2' ? 5 : 6
    return ({
    id: r.id,
    nome: r.nome,
    horas_semanais: r.horas_semanais,
    regime_escala: regimeEfetivo,
    dias_trabalho: diasTrabalhoEfetivo,
    max_minutos_dia: r.max_minutos_dia,
    trabalha_domingo: Boolean(r.trabalha_domingo),
    tipo_trabalhador: r.tipo_trabalhador || 'CLT',
    sexo: r.sexo,
    funcao_id: r.funcao_id,
    rank: r.rank ?? 0,
    })
  })

  // Demandas
  const demandaRows = db.prepare(`
    SELECT dia_semana, hora_inicio, hora_fim, min_pessoas, override
    FROM demandas
    WHERE setor_id = ?
    ORDER BY dia_semana, hora_inicio
  `).all(setorId) as Array<{
    dia_semana: string | null; hora_inicio: string; hora_fim: string;
    min_pessoas: number; override: number;
  }>

  const demanda: SolverInputDemanda[] = demandaRows.map(r => ({
    dia_semana: r.dia_semana ?? null,
    hora_inicio: r.hora_inicio,
    hora_fim: r.hora_fim,
    min_pessoas: r.min_pessoas,
    override: Boolean(r.override),
  }))

  // Feriados no periodo (inclui cct_autoriza pra H18)
  const feriados = db.prepare(`
    SELECT data, nome, proibido_trabalhar, cct_autoriza
    FROM feriados
    WHERE data BETWEEN ? AND ?
  `).all(dataInicio, dataFim) as Array<{
    data: string; nome: string; proibido_trabalhar: number; cct_autoriza: number;
  }>

  // Excecoes no periodo
  const excecoes = db.prepare(`
    SELECT colaborador_id, data_inicio, data_fim, tipo
    FROM excecoes
    WHERE data_inicio <= ? AND data_fim >= ?
  `).all(dataFim, dataInicio) as Array<{
    colaborador_id: number; data_inicio: string; data_fim: string; tipo: string;
  }>

  // Warm-start hints: reuse last schedule solution for same setor+period.
  const lastScale = options.hintsEscalaId !== undefined
    ? ({ id: options.hintsEscalaId } as { id: number })
    : db.prepare(`
        SELECT id
        FROM escalas
        WHERE setor_id = ? AND data_inicio = ? AND data_fim = ?
        ORDER BY id DESC
        LIMIT 1
      `).get(setorId, dataInicio, dataFim) as { id: number } | undefined

  let hints: SolverInputHint[] | undefined
  if (lastScale) {
    const hintRows = db.prepare(`
      SELECT colaborador_id, data, status, hora_inicio, hora_fim
      FROM alocacoes
      WHERE escala_id = ?
    `).all(lastScale.id) as Array<{
      colaborador_id: number
      data: string
      status: 'TRABALHO' | 'FOLGA' | 'INDISPONIVEL'
      hora_inicio: string | null
      hora_fim: string | null
    }>

    hints = hintRows.map((h) => ({
      colaborador_id: h.colaborador_id,
      data: h.data,
      status: h.status,
      hora_inicio: h.hora_inicio,
      hora_fim: h.hora_fim,
    }))
  }

  return {
    setor_id: setorId,
    data_inicio: dataInicio,
    data_fim: dataFim,
    piso_operacional: Math.max(1, Number(setor.piso_operacional ?? 1)),
    empresa: {
      tolerancia_semanal_min: emp?.tolerancia_semanal_min ?? 30,
      hora_abertura: setor.hora_abertura,
      hora_fechamento: setor.hora_fechamento,
      min_intervalo_almoco_min: emp?.min_intervalo_almoco_min ?? 60,
      max_intervalo_almoco_min: 120,
      grid_minutos: emp?.grid_minutos ?? 30,
    },
    colaboradores,
    demanda,
    feriados: feriados.map(f => ({
      data: f.data,
      nome: f.nome,
      // H17: proibido_trabalhar=1 (25/12, 01/01)
      // H18: cct_autoriza=0 (feriado sem CCT = proibido)
      proibido_trabalhar: Boolean(f.proibido_trabalhar) || !Boolean(f.cct_autoriza),
    })),
    excecoes: excecoes.map(e => ({
      colaborador_id: e.colaborador_id,
      data_inicio: e.data_inicio,
      data_fim: e.data_fim,
      tipo: e.tipo,
    })),
    pinned_cells: pinnedCells ?? [],
    hints,
    config: {
      max_time_seconds: 3600,
      num_workers: 8,
    },
  }
}

export function computeSolverScenarioHash(input: SolverInput): string {
  const norm = {
    setor_id: input.setor_id,
    data_inicio: input.data_inicio,
    data_fim: input.data_fim,
    piso_operacional: input.piso_operacional ?? 1,
    empresa: {
      tolerancia_semanal_min: input.empresa.tolerancia_semanal_min,
      hora_abertura: input.empresa.hora_abertura,
      hora_fechamento: input.empresa.hora_fechamento,
      min_intervalo_almoco_min: input.empresa.min_intervalo_almoco_min,
      max_intervalo_almoco_min: input.empresa.max_intervalo_almoco_min,
      grid_minutos: input.empresa.grid_minutos,
    },
    colaboradores: [...input.colaboradores]
      .map((c) => ({
        id: c.id,
        horas_semanais: c.horas_semanais,
        regime_escala: c.regime_escala ?? (c.dias_trabalho <= 5 ? '5X2' : '6X1'),
        dias_trabalho: c.dias_trabalho,
        max_minutos_dia: c.max_minutos_dia,
        trabalha_domingo: c.trabalha_domingo,
        tipo_trabalhador: c.tipo_trabalhador,
        sexo: c.sexo,
      }))
      .sort((a, b) => a.id - b.id),
    demanda: [...input.demanda]
      .map((d) => ({
        dia_semana: d.dia_semana ?? null,
        hora_inicio: d.hora_inicio,
        hora_fim: d.hora_fim,
        min_pessoas: d.min_pessoas,
        override: Boolean(d.override),
      }))
      .sort((a, b) =>
        `${a.dia_semana ?? 'ALL'}|${a.hora_inicio}|${a.hora_fim}|${a.min_pessoas}|${a.override ? 1 : 0}`.localeCompare(
          `${b.dia_semana ?? 'ALL'}|${b.hora_inicio}|${b.hora_fim}|${b.min_pessoas}|${b.override ? 1 : 0}`,
        ),
      ),
    feriados: [...input.feriados]
      .map((f) => ({ data: f.data, proibido_trabalhar: f.proibido_trabalhar }))
      .sort((a, b) => a.data.localeCompare(b.data)),
    excecoes: [...input.excecoes]
      .map((e) => ({
        colaborador_id: e.colaborador_id,
        data_inicio: e.data_inicio,
        data_fim: e.data_fim,
        tipo: e.tipo,
      }))
      .sort((a, b) =>
        `${a.colaborador_id}|${a.data_inicio}|${a.data_fim}|${a.tipo}`.localeCompare(
          `${b.colaborador_id}|${b.data_inicio}|${b.data_fim}|${b.tipo}`,
        ),
      ),
  }

  return createHash('sha256').update(JSON.stringify(norm)).digest('hex')
}

// ---------------------------------------------------------------------------
// Run solver (with optional stderr streaming callback)
// ---------------------------------------------------------------------------

export function runSolver(
  input: SolverInput,
  timeoutMs = 3_700_000,
  onLog?: (line: string) => void,
): Promise<SolverOutput> {
  return new Promise((resolve, reject) => {
    const solverPath = resolveSolverPath()
    const isPy = isPythonScript(solverPath)

    const cmd = isPy ? 'python3' : solverPath
    const args = isPy ? [solverPath] : []

    let child
    try {
      child = spawn(cmd, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
      })
    } catch (err: any) {
      reject(new Error(`Falha ao iniciar solver: ${err.message}`))
      return
    }

    let stdout = ''
    let stderrBuf = ''
    let settled = false

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true
        child.kill('SIGKILL')
        reject(new Error(
          `Solver excedeu timeout de ${Math.round(timeoutMs / 1000)}s. ` +
          'Tente um periodo menor ou menos colaboradores.'
        ))
      }
    }, timeoutMs)

    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString() })

    child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString()
      stderrBuf += text

      // Stream lines to callback for real-time progress
      if (onLog) {
        const lines = text.split('\n')
        for (const line of lines) {
          const trimmed = line.trim()
          if (trimmed) {
            onLog(trimmed)
          }
        }
      }
    })

    child.on('error', (err) => {
      if (!settled) {
        settled = true
        clearTimeout(timer)
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          reject(new Error(
            `Solver nao encontrado em "${cmd}". ` +
            (isPy ? 'Instale Python 3 e ortools.' : 'Rode solver:build.')
          ))
        } else {
          reject(new Error(`Erro ao executar solver: ${err.message}`))
        }
      }
    })

    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)

      if (stderrBuf.trim()) {
        console.error('[SOLVER stderr]', stderrBuf.trim())
      }

      if (code !== 0 && !stdout.trim()) {
        reject(new Error(
          `Solver saiu com codigo ${code}. ${stderrBuf.trim() || 'Sem detalhes.'}`
        ))
        return
      }

      try {
        const raw = stdout.trim()
        let result: SolverOutput
        try {
          // Fast path: solver returned pure JSON.
          result = JSON.parse(raw)
        } catch {
          // Defensive path: OR-Tools progress logs may appear before final JSON line.
          const lastLine = raw
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean)
            .at(-1)

          if (!lastLine) throw new Error('stdout vazio')
          result = JSON.parse(lastLine)
        }
        resolve(result)
      } catch {
        reject(new Error(
          `Resposta invalida do solver (exit ${code}): ${stdout.substring(0, 200)}`
        ))
      }
    })

    // Send input and close stdin
    const inputJson = JSON.stringify(input)
    child.stdin.write(inputJson)
    child.stdin.end()
  })
}
