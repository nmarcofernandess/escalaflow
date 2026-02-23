# Como o EscalaFlow Funciona — Doc Canonico para Evolucao da IA

> **Proposito:** Mapeamento completo do sistema para reescrita do system prompt, gap analysis de tools, e evolucao da IA.
>
> **Gerado em:** 2026-02-22 | **Metodo:** Deep dive iterativo por fases, leitura de codigo real.

---

## 1. Visao Geral

**EscalaFlow** e um app desktop offline (Electron 34) para geracao automatica de escalas de trabalho em supermercados. Desenvolvido para o RH do Supermercado Fernandes — usuarios nao tecnicos.

**Principio #1:** O SISTEMA propoe, nao o RH monta na mao. Menor input possivel para gerar escalas para todos os setores.

### Stack

| Camada | Tecnologia |
|--------|-----------|
| Shell | Electron 34 |
| IPC | @egoist/tipc (~80 handlers) |
| Database | better-sqlite3 (SQLite, arquivo local) |
| Motor | Python OR-Tools CP-SAT (via child_process stdin/stdout JSON) |
| Frontend | React 19 + Vite + Tailwind + shadcn/ui + Zustand |
| IA | Gemini/OpenRouter via Vercel AI SDK (`generateText`) |

### Fluxo macro

```
Usuario (React) → IPC (tipc.ts) → Main Process (Node.js)
                                    ├── Database (better-sqlite3)
                                    ├── Motor Python (solver-bridge.ts → spawn solver)
                                    └── IA (cliente.ts → Gemini API)
```

---

## 2. Entidades e Dados (Fase 1)

> **Arquivos fonte:**
> - `src/main/db/schema.ts` — DDL completo (todas as tabelas)
> - `src/main/db/seed.ts` — Dados iniciais de sistema
> - `src/shared/types.ts` — Interfaces TypeScript (contrato de dados)
> - `src/shared/constants.ts` — Constantes CLT, grid, paleta

### 2.1 Mapa de Entidades

O sistema tem **21 tabelas** organizadas em 5 camadas:

#### Camada 1 — Core (operacao diaria)

| Entidade | Tabela | Campos criticos | Notas |
|----------|--------|-----------------|-------|
| **Empresa** | `empresa` | `nome`, `corte_semanal`, `tolerancia_semanal_min`, `min_intervalo_almoco_min`, `usa_cct_intervalo_reduzido`, `grid_minutos` | **Singleton** (1 registro). Config global do supermercado. `corte_semanal` define quando a semana "vira" (SEG_DOM, TER_SEG, etc). `grid_minutos=15` e fonte unica do grid. |
| **TipoContrato** | `tipos_contrato` | `nome`, `horas_semanais`, `regime_escala`, `dias_trabalho`, `trabalha_domingo`, `max_minutos_dia` | 5 templates imutaveis (seed). Define as restricoes legais de cada tipo de trabalhador. |
| **Setor** | `setores` | `nome`, `icone`, `hora_abertura`, `hora_fechamento`, `ativo` | Departamento do supermercado (Acougue, Padaria, Caixa...). `hora_abertura/fechamento` sao defaults — podem ser overridden por `setor_horario_semana`. Soft delete via `ativo`. |
| **Colaborador** | `colaboradores` | `setor_id`, `tipo_contrato_id`, `nome`, `sexo`, `horas_semanais`, `rank`, `prefere_turno`, `evitar_dia_semana`, `tipo_trabalhador`, `funcao_id`, `ativo` | FK setor + contrato. `tipo_trabalhador` (CLT/ESTAGIARIO/APRENDIZ) determina restricoes especiais. `rank` define senioridade (0=junior). `funcao_id` liga ao posto de trabalho. Soft delete. |
| **Funcao** | `funcoes` | `setor_id`, `apelido`, `tipo_contrato_id`, `cor_hex`, `ativo`, `ordem` | Posto de trabalho dentro do setor (Caixa 1, Repositor...). Tem `cor_hex` pra identificacao visual no grid. FK tipo_contrato define qual contrato esse posto exige. |
| **Demanda** | `demandas` | `setor_id`, `dia_semana`, `hora_inicio`, `hora_fim`, `min_pessoas`, `override` | "Quantas pessoas preciso nesse slot". Segmentada por dia da semana e faixa horaria. `override=1` significa que o gestor forcou esse valor (nao e sugestao do sistema). |
| **Excecao** | `excecoes` | `colaborador_id`, `data_inicio`, `data_fim`, `tipo`, `observacao` | Ferias, atestado ou bloqueio. Periodo em que o colaborador esta INDISPONIVEL. Motor respeita como HARD constraint (H5). |

#### Camada 2 — Horarios Granulares (v4/v5)

| Entidade | Tabela | Campos criticos | Notas |
|----------|--------|-----------------|-------|
| **EmpresaHorarioSemana** | `empresa_horario_semana` | `dia_semana`, `ativo`, `hora_abertura`, `hora_fechamento` | Horario de funcionamento da empresa por dia da semana. Fallback global quando setor nao tem horario proprio. UNIQUE(dia_semana). Seed: SEG-SEX 08-22, SAB 08-20, DOM 08-14. |
| **SetorHorarioSemana** | `setor_horario_semana` | `setor_id`, `dia_semana`, `ativo`, `usa_padrao`, `hora_abertura`, `hora_fechamento` | Override do horario da empresa para um setor especifico. `usa_padrao=1` herda da empresa. UNIQUE(setor_id, dia_semana). |
| **PerfilHorarioContrato** | `contrato_perfis_horario` | `tipo_contrato_id`, `nome`, `inicio_min/max`, `fim_min/max`, `preferencia_turno_soft` | Janelas de entrada/saida por tipo de contrato. Seed: 3 perfis de estagiario (Manha 08-12, Tarde 13:30-20, Noite-Estudo 08-14). CLT nao tem perfil (usa janela do setor). |
| **RegraHorarioColaborador** | `colaborador_regra_horario` | `colaborador_id` (UNIQUE), `perfil_horario_id`, `inicio_min/max`, `fim_min/max`, `domingo_ciclo_trabalho/folga`, `folga_fixa_dia_semana` | Regra individual 1:1. Override dos campos do perfil. Ciclo domingo default: 2 trabalho / 1 folga. Folga fixa = dia da semana que SEMPRE folga. |
| **ExcecaoDataColaborador** | `colaborador_regra_horario_excecao_data` | `colaborador_id`, `data`, `inicio_min/max`, `fim_min/max`, `domingo_forcar_folga` | Override pontual por data. Ex: "dia 15/03, Cleunice so pode 08-12". Maior precedencia na hierarquia. UNIQUE(colaborador_id, data). |
| **DemandaExcecaoData** | `demandas_excecao_data` | `setor_id`, `data`, `hora_inicio`, `hora_fim`, `min_pessoas`, `override` | Override de demanda por data especifica (Black Friday, vespera de feriado). Substitui a demanda semanal padrao naquele dia. |

#### Camada 3 — Escala (output do motor)

| Entidade | Tabela | Campos criticos | Notas |
|----------|--------|-----------------|-------|
| **Escala** | `escalas` | `setor_id`, `data_inicio`, `data_fim`, `status`, `pontuacao`, `cobertura_percent`, `violacoes_hard`, `violacoes_soft`, `equilibrio`, `input_hash`, `simulacao_config_json` | **Lifecycle: RASCUNHO → OFICIAL → ARQUIVADA.** So oficializa se `violacoes_hard = 0`. `input_hash` detecta se os dados mudaram desde a ultima geracao. `simulacao_config_json` guarda a config do solver usada. |
| **Alocacao** | `alocacoes` | `escala_id`, `colaborador_id`, `data`, `status`, `hora_inicio`, `hora_fim`, `minutos_trabalho`, `hora_almoco_inicio/fim`, `minutos_almoco`, `intervalo_15min`, `funcao_id` | **1 linha = 1 dia de 1 pessoa.** Status: TRABALHO, FOLGA, INDISPONIVEL. Inclui horarios de almoco e intervalo curto. UNIQUE(escala_id, colaborador_id, data). |
| **EscalaDecisao** | `escala_decisoes` | `escala_id`, `colaborador_id`, `data`, `acao`, `razao`, `alternativas_tentadas` | **Explicabilidade.** O motor registra POR QUE tomou cada decisao (ALOCADO, FOLGA, MOVIDO, REMOVIDO) com a razao e quantas alternativas tentou. |
| **EscalaComparacaoDemanda** | `escala_comparacao_demanda` | `escala_id`, `data`, `hora_inicio`, `hora_fim`, `planejado`, `executado`, `delta` | Delta entre demanda planejada e cobertura real. `delta = executado - planejado`. Negativo = deficit, positivo = excesso. |

#### Camada 4 — Ciclo Rotativo

| Entidade | Tabela | Campos criticos | Notas |
|----------|--------|-----------------|-------|
| **CicloModelo** | `escala_ciclo_modelos` | `setor_id`, `nome`, `semanas_no_ciclo`, `ativo`, `origem_escala_id` | Template de escala que repete a cada N semanas. Pode ser criado a partir de uma escala existente (`origem_escala_id`). |
| **CicloItem** | `escala_ciclo_itens` | `ciclo_modelo_id`, `semana_idx`, `colaborador_id`, `dia_semana`, `trabalha`, `ancora_domingo`, `prioridade` | Cada linha = 1 colab, 1 dia, 1 semana do ciclo. `trabalha=1/0`. `ancora_domingo` marca quem trabalha domingo naquela semana do ciclo. |

#### Camada 5 — Engine de Regras

| Entidade | Tabela | Campos criticos | Notas |
|----------|--------|-----------------|-------|
| **RegraDefinicao** | `regra_definicao` | `codigo` (PK), `nome`, `descricao`, `categoria`, `status_sistema`, `editavel`, `aviso_dependencia` | **Catalogo fixo** (seed): 35 regras. `editavel=0` = locked (CLT obrigatoria). `editavel=1` = usuario pode mudar status. `status_sistema` = default do sistema. |
| **RegraEmpresa** | `regra_empresa` | `codigo` (PK, FK), `status` | **Override do usuario.** Se existir linha aqui, o status dela prevalece sobre `status_sistema`. Permite desligar regras editaveis ou mudar HARD↔SOFT. |

#### IA (separada)

| Entidade | Tabela | Notas |
|----------|--------|-------|
| **ConfiguracaoIA** | `configuracao_ia` | Singleton. Provider, API key, modelo, configs JSON por provider. `ativo` sempre 1 (migration v8 forca). |
| **IaConversa** | `ia_conversas` | PK = UUID text. Status: ativo/arquivado. Auto-titulo na 1a msg. |
| **IaMensagem** | `ia_mensagens` | PK = UUID text. FK conversa. Papel: usuario/assistente/tool_result. `tool_calls_json` armazena array de ToolCall[] serializado. |

### 2.2 Relacionamentos

```
empresa (1) ──── (N) empresa_horario_semana
empresa (1) ──── (N) regra_empresa ──── (1) regra_definicao

tipos_contrato (1) ──── (N) colaboradores
tipos_contrato (1) ──── (N) funcoes
tipos_contrato (1) ──── (N) contrato_perfis_horario

setores (1) ──── (N) colaboradores
setores (1) ──── (N) demandas
setores (1) ──── (N) funcoes
setores (1) ──── (N) setor_horario_semana
setores (1) ──── (N) escalas
setores (1) ──── (N) demandas_excecao_data
setores (1) ──── (N) escala_ciclo_modelos

colaboradores (1) ──── (N) excecoes
colaboradores (1) ──── (1) colaborador_regra_horario
colaboradores (1) ──── (N) colaborador_regra_horario_excecao_data
colaboradores (1) ──── (N) alocacoes

escalas (1) ──── (N) alocacoes                    (ON DELETE CASCADE)
escalas (1) ──── (N) escala_decisoes               (ON DELETE CASCADE)
escalas (1) ──── (N) escala_comparacao_demanda      (ON DELETE CASCADE)

escala_ciclo_modelos (1) ──── (N) escala_ciclo_itens (ON DELETE CASCADE)

ia_conversas (1) ──── (N) ia_mensagens              (ON DELETE CASCADE)
```

### 2.3 Ciclo de Vida das Entidades

**Escala (a mais importante):**
```
RASCUNHO ──[oficializar (se violacoes_hard=0)]──→ OFICIAL ──[arquivar]──→ ARQUIVADA
```
- So pode existir **1 OFICIAL** por setor/periodo (garantido por logica, nao por constraint SQL)
- Gerar nova escala no mesmo periodo cria novo RASCUNHO (nao sobrescreve)
- ARQUIVADA e read-only

**Colaborador:**
```
ativo=1 (normal) ──[desativar]──→ ativo=0 (soft deleted, invisivel no motor)
```
- Nunca DELETE — sempre soft delete
- Motor ignora colaboradores com ativo=0

**Setor:**
```
ativo=1 (normal) ──[desativar]──→ ativo=0 (invisivel no sidebar, motor nao gera)
```

### 2.4 Contratos CLT — Templates e Restricoes

| ID | Nome | Horas/sem | Regime | Dias | Max/dia | Domingo | Compensacao 9h45 | Restricoes especiais |
|----|------|-----------|--------|------|---------|---------|------------------|---------------------|
| 1 | CLT 44h | 44 | 5X2 | 5 | 585min | Sim | Sim | Nenhuma |
| 2 | CLT 36h | 36 | 5X2 | 5 | 585min | Sim | Sim | Nenhuma |
| 3 | Estagiario Manha | 20 | 5X2 | 5 | 240min | **NUNCA** | Nao | Max 4h/dia, 20h/sem, nunca hora extra |
| 4 | Estagiario Tarde | 30 | 5X2 | 5 | 360min | **NUNCA** | Nao | Max 6h/dia, 30h/sem, nunca hora extra |
| 5 | Estagiario Noite-Estudo | 30 | 5X2 | 5 | 360min | **NUNCA** | Nao | Max 6h/dia, 30h/sem, nunca hora extra |

**Nota sobre compensacao:** CLT 44h/36h em regime 5X2 podem fazer ate 9h45/dia para compensar o sabado sem trabalho. Estagiarios NUNCA fazem compensacao.

**Nota sobre Aprendiz:** Existe como `tipo_trabalhador` mas nao tem contrato seed dedicado. Restricoes: NUNCA domingo, NUNCA feriado, NUNCA noturno (22h-5h), NUNCA hora extra.

### 2.5 Perfis de Horario (Seed)

| Contrato | Perfil | Entrada | Saida | Turno |
|----------|--------|---------|-------|-------|
| Estagiario Manha | MANHA_08_12 | 08:00-08:00 (fixo) | 12:00-12:00 (fixo) | MANHA |
| Estagiario Tarde | TARDE_1330_PLUS | 13:30-17:00 (janela) | 19:00-20:00 (janela) | TARDE |
| Estagiario Noite-Estudo | ESTUDA_NOITE_08_14 | 08:00-08:00 (fixo) | 14:00-14:00 (fixo) | MANHA |

CLT 44h e 36h **nao tem perfis seed** — usam a janela do setor inteira.

### 2.6 Grid de 15 Minutos

- **Fonte unica:** `CLT.GRID_MINUTOS = 15` em `constants.ts`, replicado em `empresa.grid_minutos`
- **O que significa:** Toda alocacao, demanda, horario — tudo e quantizado em blocos de 15 minutos
- **Impacto:** Um colaborador nao pode comecar as 08:07. Tem que ser 08:00 ou 08:15
- **Historico:** Era 30min, migrado pra 15min (migration no schema.ts forca `UPDATE empresa SET grid_minutos = 15 WHERE grid_minutos = 30`)
- **Onde afeta:** Timeline de demanda (snap), alocacoes do solver, bridge (buildSolverInput), validador, export

### 2.7 Soft Delete

Entidades com soft delete (`ativo` = 1 ou 0):
- `setores`, `colaboradores`, `funcoes`, `contrato_perfis_horario`, `colaborador_regra_horario`, `colaborador_regra_horario_excecao_data`, `escala_ciclo_modelos`

**Regra:** NUNCA usar `DELETE FROM` nessas tabelas. Sempre `UPDATE SET ativo = 0`.

**Excecao:** Tabelas com `ON DELETE CASCADE` (alocacoes, decisoes, comparacao_demanda, ciclo_itens, ia_mensagens) sao deletadas automaticamente quando o pai e deletado.

### 2.8 Hierarquia de Precedencia de Regras (Horarios)

Quando o motor precisa saber a janela de horario de um colaborador num dia especifico:

```
1. colaborador_regra_horario_excecao_data  (maior precedencia — override pontual)
2. colaborador_regra_horario               (regra individual semanal)
3. contrato_perfis_horario                 (perfil do tipo de contrato)
4. sem regra                               (usa janela do setor/empresa)
```

### 2.9 Catalogo de Regras (35 regras)

#### CLT (16 regras) — Obrigacoes legais

