# Mapa Final de Tools da IA — EscalaFlow

Data de referencia: `2026-02-24`

## Principio

**"A IA consegue fazer isso com genericas + raciocinio?"**
- SIM → nao cria tool semantica
- NAO → cria (logica propria, tabela fora do whitelist, agregacao, filesystem, IPC especial)

Cap maximo: **30 tools**. Hoje: **30**. Slots livres: **0**.

---

## As 30 tools atuais (todas justificadas)

### Genericas (5) — cobrem leitura de 19 entidades + CRUD parcial

| Tool | O que faz |
|------|-----------|
| `consultar` | SELECT generico com enrichment de FKs (19 entidades no whitelist) |
| `criar` | INSERT generico com defaults inteligentes (7 entidades: colaboradores, excecoes, demandas, tipos_contrato, setores, feriados, funcoes) |
| `atualizar` | UPDATE generico (6 entidades: colaboradores, empresa, tipos_contrato, setores, demandas, excecoes) |
| `deletar` | DELETE generico (4 entidades: excecoes, demandas, feriados, funcoes) |
| `cadastrar_lote` | Batch INSERT ate 200 registros |

### Discovery inteligente (1)

| Tool | O que faz | Por que generica nao resolve |
|------|-----------|------------------------------|
| `buscar_colaborador` | Fuzzy search por nome, deteccao de ambiguidade | `consultar` nao faz LIKE case-insensitive + substring match |

### Motor/Solver (4)

| Tool | O que faz | Por que generica nao resolve |
|------|-----------|------------------------------|
| `gerar_escala` | Spawn Python OR-Tools, salva RASCUNHO. Retorna `revisao` com deficits e carga | Solver computacional |
| `preflight` | Check rapido de viabilidade (setor ativo, colabs, demanda) | Logica de validacao propria |
| `preflight_completo` | Preflight + capacity checks (buildSolverInput) | Logica profunda que preflight basico nao faz |
| `oficializar_escala` | Valida violacoes_hard=0 e trava como OFICIAL | State machine + validacao |

### Diagnostico (2)

| Tool | O que faz | Por que generica nao resolve |
|------|-----------|------------------------------|
| `diagnosticar_escala` | Roda PolicyEngine + agrega violacoes + sugere acoes | Agregacao complexa + validacao |
| `explicar_violacao` | Dicionario de 20+ regras (H1-H18, SOFT, AP) | Referencia estatica, nao e SELECT |

### Ajuste manual (2)

| Tool | O que faz | Por que generica nao resolve |
|------|-----------|------------------------------|
| `ajustar_alocacao` | Fixa status (TRABALHO/FOLGA/INDISPONIVEL) de um dia | UPDATE direto em alocacoes (fora do whitelist de `atualizar`) |
| `ajustar_horario` | Ajusta hora_inicio/hora_fim de uma alocacao | Chama salvarTimelineDia (IPC handler que generico nao acessa) |

### Regras (3)

| Tool | O que faz | Por que generica nao resolve |
|------|-----------|------------------------------|
| `editar_regra` | Override de regra do motor (INSERT OR REPLACE regra_empresa) | Valida editavel=1, nao e UPDATE simples |
| `salvar_regra_horario_colaborador` | Upsert regra individual (janela, ciclo domingo, folga fixa) | Tabela fora do whitelist generico |
| `definir_janela_colaborador` | Traduz "so de manha" → campos inicio_min/max/fim_min/max | Traducao de intent natural → campos tecnicos |

### Excecoes por data (2) — NOVO

| Tool | O que faz | Por que generica nao resolve |
|------|-----------|------------------------------|
| `salvar_demanda_excecao_data` | Cria demanda excepcional por data (Black Friday, eventos) | Tabela `demandas_excecao_data` fora dos whitelists genericos |
| `upsert_regra_excecao_data` | Override pontual de horario por colaborador/data | Tabela `colaborador_regra_horario_excecao_data` fora dos whitelists + UPSERT |

### KPIs e reset (2) — NOVO

| Tool | O que faz | Por que generica nao resolve |
|------|-----------|------------------------------|
| `resumir_horas_setor` | KPIs de horas/dias por colaborador num periodo | Query agregada com JOINs + calculos (nao e SELECT simples) |
| `resetar_regras_empresa` | Volta todas as regras pro padrao (DELETE regra_empresa) | Safety check + contagem + operacao destructiva |

### Perfis de horario por contrato (3) — NOVO

| Tool | O que faz | Por que generica nao resolve |
|------|-----------|------------------------------|
| `listar_perfis_horario` | Lista perfis por tipo de contrato | Leitura guiada de tabela especializada + UX semantica por contrato |
| `salvar_perfil_horario` | Cria/edita perfil com janelas e preferencia de turno | Tabela fora dos whitelists de escrita generica + validacao de payload |
| `deletar_perfil_horario` | Remove perfil por ID | Tabela fora dos whitelists de delecao generica + guardrails de erro |

### Configuracao operacional e alertas (2)

| Tool | O que faz | Por que generica nao resolve |
|------|-----------|------------------------------|
| `configurar_horario_funcionamento` | Configura horario por dia (empresa/setor) com heranca | Escreve em tabelas especializadas + regras de `nivel`/`usa_padrao` |
| `obter_alertas` | Agrega alertas ativos (escalas desatualizadas, pendencias etc.) | Agregacao multi-entidade + heuristicas operacionais |

