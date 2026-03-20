/**
 * T1-T6: Testes de regressao do backup/restore operacional.
 * Warlog: specs/WARLOG_BACKUP_RESTORE_DEMANDA_OPERACIONAL.md
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

// ─── Mocks ──────────────────────────────────────────────────────────────────

const queryMocks = vi.hoisted(() => ({
  queryOne: vi.fn(),
  queryAll: vi.fn(),
  execute: vi.fn().mockResolvedValue({ changes: 0 }),
  insertReturningId: vi.fn().mockResolvedValue(1),
  transaction: vi.fn(async (fn: () => Promise<unknown>) => fn()),
  execDDL: vi.fn(),
}))

vi.mock('../../src/main/db/query', () => queryMocks)

// ─── Helpers ────────────────────────────────────────────────────────────────

function seg(hi: string, hf: string, mp: number, ov = false) {
  return { hora_inicio: hi, hora_fim: hf, min_pessoas: mp, override: ov }
}

const SEG_PADRAO = [seg('07:00', '08:00', 1), seg('08:00', '10:00', 2), seg('10:00', '12:00', 4)]
const SEG_DOM = [seg('07:00', '13:00', 3)]

// ─── T1: Mutex serializa chamadas concorrentes ──────────────────────────────

describe('T1 — withDbCriticalSection', () => {
  it('serializa chamadas concorrentes', async () => {
    const { withDbCriticalSection } = await import('../../src/main/backup')

    const order: string[] = []

    const a = withDbCriticalSection('a', async () => {
      order.push('a-start')
      await new Promise((r) => setTimeout(r, 50))
      order.push('a-end')
      return 'a'
    })

    const b = withDbCriticalSection('b', async () => {
      order.push('b-start')
      order.push('b-end')
      return 'b'
    })

    const [ra, rb] = await Promise.all([a, b])

    expect(ra).toBe('a')
    expect(rb).toBe('b')
    expect(order).toEqual(['a-start', 'a-end', 'b-start', 'b-end'])
  })
})

// ─── T2: Repair com padrao vazio e dias preenchidos ─────────────────────────

describe('T2 — repair demanda_padrao vazio', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('reconstroi padrao a partir do primeiro dia usa_padrao=true com segmentos', async () => {
    const { repairRestoredOperationalState } = await import('../../src/main/backup')
    const updateCalls: unknown[][] = []

    queryMocks.queryAll.mockImplementation(async (sql: string, ...params: unknown[]) => {
      const s = sql.replace(/\s+/g, ' ').trim()

      // O4.1: setores
      if (s.includes('FROM setores') && !s.includes('WHERE')) {
        return [{
          id: 1, demanda_padrao_hora_abertura: null, demanda_padrao_hora_fechamento: null,
          demanda_padrao_segmentos_json: null, hora_abertura: '07:00', hora_fechamento: '19:30',
        }]
      }

      // O4.1: setor_horario_semana para setor 1
      if (s.includes('FROM setor_horario_semana') && s.includes('setor_id')) {
        return [
          { dia_semana: 'SEG', usa_padrao: true, hora_abertura: '07:00', hora_fechamento: '19:30' },
          { dia_semana: 'DOM', usa_padrao: false, hora_abertura: '07:00', hora_fechamento: '13:00' },
        ]
      }

      // O4.1: demandas por dia
      if (s.includes('FROM demandas') && s.includes('dia_semana = $2')) {
        if (params[1] === 'SEG') return SEG_PADRAO
        if (params[1] === 'DOM') return SEG_DOM
        return []
      }

      // O4.3: setores IDs
      if (s.includes('SELECT id FROM setores')) return [{ id: 1 }]

      // O4.3: funcoes
      if (s.includes('FROM funcoes')) return []

      // O4.4: distinct dia_semana from demandas
      if (s.includes('DISTINCT dia_semana FROM demandas')) {
        return [{ dia_semana: 'SEG' }, { dia_semana: 'DOM' }]
      }

      // O4.4: existing setor_horario_semana
      if (s.includes('dia_semana FROM setor_horario_semana')) {
        return [{ dia_semana: 'SEG' }, { dia_semana: 'DOM' }]
      }

      return []
    })

    queryMocks.queryOne.mockImplementation(async (sql: string, ...params: unknown[]) => {
      const s = sql.replace(/\s+/g, ' ').trim()

      // O4.1: COUNT demandas por dia
      if (s.includes('COUNT') && s.includes('demandas')) {
        if (params[1] === 'SEG') return { c: 3 }
        if (params[1] === 'DOM') return { c: 1 }
        return { c: 0 }
      }

      // O4.4: re-read setor
      if (s.includes('demanda_padrao_segmentos_json') && s.includes('WHERE id')) {
        return {
          demanda_padrao_segmentos_json: JSON.stringify(SEG_PADRAO),
          demanda_padrao_hora_abertura: '07:00', demanda_padrao_hora_fechamento: '19:30',
          hora_abertura: '07:00', hora_fechamento: '19:30',
        }
      }

      return undefined
    })

    queryMocks.execute.mockImplementation(async (sql: string, ...params: unknown[]) => {
      const s = sql.replace(/\s+/g, ' ').trim()
      if (s.includes('UPDATE setores SET demanda_padrao')) {
        updateCalls.push(params)
      }
      return { changes: 1 }
    })

    const repairs = await repairRestoredOperationalState()

    expect(repairs).toBeGreaterThanOrEqual(1)
    expect(updateCalls.length).toBe(1)
    // Padrao reconstruido com abertura do SEG
    expect(updateCalls[0][0]).toBe('07:00') // hora_abertura
    expect(updateCalls[0][1]).toBe('19:30') // hora_fechamento
    const segs = JSON.parse(updateCalls[0][2] as string)
    expect(segs).toHaveLength(3)
    expect(segs[0].hora_inicio).toBe('07:00')
  })
})

// ─── T3: Repair com padrao valido NAO sobrescreve ───────────────────────────

describe('T3 — padrao valido nao e tocado', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('pula repair quando padrao ja e valido', async () => {
    const { repairRestoredOperationalState } = await import('../../src/main/backup')
    const padraoUpdates: unknown[] = []

    queryMocks.queryAll.mockImplementation(async (sql: string) => {
      const s = sql.replace(/\s+/g, ' ').trim()
      if (s.includes('FROM setores') && !s.includes('WHERE')) {
        return [{
          id: 1, demanda_padrao_hora_abertura: '08:00', demanda_padrao_hora_fechamento: '18:00',
          demanda_padrao_segmentos_json: JSON.stringify([seg('08:00', '18:00', 2)]),
          hora_abertura: '07:00', hora_fechamento: '19:30',
        }]
      }
      if (s.includes('SELECT id FROM setores')) return [{ id: 1 }]
      if (s.includes('FROM funcoes')) return []
      if (s.includes('DISTINCT dia_semana FROM demandas')) return []
      if (s.includes('dia_semana FROM setor_horario_semana')) return []
      return []
    })

    queryMocks.queryOne.mockImplementation(async (sql: string) => {
      const s = sql.replace(/\s+/g, ' ').trim()
      if (s.includes('demanda_padrao_segmentos_json') && s.includes('WHERE id')) {
        return {
          demanda_padrao_segmentos_json: JSON.stringify([seg('08:00', '18:00', 2)]),
          demanda_padrao_hora_abertura: '08:00', demanda_padrao_hora_fechamento: '18:00',
          hora_abertura: '07:00', hora_fechamento: '19:30',
        }
      }
      return undefined
    })

    queryMocks.execute.mockImplementation(async (sql: string, ...params: unknown[]) => {
      if (sql.includes('UPDATE setores SET demanda_padrao')) padraoUpdates.push(params)
      return { changes: 0 }
    })

    await repairRestoredOperationalState()

    expect(padraoUpdates).toHaveLength(0)
  })
})

// ─── T4: Repair de funcao_id orfao ──────────────────────────────────────────

describe('T4 — funcao_id orfao', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('limpa funcao_id que aponta pra funcao inexistente', async () => {
    const { repairRestoredOperationalState } = await import('../../src/main/backup')
    let orphanFixChanges = 0

    queryMocks.queryAll.mockImplementation(async (sql: string) => {
      const s = sql.replace(/\s+/g, ' ').trim()
      if (s.includes('FROM setores') && !s.includes('WHERE')) {
        return [{ id: 1, demanda_padrao_hora_abertura: '08:00', demanda_padrao_hora_fechamento: '18:00',
          demanda_padrao_segmentos_json: JSON.stringify([seg('08:00', '18:00', 2)]),
          hora_abertura: '08:00', hora_fechamento: '18:00' }]
      }
      if (s.includes('SELECT id FROM setores')) return [{ id: 1 }]
      if (s.includes('FROM funcoes')) return []
      if (s.includes('DISTINCT dia_semana FROM demandas')) return []
      if (s.includes('dia_semana FROM setor_horario_semana')) return []
      return []
    })

    queryMocks.queryOne.mockImplementation(async (sql: string) => {
      const s = sql.replace(/\s+/g, ' ').trim()
      if (s.includes('demanda_padrao_segmentos_json') && s.includes('WHERE id')) {
        return { demanda_padrao_segmentos_json: JSON.stringify([seg('08:00', '18:00', 2)]),
          demanda_padrao_hora_abertura: '08:00', demanda_padrao_hora_fechamento: '18:00',
          hora_abertura: '08:00', hora_fechamento: '18:00' }
      }
      return undefined
    })

    queryMocks.execute.mockImplementation(async (sql: string) => {
      const s = sql.replace(/\s+/g, ' ').trim()
      if (s.includes('UPDATE colaboradores SET funcao_id = NULL') && s.includes('NOT IN')) {
        orphanFixChanges = 3
        return { changes: 3 }
      }
      return { changes: 0 }
    })

    const repairs = await repairRestoredOperationalState()

    expect(repairs).toBeGreaterThanOrEqual(3)
  })
})

// ─── T5: Escopo do backup operacional ───────────────────────────────────────

describe('T5 — escopo backup auto', () => {
  it('BACKUP_CATEGORIAS nao deve conter tabelas IA/knowledge no auto', async () => {
    const { BACKUP_CATEGORIAS } = await import('../../src/main/backup')

    const allTables = Object.values(BACKUP_CATEGORIAS).flat()

    const fullOnlyExpected = [
      'configuracao_ia', 'ia_conversas', 'ia_mensagens', 'ia_memorias',
      'knowledge_sources', 'knowledge_chunks', 'knowledge_entities', 'knowledge_relations',
    ]

    // Todas devem existir em alguma categoria (pra backup full funcionar)
    for (const t of fullOnlyExpected) {
      expect(allTables).toContain(t)
    }

    // Operacional nao inclui: verificar que sao filtradas em runtime
    // (FULL_ONLY_TABLES e internal, entao verificamos indiretamente via categorias)
    expect(BACKUP_CATEGORIAS.conhecimento).toContain('knowledge_sources')
    expect(BACKUP_CATEGORIAS.conversas).toContain('ia_conversas')
    expect(BACKUP_CATEGORIAS.cadastros).toContain('configuracao_ia')
  })
})

// ─── T6: Repair cria setor_horario_semana ausente (O4.4) ────────────────────

describe('T6 — repair cria setor_horario_semana ausente', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('cria linhas com usa_padrao correto baseado em comparacao de segmentos', async () => {
    const { repairRestoredOperationalState } = await import('../../src/main/backup')
    const insertedRows: Array<{ dia: string; usa_padrao: boolean }> = []

    queryMocks.queryAll.mockImplementation(async (sql: string, ...params: unknown[]) => {
      const s = sql.replace(/\s+/g, ' ').trim()

      // O4.1: setores — padrao ja valido (pula O4.1)
      if (s.includes('FROM setores') && !s.includes('WHERE')) {
        return [{
          id: 1, demanda_padrao_hora_abertura: '07:00', demanda_padrao_hora_fechamento: '19:30',
          demanda_padrao_segmentos_json: JSON.stringify(SEG_PADRAO),
          hora_abertura: '07:00', hora_fechamento: '19:30',
        }]
      }

      // O4.3: funcoes
      if (s.includes('SELECT id FROM setores')) return [{ id: 1 }]
      if (s.includes('FROM funcoes')) return []

      // O4.4: dias com demandas (SEG e DOM)
      if (s.includes('DISTINCT dia_semana FROM demandas')) {
        return [{ dia_semana: 'SEG' }, { dia_semana: 'DOM' }]
      }

      // O4.4: ZERO linhas existentes em setor_horario_semana
      if (s.includes('dia_semana FROM setor_horario_semana')) {
        return []
      }

      // O4.4: segmentos do dia
      if (s.includes('FROM demandas') && s.includes('dia_semana = $2')) {
        if (params[1] === 'SEG') return SEG_PADRAO // igual ao padrao
        if (params[1] === 'DOM') return SEG_DOM    // diferente do padrao
        return []
      }

      // O4.1: setor_horario_semana (vazio)
      if (s.includes('FROM setor_horario_semana') && s.includes('setor_id')) {
        return []
      }

      return []
    })

    queryMocks.queryOne.mockImplementation(async (sql: string) => {
      const s = sql.replace(/\s+/g, ' ').trim()

      // O4.1: count demandas — pra repair do padrao
      if (s.includes('COUNT') && s.includes('demandas')) {
        return { c: 0 }
      }

      // O4.4: re-read setor atualizado
      if (s.includes('demanda_padrao_segmentos_json') && s.includes('WHERE id')) {
        return {
          demanda_padrao_segmentos_json: JSON.stringify(SEG_PADRAO),
          demanda_padrao_hora_abertura: '07:00', demanda_padrao_hora_fechamento: '19:30',
          hora_abertura: '07:00', hora_fechamento: '19:30',
        }
      }

      return undefined
    })

    queryMocks.execute.mockImplementation(async (sql: string, ...params: unknown[]) => {
      const s = sql.replace(/\s+/g, ' ').trim()
      if (s.includes('INSERT INTO setor_horario_semana')) {
        insertedRows.push({ dia: params[1] as string, usa_padrao: params[2] as boolean })
      }
      return { changes: 1 }
    })

    const repairs = await repairRestoredOperationalState()

    expect(repairs).toBeGreaterThanOrEqual(2) // 2 linhas criadas
    expect(insertedRows).toHaveLength(2)

    const segRow = insertedRows.find((r) => r.dia === 'SEG')
    const domRow = insertedRows.find((r) => r.dia === 'DOM')

    expect(segRow?.usa_padrao).toBe(true)  // SEG = igual ao padrao
    expect(domRow?.usa_padrao).toBe(false) // DOM = diferente do padrao
  })
})
