# Como o EscalaFlow Funciona — Doc Canonico para Evolucao da IA

> **Proposito:** Mapeamento completo do sistema para reescrita do system prompt, gap analysis de tools, e evolucao da IA.
>
> **Gerado em:** 2026-02-22 | **Atualizado em:** 2026-03-12 | **Metodo:** Deep dive iterativo por fases, leitura de codigo real.

---

## 1. Visao Geral

**EscalaFlow** e um app desktop offline (Electron 34) para geracao automatica de escalas de trabalho em supermercados. Desenvolvido para o RH do Supermercado Fernandes — usuarios nao tecnicos.

**Principio #1:** O SISTEMA propoe, nao o RH monta na mao. Menor input possivel para gerar escalas para todos os setores.

### Stack

| Camada | Tecnologia |
|--------|-----------|
| Shell | Electron 34 |
| IPC | @egoist/tipc (~116 handlers) |
| Database | PGlite (Postgres 17 WASM, pgvector, FTS portugues, pg_trgm) |
| Motor | Python OR-Tools CP-SAT (via child_process stdin/stdout JSON) — multi-pass graceful degradation |
| Frontend | React 19 + Vite + Tailwind + shadcn/ui + Zustand + recharts |
| IA | Gemini/OpenRouter via Vercel AI SDK v6 (`streamText`) + IA Local via node-llama-cpp (Qwen 3.5) — 34 tools |
| Knowledge | RAG local: embeddings ONNX (multilingual-e5-small) + pgvector + Knowledge Graph |

### Fluxo macro

```
Usuario (React) → IPC (tipc.ts) → Main Process (Node.js)
                                    ├── Database (PGlite — Postgres WASM)
                                    ├── Motor Python (solver-bridge.ts → spawn solver)
                                    └── IA (cliente.ts → Gemini/OpenRouter/Local)
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
| **TipoContrato** | `tipos_contrato` | `nome`, `horas_semanais`, `regime_escala`, `dias_trabalho`, `max_minutos_dia` | 4 templates imutaveis (seed): CLT 44h, CLT 36h, Estagiario, Intermitente. Define as restricoes legais de cada tipo de trabalhador. `trabalha_domingo` foi removido — domingo e gerenciado por ciclo rotativo e regras por colaborador. |
| **Setor** | `setores` | `nome`, `icone`, `hora_abertura`, `hora_fechamento`, `ativo` | Departamento do supermercado (Acougue, Padaria, Caixa...). `hora_abertura/fechamento` sao defaults — podem ser overridden por `setor_horario_semana`. Soft delete via `ativo`. |
| **Colaborador** | `colaboradores` | `setor_id`, `tipo_contrato_id`, `nome`, `sexo`, `horas_semanais`, `rank`, `prefere_turno`, `evitar_dia_semana`, `tipo_trabalhador`, `funcao_id`, `ativo` | FK setor + contrato. `tipo_trabalhador` (CLT/ESTAGIARIO/APRENDIZ) determina restricoes especiais. `rank` define senioridade (0=junior). `funcao_id` e apenas o vínculo atual do titular com um posto; `null` = reserva operacional. Soft delete. |
| **Funcao** | `funcoes` | `setor_id`, `apelido`, `tipo_contrato_id`, `cor_hex`, `ativo`, `ordem` | Posto de trabalho dentro do setor (Caixa 1, Repositor...). Existe independentemente de pessoa. Se nao ha titular anexado, o posto fica na **reserva de postos**. FK `tipo_contrato_id` define qual contrato esse posto exige. |
| **Demanda** | `demandas` | `setor_id`, `dia_semana`, `hora_inicio`, `hora_fim`, `min_pessoas`, `override` | "Quantas pessoas preciso nesse slot". Segmentada por dia da semana e faixa horaria. `override=1` significa que o gestor forcou esse valor (nao e sugestao do sistema). |
| **Excecao** | `excecoes` | `colaborador_id`, `data_inicio`, `data_fim`, `tipo`, `observacao` | Ferias, atestado ou bloqueio. Periodo em que o colaborador esta INDISPONIVEL. Motor respeita como HARD constraint (H5). |

#### Camada 2 — Horarios Granulares (v4/v5)

| Entidade | Tabela | Campos criticos | Notas |
|----------|--------|-----------------|-------|
| **EmpresaHorarioSemana** | `empresa_horario_semana` | `dia_semana`, `ativo`, `hora_abertura`, `hora_fechamento` | Horario de funcionamento da empresa por dia da semana. Fallback global quando setor nao tem horario proprio. UNIQUE(dia_semana). Seed: SEG-SEX 08-22, SAB 08-20, DOM 08-14. |
| **SetorHorarioSemana** | `setor_horario_semana` | `setor_id`, `dia_semana`, `ativo`, `usa_padrao`, `hora_abertura`, `hora_fechamento` | Override do horario da empresa para um setor especifico. `usa_padrao=1` herda da empresa. UNIQUE(setor_id, dia_semana). |
| **PerfilHorarioContrato** | `contrato_perfis_horario` | `tipo_contrato_id`, `nome`, `inicio`, `fim`, `preferencia_turno_soft` | Horario de entrada/saida por tipo de contrato. Seed: 3 perfis de estagiario (Manha 08-12, Tarde 13:30-20, Noite-Estudo 08-14). CLT nao tem perfil (usa janela do setor). |
| **RegraHorarioColaborador** | `colaborador_regra_horario` | `colaborador_id` (UNIQUE), `perfil_horario_id`, `inicio`, `fim`, `domingo_ciclo_trabalho/folga`, `folga_fixa_dia_semana`, `folga_variavel_dia_semana` | Regra individual 1:1. Override dos campos do perfil. Ciclo domingo default: 2 trabalho / 1 folga. Folga fixa = dia que SEMPRE folga. Folga variavel = segundo dia de folga (SEG-SAB). **Fonte de verdade persistida: regra do colaborador.** Na UI da Equipe, Fixo/Variavel podem aparecer tambem por fallback inferido da escala OFICIAL quando a regra ainda nao foi salva. Ao oficializar, colaboradores sem F/V definido tem esses valores inferidos a partir da escala e gravados automaticamente. |
| **ExcecaoDataColaborador** | `colaborador_regra_horario_excecao_data` | `colaborador_id`, `data`, `inicio`, `fim`, `domingo_forcar_folga` | Override pontual por data. Ex: "dia 15/03, Cleunice so pode 08-12". Maior precedencia na hierarquia. UNIQUE(colaborador_id, data). |
| **DemandaExcecaoData** | `demandas_excecao_data` | `setor_id`, `data`, `hora_inicio`, `hora_fim`, `min_pessoas`, `override` | Override de demanda por data especifica (Black Friday, vespera de feriado). Substitui a demanda semanal padrao naquele dia. |

#### Camada 3 — Escala (output do motor)

| Entidade | Tabela | Campos criticos | Notas |
|----------|--------|-----------------|-------|
| **Escala** | `escalas` | `setor_id`, `data_inicio`, `data_fim`, `status`, `pontuacao`, `cobertura_percent`, `violacoes_hard`, `violacoes_soft`, `equilibrio`, `input_hash`, `simulacao_config_json`, `equipe_snapshot_json` | **Lifecycle: RASCUNHO → OFICIAL → ARQUIVADA.** So oficializa se `violacoes_hard = 0`. `input_hash` detecta se os dados mudaram desde a ultima geracao. `simulacao_config_json` guarda a config do solver usada. `equipe_snapshot_json` preserva o contexto historico de postos + titulares usado pela UI/export mesmo se o cadastro atual mudar depois. |
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

**Funcao / Posto (cadastro atual):**
```
posto existe com ou sem titular
sem titular = reserva de postos
deletar posto = hard delete no cadastro atual
historico = preservado por equipe_snapshot_json nas escalas
```

### 2.4 Contratos CLT — Templates e Restricoes

| ID | Nome | Horas/sem | Regime | Dias | Max/dia | Compensacao 9h45 | Restricoes especiais |
|----|------|-----------|--------|------|---------|------------------|---------------------|
| 1 | CLT 44h | 44 | 5X2 | 5 | 585min | Sim | Nenhuma |
| 2 | CLT 36h | 36 | 5X2 | 5 | 585min | Sim | Nenhuma |
| 3 | Estagiario | 20-30 | 5X2 | 5 | 360min | Nao | Max 6h/dia, nunca hora extra, nunca domingo (H11) |
| 4 | Intermitente | 0+ | 5X2 | 5 | 585min | Nao | horas_semanais.min(0) — convocado sob demanda |

**Nota sobre compensacao:** CLT 44h/36h em regime 5X2 podem fazer ate 9h45/dia para compensar o sabado sem trabalho. Estagiarios e Intermitentes NUNCA fazem compensacao.

**Nota sobre Aprendiz:** Existe como `tipo_trabalhador` (APRENDIZ) mas nao tem contrato seed dedicado. Restricoes: NUNCA domingo, NUNCA feriado, NUNCA noturno (22h-5h), NUNCA hora extra.

**Nota sobre domingo:** `trabalha_domingo` foi removido dos contratos. Domingo e gerenciado por `colaborador_regra_horario.domingo_ciclo_trabalho/folga` (ciclo rotativo) e regras SOFT (H3 rodizio). Estagiarios/Aprendizes nunca trabalham domingo via constraints HARD (H11).

### 2.5 Perfis de Horario (Seed)

| Contrato | Perfil | Entrada | Saida | Turno |
|----------|--------|---------|-------|-------|
| Estagiario Manha | MANHA_08_12 | Início: 08:00 | Fim: 12:00 | MANHA |
| Estagiario Tarde | TARDE_1330_PLUS | Início: 13:30 | Fim: 20:00 | TARDE |
| Estagiario Noite-Estudo | ESTUDA_NOITE_08_14 | Início: 08:00 | Fim: 14:00 | MANHA |

CLT 44h e 36h **nao tem perfis seed** — usam a janela do setor inteira.

### 2.6 Grid de 15 Minutos

- **Fonte unica:** `CLT.GRID_MINUTOS = 15` em `constants.ts`, replicado em `empresa.grid_minutos`
- **O que significa:** Toda alocacao, demanda, horario — tudo e quantizado em blocos de 15 minutos
- **Impacto:** Um colaborador nao pode comecar as 08:07. Tem que ser 08:00 ou 08:15
- **Historico:** Era 30min, migrado pra 15min (migration no schema.ts forca `UPDATE empresa SET grid_minutos = 15 WHERE grid_minutos = 30`)
- **Onde afeta:** Timeline de demanda (snap), alocacoes do solver, bridge (buildSolverInput), validador, export

### 2.7 Soft Delete

Entidades com soft delete (`ativo` = 1 ou 0):
- `setores`, `colaboradores`, `contrato_perfis_horario`, `colaborador_regra_horario`, `colaborador_regra_horario_excecao_data`, `escala_ciclo_modelos`

**Regra:** NUNCA usar `DELETE FROM` nessas tabelas. Sempre `UPDATE SET ativo = 0`.

**Excecao importante:** `funcoes` nao entram mais nessa regra. O cadastro atual de postos pode sofrer hard delete; a memoria historica da equipe fica garantida por `escalas.equipe_snapshot_json`.

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

**Entidades que a IA MANIPULA (write) — 34 tools total:**
- `alocacoes` — via tools `ajustar_alocacao`, `ajustar_horario`
- `escalas` — via tools `gerar_escala`, `oficializar_escala`
- `regra_empresa` — via tools `editar_regra`, `resetar_regras_empresa`
- `colaboradores` — via tools genericas `criar`, `atualizar`, `cadastrar_lote`
- `excecoes` — via tools genericas `criar`, `deletar`
- `demandas` — via tools genericas `criar`, `atualizar`, `deletar`
- `funcoes` — via `salvar_posto_setor` (preferencial) e `deletar` para remover o posto do cadastro atual
- `feriados` — via tools genericas `criar`, `deletar`
- `setores` — via tools genericas `criar`, `atualizar`
- `colaborador_regra_horario` — via tool `salvar_regra_horario_colaborador`
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
7. Soft delete — `ativo=0`, nunca DELETE (exceto `funcoes`, cujo historico agora e preservado por snapshot)
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
  ├─ [4] Python solver_ortools.py: solve(data) — MULTI-PASS GRACEFUL DEGRADATION
  │     ├── _analyze_capacity(data) → analise pre-solve de capacidade vs demanda
  │     ├── parse_demand() → grid de demanda por (dia_idx, slot_idx)
  │     │
  │     ├── Pass 1 (Normal — 50% do tempo):
  │     │     ├── build_model() sem relaxations
  │     │     ├── Variaveis: work[c,d,s], works_day[c,d], block_starts[c,d,s]
  │     │     ├── Pinned cells → force work[c,d,s] = 0 ou 1
  │     │     ├── Warm-start hints → model.add_hint()
  │     │     ├── Blocked days (feriados proibidos, excecoes, aprendiz dom/feriado)
  │     │     ├── HARD constraints (H1-H19, DIAS_TRABALHO, MIN_DIARIO, janela, folga fixa)
  │     │     ├── SOFT penalties (deficit, surplus, domingo_ciclo, turno_pref, consistencia, spread, ap1_excess)
  │     │     └── model.minimize(sum(objective_terms))
  │     │     Se OPTIMAL/FEASIBLE → retorna
  │     │
  │     ├── Pass 2 (Relaxed Product Rules — 30% do tempo):
  │     │     ├── Relaxa: H10_ELASTIC, DIAS_TRABALHO, MIN_DIARIO, H6 → SOFT
  │     │     ├── H2, H4, H5, H11-H18 permanecem HARD (CLT inviolavel)
  │     │     └── Se resolver → retorna com diagnostico.pass_usado=2
  │     │
  │     ├── Pass 3 (Emergency CLT Skeleton — 20% do tempo):
  │     │     ├── Relaxa: ALL_PRODUCT_RULES (tudo que nao e CLT core)
  │     │     ├── Somente H2, H4, H5, H11-H18 ficam HARD
  │     │     ├── Remove janela colab e folga fixa (hard → skip)
  │     │     └── diagnostico.modo_emergencia=true
  │     │
  │     └── extract_solution() → alocacoes, indicadores, decisoes, comparacao, diagnostico
  │
  ├─ [5] solver-bridge.ts: persistirSolverResult(setor_id, datas, result, hash)
  │     └── Transacao PGlite:
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
| H10 (elastic) | `add_h10_meta_semanal_elastic` | `constraints.py:315` | Variante elastic: dominio [0, max_capacity] com slack variables. Peso 8000/min desvio. Usada em Pass 2/3 da degradacao graciosa. | Auto (via multi-pass) |
| H11 | `add_h11_aprendiz_domingo` | `constraints.py:493` | Aprendiz NUNCA domingo (Art. 432 CLT). | Nao (sempre HARD) |
| H12 | `add_h12_aprendiz_feriado` | `constraints.py:507` | Aprendiz NUNCA feriado. | Nao (sempre HARD) |
| H13 | `add_h13_aprendiz_noturno` | `constraints.py:521` | Aprendiz NUNCA slots >= 22h. Para janela 08-20h: zero clauses. | Nao (sempre HARD) |
| H14 | `add_h14_aprendiz_hora_extra` | `constraints.py:553` | Aprendiz: weekly_minutes <= target (zero tolerancia upper). | Nao (sempre HARD) |
| H15 | `add_h15_estagiario_jornada` | `constraints.py:572` | Estagiario: max 360min/dia, max 1800min/sem (Lei 11.788 Art. 10). | Nao (sempre HARD) |
| H16 | `add_h16_estagiario_hora_extra` | `constraints.py:596` | Estagiario: weekly_minutes <= target (zero tolerancia upper). | Nao (sempre HARD) |
| H17/H18 | `add_h17_h18_feriado_proibido` | `constraints.py:615` | 25/12 e 01/01: works_day[c,d] = 0 para todos (CCT). | Nao (sempre HARD) |
| H19 | `add_h19_folga_comp_domingo` | `constraints.py:632` | **NOOP no solver** — redundante com H1. **Validador TS:** checa folga compensatoria apos domingo trabalhado (Lei 605/1949). Fix v1.4: boundary guard — se domingo e o ultimo dia do periodo, pula check (folga pode estar fora do periodo gerado). | N/A (noop no solver, ativo no validador) |
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
> Na pratica, um RH experiente atinge ~85%. O solver faz o mesmo.
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
interface DiagnosticoSolver {
  status_cp_sat: 'OPTIMAL' | 'FEASIBLE' | 'INFEASIBLE' | 'UNKNOWN'
  solve_time_ms: number
  regras_ativas: string[]           // codigos com status HARD/SOFT/ON
  regras_off: string[]              // codigos com status OFF
  motivo_infeasible?: string        // so no path INFEASIBLE
  num_colaboradores: number
  num_dias: number
  // ↓ Graceful Degradation (multi-pass) ↓
  pass_usado?: 1 | 2 | 3           // qual pass resolveu (1=normal, 2=relaxed, 3=emergency)
  regras_relaxadas?: string[]       // quais regras foram relaxadas no pass bem-sucedido
  capacidade_vs_demanda?: {         // analise pre-solve
    total_slots_demanda: number
    max_slots_disponiveis: number
    ratio_cobertura_max: number
    cobertura_matematicamente_possivel: boolean
  }
  modo_emergencia?: boolean         // true quando Pass 3 — revisao obrigatoria
}

interface SolverOutput {
  sucesso: boolean                    // true se OPTIMAL ou FEASIBLE
  status: string                      // 'OPTIMAL' | 'FEASIBLE' | 'INFEASIBLE' | 'UNKNOWN'
  solve_time_ms: number
  diagnostico?: DiagnosticoSolver
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
  comparacao_demanda?: SlotComparacao[] // planejado vs executado vs delta (ver peso abaixo)
  erro?: {                            // so quando sucesso=false
    tipo: 'PREFLIGHT' | 'CONSTRAINT'
    regra: string
    mensagem: string
    sugestoes: string[]
  }
}
```

