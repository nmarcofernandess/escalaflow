# DIRETRIZ: Tools Inteligentes, Nao Micronizadas

> Nota de status (2026-02-23+): este documento registra a **virada de estrategia** e usa um exemplo conservador de **19 tools**. O runtime real do EscalaFlow evoluiu para **28 tools** (ainda abaixo do teto de 30), mantendo o principio central: **nao criar wrappers CRUD/read redundantes**.

## O Problema

O catalogo atual (`CATALOGO_TARGET_TOOLS_IA.md`) planeja **60+ tools** com wrappers semanticos para cada operacao CRUD de cada entidade. O `tools.ts` ja foi de 1400 para 2840 linhas e tem 24 tools expostas ao LLM.

Isso e over-engineering. E vai piorar.

## Por que e um problema

1. **Mais tools = mais confusao pro LLM.** Modelos performam MELHOR com menos tools bem descritas do que com dezenas de opcoes parecidas. Com 24 tools, o modelo ja esta num territorio onde a escolha de tool vira roleta. Com 60, e caos.

2. **Wrappers que so delegam nao agregam valor.** `criar_excecao` chama `executeTool('criar', ...)` por baixo. `listar_setores` faz um SELECT que `consultar("setores")` ja faz. A IA nao fica mais inteligente — fica com mais opcoes pro mesmo resultado.

3. **O arquivo vira unmaintainable.** 2840 linhas hoje, 8000 amanha. Cada tool precisa de schema Zod, handler, testes, descricao, _meta. Multiplicar por 60 e insustentavel pra um projeto de 1 pessoa.

## O Modelo Certo: Neural

O projeto Neural (MCP server do operador) gerencia **6 tipos de entidade** (person, project, sprint, task, memory, note) com **10 tools**:

```
DISCOVERY (1 tool)
  get_manifest()         → Retorna TUDO: IDs, counts, metadata de todo o sistema

CRUD GENERICO (4 tools)
  get(entity_type, id)
  create(entity_type, data)
  update(entity_type, id, data)
  delete(entity_type, id)

SEMANTICO (5 tools — so quando o generico NAO resolve)
  search()               → Full-text + tags + filtros (CRUD nao faz isso)
  list_tasks()           → Agregacao com projeto/sprint (JOIN complexo)
  get_related_entities() → Navegacao de relacoes (project→sprints→tasks)
  create_knowledge_note()→ Shortcut de UX (cria em projeto default)
  update_instructions()  → Meta-operacao (nao e CRUD)
```

**10 tools. 6 entidades. Funciona perfeitamente.**

A filosofia: **o LLM TEM RACIOCINIO. Se ele tem contexto (discovery) e tools genericas (CRUD), ele SABE montar a query certa.** Nao precisa de `listar_excecoes`, `listar_excecoes_ativas`, `listar_excecoes_colaborador` — precisa de `consultar("excecoes", {colaborador_id: 5, tipo: "FERIAS"})`.

## Regra pra decidir se uma tool semantica deve existir

Pergunte: **"A IA consegue fazer isso com as tools genericas + raciocinio?"**

- SIM → Nao cria tool semantica. A IA sabe usar consultar/criar/atualizar.
- NAO → Cria. Porque envolve logica que o LLM nao pode executar sozinho.

### Exemplos de SIM (nao precisa de tool):

| Operacao | Como a IA faz com genericas |
|----------|----------------------------|
| Listar setores | `consultar("setores")` |
| Listar colaboradores do setor | `consultar("colaboradores", {setor_id: 3})` |
| Criar excecao | `criar("excecoes", {colaborador_id: 5, tipo: "FERIAS", ...})` |
| Listar excecoes ativas | `consultar("excecoes", {colaborador_id: 5})` + raciocinio |
| Deletar feriado | `deletar("feriados", 12)` |
| Listar regras do motor | `consultar("regra_definicao")` |

### Exemplos de NAO (precisa de tool semantica):

| Operacao | Por que o generico nao resolve |
|----------|-------------------------------|
| `buscar_colaborador` por nome fuzzy | `consultar` nao faz LIKE case-insensitive + substring match |
| `diagnosticar_escala` | Roda PolicyEngine + agrega violacoes + sugere acoes. Logica complexa. |
| `preflight_completo` | Chama `buildSolverInput` + enrichCapacityChecks. Nao e um SELECT. |
| `ajustar_horario` | Chama `salvarTimelineDia` (IPC handler que generico nao acessa) |
| `salvar_regra_horario_colaborador` | INSERT OR UPDATE em tabela que genericos nao cobrem |
| `gerar_escala` | Spawn Python solver. Obvio. |
| `definir_janela_colaborador` | Wrapper que traduz "so de manha" → campos inicio_min/max/fim_min/max |

## O que fazer agora

### 1. MANTER (tools que fazem algo unico):

