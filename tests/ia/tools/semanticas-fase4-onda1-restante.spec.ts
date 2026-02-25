import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetMockDbState } from '../../setup/db-test-utils'

const queryMocks = vi.hoisted(() => ({
  queryOne: vi.fn(),
  queryAll: vi.fn(),
  execute: vi.fn(),
  insertReturningId: vi.fn(),
}))

const solverBridgeMocks = vi.hoisted(() => ({
  buildSolverInput: vi.fn(),
  runSolver: vi.fn(),
  persistirSolverResult: vi.fn(),
  computeSolverScenarioHash: vi.fn(),
}))

const validadorMocks = vi.hoisted(() => ({
  validarEscalaV3: vi.fn(),
}))

vi.mock('../../../src/main/db/query', () => queryMocks)
vi.mock('../../../src/main/motor/solver-bridge', () => solverBridgeMocks)
vi.mock('../../../src/main/motor/validador', () => validadorMocks)
vi.mock('../../../src/main/knowledge/search', () => ({
  searchKnowledge: vi.fn().mockResolvedValue([]),
  exploreRelations: vi.fn().mockResolvedValue([]),
}))
vi.mock('../../../src/main/knowledge/ingest', () => ({
  ingestKnowledge: vi.fn().mockResolvedValue({ chunks_count: 0 }),
}))

import { executeTool } from '../../../src/main/ia/tools'

type Row = Record<string, any>