#### Peso do SolverOutput (referencia: 3 meses, ~13 colabs)

| Campo | Peso aprox. | Notas |
|-------|-------------|-------|
| `comparacao_demanda` | **67%** (~556KB) | 4212 slots × 15min. Persistido no banco (`escala_comparacao_demanda`) para charts e export CSV. |
| `alocacoes` | 21% (~177KB) | 1 linha por (colab, dia). Persistido em `alocacoes`. |
| `decisoes` | 11% (~93KB) | Explicabilidade. Persistido em `escala_decisoes`. |
| `indicadores` | <1% (~200B) | KPIs agregados. |
| `diagnostico` | <1% (~1KB) | Status do solver, regras, ciclo. |

**CLI:** `npm run solver:cli -- <id> --json` exclui `comparacao_demanda` por default (~22KB vs ~800KB). Use `--json-full` para output completo. `--summary` retorna ~1KB com indicadores, ciclo e horas por colaborador.

**Frontend:** `comparacao_demanda` alimenta o `CoberturaChart` (area chart stacked com navegacao por periodo).

### 3.7 Warm-Start Hints

Bridge busca a ultima escala do mesmo setor/periodo no DB e passa como `hints[]`. O solver usa `model.add_hint()` — nao e constraint, e sugestao de ponto de partida pra acelerar convergencia.

```typescript
// solver-bridge.ts — busca ultima escala do mesmo setor/periodo
const lastScale = await db.query(`
  SELECT id FROM escalas
  WHERE setor_id = $1 AND data_inicio = $2 AND data_fim = $3
  ORDER BY id DESC LIMIT 1
`, [setorId, dataInicio, dataFim])

// Se existe escala anterior, busca alocacoes como hints
hints = alocacoesAnteriores.map(h => ({
  colaborador_id, data, status, hora_inicio, hora_fim
}))
```

### 3.8 Modos de Resolucao

| Modo | Timeout total | Gap Limit | Quando usar |
|------|--------------|-----------|-------------|
| `rapido` | 30s (default) | 5% | Geracao normal, feedback rapido |
| `otimizado` | 120s | 0% (prove optimal) | Quando quer a melhor solucao possivel |

Configuraveis via `SolverConfigDrawer` no frontend ou via tool `gerar_escala` da IA (parametro `solve_mode`).

**Time budget splitting (multi-pass):**

| Pass | Objetivo | Tempo alocado | Relaxations |
|------|----------|---------------|-------------|
| Pass 1 | Normal (todas regras conforme config) | 50% do timeout | Nenhuma |
| Pass 2 | Relaxar product rules → SOFT | 30% do timeout | H10_ELASTIC, DIAS_TRABALHO, MIN_DIARIO, H6 |
| Pass 3 | Emergency CLT skeleton | 20% do timeout | ALL_PRODUCT_RULES (so H2/H4/H5/H11-H18 ficam HARD) |

**INFEASIBLE e provado em <1s** — dar mais tempo NAO resolve. Se o CP-SAT prova impossibilidade matematica, e instantaneo. O multi-pass tenta com regras relaxadas, nao com mais tempo.

**Regras que NUNCA relaxam (CLT core):**
H2 (interjornada 11h), H4 (max 10h/dia), H5 (excecoes), H11-H18 (aprendiz/estagiario/feriados proibidos)

### 3.9 Input Hash (Deteccao de Mudancas)

`computeSolverScenarioHash(input)` gera SHA-256 deterministico do SolverInput (normalizado e ordenado). Serve pra:
- Detectar se os dados mudaram desde a ultima geracao
- Evitar regerar escala identica (cache hit)

Campos incluidos no hash: setor_id, datas, empresa, colaboradores (ordenados por id), demanda, feriados, excecoes, regras_colaborador_dia, demanda_excecao_data, rules.

### 3.10 O que a IA precisa saber sobre o motor

**Para gerar escala:**
- Precisa de setor_id, data_inicio, data_fim (minimo)
- Pode passar `solve_mode` ('rapido' | 'otimizado'), `rules_override`
- Tool `gerar_escala` ja faz tudo isso
- INFEASIBLE e provado em <1s — dar mais tempo NAO resolve. Multi-pass resolve relaxando regras automaticamente.

