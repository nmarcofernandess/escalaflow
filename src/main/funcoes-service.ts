import { execute, insertReturningId, queryAll, queryOne, transaction } from './db/query'
import type { Funcao, SalvarDetalheFuncaoRequest } from '../shared'

async function listFuncoesOrdenadas(setorId: number): Promise<Array<{ id: number; apelido: string }>> {
  return queryAll<{ id: number; apelido: string }>(
    `
      SELECT id, apelido
      FROM funcoes
      WHERE setor_id = ?
      ORDER BY ordem ASC, apelido ASC
    `,
    setorId,
  )
}

async function listOccupiedPostoIds(setorId: number): Promise<Set<number>> {
  const rows = await queryAll<{ funcao_id: number }>(
    `
      SELECT DISTINCT funcao_id
      FROM colaboradores
      WHERE setor_id = ? AND ativo = TRUE AND funcao_id IS NOT NULL
    `,
    setorId,
  )
  return new Set(rows.map((row) => row.funcao_id))
}

async function persistOrderedFuncoes(funcoes: Array<{ id: number }>): Promise<void> {
  for (let index = 0; index < funcoes.length; index += 1) {
    await execute('UPDATE funcoes SET ordem = ? WHERE id = ?', index, funcoes[index].id)
  }
}

async function reorderFuncoesBySections(setorId: number, changedPostoIds: number[]): Promise<void> {
  const [funcoes, occupiedPostoIds] = await Promise.all([
    listFuncoesOrdenadas(setorId),
    listOccupiedPostoIds(setorId),
  ])

  const changedIds = changedPostoIds.filter((id, index, items) => items.indexOf(id) === index)
  const changedIdSet = new Set(changedIds)
  const stableFuncoes = funcoes.filter((funcao) => !changedIdSet.has(funcao.id))

  const ocupadas = stableFuncoes.filter((funcao) => occupiedPostoIds.has(funcao.id))
  const reserva = stableFuncoes.filter((funcao) => !occupiedPostoIds.has(funcao.id))

  for (const changedId of changedIds) {
    const funcao = funcoes.find((item) => item.id === changedId)
    if (!funcao) continue
    if (occupiedPostoIds.has(changedId)) ocupadas.push(funcao)
    else reserva.push(funcao)
  }

  await persistOrderedFuncoes([...ocupadas, ...reserva])
}

async function reindexFuncoes(setorId: number): Promise<void> {
  const funcoes = await listFuncoesOrdenadas(setorId)
  await persistOrderedFuncoes(funcoes)
}

