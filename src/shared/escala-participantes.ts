import type {
  Colaborador,
  EscalaEquipeSnapshot,
  EscalaEquipeSnapshotColaborador,
  EscalaEquipeSnapshotFuncao,
  Funcao,
} from './types'

export interface EscalaParticipante {
  funcao: Funcao
  colaborador: Colaborador
}

function sortFuncoes(funcoes: Funcao[]): Funcao[] {
  return [...funcoes].sort((a, b) => a.ordem - b.ordem || a.apelido.localeCompare(b.apelido))
}

function sortColaboradores(colaboradores: Colaborador[]): Colaborador[] {
  return [...colaboradores].sort((a, b) => a.rank - b.rank || a.nome.localeCompare(b.nome))
}

export function listEscalaParticipantes(
  colaboradores: Colaborador[],
  funcoes: Funcao[],
): EscalaParticipante[] {
  const funcoesAtivas = sortFuncoes(funcoes).filter((funcao) => funcao.ativo)
  const colaboradoresAtivos = sortColaboradores(colaboradores).filter((colaborador) => colaborador.ativo)
  const colaboradorByFuncao = new Map<number, Colaborador>()

  for (const colaborador of colaboradoresAtivos) {
    if (colaborador.funcao_id == null) continue
    if (!colaboradorByFuncao.has(colaborador.funcao_id)) {
      colaboradorByFuncao.set(colaborador.funcao_id, colaborador)
    }
  }

  return funcoesAtivas.flatMap((funcao) => {
    const colaborador = colaboradorByFuncao.get(funcao.id)
    return colaborador ? [{ funcao, colaborador }] : []
  })
}

export function buildEscalaEquipeSnapshotFromEntities(
  colaboradores: Colaborador[],
  funcoes: Funcao[],
): EscalaEquipeSnapshot {
  const participantes = listEscalaParticipantes(colaboradores, funcoes)
  const snapshotFuncoes: EscalaEquipeSnapshotFuncao[] = participantes.map(({ funcao }) => ({
    id: funcao.id,
    apelido: funcao.apelido,
    tipo_contrato_id: funcao.tipo_contrato_id,
    cor_hex: funcao.cor_hex,
    ordem: funcao.ordem,
  }))
  const snapshotColaboradores: EscalaEquipeSnapshotColaborador[] = participantes.map(({ colaborador }) => ({
    id: colaborador.id,
    nome: colaborador.nome,
    sexo: colaborador.sexo,
    tipo_contrato_id: colaborador.tipo_contrato_id,
    funcao_id: colaborador.funcao_id,
  }))

  return {
    funcoes: snapshotFuncoes,
    colaboradores: snapshotColaboradores,
  }
}