**Para entender falhas (graceful degradation):**
- `diagnostico.pass_usado` indica qual pass resolveu (1=normal, 2=relaxed, 3=emergency)
- `diagnostico.regras_relaxadas` lista quais regras foram afrouxadas
- `diagnostico.capacidade_vs_demanda` mostra analise pre-solve de viabilidade
- `diagnostico.modo_emergencia` indica Pass 3 (revisao obrigatoria pelo RH)
- `diagnostico.motivo_infeasible` explica o que deu errado (se todos os 3 passes falharam)
- `erro.sugestoes[]` tem dicas acionaveis
- Tool `explicar_violacao` tem dicionario das 20+ regras

**Para diagnosticar INFEASIBLE:**
- Tool `diagnosticar_infeasible` roda o solver 6x (desligando H1, H6, H10, DIAS_TRABALHO, MIN_DIARIO individualmente + 1x com todos off)
- Identifica qual regra (ou combinacao) esta causando o conflito
- Retorna `regras_que_resolvem_ao_desligar` + `capacidade_vs_demanda`
- Workflow recomendado: gerar_escala → INFEASIBLE → diagnosticar_infeasible → explicar ao RH

**Para ajustar alocacao:**
- Tool `ajustar_alocacao` faz UPDATE direto no DB
- Validador roda automaticamente depois (via IPC)
- Violacoes hard resultantes impedem oficializacao

**Para oficializar:**
- Tool `oficializar_escala` valida `violacoes_hard = 0` antes de permitir
- Pos-oficializacao: infere e grava folga fixa/variavel em colaboradores que nao tinham F/V definido (baseado nos padroes da escala gerada). Por isso a aba Equipe pode exibir Fixo/Variavel via helper da escala OFICIAL mesmo antes da persistencia. Gerar e salvar rascunho NAO alteram o colaborador.

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
| `inicio` | TIME | Horario fixo de entrada |
| `fim` | TIME | Horario maximo de saida |
| `preferencia_turno_soft` | TEXT | MANHA, TARDE ou null |
| `domingo_ciclo_trabalho` | INT | Domingos consecutivos de TRABALHO no ciclo (default 2) |
| `domingo_ciclo_folga` | INT | Domingos consecutivos de FOLGA no ciclo (default 1) |
| `folga_fixa_dia_semana` | TEXT | Dia que SEMPRE folga (SEG, TER... DOM, ou null) |
| `folga_variavel_dia_semana` | TEXT | Segundo dia de folga semanal (SEG-SAB, sem DOM, ou null). Condicional ao domingo — só se aplica em semanas sem folga dominical. |

#### Tabela `colaborador_regra_horario_excecao_data` (N por colab)

| Campo | Tipo | Significado |
|-------|------|-------------|
| `colaborador_id` + `data` | UNIQUE | Override pontual por data |
| `inicio`, `fim` | TIME | Horario daquele dia especifico |
| `preferencia_turno_soft` | TEXT | Turno daquele dia |
| `domingo_forcar_folga` | BOOL | Forca folga nesse dia (mesmo se nao e domingo) |

#### IPC handlers — Regra horario colaborador (5)

| Handler | Input | O que faz |
|---------|-------|-----------|
| `colaboradores.buscarRegraHorario` | `{colaborador_id}` | Busca regra 1:1 do colab (ou null) |
| `colaboradores.salvarRegraHorario` | `{colaborador_id, perfil_horario_id?, inicio?, ...}` | UPSERT (INSERT ou UPDATE) na regra |
| `colaboradores.listarRegrasExcecaoData` | `{colaborador_id}` | Lista excecoes pontuais ORDER BY data |
| `colaboradores.upsertRegraExcecaoData` | `{colaborador_id, data, inicio?, ...}` | UPSERT por (colab, data) |
| `colaboradores.deletarRegraExcecaoData` | `{id}` | DELETE (hard delete — excecao e descartavel) |

### 4.3 Perfis de Horario (Contrato)

Templates reutilizaveis de janela horaria por tipo de contrato. Nao sao obrigatorios — CLT 44h/36h nao tem perfis seed.

#### Tabela `contrato_perfis_horario`

| Campo | Tipo | Significado |
|-------|------|-------------|
| `tipo_contrato_id` | FK | Qual contrato usa esse perfil |
| `nome` | TEXT | Ex: "MANHA_08_12", "TARDE_1330_PLUS" |
| `inicio` | TIME | Horario de entrada |
| `fim` | TIME | Horario de saida |
| `preferencia_turno_soft` | TEXT | MANHA ou TARDE |
| `ordem` | INT | Ordenacao na UI |

#### IPC handlers — Perfis horario (4)

| Handler | Input | O que faz |
|---------|-------|-----------|
| `perfisHorario.listar` | `{tipo_contrato_id}` | Lista perfis do contrato |
| `perfisHorario.criar` | `{tipo_contrato_id, nome, inicio, ...}` | Cria perfil, retorna o criado |
| `perfisHorario.atualizar` | `{id, nome?, inicio?, ...}` | UPDATE parcial (so campos enviados) |
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
  │       → Resultado: inicio, fim, turno, folga_fixa, domingo_forcar_folga
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

**A IA TAMBÉM PODE (tools especializadas — 34 tools no total):**
- Criar/editar regras de horario por colaborador → `salvar_regra_horario_colaborador`
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

> **Arquivo fonte:** `src/main/tipc.ts` (~3500 linhas, ~116 handlers)
>
> Todos os handlers seguem o padrao `@egoist/tipc`: `t.procedure.input<T>().action(async ({ input }) => { ... })`

### 5.1 Mapa Completo — ~116 handlers por dominio

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
| `tiposContrato.criarPerfilHorario` | `{tipo_contrato_id, nome, inicio, fim, ...}` | `PerfilHorario` criado | |
| `tiposContrato.atualizarPerfilHorario` | `{id, nome?, inicio?, ...}` | `PerfilHorario` atualizado | UPDATE parcial (so campos enviados) |
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

#### Funcoes (6 handlers)

| Handler | Input | O que retorna | Notas |
|---------|-------|---------------|-------|
| `funcoes.listar` | `{setor_id}` | `Funcao[]` | WHERE ativo=1, ORDER BY ordem |
| `funcoes.buscar` | `{id}` | `Funcao` | |
| `funcoes.criar` | `{setor_id, apelido, tipo_contrato_id?, cor_hex?, ordem?}` | `Funcao` criada | |
| `funcoes.atualizar` | `{id, apelido?, cor_hex?, ordem?}` | `Funcao` atualizada | |
| `funcoes.salvarDetalhe` | `{id?, setor_id, apelido, tipo_contrato_id, titular_colaborador_id}` | `Funcao` | Handler transacional oficial para CRUD de posto com titular opcional. Faz swap de titular, remove titular para reserva de postos e reordena secoes ocupados/reserva. |
| `funcoes.deletar` | `{id}` | void | Hard delete no cadastro atual. Se houver titular, desanexa antes. Historico continua via `equipe_snapshot_json`. |

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
| `colaboradores.salvarRegraHorario` | `{colaborador_id, perfil_horario_id?, inicio?, ...}` | `RegraHorario` | UPSERT |
| `colaboradores.listarRegrasExcecaoData` | `{colaborador_id}` | `ExcecaoData[]` | ORDER BY data |
| `colaboradores.upsertRegraExcecaoData` | `{colaborador_id, data, inicio?, ...}` | `ExcecaoData` | UPSERT por (colab,data) |
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
| `escalas.oficializar` | `{escala_id}` | `EscalaCompletaV3` | Valida violacoes_hard=0, UPDATE status→OFICIAL, arquiva anteriores. **Pos-oficializacao:** infere folga fixa/variavel para colaboradores sem F/V definido, grava na regra do colaborador e atualiza `equipe_snapshot_json`. |
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

#### IA (15 handlers) + Memorias (4) + Knowledge (6) + Session (2)

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
| `ia.conversas.arquivar` | `{id}` | void | status → 'arquivado' + limpa anexos |
| `ia.conversas.restaurar` | `{id}` | void | status → 'ativo' |
| `ia.conversas.deletar` | `{id}` | void | Hard DELETE (CASCADE mensagens) |
| `ia.conversas.arquivarTodas` | — | void | Arquiva todas as ativas + limpa anexos |
| `ia.conversas.deletarArquivadas` | — | void | Deleta todas as arquivadas |
| `ia.mensagens.salvar` | `{conversa_id, mensagem}` | void | Persiste mensagem no historico |
| `ia.memorias.listar` | — | `IaMemoria[]` | Max 20 memorias do RH |
| `ia.memorias.salvar` | `{conteudo}` | `IaMemoria` | INSERT com soft limit 20 |
| `ia.memorias.remover` | `{id}` | void | Hard DELETE |
| `ia.memorias.contar` | — | `{count}` | Contagem atual |
| `ia.sessao.processar` | `{conversa_id}` | void | Sanitize + indexacao + compaction de sessao longa |
| `ia.config.memoriaAutomatica` | `{ativa}` | void | Toggle extracao automatica de memorias |
| `knowledge.importar` | `{titulo, conteudo, tipo?}` | `KnowledgeSource` | Ingestao de documento com chunking + embeddings |
| `knowledge.listar` | — | `KnowledgeSource[]` | Lista documentos importados |
| `knowledge.buscar` | `{query, limit?}` | `KnowledgeChunk[]` | Busca semantica (pgvector cosine) + FTS portugues |
| `knowledge.deletar` | `{id}` | void | Deleta source + chunks |
| `knowledge.rebuildGraph` | — | void | Reconstroi knowledge graph (LLM por chunk) |
| `knowledge.graphStats` | — | `{entidades, relacoes, tipos}` | Contagens do graph |

#### Backup/Restore (2 handlers)

| Handler | Input | O que retorna | Notas |
|---------|-------|---------------|-------|
| `dados.exportar` | `{categorias}` | `{filepath} \| null` | Exporta ZIP com 3 categorias seletivas (cadastros, conhecimento, conversas) |
| `dados.importar` | — | `{tabelas, registros} \| null` | Importa ZIP ou JSON legado, preserva ordem de FKs |

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
| Colaboradores | 11 | 6 | 5 |
| Excecoes | 5 | 3 | 2 |
| Escalas | 14 | 6 (gerar, ajustar, oficializar, deletar, ciclo×2) | 8 |
| Dashboard | 1 | 0 | 1 |
| Export | 4 | 0 | 4 (geram arquivos no filesystem) |
| Regras | 4 | 3 | 1 |
| IA (chat + config) | 15 | 8 | 7 |
| IA (memorias) | 4 | 2 | 2 |
| IA (session) | 2 | 2 | 0 |
| Knowledge | 6 | 3 | 3 |
| Backup | 2 | 1 | 1 |
| **TOTAL** | **~116** | **~54** | **~51** |

> **Nota:** A contagem exata pode variar ±3 dependendo de como sub-handlers sao agrupados. O grep de `t.procedure` retorna ~116 ocorrencias.

