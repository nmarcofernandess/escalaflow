import { getDb } from './pglite'

/**
 * Converte placeholders `?` estilo SQLite para `$1, $2, $3...` estilo Postgres.
 * Se a query ja usa $N, retorna inalterada.
 */
function convertPlaceholders(sql: string): string {
  if (sql.includes('$1')) return sql // ja esta no formato Postgres
  let idx = 0
  return sql.replace(/\?/g, () => `$${++idx}`)
}

/**
 * PGlite retorna colunas TIMESTAMPTZ/TIMESTAMP como Date objects JS.
 * SQLite retornava strings. Normalizamos para string ISO aqui para
 * não quebrar nenhuma lógica downstream que espera string.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeRow<T>(row: T): T {
  if (!row || typeof row !== 'object') return row
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(row as Record<string, unknown>)) {
    out[k] = v instanceof Date ? v.toISOString() : v
  }
  return out as T
}

/**
 * Substitui db.prepare(sql).get(...params)
 * Retorna a primeira row ou undefined.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function queryOne<T = any>(sql: string, ...params: unknown[]): Promise<T | undefined> {
  const db = getDb()
  const pgSql = convertPlaceholders(sql)
  const result = await db.query<T>(pgSql, params)
  const row = result.rows[0]
  return row !== undefined ? normalizeRow(row) : undefined
}

/**
 * Substitui db.prepare(sql).all(...params)
 * Retorna array de rows.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function queryAll<T = any>(sql: string, ...params: unknown[]): Promise<T[]> {
  const db = getDb()
  const pgSql = convertPlaceholders(sql)
  const result = await db.query<T>(pgSql, params)
  return result.rows.map(normalizeRow)
}

/**
 * Substitui db.prepare(sql).run(...params)
 * Retorna { changes: number }.
 */
export async function execute(sql: string, ...params: unknown[]): Promise<{ changes: number }> {
  const db = getDb()
  const pgSql = convertPlaceholders(sql)
  const result = await db.query(pgSql, params)
  return { changes: result.affectedRows ?? 0 }
}

/**
 * Substitui .run() + result.lastInsertRowid
 * Appends RETURNING id se nao tiver, retorna o id inserido.
 */
export async function insertReturningId(sql: string, ...params: unknown[]): Promise<number> {
  const db = getDb()
  const pgSql = convertPlaceholders(sql)
  const withReturning = pgSql.match(/RETURNING\s/i) ? pgSql : `${pgSql} RETURNING id`
  const result = await db.query<{ id: number }>(withReturning, params)
  return result.rows[0]?.id ?? 0
}

/**
 * Substitui db.transaction(() => {...})()
 * Usa BEGIN/COMMIT/ROLLBACK explicitamente.
 */
export async function transaction<T>(fn: () => Promise<T>): Promise<T> {
  const db = getDb()
  await db.exec('BEGIN')
  try {
    const result = await fn()
    await db.exec('COMMIT')
    return result
  } catch (e) {
    await db.exec('ROLLBACK')
    throw e
  }
}

/**
 * Substitui db.exec(sql) para DDL e multi-statement.
 */
export async function execDDL(sql: string): Promise<void> {
  const db = getDb()
  await db.exec(sql)
}
