# Mapa Final de Tools da IA — EscalaFlow

Data de referencia: `2026-02-23`

## Principio

**"A IA consegue fazer isso com genericas + raciocinio?"**
- SIM → nao cria tool semantica
- NAO → cria (logica propria, tabela fora do whitelist, agregacao, filesystem, IPC especial)

Cap maximo: **30 tools**. Hoje: **23**. Slots livres: **7**.

---

## As 23 tools atuais (todas justificadas)

### Genericas (6) — cobrem CRUD de 14 entidades

| Tool | O que faz |
|------|-----------|
| `get_context` | Discovery completo (setores, colabs, escalas, contratos com JOINs) |
| `consultar` | SELECT generico com enrichment de FKs (14 entidades no whitelist) |
| `criar` | INSERT generico com defaults inteligentes (7 entidades: colaboradores, excecoes, demandas, tipos_contrato, setores, feriados, funcoes) |
| `atualizar` | UPDATE generico (5 entidades: colaboradores, empresa, tipos_contrato, setores, demandas) |
| `deletar` | DELETE generico (4 entidades: excecoes, demandas, feriados, funcoes) |
| `cadastrar_lote` | Batch INSERT ate 200 registros |

### Discovery inteligente (2)

| Tool | O que faz | Por que generica nao resolve |
|------|-----------|------------------------------|
| `buscar_colaborador` | Fuzzy search por nome, deteccao de ambiguidade | `consultar` nao faz LIKE case-insensitive + substring match |
| `obter_regra_horario_colaborador` | Le regra individual de horario/janela | Tabela `colaborador_regra_horario` fora do whitelist generico |

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

---

## Whitelists das genericas (referencia)

```
LEITURA (consultar) — 14 entidades:
  colaboradores, setores, escalas, alocacoes, excecoes,
  demandas, tipos_contrato, empresa, feriados, funcoes,
  regra_definicao, regra_empresa,
  demandas_excecao_data, colaborador_regra_horario_excecao_data

CRIACAO (criar / cadastrar_lote):
  colaboradores, excecoes, demandas, tipos_contrato, setores, feriados, funcoes

ATUALIZACAO (atualizar):
  colaboradores, empresa, tipos_contrato, setores, demandas

DELECAO (deletar):
  excecoes, demandas, feriados, funcoes
```

---

## Cobertura do trabalho diario do RH (com as 23 atuais)

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
| Consultar excecoes por data | SIM | `consultar("demandas_excecao_data")` / `consultar("colaborador_regra_horario_excecao_data")` |
| Exportar escala (PDF/HTML) | NAO | Operacao de UI — orientar usuario a clicar Exportar na pagina |
| Ciclo rotativo | NAO | P3 — avancado |

**Cobertura: ~93% do trabalho diario**

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
ATUAL (23 tools):  93% do trabalho diario
CAP   (30 tools):  sobra 7 slots pra futuro
```

## Evals

- 20 cenarios de avaliacao (7 categorias + H nova)
- 20/20 passando contra Gemini 2.5 Flash
- Media de 2.2 steps por caso
- Scorer valida: tool correta, args corretos, tools proibidas, budget de steps, texto