### 5.4 O que a IA pode vs nao pode acessar

A IA tem **34 tools** que cobrem a maioria das operacoes do sistema. Mapeamento:

**A IA EXECUTA DIRETAMENTE (via 35 tools):**

| Capacidade | Tool(s) | IPC equivalente |
|-----------|---------|-----------------|
| Discovery completo | `get_context`, `consultar` (18 tabelas), `buscar_colaborador`, `obter_alertas` | Multiplos SELECT |
| CRUD generico | `criar` (7 entidades), `atualizar` (6), `deletar` (4), `cadastrar_lote` | colaboradores/setores/excecoes/demandas/funcoes/feriados/tipos_contrato |
| CRUD de postos | `salvar_posto_setor`, `deletar` | funcoes.salvarDetalhe / funcoes.deletar |
| Gerar escala | `gerar_escala` (com `solve_mode` e `rules_override`) | escalas.gerar |
| Ajustar alocacao | `ajustar_alocacao`, `ajustar_horario` | escalas.ajustar |
| Oficializar | `oficializar_escala` | escalas.oficializar |
| Preflight | `preflight`, `preflight_completo` | escalas.preflight |
| Diagnostico | `diagnosticar_escala`, `explicar_violacao`, **`diagnosticar_infeasible`** | validarEscalaV3 + multi-solve |
| Regras do motor | `editar_regra`, `resetar_regras_empresa` | regras.atualizar/resetar |
| Regras por colaborador | `salvar_regra_horario_colaborador`, `obter_regra_horario_colaborador`, `upsert_regra_excecao_data` | colaboradores.*RegraHorario |
| Perfis de horario | `listar_perfis_horario`, `salvar_perfil_horario`, `deletar_perfil_horario` | perfisHorario.* |
| Horario funcionamento | `configurar_horario_funcionamento` | empresa.horarios / setores.horarios |
| Demanda excecao | `salvar_demanda_excecao_data` | setores.salvarDemandaExcecaoData |
| KPIs | `resumir_horas_setor` | Queries agregadas |
| Knowledge (RAG) | `buscar_conhecimento`, `salvar_conhecimento`, `listar_conhecimento`, `explorar_relacoes` | knowledge.* |
| Memorias do RH | `salvar_memoria`, `listar_memorias`, `remover_memoria` | ia.memorias.* |

**A IA NAO tem tools para:**
- `escala_ciclo_modelos/itens` — pode LER via `consultar`, mas nao criar/editar ciclos (orientar a usar a UI)
- `tipos_contrato` — pode LER via `consultar`, criacao/edicao e pela UI
- Export HTML/PDF — requer acesso ao filesystem
- Dashboard metricas — handler `dashboard.resumo` nao exposto como tool
- Backup/Restore — handler `dados.exportar/importar` nao exposto
- Timeline dia (salvar horarios de demanda por drag) — handler `salvarTimelineDia` nao exposto

**Impacto pratico:**
A IA e autonoma em ~80% das operacoes do sistema. Os gaps restantes sao operacoes visuais (timeline drag, export PDF) ou raramente necessarias via chat (ciclo rotativo, backup).

---

## 6. Sistema IA Atual (Fase 5)

> **Arquivos fonte:**
> - `src/main/ia/cliente.ts` (~600 linhas) — orquestrador com streaming, compaction, conversa_id
> - `src/main/ia/tools.ts` (~3800 linhas) — 34 tools com Zod + handlers
> - `src/main/ia/system-prompt.ts` (~370 linhas) — prompt com 8 secoes (reescrito, inclui degradacao graciosa)
> - `src/main/ia/discovery.ts` (~300 linhas) — auto-contexto por pagina + alertas proativos + memorias
> - `src/main/ia/config.ts` — buildModelFactory (reutilizavel por knowledge graph, session-processor)
> - `src/main/ia/local-llm.ts` (~450 linhas) — IA Local: download GGUF, lifecycle modelo, chat com tool calling via node-llama-cpp
> - `src/main/ia/session-processor.ts` — sanitize transcripts, indexacao, compaction de sessoes longas
> - `src/main/knowledge/` — embeddings.ts, ingest.ts, search.ts, graph.ts (RAG + Knowledge Graph)

### 6.1 Arquitetura geral do fluxo IA

```
[Renderer]                [Main Process]                 [LLM Provider]
    |                          |                              |
    |  ia.chat.enviar(msg)     |                              |
    |─────────────────────────>|                              |
    |                          |                              |
    |                    resolveKey (provider_configs_json)    |
    |                          |                              |
    |                    buildFullSystemPrompt(contexto)       |
    |                    = SYSTEM_PROMPT + buildContextBriefing|
    |                          |                              |
    |                    buildChatMessages(historico, msg)     |
    |                    = [{role,content}...] com tool_calls  |
    |                          |                              |
    |                    getVercelAiTools()                    |
    |                    = 34 tools com Zod + execute()         |
    |                          |                              |
    |                    streamText({                          |
    |                      model, system, messages,            |
    |                      tools,                              |
    |                      stopWhen: stepCountIs(10)           |
    |                    })────────────────────────────────────>|
    |                          |                              |
    |  ia:stream text-delta    |<─── streaming tokens ────────|
    |<─────────────────────────|                              |
    |  ia:stream tool-call     |<─── tool_call ───────────────|
    |<─────────────────────────|     executeTool() local       |
    |  ia:stream tool-result   |──── tool_result ─────────────>|
    |<─────────────────────────|                              |
    |                          |<─── mais steps ──────────────|
    |                          |                              |
    |                    [Se text vazio + tools executadas]    |
    |                    → forca turno final sem tools         |
    |                          |                              |
    |                    extractToolCallsFromSteps()           |
    |                    = ToolCall[] para persistencia        |
    |                          |                              |
    |  {resposta, acoes}       |                              |
    |<─────────────────────────|                              |
```

**Entry point principal** (`cliente.ts`):
```typescript
async function iaEnviarMensagemStream(config, currentMsg, historico, contexto) {
    const fullSystemPrompt = buildFullSystemPrompt(contexto)
    const messages = buildChatMessages(historico, currentMsg)  // inclui tool_calls
    const tools = getVercelAiTools()                           // 34 tools com Zod
    const model = await maybeWrapModelWithDevTools(createModel(modelo))

    const result = streamText({
        model, system: fullSystemPrompt, messages, tools,
        stopWhen: stepCountIs(10)
    })

    // Emite eventos IPC em tempo real pro renderer
    for await (const part of result.fullStream) {
      if (part.type === 'text-delta') broadcastToRenderer('ia:stream', { type: 'text-delta', delta: part.text })
      if (part.type === 'tool-call') broadcastToRenderer('ia:stream', { type: 'tool-call-start', ... })
      if (part.type === 'tool-result') broadcastToRenderer('ia:stream', { type: 'tool-result', ... })
    }

    // Follow-up se executou tools mas nao gerou texto
    if ((!finalText || finalText.trim().length === 0) && acoes.length > 0) {
        const followUp = await generateText({ model, system: fullSystemPrompt, messages: [..., nudge] })
    }
}
```

**Ponto critico — `stopWhen: stepCountIs(10)`:**
Sem essa opcao, o AI SDK para no PRIMEIRO tool call e retorna sem executar nada. Com ela, o SDK roda ate 10 turnos (tool call → tool result → proximo passo) antes de parar. Isso permite que a IA chame `get_context()`, depois `consultar()`, depois `gerar_escala()` tudo na mesma interacao.

**Streaming em tempo real:**
O sistema usa `streamText()` — tokens aparecem progressivamente no frontend via eventos IPC `ia:stream`. Tool calls e results tambem sao emitidos em tempo real.

**Fix para texto vazio:**
Alguns modelos (Gemini em particular) executam tools mas nao geram texto ao final. Quando isso acontece, o sistema forca um turno extra SEM tools com nudge. Isso garante que o usuario SEMPRE recebe uma resposta textual.

### 6.2 Providers suportados

| Provider | Factory | Modelo default | Pacote | Requer internet? |
|----------|---------|----------------|--------|------------------|
| `gemini` | `createGoogleGenerativeAI({ apiKey })` | `gemini-3-flash-preview` | `@ai-sdk/google` | Sim |
| `openrouter` | `createOpenRouter({ apiKey })` | `anthropic/claude-sonnet-4` | `@openrouter/ai-sdk-provider` | Sim |
| `local` | `node-llama-cpp` (in-process) | `qwen3.5-9b` | `node-llama-cpp` | **Nao** |

**Resolucao de API key (prioridade):**
1. `config.provider_configs_json[provider].token` — UI multi-provider salva aqui
2. `config.api_key` — fallback legado
3. Provider `local`: retorna `'local-no-key'` (pula validacao)

Gemini e OpenRouter usam Vercel AI SDK (`streamText`). Provider Local usa path proprio via `local-llm.ts`.

### 6.2.1 IA Local — Provider Offline (node-llama-cpp)

**Arquivo:** `src/main/ia/local-llm.ts` (~450 linhas)

**Modelos curados:**

| Modelo | ID | Tamanho | RAM min | Uso |
|--------|----|---------|---------|-----|
| Qwen 3.5 9B Q4_K_M | `qwen3.5-9b` | ~5.7 GB | 8GB+ | Padrao — melhor tool calling |
| Qwen 3.5 4B Q4_K_M | `qwen3.5-4b` | ~2.8 GB | 4GB+ | Leve — maquinas com pouca RAM |

**Download:**
- GGUF baixado do HuggingFace com progresso via `fetch` + `Range` header (resume)
- `.part` temporario → rename ao completar
- Cancelamento via `AbortController`
- Progresso broadcast via `BrowserWindow.webContents.send('ia:local:download-progress')`
- Pode ter ambos modelos baixados; usuario escolhe qual usar

**Lifecycle (singleton lazy):**
- `ensureModelLoaded()`: `getLlama()` → `loadModel({modelPath})` → `createContext()`
- GPU auto-detect (Metal no Mac, Vulkan, CUDA, ou CPU fallback)
- Idle timer: descarrega modelo apos 5 min sem uso
- Cleanup no `app.on('before-quit')`

**Chat com tool calling:**
- `localLlmChat()` cria `LlamaChatSession` com system prompt trimado (`LOCAL_SYSTEM_PROMPT`, ~90 linhas)
- 34 tools convertidas via `defineChatSessionFunction` + `zodToJsonSchema`
- Reutiliza `executeTool()` existente — mesmos handlers que cloud providers
- Emite mesmos `IaStreamEvent` via `broadcastToRenderer('ia:stream')` — UI identica
- `onTextChunk` para streaming em tempo real
- Tok/s calculado e exibido no final da resposta
- Context guard: historico trimado a 20 mensagens para caber no context window
- Degradacao graceful: se OOM ao carregar, emite erro claro e sugere modelo menor

**IPC handlers (6 novos):**

| Handler | Input | O que faz |
|---------|-------|-----------|
| `ia.local.status` | — | `getLocalStatus()` (ambos modelos, GPU, tok/s) |
| `ia.local.models` | — | Lista modelos com status de download |
| `ia.local.download` | `{model_id}` | Download com broadcast de progresso |
| `ia.local.cancelDownload` | — | Cancela download ativo |
| `ia.local.deleteModel` | `{model_id}` | Unload + delete arquivo |
| `ia.local.unload` | — | Descarrega modelo da memoria |