function setupOnda1Mocks(state: {
  setores?: Row[]
  colaboradores?: Row[]
  demandas?: Row[]
  feriados?: Row[]
  colaborador_regra_horario?: Row[]
  alocacoes?: Row[]
  escalas?: Row[]
}) {
  const setores = state.setores ?? []
  const colabs = state.colaboradores ?? []
  const demandas = state.demandas ?? []
  const feriados = state.feriados ?? []
  const regras = state.colaborador_regra_horario ?? []
  const alocacoes = state.alocacoes ?? []
  const escalas = state.escalas ?? []

  let regraIdCounter = 1

  queryMocks.queryOne.mockImplementation(async (sql: string, ...params: unknown[]) => {
    const n = sql.replace(/\s+/g, ' ').trim()

    // preflight: setor exists
    if (n.includes('SELECT id, ativo FROM setores WHERE id')) {
      const setor = setores.find(s => Number(s.id) === Number(params[0]))
      return setor ? { id: setor.id, ativo: setor.ativo ?? true } : undefined
    }

    // preflight: colabs count
    if (n.includes('COUNT') && n.includes('colaboradores') && n.includes('ativo')) {
      const setorId = Number(params[0])
      return { count: colabs.filter(c => Number(c.setor_id) === setorId && (Number(c.ativo) === 1 || c.ativo === true)).length }
    }

    // preflight: demandas count
    if (n.includes('COUNT') && n.includes('demandas') && n.includes('setor_id')) {
      const setorId = Number(params[0])
      return { count: demandas.filter(d => Number(d.setor_id) === setorId).length }
    }

    // preflight: feriados count
    if (n.includes('COUNT') && n.includes('feriados') && n.includes('BETWEEN')) {
      const inicio = String(params[0])
      const fim = String(params[1])
      return { count: feriados.filter(f => String(f.data) >= inicio && String(f.data) <= fim).length }
    }

    // salvar_regra: colab lookup
    if (n.includes('SELECT id, nome, setor_id, ativo FROM colaboradores WHERE id')) {
      return colabs.find(c => Number(c.id) === Number(params[0]))
    }

    // salvar_regra: regra existente (sem dia_semana)
    if (n.includes('FROM colaborador_regra_horario WHERE colaborador_id') && n.includes('dia_semana_regra IS NULL')) {
      return regras.find(r => Number(r.colaborador_id) === Number(params[0]) && r.dia_semana_regra == null) ?? undefined
    }

    // salvar_regra: regra existente (com dia_semana)
    if (n.includes('FROM colaborador_regra_horario WHERE colaborador_id') && n.includes('dia_semana_regra = ?')) {
      return regras.find(r =>
        Number(r.colaborador_id) === Number(params[0]) &&
        r.dia_semana_regra === params[1]
      ) ?? undefined
    }

    // ajustar_horario: alocação lookup
    if (n.includes('FROM alocacoes WHERE escala_id') && n.includes('colaborador_id') && n.includes('data')) {
      return alocacoes.find(a =>
        Number(a.escala_id) === Number(params[0]) &&
        Number(a.colaborador_id) === Number(params[1]) &&
        String(a.data) === String(params[2])
      )
    }

    // diagnosticar_escala: escala lookup with JOIN
    if (n.includes('FROM escalas e') && n.includes('LEFT JOIN setores s') && n.includes('WHERE e.id')) {
      const escala = escalas.find(e => Number(e.id) === Number(params[0]))
      if (!escala) return undefined
      const setor = setores.find(s => Number(s.id) === Number(escala.setor_id))
      return { ...escala, setor_nome: setor?.nome }
    }

    return undefined
  })

  queryMocks.execute.mockImplementation(async (sql: string, ...params: unknown[]) => {
    const n = sql.replace(/\s+/g, ' ').trim()

    // salvar_regra: INSERT
    if (n.includes('INSERT INTO colaborador_regra_horario')) {
      const newRegra = {
        id: regraIdCounter++,
        colaborador_id: Number(params[0]),
        dia_semana_regra: params[1] ?? null,
        ativo: params[2] ?? 1,
        perfil_horario_id: params[3] ?? null,
        inicio_min: params[4] ?? null,
        inicio_max: params[5] ?? null,
        fim_min: params[6] ?? null,
        fim_max: params[7] ?? null,
        preferencia_turno_soft: params[8] ?? null,
        domingo_ciclo_trabalho: params[9] ?? 2,
        domingo_ciclo_folga: params[10] ?? 1,
        folga_fixa_dia_semana: params[11] ?? null,
      }
      regras.push(newRegra)
      return { changes: 1 }
    }

    // salvar_regra: UPDATE
    if (n.includes('UPDATE colaborador_regra_horario SET')) {
      return { changes: 1 }
    }

    // ajustar_horario: UPDATE alocacoes
    if (n.includes('UPDATE alocacoes SET status') && n.includes('hora_inicio') && n.includes('hora_fim')) {
      const alocacao = alocacoes.find(a =>
        Number(a.escala_id) === Number(params[4]) &&
        Number(a.colaborador_id) === Number(params[5]) &&
        String(a.data) === String(params[6])
      )
      if (alocacao) {
        alocacao.status = params[0]
        alocacao.hora_inicio = params[1]
        alocacao.hora_fim = params[2]
        alocacao.minutos = Number(params[3])
      }
      return { changes: alocacao ? 1 : 0 }
    }

    return { changes: 1 }
  })

  // reset solver mocks
  solverBridgeMocks.buildSolverInput.mockReset()
  solverBridgeMocks.runSolver.mockReset()
  solverBridgeMocks.persistirSolverResult.mockReset()
  validadorMocks.validarEscalaV3.mockReset()
}