| Codigo | Nome | Status default | Editavel | Descricao curta |
|--------|------|---------------|----------|-----------------|
| H1 | Max 6 dias consecutivos | HARD | Sim | CLT Art. 67 |
| H2 | Descanso 11h entre jornadas | HARD | Nao | CLT Art. 66 |
| H4 | Jornada max 10h/dia | HARD | Nao | CLT Art. 59 |
| H5 | Ferias/atestado/bloqueio | HARD | Nao | Respeita excecoes cadastradas |
| H6 | Human blocks (almoco) | HARD | Sim | CLT Art. 71 — intervalo obrigatorio |
| H10 | Meta semanal de horas | HARD | Sim | CLT Art. 58 |
| H11 | Aprendiz nunca domingo | HARD | Nao | CLT Art. 405 |
| H12 | Aprendiz nunca feriado | HARD | Nao | CLT Art. 405 |
| H13 | Aprendiz nunca noturno | HARD | Nao | CLT Art. 404 |
| H14 | Aprendiz nunca hora extra | HARD | Nao | CLT Art. 432 |
| H15 | Estagiario max 6h/dia 30h/sem | HARD | Nao | Lei 11.788 Art. 10 |
| H16 | Estagiario nunca hora extra | HARD | Nao | Lei 11.788 |
| H17 | Feriado 25/12 proibido | HARD | Nao | CCT FecomercioSP |
| H18 | Feriado 01/01 proibido | HARD | Nao | CCT FecomercioSP |
| DIAS_TRABALHO | Dias corretos por semana | HARD | Sim | 5x2 ou 6x1 conforme contrato |
| MIN_DIARIO | Jornada minima 4h | HARD | Sim | Evita microturnos |

#### SOFT (7 regras) — Preferencias e otimizacao

| Codigo | Nome | Status default | Descricao curta |
|--------|------|---------------|-----------------|
| S_DEFICIT | Deficit de cobertura | ON | Penaliza slots abaixo da demanda |
| S_SURPLUS | Excesso de cobertura | ON | Penaliza overstaffing |
| S_DOMINGO_CICLO | Rodizio de domingos | ON | Distribui domingos de forma justa |
| S_TURNO_PREF | Preferencia de turno | ON | Acomoda manha/tarde por colab |
| S_CONSISTENCIA | Consistencia de horarios | ON | Evita variacoes bruscas entre dias |
| S_SPREAD | Equilibrio de carga | ON | Distribui horas de forma justa |
| S_AP1_EXCESS | Penalidade jornada >8h | ON | Penaliza jornadas longas mesmo que legais |

#### ANTIPATTERN (12 regras) — Boas praticas

| Codigo | Nome | Status default | Descricao curta |
|--------|------|---------------|-----------------|
| AP1 | Clopening | ON | Fechar e abrir no dia seguinte |
| AP2 | Ioio de horarios | ON | Variacoes drasticas entre dias |
| AP3 | Almoco simultaneo >50% | ON | Setor descoberto no almoco |
| AP4 | Desequilibrio de carga | ON | Distribuicao injusta de horas |
| AP5 | Folga isolada | ON | Folga ilhada entre dias de trabalho |
| AP6 | Inequidade de turnos | ON | Sempre no mesmo turno |
| AP7 | Fome de fim de semana | ON | >5 semanas sem folga sab/dom |
| AP8 | Almoco fora da janela | ON | Almoco muito cedo/tarde |
| AP9 | Hora morta | ON | Microturno + gap + microturno |
| AP10 | Overstaffing | ON | 2+ pessoas quando meta e 1 |
| AP15 | Clustering de pico | ON | Mesmos colabs sempre nos dias pesados |
| AP16 | Junior sozinho em pico | ON | Rank 0 sem apoio em alta demanda |

### 2.10 Constantes CLT Criticas

```typescript
// src/shared/constants.ts — valores que o motor e o validador usam
CLT.MAX_JORNADA_NORMAL_MIN     = 480   // 8h
CLT.MAX_JORNADA_COM_EXTRA_MIN  = 600   // 10h (limite absoluto)
CLT.MIN_DESCANSO_ENTRE_JORNADAS_MIN = 660  // 11h (interjornada)
CLT.MAX_DIAS_CONSECUTIVOS      = 6     // nunca 7+ dias seguidos
CLT.ALMOCO_MIN_CLT_MIN         = 60    // 1h padrao
CLT.ALMOCO_MIN_CCT_MIN         = 30    // CCT permite reducao
CLT.ALMOCO_MAX_MIN             = 120   // 2h max
CLT.INTERVALO_CURTO_MIN        = 15    // obrigatorio >4h e <=6h
CLT.LIMIAR_ALMOCO_MIN          = 360   // >6h = almoco obrigatorio
CLT.LIMIAR_INTERVALO_CURTO_MIN = 240   // >4h = intervalo 15min
CLT.MIN_JORNADA_DIA_MIN        = 240   // 4h minimo (decisao de produto)
CLT.MAX_COMPENSACAO_DIA_MIN    = 585   // 9h45 (CLT 44h/36h apenas)
CLT.GRID_MINUTOS               = 15    // quantizacao universal
```

### 2.11 O que a IA precisa saber para operar

**Entidades que a IA MANIPULA (write) — 28 tools total:**
- `alocacoes` — via tools `ajustar_alocacao`, `ajustar_horario`
- `escalas` — via tools `gerar_escala`, `oficializar_escala`
- `regra_empresa` — via tools `editar_regra`, `resetar_regras_empresa`
- `colaboradores` — via tools genericas `criar`, `atualizar`, `cadastrar_lote`
- `excecoes` — via tools genericas `criar`, `deletar`
- `demandas` — via tools genericas `criar`, `atualizar`, `deletar`
- `funcoes` — via tools genericas `criar`, `atualizar`, `deletar`
- `feriados` — via tools genericas `criar`, `deletar`
- `setores` — via tools genericas `criar`, `atualizar`
- `colaborador_regra_horario` — via tools `salvar_regra_horario_colaborador`, `definir_janela_colaborador`
- `colaborador_regra_horario_excecao_data` — via tool `upsert_regra_excecao_data`
- `demandas_excecao_data` — via tool `salvar_demanda_excecao_data`
- `contrato_perfis_horario` — via tools `salvar_perfil_horario`, `deletar_perfil_horario`
- `empresa_horario_semana` / `setor_horario_semana` — via tool `configurar_horario_funcionamento`

**Entidades que a IA CONSULTA (read):**
- Quase tudo via tool `consultar` (whitelist de 18 tabelas) + tools especializadas (`get_context`, `buscar_colaborador`, `obter_regra_horario_colaborador`, `listar_perfis_horario`, `obter_alertas`, `resumir_horas_setor`, `preflight`, `preflight_completo`, `diagnosticar_escala`, `explicar_violacao`)

**Gaps restantes (a IA NAO manipula):**
- `escala_ciclo_modelos` / `escala_ciclo_itens` — pode consultar mas nao criar/editar (operacao complexa com modelo + itens + semana_idx)
- `tipos_contrato` — pode ler via `consultar` mas nao criar/editar via tools (editavel na UI)

**Regras inviolaveis:**
1. snake_case ponta a ponta — DB = IPC = TS = React
2. UNIQUE(escala_id, colaborador_id, data) — nunca 2 alocacoes do mesmo colab/dia/escala
3. Escala so oficializa com `violacoes_hard = 0`
4. Estagiario NUNCA domingo, NUNCA hora extra
5. Aprendiz NUNCA domingo, feriado, noturno (22h-5h), hora extra
6. 25/12 e 01/01 = proibido trabalhar (CCT)
7. Soft delete — `ativo=0`, nunca DELETE
8. Grid 15min — tudo quantizado

---

## 3. Motor de Escalas (Fase 2)

> **Arquivos fonte:**
> - `solver/solver_ortools.py` — Solver CP-SAT (entrada JSON stdin, saida JSON stdout)
> - `solver/constraints.py` — Todas as constraint builders (HARD + SOFT)
> - `src/main/motor/solver-bridge.ts` — Bridge TS→Python (buildSolverInput, runSolver, persistirSolverResult)
> - `src/main/motor/validador.ts` — PolicyEngine (revalida apos ajuste manual)
> - `docs/MOTOR_V3_RFC.md` — RFC canonico (20 HARD, SOFT, explicabilidade)

### 3.1 Fluxo Completo de Geracao

```
UI (EscalaPagina)
  │
  ├─ [1] IPC: escalas.gerar(setor_id, data_inicio, data_fim)
  │
  ├─ [2] solver-bridge.ts: buildSolverInput(setor_id, datas, pinnedCells, options)
  │     └── Queries ao DB: empresa, setor, colaboradores+contrato, demandas,
  │         feriados, excecoes, regras_colaborador_dia (resolve precedencia),
  │         demanda_excecao_data, hints (warm-start), regras (buildRulesConfig)
  │     └── Retorna: SolverInput JSON (~500-2000 linhas dependendo do periodo)
  │
  ├─ [3] solver-bridge.ts: runSolver(input, timeout)
  │     └── spawn(python3, solver_ortools.py)
  │     └── stdin: JSON (SolverInput)
  │     └── stdout: JSON (SolverOutput)
  │     └── stderr: logs de progresso (streaming via onLog callback)
  │     └── Timeout default: 3.700s (wrapper), solver interno: 30s rapido / 120s otimizado
  │
  ├─ [4] Python solver_ortools.py: solve(data)
  │     ├── parse_demand() → grid de demanda por (dia_idx, slot_idx)
  │     ├── build_model() → cria modelo CP-SAT:
  │     │     ├── Variaveis: work[c,d,s], works_day[c,d], block_starts[c,d,s]
  │     │     ├── Pinned cells → force work[c,d,s] = 0 ou 1
  │     │     ├── Warm-start hints → model.add_hint()
  │     │     ├── Blocked days (feriados proibidos, excecoes, aprendiz dom/feriado)
  │     │     ├── HARD constraints (H1-H19, DIAS_TRABALHO, MIN_DIARIO, janela, folga fixa)
  │     │     ├── SOFT penalties (deficit, surplus, domingo_ciclo, turno_pref, consistencia, spread, ap1_excess)
  │     │     └── model.minimize(sum(objective_terms))
  │     ├── solver.solve(model) → CP-SAT resolve
  │     └── extract_solution() → alocacoes, indicadores, decisoes, comparacao, diagnostico
  │
  ├─ [5] solver-bridge.ts: persistirSolverResult(setor_id, datas, result, hash)
  │     └── Transacao SQLite:
  │         ├── INSERT escalas (status='RASCUNHO', indicadores)
  │         ├── INSERT alocacoes (1 por colab/dia)
  │         ├── INSERT escala_decisoes (explicabilidade)
  │         └── INSERT escala_comparacao_demanda (delta planejado vs executado)
  │
  └─ [6] Retorna EscalaCompletaV3 ao frontend
```

### 3.2 Modelo CP-SAT — Variaveis

O solver usa 3 camadas de variaveis booleanas:

| Variavel | Tipo | Dimensao | Significado |
|----------|------|----------|-------------|
| `work[c, d, s]` | BoolVar | C × D × S | Colaborador `c` trabalha no dia `d`, slot `s` |
| `works_day[c, d]` | BoolVar | C × D | Colab `c` trabalha no dia `d` (qualquer slot) |
| `block_starts[c, d, s]` | BoolVar | C × D × S | Slot `s` e uma "rising edge" (0→1) — detecta inicio de bloco |

Onde:
- `C` = numero de colaboradores ativos no setor
- `D` = numero de dias no periodo (ex: 7 para 1 semana, 28-31 para 1 mes)
- `S` = slots por dia = (hora_fechamento - hora_abertura) / grid_minutos (ex: 08:00-22:00 com grid 15min = 56 slots)

**Exemplo concreto:** Setor com 6 colabs, periodo de 7 dias, janela 08-22h (56 slots/dia):
- `work`: 6 × 7 × 56 = **2.352 variaveis booleanas**
- `works_day`: 6 × 7 = 42
- `block_starts`: 6 × 7 × 56 = 2.352
- **Total: ~4.746 variaveis** (sem contar auxiliares)

### 3.3 Constraints — Lista Completa

#### HARD (CLT Legal) — Violacao = INFEASIBLE

| Codigo | Funcao Python | Linha | O que faz | Configuravel? |
|--------|--------------|-------|-----------|---------------|
| H1 | `add_h1_max_dias_consecutivos` | `constraints.py:102` | Max 6 dias consecutivos de trabalho (CLT Art. 67). Janela deslizante de 7 dias. | Sim (HARD/SOFT/OFF) |
| H2 | `add_h2_interjornada` | `constraints.py:117` | Min 11h entre jornadas (CLT Art. 66). Para janela 08-20h, rest >= 12h sempre (zero clauses). | Nao (sempre HARD) |
| H4 | `add_h4_max_jornada_diaria` | `constraints.py:142` | Max minutos/dia per contrato. CLT 44h/36h = 585min (9h45). Estagiario = 360min. | Nao (sempre HARD) |
| H5 | `add_h5_excecoes` | `constraints.py:469` | Ferias/atestado/bloqueio = work[c,d,s] = 0 em todos os slots do periodo. | Nao (sempre HARD) |
| H6 | `add_human_blocks` | `constraints.py:156` | Estrutura jornada: <=6h → 1 bloco; >6h → 2 blocos + almoco [1h-2h] na janela [11h-15h]. Min 2h/bloco. Max 6h seguidas. | Sim (HARD/SOFT/OFF) |
| H10 | `add_h10_meta_semanal` | `constraints.py:256` | Horas semanais ± tolerancia. Pro-rata em chunks parciais. Ajusta por dias disponiveis. | Sim (HARD/SOFT/OFF) |
| H11 | `add_h11_aprendiz_domingo` | `constraints.py:493` | Aprendiz NUNCA domingo (Art. 432 CLT). | Nao (sempre HARD) |
| H12 | `add_h12_aprendiz_feriado` | `constraints.py:507` | Aprendiz NUNCA feriado. | Nao (sempre HARD) |
| H13 | `add_h13_aprendiz_noturno` | `constraints.py:521` | Aprendiz NUNCA slots >= 22h. Para janela 08-20h: zero clauses. | Nao (sempre HARD) |
| H14 | `add_h14_aprendiz_hora_extra` | `constraints.py:553` | Aprendiz: weekly_minutes <= target (zero tolerancia upper). | Nao (sempre HARD) |
| H15 | `add_h15_estagiario_jornada` | `constraints.py:572` | Estagiario: max 360min/dia, max 1800min/sem (Lei 11.788 Art. 10). | Nao (sempre HARD) |
| H16 | `add_h16_estagiario_hora_extra` | `constraints.py:596` | Estagiario: weekly_minutes <= target (zero tolerancia upper). | Nao (sempre HARD) |
| H17/H18 | `add_h17_h18_feriado_proibido` | `constraints.py:615` | 25/12 e 01/01: works_day[c,d] = 0 para todos (CCT). | Nao (sempre HARD) |
| H19 | `add_h19_folga_comp_domingo` | `constraints.py:632` | **NOOP** — redundante com H1 (pass no corpo). | N/A (noop) |
| DIAS_TRABALHO | `add_dias_trabalho` | `constraints.py:323` | 5X2 → 5 dias/sem, 6X1 → 6. Range [target-1, target] por chunk. | Sim (HARD/SOFT/OFF) |
| MIN_DIARIO | `add_min_diario` | `constraints.py:359` | Jornada minima 4h (16 slots) por dia de trabalho. | Sim (HARD/SOFT/OFF) |
| janela colab | `add_colaborador_time_window_hard` | `constraints.py:657` | Janela de horario individual: force inicio/fim. Folga fixa e domingo_forcar_folga. | Sempre HARD |
| folga fixa | `add_folga_fixa_5x2` | `constraints.py:851` | Se colab tem `folga_fixa_dia_semana`, works_day = 0 naquele dia. | Sempre HARD |

**Exemplo de constraint HARD (H1):** (`constraints.py:102-114`)
```python
def add_h1_max_dias_consecutivos(model, works_day, C, D, max_consecutive=6):
    """H1: Max 6 dias consecutivos. Art. 67 CLT + OJ 410 TST."""
    window = max_consecutive + 1
    for c in range(C):
        for start in range(D - window + 1):
            model.add(sum(works_day[c, start + i] for i in range(window)) <= max_consecutive)
```

**Como o solver chama as constraints** (`solver_ortools.py:420-527`):
```python
# Cada constraint verifica rule_is() antes de emitir:
h1_status = rule_is('H1', 'HARD')
if h1_status == 'HARD':
    add_h1_max_dias_consecutivos(model, works_day, C, D)
elif h1_status == 'SOFT':
    add_h1_soft_penalty(model, obj_terms_list, works_day, C, D)
# Se 'OFF' → nao emite nada

# Constraints fixas (nao configuraveis):
add_h2_interjornada(model, work, C, D, S, grid_min=grid_min)
add_h4_max_jornada_diaria(model, work, colabs, C, D, S, grid_min)
add_h5_excecoes(model, work, colabs, days, C, S, excecoes)

# SOFT constraints (todas verificam rule_is antes):
deficit = add_demand_soft(model, work, demand_by_slot, C, D, S) \
    if rule_is('S_DEFICIT', 'ON') != 'OFF' else {}
```

#### SOFT (Objetivo — penalidades minimizadas)

