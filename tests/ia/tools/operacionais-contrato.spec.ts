import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearMockDb, setMockDb } from '../../setup/db-test-utils'

const solverBridgeMocks = vi.hoisted(() => ({
  buildSolverInput: vi.fn(),
  runSolver: vi.fn(),
  persistirSolverResult: vi.fn(),
}))

vi.mock('../../../src/main/motor/solver-bridge', () => ({
  buildSolverInput: solverBridgeMocks.buildSolverInput,
  runSolver: solverBridgeMocks.runSolver,
  persistirSolverResult: solverBridgeMocks.persistirSolverResult,
}))

import { executeTool } from '../../../src/main/ia/tools'

type RegraDef = { codigo: string; nome: string; editavel: number; descricao?: string }
type EscalaRow = { id: number; status: string; violacoes_hard: number }

function createOpsMockDb(options?: {
  deleteChanges?: number
  regraDefs?: RegraDef[]
  alocacaoExiste?: boolean
  escalaById?: EscalaRow[]
  resumoCounts?: {
    colaboradores_ativos: number
    setores_ativos: number
    escalas_rascunho: number
    escalas_oficiais: number
    regras_customizadas_pela_empresa: number
  }
}) {
  const state = {
    deleteChanges: options?.deleteChanges ?? 1,
    regraDefs: new Map<string, RegraDef>((options?.regraDefs ?? []).map((r) => [r.codigo, r])),
    alocacaoExiste: options?.alocacaoExiste ?? true,
    escalaById: new Map<number, EscalaRow>((options?.escalaById ?? [{ id: 1, status: 'RASCUNHO', violacoes_hard: 0 }]).map((e) => [e.id, e])),
    resumoCounts: options?.resumoCounts ?? {
      colaboradores_ativos: 12,
      setores_ativos: 3,
      escalas_rascunho: 2,
      escalas_oficiais: 5,
      regras_customizadas_pela_empresa: 7,
    },
    regraEmpresaUpserts: [] as Array<{ codigo: string; status: string }>,
    alocacaoUpdates: [] as Array<{ status: string; escala_id: number; colaborador_id: number; data: string }>,
    oficializacoes: [] as number[],
  }

  return {
    prepare(sql: string) {
      const normalized = sql.replace(/\s+/g, ' ').trim()

      return {
        get: (...args: any[]) => {
          if (normalized.startsWith('SELECT codigo, nome, editavel FROM regra_definicao WHERE codigo = ?')) {
            return state.regraDefs.get(String(args[0]))
          }

          if (normalized.startsWith('SELECT nome, descricao FROM regra_definicao WHERE codigo = ?')) {
            const regra = state.regraDefs.get(String(args[0]))
            if (!regra || !regra.descricao) return undefined
            return { nome: regra.nome, descricao: regra.descricao }
          }

          if (normalized.startsWith('SELECT id FROM alocacoes WHERE escala_id = ? AND colaborador_id = ? AND data = ?')) {
            return state.alocacaoExiste ? { id: 99 } : undefined
          }

          if (normalized.startsWith('SELECT id, status, violacoes_hard FROM escalas WHERE id = ?')) {
            return state.escalaById.get(Number(args[0]))
          }

          if (normalized === 'SELECT count(*) as c FROM colaboradores WHERE ativo = 1') {
            return { c: state.resumoCounts.colaboradores_ativos }
          }
          if (normalized === 'SELECT count(*) as c FROM setores WHERE ativo = 1') {
            return { c: state.resumoCounts.setores_ativos }
          }
          if (normalized === "SELECT count(*) as c FROM escalas WHERE status = 'RASCUNHO'") {
            return { c: state.resumoCounts.escalas_rascunho }
          }
          if (normalized === "SELECT count(*) as c FROM escalas WHERE status = 'OFICIAL'") {
            return { c: state.resumoCounts.escalas_oficiais }
          }
          if (normalized === 'SELECT count(*) as c FROM regra_empresa') {
            return { c: state.resumoCounts.regras_customizadas_pela_empresa }
          }

          throw new Error(`Mock get() não suportado: ${normalized}`)
        },
        all: (..._args: any[]) => {
          throw new Error(`Mock all() não suportado: ${normalized}`)
        },
        run: (...args: any[]) => {
          if (normalized.startsWith('DELETE FROM ')) {
            return { changes: state.deleteChanges }
          }

          if (normalized.startsWith('INSERT OR REPLACE INTO regra_empresa')) {
            state.regraEmpresaUpserts.push({ codigo: String(args[0]), status: String(args[1]) })
            return { changes: 1 }
          }

          if (normalized.startsWith('UPDATE alocacoes SET status = ? WHERE escala_id = ? AND colaborador_id = ? AND data = ?')) {
            state.alocacaoUpdates.push({
              status: String(args[0]),
              escala_id: Number(args[1]),
              colaborador_id: Number(args[2]),
              data: String(args[3]),
            })
            return { changes: 1 }
          }

          if (normalized.startsWith("UPDATE escalas SET status = 'OFICIAL' WHERE id = ?")) {
            const escalaId = Number(args[0])
            state.oficializacoes.push(escalaId)
            const escala = state.escalaById.get(escalaId)
            if (escala) {
              escala.status = 'OFICIAL'
            }
            return { changes: 1 }
          }

          throw new Error(`Mock run() não suportado: ${normalized}`)
        },
      }
    },
    close() {},
    __inspect: state,
  }
}

