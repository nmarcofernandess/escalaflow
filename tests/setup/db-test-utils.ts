type SetorRow = { id: number; nome: string; ativo: number }
type ColaboradorRow = { id: number; nome: string; setor_id: number; ativo: number }
type DemandaRow = { id: number; setor_id: number }
type FeriadoRow = { id: number; data: string; nome: string }

type MockStatement = {
  run: (...args: any[]) => any
  get: (...args: any[]) => any
  all: (...args: any[]) => any[]
}

export type IaToolsMockDb = {
  prepare: (sql: string) => MockStatement
  close: () => void
  __seed: {
    insertSetor: (row: SetorRow) => void
    insertColaborador: (row: ColaboradorRow) => void
    insertDemanda: (row: DemandaRow) => void
    insertFeriado: (row: FeriadoRow) => void
  }
}

export function createIaToolsMockDb(): IaToolsMockDb {
  const state = {
    setores: [] as SetorRow[],
    colaboradores: [] as ColaboradorRow[],
    demandas: [] as DemandaRow[],
    feriados: [] as FeriadoRow[],
  }

  const db: IaToolsMockDb = {
    prepare(sql: string): MockStatement {
      const normalized = sql.replace(/\s+/g, ' ').trim()

      return {
        run: (...args: any[]) => {
          if (normalized.startsWith('INSERT INTO setores')) {
            state.setores.push({ id: Number(args[0]), nome: String(args[1]), ativo: Number(args[2]) })
            return { changes: 1 }
          }
          throw new Error(`Mock DB run() não suportado para query: ${normalized}`)
        },
        get: (...args: any[]) => {
          if (normalized.includes('SELECT id, ativo FROM setores WHERE id = ?')) {
            const setorId = Number(args[0])
            return state.setores.find((s) => s.id === setorId)
          }

          if (normalized.includes('SELECT COUNT(*) as count FROM colaboradores WHERE setor_id = ? AND ativo = 1')) {
            const setorId = Number(args[0])
            const count = state.colaboradores.filter((c) => c.setor_id === setorId && c.ativo === 1).length
            return { count }
          }

          if (normalized.includes('SELECT COUNT(*) as count FROM demandas WHERE setor_id = ?')) {
            const setorId = Number(args[0])
            const count = state.demandas.filter((d) => d.setor_id === setorId).length
            return { count }
          }

          if (normalized.includes('SELECT COUNT(*) as count FROM feriados WHERE data BETWEEN ? AND ?')) {
            const [inicio, fim] = args.map(String)
            const count = state.feriados.filter((f) => f.data >= inicio && f.data <= fim).length
            return { count }
          }

          throw new Error(`Mock DB get() não suportado para query: ${normalized}`)
        },
        all: () => {
          throw new Error(`Mock DB all() não suportado nesta fixture`)
        },
      }
    },
    close() {},
    __seed: {
      insertSetor(row: SetorRow) {
        state.setores.push(row)
      },
      insertColaborador(row: ColaboradorRow) {
        state.colaboradores.push(row)
      },
      insertDemanda(row: DemandaRow) {
        state.demandas.push(row)
      },
      insertFeriado(row: FeriadoRow) {
        state.feriados.push(row)
      },
    },
  }

  return db
}

export function setMockDb(db: unknown) {
  ;(globalThis as any).mockDb = db
}

export function clearMockDb() {
  delete (globalThis as any).mockDb
}