| Codigo | Funcao Python | Linha | Peso | O que faz | Configuravel? |
|--------|--------------|-------|------|-----------|---------------|
| S_DEFICIT | `add_demand_soft` | `constraints.py:377` | 10.000 | Deficit: max(0, target - cobertura) por slot. | Sim (ON/OFF) |
| S_SURPLUS | `add_surplus_soft` | `constraints.py:877` | 5.000 | Excesso: max(0, cobertura - target). Forca redistribuicao. | Sim (ON/OFF) |
| S_DOMINGO_CICLO | `add_domingo_ciclo_soft` | `constraints.py:718` | 3.000 | Rodizio justo de domingos por ciclo (N trab / M folga). | Sim (ON/OFF) |
| S_TURNO_PREF | `add_colaborador_soft_preferences` | `constraints.py:753` | 2.000 | Preferencia MANHA: penaliza apos 14h. TARDE: antes 12h. | Sim (ON/OFF) |
| S_CONSISTENCIA | `add_consistencia_horario_soft` | `constraints.py:802` | 1.000 | Variacao de inicio entre dias > 1h. | Sim (ON/OFF) |
| S_SPREAD | spread (inline) | `solver_ortools.py:530` | 800 | max_weekly - min_weekly. Equilibrio de carga. | Sempre ON |
| S_AP1_EXCESS | `add_ap1_jornada_excessiva` | `constraints.py:409` | 250 | Slots acima de 8h/dia. Penaliza hora extra evitavel. | Sim (ON/OFF) |

**Por que deficit e SOFT, nao HARD:**
> Com 6 pessoas e constraints CLT, 100% cobertura e matematicamente impossivel (margem: 0.5%).
> Rita (30+ anos de experiencia no supermercado) atinge ~85%. O solver faz o mesmo.
> Forcar HARD = INFEASIBLE garantido. (comentario real do `constraints.py:387`)

#### SOFT penalty wrappers (para regras configuraveis)

Quando uma regra HARD e configurada como SOFT pela engine de regras:

| Funcao | Peso | Substitui |
|--------|------|-----------|
| `add_h1_soft_penalty` | 5.000 | H1 (max consecutivos) |
| `add_human_blocks_soft_penalty` | 3.000 | H6 (almoco/estrutura) |
| `add_dias_trabalho_soft_penalty` | 4.000 | DIAS_TRABALHO |
| `add_min_diario_soft_penalty` | 2.000 | MIN_DIARIO |

### 3.4 Engine de Regras no Solver

O fluxo de regras configuraveis:

```
1. Bridge: buildRulesConfig(db, rulesOverride)
   ├── SELECT rd.codigo, COALESCE(re.status, rd.status_sistema) FROM regra_definicao LEFT JOIN regra_empresa
   ├── Monta Record<codigo, RuleStatus> base
   └── Merge rulesOverride por cima (drawer de config por geracao)

2. SolverInput.config.rules = { H1: 'HARD', H6: 'SOFT', S_DEFICIT: 'ON', AP1: 'OFF', ... }

3. Python: rule_is(codigo, default) (`solver_ortools.py:395`)
   ├── Se rules dict presente: return rules.get(codigo, default)
   └── Fallback: nivel_rigor (backward compat: ALTO/MEDIO/BAIXO)

4. Cada constraint builder verifica rule_is() antes de emitir clauses:
   ├── 'HARD' → model.add() (constraint obrigatoria)
   ├── 'SOFT' → penalty var adicionada ao objetivo
   ├── 'OFF'  → nao emite nada
   └── 'ON'   → mesmo que SOFT/ativo (usado por SOFT e ANTIPATTERN)
```

**Implementacao real do `rule_is()`** (`solver_ortools.py:395-410`):
```python
def rule_is(codigo: str, default: str = 'HARD') -> str:
    """Retorna status da regra: HARD, SOFT, OFF, ON."""
    if rules:
        return rules.get(codigo, default)
    # Backward compat: inferir de nivel_rigor
    rigor = config.get("nivel_rigor", "ALTO")
    if rigor == "ALTO": return default
    if rigor == "MEDIO": return "SOFT" if default == "HARD" else default
    return "OFF"  # BAIXO
```

### 3.5 Validador TS (PolicyEngine)

**Quando roda:** Apos QUALQUER ajuste manual de alocacao no frontend.

**O que faz:** Reconstroi o estado da escala a partir do banco, roda todas as regras (H1-H20, APs, SOFTs) e retorna `EscalaCompletaV3` com indicadores e violacoes atualizados.

**NAO faz backtrack. NAO modifica alocacoes. Apenas analisa e reporta.**

```
validarEscalaV3(escalaId, db)
  │
  ├─ [1] Buscar escala + alocacoes do banco
  ├─ [2] Ler regras efetivas (merge empresa + sistema via ruleIs())
  ├─ [3] Buscar entidades: empresa, setor, horarios, demandas, colabs, excecoes, feriados
  ├─ [4] Build ColabMotor[] (igual ao gerador)
  ├─ [5] Calcular dias, semanas (corte_semanal)
  ├─ [6] Lookback: buscar escala OFICIAL anterior (continuidade H1/H2/H3)
  ├─ [7] Montar resultado Map<colab_id, Map<data, CelulaMotor>> a partir das alocacoes
  ├─ [8] Montar grid de slots (para APs e comparacao)
  ├─ [9] Rodar validarTudoV3() — H1-H20
  ├─ [10] Rodar APs Tier 1+2 (AP1-AP16, condicionais ao status da regra)
  ├─ [11] Rodar SOFT scoring (S1-S5)
  ├─ [12] Calcular score + indicadores
  ├─ [13] Gerar DecisaoMotor[] — estado pos-ajuste
  ├─ [14] Gerar SlotComparacao[] — planejado vs executado atualizado
  └─ [15] Retornar EscalaCompletaV3
```

**Diferenca chave validador vs solver:**
- Solver GERA alocacoes do zero (ou com hints)
- Validador ANALISA alocacoes existentes sem modificar

### 3.6 Output do Solver

```typescript
interface SolverOutput {
  sucesso: boolean                    // true se OPTIMAL ou FEASIBLE
  status: string                      // 'OPTIMAL' | 'FEASIBLE' | 'INFEASIBLE' | 'UNKNOWN'
  solve_time_ms: number
  diagnostico?: {
    status_cp_sat: string
    solve_time_ms: number
    regras_ativas: string[]           // codigos com status HARD/SOFT/ON
    regras_off: string[]              // codigos com status OFF
    motivo_infeasible?: string        // so no path INFEASIBLE
    num_colaboradores: number
    num_dias: number
  }
  alocacoes?: SolverOutputAlocacao[]  // 1 por (colab, dia)
  indicadores?: {
    cobertura_percent: number         // 0-100
    deficit_total: number
    surplus_total: number
    equilibrio: number                // 0-100 (inverso do spread)
    pontuacao: number                 // 0-100 (calibrada)
    violacoes_hard: number            // sempre 0 se sucesso=true
    violacoes_soft: number
  }
  decisoes?: DecisaoMotor[]           // explicabilidade: POR QUE cada decisao
  comparacao_demanda?: SlotComparacao[] // planejado vs executado vs delta
  erro?: {                            // so quando sucesso=false
    tipo: 'PREFLIGHT' | 'CONSTRAINT'
    regra: string
    mensagem: string
    sugestoes: string[]
  }
}
```

### 3.7 Warm-Start Hints

Bridge busca a ultima escala do mesmo setor/periodo no DB e passa como `hints[]`. O solver usa `model.add_hint()` — nao e constraint, e sugestao de ponto de partida pra acelerar convergencia.

```typescript
// solver-bridge.ts:400-431
const lastScale = db.prepare(`
  SELECT id FROM escalas
  WHERE setor_id = ? AND data_inicio = ? AND data_fim = ?
  ORDER BY id DESC LIMIT 1
`).get(setorId, dataInicio, dataFim)

// Se existe escala anterior, busca alocacoes como hints
hints = alocacoesAnteriores.map(h => ({
  colaborador_id, data, status, hora_inicio, hora_fim
}))
```

### 3.8 Modos de Resolucao

| Modo | Timeout | Gap Limit | Quando usar |
|------|---------|-----------|-------------|
| `rapido` | 30s (default) | 5% | Geracao normal, feedback rapido |
| `otimizado` | 120s | 0% (prove optimal) | Quando quer a melhor solucao possivel |

Configuraveis via `SolverConfigDrawer` no frontend ou via tool `gerar_escala` da IA.

### 3.9 Input Hash (Deteccao de Mudancas)

`computeSolverScenarioHash(input)` gera SHA-256 deterministico do SolverInput (normalizado e ordenado). Serve pra:
- Detectar se os dados mudaram desde a ultima geracao
- Evitar regerar escala identica (cache hit)

Campos incluidos no hash: setor_id, datas, empresa, colaboradores (ordenados por id), demanda, feriados, excecoes, regras_colaborador_dia, demanda_excecao_data, rules.

### 3.10 O que a IA precisa saber sobre o motor

**Para gerar escala:**
- Precisa de setor_id, data_inicio, data_fim (minimo)
- Pode passar pinned_cells, solve_mode, max_time, rules_override
- Tool `gerar_escala` ja faz tudo isso

**Para entender falhas:**
- `diagnostico.motivo_infeasible` explica o que deu errado
- `diagnostico.regras_ativas/off` mostra o que estava ligado
- `erro.sugestoes[]` tem dicas acionaveis
- Tool `explicar_violacao` tem dicionario das 20+ regras

**Para ajustar alocacao:**
- Tool `ajustar_alocacao` faz UPDATE direto no DB
- Validador roda automaticamente depois (via IPC)
- Violacoes hard resultantes impedem oficializacao

**Para oficializar:**
- Tool `oficializar_escala` valida `violacoes_hard = 0` antes de permitir

**Gaps:**
- IA nao consegue ver detalhes de constraints especificas (ex: quais slots tem deficit)
- IA nao tem tool pra comparar duas escalas (delta entre versoes)

### 3.11 Preflight — Validacao Pre-Geracao

O preflight roda ANTES do solver para detectar problemas que tornariam a geracao impossivel ou problematica. Existem **duas versoes** — a completa (tipc.ts, usada pela UI) e a simplificada (tools.ts, usada pela IA).

#### Arquitetura do preflight

```
UI ou IA pede "gerar escala"
    │
    ├─ [1] buildEscalaPreflight(setor_id, data_inicio, data_fim)   (tipc.ts:230)
    │       ├── Checa: setor existe e ativo?
    │       ├── Checa: tem colaboradores ativos no setor?
    │       ├── Checa: tem demanda cadastrada?
    │       ├── Conta: feriados no periodo
    │       │
    │       ├── Se blockers basicos = 0:
    │       │   └── enrichPreflightWithCapacityChecks(input, blockers, warnings)  (tipc.ts:89)
    │       │       ├── Para cada dia do periodo:
    │       │       │   ├── Domingo com demanda mas ninguem aceita domingo? → BLOCKER
    │       │       │   ├── Feriado proibido com demanda? → BLOCKER
    │       │       │   └── Capacidade diaria < pico de demanda? → BLOCKER
    │       │       ├── Demanda total > capacidade total * 1.15? → WARNING
    │       │       └── Para cada colaborador:
    │       │           └── Janela de disponibilidade < meta horas do contrato? → BLOCKER
    │       │
    │       └── Retorna: { ok, blockers[], warnings[], diagnostico }
    │
    ├─ Se blockers.length > 0: PARA (nao chama solver)
    └─ Se blockers.length = 0: Prossegue para buildSolverInput → runSolver
```

#### Catalogo de codigos: Blockers vs Warnings

**BLOCKERS (impedem geracao — solver NEM roda):**

| Codigo | Severidade | Quando ocorre | Exemplo concreto |
|--------|-----------|---------------|------------------|
| `SETOR_INVALIDO` | BLOCKER | Setor nao encontrado ou `ativo=0` | Setor deletado (soft delete) |
| `SEM_COLABORADORES` | BLOCKER | Zero colabs ativos no setor | Setor recem-criado, ninguem cadastrado |
| `DOMINGO_SEM_COLABORADORES` | BLOCKER | Ha demanda em domingo mas nenhum colab aceita | Todos com `trabalha_domingo=false` |
| `DEMANDA_EM_FERIADO_PROIBIDO` | BLOCKER | Demanda cadastrada num dia que CCT proibe trabalho | 25/12 com demanda > 0 no acougue |
| `CAPACIDADE_DIARIA_INSUFICIENTE` | BLOCKER | Colabs disponiveis no dia < pico de demanda | Dia com 3 colabs e demanda de 5 |
| `CAPACIDADE_INDIVIDUAL_INSUFICIENTE` | BLOCKER | Janela de um colab impossibilita a meta de horas do contrato | Colab com janela 08-12h (4h) e contrato CLT 44h (7h20/dia) |

**WARNINGS (gera com aviso — solver roda mas resultado pode ter problemas):**

| Codigo | Severidade | Quando ocorre | Exemplo concreto |
|--------|-----------|---------------|------------------|
| `SEM_DEMANDA` | WARNING | Zero segmentos de demanda no setor | Setor configurado sem faixas de cobertura — solver distribui livremente |
| `DEMANDA_ACIMA_CAPACIDADE_ESTIMADA` | WARNING | Demanda total > capacidade contratual * 1.15 | 6 pessoas CLT 44h mas demanda exige 5000min vs capacidade 4440min |
| `PREFLIGHT_DIAGNOSTICO_INDISPONIVEL` | WARNING | `enrichPreflightWithCapacityChecks` falhou com excecao | Erro inesperado ao montar SolverInput |

#### Codigo real: `buildEscalaPreflight()` (`tipc.ts:230-289`)

```typescript
function buildEscalaPreflight(setorId, dataInicio, dataFim, regimesOverride?) {
  const blockers = [], warnings = []

  // Check 1: Setor existe e ativo
  const setor = db.prepare('SELECT id, ativo FROM setores WHERE id = ?').get(setorId)
  if (!setor || setor.ativo !== 1) {
    blockers.push({ codigo: 'SETOR_INVALIDO', severidade: 'BLOCKER', mensagem: '...' })
  }

  // Check 2: Tem colabs
  const colabsAtivos = db.prepare('SELECT COUNT(*) as count FROM colaboradores WHERE setor_id = ? AND ativo = 1').get(setorId)
  if (colabsAtivos.count === 0) {
    blockers.push({ codigo: 'SEM_COLABORADORES', ... })
  }

  // Check 3: Tem demanda
  if (demandasCount === 0) {
    warnings.push({ codigo: 'SEM_DEMANDA', ... })  // WARNING, nao BLOCKER
  }

  // Check 4: Capacity checks (so roda se nao tem blockers basicos)
  if (blockers.length === 0) {
    const input = buildSolverInput(setorId, dataInicio, dataFim, ...)
    enrichPreflightWithCapacityChecks(input, blockers, warnings)  // (tipc.ts:89)
  }

  return { ok: blockers.length === 0, blockers, warnings, diagnostico: { ... } }
}
```

#### Codigo real: `enrichPreflightWithCapacityChecks()` (`tipc.ts:89-228`)

```typescript
function enrichPreflightWithCapacityChecks(input, blockers, warnings) {
  for (const day of days) {
    // Domingo com demanda mas ninguem aceita domingo
    if (label === 'DOM' && input.colaboradores.every(c => !c.trabalha_domingo)) {
      blockers.push({ codigo: 'DOMINGO_SEM_COLABORADORES', ... })
      break
    }

    // Feriado proibido com demanda
    if (holidayForbidden.has(day)) {
      blockers.push({ codigo: 'DEMANDA_EM_FERIADO_PROIBIDO', ... })
      break
    }

    // Capacidade diaria < pico demanda
    if (availableCount < requiredMin) {
      blockers.push({ codigo: 'CAPACIDADE_DIARIA_INSUFICIENTE', ... })
      break
    }
  }

  // Capacidade total estimada vs demanda total
  if (requiredMinutes > availableContractMinutes * 1.15) {
    warnings.push({ codigo: 'DEMANDA_ACIMA_CAPACIDADE_ESTIMADA', ... })
  }

  // Validar janela individual por colaborador
  for (const c of input.colaboradores) {
    if (capacidadeMaxSemanal < limiteInferiorSemanal) {
      blockers.push({ codigo: 'CAPACIDADE_INDIVIDUAL_INSUFICIENTE', ... })
    }
  }
}
```

#### Gap: Preflight da IA vs Preflight da UI

A tool `preflight` da IA (`tools.ts:1313-1390`) e uma **versao simplificada** que faz apenas os checks 1-3:

| Check | UI (`tipc.ts`) | IA (`tools.ts`) |
|-------|---------------|-----------------|
| Setor ativo | ✅ | ✅ |
| Tem colaboradores | ✅ | ✅ |
| Tem demanda | ✅ | ✅ |
| Feriados no periodo | ✅ | ✅ (contagem) |
| Domingo sem colabs disponiveis | ✅ (BLOCKER) | ❌ |
| Feriado proibido com demanda | ✅ (BLOCKER) | ❌ |
| Capacidade diaria vs pico demanda | ✅ (BLOCKER) | ❌ |
| Capacidade total vs demanda total | ✅ (WARNING) | ❌ |
| Janela individual insuficiente | ✅ (BLOCKER) | ❌ |

**Impacto:** A IA pode dar "ok" no preflight e a geracao falhar com INFEASIBLE porque os capacity checks nao rodaram. A ferramenta `gerar_escala` da IA chama `buildSolverInput + runSolver` direto, sem o preflight completo. Se o solver retorna INFEASIBLE, o diagnostico (`motivo_infeasible`) ajuda, mas a IA nao conseguiu PREVENIR.

**Recomendacao (P2):** Criar tool `preflight_completo` que chama `buildEscalaPreflight()` do tipc.ts via IPC, dando a IA a mesma visao que a UI tem.

---

## 4. Sistema de Regras (Fase 3)

