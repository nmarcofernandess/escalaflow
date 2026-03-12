import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetMockDbState } from '../../setup/db-test-utils'

const queryMocks = vi.hoisted(() => ({
  queryOne: vi.fn(),
  queryAll: vi.fn(),
  execute: vi.fn(),
  insertReturningId: vi.fn(),
  transaction: vi.fn(),
}))

const solverBridgeMocks = vi.hoisted(() => ({
  buildSolverInput: vi.fn(),
  runSolver: vi.fn(),
  persistirSolverResult: vi.fn(),
  computeSolverScenarioHash: vi.fn(),
}))

const funcoesServiceMocks = vi.hoisted(() => ({
  salvarDetalheFuncao: vi.fn(),
  deletarFuncao: vi.fn(),
}))

vi.mock('../../../src/main/db/query', () => queryMocks)
vi.mock('../../../src/main/motor/solver-bridge', () => solverBridgeMocks)
vi.mock('../../../src/main/funcoes-service', () => funcoesServiceMocks)
vi.mock('../../../src/main/knowledge/search', () => ({
  searchKnowledge: vi.fn().mockResolvedValue([]),
  exploreRelations: vi.fn().mockResolvedValue([]),
}))
vi.mock('../../../src/main/knowledge/ingest', () => ({
  ingestKnowledge: vi.fn().mockResolvedValue({ chunks_count: 0 }),
}))

import { executeTool } from '../../../src/main/ia/tools'

type RegraDef = { codigo: string; nome: string; editavel: boolean; descricao?: string }

function setupOpsMocks(options?: {
  deleteChanges?: number
  regraDefs?: RegraDef[]
  alocacaoExiste?: boolean
  escalaById?: Map<number, { id: number; status: string; violacoes_hard: number }>
}) {
  const deleteChanges = options?.deleteChanges ?? 1
  const regraDefs = new Map((options?.regraDefs ?? []).map(r => [r.codigo, r]))
  const alocacaoExiste = options?.alocacaoExiste ?? true
  const escalaById = options?.escalaById ??
    new Map([[1, { id: 1, status: 'RASCUNHO', violacoes_hard: 0 }]])

  const regraEmpresaUpserts: Array<{ codigo: string; status: string }> = []
  const alocacaoUpdates: Array<{ status: string; escala_id: number; colaborador_id: number; data: string }> = []
  const oficializacoes: number[] = []

  queryMocks.queryOne.mockImplementation(async (sql: string, ...params: unknown[]) => {
    const n = sql.replace(/\s+/g, ' ').trim()

    if (n.includes('SELECT codigo, nome, editavel FROM regra_definicao WHERE codigo')) {
      return regraDefs.get(String(params[0]))
    }

    if (n.includes('SELECT nome, descricao FROM regra_definicao WHERE codigo')) {
      const regra = regraDefs.get(String(params[0]))
      if (!regra?.descricao) return undefined
      return { nome: regra.nome, descricao: regra.descricao }
    }

    if (n.includes('SELECT id FROM alocacoes WHERE escala_id') && n.includes('colaborador_id') && n.includes('data')) {
      return alocacaoExiste ? { id: 99 } : undefined
    }

    if (n.includes('SELECT id, status, violacoes_hard FROM escalas WHERE id')) {
      return escalaById.get(Number(params[0]))
    }

    return undefined
  })

  queryMocks.execute.mockImplementation(async (sql: string, ...params: unknown[]) => {
    const n = sql.replace(/\s+/g, ' ').trim()

    if (n.startsWith('DELETE FROM')) {
      return { changes: deleteChanges }
    }

    if (n.includes('INSERT INTO regra_empresa') || n.includes('ON CONFLICT')) {
      regraEmpresaUpserts.push({ codigo: String(params[0]), status: String(params[1]) })
      return { changes: 1 }
    }

    if (n.includes('UPDATE alocacoes SET status') && n.includes('escala_id') && n.includes('colaborador_id') && n.includes('data')) {
      alocacaoUpdates.push({
        status: String(params[0]),
        escala_id: Number(params[1]),
        colaborador_id: Number(params[2]),
        data: String(params[3]),
      })
      return { changes: 1 }
    }

    if (n.includes("UPDATE escalas SET status = 'OFICIAL'")) {
      const escalaId = Number(params[0])
      oficializacoes.push(escalaId)
      const escala = escalaById.get(escalaId)
      if (escala) escala.status = 'OFICIAL'
      return { changes: 1 }
    }

    return { changes: 1 }
  })

  solverBridgeMocks.buildSolverInput.mockReturnValue({ solver: 'input' })
  solverBridgeMocks.persistirSolverResult.mockResolvedValue(321)
  solverBridgeMocks.runSolver.mockReset()

  return { regraEmpresaUpserts, alocacaoUpdates, oficializacoes }
}

