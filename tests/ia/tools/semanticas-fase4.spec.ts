import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetMockDbState } from '../../setup/db-test-utils'

const queryMocks = vi.hoisted(() => ({
  queryOne: vi.fn(),
  queryAll: vi.fn(),
  execute: vi.fn(),
  insertReturningId: vi.fn(),
}))

vi.mock('../../../src/main/db/query', () => queryMocks)
vi.mock('../../../src/main/knowledge/search', () => ({
  searchKnowledge: vi.fn().mockResolvedValue([]),
  exploreRelations: vi.fn().mockResolvedValue([]),
}))
vi.mock('../../../src/main/knowledge/ingest', () => ({
  ingestKnowledge: vi.fn().mockResolvedValue({ chunks_count: 0 }),
}))

import { executeTool } from '../../../src/main/ia/tools'

type Row = Record<string, any>

function setupSemanticasMocks(state: {
  setores?: Row[]
  tipos_contrato?: Row[]
  colaboradores?: Row[]
}) {
  const setores = state.setores ?? []
  const tipos = state.tipos_contrato ?? []
  const colabs = state.colaboradores ?? []

  queryMocks.queryAll.mockImplementation(async (sql: string, ...params: unknown[]) => {
    const n = sql.replace(/\s+/g, ' ').trim()

    // buscar_colaborador — SELECT c.*, s.nome, t.nome FROM colaboradores c LEFT JOIN setores s ... LEFT JOIN tipos_contrato t ...
    if (n.includes('FROM colaboradores c') && n.includes('LEFT JOIN setores s') && n.includes('LEFT JOIN tipos_contrato t')) {
      let filtered = [...colabs]

      // Apply WHERE clauses
      if (n.includes('c.ativo = true')) {
        filtered = filtered.filter(c => Number(c.ativo) === 1 || c.ativo === true)
      }

      if (n.includes('c.id = ')) {
        const id = params[0]
        filtered = filtered.filter(c => Number(c.id) === Number(id))
      }

      if (n.includes('LOWER(c.nome) = LOWER(')) {
        const name = String(params[n.includes('c.ativo') ? 0 : 0]).toLowerCase()
        // Determine param index based on earlier params consumed
        const paramIdx = n.includes('c.setor_id') ? 1 : 0
        const nameVal = String(params[paramIdx]).toLowerCase()
        filtered = filtered.filter(c => String(c.nome).toLowerCase() === nameVal)
      }

      if (n.includes('c.nome ILIKE')) {
        const paramIdx = n.includes('c.setor_id') ? 1 : 0
        const pattern = String(params[paramIdx]).replace(/%/g, '').toLowerCase()
        filtered = filtered.filter(c => String(c.nome).toLowerCase().includes(pattern))
      }

      // Enrich with JOINs
      return filtered.map(c => ({
        ...c,
        setor_nome: setores.find(s => Number(s.id) === Number(c.setor_id))?.nome,
        tipo_contrato_nome: tipos.find(t => Number(t.id) === Number(c.tipo_contrato_id))?.nome,
      })).sort((a, b) => {
        const ativoDiff = Number(b.ativo ?? 0) - Number(a.ativo ?? 0)
        if (ativoDiff !== 0) return ativoDiff
        return String(a.nome).localeCompare(String(b.nome))
      })
    }

    return []
  })

  queryMocks.queryOne.mockImplementation(async (sql: string, ...params: unknown[]) => {
    const n = sql.replace(/\s+/g, ' ').trim()

    // Enrichment queries for buscar_colaborador (enrichColaboradorSingle)
    if (n.includes('FROM colaborador_regra_horario WHERE colaborador_id')) {
      return null // No rule configured
    }

    if (n.includes('FROM colaborador_regra_horario_excecao_data WHERE colaborador_id')) {
      return null
    }

    if (n.includes('FROM excecoes WHERE colaborador_id')) {
      return null
    }

    return undefined
  })

  queryMocks.queryAll.mockImplementation(async (sql: string, ...params: unknown[]) => {
    const n = sql.replace(/\s+/g, ' ').trim()

    if (n.includes('FROM colaboradores c') && n.includes('LEFT JOIN setores s') && n.includes('LEFT JOIN tipos_contrato t')) {
      let filtered = [...colabs]

      if (n.includes('c.ativo = true')) {
        filtered = filtered.filter(c => Number(c.ativo) === 1 || c.ativo === true)
      }

      if (n.includes('LOWER(c.nome) = LOWER(')) {
        const nameParam = params.find(p => typeof p === 'string' && !String(p).includes('%'))
        if (nameParam) {
          filtered = filtered.filter(c => String(c.nome).toLowerCase() === String(nameParam).toLowerCase())
        }
      }

      if (n.includes('c.nome ILIKE')) {
        const likeParam = params.find(p => typeof p === 'string' && String(p).includes('%'))
        if (likeParam) {
          const pattern = String(likeParam).replace(/%/g, '').toLowerCase()
          filtered = filtered.filter(c => String(c.nome).toLowerCase().includes(pattern))
        }
      }

      return filtered.map(c => ({
        ...c,
        setor_nome: setores.find(s => Number(s.id) === Number(c.setor_id))?.nome,
        tipo_contrato_nome: tipos.find(t => Number(t.id) === Number(c.tipo_contrato_id))?.nome,
      })).sort((a, b) => {
        const ativoDiff = Number(b.ativo ?? 0) - Number(a.ativo ?? 0)
        if (ativoDiff !== 0) return ativoDiff
        return String(a.nome).localeCompare(String(b.nome))
      })
    }

    return []
  })
}