> **Arquivos fonte:**
> - `src/main/db/schema.ts` — DDL: `regra_definicao`, `regra_empresa` (DDL_V6_REGRAS)
> - `src/main/db/seed.ts` — `seedRegrasDefinicao()` — 35 regras catalogadas
> - `src/main/tipc.ts` — handlers `regras.*` (4), `colaboradores.*RegraHorario` (5), `perfisHorario.*` (4), `setores.*DemandaExcecaoData` (3), `escalas.*CicloRotativo` (4)
> - `src/main/motor/solver-bridge.ts` — `buildRulesConfig()`, `buildSolverInput()` (resolve precedencia)
> - `solver/solver_ortools.py` — `rule_is()` helper
> - `src/main/motor/validador.ts` — `ruleIs()` TS equivalent

O sistema de regras tem **3 camadas independentes** que atuam em momentos diferentes:

1. **Engine de Regras Configuraveis** — liga/desliga regras do motor por empresa
2. **Regras de Horario por Colaborador** — personaliza janelas/ciclos por pessoa
3. **Ciclo Rotativo** — templates de escala repetitiva

### 4.1 Engine de Regras Configuraveis

#### Arquitetura de 2 tabelas

```
regra_definicao (catalogo fixo — seed)     regra_empresa (override do usuario)
┌──────────────────────────────────┐       ┌─────────────────────┐
│ codigo (PK)         "H1"        │       │ codigo (PK/FK)  "H1"│
│ nome                "Max 6 dias"│  ←──  │ status         "SOFT"│
│ descricao           "CLT Art.67"│       │ atualizado_em       │
│ categoria           "CLT"       │       └─────────────────────┘
│ status_sistema      "HARD"      │
│ editavel            1           │       Se regra_empresa existe para o codigo,
│ aviso_dependencia   "Aviso..."  │       seu status prevalece sobre status_sistema.
│ ordem               1           │
└──────────────────────────────────┘       Se nao existe, vale status_sistema.
```

**Status possivel:** `HARD`, `SOFT`, `ON`, `OFF`

**`editavel` flag:**
- `editavel=0` → regra travada (CLT obrigatoria, ex: H2 interjornada 11h). UI mostra cadeado.
- `editavel=1` → usuario pode mudar. Ex: H1 (max consecutivos) pode virar SOFT ou OFF.

**`aviso_dependencia`:** Texto que aparece no UI quando o usuario tenta mudar. Ex: "Desligar H10 quebra todo o calculo de horas semanais."

#### Fluxo de resolucao

```
1. DB: SELECT COALESCE(re.status, rd.status_sistema) as status_efetivo
       FROM regra_definicao rd LEFT JOIN regra_empresa re ON rd.codigo = re.codigo

2. Bridge: buildRulesConfig(db, rulesOverride?)
   → Monta Record<string, RuleStatus>
   → Merge rulesOverride (do SolverConfigDrawer) POR CIMA

3. Resultado final no SolverInput:
   config.rules = { H1: 'HARD', H6: 'SOFT', S_DEFICIT: 'ON', AP1: 'OFF', ... }

4. Python: rule_is('H1', 'HARD')
   → Se rules dict preenchido: return rules['H1']
   → Fallback: nivel_rigor (backward compat ALTO/MEDIO/BAIXO)

5. Cada constraint builder: if h1_status == 'HARD': add_hard() elif 'SOFT': add_soft_penalty()
```

#### IPC handlers (4)

| Handler | Input | Output | O que faz |
|---------|-------|--------|-----------|
| `regras.listar` | — | `Array<{codigo, nome, descricao, categoria, status_sistema, editavel, aviso_dependencia, ordem, status_efetivo}>` | Lista as 35 regras com status efetivo (merge sistema + empresa) |
| `regras.atualizar` | `{codigo, status}` | void | INSERT OR REPLACE em `regra_empresa`. Persiste override do usuario. |
| `regras.resetarEmpresa` | — | void | DELETE FROM `regra_empresa`. Volta tudo ao default do sistema. |
| `regras.resetarRegra` | `{codigo}` | void | DELETE FROM `regra_empresa` WHERE codigo = ?. Reseta UMA regra. |

#### Catalogo completo (35 regras — seed)

As 35 regras estao documentadas em detalhe na secao 2.9 (Fase 1). Resumo por categoria:

| Categoria | Quantidade | Status default | Editaveis |
|-----------|-----------|---------------|-----------|
| CLT | 16 | HARD | 6 de 16 (H1, H6, H10, DIAS_TRABALHO, MIN_DIARIO + H5 locked) |
| SOFT | 7 | ON | Todas |
| ANTIPATTERN | 12 | ON | Todas |

#### Onde as regras atuam

| Momento | Quem lê | Como le |
|---------|---------|---------|
| **Geracao** (solver) | Python `rule_is()` | `config.rules` no SolverInput |
| **Validacao** (pos-ajuste) | TS `ruleIs()` | Query direta `regra_definicao LEFT JOIN regra_empresa` |
| **IA** (tool `editar_regra`) | TS handler | INSERT OR REPLACE em `regra_empresa` |
| **UI** (RegrasPagina) | TS handler | `regras.listar` |

### 4.2 Regras de Horario por Colaborador

Personalizam QUANDO cada colaborador pode trabalhar, independente das regras do motor.

#### Hierarquia de precedencia (reprise da secao 2.8)

```
nivel 1: colaborador_regra_horario_excecao_data  (pontual — "dia 15/03, so 08-12")
nivel 2: colaborador_regra_horario               (semanal — "Cleunice sempre 08-14")
nivel 3: contrato_perfis_horario                 (perfil do contrato — "Estagiario Manha 08-12")
nivel 4: sem regra                               (janela do setor/empresa inteira)
```

**Quem resolve:** `buildSolverInput()` em `solver-bridge.ts`. Pra cada (colaborador, dia), resolve a janela efetiva seguindo a precedencia. O resultado vai no array `regras_colaborador_dia[]` do SolverInput.

#### Tabela `colaborador_regra_horario` (1:1 por colab)

| Campo | Tipo | Significado |
|-------|------|-------------|
| `colaborador_id` | UNIQUE | 1 regra por colaborador |
| `perfil_horario_id` | FK nullable | Herda campos do perfil (contrato_perfis_horario) |
| `inicio_min` / `inicio_max` | TIME | Janela de entrada permitida |
| `fim_min` / `fim_max` | TIME | Janela de saida permitida |
| `preferencia_turno_soft` | TEXT | MANHA, TARDE ou null |
| `domingo_ciclo_trabalho` | INT | Domingos consecutivos de TRABALHO no ciclo (default 2) |
| `domingo_ciclo_folga` | INT | Domingos consecutivos de FOLGA no ciclo (default 1) |
| `folga_fixa_dia_semana` | TEXT | Dia que SEMPRE folga (SEG, TER... ou null) |

#### Tabela `colaborador_regra_horario_excecao_data` (N por colab)

| Campo | Tipo | Significado |
|-------|------|-------------|
| `colaborador_id` + `data` | UNIQUE | Override pontual por data |
| `inicio_min/max`, `fim_min/max` | TIME | Janela daquele dia especifico |
| `preferencia_turno_soft` | TEXT | Turno daquele dia |
| `domingo_forcar_folga` | BOOL | Forca folga nesse dia (mesmo se nao e domingo) |

#### IPC handlers — Regra horario colaborador (5)

| Handler | Input | O que faz |
|---------|-------|-----------|
| `colaboradores.buscarRegraHorario` | `{colaborador_id}` | Busca regra 1:1 do colab (ou null) |
| `colaboradores.salvarRegraHorario` | `{colaborador_id, perfil_horario_id?, inicio_min?, ...}` | UPSERT (INSERT ou UPDATE) na regra |
| `colaboradores.listarRegrasExcecaoData` | `{colaborador_id}` | Lista excecoes pontuais ORDER BY data |
| `colaboradores.upsertRegraExcecaoData` | `{colaborador_id, data, inicio_min?, ...}` | UPSERT por (colab, data) |
| `colaboradores.deletarRegraExcecaoData` | `{id}` | DELETE (hard delete — excecao e descartavel) |

### 4.3 Perfis de Horario (Contrato)

Templates reutilizaveis de janela horaria por tipo de contrato. Nao sao obrigatorios — CLT 44h/36h nao tem perfis seed.

#### Tabela `contrato_perfis_horario`

| Campo | Tipo | Significado |
|-------|------|-------------|
| `tipo_contrato_id` | FK | Qual contrato usa esse perfil |
| `nome` | TEXT | Ex: "MANHA_08_12", "TARDE_1330_PLUS" |
| `inicio_min` / `inicio_max` | TIME | Janela de entrada |
| `fim_min` / `fim_max` | TIME | Janela de saida |
| `preferencia_turno_soft` | TEXT | MANHA ou TARDE |
| `ordem` | INT | Ordenacao na UI |

#### IPC handlers — Perfis horario (4)

| Handler | Input | O que faz |
|---------|-------|-----------|
| `perfisHorario.listar` | `{tipo_contrato_id}` | Lista perfis do contrato |
| `perfisHorario.criar` | `{tipo_contrato_id, nome, inicio_min, ...}` | Cria perfil, retorna o criado |
| `perfisHorario.atualizar` | `{id, nome?, inicio_min?, ...}` | UPDATE parcial (so campos enviados) |
| `perfisHorario.deletar` | `{id}` | DELETE (hard delete) |

### 4.4 Demanda Excecao por Data

Override da demanda semanal padrao para uma data especifica (Black Friday, vespera de feriado, etc).

#### Tabela `demandas_excecao_data`

| Campo | Tipo | Significado |
|-------|------|-------------|
| `setor_id` | FK | Qual setor |
| `data` | TEXT | Data especifica (YYYY-MM-DD) |
| `hora_inicio` / `hora_fim` | TIME | Faixa horaria |
| `min_pessoas` | INT | Cobertura minima naquele slot |
| `override` | BOOL | 1 = forcado pelo gestor |

**Onde atua:** `buildSolverInput()` em solver-bridge.ts busca `demandas_excecao_data` e as inclui no SolverInput. Python `parse_demand()` usa a excecao em vez da demanda semanal quando a data coincide.

#### IPC handlers — Demanda excecao (3)

| Handler | Input | O que faz |
|---------|-------|-----------|
| `setores.listarDemandasExcecaoData` | `{setor_id, data_inicio?, data_fim?}` | Lista excecoes (filtro opcional por periodo) |
| `setores.salvarDemandaExcecaoData` | `{setor_id, data, hora_inicio, hora_fim, min_pessoas, override?}` | INSERT nova excecao |
| `setores.deletarDemandaExcecaoData` | `{id}` | DELETE (hard delete) |

### 4.5 Ciclo Rotativo

Templates de escala que repetem a cada N semanas. Permitem gerar escalas seguindo um padrao pre-definido.

#### Tabela `escala_ciclo_modelos`

| Campo | Tipo | Significado |
|-------|------|-------------|
| `setor_id` | FK | Qual setor |
| `nome` | TEXT | Nome do ciclo (ex: "Ciclo Padaria 3 semanas") |
| `semanas_no_ciclo` | INT | Quantas semanas antes de repetir |
| `ativo` | BOOL | Soft delete |
| `origem_escala_id` | FK nullable | Escala que originou o modelo |

#### Tabela `escala_ciclo_itens`

| Campo | Tipo | Significado |
|-------|------|-------------|
| `ciclo_modelo_id` | FK (CASCADE) | Qual modelo |
| `semana_idx` | INT | Indice da semana no ciclo (0-based) |
| `colaborador_id` | FK | Qual colab |
| `dia_semana` | TEXT | SEG, TER, QUA... |
| `trabalha` | BOOL | 1 = trabalha, 0 = folga |
| `ancora_domingo` | BOOL | Marca quem trabalha domingo naquela semana |
| `prioridade` | INT | Desempate |

**Fluxo de geracao por ciclo:**
```
1. UI seleciona ciclo_modelo_id + data_inicio + data_fim
2. IPC: escalas.gerarPorCicloRotativo
3. Handler:
   a. Busca modelo + itens
   b. Calcula semana_idx = (dia - data_inicio) % semanas_no_ciclo
   c. Mapeia itens do ciclo → alocacoes reais (TRABALHO/FOLGA)
   d. INSERT escalas + alocacoes
   e. Roda validarEscalaV3() no resultado
   f. Retorna EscalaCompletaV3
```

#### IPC handlers — Ciclo rotativo (4)

| Handler | Input | O que faz |
|---------|-------|-----------|
| `escalas.detectarCicloRotativo` | `{escala_id}` | Analisa escala existente e tenta detectar padrao ciclico |
| `escalas.salvarCicloRotativo` | `{setor_id, nome, semanas_no_ciclo, itens[], origem_escala_id?}` | Cria modelo + itens em transacao |
| `escalas.listarCiclosRotativos` | `{setor_id}` | Lista modelos ativos do setor |
| `escalas.gerarPorCicloRotativo` | `{ciclo_modelo_id, data_inicio, data_fim}` | Gera escala a partir do modelo |

### 4.6 Como o Bridge Resolve Tudo na Geracao

`buildSolverInput()` e a funcao que junta TODAS as regras num unico SolverInput:

```
buildSolverInput(setor_id, datas, pinnedCells, options)
  │
  ├─ [1] Dados basicos: empresa, setor, horarios (empresa_horario_semana + setor_horario_semana)
  ├─ [2] Colaboradores: JOIN tipos_contrato + funcoes (ativo=1, setor_id match)
  ├─ [3] Demandas: semanais + excecoes por data (demandas_excecao_data)
  ├─ [4] Feriados: feriados no periodo
  ├─ [5] Excecoes: ferias/atestado/bloqueio ativos no periodo
  │
  ├─ [6] Regras por (colab, dia) — RESOLVE PRECEDENCIA:
  │     Para cada colaborador, para cada dia:
  │       a. Busca excecao_data daquele (colab, dia)
  │       b. Se nao achou: busca regra_horario do colab
  │       c. Se regra tem perfil_horario_id: busca perfil
  │       d. Merge: excecao > regra > perfil > sem regra
  │       → Resultado: inicio_min/max, fim_min/max, turno, folga_fixa, domingo_forcar_folga
  │
  ├─ [7] Warm-start hints (ultima escala do mesmo periodo)
  ├─ [8] Rules config: buildRulesConfig(db, rulesOverride)
  └─ [9] Retorna SolverInput JSON completo
```

### 4.7 O que a IA precisa saber sobre regras

**A IA PODE:**
- Consultar todas as regras e seus status (`consultar` com tabelas `regra_definicao` e `regra_empresa`)
- Editar o status de regras editaveis (`editar_regra` — valida `editavel=1`, INSERT OR REPLACE em `regra_empresa`)
- Resetar regras ao default (via `editar_regra` deletando a regra_empresa, ou orientando o usuario)
- Gerar escalas com `rules_override` temporario (parametro do `gerar_escala`)

**A IA TAMBÉM PODE (tools especializadas — 28 tools no total):**
- Criar/editar regras de horario por colaborador → `salvar_regra_horario_colaborador`
- Criar/editar janelas de horario → `definir_janela_colaborador`
- Criar/editar excecoes de horario por data → `upsert_regra_excecao_data`
- Criar/editar perfis de horario por contrato → `listar_perfis_horario`, `salvar_perfil_horario`, `deletar_perfil_horario`
- Criar/editar demandas excecao por data → `salvar_demanda_excecao_data`
- Configurar horarios de funcionamento (empresa/setor) → `configurar_horario_funcionamento`
- Monitorar alertas do sistema → `obter_alertas` (escalas desatualizadas, violacoes, excecoes expirando)
- Resumir horas por setor → `resumir_horas_setor`
- Resetar regras da empresa → `resetar_regras_empresa`

**Gaps remanescentes (read-only via IA):**
- `escala_ciclo_modelos/itens` — IA pode LER ciclos via `consultar`, mas não criar/editar (orientar a usar a UI)
- `tipos_contrato` — IA pode LER contratos, mas criação/edição é pela UI (raramente necessário)

---

## 5. API Interna — IPC Handlers (Fase 4)

> **Arquivo fonte:** `src/main/tipc.ts` (~2850 linhas, ~80 handlers)
>
> Todos os handlers seguem o padrao `@egoist/tipc`: `t.procedure.input<T>().action(async ({ input }) => { ... })`

### 5.1 Mapa Completo — 80 handlers por dominio

#### Empresa (4 handlers)

| Handler | Input | O que retorna | Notas |
|---------|-------|---------------|-------|
| `empresa.buscar` | — | Empresa (singleton) | SELECT * FROM empresa LIMIT 1 |
| `empresa.atualizar` | `{nome, cnpj, telefone, corte_semanal, tolerancia_semanal_min, min_intervalo_almoco_min?, usa_cct_intervalo_reduzido?}` | Empresa atualizada | UPSERT |
| `empresa.horarios.listar` | — | `empresa_horario_semana[]` | 7 registros (SEG-DOM) |
| `empresa.horarios.atualizar` | `{horarios: Array<{dia_semana, ativo, hora_abertura, hora_fechamento}>}` | void | Batch UPSERT |

#### Tipos Contrato (9 handlers)

