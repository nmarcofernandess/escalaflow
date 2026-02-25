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

function setupPreflightMocks(options: {
  setorExists?: boolean
  colabsAtivos?: number
  demandasCount?: number
  feriadosCount?: number
}) {
  const setorExists = options.setorExists ?? true
  const colabsAtivos = options.colabsAtivos ?? 0
  const demandasCount = options.demandasCount ?? 0
  const feriadosCount = options.feriadosCount ?? 0

  queryMocks.queryOne.mockImplementation(async (sql: string, ...params: unknown[]) => {
    const n = sql.replace(/\s+/g, ' ').trim()

    if (n.includes('SELECT id, ativo FROM setores WHERE id')) {
      return setorExists ? { id: params[0], ativo: true } : undefined
    }

    if (n.includes('COUNT') && n.includes('colaboradores') && n.includes('ativo')) {
      return { count: colabsAtivos }
    }

    if (n.includes('COUNT') && n.includes('demandas') && n.includes('setor_id')) {
      return { count: demandasCount }
    }

    if (n.includes('COUNT') && n.includes('feriados') && n.includes('BETWEEN')) {
      return { count: feriadosCount }
    }

    return undefined
  })
}

describe('executeTool(preflight)', () => {
  beforeEach(() => {
    resetMockDbState()
    vi.clearAllMocks()
  })

  afterEach(() => {
    resetMockDbState()
  })

  it('retorna blockers/warnings quando setor não tem equipe nem demanda', async () => {
    setupPreflightMocks({
      setorExists: true,
      colabsAtivos: 0,
      demandasCount: 0,
      feriadosCount: 0,
    })

    const result = await executeTool('preflight', {
      setor_id: 1,
      data_inicio: '2026-03-01',
      data_fim: '2026-03-31',
    })

    expect(result.status).toBe('ok')
    expect(result.ok).toBe(false)
    expect(result.summary).toMatch(/blocker/i)
    expect(result._meta).toEqual(
      expect.objectContaining({
        tool_kind: 'validation',
        blockers_count: 1,
        warnings_count: 1,
      }),
    )
    expect(result.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ codigo: 'SEM_COLABORADORES' }),
      ]),
    )
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ codigo: 'SEM_DEMANDA' }),
      ]),
    )
    expect(result.diagnostico).toEqual(
      expect.objectContaining({
        setor_id: 1,
        colaboradores_ativos: 0,
        demandas_cadastradas: 0,
      }),
    )
  })

  it('retorna ok=true quando setor tem equipe e demanda', async () => {
    setupPreflightMocks({
      setorExists: true,
      colabsAtivos: 5,
      demandasCount: 3,
      feriadosCount: 1,
    })

    const result = await executeTool('preflight', {
      setor_id: 1,
      data_inicio: '2026-03-01',
      data_fim: '2026-03-31',
    })

    expect(result.status).toBe('ok')
    expect(result.ok).toBe(true)
    expect(result.blockers).toHaveLength(0)
    expect(result.diagnostico).toEqual(
      expect.objectContaining({
        colaboradores_ativos: 5,
        demandas_cadastradas: 3,
        feriados_no_periodo: 1,
      }),
    )
  })

  it('retorna blocker quando setor não existe', async () => {
    setupPreflightMocks({
      setorExists: false,
      colabsAtivos: 0,
      demandasCount: 0,
    })

    const result = await executeTool('preflight', {
      setor_id: 999,
      data_inicio: '2026-03-01',
      data_fim: '2026-03-31',
    })

    expect(result.ok).toBe(false)
    expect(result.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ codigo: 'SETOR_INVALIDO' }),
      ]),
    )
  })
})