**UI:** Card "IA Local" em Configuracoes Avancadas com download/progresso/remover para cada modelo, GPU info, badge de status.

### 6.3 Historico de mensagens

O `buildChatMessages()` converte `IaMensagem[]` do banco para o formato AI SDK **incluindo tool calls**:

```
IaMensagem { papel: 'usuario', conteudo: string }
    → { role: 'user', content: string }

IaMensagem { papel: 'assistente', conteudo: string, tool_calls_json: ToolCall[] }
    → { role: 'assistant', content: [
          { type: 'text', text: conteudo },
          ...tool_calls.map(tc => { type: 'tool-call', toolCallId, toolName, input })
       ]}
    → { role: 'tool', content:
          tool_calls.map(tc => { type: 'tool-result', toolCallId, toolName, output })
       }
```

**Regras:**
- Filtra `papel === 'usuario'` ou `'assistente'` (ignora mensagens de sistema)
- Mensagens assistente COM tool_calls geram DUAS mensagens: assistant (com tool-call parts) + tool (com tool-result parts)
- Tool results truncados em ~400 chars pra nao estourar contexto
- Adiciona a mensagem atual do usuario ao final
- Isso permite que a IA "lembre" quais tools chamou e os resultados em turnos anteriores

### 6.4 System prompt — 8 secoes

O `SYSTEM_PROMPT` em `system-prompt.ts` tem ~370 linhas com 8 secoes:

| # | Secao | Proposito |
|---|-------|-----------|
| 1 | **Identidade** | RH robotica do Supermercado Fernandes, tom profissional calorosa |
| 2 | **Conhecimento CLT/CCT** | Contratos, regras legais, grid 15min, precedencia horarios, deficit SOFT |
| 3 | **O Motor** | Fluxo solver, degradacao graciosa (multi-pass), solve_mode, INFEASIBLE + diagnosticar_infeasible |
| 4 | **Entidades — O Modelo Mental** | Empresa, Setor, Colaborador, Demanda, Excecao, Funcao, Escala, 35 regras |
| 5 | **Tools — Guia de Uso Inteligente** | 34 tools organizadas por workflow (discovery, CRUD, geracao, validacao, regras, knowledge, memorias) |
| 6 | **Schema de referencia** | Tabelas com FKs explicitas |
| 7 | **Workflows Comuns — Receitas Prontas** | 8+ receitas: gerar escala, ferias, INFEASIBLE (com diagnosticar_infeasible), Black Friday, etc |
| 8 | **Memorias e Base de Conhecimento** | Memorias do RH (max 20, injetadas no discovery) + RAG + knowledge graph |

**Detalhe da secao 5 — 34 tools por workflow:**
O prompt organiza as tools por INTENCAO (nao por nome tecnico):
- Discovery: `get_context`, `consultar`, `buscar_colaborador`, `obter_alertas`
- CRUD: `criar`, `atualizar`, `deletar`, `cadastrar_lote`
- Geracao: `preflight`, `preflight_completo`, `gerar_escala` (com `solve_mode`)
- Ajuste: `ajustar_alocacao`, `ajustar_horario`, `oficializar_escala`
- Diagnostico: `diagnosticar_escala`, `explicar_violacao`, **`diagnosticar_infeasible`**
- Regras motor: `editar_regra`, `resetar_regras_empresa`
- Regras colaborador: `salvar_regra_horario_colaborador`, `obter_regra_horario_colaborador`, `upsert_regra_excecao_data`
- KPI: `resumir_horas_setor`
- Perfis: `listar_perfis_horario`, `salvar_perfil_horario`, `deletar_perfil_horario`
- Horarios: `configurar_horario_funcionamento`
- Knowledge: `buscar_conhecimento`, `salvar_conhecimento`, `listar_conhecimento`, `explorar_relacoes`
- Memorias: `salvar_memoria`, `listar_memorias`, `remover_memoria`

**Detalhe da secao 5 — Schema reference:**
O prompt lista TODAS as tabelas consultaveis com seus campos, para que a IA saiba quais filtros usar em `consultar()`. Inclui 18 tabelas.

### 6.5 Auto-contexto (`discovery.ts`)

O `buildContextBriefing()` e chamado ANTES da requisicao ao LLM e monta uma string markdown que e concatenada ao final do system prompt. Nao custa tokens de tool call — e gratuito.

**Conteudo SEMPRE injetado (independente da pagina):**
- **Memorias do RH** (todas, max 20) — injetadas no INICIO do briefing
- Resumo global: total setores ativos, colaboradores ativos, escalas RASCUNHO/OFICIAL
- Lista de setores com contagem de colaboradores
- Feriados proximos 30 dias (com flag `proibido_trabalhar`)
- Regras customizadas (overrides empresa vs default sistema)
- Alertas proativos:
  - CRITICAL: escalas RASCUNHO com violacoes HARD
  - WARNING: escalas desatualizadas (input_hash mismatch)
  - INFO: excecoes expirando em 7 dias

**Conteudo CONDICIONAL por rota:**

| Condicao | Dados injetados |
|----------|-----------------|
| `contexto.setor_id` presente | `_infoSetor()`: lista de colaboradores (nome, contrato, horas), excecoes ativas (ferias/atestados), demandas planejadas, escala atual (indicadores, score, cobertura%, violacoes, distribuicao TRABALHO/FOLGA) |
| `contexto.colaborador_id` presente | `_infoColaborador()`: setor, contrato, regime, tipo_trabalhador, preferencia de turno, excecoes ativas |
| `contexto.pagina` | `_dicaPagina()`: hint contextual (ex: "O usuario esta na pagina de ESCALA — use dados acima sem perguntar") |

**Paginas com dicas registradas:**
`dashboard`, `setor_lista`, `setor_detalhe`, `escala`, `escalas_hub`, `colaborador_lista`, `colaborador_detalhe`, `contratos`, `empresa`, `feriados`, `configuracoes`, `regras`

**Hierarquia de confianca:**
1. `get_context()` tool — JSON estruturado, sempre mais confiavel
2. Auto-contexto — String markdown, complementar (pode estar desatualizado se usuario navegou)

### 6.6 As 34 tools — visao geral

Todas as tools sao definidas no array `IA_TOOLS[]` (`tools.ts`) em formato Gemini API e convertidas para formato Vercel AI SDK via `getVercelAiTools()`. Cada tool tem:
- Schema Zod para validacao runtime
- Funcao `execute()` que chama `executeTool(name, args)`
- Descricao detalhada com exemplos (para o LLM)

**Organizacao por categoria (34 tools):**
- Discovery: 7 | CRUD: 4 | Escalas: 6 | Validacao: 3 | Regras motor: 2
- Regras colab: 4 | Perfis/horarios: 4 | KPI: 1 | Knowledge: 4 | Memorias: 3

#### Discovery (7 tools — read-only)

| # | Tool | Schema | O que faz |
|---|------|--------|-----------|
| 1 | `get_context` | nenhum | Retorna setores + colaboradores + tipos_contrato + escalas ativas com JOINs. SEMPRE primeira chamada. |
| 2 | `buscar_colaborador` | `{nome_ou_id}` | Busca semantica por nome (LIKE) ou ID. Retorna colab + setor + contrato. |
| 3 | `obter_regra_horario_colaborador` | `{colaborador_id}` | Regra individual 1:1 + perfil horario + excecoes por data. |
| 4 | `consultar` | `{entidade, filtros?}` | SELECT generico em 18 tabelas com campos validados. Limit 50 rows. Enrichment FK→nome. |
| 5 | `diagnosticar_escala` | `{escala_id}` | Roda validarEscalaV3() e retorna indicadores + violacoes atualizados. |
| 6 | `explicar_violacao` | `{codigo_regra}` | Lookup em DICIONARIO_VIOLACOES (20+ regras) + fallback pra regra_definicao. |
| 7 | `obter_alertas` | nenhum | Agregacao: poucos colabs, sem escala, violacoes HARD, escala desatualizada (hash), excecoes expirando. |

#### CRUD generico + postos (5 tools)

| # | Tool | Schema | O que faz |
|---|------|--------|-----------|
| 8 | `criar` | `{entidade, dados}` | INSERT generico — 7 entidades permitidas, defaults inteligentes pra colabs/excecoes. |
| 9 | `atualizar` | `{entidade, id, dados}` | UPDATE parcial — 6 entidades permitidas. Para `funcoes`, redireciona para a regra de negocio oficial. |
| 10 | `deletar` | `{entidade, id}` | DELETE — 4 entidades permitidas. Para `funcoes`, chama `deletarFuncao` em vez de SQL cru. |
| 11 | `salvar_posto_setor` | `{id?, setor_id, apelido, tipo_contrato_id, titular_colaborador_id?}` | CRUD semantico de posto: cria/edita, faz swap de titular e move vazio para reserva de postos. |
| 12 | `cadastrar_lote` | `{entidade, registros[]}` | Batch INSERT ate 200 registros com mesmos defaults de `criar`. |

#### Geracao e ajuste de escalas (6 tools)

| # | Tool | Schema | O que faz |
|---|------|--------|-----------|
| 13 | `preflight` | `{setor_id, datas}` | Verifica viabilidade rapida: setor ativo, colabs, demandas, feriados. |
| 13 | `preflight_completo` | `{setor_id, datas}` | Versao completa: chama `buildEscalaPreflight()` com capacity checks por colab/dia. |
| 14 | `gerar_escala` | `{setor_id, datas, solve_mode?, rules_override?}` | buildSolverInput → runSolver (60s rapido / 180s otimizado) → multi-pass → persistirSolverResult. Retorna escala RASCUNHO com diagnostico (pass_usado, regras_relaxadas). |
| 15 | `ajustar_alocacao` | `{escala_id, colab_id, data, status}` | UPDATE alocacoes.status (TRABALHO/FOLGA/INDISPONIVEL). |
| 16 | `ajustar_horario` | `{escala_id, colab_id, data, hora_inicio, hora_fim}` | UPDATE hora_inicio/hora_fim em alocacoes. Revalida via validarEscalaV3(). |
| 17 | `oficializar_escala` | `{escala_id}` | UPDATE status='OFICIAL'. Valida violacoes_hard=0 antes de permitir. |

#### Regras do motor (2 tools)

| # | Tool | Schema | O que faz |
|---|------|--------|-----------|
| 18 | `editar_regra` | `{codigo, status}` | INSERT OR REPLACE em regra_empresa. Valida editavel=1. |
| 19 | `resetar_regras_empresa` | nenhum | DELETE FROM regra_empresa. Volta tudo ao default do sistema. |

#### Regras por colaborador (4 tools)

