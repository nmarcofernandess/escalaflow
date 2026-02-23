import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearMockDb, setMockDb } from '../../setup/db-test-utils'

const solverBridgeMocks = vi.hoisted(() => ({
  buildSolverInput: vi.fn(),
  runSolver: vi.fn(),
  persistirSolverResult: vi.fn(),
}))

const validadorMocks = vi.hoisted(() => ({
  validarEscalaV3: vi.fn(),
}))

vi.mock('../../../src/main/motor/solver-bridge', () => ({
  buildSolverInput: solverBridgeMocks.buildSolverInput,
  runSolver: solverBridgeMocks.runSolver,
  persistirSolverResult: solverBridgeMocks.persistirSolverResult,
}))

vi.mock('../../../src/main/motor/validador', () => ({
  validarEscalaV3: validadorMocks.validarEscalaV3,
}))

import { executeTool } from '../../../src/main/ia/tools'

type Row = Record<string, any>

function createFase4RestanteMockDb() {
  const state = {
    setores: [] as Row[],
    colaboradores: [] as Row[],
    demandas: [] as Row[],
    feriados: [] as Row[],
    colaborador_regra_horario: [] as Row[],
    alocacoes: [] as Row[],
    escalas: [] as Row[],
    ids: { regra: 1 },
  }

  const normalize = (sql: string) => sql.replace(/\s+/g, ' ').trim()

  return {
    __seed: {
      insert(table: keyof typeof state, row: Row) {
        ;(state[table] as Row[]).push({ ...row })
      },
    },
    __inspect: state,
    prepare(sql: string) {
      const normalized = normalize(sql)

      return {
        get: (...args: any[]) => {
          if (normalized.includes('SELECT id, ativo FROM setores WHERE id = ?')) {
            return state.setores.find((s) => Number(s.id) === Number(args[0]))
          }

          if (normalized.includes('SELECT COUNT(*) as count FROM colaboradores WHERE setor_id = ? AND ativo = 1')) {
            const setorId = Number(args[0])
            return { count: state.colaboradores.filter((c) => Number(c.setor_id) === setorId && Number(c.ativo) === 1).length }
          }

          if (normalized.includes('SELECT COUNT(*) as count FROM demandas WHERE setor_id = ?')) {
            const setorId = Number(args[0])
            return { count: state.demandas.filter((d) => Number(d.setor_id) === setorId).length }
          }

          if (normalized.includes('SELECT COUNT(*) as count FROM feriados WHERE data BETWEEN ? AND ?')) {
            const inicio = String(args[0])
            const fim = String(args[1])
            return { count: state.feriados.filter((f) => String(f.data) >= inicio && String(f.data) <= fim).length }
          }

          if (normalized.includes('FROM colaboradores c LEFT JOIN setores s ON s.id = c.setor_id WHERE c.id = ?')) {
            const colab = state.colaboradores.find((c) => Number(c.id) === Number(args[0]))
            if (!colab) return undefined
            const setor = state.setores.find((s) => Number(s.id) === Number(colab.setor_id))
            return {
              ...colab,
              setor_nome: setor?.nome,
            }
          }

          if (normalized === 'SELECT id, nome, setor_id, ativo FROM colaboradores WHERE id = ?') {
            return state.colaboradores.find((c) => Number(c.id) === Number(args[0]))
          }

          if (normalized === 'SELECT * FROM colaborador_regra_horario WHERE colaborador_id = ?') {
            return state.colaborador_regra_horario.find((r) => Number(r.colaborador_id) === Number(args[0])) ?? null
          }

          if (normalized === 'SELECT id FROM colaborador_regra_horario WHERE colaborador_id = ?') {
            const row = state.colaborador_regra_horario.find((r) => Number(r.colaborador_id) === Number(args[0]))
            return row ? { id: row.id } : undefined
          }

          if (normalized === 'SELECT id, status, hora_inicio, hora_fim FROM alocacoes WHERE escala_id = ? AND colaborador_id = ? AND data = ?') {
            return state.alocacoes.find((a) =>
              Number(a.escala_id) === Number(args[0]) &&
              Number(a.colaborador_id) === Number(args[1]) &&
              String(a.data) === String(args[2]),
            )
          }

          if (normalized.includes('FROM escalas e LEFT JOIN setores s ON s.id = e.setor_id WHERE e.id = ?')) {
            const escala = state.escalas.find((e) => Number(e.id) === Number(args[0]))
            if (!escala) return undefined
            const setor = state.setores.find((s) => Number(s.id) === Number(escala.setor_id))
            return { ...escala, setor_nome: setor?.nome }
          }

          throw new Error(`Mock get() não suportado: ${normalized}`)
        },
        all: (..._args: any[]) => {
          throw new Error(`Mock all() não suportado: ${normalized}`)
        },
        run: (...args: any[]) => {
          if (normalized.startsWith('INSERT INTO colaborador_regra_horario ')) {
            const row = {
              id: state.ids.regra++,
              colaborador_id: Number(args[0]),
              ativo: Number(args[1]),
              perfil_horario_id: args[2],
              inicio_min: args[3],
              inicio_max: args[4],
              fim_min: args[5],
              fim_max: args[6],
              preferencia_turno_soft: args[7],
              domingo_ciclo_trabalho: args[8],
              domingo_ciclo_folga: args[9],
              folga_fixa_dia_semana: args[10],
            }
            state.colaborador_regra_horario.push(row)
            return { changes: 1, lastInsertRowid: row.id }
          }

          if (normalized.startsWith('UPDATE colaborador_regra_horario SET')) {
            const colaboradorId = Number(args[10])
            const row = state.colaborador_regra_horario.find((r) => Number(r.colaborador_id) === colaboradorId)
            if (!row) return { changes: 0 }
            const [ativo, perfil_horario_id, inicio_min, inicio_max, fim_min, fim_max, pref, domTrab, domFolga, folgaFixa] = args
            if (ativo !== null) row.ativo = Number(ativo)
            row.perfil_horario_id = perfil_horario_id
            row.inicio_min = inicio_min
            row.inicio_max = inicio_max
            row.fim_min = fim_min
            row.fim_max = fim_max
            row.preferencia_turno_soft = pref
            if (domTrab !== null) row.domingo_ciclo_trabalho = domTrab
            if (domFolga !== null) row.domingo_ciclo_folga = domFolga
            row.folga_fixa_dia_semana = folgaFixa
            return { changes: 1 }
          }

          if (normalized === 'UPDATE alocacoes SET status = ?, hora_inicio = ?, hora_fim = ?, minutos = ? WHERE escala_id = ? AND colaborador_id = ? AND data = ?') {
            const [status, horaInicio, horaFim, minutos, escalaId, colaboradorId, data] = args
            const row = state.alocacoes.find((a) =>
              Number(a.escala_id) === Number(escalaId) &&
              Number(a.colaborador_id) === Number(colaboradorId) &&
              String(a.data) === String(data),
            )
            if (!row) return { changes: 0 }
            row.status = status
            row.hora_inicio = horaInicio
            row.hora_fim = horaFim
            row.minutos = Number(minutos)
            return { changes: 1 }
          }

          throw new Error(`Mock run() não suportado: ${normalized}`)
        },
      }
    },
    close() {},
  }
}

