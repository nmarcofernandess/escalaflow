# Catalogo Target de Tools da IA (Teorico, Completo)

## Objetivo

Mapear, de forma teorica e organizada, **todas as tools que a IA do EscalaFlow vai precisar** para sair de "boa em escalas/regras" para "autonoma no produto inteiro", sem depender da UI para operacoes frequentes.

Este catalogo:

- reaproveita o que ja foi proposto em `SISTEMA_TOOL_CALLING_ATUAL_E_GUIA_IA.md` e `PLANO_EVOLUCAO_TOOL_CALLING_E_TESTES.md`
- faz double-check com o doc canonico `COMO_O_SISTEMA_FUNCIONA.md`
- separa **MVP de semantica (Fase 4)** vs **catalogo completo de longo prazo**

## Atualizacao de estrategia (2026-02-23) — "Tools inteligentes, nao micronizadas"

Este catalogo continua util como **mapa teorico** do que existe no sistema, mas **nao deve ser lido como backlog literal de implementacao 1:1**.

Diretriz atual:

- manter poucas tools genericas fortes (`consultar/criar/atualizar/deletar/cadastrar_lote`) para CRUD/read
- criar tools semanticas **somente** quando ha logica propria que o LLM nao consegue executar com genericas + raciocinio:
  - fuzzy search
  - solver/validacao computacional
  - agregacao/diagnostico
  - IPC handlers fora do whitelist generico
  - traducao de intent natural para campos tecnicos

Consequencia pratica:

- wrappers como `listar_setores`, `listar_colaboradores_do_setor`, `obter_escala_atual`, `criar_excecao` foram **removidos do registry/runtime**
- varias linhas deste catalogo passam a ser **candidatas canceladas** (ou "so criar se provar que genericas nao resolvem")
- target operacional deve permanecer **enxuto e abaixo do teto de 30 tools** (na pratica, hoje o runtime ja opera com 28 tools apos avancos da Onda 2 parcial)

## Fontes usadas (double-check)

- `docs/flowai/COMO_O_SISTEMA_FUNCIONA.md`
  - mapa de 80 handlers por dominio (secao 5.1)
  - gaps atuais da IA (secao 5.4 / 7.4.1 / 8.4)
  - recomendacao de `preflight_completo`
- `docs/flowai/SISTEMA_TOOL_CALLING_ATUAL_E_GUIA_IA.md`
  - taxonomia por camadas (A/B/C/D)
  - primeiras tools semanticas propostas
- `docs/flowai/PLANO_EVOLUCAO_TOOL_CALLING_E_TESTES.md`
  - Fase 4 (MVP de semantica)

## Estado atual (baseline real)

Nota de leitura:

- este catalogo continua sendo **mapa teorico** (com backlog e candidatas)
- o runtime real ja avancou alem do nucleo inicial (ex.: demanda por data, perfis de horario, alertas, KPI, reset)

Hoje a IA tem (expostas no registry) o nucleo de:

- discovery generico: `get_context`, `consultar`
- CRUD generico: `criar`, `atualizar`, `deletar`, `cadastrar_lote`
- regras/escala: `preflight`, `gerar_escala`, `ajustar_alocacao`, `oficializar_escala`, `editar_regra`, `explicar_violacao`

Observacao:

- `resumo_sistema` foi removida do registry/runtime da IA (deprecated).

## Como ler este catalogo

Colunas:

- `Status atual`: `existente`, `proposta antiga`, `nova (double-check)`, `opcional`
- `Prioridade`:
  - `P0` = desbloqueia autonomia real em fluxo frequente
  - `P1` = alta alavanca operacional
  - `P2` = cobertura avancada / gaps importantes
  - `P3` = admin/rare/alto risco
- `Fase`: onde faz mais sentido implementar (em ondas)

## 1) Camada A — Discovery e Resolucao (read-only, baratas)

Objetivo: resolver nomes, IDs, estado atual e contexto sem depender de `consultar` para tudo.

