import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildSolverInput, runSolver } from '../src/main/motor/solver-bridge'
import { initDb, closeDb } from '../src/main/db/pglite'
import { createTables } from '../src/main/db/schema'
import { queryOne } from '../src/main/db/query'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')

// DB real usado em dev pelo app Electron.
process.env.ESCALAFLOW_DB_PATH = process.env.ESCALAFLOW_DB_PATH || path.join(rootDir, 'out', 'data', 'escalaflow-pg')

async function main() {
  const args = process.argv.slice(2)
  console.log('[test-solver] Iniciando smoke test end-to-end do motor via bridge TypeScript')

  const setorId = args[0] ? parseInt(args[0], 10) : 1
  const dataInicio = args[1] ?? '2026-03-02'
  const dataFim = args[2] ?? '2026-04-26'
  const solveMode: 'rapido' | 'otimizado' = 'rapido'
  const rigorLevel: 'ALTO' | 'MEDIO' | 'BAIXO' = 'ALTO'

  console.log(`[test-solver] DB Path: ${process.env.ESCALAFLOW_DB_PATH}`)
  console.log(`[test-solver] Setor: ${setorId} | Periodo: ${dataInicio} a ${dataFim}`)
  console.log(`[test-solver] Mode: ${solveMode} | Rigor: ${rigorLevel}`)

  try {
    await initDb()
    await createTables()

    const setor = await queryOne<{ id: number; nome: string }>(
      'SELECT id, nome FROM setores WHERE id = $1 AND ativo = TRUE LIMIT 1',
      setorId,
    )
    if (!setor) {
      console.error(`[test-solver] ERRO: Setor ${setorId} nao encontrado/ativo no banco.`)
      process.exit(1)
    }

    const t0 = performance.now()
    const payload = await buildSolverInput(setorId, dataInicio, dataFim, [], {
      solveMode,
      nivelRigor: rigorLevel,
    })
    const payloadMs = performance.now() - t0

    console.log(
      `[test-solver] Payload gerado em ${Math.round(payloadMs)}ms. ` +
      `Colaboradores: ${payload.colaboradores.length} | Demandas: ${payload.demanda.length}`,
    )

    if (process.env.SOLVER_DUMP_INPUT === '1') {
      const dumpPath = path.join(rootDir, 'tmp', `solver-input-setor-${setorId}.json`)
      fs.mkdirSync(path.dirname(dumpPath), { recursive: true })
      fs.writeFileSync(dumpPath, JSON.stringify(payload, null, 2), 'utf-8')
      console.log(`[test-solver] Input salvo em: ${dumpPath}`)
    }

    const t1 = performance.now()
    console.log('[test-solver] Executando subprocesso Python...')

    const output = await runSolver(payload, 300_000, (line) => {
      console.log(`[motor] ${line}`)
    })

    const solveMs = performance.now() - t1

    console.log('\n[test-solver] === RESULTADO ===')
    console.log(`Status: ${output.status}`)
    console.log(`Sucesso: ${output.sucesso}`)
    console.log(`Solve Time Interno: ${output.solve_time_ms}ms`)
    console.log(`Tempo Total JS: ${Math.round(solveMs)}ms`)

    if (output.indicadores) {
      console.log(`Cobertura: ${output.indicadores.cobertura_percent}%`)
      console.log(`Pontuacao: ${output.indicadores.pontuacao}`)
    }

    if (output.erro) {
      console.log(
        `\nERRO DO SOLVER: ${output.erro.mensagem}` +
        `\nSugestoes: ${JSON.stringify(output.erro.sugestoes ?? [])}`,
      )
    }

    if (output.sucesso && output.alocacoes) {
      console.log('\n[test-solver] TESTE PASSOU COM SUCESSO')
      const previewData = payload.colaboradores.map((col) => {
        const turnos = output.alocacoes!
          .filter((e) => e.colaborador_id === col.id)
          .map((t) => `${t.data.slice(8, 10)}: ${t.status === 'FOLGA' ? 'FOLGA' : `${t.hora_inicio}-${t.hora_fim}`}`)
          .join(', ')
        return {
          ID: col.id,
          Nome: col.nome,
          Turnos: turnos.substring(0, 80) + (turnos.length > 80 ? '...' : ''),
        }
      })
      console.table(previewData)
    } else if (output.sucesso) {
      console.log('\n[test-solver] TESTE PASSOU (sem alocacoes no output)')
    } else {
      console.warn('\n[test-solver] TESTE FINALIZOU COM INFEASIBLE/ERROR')
    }
  } catch (err: any) {
    console.error('\n[test-solver] ERRO FATAL no processo TypeScript:', err.message)
    console.error(err)
    process.exit(1)
  } finally {
    await closeDb()
  }
}

void main()
