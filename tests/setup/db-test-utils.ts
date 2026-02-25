/**
 * db-test-utils.ts — Utilitários de mock para PGlite (query.ts)
 *
 * Estratégia: vi.mock('../../src/main/db/query') nos specs.
 * Este módulo exporta helpers para configurar respostas dos mocks.
 */

import { vi } from 'vitest'

// ============================================================================
// Query mock state — tabelas in-memory com routing por SQL pattern
// ============================================================================

type Row = Record<string, any>

export interface MockDbState {
  tables: Record<string, Row[]>
  sequences: Record<string, number>
  // Custom matchers — cada spec pode registrar handlers específicos
  queryOneHandlers: Array<(sql: string, params: unknown[]) => Row | undefined | null>
  queryAllHandlers: Array<(sql: string, params: unknown[]) => Row[] | null>
  executeHandlers: Array<(sql: string, params: unknown[]) => { changes: number } | null>
  insertHandlers: Array<(sql: string, params: unknown[]) => number | null>
}

let _state: MockDbState = createFreshState()

function createFreshState(): MockDbState {
  return {
    tables: {},
    sequences: {},
    queryOneHandlers: [],
    queryAllHandlers: [],
    executeHandlers: [],
    insertHandlers: [],
  }
}

// ============================================================================
// Public API — used by test files
// ============================================================================

export function resetMockDbState(): void {
  _state = createFreshState()
}

export function getMockDbState(): MockDbState {
  return _state
}

/** Insert a row into a mock table (in-memory only) */
export function seedTable(table: string, row: Row): void {
  if (!_state.tables[table]) _state.tables[table] = []
  _state.tables[table].push({ ...row })
}

/** Get all rows from a mock table */
export function getTableRows(table: string): Row[] {
  return _state.tables[table] ?? []
}

/** Set the auto-increment sequence for a table */
export function setSequence(table: string, startId: number): void {
  _state.sequences[table] = startId
}

/** Get next ID and increment sequence */
export function nextId(table: string): number {
  if (!(_state.sequences[table])) _state.sequences[table] = 1
  return _state.sequences[table]++
}

/** Register a custom queryOne handler (return undefined to fall through) */
export function onQueryOne(handler: (sql: string, params: unknown[]) => Row | undefined | null): void {
  _state.queryOneHandlers.push(handler)
}

/** Register a custom queryAll handler (return null to fall through) */
export function onQueryAll(handler: (sql: string, params: unknown[]) => Row[] | null): void {
  _state.queryAllHandlers.push(handler)
}

/** Register a custom execute handler (return null to fall through) */
export function onExecute(handler: (sql: string, params: unknown[]) => { changes: number } | null): void {
  _state.executeHandlers.push(handler)
}

/** Register a custom insertReturningId handler (return null to fall through) */
export function onInsert(handler: (sql: string, params: unknown[]) => number | null): void {
  _state.insertHandlers.push(handler)
}

// ============================================================================
// Mock implementations — these get wired up via vi.mock in each spec
// ============================================================================

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim()
}

/** Default queryOne mock — tries custom handlers, then generic table scan */
export async function mockQueryOne<T = any>(sql: string, ...params: unknown[]): Promise<T | undefined> {
  const normalized = normalizeSql(sql)

  // Custom handlers first
  for (const handler of _state.queryOneHandlers) {
    const result = handler(normalized, params)
    if (result !== null && result !== undefined) return result as T
  }

  // Generic: SELECT COUNT(*)::int as count FROM {table}
  const countMatch = normalized.match(/SELECT COUNT\(\*\)::int as count FROM (\w+)(.*)/)
  if (countMatch) {
    const table = countMatch[1]
    const rows = _state.tables[table] ?? []
    // Basic WHERE filtering
    const wherePart = countMatch[2] ?? ''
    if (wherePart.includes('WHERE')) {
      // Let custom handlers handle complex WHERE clauses
      return { count: rows.length } as T
    }
    return { count: rows.length } as T
  }

  // Generic: SELECT * FROM {table} WHERE id = $N
  const byIdMatch = normalized.match(/SELECT .+ FROM (\w+) WHERE id = \$1/)
  if (byIdMatch && !normalized.includes('JOIN')) {
    const table = byIdMatch[1]
    const rows = _state.tables[table] ?? []
    return rows.find(r => r.id === params[0]) as T | undefined
  }

  return undefined
}

/** Default queryAll mock — tries custom handlers, then generic table scan */
export async function mockQueryAll<T = any>(sql: string, ...params: unknown[]): Promise<T[]> {
  const normalized = normalizeSql(sql)

  // Custom handlers first
  for (const handler of _state.queryAllHandlers) {
    const result = handler(normalized, params)
    if (result !== null) return result as T[]
  }

  // Generic: SELECT * FROM {table}
  const simpleSelect = normalized.match(/^SELECT \* FROM (\w+)$/)
  if (simpleSelect) {
    return (_state.tables[simpleSelect[1]] ?? []) as T[]
  }

  return []
}

/** Default execute mock — tries custom handlers, then default changes=1 */
export async function mockExecute(sql: string, ...params: unknown[]): Promise<{ changes: number }> {
  const normalized = normalizeSql(sql)

  // Custom handlers first
  for (const handler of _state.executeHandlers) {
    const result = handler(normalized, params)
    if (result !== null) return result
  }

  // Generic DELETE
  if (normalized.startsWith('DELETE FROM')) {
    return { changes: 1 }
  }

  // Generic UPDATE
  if (normalized.startsWith('UPDATE ')) {
    return { changes: 1 }
  }

  // Generic INSERT
  if (normalized.startsWith('INSERT INTO')) {
    return { changes: 1 }
  }

  return { changes: 0 }
}

/** Default insertReturningId mock */
export async function mockInsertReturningId(sql: string, ...params: unknown[]): Promise<number> {
  const normalized = normalizeSql(sql)

  // Custom handlers first
  for (const handler of _state.insertHandlers) {
    const result = handler(normalized, params)
    if (result !== null) return result
  }

  // Extract table name for sequence
  const tableMatch = normalized.match(/INSERT INTO (\w+)/)
  const table = tableMatch?.[1] ?? 'default'
  return nextId(table)
}

// ============================================================================
// Factory — creates the mock module object for vi.mock
// ============================================================================

export function createQueryMocks() {
  return {
    queryOne: vi.fn(mockQueryOne),
    queryAll: vi.fn(mockQueryAll),
    execute: vi.fn(mockExecute),
    insertReturningId: vi.fn(mockInsertReturningId),
  }
}

// ============================================================================
// Compat shims — maintained for any old code that might reference these
// ============================================================================

/** @deprecated Use resetMockDbState() + seedTable() instead */
export function setMockDb(_db: unknown): void {
  // no-op — PGlite tests don't need this anymore
}

/** @deprecated Use resetMockDbState() instead */
export function clearMockDb(): void {
  resetMockDbState()
}