describe('executeTool ferramentas restantes (contrato padronizado)', () => {
  let inspect: ReturnType<typeof setupOpsMocks>

  beforeEach(() => {
    resetMockDbState()
    vi.clearAllMocks()
    inspect = setupOpsMocks({
      regraDefs: [
        { codigo: 'H1', nome: 'Dias consecutivos', editavel: true },
        { codigo: 'X_CUSTOM', nome: 'Regra X', editavel: true, descricao: 'Descricao customizada' },
      ],
    })
    queryMocks.transaction.mockImplementation(async (fn: (db: unknown) => Promise<unknown>) => fn({}))
  })

  afterEach(() => {
    resetMockDbState()
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
    setupOpsMocks({ deleteChanges: 0 })

    const result = await executeTool('deletar', { entidade: 'feriados', id: 999 })

    expect(result.status).toBe('error')
    expect(result.code).toBe('DELETAR_NAO_ENCONTRADO')
    expect(result.erro).toMatch(/Nenhum registro/i)
  })

  it('salvar_posto_setor usa o fluxo semântico oficial de posto', async () => {
    funcoesServiceMocks.salvarDetalheFuncao.mockResolvedValue({
      id: 41,
      setor_id: 7,
      apelido: 'Caixa 1',
      tipo_contrato_id: 3,
      ativo: true,
      ordem: 0,
      cor_hex: null,
    })
    queryMocks.queryOne.mockResolvedValueOnce({
      id: 41,
      setor_id: 7,
      apelido: 'Caixa 1',
      tipo_contrato_id: 3,
      tipo_contrato_nome: 'CLT 44h',
      titular_colaborador_id: 9,
      titular_nome: 'Marina',
    })

    const result = await executeTool('salvar_posto_setor', {
      setor_id: 7,
      apelido: 'Caixa 1',
      tipo_contrato_id: 3,
      titular_colaborador_id: 9,
    })

    expect(funcoesServiceMocks.salvarDetalheFuncao).toHaveBeenCalledWith({
      setor_id: 7,
      apelido: 'Caixa 1',
      tipo_contrato_id: 3,
      titular_colaborador_id: 9,
    })
    expect(result.status).toBe('ok')
    expect(result.operacao).toBe('criado')
    expect(result.posto).toEqual(expect.objectContaining({
      id: 41,
      apelido: 'Caixa 1',
      titular_nome: 'Marina',
    }))
    expect(result.summary).toMatch(/Posto criado/i)
  })

  it('deletar(funcoes) usa regra de negócio em vez de DELETE cru', async () => {
    queryMocks.queryOne.mockResolvedValueOnce({ id: 55, apelido: 'Balcão' })
    funcoesServiceMocks.deletarFuncao.mockResolvedValue(undefined)

    const result = await executeTool('deletar', { entidade: 'funcoes', id: 55 })

    expect(funcoesServiceMocks.deletarFuncao).toHaveBeenCalledWith(55)
    expect(queryMocks.execute).not.toHaveBeenCalledWith(expect.stringContaining('DELETE FROM funcoes'), 55)
    expect(result.status).toBe('ok')
    expect(result.posto_removido).toBe('Balcão')
  })

  it('editar_regra retorna status ok com meta e compat legado', async () => {
    const result = await executeTool('editar_regra', { codigo: 'H1', status: 'SOFT' })

    expect(result.status).toBe('ok')
    expect(result.sucesso).toBe(true)
    expect(result.codigo).toBe('H1')
    expect(result.novo_status).toBe('SOFT')
    expect(result.mensagem).toMatch(/alterada para SOFT/i)
    expect(inspect.regraEmpresaUpserts).toContainEqual({ codigo: 'H1', status: 'SOFT' })
  })

  it('gerar_escala retorna status ok com solver_status separado', async () => {
    solverBridgeMocks.runSolver.mockResolvedValue({
      sucesso: true,
      status: 'OPTIMAL',
      alocacoes: [{ colaborador_id: 1, status: 'TRABALHO', minutos_trabalho: 480 }],
      indicadores: {
        violacoes_hard: 0,
        violacoes_soft: 2,
        cobertura_percent: 98.5,
        pontuacao: 1234,
      },
      diagnostico: { avisos: [] },
      decisoes: [{ colaborador_id: 1, colaborador_nome: 'Teste' }],
      comparacao_demanda: [],
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
    expect(inspect.alocacaoUpdates).toContainEqual({
      status: 'FOLGA',
      escala_id: 1,
      colaborador_id: 2,
      data: '2026-02-03',
    })
  })

  it('oficializar_escala retorna status ok com aviso quando já está oficial', async () => {
    setupOpsMocks({
      escalaById: new Map([[7, { id: 7, status: 'OFICIAL', violacoes_hard: 0 }]]),
    })

    const result = await executeTool('oficializar_escala', { escala_id: 7 })

    expect(result.status).toBe('ok')
    expect(result.sucesso).toBe(true)
    expect(result.ja_estava_oficial).toBe(true)
    expect(result.aviso).toMatch(/já está OFICIAL/i)
    expect(result._meta).toEqual(expect.objectContaining({ noop: true }))
  })

  it('oficializar_escala retorna status error quando há violação hard', async () => {
    setupOpsMocks({
      escalaById: new Map([[8, { id: 8, status: 'RASCUNHO', violacoes_hard: 2 }]]),
    })

    const result = await executeTool('oficializar_escala', { escala_id: 8 })

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
