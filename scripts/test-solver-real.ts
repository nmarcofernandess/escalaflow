import { buildSolverInput, runSolver } from '../src/main/motor/solver-bridge'
import { getDb, closeDb } from '../src/main/db/database'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')

// Forca o caminho do DB para o ambiente de dev local
process.env.ESCALAFLOW_DB_PATH = process.env.ESCALAFLOW_DB_PATH || path.join(rootDir, 'data', 'escalaflow.db')

async function main() {
    const args = process.argv.slice(2)
    console.log('[test-solver] Iniciando smoke test end-to-end do motor via ponte TypeScript')

    // Parametros padrao
    const setorId = args[0] ? parseInt(args[0], 10) : 1
    let dataInicio = '2026-03-01'
    let dataFim = '2026-03-31'

    if (args[1]) dataInicio = args[1]
    if (args[2]) dataFim = args[2]

    const solveMode: any = 'rapido'
    const rigorLevel: any = 'ALTO'

    console.log(`[test-solver] DB Path: ${process.env.ESCALAFLOW_DB_PATH}`)
    console.log(`[test-solver] Setor: ${setorId} | Periodo: ${dataInicio} a ${dataFim}`)
    console.log(`[test-solver] Mode: ${solveMode} | Rigor: ${rigorLevel}`)

    try {
        // Valida DB connection
        const db = getDb()
        const setorRows = db.prepare('SELECT id, nome FROM setores WHERE id = ?').get(setorId)
        if (!setorRows) {
            console.error(`[test-solver] ERRO: Setor ${setorId} nao encontrado no banco.`)
            process.exit(1)
        }

        // 1. Constroi o Payload Exatamente como o Backend faria
        const t0 = performance.now()
        const payload = buildSolverInput(setorId, dataInicio, dataFim, [], {
            solveMode: solveMode,
            nivelRigor: rigorLevel
        })
        const payloadMs = performance.now() - t0

        console.log(`[test-solver] Payload gerado em ${Math.round(payloadMs)}ms. Colaboradores: ${payload.colaboradores.length}`)

        // 2. Roda o Solver usando o bridge
        const t1 = performance.now()
        console.log('[test-solver] Executando o subprocesso do python...')

        const output = await runSolver(payload, 300000, (line) => {
            // Repassa logs do motor (exibicao do modulo de logs do solver python)
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
            console.log(`Total Turnos: ${(output.indicadores as any).total_turnos || 'N/A'}`)
        }

        if (output.erro) {
            console.log(`\nERRO DO SOLVER: ${output.erro.mensagem}\nDetalhes/Sugestões: ${JSON.stringify((output.erro as any).detalhes || output.erro.sugestoes)}`);
        }

        if (output.sucesso) {
            console.log('\n[test-solver] TESTE PASSOU COM SUCESSO 🎉')
        } else {
            console.warn('\n[test-solver] TESTE FINALIZOU COM TRATAMENTO (Infeasible/Error).')
        }

    } catch (err: any) {
        console.error('\n[test-solver] ERRO FATAL no processo TypeScript:', err.message)
        console.error(err)
        process.exit(1)
    } finally {
        closeDb()
    }
}

main()