describe('executeTool ferramentas semânticas (Fase 4 - início / poda)', () => {
  beforeEach(() => {
    resetMockDbState()
    vi.clearAllMocks()
  })

  afterEach(() => {
    resetMockDbState()
  })

  it('wrappers CRUD/de discovery removidos retornam UNKNOWN_TOOL', async () => {
    for (const toolName of ['listar_setores', 'listar_colaboradores_do_setor', 'obter_escala_atual', 'criar_excecao'] as const) {
      const result = await executeTool(toolName, {})
      expect(result.status).toBe('error')
      expect(result.code).toBe('UNKNOWN_TOOL')
    }
  })

  it('buscar_colaborador resolve por nome com enriquecimento e retorna um único match', async () => {
    setupSemanticasMocks({
      setores: [{ id: 1, nome: 'Açougue', ativo: 1 }],
      tipos_contrato: [{ id: 2, nome: 'CLT 44h' }],
      colaboradores: [{ id: 10, nome: 'Cleunice Souza', setor_id: 1, tipo_contrato_id: 2, ativo: 1 }],
    })

    const result = await executeTool('buscar_colaborador', { nome: 'cleunice', modo: 'PARCIAL' })

    expect(result.status).toBe('ok')
    expect(result.colaborador).toEqual(
      expect.objectContaining({
        id: 10,
        nome: 'Cleunice Souza',
        setor_nome: 'Açougue',
        tipo_contrato_nome: 'CLT 44h',
      }),
    )
    expect(result.encontrado_por).toBe('nome_parcial')
    expect(result._meta).toEqual(
      expect.objectContaining({
        tool_kind: 'discovery',
        resolution: 'single',
      }),
    )
  })

  it('buscar_colaborador retorna ambiguidade quando há múltiplos matches', async () => {
    setupSemanticasMocks({
      setores: [{ id: 1, nome: 'Caixa', ativo: 1 }],
      tipos_contrato: [{ id: 1, nome: 'CLT' }],
      colaboradores: [
        { id: 1, nome: 'Maria Silva', setor_id: 1, tipo_contrato_id: 1, ativo: 1 },
        { id: 2, nome: 'Maria Souza', setor_id: 1, tipo_contrato_id: 1, ativo: 1 },
      ],
    })

    const result = await executeTool('buscar_colaborador', { nome: 'Maria', modo: 'PARCIAL' })

    expect(result.status).toBe('ok')
    expect(result.ambiguous).toBe(true)
    expect(result.total).toBe(2)
    expect(result.candidatos).toHaveLength(2)
    expect(result.summary).toMatch(/Refine o nome/i)
  })
})