```
get_context              → Discovery completo
consultar                → SELECT generico com enrichment
criar                    → INSERT generico com defaults
atualizar                → UPDATE generico
deletar                  → DELETE generico
cadastrar_lote           → Batch INSERT
gerar_escala             → Solver Python
ajustar_alocacao         → Fixa status dia/colab
ajustar_horario          → Timeline (hora_inicio/hora_fim)
oficializar_escala       → Valida + trava
editar_regra             → Override regra motor
preflight                → Check rapido
preflight_completo       → Check com capacity (logica propria)
explicar_violacao        → Dicionario
diagnosticar_escala      → Agregacao complexa + validacao
buscar_colaborador       → Busca por nome fuzzy
salvar_regra_horario_colaborador → CRUD em tabela sem acesso generico
obter_regra_horario_colaborador  → Leitura de tabela sem acesso generico
definir_janela_colaborador       → Traduz intent natural → campos tecnicos
```

**19 tools.** Cada uma faz algo que as outras nao fazem.

### 2. REMOVER (wrappers que so delegam):

```
listar_setores                   → consultar("setores") faz o mesmo
listar_colaboradores_do_setor    → consultar("colaboradores", {setor_id}) faz o mesmo
obter_escala_atual               → consultar("escalas", {setor_id, status}) faz o mesmo
criar_excecao                    → criar("excecoes", {...}) faz o mesmo
```

### 3. NAO CRIAR na Onda 2+:

Toda a lista de wrappers CRUD do catalogo (criar_colaborador, atualizar_colaborador, desativar_colaborador, criar_setor, criar_feriado, remover_feriado, listar_demandas_setor, etc.) — **CANCELAR**. A IA sabe usar as genericas.

### 4. SO CRIAR se cai na regra do "NAO":

Avaliar caso a caso na Onda 2. Candidatas reais:
- `resumir_horas_setor_periodo` → Agregacao complexa que consultar nao faz
- `exportar_escala_html` → Acesso a filesystem que genericos nao tem
- `ciclo_rotativo_*` → IPC handlers sem acesso generico

## Resultado esperado

- `tools.ts` volta pra ~1800-2000 linhas (de 2840)
- 19 tools em vez de 24 (e em vez de 60+ planejadas)
- Cada tool justifica sua existencia
- LLM performa melhor com menos opcoes
- Manutencao sustentavel pra projeto de 1 pessoa

## Analise de proporcao: entidades vs tools

Antes de implementar qualquer coisa, faz essa conta.

### Neural (referencia)

| Entidades | Tools | Ratio | Genericas | Semanticas |
|-----------|-------|-------|-----------|------------|
| 6 | 10 | 1.67 | 4 (CRUD) | 6 (logica propria) |

### EscalaFlow

| Entidades (tabelas) | Tools hoje | Tools propostas | Ratio proposto |
|---------------------|-----------|-----------------|----------------|
| 21 | 24 | ~19 | 0.90 |

EscalaFlow tem **3.5x mais entidades** que Neural mas precisa de **menos tools por entidade**. Por que? Porque as genericas (`consultar` acessa 12 entidades, `criar` acessa 7) ja cobrem o CRUD de todas.

A diferenca real entre Neural e EscalaFlow nao e quantidade de entidades — e a **natureza das operacoes**:

| Tipo de operacao | Neural | EscalaFlow |
|---|---|---|
| CRUD puro de dados | 100% | ~60% |
| Motor/solver computacional | Nao tem | Sim (OR-Tools, preflight, validacao) |
| State machines (lifecycle) | Nao tem | Sim (RASCUNHO→OFICIAL→ARQUIVADA) |
| Regras de negocio complexas | Nao tem | Sim (35 regras CLT, precedencia, janelas) |
| Agregacao/diagnostico | Nao tem | Sim (indicadores, violacoes, cobertura) |

Neural e um sistema de **dados**. EscalaFlow e um sistema de **dados + computacao + regras de negocio**. As tools semanticas do EscalaFlow existem por causa da computacao e das regras — nao por causa de CRUD.

### Composicao das 19 tools propostas

```
GENERICAS (5) — cobrem CRUD de todas as 21 entidades
  consultar, criar, atualizar, deletar, cadastrar_lote

DISCOVERY (2) — bootstrap + busca inteligente
  get_context, buscar_colaborador (fuzzy por nome)

MOTOR/SOLVER (4) — operacoes computacionais
  gerar_escala, preflight, preflight_completo, oficializar_escala

DIAGNOSTICO (2) — agregacao + validacao complexa
  diagnosticar_escala, explicar_violacao

AJUSTE MANUAL (2) — IPC handlers que genericas nao acessam
  ajustar_alocacao (status), ajustar_horario (timeline)

REGRAS INDIVIDUAIS (4) — tabelas fora do whitelist + traducao de intent
  editar_regra, salvar_regra_horario_colaborador,
  obter_regra_horario_colaborador, definir_janela_colaborador
```

### Tua tarefa

**Analisa as 24 tools que tu tem hoje aplicando a regra: "a IA consegue fazer isso com genericas + raciocinio?"**

Pra cada tool semantica que tu criou, responde:
1. Ela faz algo que `consultar/criar/atualizar/deletar` NAO faz? (JOIN, validacao, IPC handler novo, agregacao)
2. Ou ela e um SELECT/INSERT que as genericas ja cobrem?

Se a resposta for 2 → remove. Ajusta o prompt e os testes pra refletir.

O numero final pode ser 17, 19, 21 — o que importa e que cada tool **justifique sua existencia** com logica propria. Nao com conveniencia de naming.

## Meta

**A IA nao precisa de um cardapio de 60 pratos. Precisa de uma faca boa, um fogao, e saber cozinhar.**