describe('executeTool ferramentas semânticas Fase 4 (Onda 1 restante)', () => {
  let db: ReturnType<typeof createFase4RestanteMockDb>

  beforeEach(() => {
    db = createFase4RestanteMockDb()
    setMockDb(db)
    solverBridgeMocks.buildSolverInput.mockReset()
    solverBridgeMocks.runSolver.mockReset()
    solverBridgeMocks.persistirSolverResult.mockReset()
    validadorMocks.validarEscalaV3.mockReset()
  })

  afterEach(() => {
    clearMockDb()
    vi.clearAllMocks()
    db.close()
  })

  it('preflight_completo reaproveita preflight e adiciona blocker de capacidade', async () => {
    db.__seed.insert('setores', { id: 1, nome: 'Caixa', ativo: 1 })
    db.__seed.insert('colaboradores', { id: 10, nome: 'Ana', setor_id: 1, ativo: 1 })
    db.__seed.insert('demandas', { id: 1, setor_id: 1 })

    solverBridgeMocks.buildSolverInput.mockReturnValue({
      data_inicio: '2026-03-01', // domingo
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

  it('obter_regra_horario_colaborador retorna regra configurada', async () => {
    db.__seed.insert('setores', { id: 2, nome: 'Padaria', ativo: 1 })
    db.__seed.insert('colaboradores', { id: 8, nome: 'Cleunice', setor_id: 2, ativo: 1 })
    db.__seed.insert('colaborador_regra_horario', {
      id: 1,
      colaborador_id: 8,
      ativo: 1,
      inicio_min: '06:00',
      fim_max: '14:00',
    })

    const result = await executeTool('obter_regra_horario_colaborador', { colaborador_id: 8 })

    expect(result.status).toBe('ok')
    expect(result.configurada).toBe(true)
    expect(result.colaborador).toEqual(expect.objectContaining({ id: 8, nome: 'Cleunice', setor_nome: 'Padaria' }))
    expect(result.regra).toEqual(expect.objectContaining({ inicio_min: '06:00', fim_max: '14:00' }))
  })

  it('salvar_regra_horario_colaborador faz upsert e retorna regra', async () => {
    db.__seed.insert('colaboradores', { id: 11, nome: 'Maria', setor_id: 1, ativo: 1 })

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
    db.__seed.insert('colaboradores', { id: 12, nome: 'João', setor_id: 1, ativo: 1 })

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
    db.__seed.insert('alocacoes', {
      id: 1,
      escala_id: 20,
      colaborador_id: 3,
      data: '2026-03-10',
      status: 'TRABALHO',
      hora_inicio: '08:00',
      hora_fim: '16:00',
      minutos: 480,
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
    expect(db.__inspect.alocacoes[0]).toEqual(expect.objectContaining({ hora_inicio: '09:00', hora_fim: '17:30', minutos: 510 }))
  })

  it('diagnosticar_escala resume indicadores e próximas ações', async () => {
    db.__seed.insert('setores', { id: 1, nome: 'Açougue', ativo: 1 })
    db.__seed.insert('escalas', {
      id: 77,
      setor_id: 1,
      status: 'RASCUNHO',
      data_inicio: '2026-03-01',
      data_fim: '2026-03-31',
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