export async function salvarDetalheFuncao(input: SalvarDetalheFuncaoRequest): Promise<Funcao> {
  const apelido = input.apelido.trim()
  if (!apelido) throw new Error('Nome do posto e obrigatorio')

  const setor = await queryOne<{ id: number }>('SELECT id FROM setores WHERE id = ?', input.setor_id)
  if (!setor) throw new Error('Setor nao encontrado')

  const contrato = await queryOne<{ id: number }>('SELECT id FROM tipos_contrato WHERE id = ?', input.tipo_contrato_id)
  if (!contrato) throw new Error('Tipo de contrato nao encontrado')

  const beforeOccupiedPostoIds = await listOccupiedPostoIds(input.setor_id)
  const funcaoId = await transaction(async () => {
    let resolvedFuncaoId = input.id ?? null
    let titularOrigemFuncaoId: number | null = null

    if (input.id != null) {
      const funcaoAtual = await queryOne<{ id: number; setor_id: number }>(
        'SELECT id, setor_id FROM funcoes WHERE id = ?',
        input.id,
      )
      if (!funcaoAtual) throw new Error('Posto nao encontrado')
      if (funcaoAtual.setor_id !== input.setor_id) throw new Error('Posto pertence a outro setor')

      await execute(
        'UPDATE funcoes SET apelido = ?, tipo_contrato_id = ? WHERE id = ?',
        apelido,
        input.tipo_contrato_id,
        input.id,
      )
      resolvedFuncaoId = input.id
    } else {
      const ordemAtual = await queryOne<{ max_ordem: number }>(
        'SELECT COALESCE(MAX(ordem), -1)::int as max_ordem FROM funcoes WHERE setor_id = ?',
        input.setor_id,
      )
      resolvedFuncaoId = await insertReturningId(
        `
          INSERT INTO funcoes (setor_id, apelido, tipo_contrato_id, ordem)
          VALUES (?, ?, ?, ?)
        `,
        input.setor_id,
        apelido,
        input.tipo_contrato_id,
        (ordemAtual?.max_ordem ?? -1) + 1,
      )
    }

    if (resolvedFuncaoId == null) throw new Error('Falha ao resolver posto para salvar')

    if (input.titular_colaborador_id == null) {
      await execute('UPDATE colaboradores SET funcao_id = NULL WHERE funcao_id = ?', resolvedFuncaoId)
      const afterOccupiedPostoIds = await listOccupiedPostoIds(input.setor_id)
      const changedPostoIds = input.id == null
        ? [resolvedFuncaoId]
        : beforeOccupiedPostoIds.has(resolvedFuncaoId) !== afterOccupiedPostoIds.has(resolvedFuncaoId)
          ? [resolvedFuncaoId]
          : []
      if (changedPostoIds.length > 0) {
        await reorderFuncoesBySections(input.setor_id, changedPostoIds)
      }
      return resolvedFuncaoId
    }

    const titular = await queryOne<{
      id: number
      setor_id: number
      funcao_id: number | null
    }>(
      'SELECT id, setor_id, funcao_id FROM colaboradores WHERE id = ? AND ativo = TRUE',
      input.titular_colaborador_id,
    )
    if (!titular) throw new Error('Titular nao encontrado')
    if (titular.setor_id !== input.setor_id) throw new Error('Titular e posto pertencem a setores diferentes')
    titularOrigemFuncaoId = titular.funcao_id ?? null

    await execute(
      'UPDATE colaboradores SET funcao_id = NULL WHERE funcao_id = ? AND id <> ?',
      resolvedFuncaoId,
      titular.id,
    )
    await execute('UPDATE colaboradores SET funcao_id = ? WHERE id = ?', resolvedFuncaoId, titular.id)

    const afterOccupiedPostoIds = await listOccupiedPostoIds(input.setor_id)
    const changedPostoIds: number[] = []
    if (input.id == null) {
      changedPostoIds.push(resolvedFuncaoId)
    } else if (beforeOccupiedPostoIds.has(resolvedFuncaoId) !== afterOccupiedPostoIds.has(resolvedFuncaoId)) {
      changedPostoIds.push(resolvedFuncaoId)
    }
    if (
      titularOrigemFuncaoId != null
      && titularOrigemFuncaoId !== resolvedFuncaoId
      && beforeOccupiedPostoIds.has(titularOrigemFuncaoId) !== afterOccupiedPostoIds.has(titularOrigemFuncaoId)
    ) {
      changedPostoIds.push(titularOrigemFuncaoId)
    }
    if (changedPostoIds.length > 0) {
      await reorderFuncoesBySections(input.setor_id, changedPostoIds)
    }

    return resolvedFuncaoId
  })

  const funcao = await queryOne<Funcao>('SELECT * FROM funcoes WHERE id = ?', funcaoId)
  if (!funcao) throw new Error('Posto salvo mas nao encontrado em seguida')
  return funcao
}

export async function deletarFuncao(id: number): Promise<void> {
  const funcao = await queryOne<{ id: number; setor_id: number }>(
    'SELECT id, setor_id FROM funcoes WHERE id = ?',
    id,
  )
  if (!funcao) throw new Error('Posto nao encontrado')

  await transaction(async () => {
    await execute('UPDATE colaboradores SET funcao_id = NULL WHERE funcao_id = ?', id)
    await execute('DELETE FROM funcoes WHERE id = ?', id)
    await reindexFuncoes(funcao.setor_id)
  })
}