| Tool (target) | Status atual | Prioridade | Fase | Base no sistema | Motivo |
|---|---|---:|---|---|---|
| `get_context` | existente | P0 | ja existe | `tools.ts` | Discovery global / refresh |
| `listar_setores` | proposta antiga | P0 | Fase 4 | `setores.listar` | Reduz `consultar("setores")` |
| `buscar_setor` | nova (double-check) | P1 | Fase 4/5 | `setores.buscar` | Nome/ID -> setor com detalhes |
| `listar_colaboradores_do_setor` | nova (double-check) | P0 | Fase 4 | `colaboradores.listar` | Fluxo frequente de RH |
| `buscar_colaborador` | proposta antiga | P0 | Fase 4 | `colaboradores.buscar` + busca por nome | Nome -> ID + dados uteis |
| `listar_funcoes_do_setor` | nova (double-check) | P1 | Fase 5 | `funcoes.listar` | IA entender postos/funcoes |
| `listar_escalas_do_setor` | proposta antiga | P0 | Fase 4 | `escalas.listarPorSetor` | Evita SQL mental |
| `obter_escala_atual` | proposta antiga | P0 | Fase 4 | `escalas.resumoPorSetor` / `escalas.listarPorSetor` | "Como esta o setor X?" |
| `obter_escala_completa` | nova (double-check) | P1 | Fase 5 | `escalas.buscar` | Leitura rica sem `consultar(alocacoes)` + joins |
| `listar_feriados` | nova (double-check) | P1 | Fase 5 | `feriados.listar` | Regras legais/cct no periodo |
| `listar_excecoes` | nova (double-check) | P1 | Fase 5 | `excecoes.listar` | Leitura sem `consultar` |
| `listar_excecoes_ativas` | nova (double-check) | P1 | Fase 5 | `excecoes.listarAtivas` | Perguntas do tipo "tem atestado ativo?" |
| `listar_regras_motor` | nova (double-check) | P1 | Fase 5 | `regras.listar` | Ver status/edicao sem `consultar` |
| `listar_regras_editaveis` | proposta antiga | P1 | Fase 4/5 | `regras.listar` filtrado | Reduz erro em `editar_regra` |
| `dashboard_resumo` | nova (double-check) | P2 | Fase 6 | `dashboard.resumo` | Substituto semantico de `resumo_sistema` |

## 2) Camada B — Validacao e Diagnostico (read/diag)

Objetivo: validar antes de escrever e explicar falhas com proxima acao sugerida.

| Tool (target) | Status atual | Prioridade | Fase | Base no sistema | Motivo |
|---|---|---:|---|---|---|
| `preflight` | existente (simplificado) | P0 | ja existe | `tools.ts` | Bom para triagem rapida |
| `preflight_completo` | nova (recomendada no doc canonico) | P0 | Fase 4/5 | `escalas.preflight` / `buildEscalaPreflight` | Mesma visao da UI; evita falso "ok" |
| `explicar_violacao` | existente | P0 | ja existe | `tools.ts` | Educacao + UX |
| `diagnosticar_escala` | proposta antiga | P0 | Fase 4 | `escalas.buscar` + `validarEscalaV3` + regras | Resumo + violacoes + proximas opcoes |
| `diagnosticar_infeasibilidade` | nova (double-check) | P1 | Fase 5 | `gerar_escala` diagnostico + regras | Explicar INFEASIBLE e sugerir relaxamentos |
| `simular_oficializacao` | proposta antiga (opcional) | P2 | Fase 5 | `escalas.buscar` + validacao | Guardrail antes de `oficializar_escala` |
| `comparar_escalas` | nova (double-check) | P2 | Fase 5/6 | gap citado no doc canonico | Delta entre versoes de escala |
| `resumir_horas_setor_periodo` | nova (double-check) | P1 | Fase 5 | agrega escalas/alocacoes | "Resumo de horas do setor" (gap 7.4.1) |
| `validar_ajuste_manual` | nova (double-check) | P2 | Fase 5 | `validarEscalaV3` apos ajuste | Evita ajuste manual quebrar regra sem feedback |

## 3) Camada C — Acoes de Escala (core de operacao)

Objetivo: gerar, revisar, ajustar e oficializar com seguranca.