### Knowledge Layer (4) — NOVO

| Tool | O que faz | Por que generica nao resolve |
|------|-----------|------------------------------|
| `buscar_conhecimento` | Busca semantica na base de conhecimento (RAG) + knowledge graph | Busca vetorial + FTS hibrida, nao e SELECT em tabela |
| `salvar_conhecimento` | Salva conhecimento (chunking + embedding + graph extraction) | Pipeline de ingestao (chunk, embed, extract entities/relations) |
| `listar_conhecimento` | Lista fontes salvas com stats (chunks, entidades, ultimo acesso) | Agregacao multi-tabela knowledge_* |
| `explorar_relacoes` | Explora relacoes no knowledge graph a partir de uma entidade | CTE recursivo com profundidade configuravel |

---

## Whitelists das genericas (referencia)

```
LEITURA (consultar) — 19 entidades:
  colaboradores, setores, escalas, alocacoes, excecoes,
  demandas, tipos_contrato, empresa, feriados, funcoes,
  regra_definicao, regra_empresa,
  demandas_excecao_data, colaborador_regra_horario_excecao_data,
  colaborador_regra_horario,
  contrato_perfis_horario, empresa_horario_semana, setor_horario_semana,
  escala_ciclo_modelos

CRIACAO (criar / cadastrar_lote):
  colaboradores, excecoes, demandas, tipos_contrato, setores, feriados, funcoes

ATUALIZACAO (atualizar):
  colaboradores, empresa, tipos_contrato, setores, demandas, excecoes

DELECAO (deletar):
  excecoes, demandas, feriados, funcoes
```

---

## Cobertura do trabalho diario do RH (com as 30 atuais)

| Operacao do dia a dia | Funciona? | Como |
|---|---|---|
| Gerar escala do mes | SIM | `preflight` → `gerar_escala` (com `revisao`) |
| Cadastrar funcionario | SIM | `criar("colaboradores", {...})` com defaults |
| Consultar quem trabalha tal dia | SIM | `consultar("alocacoes", {escala_id, data})` |
| Colocar alguem de ferias | SIM | `criar("excecoes", {tipo:"FERIAS", ...})` |
| Ajustar horario de alguem | SIM | `ajustar_horario` |
| Definir "so de manha" | SIM | `definir_janela_colaborador` |
| Oficializar escala | SIM | `oficializar_escala` |
| Entender INFEASIBLE | SIM | `explicar_violacao` + `diagnosticar_escala` |
| Importar lista de funcionarios | SIM | `cadastrar_lote` (ate 200) |
| Editar regras do motor | SIM | `editar_regra` |
| Preflight profundo | SIM | `preflight_completo` |
| Criar/deletar feriado | SIM | `criar("feriados")` / `deletar("feriados")` |
| Criar/editar demanda semanal | SIM | `criar("demandas")` / `atualizar("demandas")` |
| Demanda excepcional por data | SIM | `salvar_demanda_excecao_data` |
| Override pontual de horario | SIM | `upsert_regra_excecao_data` |
| Resumo de horas por setor | SIM | `resumir_horas_setor` |
| Resetar regras pro padrao | SIM | `resetar_regras_empresa` |
| Gerir perfis de horario por contrato | SIM | `listar_perfis_horario` / `salvar_perfil_horario` / `deletar_perfil_horario` |
| Ajustar horario de funcionamento (empresa/setor) | SIM | `configurar_horario_funcionamento` |
| Ver alertas operacionais do sistema | SIM | `obter_alertas` |
| Consultar excecoes por data | SIM | `consultar("demandas_excecao_data")` / `consultar("colaborador_regra_horario_excecao_data")` |
| Buscar conhecimento/regras salvas | SIM | `buscar_conhecimento` (RAG semantico + graph) |
| Salvar anotacao/regra na base | SIM | `salvar_conhecimento` |
| Explorar relacoes entre conceitos | SIM | `explorar_relacoes` |
| Exportar escala (PDF/HTML) | NAO | Operacao de UI — orientar usuario a clicar Exportar na pagina |
| Ciclo rotativo | NAO | P3 — avancado |

**Cobertura: alta (trabalho diario de RH + configuracao operacional)**

---

## Gaps restantes (backlog futuro)

| # | Operacao | Tabela/IPC | Prioridade |
|---|---|---|---|
| 1 | Exportar escala | `export.salvarHTML` / `export.imprimirPDF` | UI-only (dialog nativo) |
| 2 | Ciclo rotativo (detectar, salvar, gerar) | `escalas.*CicloRotativo` | P3 |

---

## NAO criar (generica resolve)

- `listar_setores` → `consultar("setores")`
- `listar_colaboradores` → `consultar("colaboradores", {setor_id})`
- `criar_excecao` → `criar("excecoes", {...})`
- `criar_colaborador` → `criar("colaboradores", {...})`
- `criar_feriado` → `criar("feriados", {...})`
- Qualquer wrapper CRUD do catalogo original de 60+

---

## Proporcao final

```
ATUAL (30 tools):  cobertura alta, teto atingido
CAP   (30 tools):  teto atingido — novas tools exigem poda de existentes
```

## Evals

- 20 cenarios de avaliacao (7 categorias + H nova)
- 20/20 passando contra Gemini 2.5 Flash
- Media de 2.2 steps por caso
- Scorer valida: tool correta, args corretos, tools proibidas, budget de steps, texto