| Handler | Input | O que retorna | Notas |
|---------|-------|---------------|-------|
| `tiposContrato.listar` | — | `TipoContrato[]` | ORDER BY horas_semanais DESC |
| `tiposContrato.buscar` | `{id}` | `TipoContrato` | Throws se nao encontrado |
| `tiposContrato.criar` | `{nome, horas_semanais, regime_escala?, trabalha_domingo, max_minutos_dia}` | `TipoContrato` criado | Regime inferido se omitido |
| `tiposContrato.atualizar` | `{id, nome, horas_semanais, ...}` | `TipoContrato` atualizado | |
| `tiposContrato.deletar` | `{id}` | void | Throws se tem colabs usando |
| `tiposContrato.listarPerfisHorario` | `{tipo_contrato_id}` | `PerfilHorario[]` | ORDER BY ordem, id |
| `tiposContrato.criarPerfilHorario` | `{tipo_contrato_id, nome, inicio_min, inicio_max, ...}` | `PerfilHorario` criado | |
| `tiposContrato.atualizarPerfilHorario` | `{id, nome?, inicio_min?, ...}` | `PerfilHorario` atualizado | UPDATE parcial (so campos enviados) |
| `tiposContrato.deletarPerfilHorario` | `{id}` | void | Hard DELETE |

#### Setores (16 handlers)

| Handler | Input | O que retorna | Notas |
|---------|-------|---------------|-------|
| `setores.listar` | — | `Setor[]` | WHERE ativo=1, ORDER BY nome |
| `setores.buscar` | `{id}` | `Setor` | Throws se nao encontrado |
| `setores.criar` | `{nome, icone?, hora_abertura?, hora_fechamento?}` | `Setor` criado | |
| `setores.atualizar` | `{id, nome?, icone?, hora_abertura?, hora_fechamento?}` | `Setor` atualizado | |
| `setores.deletar` | `{id}` | void | Soft delete (ativo=0) |
| `setores.listarDemandas` | `{setor_id}` | `Demanda[]` | Demandas semanais padrao |
| `setores.criarDemanda` | `{setor_id, dia_semana, hora_inicio, hora_fim, min_pessoas}` | `Demanda` criada | |
| `setores.atualizarDemanda` | `{id, hora_inicio?, hora_fim?, min_pessoas?}` | `Demanda` atualizada | |
| `setores.deletarDemanda` | `{id}` | void | Hard DELETE |
| `setores.reordenarRank` | `{setor_id, colaborador_ids: number[]}` | void | Atualiza rank sequencial |
| `setores.listarHorarioSemana` | `{setor_id}` | `SetorHorarioSemana[]` | Horarios por dia da semana |
| `setores.upsertHorarioSemana` | `{setor_id, dia_semana, ativo, usa_padrao, hora_abertura?, hora_fechamento?}` | `SetorHorarioSemana` | INSERT OR REPLACE |
| `setores.salvarTimelineDia` | `{setor_id, dia_semana, demandas[]}` | resultado com snap grid 15 | Salva demandas + horario de uma vez |
| `setores.listarDemandasExcecaoData` | `{setor_id, data_inicio?, data_fim?}` | `DemandaExcecaoData[]` | Filtro opcional por periodo |
| `setores.salvarDemandaExcecaoData` | `{setor_id, data, hora_inicio, hora_fim, min_pessoas}` | `DemandaExcecaoData` criada | |
| `setores.deletarDemandaExcecaoData` | `{id}` | void | Hard DELETE |

#### Funcoes (5 handlers)

| Handler | Input | O que retorna | Notas |
|---------|-------|---------------|-------|
| `funcoes.listar` | `{setor_id}` | `Funcao[]` | WHERE ativo=1, ORDER BY ordem |
| `funcoes.buscar` | `{id}` | `Funcao` | |
| `funcoes.criar` | `{setor_id, apelido, tipo_contrato_id?, cor_hex?, ordem?}` | `Funcao` criada | |
| `funcoes.atualizar` | `{id, apelido?, cor_hex?, ordem?}` | `Funcao` atualizada | |
| `funcoes.deletar` | `{id}` | void | Soft delete (ativo=0) |

#### Feriados (3 handlers)

| Handler | Input | O que retorna | Notas |
|---------|-------|---------------|-------|
| `feriados.listar` | `{ano?}` | `Feriado[]` | Filtro opcional por ano |
| `feriados.criar` | `{data, nome, tipo, proibido_trabalhar, cct_autoriza}` | `Feriado` criado | |
| `feriados.deletar` | `{id}` | void | Hard DELETE |

#### Colaboradores (10 handlers)

| Handler | Input | O que retorna | Notas |
|---------|-------|---------------|-------|
| `colaboradores.listar` | `{setor_id}` | `Colaborador[]` | WHERE ativo=1, JOINs contrato+funcao |
| `colaboradores.buscar` | `{id}` | `Colaborador` | JOIN contrato+funcao |
| `colaboradores.criar` | `{setor_id, tipo_contrato_id, nome, sexo?, horas_semanais, rank?, ...}` | `Colaborador` criado | |
| `colaboradores.atualizar` | `{id, nome?, setor_id?, tipo_contrato_id?, ...}` | `Colaborador` atualizado | |
| `colaboradores.deletar` | `{id}` | void | Soft delete (ativo=0) |
| `colaboradores.buscarRegraHorario` | `{colaborador_id}` | `RegraHorario \| null` | 1:1 regra individual |
| `colaboradores.salvarRegraHorario` | `{colaborador_id, perfil_horario_id?, inicio_min?, ...}` | `RegraHorario` | UPSERT |
| `colaboradores.listarRegrasExcecaoData` | `{colaborador_id}` | `ExcecaoData[]` | ORDER BY data |
| `colaboradores.upsertRegraExcecaoData` | `{colaborador_id, data, inicio_min?, ...}` | `ExcecaoData` | UPSERT por (colab,data) |
| `colaboradores.deletarRegraExcecaoData` | `{id}` | void | Hard DELETE |

#### Excecoes (5 handlers)

| Handler | Input | O que retorna | Notas |
|---------|-------|---------------|-------|
| `excecoes.listar` | `{colaborador_id?}` | `Excecao[]` | Filtro opcional por colab |
| `excecoes.listarAtivas` | `{colaborador_id?, data?}` | `Excecao[]` | Filtra ativas no periodo |
| `excecoes.criar` | `{colaborador_id, data_inicio, data_fim, tipo, observacao?}` | `Excecao` criada | tipo: FERIAS/ATESTADO/BLOQUEIO |
| `excecoes.atualizar` | `{id, data_inicio?, data_fim?, tipo?, observacao?}` | `Excecao` atualizada | |
| `excecoes.deletar` | `{id}` | void | Hard DELETE |

#### Escalas (12 handlers)

| Handler | Input | O que retorna | Notas |
|---------|-------|---------------|-------|
| `escalas.buscar` | `{id}` | `EscalaCompletaV3` | Busca escala + alocacoes + indicadores via validarEscalaV3() |
| `escalas.resumoPorSetor` | — | `Array<{setor_id, setor_nome, status, data_inicio, data_fim}>` | Ultima escala por setor |
| `escalas.listarPorSetor` | `{setor_id}` | `Escala[]` | Todas as escalas do setor |
| `escalas.preflight` | `{setor_id, data_inicio, data_fim, regimes_override?}` | `EscalaPreflightResult` | Blockers + warnings ANTES de gerar |
| `escalas.gerar` | `{setor_id, data_inicio, data_fim, solve_mode?, max_time_seconds?, rules_override?}` | `EscalaCompletaV3` | Fluxo completo: preflight → buildInput → runSolver → persist |
| `escalas.oficializar` | `{escala_id}` | `EscalaCompletaV3` | Valida violacoes_hard=0, UPDATE status→OFICIAL, arquiva anteriores |
| `escalas.ajustar` | `{escala_id, ajustes[]}` | `EscalaCompletaV3` | UPDATE alocacoes + revalida via validarEscalaV3() |
| `escalas.deletar` | `{escala_id}` | void | DELETE (CASCADE em alocacoes, decisoes, comparacao) |
| `escalas.detectarCicloRotativo` | `{escala_id}` | `{detectado, ciclo?}` | Analisa padrao ciclico na escala |
| `escalas.salvarCicloRotativo` | `{setor_id, nome, semanas_no_ciclo, itens[]}` | `CicloModelo` | Cria modelo + itens em transacao |
| `escalas.listarCiclosRotativos` | `{setor_id}` | `CicloModelo[]` | Ativos, ORDER BY criado_em DESC |
| `escalas.gerarPorCicloRotativo` | `{ciclo_modelo_id, data_inicio, data_fim}` | `EscalaCompletaV3` | Gera a partir do template + valida |

#### Dashboard (1 handler)

| Handler | Input | O que retorna | Notas |
|---------|-------|---------------|-------|
| `dashboard.resumo` | — | `DashboardResumo` | Totais, status por setor, alertas |

#### Export (4 handlers)

| Handler | Input | O que retorna | Notas |
|---------|-------|---------------|-------|
| `export.salvarHTML` | `{html, filename?}` | `{filepath} \| null` | Dialog nativo de salvar |
| `export.imprimirPDF` | `{html}` | `{filepath} \| null` | Gera PDF via BrowserWindow offscreen |
| `export.salvarCSV` | `{csv, filename?}` | `{filepath} \| null` | Dialog nativo de salvar |
| `export.batchHTML` | `{escala_id}` | `{filepath} \| null` | Gera HTML batch (todos os colabs) |

#### Regras do Motor (4 handlers)

Documentados em detalhe na secao 4.1 (Fase 3).

| `regras.listar` | `regras.atualizar` | `regras.resetarEmpresa` | `regras.resetarRegra` |

#### IA (14 handlers)

| Handler | Input | O que retorna | Notas |
|---------|-------|---------------|-------|
| `ia.configuracao.obter` | — | `IaConfiguracao \| null` | Singleton da configuracao |
| `ia.configuracao.salvar` | `{provider, api_key, modelo, provider_configs_json?}` | `IaConfiguracao` | UPSERT |
| `ia.configuracao.testar` | `{provider, api_key, modelo}` | `{sucesso, mensagem}` | Ping no provider + catalogo |
| `ia.modelos.catalogo` | `{provider, force_refresh?}` | `IaModelCatalogResult` | Gemini: estatico; OpenRouter: API real. Cache 15min |
| `ia.chat.enviar` | `{mensagem, conversa_id?, modelo?, provider?}` | streaming chunks via IPC | Entry point da conversa com IA |
| `ia.conversas.listar` | — | `IaConversa[]` | ORDER BY atualizado_em DESC |
| `ia.conversas.obter` | `{id}` | `IaConversa + mensagens[]` | Conversa com historico |
| `ia.conversas.criar` | `{titulo?}` | `IaConversa` | UUID como PK |
| `ia.conversas.renomear` | `{id, titulo}` | void | |
| `ia.conversas.arquivar` | `{id}` | void | status → 'arquivado' |
| `ia.conversas.restaurar` | `{id}` | void | status → 'ativo' |
| `ia.conversas.deletar` | `{id}` | void | Hard DELETE (CASCADE mensagens) |
| `ia.conversas.arquivarTodas` | — | void | Arquiva todas as ativas |
| `ia.conversas.deletarArquivadas` | — | void | Deleta todas as arquivadas |
| `ia.mensagens.salvar` | `{conversa_id, mensagem}` | void | Persiste mensagem no historico |

#### Backup/Restore (2 handlers)

| Handler | Input | O que retorna | Notas |
|---------|-------|---------------|-------|
| `dados.exportar` | — | `{filepath} \| null` | Exporta todas as tabelas como JSON |
| `dados.importar` | — | `{tabelas, registros} \| null` | Importa JSON, preserva ordem de dependencias |

### 5.2 Funcoes de Suporte Importantes (nao sao IPC, mas afetam tudo)

| Funcao | Arquivo | O que faz |
|--------|---------|-----------|
| `buildEscalaPreflight()` | tipc.ts:230 | Verifica setor ativo, colabs, demandas, capacidade. Blockers = nao gera. Warnings = gera com aviso. |
| `enrichPreflightWithCapacityChecks()` | tipc.ts:89 | Valida capacidade diaria, domingo sem colabs, feriado proibido com demanda, janela insuficiente por colab. |
| `normalizeRegimesOverride()` | tipc.ts:40 | Sanitiza array de regime overrides por colab. |
| `buildSolverInput()` | solver-bridge.ts | Monta o JSON completo pra o solver Python. |
| `persistirSolverResult()` | solver-bridge.ts | Transacao: INSERT escala + alocacoes + decisoes + comparacao. |
| `validarEscalaV3()` | validador.ts | Reconstroi estado e valida todas as regras. |

### 5.3 Contagem final

| Dominio | Handlers | Operacoes write | Operacoes read |
|---------|----------|----------------|----------------|
| Empresa | 4 | 2 (atualizar, horarios.atualizar) | 2 |
| Tipos Contrato | 9 | 4 (CRUD + perfis CRUD) | 5 |
| Setores | 16 | 9 | 7 |
| Funcoes | 5 | 3 | 2 |
| Feriados | 3 | 2 | 1 |
| Colaboradores | 10 | 5 | 5 |
| Excecoes | 5 | 3 | 2 |
| Escalas | 12 | 5 (gerar, ajustar, oficializar, deletar, ciclo) | 7 |
| Dashboard | 1 | 0 | 1 |
| Export | 4 | 0 | 4 (geram arquivos no filesystem) |
| Regras | 4 | 3 | 1 |
| IA | 14 | 7 | 7 |
| Backup | 2 | 1 | 1 |
| **TOTAL** | **89** | **44** | **45** |

### 5.4 O que a IA pode vs nao pode acessar via IPC

**A IA acessa DIRETAMENTE (via suas tools):**
- `escalas.gerar` → tool `gerar_escala`
- `escalas.ajustar` → tool `ajustar_alocacao`
- `escalas.oficializar` → tool `oficializar_escala`
- `regras.atualizar` → tool `editar_regra`
- SELECT em varias tabelas → tool `consultar` (whitelist)

**A IA NAO tem tools para (89 - 5 = 84 handlers inacessiveis):**
- TUDO de empresa, setores, funcoes, feriados, colaboradores, excecoes, tipos contrato, perfis, regras colab, demandas, ciclos, export, dashboard, backup
- Cada um desses e uma operacao que o usuario precisa fazer pela UI

**Impacto prático:**
A IA so e autonoma no dominio de ESCALAS e REGRAS DO MOTOR. Para todo o resto, ela pode INFORMAR e ORIENTAR, mas nao pode EXECUTAR.

---

## 6. Sistema IA Atual (Fase 5)

> **Arquivos fonte:**
> - `src/main/ia/cliente.ts` (335 linhas) — orquestrador de mensagens
> - `src/main/ia/tools.ts` (1593 linhas) — 13 tools com Zod + handlers
> - `src/main/ia/system-prompt.ts` (423 linhas) — prompt com 9 secoes
> - `src/main/ia/discovery.ts` (201 linhas) — auto-contexto por pagina

### 6.1 Arquitetura geral do fluxo IA

```
[Renderer]                [Main Process]                 [LLM Provider]
    |                          |                              |
    |  iaEnviarMsg(msg,hist)   |                              |
    |─────────────────────────>|                              |
    |                          |                              |
    |                    ┌─────┴──────┐                       |
    |                    │ resolveKey │ provider_configs_json  |
    |                    │            │ → api_key fallback     |
    |                    └─────┬──────┘                       |
    |                          |                              |
    |                    buildFullSystemPrompt(contexto)       |
    |                    = SYSTEM_PROMPT + buildContextBriefing|
    |                          |                              |
    |                    buildChatMessages(historico, msg)     |
    |                    = [{role,content}...] user/assistant  |
    |                          |                              |
    |                    getVercelAiTools()                    |
    |                    = 13 tools com Zod + execute()        |
    |                          |                              |
    |                    generateText({                        |
    |                      model, system, messages,            |
    |                      tools,                              |
    |                      stopWhen: stepCountIs(10)           |
    |                    })────────────────────────────────────>|
    |                          |                              |
    |                          |<─── step 1: tool_call ───────|
    |                          |     executeTool() local       |
    |                          |──── tool_result ─────────────>|
    |                          |                              |
    |                          |<─── step N: text ────────────|
    |                          |                              |
    |                    [Se text vazio + tools executadas]    |
    |                    → forca turno final sem tools         |
    |                          |                              |
    |                    extractToolCallsFromSteps()           |
    |                    = ToolCall[] para UI                  |
    |                          |
```

**Code path principal** (`cliente.ts:143-207`):
```typescript
async function _callWithVercelAiSdkTools(providerLabel, config, currentMsg, historico, contexto, createModel) {
    const fullSystemPrompt = buildFullSystemPrompt(contexto)  // SYSTEM_PROMPT + discovery
    const messages = buildChatMessages(historico, currentMsg)  // só user/assistant
    const tools = getVercelAiTools()                           // 13 tools com Zod
    const model = await maybeWrapModelWithDevTools(createModel(modelo))

    const result = await generateText({
        model, system: fullSystemPrompt, messages, tools,
        stopWhen: stepCountIs(10)  // CRÍTICO: sem isso, para no primeiro tool call!
    })

    const acoes = extractToolCallsFromSteps(result.steps)

    // FIX: Se executou tools mas não gerou texto, força resposta
    if ((!finalText || finalText.trim().length === 0) && acoes.length > 0) {
        messages.push({ role: 'user', content: 'Responda agora em linguagem natural...' })
        const finalResult = await generateText({ model, system: fullSystemPrompt, messages })
        // SEM tools → força texto puro
    }
    return { resposta: finalText, acoes }
}
```                              |
    |  {resposta, acoes}       |                              |
    |<─────────────────────────|                              |