| # | Tool | Schema | O que faz |
|---|------|--------|-----------|
| 20 | `salvar_regra_horario_colaborador` | `{colaborador_id, ...}` | UPSERT regra 1:1 (perfil, horario, ciclo domingo, folga fixa). |
| 21 | `upsert_regra_excecao_data` | `{colaborador_id, data, ...}` | Override pontual por data (inicio/fim, turno, forcar folga). |
| 22 | `salvar_demanda_excecao_data` | `{setor_id, data, ...}` | Override de demanda por data (Black Friday, vespera feriado). |

#### Perfis e horarios (4 tools)

| # | Tool | Schema | O que faz |
|---|------|--------|-----------|
| 24 | `listar_perfis_horario` | `{tipo_contrato_id}` | Lista perfis de horario por contrato. |
| 25 | `salvar_perfil_horario` | `{tipo_contrato_id, nome, ...}` | CREATE ou UPDATE perfil de horario. |
| 26 | `deletar_perfil_horario` | `{id}` | Hard DELETE perfil. |
| 27 | `configurar_horario_funcionamento` | `{dia_semana, ...}` | UPDATE empresa_horario_semana ou UPSERT setor_horario_semana. |

#### KPI (1 tool)

| # | Tool | Schema | O que faz |
|---|------|--------|-----------|
| 28 | `resumir_horas_setor` | `{setor_id, periodo?}` | Query agregada: horas por pessoa, totais, distribuicao. |

**Dispatch: como `executeTool()` funciona:**
```typescript
export async function executeTool(name: string, args: Record<string, any>): Promise<any> {
    const db = (global as any).mockDb || getDb()

    // Validação Zod runtime — TODA tool passa por aqui
    const schema = TOOL_SCHEMAS[name]
    if (schema) {
        const validation = schema.safeParse(args)
        if (!validation.success) {
            return toolError('INVALID_TOOL_ARGUMENTS', `Validação falhou...`, {
                correction: 'Corrija os argumentos com base no schema da tool.'
            })
        }
        args = validation.data as Record<string, any>
    }

    // Handlers por nome — if/else chain (28 branches)
    if (name === 'get_context') { /* ... */ }
    if (name === 'consultar') { /* ... */ }
    // ...etc para cada tool
}
```

### 6.7 Seguranca das tools

**Whitelists de entidades (4 conjuntos independentes):**

| Operacao | Entidades permitidas |
|----------|---------------------|
| Leitura (18) | colaboradores, setores, escalas, alocacoes, excecoes, demandas, tipos_contrato, empresa, feriados, funcoes, regra_definicao, regra_empresa, demandas_excecao_data, colaborador_regra_horario_excecao_data, contrato_perfis_horario, empresa_horario_semana, setor_horario_semana, escala_ciclo_modelos |
| Criacao (7) | colaboradores, excecoes, demandas, tipos_contrato, setores, feriados, funcoes |
| Atualizacao (5) | colaboradores, empresa, tipos_contrato, setores, demandas |
| Delecao (4) | excecoes, demandas, feriados, funcoes |

**Protecao contra SQL injection:**
O `CAMPOS_VALIDOS` define um Set<string> por entidade (18 tabelas) com TODOS os campos aceitos. Se a IA passar um campo que nao existe, recebe erro antes da query SQL.

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
O campo `correction` e uma dica PRO LLM de como corrigir o erro — 100% dos `toolError` tem `correction`.
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

### 6.11 DevTools middleware (opcional)

