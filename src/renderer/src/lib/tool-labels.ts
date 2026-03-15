const TOOL_LABELS: Record<string, string> = {
  consultar: 'Consultando dados',
  buscar_colaborador: 'Buscando colaborador',
  gerar_escala: 'Gerando escala',
  preflight: 'Validando viabilidade',
  preflight_completo: 'Validacao completa',
  ajustar_alocacao: 'Ajustando alocacao',
  ajustar_horario: 'Ajustando horario',
  oficializar_escala: 'Oficializando escala',
  diagnosticar_escala: 'Diagnosticando escala',
  explicar_violacao: 'Explicando violacao',
  editar_regra: 'Editando regra',
  criar: 'Criando registro',
  atualizar: 'Atualizando registro',
  deletar: 'Removendo registro',
  cadastrar_lote: 'Cadastrando em lote',
  listar_perfis_horario: 'Listando perfis',
  salvar_perfil_horario: 'Salvando perfil',
  deletar_perfil_horario: 'Removendo perfil',
  configurar_horario_funcionamento: 'Configurando horario',
  resumir_horas_setor: 'Resumindo horas',
  salvar_demanda_excecao_data: 'Salvando demanda especial',
  upsert_regra_excecao_data: 'Salvando regra especial',
  resetar_regras_empresa: 'Resetando regras',
  buscar_conhecimento: 'Buscando na base',
  salvar_conhecimento: 'Salvando conhecimento',
  listar_conhecimento: 'Listando conhecimento',
  explorar_relacoes: 'Explorando relacoes',
  salvar_memoria: 'Salvando memoria',
  remover_memoria: 'Removendo memoria',
  salvar_regra_horario_colaborador: 'Salvando regra individual',
}

export function toolLabel(name: string): string {
  return TOOL_LABELS[name] ?? name.replace(/_/g, ' ')
}

// Estimativas base por tool (em segundos)
// gerar_escala depende do solver config, mas a tool da IA usa 60s de timeout
const TOOL_TIME_ESTIMATES: Record<string, number> = {
  consultar: 1,
  buscar_colaborador: 1,
  listar_perfis_horario: 1,
  listar_conhecimento: 1,
  explicar_violacao: 1,
  preflight: 2,
  buscar_conhecimento: 3,
  explorar_relacoes: 3,
  resumir_horas_setor: 2,
  preflight_completo: 10,
  gerar_escala: 30,
  diagnosticar_escala: 15,
}

export function toolEstimatedSeconds(name: string, fromStream?: number): number | undefined {
  if (fromStream) return fromStream
  return TOOL_TIME_ESTIMATES[name]
}