```

**Ponto critico — `stopWhen: stepCountIs(10)`:**
Sem essa opcao, o AI SDK para no PRIMEIRO tool call e retorna sem executar nada. Com ela, o SDK roda ate 10 turnos (tool call → tool result → proximo passo) antes de parar. Isso permite que a IA chame `get_context()`, depois `consultar()`, depois `gerar_escala()` tudo na mesma interacao.

**Fix para texto vazio:**
Alguns modelos (Gemini em particular) executam tools mas nao geram texto ao final. Quando isso acontece, o sistema forca um turno extra SEM tools, injetando `"Responda agora em linguagem natural o que voce fez e o resultado."` como mensagem do usuario. Isso garante que o usuario SEMPRE recebe uma resposta textual.

### 6.2 Providers suportados

| Provider | Factory | Modelo default | Pacote |
|----------|---------|----------------|--------|
| `gemini` | `createGoogleGenerativeAI({ apiKey })` | `gemini-2.5-flash` | `@ai-sdk/google` |
| `openrouter` | `createOpenRouter({ apiKey })` | `anthropic/claude-sonnet-4` | `@openrouter/ai-sdk-provider` |

**Resolucao de API key (prioridade):**
1. `config.provider_configs_json[provider].token` — UI multi-provider salva aqui
2. `config.api_key` — fallback legado

Ambos os providers usam a mesma funcao `_callWithVercelAiSdkTools()` — a unica diferenca e a factory do model. Isso garante comportamento identico independente do provider.

### 6.3 Historico de mensagens

O `buildChatMessages()` converte `IaMensagem[]` do banco para o formato AI SDK:

```
IaMensagem { papel: 'usuario' | 'assistente', conteudo: string }
    ↓
AI SDK { role: 'user' | 'assistant', content: string }
```

**Regras:**
- Filtra SOMENTE `papel === 'usuario'` ou `'assistente'` (ignora mensagens de sistema/tool)
- Adiciona a mensagem atual do usuario ao final
- Mensagens de tool call NAO sao re-enviadas no historico (o AI SDK cuida disso internamente via steps)

### 6.4 System prompt — 9 secoes

O `SYSTEM_PROMPT` em `system-prompt.ts` tem 423 linhas com 9 secoes distintas:

| # | Secao | Linhas | Proposito |
|---|-------|--------|-----------|
| 1 | CRITICAL WORKFLOW — DISCOVERY FIRST | 1-34 | Obriga `get_context()` como PRIMEIRA chamada SEMPRE |
| 2 | SEMPRE FINALIZE COM RESPOSTA EM TEXTO | 36-67 | Proibe silencio apos tool calls |
| 3 | REGRA ZERO — NUNCA PECA INFORMACOES | 69-83 | Proibe perguntar ao usuario o que pode buscar sozinha |
| 4 | NUNCA MOSTRE ERROS TECNICOS | 85-129 | Erros sao pra IA corrigir, nao mostrar |
| 5 | PROTOCOLO DE RESOLUCAO DE NOMES | 131-147 | nome → get_context() → ID → usar ID |
| 6 | AUTO-CONTEXTO DA PAGINA | 148-162 | Hierarquia: get_context() > auto-contexto |
| 7 | DOMINIO DE NEGOCIO + REGRAS V6 | 164-280 | Entidades, Motor V3, Dicionario de regras, Exemplos |
| 8 | JORNADA SOCRATICA | 392-404 | Fluxo de ajuda com escalas (9 passos) |
| 9 | CONDUTA E TOM DE VOZ | 407-423 | Persona "Miss Monday do EscalaFlow" |

**Detalhe da secao 7 — Dicionario completo no prompt:**
O system prompt inclui a lista completa de regras (H1-H18, S_*, DIAS_TRABALHO, MIN_DIARIO) com descricoes curtas. Isso permite que a IA responda "o que e H14?" sem precisar chamar `explicar_violacao`.

**Detalhe da secao 7 — Schema reference:**
O prompt lista TODAS as tabelas consultaveis com seus campos, para que a IA saiba quais filtros usar em `consultar()`:
```
- setores: id, nome, hora_abertura, hora_fechamento, ativo
- colaboradores: id, setor_id, tipo_contrato_id, nome, sexo, ativo, rank, prefere_turno, tipo_trabalhador
- alocacoes: id, escala_id, colaborador_id, data, status, hora_inicio, hora_fim, minutos_trabalho
- (... 12 tabelas no total)
```

**Detalhe da secao 7 — Workflow CSV/lote:**
O prompt documenta um fluxo de 5 passos pra importacao em massa:
1. get_context() pra descobrir setores existentes
2. Parsear CSV/tabela
3. Mostrar plano de mapeamento
4. cadastrar_lote() com registros mapeados
5. Resumo final

### 6.5 Auto-contexto (`discovery.ts`)

O `buildContextBriefing()` e chamado ANTES da requisicao ao LLM e monta uma string markdown que e concatenada ao final do system prompt. Nao custa tokens de tool call — e gratuito.

**Conteudo SEMPRE injetado (independente da pagina):**
- Resumo global: total setores ativos, colaboradores ativos, escalas RASCUNHO/OFICIAL
- Lista de setores com contagem de colaboradores

**Conteudo CONDICIONAL por rota:**

| Condicao | Dados injetados |
|----------|-----------------|
| `contexto.setor_id` presente | `_infoSetor()`: lista de colaboradores (nome, contrato, horas), demandas planejadas, escala atual (indicadores, distribuicao TRABALHO/FOLGA) |
| `contexto.colaborador_id` presente | `_infoColaborador()`: setor, contrato, regime, preferencia de turno, excecoes ativas |
| `contexto.pagina` | `_dicaPagina()`: hint contextual (ex: "O usuario esta na pagina de ESCALA — use dados acima sem perguntar") |

**Paginas com dicas registradas:**
`dashboard`, `setor_lista`, `setor_detalhe`, `escala`, `escalas_hub`, `colaborador_lista`, `colaborador_detalhe`, `contratos`, `empresa`, `feriados`, `configuracoes`, `regras`

**Hierarquia de confianca:**
1. `get_context()` tool — JSON estruturado, sempre mais confiavel
2. Auto-contexto — String markdown, complementar (pode estar desatualizado se usuario navegou)

### 6.6 As 13 tools — visao geral

Todas as tools sao definidas no array `IA_TOOLS[]` (`tools.ts:66`) em formato Gemini API e convertidas para formato Vercel AI SDK via `getVercelAiTools()` (`tools.ts:418`). Cada tool tem:
- Schema Zod para validacao runtime (`tools.ts:502-518`)
- Funcao `execute()` que chama `executeTool(name, args)` (`tools.ts:497`)
- Descricao detalhada com exemplos (para o LLM)

| # | Tool | Tipo | Schema Zod | O que faz |
|---|------|------|------------|-----------|
| 1 | `get_context` | Discovery | nenhum | Retorna setores + colaboradores + tipos_contrato + escalas ativas com JOINs |
| 2 | `consultar` | Discovery | ConsultarSchema | SELECT generico com filtros — 12 entidades, campos validados |
| 3 | `criar` | Acao | CriarSchema | INSERT generico — 7 entidades, defaults inteligentes pra colaboradores/excecoes |
| 4 | `atualizar` | Acao | AtualizarSchema | UPDATE generico — 5 entidades |
| 5 | `deletar` | Acao | DeletarSchema | DELETE — 4 entidades |
| 6 | `editar_regra` | Acao | EditarRegraSchema | INSERT OR REPLACE em regra_empresa — valida editavel=1 |
| 7 | `gerar_escala` | Acao | GerarEscalaSchema | buildSolverInput → runSolver(60s) → persistirSolverResult |
| 8 | `ajustar_alocacao` | Acao | AjustarAlocacaoSchema | UPDATE alocacoes (escala_id + colaborador_id + data → status) |
| 9 | `oficializar_escala` | Acao | OficializarEscalaSchema | UPDATE escalas status='OFICIAL' — valida violacoes_hard=0 |
| 10 | `preflight` | Validacao | PreflightSchema | Verifica setor ativo + colabs + demandas + feriados |
| 11 | `resumo_sistema` | Discovery | nenhum | DEPRECATED — contadores basicos (use get_context) |
| 12 | `explicar_violacao` | Referencia | ExplicarViolacaoSchema | Lookup em DICIONARIO_VIOLACOES + fallback para regra_definicao |
| 13 | `cadastrar_lote` | Acao | CadastrarLoteSchema | Batch INSERT ate 200 registros — mesmos defaults de `criar` |

**Dispatch: como `executeTool()` funciona** (`tools.ts:497-525`):
```typescript
export async function executeTool(name: string, args: Record<string, any>): Promise<any> {
    const db = (global as any).mockDb || getDb()

    // Validação Zod runtime — TODA tool passa por aqui
    const schema = TOOL_SCHEMAS[name]
    if (schema) {
        const validation = schema.safeParse(args)
        if (!validation.success) {
            return toolError('INVALID_TOOL_ARGUMENTS', `❌ Validação falhou...`, {
                correction: 'Corrija os argumentos com base no schema da tool.'
            })
        }
        args = validation.data as Record<string, any>  // type-safe daqui pra frente
    }

    // Handlers por nome — if/else chain (nao switch)
    if (name === 'get_context') { /* ... */ }
    if (name === 'consultar') { /* ... */ }
    // ...etc para cada tool
}
```

**Como tools sao convertidas para Vercel AI SDK** (`tools.ts:418-494`):
```typescript
export function getVercelAiTools() {
    const tools: Record<string, any> = {}
    for (const tool of IA_TOOLS) {
        tools[tool.name] = {
            description: tool.description,
            parameters: tool.parameters
                ? toJsonSchema(TOOL_SCHEMAS[tool.name]!)  // Zod → JSON Schema
                : z.object({}),
            execute: async (args: any) => executeTool(tool.name, args),
        }
    }
    return tools
}
```

### 6.7 Seguranca das tools

**Whitelists de entidades (4 conjuntos independentes):**

| Operacao | Entidades permitidas |
|----------|---------------------|
| Leitura | colaboradores, setores, escalas, alocacoes, excecoes, demandas, tipos_contrato, empresa, feriados, funcoes, regra_definicao, regra_empresa |
| Criacao | colaboradores, excecoes, demandas, tipos_contrato, setores, feriados, funcoes |
| Atualizacao | colaboradores, empresa, tipos_contrato, setores, demandas |
| Delecao | excecoes, demandas, feriados, funcoes |

**Protecao contra SQL injection:**
O `CAMPOS_VALIDOS` define um Set<string> por entidade com TODOS os campos aceitos. Se a IA passar um campo que nao existe, recebe erro antes da query SQL. Isso impede SQL injection via nomes de campo.

**Validacao Zod runtime:**
Toda chamada de tool passa por `schema.safeParse(args)`. Se invalido, retorna `toolError` com detalhes dos campos com problema. A IA pode corrigir e tentar de novo (ate 10 turnos).

**Limite de resultados:**
`CONSULTAR_MODEL_ROW_LIMIT = 50` — consultar() nunca retorna mais de 50 rows ao LLM. Se ultrapassa, retorna `toolTruncated` com status `'truncated'`.

### 6.8 Helpers de resposta das tools

As tools usam 3 helpers padronizados para consistencia:

| Helper | Uso | Campos |
|--------|-----|--------|
| `toolOk(payload, {summary, meta})` | Sucesso | `status: 'ok'`, payload espalhado, `_meta` opcional |
| `toolError(code, message, {correction, meta, details})` | Erro | `status: 'error'`, `code`, `message`, `erro` (compat), `correction` |
| `toolTruncated(payload, {summary, meta})` | Parcial | `status: 'truncated'`, payload espalhado |

O campo `_meta` carrega metadados que a UI pode usar (ex: `tool_kind: 'discovery'`, `next_tools_hint`).
O campo `correction` e uma dica PRO LLM de como corrigir o erro.
O campo `erro` (alias de `message`) existe por compatibilidade com fluxos legados da UI.

### 6.9 Enrichment de dados

A funcao `enrichConsultarRows()` adiciona nomes legiveis por humano aos resultados de `consultar`:

| Entidade | Campos adicionados |
|----------|-------------------|
| `colaboradores` | `setor_nome`, `tipo_contrato_nome` |
| `escalas` | `setor_nome` |
| `alocacoes` | `colaborador_nome` |
| `excecoes` | `colaborador_nome` |
| `demandas` / `funcoes` | `setor_nome`, `tipo_contrato_nome` (se aplicavel) |
| `regra_empresa` | `regra_nome` |

Usa caches (Map) internos para evitar queries repetidas. Isso permite que a IA resolva nomes sem chamar tools extras.

### 6.10 Defaults inteligentes na criacao

Quando a IA cria um `colaborador` sem fornecer todos os campos:

| Campo ausente | Default aplicado |
|---------------|-----------------|
| `sexo` | `'M'` |
| `tipo_contrato_id` | `1` (CLT 44h 6x1 — mais comum) |
| `tipo_trabalhador` | `'regular'` |
| `data_nascimento` | Aleatoria entre 25-40 anos |
| `hora_inicio_min` | `setor.hora_abertura` |
| `hora_fim_max` | `setor.hora_fechamento` |
| `ativo` | `1` |
| `horas_semanais` (em lote) | Buscado do contrato selecionado |

Para `excecoes`:
- `motivo` default = `tipo` (ex: se tipo='FERIAS', motivo='FERIAS')

### 6.11 A tool `gerar_escala` em detalhe

```
gerar_escala({ setor_id, data_inicio, data_fim, rules_override? })
    │
    ├─ [1] buildSolverInput(setor_id, data_inicio, data_fim, undefined, { rulesOverride })
    │       → Monta JSON completo: colaboradores, demandas, regras, feriados, excecoes
    │
    ├─ [2] runSolver(solverInput, timeout=60_000)
    │       → Spawn Python solver, stdin JSON, stdout JSON
    │       → Timeout 60 segundos
    │
    ├─ [3] Se !sucesso: retorna toolError com diagnostico do solver
    │       → diagnostico contém: regras_ativas, regras_off, num_colaboradores, num_dias
    │
    ├─ [4] persistirSolverResult(setor_id, data_inicio, data_fim, solverResult)
    │       → INSERT escala + INSERT alocacoes em batch
    │       → Escala salva como RASCUNHO
    │
    └─ [5] Retorna toolOk com:
            escala_id, solver_status, indicadores (pontuacao, cobertura, violacoes), diagnostico
```

**Parametro `rules_override`:**
Permite temporariamente mudar status de regras SEM alterar a configuracao permanente da empresa. Exemplo: `{"H1": "SOFT"}` — trata max dias consecutivos como penalidade em vez de hard constraint, so nessa geracao.

### 6.12 A tool `get_context` em detalhe

E a tool mais importante. Retorna JSON estruturado com JOINs:

```json
{
  "version": "1.0",
  "timestamp": "2026-02-22T...",
  "stats": {
    "setores_ativos": 4,
    "colaboradores_ativos": 25,
    "escalas_rascunho": 2,
    "escalas_oficiais": 1
  },
  "setores": [
    {
      "id": 3, "nome": "Caixa",
      "hora_abertura": "07:00", "hora_fechamento": "22:00",
      "colaboradores_count": 15, "escalas_count": 1
    }
  ],
  "colaboradores": [
    {
      "id": 5, "nome": "Joao Silva",
      "setor_id": 3, "setor_nome": "Caixa",
      "tipo_contrato_id": 1, "contrato_nome": "CLT 44h (6x1)",
      "horas_semanais": 44, "tipo_trabalhador": "regular"
    }
  ],
  "tipos_contrato": [
    { "id": 1, "nome": "CLT 44h (6x1)", "horas_semanais": 44, ... }
  ],
  "escalas": [
    { "id": 42, "setor_id": 3, "setor_nome": "Caixa", "status": "RASCUNHO", ... }
  ],
  "instructions": "Use this structured data to resolve names to IDs..."
}
```

**Queries internas:**
- Setores: LEFT JOIN colaboradores + escalas, GROUP BY → contagem inline
- Colaboradores: JOIN setores + tipos_contrato → nomes e horas_semanais
- Tipos contrato: SELECT direto, ORDER BY horas_semanais DESC
- Escalas: JOIN setores, filtra RASCUNHO/OFICIAL, ordena por status+id

### 6.13 Extraindo tool calls para a UI

`extractToolCallsFromSteps()` percorre os steps do AI SDK e emparelha tool calls com tool results:

```
Para cada step:
    Para cada toolCall:
        [1] Busca toolResult por toolCallId (Map)
        [2] Fallback: busca por indice do array
        [3] Normaliza args (input ?? args → Record)
        [4] Extrai result (output ?? result ?? error)
        [5] Monta ToolCall { id, name, args?, result? }
