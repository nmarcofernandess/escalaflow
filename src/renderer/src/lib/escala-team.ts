import type { Colaborador, EscalaCompletaV3, Funcao } from '@shared/index'

export function resolveEscalaEquipe(
  detalhe: EscalaCompletaV3 | null | undefined,
  fallbackColaboradores: Colaborador[] = [],
  fallbackFuncoes: Funcao[] = [],
): { colaboradores: Colaborador[]; funcoes: Funcao[] } {
  const snapshot = detalhe?.snapshot_equipe
  if (!detalhe || !snapshot) {
    return {
      colaboradores: fallbackColaboradores,
      funcoes: fallbackFuncoes,
    }
  }

  const colabFallbackMap = new Map(fallbackColaboradores.map((colab) => [colab.id, colab]))
  const funcoesFallbackMap = new Map(fallbackFuncoes.map((funcao) => [funcao.id, funcao]))

  const colaboradores: Colaborador[] = snapshot.colaboradores.map((item, index) => {
    const fallback = colabFallbackMap.get(item.id)
    return {
      id: item.id,
      setor_id: fallback?.setor_id ?? detalhe.escala.setor_id,
      tipo_contrato_id: item.tipo_contrato_id,
      nome: item.nome,
      sexo: item.sexo,
      horas_semanais: fallback?.horas_semanais ?? 0,
      rank: fallback?.rank ?? index,
      prefere_turno: fallback?.prefere_turno ?? null,
      evitar_dia_semana: fallback?.evitar_dia_semana ?? null,
      ativo: fallback?.ativo ?? true,
      tipo_trabalhador: fallback?.tipo_trabalhador ?? 'CLT',
      funcao_id: item.funcao_id,
    }
  })

  const funcoes: Funcao[] = [...snapshot.funcoes]
    .sort((a, b) => a.ordem - b.ordem || a.apelido.localeCompare(b.apelido))
    .map((item) => {
      const fallback = funcoesFallbackMap.get(item.id)
      return {
        id: item.id,
        setor_id: fallback?.setor_id ?? detalhe.escala.setor_id,
        apelido: item.apelido,
        tipo_contrato_id: item.tipo_contrato_id,
        ativo: fallback?.ativo ?? true,
        ordem: item.ordem,
        cor_hex: item.cor_hex,
      }
    })

  return { colaboradores, funcoes }
}
