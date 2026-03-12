import { execute, queryAll, queryOne } from './db/query'
import type { EscalaEquipeSnapshot } from '../shared'

export function parseEscalaEquipeSnapshot(raw: string | null | undefined): EscalaEquipeSnapshot | undefined {
  if (!raw) return undefined
  try {
    const parsed = JSON.parse(raw) as EscalaEquipeSnapshot
    if (!parsed || !Array.isArray(parsed.funcoes) || !Array.isArray(parsed.colaboradores)) {
      return undefined
    }
    return parsed
  } catch {
    return undefined
  }
}

export async function buildEscalaEquipeSnapshot(setorId: number): Promise<EscalaEquipeSnapshot> {
  const [funcoes, colaboradores] = await Promise.all([
    queryAll<{
      id: number
      apelido: string
      tipo_contrato_id: number
      cor_hex: string | null
      ordem: number
    }>(
      `
        SELECT id, apelido, tipo_contrato_id, cor_hex, ordem
        FROM funcoes
        WHERE setor_id = ?
        ORDER BY ordem ASC, apelido ASC
      `,
      setorId,
    ),
    queryAll<{
      id: number
      nome: string
      sexo: 'M' | 'F'
      tipo_contrato_id: number
      funcao_id: number | null
    }>(
      `
        SELECT id, nome, sexo, tipo_contrato_id, funcao_id
        FROM colaboradores
        WHERE setor_id = ? AND ativo = TRUE
        ORDER BY rank ASC, nome ASC
      `,
      setorId,
    ),
  ])

  return {
    funcoes,
    colaboradores,
  }
}

export async function atualizarEscalaEquipeSnapshot(escalaId: number, setorId?: number): Promise<EscalaEquipeSnapshot> {
  let resolvedSetorId = setorId
  if (resolvedSetorId == null) {
    const escala = await queryOne<{ setor_id: number }>('SELECT setor_id FROM escalas WHERE id = ?', escalaId)
    if (!escala) throw new Error('Escala nao encontrada para atualizar snapshot de equipe')
    resolvedSetorId = escala.setor_id
  }

  const snapshot = await buildEscalaEquipeSnapshot(resolvedSetorId)
  await execute(
    'UPDATE escalas SET equipe_snapshot_json = ? WHERE id = ?',
    JSON.stringify(snapshot),
    escalaId,
  )
  return snapshot
}