```

**Compatibilidade AI SDK v6:**
- `tc.input` (v6) ou `tc.args` (v5)
- `tr.output` (v6) ou `tr.result` (v5) ou `tr.error`
- `normalizeToolArgs()` converte valores nao-objeto em `{ value: X }`

### 6.14 DevTools middleware (opcional)

Se `ESCALAFLOW_AI_DEVTOOLS=1` ou `NODE_ENV !== 'production'`:
- Tenta importar `@ai-sdk/devtools` dinamicamente
- Se disponivel, wrapa o model com `wrapLanguageModel({ model, middleware: devToolsMiddleware() })`
- Permite visualizar requests no AI SDK DevTools (http://localhost:4983)
- Resolve uma vez, cacheia resultado — nao tenta importar de novo se falhou

### 6.15 Teste de conexao

`iaTestarConexao(provider, apiKey, modelo)` e um endpoint separado usado pela UI de configuracao:
- Chama `generateText({ model, prompt: 'Responda apenas: OK' })` — sem tools
- Retorna `{ sucesso, mensagem }` com os primeiros 50 chars da resposta
- Usado quando o usuario configura um novo provider/modelo

### 6.16 Gaps e limitacoes do sistema IA atual

**GAPS DE TOOLS (operacoes que existem no tipc.ts mas a IA nao acessa):**

| Operacao | IPC handlers | Por que a IA nao tem |
|----------|-------------|---------------------|
| Regras horario por colaborador | 5 handlers (listar/buscar/criar/atualizar/deletar) | Complexidade: janela min/max inicio/fim |
| Excecoes horario por data | 2 handlers (listar/criar) | Mesma janela, mas por data especifica |
| Perfis horario por contrato | 4 handlers | Regras no nivel do contrato |
| Demanda excecao por data | 3 handlers | Demanda override por data especifica |
| Ciclo rotativo | 4 handlers | Modelo de ciclo + itens |
| Funcoes (CRUD completo) | 5 handlers | So tem deletar, falta criar/atualizar |
| Exportar HTML/PDF | 4 handlers | Precisa gerar arquivo no filesystem |
| Duplicar escala | 1 handler | Copia com novo periodo |
| Backup/restore | 2 handlers | Acesso ao filesystem |
| Timeline dia (salvar horarios) | 1 handler | Edita hora_inicio/hora_fim/almoco |
| Dashboard metricas | 1 handler | Retorna KPIs agregados |

**GAPS DE COMPORTAMENTO:**

1. **Preflight simplificado:** A tool `preflight` da IA e MENOS completa que `buildEscalaPreflight()` do tipc.ts. Falta `enrichPreflightWithCapacityChecks()` (validacao de capacidade por colaborador vs demanda).

2. **Sem ajuste de horario:** `ajustar_alocacao` so muda status (TRABALHO/FOLGA/INDISPONIVEL), nao muda `hora_inicio`/`hora_fim`. Para ajustar horarios, o usuario precisa usar a UI de timeline.

3. **Sem duplicacao/regeneracao:** A IA pode GERAR uma escala nova, mas nao pode DUPLICAR uma existente com novo periodo (handler `escalas.duplicar` no tipc.ts).

4. **Sem export:** A IA nao pode gerar HTML/PDF de exportacao — isso requer acesso ao filesystem.

5. **History rebuild limitado:** O `buildChatMessages()` so envia texto user/assistant. Tool calls anteriores nao sao re-enviados no historico, o que pode limitar a capacidade do LLM de "lembrar" quais tools ja chamou em conversas longas.

6. **Sem streaming:** O sistema usa `generateText()` (nao `streamText()`), entao a resposta so aparece completa. Nao ha feedback progressivo durante a geracao.

---

## 7. Frontend e Jornadas (Fase 6)

> **Arquivos fonte:**
> - `src/renderer/src/App.tsx` — Shell, rotas, layout chain
> - `src/renderer/src/paginas/` — 13 paginas
> - `src/renderer/src/componentes/` — 35 componentes custom
> - `src/renderer/src/servicos/` — 12 services IPC
> - `src/renderer/src/store/iaStore.ts` — Zustand store da IA
> - `src/renderer/src/hooks/` — 6 hooks custom

### 7.1 Mapa de rotas e paginas

| Rota | Componente | Arquivo | Tamanho | Proposito |
|------|-----------|---------|---------|-----------|
| `/` | Dashboard | Dashboard.tsx | 7KB | KPIs, alertas, acesso rapido |
| `/setores` | SetorLista | SetorLista.tsx | 18KB | Lista de setores com cards |
| `/setores/:id` | SetorDetalhe | SetorDetalhe.tsx | 42KB | Detalhe setor: colabs, demandas, postos, excecoes |
| `/setores/:id/escala` | EscalaPagina | EscalaPagina.tsx | 74KB | Grid de escala, timeline, geracao, ajustes |
| `/escalas` | EscalasHub | EscalasHub.tsx | 25KB | Hub centralizado de todas as escalas |
| `/colaboradores` | ColaboradorLista | ColaboradorLista.tsx | 30KB | Lista com filtros e bulk actions |
| `/colaboradores/:id` | ColaboradorDetalhe | ColaboradorDetalhe.tsx | 47KB | Detalhe: regras horario, excecoes, ciclo |
| `/tipos-contrato` | ContratoLista | ContratoLista.tsx | 29KB | CRUD contratos + perfis de horario |
| `/empresa` | EmpresaConfig | EmpresaConfig.tsx | 10KB | Dados empresa + horarios semana |
| `/feriados` | FeriadosPagina | FeriadosPagina.tsx | 8KB | CRUD feriados |
| `/configuracoes` | ConfiguracoesPagina | ConfiguracoesPagina.tsx | 34KB | Config IA (providers, modelos, teste) |
| `/regras` | RegrasPagina | RegrasPagina.tsx | 19KB | Engine regras (CLT/SOFT/AP) com toggles |
| `*` | NaoEncontrado | NaoEncontrado.tsx | 1KB | 404 |

### 7.2 Layout chain (como descrito no CLAUDE.md)

```
html (height: 100%)
  └─ body (height: 100%)
      └─ #root (height: 100%)
          └─ SidebarProvider (h-svh overflow-hidden)
              ├─ AppSidebar
              │    ├─ mainNav: Dashboard, Setores, Colaboradores, Escalas
              │    ├─ configNav: Tipos de Contrato, Feriados, Regras
              │    └─ Footer dropdown: Empresa, Configuracoes, Tema, Tour, Sobre
              │
              └─ SidebarInset (h-full min-h-0 overflow-hidden)
                  └─ #CONTENT_AREA (flex min-h-0 flex-1)
                      ├─ main (min-h-0 flex-1 min-w-0 overflow-auto) ← UNICO scroll owner
                      │    └─ <Routes> → pagina ativa
                      └─ IaChatPanel (h-full shrink-0 border-l)     ← width animation w-[380px]/w-0
```

**Atalho global:** `Cmd+J` / `Ctrl+J` → toggle painel IA

### 7.3 Navegacao (AppSidebar)

**Grupo principal:**
- Dashboard (`/`)
- Setores (`/setores`)
- Colaboradores (`/colaboradores`)
- Escalas (`/escalas`)

**Grupo configuracao:**
- Tipos de Contrato (`/tipos-contrato`)
- Feriados (`/feriados`)
- Regras (`/regras`)

**Footer dropdown (menu do usuario):**
- Dados da Empresa (`/empresa`)
- Configuracoes (`/configuracoes`) — inclui config IA
- Sub-menu de tema (Claro / Escuro / Sistema)
- Resetar tour
- Sobre (versao do app)

### 7.4 Jornadas criticas do usuario

#### Jornada 1: Primeira configuracao
```
1. Abrir app → Dashboard vazio → Tour guiado inicia automaticamente
2. Empresa → Preencher nome, CNPJ, horarios de funcionamento
3. Setores → Criar setores (Caixa, Acougue, Hortifruti...)
4. Colaboradores → Cadastrar funcionarios (nome, setor, contrato)
5. Setores/:id → Configurar demanda (quantas pessoas por faixa)
6. Configuracoes → Configurar IA (API key, modelo)
```

#### Jornada 2: Gerar escala mensal
```
1. Setores → Clicar no setor desejado
2. SetorDetalhe → Ver resumo (colabs, demandas, ultima escala)
3. SetorDetalhe → Clicar "Gerar Escala" ou ir pra EscalaPagina
4. EscalaPagina → Selecionar periodo (data inicio/fim)
5. SolverConfigDrawer → Configurar estrategia e regras (opcional)
6. EscalaPagina → Clicar "Gerar" → motor Python roda
7. EscalaPagina → Ver grid de alocacoes + indicadores
8. EscalaPagina → Ajustar manualmente se necessario (drag/click)
9. EscalaPagina → Oficializar (se violacoes_hard = 0)
10. ExportModal → Exportar HTML/PDF
```

#### Jornada 3: Ajustar escala existente
```
1. EscalasHub → Ver todas as escalas do sistema
2. Clicar na escala desejada → EscalaPagina
3. Ver indicadores (pontuacao, cobertura, violacoes)
4. Clicar em celula do grid → mudar status (TRABALHO/FOLGA)
5. Timeline → ajustar horarios de inicio/fim/almoco
6. Regenerar se necessario (mantendo pins)
```

#### Jornada 4: Usar IA para ajuda
```
1. Cmd+J → Abre painel IA
2. Digitar pergunta natural ("quantas pessoas tem no caixa?")
3. IA chama get_context() automaticamente
4. IA responde com dados reais do banco
5. Se pedir acao ("gera escala do acougue pra marco")
   → IA chama preflight + gerar_escala
   → Mostra resultado com indicadores
```

#### Jornada 5: Funcionario entrou de ferias
```
1. Colaboradores → Clicar no colaborador
2. ColaboradorDetalhe → Aba "Excecoes"
3. Clicar "Nova Excecao" → tipo FERIAS
4. Informar data_inicio e data_fim
5. Salvar → excecao persiste no banco
6. Ao gerar proxima escala, solver respeita H5 (work[c,d,s]=0 no periodo)
7. Se escala do periodo ja existia como RASCUNHO:
   → Precisa regenerar (a excecao nao retroage em escalas ja geradas)
```

**Via IA:** "Coloca a Cleunice de ferias de 10 a 24 de marco" → IA chama `criar(excecoes, {colaborador_id, tipo:'FERIAS', data_inicio, data_fim})`. Se usuario nao deu nome exato, IA consulta primeiro (`consultar(colaboradores, {nome: 'Cleunice'})`).

#### Jornada 6: Entender por que a escala deu errado (sem IA)
```
1. EscalaPagina → Gerar escala → Resultado com violacoes
2. Clicar na aba "Violacoes" (ViolacoesAgrupadas)
3. Ver lista agrupada por tipo:
   - HARD (vermelho): regras CLT violadas — IMPEDE oficializacao
   - SOFT (amarelo): preferencias nao atendidas — indicativo, nao bloqueia
   - ANTIPATTERN (cinza): boas praticas
4. Se solver retornou INFEASIBLE:
   → Modal de erro com diagnostico (regras_ativas, num_colabs, num_dias)
   → Acao: relaxar regras no SolverConfigDrawer (H1→SOFT) ou adicionar colabs
5. Se oficializacao bloqueada (violacoes_hard > 0):
   → Ajustar manualmente (grid + timeline) → regenerar parcial
```

**Via IA:** "Por que a escala do caixa deu erro?" → IA chama `consultar(escalas, {setor_id, status:'RASCUNHO'})` → ve diagnostico → chama `explicar_violacao(codigo)` para cada violacao → responde em linguagem natural.

#### 7.4.1 — As 10 acoes mais comuns do gestor de RH e como a IA deveria resolver

| # | Acao do gestor | Frequencia | Como a IA resolve HOJE | Como DEVERIA resolver |
|---|---------------|------------|------------------------|----------------------|
| 1 | Gerar escala do mes | Mensal | `preflight` + `gerar_escala` | OK — funciona completo |
| 2 | Cadastrar funcionario novo | Eventual | `criar(colaboradores, {...})` | OK — defaults inteligentes |
| 3 | Consultar quem trabalha tal dia | Diaria | `consultar(alocacoes, {data, escala_id})` | OK — enrichment com nomes |
| 4 | Colocar funcionario de ferias | Mensal | `criar(excecoes, {tipo:'FERIAS', ...})` | OK — mas nao avisa sobre escalas existentes |
| 5 | Ajustar horario de alguem | Semanal | ❌ Nao consegue | Precisa tool `ajustar_horario` (P0) |
| 6 | Definir regra individual ("so de manha") | Eventual | ❌ Nao consegue | Precisa tool `regra_colaborador` (P0) |
| 7 | Oficializar escala | Mensal | `oficializar_escala` | OK — valida violacoes_hard=0 |
| 8 | Ver resumo de horas do setor | Semanal | `get_context` (parcial) | Precisa `dashboard` com KPIs calculados |
| 9 | Entender por que deu INFEASIBLE | Quando ocorre | `explicar_violacao` + diagnostico | OK — mas poderia sugerir fix automaticamente |
| 10 | Importar lista de funcionarios | Na implantacao | `cadastrar_lote` | OK — batch ate 200, mesmos defaults |

### 7.5 Componentes criticos

#### Componentes de escala
| Componente | Arquivo | Proposito |
|-----------|---------|-----------|
| EscalaGrid | EscalaGrid.tsx (18KB) | Grid visual de alocacoes (dias x colaboradores) |
| TimelineGrid | TimelineGrid.tsx (26KB) | Timeline de horarios por dia com drag |
| SolverConfigDrawer | SolverConfigDrawer.tsx (11KB) | Config de geracao (estrategia, regras) |
| SetorEscalaSection | SetorEscalaSection.tsx (18KB) | Secao de escala dentro do SetorDetalhe |
| ExportarEscala | ExportarEscala.tsx (26KB) | Gerador de HTML/PDF de escala |
| ExportModal | ExportModal.tsx (13KB) | Modal de preview e export |
| ViolacoesAgrupadas | ViolacoesAgrupadas.tsx (6KB) | Lista agrupada de violacoes |

#### Componentes de demanda
| Componente | Arquivo | Proposito |
|-----------|---------|-----------|
| DemandaEditor | DemandaEditor.tsx (46KB) | Editor visual de demanda (timeline drag) |
| DemandaBar | DemandaBar.tsx (14KB) | Barra de demanda individual |
| DemandaTimelineSingleLane | DemandaTimelineSingleLane.tsx (15KB) | Lane unica de timeline |

#### Componentes IA (10)
| Componente | Arquivo | Proposito |
|-----------|---------|-----------|
| IaChatPanel | IaChatPanel.tsx (1KB) | Router entre chat e historico |
| IaChatHeader | IaChatHeader.tsx (2KB) | Header do painel (titulo, botoes) |
| IaChatView | IaChatView.tsx (8KB) | View de mensagens com scroll |
| IaChatInput | IaChatInput.tsx (2KB) | Input de mensagem |
| IaMensagemBubble | IaMensagemBubble.tsx (1KB) | Bolha individual de mensagem |
| IaToolCallsCollapsible | IaToolCallsCollapsible.tsx (8KB) | Expansivel de tool calls |
| IaHistoricoView | IaHistoricoView.tsx (3KB) | Lista de conversas salvas |
| IaConversaItem | IaConversaItem.tsx (7KB) | Item individual de conversa |
| IaSecaoConversas | IaSecaoConversas.tsx (4KB) | Secao agrupada (ativas/arquivadas) |
| IaModelCatalogPicker | IaModelCatalogPicker.tsx (9KB) | Picker de modelo com catalogo live |

### 7.6 Store da IA (Zustand)

O `iaStore.ts` (217 linhas) gerencia todo o estado do painel IA:

**Estado:**
- `aberto` / `tela` ('chat' | 'historico')
- `conversa_ativa_id` / `conversa_ativa_titulo`
- `mensagens: IaMensagem[]`
- `carregando: boolean`
- `conversas: IaConversa[]` / `busca_titulo`

**Acoes (12):**
- `inicializar()` — carrega conversas ativas, restaura mais recente
- `novaConversa()` — limpa vazia silenciosamente, cria nova
- `carregarConversa(id)` — carrega conversa + mensagens do DB
- `adicionarMensagem(msg, options?)` — auto-titulo na 1a msg usuario
- `listarConversas()` — busca ativas + arquivadas
- `arquivarConversa(id)` — arquiva, cria nova se era a ativa
- `restaurarConversa(id)` — restaura da lixeira
- `deletarConversa(id)` — deleta permanente
- `renomearConversa(id, titulo)` — renomeia
- `arquivarTodas()` — limpa tudo
- `deletarArquivadas()` — purge definitivo

**Comportamentos inteligentes:**
- Limpa conversa vazia silenciosamente ao criar nova ou trocar
- Auto-titulo na primeira mensagem do usuario (trunca em 50 chars)
- `options.mensagemPersistida` permite mostrar dados ricos em memoria mas salvar versao compacta no DB

### 7.7 Services IPC (camada renderer)

| Service | Arquivo | Handlers que chama |
|---------|---------|-------------------|
| client.ts | Instancia unica do tipc client | Base pra todos os outros |
| colaboradores.ts | CRUD + regras horario + excecoes por data | 12+ handlers |
| dashboard.ts | dashboardResumo | 1 handler |
| empresa.ts | buscar + atualizar + horarios.listar/atualizar | 4 handlers |
| escalas.ts | CRUD + gerar + preflight + duplicar + timeline | 12+ handlers |
| excecoes.ts | CRUD | 3 handlers |
| exportar.ts | HTML setorMes + funcionarioMes | 4 handlers |
| feriados.ts | CRUD | 3 handlers |
| funcoes.ts | CRUD | 5 handlers |
| regras.ts | listar + atualizar + resetar | 3 handlers |
| setores.ts | CRUD + demandas + demandaExcecao + ciclo | 12+ handlers |
| tipos-contrato.ts | CRUD + perfis horario | 9 handlers |

### 7.8 Hooks custom

| Hook | Arquivo | Proposito |
|------|---------|-----------|
| useApiData | useApiData.ts | Fetch generico com loading/error/data |
| useColorTheme | useColorTheme.ts | Gerencia tema claro/escuro/sistema |
| useDemandaResize | useDemandaResize.ts | Drag resize de barras de demanda |
| useExportController | useExportController.ts | Logica de export com preview |
| useSetorSelection | useSetorSelection.ts | Selecao de setor com state |
| use-mobile | use-mobile.tsx | Detecta viewport mobile |

### 7.9 Onde a IA poderia ajudar mais (gaps UX)

| Jornada | Ponto de friccao | Como a IA poderia resolver |
|---------|-----------------|---------------------------|
| Primeira configuracao | Cadastrar muitos colaboradores | `cadastrar_lote` ja existe, mas usuario precisa saber que pode colar CSV |
| Gerar escala | Escolher periodo correto | IA poderia inferir "mes que vem" = proximo mes completo |
| Ajustar escala | Entender violacoes | `explicar_violacao` existe, mas nao e proativo |
| Regras | Entender impacto de mudar regra | IA poderia simular: "se mudar H1 pra SOFT, a escala ficaria assim" |
| Demanda | Configurar faixas horarias | Sem tool — IA so pode orientar |
| Colaborador | Configurar regras individuais | Sem tool — IA so pode orientar |
| Export | Gerar PDF | Sem tool — acesso a filesystem |

---

## 8. Gap Analysis e Recomendacoes (Fase 7)

### 8.1 Mapa de capacidades — IA vs Sistema

```
                     ┌─────────────────────────────────────────────┐
                     │            CAPACIDADES DO SISTEMA           │
                     │                 (89 IPC handlers)           │
                     │                                             │
                     │  ┌─────────────────────────────────┐       │
                     │  │    CAPACIDADES DA IA             │       │
                     │  │      (13 tools)                  │       │
                     │  │                                  │       │
                     │  │  ✅ Consultar qualquer entidade  │       │
                     │  │  ✅ Criar colabs/excecoes/etc    │       │
                     │  │  ✅ Gerar escalas (motor Python) │       │
                     │  │  ✅ Ajustar alocacoes            │       │
                     │  │  ✅ Oficializar escalas          │       │
                     │  │  ✅ Editar regras do motor       │       │
                     │  │  ✅ Preflight (simplificado)     │       │
                     │  │  ✅ Importacao em lote (CSV)     │       │
                     │  │  ✅ Explicar violacoes           │       │
                     │  └─────────────────────────────────┘       │
                     │                                             │
                     │  ❌ Regras horario por colaborador          │
                     │  ❌ Excecoes horario por data               │
                     │  ❌ Perfis horario por contrato             │
                     │  ❌ Demanda excecao por data                │
                     │  ❌ Ciclo rotativo                          │
                     │  ❌ Timeline (ajustar hora_inicio/fim)      │
                     │  ❌ Export HTML/PDF                         │
                     │  ❌ Duplicar escala                         │
                     │  ❌ Dashboard metricas                      │
                     │  ❌ Backup/Restore                          │
                     │  ❌ Config IA (provider/modelo)             │
                     └─────────────────────────────────────────────┘
