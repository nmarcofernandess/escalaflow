/**
 * solver-bridge.ts — Bridge entre Node.js (main process) e Python OR-Tools solver
 *
 * Arquitetura: spawn(binário) + stdin(JSON) → stdout(JSON)
 * Python = função pura. TS = orquestrador (DB, persistência, IPC).
 */

import { spawn, execFileSync } from 'node:child_process'
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
  SolverInputRegraColaboradorDia,
  SolverInputDemandaExcecaoData,
  PinnedCell,
  DiaSemana,
} from '../../shared'

const require = createRequire(import.meta.url)

type RegimeEscalaInput = '5X2' | '6X1'

export type SolveMode = 'rapido' | 'otimizado'

export interface BuildSolverInputOptions {
  regimesOverride?: Array<{ colaborador_id: number; regime_escala: RegimeEscalaInput }>
  hintsEscalaId?: number
  solveMode?: SolveMode
  nivelRigor?: 'ALTO' | 'MEDIO' | 'BAIXO'
}

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

export function resolveSolverPath(): string {
  const explicitPath = process.env.ESCALAFLOW_SOLVER_PATH?.trim()
  if (explicitPath) {
    if (existsSync(explicitPath)) return explicitPath
    throw new Error(`ESCALAFLOW_SOLVER_PATH aponta para arquivo inexistente: ${explicitPath}`)
  }

  const isWin = process.platform === 'win32'
  const binNames = isWin
    ? ['escalaflow-solver.exe', 'escalaflow-solver']
    : ['escalaflow-solver']

  // Dev source solver (always the freshest code path)
  const devPython = path.join(process.cwd(), 'solver', 'solver_ortools.py')
  const preferBinaryInDev = process.env.ESCALAFLOW_SOLVER_MODE === 'binary'

  // Detect packaged Electron context.
  let isPackaged = false
  try {
    const electron = require('electron') as { app?: { isPackaged?: boolean } }
    isPackaged = Boolean(electron.app?.isPackaged)
  } catch {
    // not in Electron context
  }

  // Default: prefer Python source unless explicitly forced to binary.
  if (!preferBinaryInDev && existsSync(devPython)) {
    return devPython
  }

  // Built binary (PyInstaller) in project (dev fallback / explicit binary mode).
  for (const name of binNames) {
    const devBin = path.join(process.cwd(), 'solver-bin', name)
    if (existsSync(devBin)) {
      return devBin
    }
  }

  // Production: packaged with Electron resources.
  if (isPackaged) {
    for (const name of binNames) {
      const prodBin = path.join(process.resourcesPath, 'solver-bin', name)
      if (existsSync(prodBin)) {
        return prodBin
      }
    }
  }

  // Last fallback: Python source (if binary was unavailable).
  if (existsSync(devPython)) {
    return devPython
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

/**
 * Resolve the best Python 3 command to use for the solver.
 * Avoids virtualenvs without ortools by probing candidates in order.
 * Result is cached after first successful probe.
 */
let _cachedPythonCmd: string | null = null

function resolvePythonCmd(): string {
  if (_cachedPythonCmd) return _cachedPythonCmd

  // 1. Explicit env var always wins
  const explicit = process.env.ESCALAFLOW_PYTHON?.trim()
  if (explicit) {
    _cachedPythonCmd = explicit
    return explicit
  }

  // 2. Probe candidates — prefer well-known system paths over bare `python3`
  //    (bare `python3` might resolve to a virtualenv without ortools)
  const candidates = [
    '/opt/homebrew/bin/python3',
    '/usr/local/bin/python3',
    '/usr/bin/python3',
    'python3',
  ]

  for (const candidate of candidates) {
    // Skip non-existent absolute paths
    if (candidate.startsWith('/') && !existsSync(candidate)) continue

    try {
      execFileSync(candidate, ['-c', 'import ortools'], {
        timeout: 5000,
        stdio: 'ignore',
      })
      _cachedPythonCmd = candidate
      console.log(`[solver-bridge] Python resolvido: ${candidate}`)
      return candidate
    } catch {
      // candidate doesn't have ortools — try next
    }
  }

  // 3. Fallback — will likely fail but gives a clear error message downstream
  console.warn('[solver-bridge] Nenhum Python com ortools encontrado. Usando python3 do PATH.')
  _cachedPythonCmd = 'python3'
  return 'python3'
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

  // v4: Regras de horario por colaborador
  const regraHorarioRows = db.prepare(`
    SELECT r.colaborador_id, r.ativo, r.perfil_horario_id,
           r.inicio_min, r.inicio_max, r.fim_min, r.fim_max,
           r.preferencia_turno_soft, r.domingo_ciclo_trabalho, r.domingo_ciclo_folga,
           r.folga_fixa_dia_semana,
           p.inicio_min AS p_inicio_min, p.inicio_max AS p_inicio_max,
           p.fim_min AS p_fim_min, p.fim_max AS p_fim_max,
           p.preferencia_turno_soft AS p_preferencia_turno_soft
    FROM colaborador_regra_horario r
    LEFT JOIN contrato_perfis_horario p ON p.id = r.perfil_horario_id AND p.ativo = 1
    WHERE r.ativo = 1
      AND r.colaborador_id IN (SELECT id FROM colaboradores WHERE setor_id = ? AND ativo = 1)
  `).all(setorId) as Array<{
    colaborador_id: number; ativo: number; perfil_horario_id: number | null;
    inicio_min: string | null; inicio_max: string | null;
    fim_min: string | null; fim_max: string | null;
    preferencia_turno_soft: string | null;
    domingo_ciclo_trabalho: number; domingo_ciclo_folga: number;
    folga_fixa_dia_semana: string | null;
    p_inicio_min: string | null; p_inicio_max: string | null;
    p_fim_min: string | null; p_fim_max: string | null;
    p_preferencia_turno_soft: string | null;
  }>
  const regraByColab = new Map(regraHorarioRows.map(r => [r.colaborador_id, r]))

  // v4: Excecoes de horario por data
  const excecaoDataRows = db.prepare(`
    SELECT colaborador_id, data, ativo, inicio_min, inicio_max, fim_min, fim_max,
           preferencia_turno_soft, domingo_forcar_folga
    FROM colaborador_regra_horario_excecao_data
    WHERE ativo = 1
      AND data BETWEEN ? AND ?
      AND colaborador_id IN (SELECT id FROM colaboradores WHERE setor_id = ? AND ativo = 1)
  `).all(dataInicio, dataFim, setorId) as Array<{
    colaborador_id: number; data: string; ativo: number;
    inicio_min: string | null; inicio_max: string | null;
    fim_min: string | null; fim_max: string | null;
    preferencia_turno_soft: string | null; domingo_forcar_folga: number;
  }>
  const excecaoDataMap = new Map<string, typeof excecaoDataRows[0]>()
  for (const ed of excecaoDataRows) {
    excecaoDataMap.set(`${ed.colaborador_id}|${ed.data}`, ed)
  }

  // v4: Demanda excecao por data
  const demandaExcecaoRows = db.prepare(`
    SELECT setor_id, data, hora_inicio, hora_fim, min_pessoas, override
    FROM demandas_excecao_data
    WHERE setor_id = ? AND data BETWEEN ? AND ?
  `).all(setorId, dataInicio, dataFim) as Array<{
    setor_id: number; data: string; hora_inicio: string; hora_fim: string;
    min_pessoas: number; override: number;
  }>

  // v4: Build regras_colaborador_dia[] — resolve precedencia por (colab, data)
  const DIAS_SEMANA_MAP: Record<number, DiaSemana> = {
    0: 'SEG', 1: 'TER', 2: 'QUA', 3: 'QUI', 4: 'SEX', 5: 'SAB', 6: 'DOM',
  }

  const regrasColaboradorDia: SolverInputRegraColaboradorDia[] = []
  {
    const start = new Date(dataInicio + 'T00:00:00')
    const end = new Date(dataFim + 'T00:00:00')
    for (const colab of colabRows) {
      const regra = regraByColab.get(colab.id)
      const d = new Date(start)
      while (d <= end) {
        const isoDate = d.toISOString().slice(0, 10)
        const diaSemana = DIAS_SEMANA_MAP[d.getDay() === 0 ? 6 : d.getDay() - 1]

        const excecaoData = excecaoDataMap.get(`${colab.id}|${isoDate}`)

        // Precedencia: excecao_data > regra_colaborador > perfil_contrato > sem regra
        let inicio_min: string | null = null
        let inicio_max: string | null = null
        let fim_min: string | null = null
        let fim_max: string | null = null
        let pref_turno: string | null = null
        let dom_forcar_folga = false
        let folga_fixa = false

        if (excecaoData) {
          inicio_min = excecaoData.inicio_min
          inicio_max = excecaoData.inicio_max
          fim_min = excecaoData.fim_min
          fim_max = excecaoData.fim_max
          pref_turno = excecaoData.preferencia_turno_soft
          dom_forcar_folga = Boolean(excecaoData.domingo_forcar_folga)
        } else if (regra) {
          // Regra individual sobrescreve perfil (campos nao-null)
          inicio_min = regra.inicio_min ?? regra.p_inicio_min
          inicio_max = regra.inicio_max ?? regra.p_inicio_max
          fim_min = regra.fim_min ?? regra.p_fim_min
          fim_max = regra.fim_max ?? regra.p_fim_max
          pref_turno = regra.preferencia_turno_soft ?? regra.p_preferencia_turno_soft
        }

        // Folga fixa: se dia da semana bate
        if (regra?.folga_fixa_dia_semana && regra.folga_fixa_dia_semana === diaSemana) {
          folga_fixa = true
        }

        // Só inclui se tem alguma regra efetiva
        if (inicio_min || inicio_max || fim_min || fim_max || pref_turno || dom_forcar_folga || folga_fixa) {
          regrasColaboradorDia.push({
            colaborador_id: colab.id,
            data: isoDate,
            inicio_min,
            inicio_max,
            fim_min,
            fim_max,
            preferencia_turno_soft: pref_turno,
            domingo_forcar_folga: dom_forcar_folga,
            folga_fixa,
          })
        }

        d.setDate(d.getDate() + 1)
      }
    }
  }

  // Enriquecer colaboradores com dados de regra individual
  for (const c of colaboradores) {
    const regra = regraByColab.get(c.id)
    if (regra) {
      c.domingo_ciclo_trabalho = regra.domingo_ciclo_trabalho
      c.domingo_ciclo_folga = regra.domingo_ciclo_folga
      c.folga_fixa_dia_semana = (regra.folga_fixa_dia_semana as DiaSemana | null) ?? null
    }
  }

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
      // v4: so 25/12 e 01/01 sao hard-blocked (proibido_trabalhar=1 AND cct_autoriza=0)
      // Outros feriados: orientados por demanda (solver so nao aloca se demanda = 0)
      proibido_trabalhar: Boolean(f.proibido_trabalhar) && !Boolean(f.cct_autoriza),
    })),
    excecoes: excecoes.map(e => ({
      colaborador_id: e.colaborador_id,
      data_inicio: e.data_inicio,
      data_fim: e.data_fim,
      tipo: e.tipo,
    })),
    pinned_cells: pinnedCells ?? [],
    hints,
    regras_colaborador_dia: regrasColaboradorDia.length > 0 ? regrasColaboradorDia : undefined,
    demanda_excecao_data: demandaExcecaoRows.length > 0
      ? demandaExcecaoRows.map(r => ({
          setor_id: r.setor_id,
          data: r.data,
          hora_inicio: r.hora_inicio,
          hora_fim: r.hora_fim,
          min_pessoas: r.min_pessoas,
          override: Boolean(r.override),
        }))
      : undefined,
    config: {
      solve_mode: options.solveMode ?? 'rapido',
      num_workers: 8,
      nivel_rigor: options.nivelRigor ?? 'ALTO',
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
        domingo_ciclo_trabalho: c.domingo_ciclo_trabalho ?? 2,
        domingo_ciclo_folga: c.domingo_ciclo_folga ?? 1,
        folga_fixa_dia_semana: c.folga_fixa_dia_semana ?? null,
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
    regras_colaborador_dia: [...(input.regras_colaborador_dia ?? [])]
      .sort((a, b) => `${a.colaborador_id}|${a.data}`.localeCompare(`${b.colaborador_id}|${b.data}`)),
    demanda_excecao_data: [...(input.demanda_excecao_data ?? [])]
      .sort((a, b) => `${a.data}|${a.hora_inicio}`.localeCompare(`${b.data}|${b.hora_inicio}`)),
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

    const cmd = isPy ? resolvePythonCmd() : solverPath
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

    // Prevent uncaught EPIPE if the child dies before we finish writing
    child.stdin.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code !== 'EPIPE') {
        console.error('[solver-bridge] stdin error:', err.message)
      }
      // EPIPE is handled by the 'close' event which fires with a non-zero exit code
    })

    // Send input and close stdin
    const inputJson = JSON.stringify(input)
    child.stdin.write(inputJson)
    child.stdin.end()
  })
}