| Tool (target) | Status atual | Prioridade | Fase | Base no sistema | Motivo |
|---|---|---:|---|---|---|
| `gerar_escala` | existente | P0 | ja existe | `tools.ts` / solver | Core action |
| `gerar_escala_avancada` (ou expandir `gerar_escala`) | nova (double-check) | P1 | Fase 5 | `escalas.gerar` | Expor `solve_mode`, `max_time_seconds`, `regimes_override` |
| `ajustar_alocacao` | existente (status-only) | P0 | ja existe | `tools.ts` | Ajuste rapido TRABALHO/FOLGA |
| `ajustar_horario` (ou ampliar `ajustar_alocacao`) | nova (gap P0 no doc canonico) | P0 | Fase 4/5 | `escalas.ajustar` | Ajustar horarios, nao so status |
| `ajustar_alocacoes_em_lote` | nova (double-check) | P1 | Fase 5 | `escalas.ajustar` | Trocas em lote + revalidacao |
| `oficializar_escala` | existente | P0 | ja existe | `tools.ts` | Acao critica |
| `deletar_escala` | nova (double-check) | P2 | Fase 5 | `escalas.deletar` | Limpeza/reversao de rascunho |
| `listar_escalas_resumo_por_setor` | nova (double-check) | P2 | Fase 5 | `escalas.resumoPorSetor` | Discovery operacional por setor |

## 4) Camada D — RH / Cadastros Operacionais (P0/P1 de autonomia real)

Objetivo: tirar a IA da dependencia de CRUD generico para tarefas frequentes de RH.

### 4.1 Colaboradores

| Tool (target) | Status atual | Prioridade | Fase | Base no sistema | Motivo |
|---|---|---:|---|---|---|
| `criar_colaborador` | nova (wrapper semantico) | P1 | Fase 4 | `colaboradores.criar` | Mais seguro que `criar("colaboradores")` |
| `atualizar_colaborador` | nova (wrapper semantico) | P1 | Fase 4/5 | `colaboradores.atualizar` | Semantica alta |
| `desativar_colaborador` | nova (wrapper semantico) | P1 | Fase 5 | `colaboradores.deletar` (soft delete) | Expressa regra de negocio |
| `reordenar_rank_colaboradores_setor` | nova (double-check) | P2 | Fase 6 | `setores.reordenarRank` | RH mexe em prioridade/senioridade |

### 4.2 Excecoes (ferias, atestado, bloqueio)

| Tool (target) | Status atual | Prioridade | Fase | Base no sistema | Motivo |
|---|---|---:|---|---|---|
| `criar_excecao` | proposta antiga | P0 | Fase 4 | `excecoes.criar` | Fluxo frequente e sensivel |
| `atualizar_excecao` | nova (double-check) | P1 | Fase 5 | `excecoes.atualizar` | Ajuste de periodo/tipo |
| `remover_excecao` | nova (double-check) | P1 | Fase 5 | `excecoes.deletar` | Corrigir cadastro |
| `listar_excecoes_colaborador` | nova (double-check) | P1 | Fase 5 | `excecoes.listar` | Investigacao rapida |

### 4.3 Funcoes / Postos

| Tool (target) | Status atual | Prioridade | Fase | Base no sistema | Motivo |
|---|---|---:|---|---|---|
| `criar_funcao` | nova (double-check) | P1 | Fase 5 | `funcoes.criar` | Cadastros de posto pela IA |
| `atualizar_funcao` | nova (double-check) | P1 | Fase 5 | `funcoes.atualizar` | Cor/ordem/apelido |
| `desativar_funcao` | nova (double-check) | P1 | Fase 5 | `funcoes.deletar` (soft delete) | Semantica correta |

### 4.4 Setores

| Tool (target) | Status atual | Prioridade | Fase | Base no sistema | Motivo |
|---|---|---:|---|---|---|
| `criar_setor` | proposta antiga | P1 | Fase 5 | `setores.criar` | Wrapper semantico |
| `atualizar_setor` | nova (double-check) | P1 | Fase 5 | `setores.atualizar` | Evita `atualizar` generico |
| `desativar_setor` | nova (double-check) | P1 | Fase 5 | `setores.deletar` (soft delete) | Semantica correta |

### 4.5 Feriados

| Tool (target) | Status atual | Prioridade | Fase | Base no sistema | Motivo |
|---|---|---:|---|---|---|
| `criar_feriado` | nova (double-check) | P1 | Fase 5 | `feriados.criar` | Cadastro legal/cct |
| `remover_feriado` | nova (double-check) | P1 | Fase 5 | `feriados.deletar` | Correcao |