Se `ESCALAFLOW_AI_DEVTOOLS=1` ou `NODE_ENV !== 'production'`:
- Tenta importar `@ai-sdk/devtools` dinamicamente
- Se disponivel, wrapa o model com `wrapLanguageModel({ model, middleware: devToolsMiddleware() })`
- Permite visualizar requests no AI SDK DevTools (http://localhost:4983)

### 6.12 Gaps e limitacoes remanescentes

**Gaps de tools (poucas operacoes restantes sem tool):**

| Operacao | Por que nao tem tool |
|----------|---------------------|
| Ciclo rotativo (criar/editar) | Complexidade: modelo + itens + semana_idx — operacao visual na UI |
| Tipos contrato (criar/editar) | Raramente necessario via chat — editavel na UI |
| Export HTML/PDF | Requer acesso ao filesystem nativo |
| Timeline dia (drag de demanda) | Operacao intrinsecamente visual |
| Dashboard metricas | handler existe mas nao exposto — IA usa `get_context` + `resumir_horas_setor` |
| Backup/restore | Acesso ao filesystem |

**Gaps de comportamento:**

1. **Historico truncado:** Tool results no historico truncados em ~400 chars. Em conversas longas com muitas tools, a IA pode perder detalhes de resultados anteriores.
2. **Sem duplicacao de escala:** A IA pode GERAR nova, mas nao DUPLICAR existente com novo periodo.
3. **Follow-up fragil:** O nudge pra texto vazio funciona mas adiciona latencia. Modelos melhores (Gemini 2.5 Flash) ja geram texto naturalmente.

### 6.13 Knowledge Layer (RAG + Knowledge Graph)

> **Arquivos fonte:**
> - `src/main/knowledge/embeddings.ts` — @huggingface/transformers multilingual-e5-small (ONNX local, 384 dims)
> - `src/main/knowledge/ingest.ts` — Chunking + ingestao de documentos
> - `src/main/knowledge/search.ts` — Busca semantica (pgvector cosine) + FTS portugues + knowledge graph CTE
> - `src/main/knowledge/graph.ts` — Extracao de entidades/relacoes via LLM + persist com embedding

**Arquitetura:**
```
Documento importado
    │
    ├─ [1] ingest.ts: chunking (markdown-aware, ~500 tokens/chunk)
    ├─ [2] embeddings.ts: embed cada chunk (multilingual-e5-small, ONNX local)
    ├─ [3] INSERT knowledge_sources + knowledge_chunks (com embedding vector(768))
    │
    └─ [4] graph.ts (opcional, via "Analisar Relacoes"):
          ├─ Para cada chunk: extractEntitiesFromChunk() via LLM (generateObject + Zod)
          ├─ Merge dedup: entidades por (nome, tipo), relacoes por (from, to, tipo_relacao)
          └─ persist: INSERT knowledge_entities + knowledge_relations (com embedding)
```

**Busca (search.ts):**
1. **Semantica:** pgvector cosine similarity no embedding do query
2. **FTS:** Full-text search portugues (ts_vector + ts_query)
3. **Graph enrichment:** CTE recursivo expande entidades relacionadas

**Tabelas:**
- `knowledge_sources`: documentos importados (manual, session, auto_extract)
- `knowledge_chunks`: chunks com embedding vector(768) + FTS portugues
- `knowledge_entities`: entidades extraidas (pessoa, setor, regra, conceito...) com `origem` (sistema/usuario)
- `knowledge_relations`: relacoes entre entidades (trabalha_em, regido_por, etc)

**Graph sistema vs usuario:**
- `origem='sistema'`: extraidas dos docs em `knowledge/` (CLT, regras). Pre-computadas pelo dev via `graph-seed.json`
- `origem='usuario'`: extraidas dos docs importados pelo RH. Processadas via botao "Analisar Relacoes" na UI
- IA ve TUDO (ambas origens) via `explorar_relacoes` e RAG enrichment

**Tools IA (4):** `buscar_conhecimento`, `salvar_conhecimento`, `listar_conhecimento`, `explorar_relacoes`

### 6.14 Memorias do RH

Memorias curtas que o RH (ou a IA) salva para lembrar de contextos recorrentes.

- **Tabela:** `ia_memorias` (id, conteudo, criada_em, atualizada_em)
- **Soft limit:** 20 memorias (a UI mostra contagem, a IA avisa quando proximo do limite)
- **Injecao:** Todas as memorias sao injetadas no discovery (buildContextBriefing) a cada request — ANTES do resumo global
- **Tools IA (3):** `salvar_memoria`, `listar_memorias`, `remover_memoria`
- **Extracao automatica:** `session-processor.ts` pode extrair memorias de sessoes longas (toggle na config)

### 6.15 Session Processing

> **Arquivo:** `src/main/ia/session-processor.ts`

Processa sessoes de chat para manter o contexto gerenciavel:
- **sanitizeTranscript:** Remove tool results extensos, gera marcadores `[Anexo: nome (mime)]` pra msgs sem texto
- **estimateTokens:** Estimativa rapida de tokens (char/4)
- **indexSession:** Salva sessao como knowledge source pra busca futura
- **extractMemories:** Extrai fatos importantes da sessao como memorias persistentes
- **maybeCompact:** Se sessao ultrapassa threshold, gera resumo compactado via LLM

**Compaction no cliente.ts:**
- `buildChatMessages()` usa `resumo_compactado` da conversa se disponivel
- Mensagens antigas sao substituidas pelo resumo, mantendo as ultimas N mensagens completas
- Permite conversas longas sem estourar contexto do LLM

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
| `/memoria` | MemoriaPagina | MemoriaPagina.tsx | 20KB | Docs importados, memorias IA, knowledge graph (tabs) |
| `/ia` | IaPagina | IaPagina.tsx | 4KB | Chat IA em pagina inteira (alternativa ao painel lateral) |
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

#### 7.4.1 — As 10 acoes mais comuns do gestor de RH e como a IA resolve

| # | Acao do gestor | Frequencia | Como a IA resolve | Status |
|---|---------------|------------|-------------------|--------|
| 1 | Gerar escala do mes | Mensal | `preflight_completo` + `gerar_escala` | ✅ Completo |
| 2 | Cadastrar funcionario novo | Eventual | `criar(colaboradores, {...})` com defaults inteligentes | ✅ Completo |
| 3 | Consultar quem trabalha tal dia | Diaria | `consultar(alocacoes, {data, escala_id})` com enrichment | ✅ Completo |
| 4 | Colocar funcionario de ferias | Mensal | `criar(excecoes, {tipo:'FERIAS', ...})` | ✅ Completo |
| 5 | Ajustar horario de alguem | Semanal | `ajustar_horario` (hora_inicio/hora_fim + revalidacao) | ✅ Completo |
| 6 | Definir regra individual ("so de manha") | Eventual | `salvar_regra_horario_colaborador` | ✅ Completo |
| 7 | Oficializar escala | Mensal | `oficializar_escala` (valida violacoes_hard=0) | ✅ Completo |
| 8 | Ver resumo de horas do setor | Semanal | `resumir_horas_setor` (KPIs agregados por pessoa/periodo) | ✅ Completo |
| 9 | Entender por que deu INFEASIBLE | Quando ocorre | `diagnosticar_escala` + `explicar_violacao` + diagnostico do solver | ✅ Completo |
| 10 | Importar lista de funcionarios | Na implantacao | `cadastrar_lote` (batch ate 200, mesmos defaults) | ✅ Completo |

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
| CoberturaChart | CoberturaChart.tsx (7KB) | Area chart stacked (Necessario vs Coberto) com navegacao Semana/Mes/Tudo + paginacao `< >`. Usa recharts + shadcn chart. Presente em SetorDetalhe, EscalaPagina e EscalasHub. |

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
| Demanda | Configurar faixas horarias | `salvar_demanda_excecao_data` cobre excecoes por data. Demanda regular: IA pode orientar |
| Colaborador | Configurar regras individuais | `salvar_regra_horario_colaborador`, `upsert_regra_excecao_data` cobrem 100% |
| Export | Gerar PDF | Sem tool — acesso a filesystem |

---

## 8. Gap Analysis e Recomendacoes (Fase 7)

### 8.1 Mapa de capacidades — IA vs Sistema

```
                     ┌─────────────────────────────────────────────┐
                     │            CAPACIDADES DO SISTEMA           │
                     │                (~116 IPC handlers)          │
                     │                                             │
                     │  ┌─────────────────────────────────┐       │
                     │  │    CAPACIDADES DA IA             │       │
                     │  │      (34 tools)                  │       │
                     │  │                                  │       │
                     │  │  ✅ Discovery completo (18 tab)  │       │
                     │  │  ✅ CRUD generico (7 entidades)  │       │
                     │  │  ✅ Gerar escalas (motor Python) │       │
                     │  │  ✅ Ajustar alocacoes + horarios │       │
                     │  │  ✅ Oficializar escalas          │       │
                     │  │  ✅ Preflight completo + simples │       │
                     │  │  ✅ Editar regras do motor       │       │
                     │  │  ✅ Regras por colaborador       │       │
                     │  │  ✅ Excecoes por data            │       │
                     │  │  ✅ Perfis horario por contrato  │       │
                     │  │  ✅ Demanda excecao por data     │       │
                     │  │  ✅ Horario funcionamento        │       │
                     │  │  ✅ KPIs (resumir horas setor)   │       │
                     │  │  ✅ Alertas proativos            │       │
                     │  │  ✅ Diagnostico + explicacao     │       │
                     │  │  ✅ Diagnosticar INFEASIBLE      │       │
                     │  │  ✅ Importacao em lote (CSV)     │       │
                     │  │  ✅ Knowledge RAG (busca/salvar) │       │
                     │  │  ✅ Knowledge Graph (explorar)   │       │
                     │  │  ✅ Memorias do RH (CRUD)        │       │
                     │  └─────────────────────────────────┘       │
                     │                                             │
                     │  ❌ Ciclo rotativo (criar/editar)           │
                     │  ❌ Tipos contrato (criar/editar)           │
                     │  ❌ Export HTML/PDF                         │
                     │  ❌ Timeline dia (drag visual)              │
                     │  ❌ Dashboard metricas (handler)            │
                     │  ❌ Backup/Restore                          │
                     └─────────────────────────────────────────────┘
```

**Cobertura: ~85% das operacoes do sistema sao acessiveis pela IA.** Os gaps restantes sao operacoes intrinsecamente visuais (timeline drag, export PDF) ou raramente necessarias via chat (ciclo rotativo, backup, tipos_contrato).

### 8.2 Tools futuras (backlog)

| Prioridade | Tool proposta | Impacto |
|------------|--------------|---------|
| **P2** | `duplicar_escala` | "Copia a escala do caixa pra abril" — handler `escalas.duplicar` existe mas nao exposto |
| **P3** | `ciclo_rotativo` | Criar/gerenciar ciclos rotativos via chat — complexidade alta (modelo + itens + semana_idx) |
| **P3** | `dashboard` | Resumir KPIs sem navegar — parcialmente coberto por `get_context` + `resumir_horas_setor` |

### 8.3 Melhorias nas tools existentes

| Tool | Melhoria potencial |
|------|--------------------|
| `consultar` | Offset/limit como parametros opcionais (hoje fixo em 50 rows) |
| `gerar_escala` | Timeout configuravel (hoje fixo 60s) pra escalas grandes |
| `cadastrar_lote` | Check de duplicatas por nome (`ILIKE`) antes de INSERT |

### 8.4 Melhorias de arquitetura

| # | Area | Estado atual | Proposta |
|---|------|-------------|---------|
| 1 | Contexto | Auto-contexto rebuilda a cada mensagem | Cachear com TTL de 30s |
| 2 | Multi-turn | Max 10 steps, sem controle de custo | Token counting e budget limit |
| 3 | Observability | console.log basico | Logs estruturados (tempo por tool, tokens usados) |

### 8.5 Resumo executivo

**O que esta BOM:**
- 34 tools cobrem ~85% das operacoes: discovery, CRUD, geracao, ajuste, regras, regras colab, perfis, horarios, KPI, alertas, knowledge, memorias
- Motor com degradacao graciosa (multi-pass): tenta o melhor possivel antes de falhar
- `diagnosticar_infeasible` permite debugar conflitos (roda solver 6x isolando regras)
- Knowledge Layer: RAG local (embeddings ONNX + pgvector + FTS portugues + knowledge graph)
- Memorias do RH (max 20) injetadas no discovery a cada request
- Streaming em tempo real (`streamText`) com eventos IPC
- Historico com tool calls preservados (`buildChatMessages` inclui tool-call + tool-result parts)
- Validacao Zod runtime em TODAS as tools com `correction` em 100% dos toolError
- Seguranca: whitelists por operacao (18 tabelas leitura, 7 criacao, 5 atualizacao, 4 delecao), campos validados, limit de rows
- Auto-contexto por pagina com alertas proativos (violacoes, hash desatualizado, excecoes expirando)
- Multi-provider (Gemini + OpenRouter + Local) com mesma logica. Provider Local roda modelo GGUF in-process via node-llama-cpp sem internet.
- Persistencia de conversas com PGlite + auto-titulo
- Evals com SAVEPOINT/ROLLBACK protegendo o banco de dados
- System prompt de 8 secoes com workflows prontos e schema completo

**Gaps restantes:**
- 6 categorias de operacao ainda exclusivas da UI (ciclo rotativo, tipos_contrato, export, timeline drag, dashboard, backup)
- Historico truncado (~400 chars por tool result) pode perder detalhes em conversas longas

**Riscos conhecidos:**
- `criar` e `cadastrar_lote` fazem INSERT com dados do LLM — alucinacao vira dado no banco
- Sem rollback em `cadastrar_lote`: se falha no registro 150/200, os 149 ja estao no banco

### 8.7 Decisoes de design documentadas

Para cada decisao nao-obvia: o que, por que, e se ainda faz sentido.

| # | Decisao | Por que | Ainda faz sentido? |
|---|---------|---------|-------------------|
| 1 | **Grid 15 minutos** (era 30min) | CLT Art. 71 §1 exige intervalo de 15min para jornadas 4-6h. Grid 30min nao representava isso. Constante unica `CLT.GRID_MINUTOS` em `constants.ts`. | Sim. Precisao necessaria. Trade-off: mais variaveis no solver (2x), mas tempo de solve permanece < 30s para setores tipicos. |
| 2 | **H3 (domingo) → SOFT** | H3 como HARD causava INFEASIBLE em setores com poucos colabs. Rodizio de domingo e desejavel mas nao bloqueante. Substituido por `add_domingo_ciclo_soft` + `add_h3_rodizio_domingo` separados por sexo (mulher: max 1 consec, homem: max 2 — CLT Art. 386). | Sim. Funciona melhor como penalidade. |
| 3 | **Deficit como SOFT, nao HARD** | Com 6 pessoas e constraints CLT, 100% cobertura e matematicamente impossivel. Na pratica, um RH experiente atinge ~85%. Deficit HARD = INFEASIBLE garantido. Peso 10.000 forca o solver a minimizar gaps sem tornar impossivel. (`constraints.py:387`) | Sim. Decisao fundamental. |
| 4 | **Feriados orientados por demanda** | So 25/12 e 01/01 sao proibidos por CCT. Outros feriados: trabalho permitido se houver demanda. Portaria MTE 3.665 (apos 01/03/2026) pode mudar isso. Flag `proibido_trabalhar` por feriado. | Sim, mas precisa revisao quando Portaria entrar em vigor. |
| 5 | **Motor Python, nao TypeScript** | OR-Tools CP-SAT e ordens de magnitude mais eficiente que backtracking JS. Motor TS legado (`gerador.ts`) deletado. Trade-off: bridge via child_process stdin/stdout JSON adiciona ~200ms de overhead, mas solver roda em < 30s vs minutos no TS. | Sim. Insubstituivel. |
| 6 | **snake_case ponta a ponta** | DB columns = IPC keys = TS interfaces = React props. Zero adaptadores. Reduz bugs de mapeamento em sistema com 80+ handlers. Convencao incomum em TS mas necessaria para produto com time de 1 pessoa. | Sim. Consistencia > convencao do ecossistema. |
| 7 | **Compensacao 9h45** | CLT 44h = 7h20/dia em 6 dias. Mas supermercados usam jornada 8h48 (5 dias) ou 9h45 (5 dias com sabado alternado). `max_minutos_dia` vem do contrato, nao de calculo fixo. So CLT 44h e 36h — nunca estagiario/aprendiz. | Sim. Reflete pratica real. |
| 8 | **H19 (folga comp domingo) — NOOP no solver, ativo no validador** | No solver: matematicamente redundante com H1 (max 6 dias consecutivos). Emitir causava INFEASIBLE com dias_trabalho + H10. No validador TS: checa Lei 605/1949 (folga compensatoria 7 dias apos domingo trabalhado). Fix v1.4: boundary guard — se nao ha dias apos o domingo no periodo, pula (folga pode estar fora do periodo gerado). (`validacao-compartilhada.ts`) | Sim. NOOP no solver, check no validador com boundary guard. |
| 9 | **Surplus penalty (peso 5.000)** | Sem surplus, solver empilha colabs em slots ja cobertos (surplus=3) enquanto outros ficam com deficit=2. Deficit sozinho nao distingue ONDE colocar capacidade. Surplus torna excesso CARO, forcando redistribuicao. Math: mover 1 pessoa de surplus pra deficit economiza 15.000 (10k+5k). (`constraints.py:877-912`) | Sim. Sem isso, escalas ficam desequilibradas. |
| 10 | **Vercel AI SDK (cloud) + node-llama-cpp (local)** | Cloud: Vercel AI SDK abstrai Gemini + OpenRouter. Local: node-llama-cpp roda GGUF in-process com `defineChatSessionFunction` para tool calling. Ambos emitem mesmos `IaStreamEvent` — UI identica. Trade-off local: modelo 9B precisa 8GB+ RAM, tool calling menos preciso que cloud. | Sim. 3 providers com mesma experiencia de chat. |
| 11 | **Auto-contexto (discovery) a cada mensagem** | Injeta setores, colabs, escalas no system prompt sem tool call. Custo: ~200-500 tokens extras. Beneficio: IA responde perguntas simples sem chamar get_context. Discovery condicional por pagina reduz tamanho. | Sim, mas pode cachear com TTL de 30s. |
| 12 | **Historico COM tool calls** | `buildChatMessages()` envia role user/assistant/tool. Mensagens assistant incluem `tool-call` parts, seguidas de mensagem `tool` com `tool-result` parts (truncados a ~400 chars). Motivo: preserva contexto de descobertas entre turnos — IA sabe o que ja consultou/criou. Trade-off: mais tokens no historico, mas IA nao "esquece" o que fez. | Sim. Melhoria implementada sobre decisao original. Avaliar compressao se conversas ficarem longas. |

---

## Apendice A: Mapa completo de IPC handlers

> Incluido na secao 5.1 (80+ handlers mapeados por dominio com input/output)

## Apendice B: Catalogo de regras (35)

> Incluido na secao 2.9

## Apendice C: Inventario de tools IA (34 tools)

> **Atualizado em:** 2026-02-24 — inclui diagnosticar_infeasible, knowledge (4), memorias (3)

### C.1 Discovery (7 tools)

| Tool | Parametros | O que faz | Efeito |
|------|-----------|-----------|--------|
| `get_context` | nenhum | Retorna setores, colabs, tipos_contrato, escalas com JOINs e counts | Read-only |
| `consultar` | entidade, filtros? | SELECT generico em 18 entidades com enrichment de nomes (FK→nome). Limit 50 rows | Read-only |
| `buscar_colaborador` | nome ou id | Busca fuzzy por colaborador (LIKE %nome%). Retorna com setor, contrato, restricoes | Read-only |
| `obter_regra_horario_colaborador` | colaborador_id | Regras individuais: janela, folga fixa, excecoes por data | Read-only |
| `listar_perfis_horario` | tipo_contrato_id | Perfis de horario vinculados a um tipo de contrato | Read-only |
| `obter_alertas` | nenhum | Agregacao: poucos colabs, sem escala, violacoes HARD, hash desatualizado, excecoes expirando | Read-only |
| `resumir_horas_setor` | setor_id, data_inicio, data_fim | KPI: horas trabalhadas por colaborador no periodo (query em alocacoes) | Read-only |

### C.2 CRUD generico (4 tools)

| Tool | Parametros | Validacoes | Efeito |
|------|-----------|------------|--------|
| `criar` | entidade, dados | Whitelist 7 entidades (colaboradores, setores, excecoes, funcoes, feriados, demandas, escalas) | INSERT ou fluxo semantico para funcoes |
| `atualizar` | entidade, id, dados | Whitelist 6 entidades (colaboradores, setores, funcoes, feriados, demandas, excecoes) | UPDATE parcial ou fluxo semantico para funcoes |
| `deletar` | entidade, id | Whitelist 4 entidades (excecoes, funcoes, feriados, demandas) | DELETE; para funcoes usa regra de negocio (`deletarFuncao`) |
| `cadastrar_lote` | entidade, registros[] (1-200) | Mesma whitelist de `criar`. Batch INSERT com erros parciais | INSERT em batch |

### C.2.1 CRUD semantico de postos

| Tool | Parametros | Validacoes | Efeito |
|------|-----------|------------|--------|
| `salvar_posto_setor` | `id?`, `setor_id`, `apelido`, `tipo_contrato_id`, `titular_colaborador_id?` | Mesmo setor entre posto e titular; contrato obrigatorio; `null` remove titular | Cria/edita posto, faz swap de titular, move posto vazio para reserva de postos |

### C.3 Escalas (6 tools)

| Tool | Parametros | O que faz | Efeito |
|------|-----------|-----------|--------|
| `gerar_escala` | setor_id, data_inicio, data_fim, solve_mode?, rules_override? | Roda solver Python (OR-Tools CP-SAT) com multi-pass graceful degradation. Retorna escala_id, indicadores, diagnostico (pass_usado, regras_relaxadas, capacidade_vs_demanda) | INSERT escala + alocacoes |
| `ajustar_alocacao` | escala_id, colaborador_id, data, status | Muda status de uma alocacao (TRABALHO/FOLGA/INDISPONIVEL) | UPDATE alocacoes |
| `ajustar_horario` | escala_id, colaborador_id, data, hora_inicio, hora_fim, almoco_inicio?, almoco_fim? | Altera horarios de uma alocacao especifica | UPDATE alocacoes |
| `oficializar_escala` | escala_id | Valida violacoes_hard=0, muda status RASCUNHO→OFICIAL | UPDATE escalas |
| `preflight` | setor_id, data_inicio, data_fim | Check rapido de viabilidade (colabs, demandas, blockers) | Read-only |
| `preflight_completo` | setor_id, data_inicio, data_fim | Check extenso com capacity analysis e warnings detalhados | Read-only |

### C.4 Validacao e referencia (3 tools)

| Tool | Parametros | O que faz | Efeito |
|------|-----------|-----------|--------|
| `diagnosticar_escala` | escala_id | Revalida escala existente contra PolicyEngine. Retorna violacoes atualizadas | Read-only |
| `explicar_violacao` | codigo_regra | Dicionario de 20+ regras (H1-H18, SOFT, AP) com explicacao textual | Read-only |
| `diagnosticar_infeasible` | setor_id, data_inicio, data_fim | Roda solver 6x desligando regras relaxaveis uma a uma (H1, H6, H10, DIAS_TRABALHO, MIN_DIARIO + todos off). Identifica regras culpadas. | Read-only (solver sem persistir) |

### C.5 Regras do motor (2 tools)

| Tool | Parametros | O que faz | Efeito |
|------|-----------|-----------|--------|
| `editar_regra` | codigo, status | Altera status de regra (HARD/SOFT/OFF/ON). Valida editavel=1 | INSERT OR REPLACE regra_empresa |
| `resetar_regras_empresa` | confirmacao | Deleta TODOS os overrides de regra_empresa (volta ao default) | DELETE FROM regra_empresa |

### C.6 Regras por colaborador (3 tools)

| Tool | Parametros | O que faz | Efeito |
|------|-----------|-----------|--------|
| `salvar_regra_horario_colaborador` | colaborador_id, campos | Salva/atualiza regra individual (horario, folga fixa, ciclo domingo) | UPSERT colaborador_regra_horario |
| `upsert_regra_excecao_data` | colaborador_id, data, campos | Override pontual por data (ex: "dia 15/03 so pode tarde") | UPSERT colaborador_regra_horario_excecao_data |
| `salvar_demanda_excecao_data` | setor_id, data, faixas | Demanda excepcional por data (ex: Black Friday) | INSERT demandas_excecao_data |

### C.7 Knowledge (4 tools)

| Tool | Parametros | O que faz | Efeito |
|------|-----------|-----------|--------|
| `buscar_conhecimento` | query, limit? | Busca semantica (pgvector cosine) + FTS portugues na base de conhecimento | Read-only |
| `salvar_conhecimento` | titulo, conteudo, tipo? | Importa documento com chunking + embeddings locais | INSERT knowledge_sources + chunks |
| `listar_conhecimento` | nenhum | Lista documentos importados | Read-only |
| `explorar_relacoes` | entidade?, tipo? | Navega knowledge graph (CTE recursivo): entidades, relacoes, conexoes | Read-only |

### C.8 Memorias do RH (3 tools)

| Tool | Parametros | O que faz | Efeito |
|------|-----------|-----------|--------|
| `salvar_memoria` | conteudo | Salva memoria curta do RH (max 20, injetada no discovery a cada request) | INSERT ia_memorias |
| `listar_memorias` | nenhum | Lista todas as memorias ativas | Read-only |
| `remover_memoria` | id | Remove memoria especifica | DELETE ia_memorias |

### C.9 Perfis e horarios (3 tools)

| Tool | Parametros | O que faz | Efeito |
|------|-----------|-----------|--------|
| `salvar_perfil_horario` | tipo_contrato_id, nome, campos | Cria ou atualiza perfil de horario de um contrato | CREATE/UPDATE contrato_perfis_horario |
| `deletar_perfil_horario` | id | Remove perfil de horario | DELETE contrato_perfis_horario |
| `configurar_horario_funcionamento` | nivel (empresa/setor), campos | Configura horario de abertura/fechamento | UPDATE empresa_horario_semana ou UPSERT setor_horario_semana |

### C.10 Whitelists por operacao

| Operacao | Entidades permitidas (z.enum) |
|----------|-------------------------------|
| **Leitura** (consultar) | 18: setores, colaboradores, escalas, alocacoes, excecoes, tipos_contrato, demandas, funcoes, feriados, regra_definicao, regra_empresa, colaborador_regra_horario, colaborador_regra_horario_excecao_data, contrato_perfis_horario, empresa_horario_semana, setor_horario_semana, demandas_excecao_data, escala_ciclo_modelos |
| **Criacao** (criar, cadastrar_lote) | 7: colaboradores, setores, excecoes, funcoes, feriados, demandas, escalas |
| **Atualizacao** (atualizar) | 6: colaboradores, setores, funcoes, feriados, demandas, excecoes |
| **Delecao** (deletar) | 4: excecoes, funcoes, feriados, demandas |

### C.11 Schemas Zod (principais)

```typescript
// ConsultarSchema
{ entidade: enum(18 tabelas), filtros?: Record<string, any> }

// CriarSchema
{ entidade: enum(7 tabelas), dados: Record<string, any> }

// AtualizarSchema
{ entidade: enum(5 tabelas), id: number, dados: Record<string, any> }

// DeletarSchema
{ entidade: enum(4 tabelas), id: number }

// GerarEscalaSchema
{ setor_id: number, data_inicio: 'YYYY-MM-DD', data_fim: 'YYYY-MM-DD',
  solve_mode?: 'rapido'|'otimizado',
  rules_override?: Record<string, string> }

// DiagnosticarInfeasibleSchema
{ setor_id: number, data_inicio: 'YYYY-MM-DD', data_fim: 'YYYY-MM-DD' }

// AjustarAlocacaoSchema
{ escala_id: number, colaborador_id: number,
  data: 'YYYY-MM-DD', status: 'TRABALHO'|'FOLGA'|'INDISPONIVEL' }

// AjustarHorarioSchema
{ escala_id: number, colaborador_id: number, data: 'YYYY-MM-DD',
  hora_inicio: 'HH:MM', hora_fim: 'HH:MM',
  almoco_inicio?: 'HH:MM', almoco_fim?: 'HH:MM' }

// OficializarEscalaSchema
{ escala_id: number }

// PreflightSchema / PreflightCompletoSchema
{ setor_id: number, data_inicio: 'YYYY-MM-DD', data_fim: 'YYYY-MM-DD' }

// EditarRegraSchema
{ codigo: string, status: 'HARD'|'SOFT'|'OFF'|'ON' }

// SalvarRegraHorarioColaboradorSchema
{ colaborador_id: number, inicio?: 'HH:MM', fim?: 'HH:MM',
  ciclo_domingo_padrao?: string, folga_fixa_dia?: number, ... }

// SalvarDemandaExcecaoDataSchema
{ setor_id: number, data: 'YYYY-MM-DD', faixas: [{hora_inicio, hora_fim, minimo}] }

// ResumirHorasSetorSchema
{ setor_id: number, data_inicio: 'YYYY-MM-DD', data_fim: 'YYYY-MM-DD' }

// CadastrarLoteSchema
{ entidade: enum(7 tabelas), registros: Record<string, any>[] (1-200) }

// ConfigurarHorarioFuncionamentoSchema
{ nivel: 'empresa'|'setor', setor_id?: number, horarios: Record<dia, {abre,fecha}> }

// SalvarPerfilHorarioSchema
{ tipo_contrato_id: number, nome: string, hora_inicio: 'HH:MM', hora_fim: 'HH:MM', ... }
```