describe('executeTool ferramentas semânticas Fase 4 (Onda 1 restante)', () => {
  beforeEach(() => {
    resetMockDbState()
    vi.clearAllMocks()
  })

  afterEach(() => {
    resetMockDbState()
  })

  it('preflight_completo reaproveita preflight e adiciona blocker de capacidade', async () => {
    setupOnda1Mocks({
      setores: [{ id: 1, nome: 'Caixa', ativo: 1 }],
      colaboradores: [{ id: 10, nome: 'Ana', setor_id: 1, ativo: 1 }],
      demandas: [{ id: 1, setor_id: 1 }],
    })

    solverBridgeMocks.buildSolverInput.mockReturnValue({
      data_inicio: '2026-03-01',
      data_fim: '2026-03-01',
      empresa: { tolerancia_semanal_min: 60, min_intervalo_almoco_min: 60, hora_abertura: '08:00', hora_fechamento: '22:00' },
      demanda: [{ dia_semana: 'DOM', min_pessoas: 2, hora_inicio: '08:00', hora_fim: '12:00' }],
      colaboradores: [{ id: 10, nome: 'Ana', trabalha_domingo: false, horas_semanais: 44, dias_trabalho: 6, max_minutos_dia: 480 }],
      excecoes: [],
      feriados: [],
      regras_colaborador_dia: [],
    })

    const result = await executeTool('preflight_completo', {
      setor_id: 1,
      data_inicio: '2026-03-01',
      data_fim: '2026-03-01',
    })

    expect(result.status).toBe('ok')
    expect(result.ok).toBe(false)
    expect(result.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ codigo: 'DOMINGO_SEM_COLABORADORES' }),
      ]),
    )
    expect(result._meta).toEqual(expect.objectContaining({ validation_level: 'completo' }))
  })

  it('salvar_regra_horario_colaborador faz upsert e retorna regra', async () => {
    setupOnda1Mocks({
      colaboradores: [{ id: 11, nome: 'Maria', setor_id: 1, ativo: 1 }],
    })

    const result = await executeTool('salvar_regra_horario_colaborador', {
      colaborador_id: 11,
      inicio_min: '07:00',
      fim_max: '15:00',
      folga_fixa_dia_semana: 'DOM',
    })

    expect(result.status).toBe('ok')
    expect(result.sucesso).toBe(true)
    expect(result.colaborador).toEqual(expect.objectContaining({ id: 11, nome: 'Maria' }))
    expect(result.regra).toEqual(
      expect.objectContaining({
        colaborador_id: 11,
        inicio_min: '07:00',
        fim_max: '15:00',
        folga_fixa_dia_semana: 'DOM',
      }),
    )
  })

  it('definir_janela_colaborador usa wrapper semântico e retorna janela_definida', async () => {
    setupOnda1Mocks({
      colaboradores: [{ id: 12, nome: 'João', setor_id: 1, ativo: 1 }],
    })

    const result = await executeTool('definir_janela_colaborador', {
      colaborador_id: 12,
      inicio_min: '08:00',
      fim_max: '12:00',
    })

    expect(result.status).toBe('ok')
    expect(result.janela_definida).toEqual(
      expect.objectContaining({
        inicio_min: '08:00',
        fim_max: '12:00',
        ativo: true,
      }),
    )
    expect(result._meta).toEqual(expect.objectContaining({ action: 'set-collaborator-window' }))
  })

  it('ajustar_horario atualiza horários e minutos da alocação', async () => {
    setupOnda1Mocks({
      alocacoes: [{
        id: 1,
        escala_id: 20,
        colaborador_id: 3,
        data: '2026-03-10',
        status: 'TRABALHO',
        hora_inicio: '08:00',
        hora_fim: '16:00',
        minutos: 480,
      }],
    })

    const result = await executeTool('ajustar_horario', {
      escala_id: 20,
      colaborador_id: 3,
      data: '2026-03-10',
      hora_inicio: '09:00',
      hora_fim: '17:30',
    })

    expect(result.status).toBe('ok')
    expect(result.minutos).toBe(510)
    expect(result.hora_inicio).toBe('09:00')
    expect(result.hora_fim).toBe('17:30')
  })

  it('diagnosticar_escala resume indicadores e próximas ações', async () => {
    setupOnda1Mocks({
      setores: [{ id: 1, nome: 'Açougue', ativo: 1 }],
      escalas: [{
        id: 77,
        setor_id: 1,
        status: 'RASCUNHO',
        data_inicio: '2026-03-01',
        data_fim: '2026-03-31',
      }],
    })

    validadorMocks.validarEscalaV3.mockReturnValue({
      indicadores: { violacoes_hard: 1, violacoes_soft: 3, cobertura_percent: 91, pontuacao: 1000 },
      violacoes: [{ codigo: 'H10' }, { codigo: 'H10' }, { codigo: 'H1' }],
      antipatterns: [{ codigo: 'AP3' }],
    })

    const result = await executeTool('diagnosticar_escala', { escala_id: 77 })

    expect(result.status).toBe('ok')
    expect(result.escala).toEqual(expect.objectContaining({ id: 77, setor_nome: 'Açougue' }))
    expect(result.diagnostico).toEqual(
      expect.objectContaining({
        violacoes_hard: 1,
        violacoes_soft: 3,
        pode_oficializar: false,
      }),
    )
    expect(result.diagnostico.top_violacoes).toEqual(
      expect.arrayContaining([expect.objectContaining({ codigo: 'H10', count: 2 })]),
    )
    expect(result._meta).toEqual(expect.objectContaining({ tool_kind: 'diagnostic', escala_id: 77 }))
  })
})