```

### 8.2 Tools prioritarias para criar

Ordenadas por IMPACTO NO USUARIO (frequencia de uso x friccao):

| Prioridade | Tool proposta | IPC handlers ja existentes | Impacto |
|------------|--------------|---------------------------|---------|
| **P0** | `ajustar_horario` | `salvarTimelineDia` | IA poderia dizer "Cleunice comeca 8h amanha" e ajustar hora_inicio/hora_fim |
| **P0** | `regra_colaborador` | 5 handlers regrasColab.* | IA poderia dizer "Cleunice so pode vir de manha" e criar regra |
| **P1** | `excecao_horario_data` | 2 handlers | "Segunda que vem Cleunice entra as 10h" — excecao pontual |
| **P1** | `duplicar_escala` | escalas.duplicar | "Copia a escala do caixa pra abril" |
| **P2** | `demanda_excecao_data` | 3 handlers | "Dia 15/03 preciso de 8 pessoas no caixa" |
| **P2** | `preflight_completo` | buildEscalaPreflight + enrichCapacity | Versao completa com analise de capacidade |
| **P3** | `ciclo_rotativo` | 4 handlers | "Configura ciclo domingo 2x1 pro acougue" |
| **P3** | `dashboard` | dashboardResumo | IA poderia resumir KPIs sem o usuario navegar |

### 8.3 Melhorias no system prompt

| # | Problema atual | Melhoria proposta |
|---|---------------|-------------------|
| 1 | Prompt tem 423 linhas — muito longo, muita repeticao | Comprimir exemplos redundantes. Manter regras + schema + tool guide |
| 2 | Secao 7 (schema) lista campos mas nao mostra relacoes | Adicionar mini-ERD textual mostrando FKs (setor_id → setores.id) |
| 3 | Workflow CSV duplicado (secao 6 tool guide + secao 7 workflow) | Unificar em um lugar so |
| 4 | `resumo_sistema` ainda listada apesar de DEPRECATED | Remover da lista de tools e do prompt |
| 5 | Nao documenta `rules_override` no `gerar_escala` | Adicionar exemplo: `{"H1": "SOFT"}` e quando usar |
| 6 | Dicionario de violacoes incompleto no prompt (vs 20+ no tools.ts) | Mover dicionario completo pro prompt ou criar link |
| 7 | Prompt nao menciona o que a IA NAO pode fazer | Adicionar secao "Limitacoes" — evita expectativas falsas |
| 8 | Persona "Miss Monday" so no tom — falta calibracao | Reduzir excesso de emoji no prompt, manter tom direto |

### 8.4 Melhorias nas tools existentes

| Tool | Problema | Melhoria |
|------|----------|---------|
| `preflight` | Versao simplificada — falta capacity check | Integrar `enrichPreflightWithCapacityChecks()` |
| `consultar` | Limit 50 rows fixo, sem paginacao | Adicionar offset/limit como parametros opcionais |
| `ajustar_alocacao` | So muda status, nao muda horario | Adicionar campos opcionais `hora_inicio`, `hora_fim` |
| `get_context` | Nao inclui feriados do periodo nem regras customizadas | Adicionar `feriados_proximos` e `regras_customizadas` |
| `criar` | Defaults de data_nascimento aleatorios | Permitir omitir campo completamente — nem todo colab precisa |
| `gerar_escala` | Timeout fixo 60s | Tornar configuravel ou aumentar pra escalas grandes |
| `cadastrar_lote` | Sem validacao de duplicatas por nome | Adicionar check `nome COLLATE NOCASE` antes de INSERT |

### 8.5 Melhorias de arquitetura

| # | Area | Estado atual | Proposta |
|---|------|-------------|---------|
| 1 | Streaming | `generateText()` (resposta completa) | Migrar pra `streamText()` — feedback progressivo |
| 2 | Historico | So texto user/assistant no historico | Enviar tool calls como mensagens de tipo `tool` pro LLM lembrar |
| 3 | Contexto | Auto-contexto rebuilda a cada mensagem | Cachear com TTL (dados nao mudam a cada 5s) |
| 4 | Multi-turn | Max 10 steps, sem controle de custo | Adicionar token counting e budget limit |
| 5 | Error recovery | IA tenta corrigir, mas sem retry estruturado | Adicionar retry com backoff pra erros transientes |
| 6 | Observability | console.log basico | Estruturar logs pra debugging (tempo por tool, tokens usados) |

### 8.6 Resumo executivo

**O que esta BOM:**
- 13 tools cobrem o core: discovery, CRUD, geracao de escala, regras, batch import
- Validacao Zod runtime em TODAS as tools
- Seguranca: whitelists por operacao, campos validados, limit de rows
- Auto-contexto por pagina (gratuito, sem tool call)
- Multi-provider (Gemini + OpenRouter) com mesma logica
- Persistencia de conversas com SQLite

**O que FALTA para a IA ser realmente autonoma:**
- 11 categorias de operacao que so a UI faz (regras colab, timeline, export, ciclo...)
- Preflight incompleto (falta capacity check)
- Sem streaming (resposta demora e usuario nao ve progresso)
- Sem ajuste de horario (so status TRABALHO/FOLGA)
- Prompt longo e repetitivo (pode confundir modelos menores)

**O que e RISCO:**
- `criar` e `cadastrar_lote` fazem INSERT direto com dados que vem do LLM — qualquer alucinacao do modelo vira dado no banco
- Sem rollback: se `cadastrar_lote` falha no registro 150/200, os 149 anteriores ja estao no banco
- `ajustar_alocacao` nao revalida constraints apos mudanca
- `oficializar_escala` verifica violacoes_hard do momento da geracao, nao revalida em tempo real

### 8.7 Decisoes de design documentadas

Para cada decisao nao-obvia: o que, por que, e se ainda faz sentido.

| # | Decisao | Por que | Ainda faz sentido? |
|---|---------|---------|-------------------|
| 1 | **Grid 15 minutos** (era 30min) | CLT Art. 71 §1 exige intervalo de 15min para jornadas 4-6h. Grid 30min nao representava isso. Constante unica `CLT.GRID_MINUTOS` em `constants.ts`. | Sim. Precisao necessaria. Trade-off: mais variaveis no solver (2x), mas tempo de solve permanece < 30s para setores tipicos. |
| 2 | **H3 (domingo) → SOFT** | H3 como HARD causava INFEASIBLE em setores com poucos colabs. Rodizio de domingo e desejavel mas nao bloqueante. Substituido por `add_domingo_ciclo_soft` + `add_h3_rodizio_domingo` separados por sexo (mulher: max 1 consec, homem: max 2 — CLT Art. 386). | Sim. Funciona melhor como penalidade. |
| 3 | **Deficit como SOFT, nao HARD** | Com 6 pessoas e constraints CLT, 100% cobertura e matematicamente impossivel. Rita (30+ anos) atinge ~85%. Deficit HARD = INFEASIBLE garantido. Peso 10.000 forca o solver a minimizar gaps sem tornar impossivel. (`constraints.py:387`) | Sim. Decisao fundamental. |
| 4 | **Feriados orientados por demanda** | So 25/12 e 01/01 sao proibidos por CCT. Outros feriados: trabalho permitido se houver demanda. Portaria MTE 3.665 (apos 01/03/2026) pode mudar isso. Flag `proibido_trabalhar` por feriado. | Sim, mas precisa revisao quando Portaria entrar em vigor. |
| 5 | **Motor Python, nao TypeScript** | OR-Tools CP-SAT e ordens de magnitude mais eficiente que backtracking JS. Motor TS legado (`gerador.ts`) deletado. Trade-off: bridge via child_process stdin/stdout JSON adiciona ~200ms de overhead, mas solver roda em < 30s vs minutos no TS. | Sim. Insubstituivel. |
| 6 | **snake_case ponta a ponta** | DB columns = IPC keys = TS interfaces = React props. Zero adaptadores. Reduz bugs de mapeamento em sistema com 80+ handlers. Convencao incomum em TS mas necessaria para produto com time de 1 pessoa. | Sim. Consistencia > convencao do ecossistema. |
| 7 | **Compensacao 9h45** | CLT 44h = 7h20/dia em 6 dias. Mas supermercados usam jornada 8h48 (5 dias) ou 9h45 (5 dias com sabado alternado). `max_minutos_dia` vem do contrato, nao de calculo fixo. So CLT 44h e 36h — nunca estagiario/aprendiz. | Sim. Reflete pratica real. |
| 8 | **H19 (folga comp domingo) como NOOP** | Matematicamente redundante quando H1 esta ativa: max 6 dias consecutivos ja garante 1 folga em qualquer janela de 7 dias. Emitir causava conflitos INFEASIBLE com dias_trabalho + H10. Interface preservada para compatibilidade. (`constraints.py:643-650`) | Sim. Manter NOOP. |
| 9 | **Surplus penalty (peso 5.000)** | Sem surplus, solver empilha colabs em slots ja cobertos (surplus=3) enquanto outros ficam com deficit=2. Deficit sozinho nao distingue ONDE colocar capacidade. Surplus torna excesso CARO, forcando redistribuicao. Math: mover 1 pessoa de surplus pra deficit economiza 15.000 (10k+5k). (`constraints.py:877-912`) | Sim. Sem isso, escalas ficam desequilibradas. |
| 10 | **Vercel AI SDK (nao SDK nativo do Gemini/OpenRouter)** | Abstrai providers (Gemini + OpenRouter) com mesma interface. `generateText()` com `stopWhen: stepCountIs(10)` resolve multi-turn tool calling. Trade-off: depende de lib terceira, mas evita reimplementar loop de tools. | Sim. Flexibilidade de trocar provider sem mudar logica. |
| 11 | **Auto-contexto (discovery) a cada mensagem** | Injeta setores, colabs, escalas no system prompt sem tool call. Custo: ~200-500 tokens extras. Beneficio: IA responde perguntas simples sem chamar get_context. Discovery condicional por pagina reduz tamanho. | Sim, mas pode cachear com TTL de 30s. |
| 12 | **Historico sem tool calls** | `buildChatMessages()` so envia role user/assistant. Tool calls e results NAO vao no historico. Motivo: modelos menores confundem tool results com instrucoes. Trade-off: IA "esquece" o que fez em turnos anteriores da mesma conversa. | Precisa melhorar. Enviar pelo menos nomes das tools usadas. |

---

## Apendice A: Mapa completo de IPC handlers

> Incluido na secao 5.1 (80+ handlers mapeados por dominio com input/output)

## Apendice B: Catalogo de regras (35)

> Incluido na secao 2.9

## Apendice C: Inventario de tools IA (13 tools)

### C.1 Tools de Discovery (3)

| Tool | Parametros | Entidades | Resultado | Notas |
|------|-----------|-----------|-----------|-------|
| `get_context` | nenhum | setores, colaboradores, tipos_contrato, escalas | JSON estruturado com JOINs, counts, IDs | SEMPRE primeira. Stats + listas completas |
| `consultar` | entidade, filtros? | 12 entidades (todas) | rows[] com enrichment de nomes | Limit 50 rows. Filtros case-insensitive |
| `resumo_sistema` | nenhum | setores, colaboradores, escalas, regra_empresa | Contadores simples | DEPRECATED — use get_context |

### C.2 Tools de Acao (7)

| Tool | Parametros obrigatorios | Validacoes | Efeito no banco | Retorno |
|------|------------------------|------------|-----------------|---------|
| `criar` | entidade, dados | Whitelist 7 entidades, campos obrigatorios por entidade, FK check | INSERT | id criado |
| `atualizar` | entidade, id, dados | Whitelist 5 entidades | UPDATE parcial | changes count |
| `deletar` | entidade, id | Whitelist 4 entidades | DELETE | changes count |
| `editar_regra` | codigo, status | editavel=1, status in HARD/SOFT/OFF/ON | INSERT OR REPLACE regra_empresa | codigo + novo_status |
| `gerar_escala` | setor_id, data_inicio, data_fim | Solver INFEASIBLE = erro | INSERT escala + alocacoes | escala_id, indicadores, diagnostico |
| `ajustar_alocacao` | escala_id, colaborador_id, data, status | Existencia da alocacao | UPDATE alocacoes.status | novo_status |
| `oficializar_escala` | escala_id | violacoes_hard = 0 | UPDATE escalas.status='OFICIAL' | sucesso |

### C.3 Tools de Validacao e Referencia (3)

| Tool | Parametros | O que retorna | Efeito |
|------|-----------|---------------|--------|
| `preflight` | setor_id, data_inicio, data_fim | blockers[], warnings[], diagnostico | Nenhum (read-only) |
| `explicar_violacao` | codigo_regra | explicacao textual | Nenhum (read-only) |
| `cadastrar_lote` | entidade, registros[] (max 200) | total_criado, total_erros, ids_criados, erros[] | INSERT em batch |

### C.4 Schemas Zod completos

```typescript
// ConsultarSchema
{ entidade: enum(12 tabelas), filtros?: Record<string, any> }

// CriarSchema
{ entidade: enum(7 tabelas), dados: Record<string, any> }

// CriarColaboradorSchema (validacao interna, nao exposto como tool separada)
{ nome: string, setor_id: number, tipo_contrato_id?: number,
  sexo?: 'M'|'F', data_nascimento?: 'YYYY-MM-DD',
  tipo_trabalhador?: string, hora_inicio_min?: 'HH:MM',
  hora_fim_max?: 'HH:MM', ativo?: 0|1 }

// CriarExcecaoSchema (validacao interna)
{ colaborador_id: number, tipo: 'FERIAS'|'ATESTADO'|'BLOQUEIO',
  data_inicio: 'YYYY-MM-DD', data_fim: 'YYYY-MM-DD',
  motivo?: string, observacao?: string }

// AtualizarSchema
{ entidade: enum(5 tabelas), id: number, dados: Record<string, any> }

// DeletarSchema
{ entidade: enum(4 tabelas), id: number }

// EditarRegraSchema
{ codigo: string, status: 'HARD'|'SOFT'|'OFF'|'ON' }

// GerarEscalaSchema
{ setor_id: number, data_inicio: 'YYYY-MM-DD', data_fim: 'YYYY-MM-DD',
  rules_override?: Record<string, string> }

// AjustarAlocacaoSchema
{ escala_id: number, colaborador_id: number,
  data: 'YYYY-MM-DD', status: 'TRABALHO'|'FOLGA'|'INDISPONIVEL' }

// OficializarEscalaSchema
{ escala_id: number }

// PreflightSchema
{ setor_id: number, data_inicio: 'YYYY-MM-DD', data_fim: 'YYYY-MM-DD' }

// ExplicarViolacaoSchema
{ codigo_regra: string }

// CadastrarLoteSchema
{ entidade: enum(7 tabelas), registros: Record<string, any>[] (1-200) }
```