## 5) Camada E — Configuracoes de Demanda e Horarios (alto impacto, mais risco)

Objetivo: permitir que a IA execute configuracoes que hoje ela so orienta na UI.

### 5.1 Demandas semanais e timeline do setor

| Tool (target) | Status atual | Prioridade | Fase | Base no sistema | Motivo |
|---|---|---:|---|---|---|
| `listar_demandas_setor` | nova (double-check) | P1 | Fase 5 | `setores.listarDemandas` | Leitura sem SQL |
| `criar_demanda_setor` | nova (double-check) | P1 | Fase 5 | `setores.criarDemanda` | Configurar cobertura |
| `atualizar_demanda_setor` | nova (double-check) | P1 | Fase 5 | `setores.atualizarDemanda` | Ajustes pontuais |
| `remover_demanda_setor` | nova (double-check) | P1 | Fase 5 | `setores.deletarDemanda` | Correcao |
| `salvar_timeline_dia_setor` | nova (double-check) | P2 | Fase 6 | `setores.salvarTimelineDia` | Edicao visual via timeline encapsulada |

### 5.2 Demandas por data (excecoes de demanda)

| Tool (target) | Status atual | Prioridade | Fase | Base no sistema | Motivo |
|---|---|---:|---|---|---|
| `listar_demandas_excecao_data` | nova (double-check) | P1 | Fase 5/6 | `setores.listarDemandasExcecaoData` | Gap citado no doc canonico |
| `salvar_demanda_excecao_data` | nova (double-check) | P1 | Fase 5/6 | `setores.salvarDemandaExcecaoData` | Black Friday/feriado |
| `remover_demanda_excecao_data` | nova (double-check) | P1 | Fase 5/6 | `setores.deletarDemandaExcecaoData` | Correcao |

### 5.3 Horarios de funcionamento (empresa / setor)

| Tool (target) | Status atual | Prioridade | Fase | Base no sistema | Motivo |
|---|---|---:|---|---|---|
| `obter_horarios_empresa_semana` | nova (double-check) | P2 | Fase 6 | `empresa.horarios.listar` | Base de horario global |
| `atualizar_horarios_empresa_semana` | nova (double-check) | P2 | Fase 6 | `empresa.horarios.atualizar` | Config global sensivel |
| `listar_horario_setor_semana` | nova (double-check) | P2 | Fase 6 | `setores.listarHorarioSemana` | Overrides por setor |
| `upsert_horario_setor_semana` | nova (double-check) | P2 | Fase 6 | `setores.upsertHorarioSemana` | Overrides por dia |

## 6) Camada F — Contratos e Regras Individuais (grande gap de autonomia)

Objetivo: cobrir os gaps mais importantes apontados no doc canonico ("so pode de manha", perfis, regras por data).

### 6.1 Tipos de contrato

| Tool (target) | Status atual | Prioridade | Fase | Base no sistema | Motivo |
|---|---|---:|---|---|---|
| `listar_tipos_contrato` | nova (double-check) | P1 | Fase 5 | `tiposContrato.listar` | Discovery semantico |
| `buscar_tipo_contrato` | nova (double-check) | P2 | Fase 5 | `tiposContrato.buscar` | Edicao guiada |
| `criar_tipo_contrato` | nova (double-check) | P2 | Fase 6 | `tiposContrato.criar` | Avancado/implantacao |
| `atualizar_tipo_contrato` | nova (double-check) | P2 | Fase 6 | `tiposContrato.atualizar` | Avancado |
| `deletar_tipo_contrato` | nova (double-check) | P3 | Fase 7 | `tiposContrato.deletar` | Alto risco de dependencias |

### 6.2 Perfis de horario por contrato

| Tool (target) | Status atual | Prioridade | Fase | Base no sistema | Motivo |
|---|---|---:|---|---|---|
| `listar_perfis_horario_contrato` | nova (double-check) | P2 | Fase 6 | `tiposContrato.listarPerfisHorario` | Gap atual da IA |
| `criar_perfil_horario_contrato` | nova (double-check) | P2 | Fase 6 | `tiposContrato.criarPerfilHorario` | Config avancada |
| `atualizar_perfil_horario_contrato` | nova (double-check) | P2 | Fase 6 | `tiposContrato.atualizarPerfilHorario` | Ajuste fino |
| `deletar_perfil_horario_contrato` | nova (double-check) | P3 | Fase 7 | `tiposContrato.deletarPerfilHorario` | Risco de quebrar regras existentes |