describe('executeTool ferramentas restantes (contrato padronizado)', () => {
  let db: ReturnType<typeof createOpsMockDb>

  beforeEach(() => {
    db = createOpsMockDb({
      regraDefs: [
        { codigo: 'H1', nome: 'Dias consecutivos', editavel: 1 },
        { codigo: 'X_CUSTOM', nome: 'Regra X', editavel: 1, descricao: 'Descricao customizada' },
      ],
    })
    setMockDb(db)
    solverBridgeMocks.buildSolverInput.mockReturnValue({ solver: 'input' })
    solverBridgeMocks.persistirSolverResult.mockReturnValue(321)
    solverBridgeMocks.runSolver.mockReset()
  })

  afterEach(() => {
    clearMockDb()
    vi.clearAllMocks()
    db.close()
  })

  it('deletar retorna status ok + compat legado em sucesso', async () => {
    const result = await executeTool('deletar', { entidade: 'feriados', id: 9 })

    expect(result.status).toBe('ok')
    expect(result.sucesso).toBe(true)
    expect(result.entidade).toBe('feriados')
    expect(result.id).toBe(9)
    expect(result.changes).toBe(1)
    expect(result.summary).toMatch(/deletado com sucesso/i)
    expect(result._meta).toEqual(
      expect.objectContaining({
        tool_kind: 'action',
        action: 'delete',
        entidade: 'feriados',
        id: 9,
      }),
    )
  })

  it('deletar retorna status error quando id não existe', async () => {
    const missingDb = createOpsMockDb({ deleteChanges: 0 })
    setMockDb(missingDb)

    const result = await executeTool('deletar', { entidade: 'feriados', id: 999 })

    missingDb.close()
    setMockDb(db)

    expect(result.status).toBe('error')
    expect(result.code).toBe('DELETAR_NAO_ENCONTRADO')
    expect(result.erro).toMatch(/Nenhum registro/i)
  })

  it('editar_regra retorna status ok com meta e compat legado', async () => {
    const result = await executeTool('editar_regra', { codigo: 'H1', status: 'SOFT' })

    expect(result.status).toBe('ok')
    expect(result.sucesso).toBe(true)
    expect(result.codigo).toBe('H1')
    expect(result.novo_status).toBe('SOFT')
    expect(result.mensagem).toMatch(/alterada para SOFT/i)
    expect(db.__inspect.regraEmpresaUpserts).toContainEqual({ codigo: 'H1', status: 'SOFT' })
  })

  it('gerar_escala retorna status ok com solver_status separado', async () => {
    solverBridgeMocks.runSolver.mockResolvedValue({
      sucesso: true,
      status: 'OPTIMAL',
      alocacoes: [{ colaborador_id: 1 }],
      indicadores: {
        violacoes_hard: 0,
        violacoes_soft: 2,
        cobertura_percent: 98.5,
        pontuacao: 1234,
      },
      diagnostico: { avisos: [] },
    })

    const result = await executeTool('gerar_escala', {
      setor_id: 1,
      data_inicio: '2026-02-01',
      data_fim: '2026-02-07',
    })

    expect(result.status).toBe('ok')
    expect(result.sucesso).toBe(true)
    expect(result.escala_id).toBe(321)
    expect(result.solver_status).toBe('OPTIMAL')
    expect(result.summary).toMatch(/Escala 321 gerada/i)
    expect(result._meta).toEqual(
      expect.objectContaining({
        tool_kind: 'action',
        action: 'generate-schedule',
        solver_status: 'OPTIMAL',
      }),
    )
  })

  it('gerar_escala retorna status error quando solver falha', async () => {
    solverBridgeMocks.runSolver.mockResolvedValue({
      sucesso: false,
      status: 'INFEASIBLE',
      diagnostico: { causa: 'sem cobertura' },
      erro: { mensagem: 'Sem cobertura suficiente' },
    })

    const result = await executeTool('gerar_escala', {
      setor_id: 1,
      data_inicio: '2026-02-01',
      data_fim: '2026-02-07',
    })

    expect(result.status).toBe('error')
    expect(result.code).toBe('GERAR_ESCALA_SOLVER_FALHOU')
    expect(result.sucesso).toBe(false)
    expect(result.solver_status).toBe('INFEASIBLE')
    expect(result.erro).toMatch(/cobertura/i)
  })

  it('ajustar_alocacao retorna status ok + novo_status', async () => {
    const result = await executeTool('ajustar_alocacao', {
      escala_id: 1,
      colaborador_id: 2,
      data: '2026-02-03',
      status: 'FOLGA',
    })

    expect(result.status).toBe('ok')
    expect(result.sucesso).toBe(true)
    expect(result.novo_status).toBe('FOLGA')
    expect(result.summary).toMatch(/Alocação ajustada/i)
    expect(db.__inspect.alocacaoUpdates).toContainEqual({
      status: 'FOLGA',
      escala_id: 1,
      colaborador_id: 2,
      data: '2026-02-03',
    })
  })

  it('oficializar_escala retorna status ok com aviso quando já está oficial', async () => {
    const officialDb = createOpsMockDb({
      escalaById: [{ id: 7, status: 'OFICIAL', violacoes_hard: 0 }],
    })
    setMockDb(officialDb)

    const result = await executeTool('oficializar_escala', { escala_id: 7 })

    officialDb.close()
    setMockDb(db)

    expect(result.status).toBe('ok')
    expect(result.sucesso).toBe(true)
    expect(result.ja_estava_oficial).toBe(true)
    expect(result.aviso).toMatch(/já está OFICIAL/i)
    expect(result._meta).toEqual(expect.objectContaining({ noop: true }))
  })

  it('oficializar_escala retorna status error quando há violação hard', async () => {
    const hardDb = createOpsMockDb({
      escalaById: [{ id: 8, status: 'RASCUNHO', violacoes_hard: 2 }],
    })
    setMockDb(hardDb)

    const result = await executeTool('oficializar_escala', { escala_id: 8 })

    hardDb.close()
    setMockDb(db)

    expect(result.status).toBe('error')
    expect(result.code).toBe('OFICIALIZAR_ESCALA_COM_VIOLACAO_HARD')
    expect(result.violacoes_hard).toBe(2)
  })

  it('resumo_sistema deprecated não é mais executável (UNKNOWN_TOOL)', async () => {
    const result = await executeTool('resumo_sistema', {})

    expect(result.status).toBe('error')
    expect(result.code).toBe('UNKNOWN_TOOL')
    expect(result.erro).toMatch(/não reconhecida/i)
  })

  it('explicar_violacao retorna status ok com fallback em regra_definicao', async () => {
    const result = await executeTool('explicar_violacao', { codigo_regra: 'X_CUSTOM' })

    expect(result.status).toBe('ok')
    expect(result.codigo).toBe('X_CUSTOM')
    expect(result.explicacao).toMatch(/Descricao customizada/i)
    expect(result._meta).toEqual(
      expect.objectContaining({
        tool_kind: 'reference',
        source: 'regra_definicao',
        encontrada: true,
      }),
    )
  })
})