### 6.3 Regras individuais do colaborador (P0 no negocio)

| Tool (target) | Status atual | Prioridade | Fase | Base no sistema | Motivo |
|---|---|---:|---|---|---|
| `obter_regra_horario_colaborador` | nova (double-check) | P0 | Fase 4/5 | `colaboradores.buscarRegraHorario` | Gap critico "so de manha" |
| `salvar_regra_horario_colaborador` | nova (double-check) | P0 | Fase 4/5 | `colaboradores.salvarRegraHorario` | Gap critico |
| `listar_regras_excecao_data_colaborador` | nova (double-check) | P1 | Fase 5 | `colaboradores.listarRegrasExcecaoData` | Overrides pontuais |
| `upsert_regra_excecao_data_colaborador` | nova (double-check) | P1 | Fase 5 | `colaboradores.upsertRegraExcecaoData` | "No dia X so pode Y" |
| `deletar_regra_excecao_data_colaborador` | nova (double-check) | P1 | Fase 5 | `colaboradores.deletarRegraExcecaoData` | Correcao |

Wrappers semanticos (sobre as tools acima):

| Tool (target) | Status atual | Prioridade | Fase | Motivo |
|---|---|---:|---|---|
| `definir_janela_colaborador` | nova (double-check) | P0 | Fase 4/5 | Pedido natural do usuario (\"so de manha\") |
| `definir_folga_fixa_colaborador` | nova (double-check) | P1 | Fase 5 | Pedido frequente de RH |
| `configurar_ciclo_domingo_colaborador` | nova (double-check) | P1 | Fase 5 | Ajuste fino de rodizio |

## 7) Camada G — Regras do Motor (administracao semantica)

Objetivo: manter a IA boa em regras, mas com mais cobertura que `editar_regra`.

| Tool (target) | Status atual | Prioridade | Fase | Base no sistema | Motivo |
|---|---|---:|---|---|---|
| `editar_regra` | existente | P0 | ja existe | `tools.ts` | Core atual |
| `listar_regras_motor` | nova (double-check) | P1 | Fase 5 | `regras.listar` | Discovery semantico |
| `resetar_regra_motor` | nova (double-check) | P2 | Fase 6 | `regras.resetarRegra` | Reversao rapida |
| `resetar_regras_empresa` | nova (double-check) | P3 | Fase 7 | `regras.resetarEmpresa` | Alto impacto; confirmacao dupla |

## 8) Camada H — Ciclo Rotativo (avancado, mas existe no sistema)

Objetivo: expor uma capacidade forte que hoje a IA so consegue explicar/orientar.

| Tool (target) | Status atual | Prioridade | Fase | Base no sistema | Motivo |
|---|---|---:|---|---|---|
| `detectar_ciclo_rotativo_escala` | nova (double-check) | P2 | Fase 6/7 | `escalas.detectarCicloRotativo` | Diagnosticar padrao repetitivo |
| `salvar_ciclo_rotativo` | nova (double-check) | P2 | Fase 6/7 | `escalas.salvarCicloRotativo` | Criar template de ciclo |
| `listar_ciclos_rotativos` | nova (double-check) | P2 | Fase 6/7 | `escalas.listarCiclosRotativos` | Discovery |
| `gerar_escala_por_ciclo_rotativo` | nova (double-check) | P2 | Fase 6/7 | `escalas.gerarPorCicloRotativo` | Operacao avancada |

## 9) Camada I — Importacao, Export e Dados (alto risco / opcional)

Objetivo: ampliar autonomia de implantacao e operacao, com forte guardrail.

### 9.1 Importacao

| Tool (target) | Status atual | Prioridade | Fase | Base no sistema | Motivo |
|---|---|---:|---|---|---|
| `cadastrar_lote` | existente | P0 | ja existe | `tools.ts` | Batch genericamente util |
| `importar_colaboradores_csv` | nova (double-check) | P1 | Fase 5/6 | wrapper sobre parse + `cadastrar_lote`/IPC | UX semantica (CSV -> preview -> import) |
| `importar_dados_backup` | opcional (alto risco) | P3 | Fase 8+ | `dados.importar` | Melhor nao expor por default |

### 9.2 Exportacao

| Tool (target) | Status atual | Prioridade | Fase | Base no sistema | Motivo |
|---|---|---:|---|---|---|
| `exportar_escala_html` | nova (double-check) | P2 | Fase 6/7 | `export.salvarHTML` / `export.batchHTML` | Pedido real de operacao |
| `exportar_escala_pdf` | nova (double-check) | P2 | Fase 6/7 | `export.imprimirPDF` | Valor operacional alto |
| `exportar_escala_csv` | nova (double-check) | P2 | Fase 6/7 | `export.salvarCSV` | Integracao externa |
| `exportar_dados_backup` | opcional (alto risco) | P3 | Fase 8+ | `dados.exportar` | Admin/suporte, nao IA default |

## 10) Camada J — Escape Hatches (manter, mas com regra)

Essas tools continuam necessarias, mas **nao devem ser o fluxo principal**.

| Tool | Status | Regra de uso |
|---|---|---|
| `consultar` | manter | fallback/admin/debug; nao fluxo padrao quando houver semantica |
| `criar` | manter (transicional) | fallback enquanto wrappers semanticos nao existem |
| `atualizar` | manter (transicional) | idem |
| `deletar` | manter (protegida) | confirmacao + preferir wrappers semanticos |

## 11) Ondas de implementacao (recomendacao realista)

### Onda 1 — P0 de autonomia (Fase 4)

Foco (revisado): resolver os pedidos mais comuns com **tools de logica propria**, mantendo `consultar/criar` para CRUD/read simples.

- `buscar_colaborador`
- `preflight_completo`
- `diagnosticar_escala`
- `obter_regra_horario_colaborador`
- `salvar_regra_horario_colaborador`
- `definir_janela_colaborador`
- `ajustar_horario` (ou ampliar `ajustar_alocacao`)

Usar genericas no lugar de wrappers canceladas:

- `consultar("setores")` em vez de `listar_setores`
- `consultar("colaboradores", {setor_id})` em vez de `listar_colaboradores_do_setor`
- `consultar("escalas", {setor_id})` em vez de `obter_escala_atual`
- `criar("excecoes", ...)` em vez de `criar_excecao`

### Onda 2 — P1 de operacao (Fase 5)

- tools de agregacao/diagnostico/export/IPC nao cobertos por genericas (evitar wrappers CRUD)
- demandas semanais e excecoes por data
- `listar_regras_motor`, `listar_regras_editaveis`
- `resumir_horas_setor_periodo`
- `obter_escala_completa`

### Onda 3 — P2 avancado (Fase 6/7)

- horarios empresa/setor por semana
- perfis de contrato
- ciclo rotativo
- exportacao (HTML/PDF/CSV)
- comparacao de escalas

### Onda 4 — P3 admin/raro (Fase 8+)

- reset global de regras
- import/export de backup
- operacoes destrutivas amplas

## 12) O que ja estava proposto vs o que este catalogo adiciona

Ja proposto nos docs anteriores (mantido):

- `buscar_colaborador`
- `listar_setores`
- `listar_escalas_do_setor`
- `obter_escala_atual`
- `listar_regras_editaveis`
- `diagnosticar_escala`
- `criar_excecao`
- `atualizar_janela_colaborador` (neste catalogo dividido em wrappers mais especificos)

Adicionado neste catalogo (double-check no doc canonico):

- `preflight_completo`
- ferramentas de regras individuais do colaborador (CRUD + wrappers)
- demandas excecao por data
- horarios empresa/setor por semana
- perfis de horario por contrato
- ciclo rotativo (4 tools)
- export/import sob guardrails
- `dashboard_resumo` (substituto semantico de `resumo_sistema`)
- `ajustar_horario` (gap P0 explicito no doc canonico)

## 13) Decisao importante (para evitar over-engineering)

Nao significa implementar tudo agora.

Significa:

- ter o mapa completo para nao esquecer areas do sistema
- priorizar por ondas (P0/P1/P2/P3)
- usar eval batch para validar se cada nova tool realmente reduz uso de `consultar/criar/atualizar`
