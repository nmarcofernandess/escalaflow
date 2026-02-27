# RAIO-X COMPLETO — EscalaFlow

> Documento de diagnostico do sistema inteiro. Serve como referencia unica para a refatoracao.
> Gerado em 2026-02-26 por mapeamento arquivo-a-arquivo de TODA a codebase.

---

## TL;DR

**141 arquivos TS/TSX** (~39.500 linhas) + **2 arquivos Python** (~2.500 linhas).
**~120 handlers IPC** num monolito de 3.543 linhas (`tipc.ts`).
**33 tools IA** com schemas Zod (docs antigos dizem 34 — `get_context` nunca existiu).
**22+ tabelas** no banco (PGlite Postgres WASM).
**24 problemas de UX confirmados** com evidencia no codigo (eram 16, achamos +8).
**9 bugs confirmados** (3 motor + 4 backend + 1 frontend + 1 IA) — **4 corrigidos no Sprint 1** (BUG 1, 2, 8, 9).
**10 problemas de backend** (duplicatas, bypass de solver, JSON.parse sem catch, timeout 61min) — **3 corrigidos no Sprint 1**.
**5 itens de codigo morto** (store.ts, H3, test-conversa.ts, get_context fantasma).
**Atualizacao 2026-02-27 (Postos v2):**
- IPC atomico de alocacao de posto (`colaboradores.atribuirPosto`) com estrategia `swap|strict`
- IPC de undo (`colaboradores.restaurarPostos`) por snapshot
- UX SetorDetalhe com "Reserva operacional", DnD + autocomplete e troca imediata sem modal

---

## 1. ANATOMIA DO SISTEMA

```
escalaflow/ (141 TS/TSX + 2 Python)
│
├── src/main/               # Electron Main Process (Node.js)
│   ├── index.ts             # Bootstrap, BrowserWindow, auto-updater
│   ├── tipc.ts              # 3543 linhas — MONOLITO de ~120 handlers IPC
│   ├── db/
│   │   ├── pglite.ts        # Singleton PGlite (61 linhas)
│   │   ├── query.ts         # 5 helpers SQL com ? → $N (99 linhas)
│   │   ├── schema.ts        # DDL + 18 migrations (753 linhas)
│   │   └── seed.ts          # Seed: 4 contratos, feriados, 35 regras, knowledge (~700 linhas)
│   ├── motor/
│   │   ├── solver-bridge.ts  # Build input → spawn Python → persist result (~830 linhas)
│   │   ├── validador.ts      # Revalidacao pos-ajuste manual, 13 fases (535 linhas)
│   │   └── validacao-compartilhada.ts # Helpers data/hora, checkers H1-H20, antipatterns (~800 linhas)
│   ├── ia/
│   │   ├── tools.ts          # 33 tools Zod + handlers (950+ linhas)
│   │   ├── system-prompt.ts  # System prompt 9 secoes (~465 linhas)
│   │   ├── cliente.ts        # Vercel AI SDK, stream, compaction (~765 linhas)
│   │   ├── discovery.ts      # Auto-contexto: memorias, RAG, alertas (~494 linhas)
│   │   ├── config.ts         # Model factory reutilizavel (96 linhas)
│   │   └── session-processor.ts # Sanitize, extractMemories, compaction (224 linhas)
│   └── knowledge/
│       ├── embeddings.ts     # ONNX multilingual-e5-base 768d offline (97 linhas)
│       ├── ingest.ts         # Chunk + embed + FTS insert (85 linhas)
│       ├── search.ts         # Hybrid search 70% vector + 30% FTS (349 linhas)
│       └── graph.ts          # LLM entity extraction, seed export/import (373 linhas)
│
├── src/renderer/src/        # React 19 + Vite
│   ├── App.tsx               # Shell: Sidebar + main + IaChatPanel, 16 rotas
│   ├── paginas/ (13)
│   │   ├── EscalaPagina.tsx  # 900+ linhas — geracao, ajuste, oficializacao, export
│   │   ├── SetorDetalhe.tsx  # 700+ linhas — setor, colabs, demanda, funcoes
│   │   ├── ColaboradorDetalhe.tsx # 700+ linhas — regras por colab/dia/data
│   │   ├── ColaboradorLista.tsx   # 823 linhas — lista com filtros multiplos
│   │   ├── EscalasHub.tsx    # 622 linhas — visao consolidada + export batch
│   │   ├── ContratoLista.tsx # 681 linhas — CRUD contratos + perfis
│   │   ├── RegrasPagina.tsx  # 400+ linhas — 35 regras com toggles
│   │   ├── MemoriaPagina.tsx # 400+ linhas — memorias + docs + grafo
│   │   ├── ConfiguracoesPagina.tsx # 400+ linhas — tema + IA + backup + update
│   │   ├── SetorLista.tsx    # 473 linhas
│   │   ├── FeriadosPagina.tsx # 200 linhas
│   │   ├── EmpresaConfig.tsx # 150 linhas
│   │   └── IaPagina.tsx      # 151 linhas — chat fullscreen
│   ├── componentes/ (40+)
│   │   ├── SolverConfigDrawer.tsx  # 299 linhas — DUPLICATA da RegrasPagina
│   │   ├── ExportModal.tsx   # 387 linhas — 15 props, 5 formatos
│   │   ├── ExportarEscala.tsx # 400+ linhas — HTML self-contained
│   │   ├── DemandaEditor.tsx # 700+ linhas — timeline interativo
│   │   ├── EscalaGrid.tsx    # 300+ linhas — grid clicavel
│   │   └── ... (35+ componentes menores)
│   ├── servicos/ (14)        # Wrappers IPC type-safe (padrao consistente)
│   ├── store/iaStore.ts      # Zustand: chat IA com streaming (363 linhas)
│   ├── estado/store.ts       # Zustand: setorAtivoId — MORTO (ninguem le)
│   ├── hooks/ (7)            # useApiData, useExportController, useSetorSelection...
│   └── lib/ (9)              # cores, formatadores, captureHTML, gerarCSV...
│
├── solver/                   # Motor Python OR-Tools CP-SAT
│   ├── solver_ortools.py     # Entry point, multi-pass degradation, serialization
│   └── constraints.py        # 20+ constraints HARD/SOFT/AP
│
└── docs/ (55 arquivos .md)   # Maioria sao warlogs/specs historicos
```

---

## 2. FLUXO PRINCIPAL: GERAR ESCALA (0 ao 100%)

```
[1] Usuario abre SetorDetalhe
    → IPC: setores.buscar, colaboradores.listar, demandas, funcoes, horarios

[2] Clica "Abrir Escala" → navega para /setores/:id/escala (EscalaPagina)
    → Carrega: setor, colaboradores, demandas, contratos, funcoes, horarios, regras

[3] Configura (HOJE - TUDO EXPOSTO):
    → Date pickers (data_inicio, data_fim) — default: proximo mes
    → Dropdown "Cenario de Regimes" por colaborador (regimeOverrides)
    → SolverConfigDrawer: solve_mode, max_time, 35 toggles de regras
    → Botao "Gerar"

[4] Preflight (escalas.preflight)
    → Valida: colabs ativos >= 1, demandas existem, sem bloqueios criticos
    → Calcula capacidade vs demanda (heuristica aritmetica)
    → Se WARNING: modal interrompe fluxo, usuario deve confirmar

[5] buildSolverInput (solver-bridge.ts)
    → 15+ queries DB: colabs, demandas, feriados, excecoes, regras por colab/dia
    → Resolve precedencia de regras: excecao_data > regra_dia > regra_padrao > perfil > setor
    → Warm-start hints da escala anterior
    → Computa scenario hash (SHA-256)
    → Monta JSON completo para o Python

[6] runSolver (solver-bridge.ts → Python stdin/stdout)
    → Spawn: solver_ortools.py (dev) ou solver-bin/escalaflow-solver (prod)
    → JSON via stdin
    → Logs via stdout (interceptados, emitidos via IPC 'solver-log')
    → Timeout: 5 minutos max (bridge), solver interno tem max_time_seconds (30s rapido, 120s otimizado)

[7] Motor Python (solver_ortools.py)
    → build_model(): cria C×D×S BoolVars (ex: 8 colabs × 36 dias × 48 slots = 13.824 vars)
    → Aplica blocked_days (feriados proibidos, excecoes, aprendiz/estagiario)
    → Aplica pinned_cells (trabalho/folga fixados pelo usuario)
    → Aplica constraints HARD: H1, H2, H4, H5, H6, H10-H18, time_window, folga_fixa, folga_variavel
    → Aplica constraints SOFT: deficit demanda, surplus, AP1, domingo_ciclo, turno_pref, consistencia
    → Multi-pass: Pass 1 (50% budget) → se INFEASIBLE → Pass 2 (30%, relaxa H6/H10/DIAS/MIN) → Pass 3 (20%, so CLT skeleton)
    → extract_solution(): serializa alocacoes, indicadores, decisoes, comparacao_demanda, diagnostico

[8] persistirSolverResult (solver-bridge.ts)
    → Transacao: INSERT escalas + alocacoes + escala_decisoes + escala_comparacao_demanda
    → Status: RASCUNHO

[9] Frontend recebe EscalaCompletaV3
    → Renderiza: EscalaGrid (clicavel), KPIs (cobertura, score, violacoes), ViolacoesAgrupadas
    → ResumoFolgas, RuleComplianceBadge, SolverConfigDrawer, ExportModal

[10] Oficializar (escalas.oficializar)
     → Guard: violacoes_hard == 0, hash nao mudou
     → Arquiva escala OFICIAL anterior
     → UPDATE status = OFICIAL

[11] Exportar
     → ExportModal com 5 formatos (HTML completa, por funcionario, batch, batch-geral, CSV)
     → ExportarEscala gera HTML self-contained com CSS inline
     → IPC: export.salvarHTML, export.imprimirPDF, export.salvarCSV
```

---

## 3. BUGS CONFIRMADOS

### ~~BUG 1: Almoco em domingos com setor fechando as 13h (MOTOR)~~ ✅ CORRIGIDO (Sprint 1)

**Arquivo:** `solver/constraints.py`, funcao `add_human_blocks()`
**Causa:** A janela de almoco (11:00-15:00) e calculada GLOBALMENTE a partir do horario geral do setor. O solver nao recebe hora_fechamento POR DIA DA SEMANA. Em domingos (setor fecha 13h), pode atribuir almoco 12:00-14:00 que ultrapassa o fechamento.
**Impacto:** Critico — alocacoes fisicamente impossiveis (funcionario "trabalhando" com setor fechado).
**Fix aplicado (Sprint 1):**
- Bridge (`solver-bridge.ts`) agora le `setor_horario_semana` + `empresa_horario_semana` e monta `horario_por_dia: Record<dia, {abertura, fechamento}>` com cascata setor > empresa > default
- Solver (`solver_ortools.py`) calcula S do MAIOR dia, computa `day_max_slot` por dia da semana, e zera `work[c,d,s]=0` para slots alem do fechamento daquele dia
- Type (`types.ts`) ganhou campo `horario_por_dia?` em `SolverInput.empresa`
- Hash de cenario (`computeSolverScenarioHash`) inclui `horario_por_dia` — mudanca de horario invalida cache
- Validacao TS: safety net ja existia via `janelaOperacional()` no `validador.ts` (le `setor_horario_semana`)

### ~~BUG 2: AP1 (Python) threshold quebrado com grid 15min (MOTOR)~~ ✅ CORRIGIDO (Sprint 1)

**Arquivo:** `solver/constraints.py`, funcao `add_ap1_jornada_excessiva()`
**Causa:** `threshold_slots=16` hardcoded assume grid=30min (16×30=480min=8h). Com grid=15min (producao), 16 slots = 4h. AP1 penaliza QUALQUER jornada acima de 4h em vez de 8h.
**Impacto:** Medio — nao causa bug visivel porque H4 ja limita, mas AP1 esta SEMPRE ativo desnecessariamente, distorcendo o score de pontuacao.
**Fix aplicado (Sprint 1):** `threshold_slots = 480 // grid_min` (8h em qualquer grid). Parametro `grid_min` agora passado pela chamada em `solver_ortools.py`. Guard `if max_excess <= 0: continue` adicionado.
**Nota:** AP1 no Python (jornada excessiva) e AP1 no TS (Clopening, descanso <13h) sao coisas DIFERENTES com o mesmo codigo. Nomes conflitantes.

### BUG 3: Badges F/V do Ciclos V2 nao aparecem (FRONTEND/BRIDGE)

**Arquivo:** `solver-bridge.ts` → `constraints.py` → `EscalaGrid.tsx`
**Causa:** O fluxo completo precisa ser validado end-to-end:
- [x] Bridge envia `folga_variavel_dia_semana` ao Python (fix aplicado)
- [?] Python recebe e usa (`add_folga_variavel_condicional()`)
- [?] Resultado inclui info de ciclo nas alocacoes
- [?] Frontend le e renderiza badges no grid
**Impacto:** Critico — feature principal do Ciclos V2 pode estar invisivel.

### BUG 4: Rascunho some ao navegar (FRONTEND)

**Arquivo:** `EscalaPagina.tsx` linhas 443-448
**Status:** Parcialmente corrigido — `loadRascunho()` busca RASCUNHO do DB ao montar. Usa `simulacao_config_json` parseado via `(detail.escala as any)` — campo nao tipado (tech debt). Precisa validacao end-to-end.

### BUG 5: Ciclo rotativo bypassa solver — escala invalida sem validacao CLT (BACKEND)

**Arquivo:** `tipc.ts`, handler `escalas.gerarPorCicloRotativo`, linhas 2076-2125
**Causa:** Gera alocacoes direto do ciclo modelo com INSERT bruto (TRABALHO/FOLGA). NAO roda solver. NAO valida H1 (repouso semanal), H4 (max 10h/dia), H5 (excecoes/ferias), H10 (meta semanal). Retorna `violacoes_hard: 0` HARDCODED sem verificar nada.
**Impacto:** Critico — escala pode violar CLT e o app mostra como valida. Oficializacao permitida sobre escala ilegal.
**Fix:** Passar ciclo como `pinned_cells` ao solver (respeita CLT) OU rodar `validarEscalaV3()` pos-INSERT.

### BUG 6: `cadastrar_lote` sem transacao — dados parciais orfaos (BACKEND/IA)

**Arquivo:** `tools.ts`, linhas 2433-2561
**Causa:** Loop de INSERT individual com try/catch por registro. Se lote de 200 falha no 150o, registros 1-149 ja estao commitados. Sem BEGIN/COMMIT/ROLLBACK.
**Impacto:** Medio — importacao parcial silenciosa. Leigo pensa "importou 200", mas so 149 foram criados. Dados orfaos no banco.
**Fix:** Envolver loop em transacao PGlite (`db.exec('BEGIN')` ... `db.exec('COMMIT')` com ROLLBACK no catch).

### BUG 7: JSON.parse sem try/catch em 5 locais — crash se dado corrompido (BACKEND)

**Arquivo:** `tipc.ts`, linhas 2459, 2462, 2605, 2606, 2948
**Causa:** `JSON.parse(m.tool_calls_json)` e `JSON.parse(m.anexos_meta_json)` sem try/catch. Se valor no banco for JSON invalido (migration bug, edição manual, corrupção), crash com `SyntaxError` sem fallback.
**Impacto:** Medio — nao e bug HOJE, mas e armadilha. Qualquer corrupção de dado = crash do handler inteiro.
**Fix:** Envolver cada JSON.parse em try/catch com fallback `undefined`.

### ~~BUG 8: Bridge timeout default 3700 segundos (~61 minutos) (BACKEND/UX)~~ ✅ CORRIGIDO (Sprint 1)

**Arquivo:** `solver-bridge.ts`, funcao `runSolver()`
**Causa:** `timeoutMs = 3_700_000` (3.7M ms = ~61 minutos). Se solver Python travar (bug, loop infinito), bridge espera 1 HORA antes de matar o processo. Usuario acha que app travou.
**Impacto:** Medio-alto — UX horrivel. Solver tipico roda em <30s. Timeout deveria ser 5 minutos max.
**Fix aplicado (Sprint 1):** Default reduzido para `300_000` (5 min). Solver interno ja tem timeout proprio (`max_time_seconds`).

### ~~BUG 9: `escalasGerar` retorna violacoes vazias — validacao NUNCA roda pos-geracao (BACKEND — CRITICO)~~ ✅ CORRIGIDO (Sprint 1)

**Arquivo:** `tipc.ts`, handlers `escalas.gerar` e `escalas.ajustar`
**Causa:** Ambos handlers retornavam `violacoes: []` e `antipatterns: []` HARDCODED. NAO chamavam `validarEscalaV3()` apos `persistirSolverResult()`. A funcao que REALMENTE valida H1-H20 e antipatterns so rodava em `escalasBuscar` (reload) e `escalasOficializar`.
**Impacto:** CRITICO — usuario via "Infracoes CLT: 0" verde mesmo se o motor produziu alocacoes invalidas. Mascarou BUG 1 por meses.
**Fix aplicado (Sprint 1):**
- `escalasGerar`: bloco inline de ~50 linhas de INSERT substituido por `persistirSolverResult()` + `validarEscalaV3(escalaId)`. Return agora usa `...validacao` (violacoes REAIS)
- `escalasAjustar`: return substituido por `validarEscalaV3(escalaId)`. Bloco de UPDATE inline mantido (diferente do INSERT do gerar)
- `persistirSolverResult` agora importado explicitamente em tipc.ts

---

## 4. CODIGO MORTO E REDUNDANCIAS

### Codigo morto

| O que | Onde | Por que |
|-------|------|---------|
| `estado/store.ts` (setorAtivoId) | Frontend | Nenhum componente le ou importa este store. Toda navegacao usa `useParams` |
| `add_h3_rodizio_domingo()` | constraints.py:551-580 | Funcao existe mas NUNCA e importada/chamada. Substituida por `add_domingo_ciclo_soft` |
| `add_h19_folga_comp_domingo()` | constraints.py:752-763 | Funcao e `pass` (no-op). Delegada ao H1. Chamada pelo solver mas nao emite nada |
| `test-conversa.ts` | Raiz do projeto | Arquivo teste orfao com schema mock obsoleto (ainda referencia `trabalha_domingo`). Ninguem importa |
| `get_context` (tool fantasma) | Docs antigos | NUNCA existiu como tool. Docs antigos referenciam, mas tools.ts nunca teve. Explica a contagem errada "34 tools" — real e 33 |

### Duplicatas

| O que | Onde (1) | Onde (2) | Risco |
|-------|----------|----------|-------|
| `listDays/dayLabel/minutesBetween` | tipc.ts (topo) | tools.ts (com sufixo `ForTool`) | Bug corrigido em 1 lugar nao propaga |
| `enrichPreflightWithCapacityChecks` | tipc.ts | tools.ts (`ForTool`) | Idem |
| `escalasAjustar` inline INSERT loop | tipc.ts | `persistirSolverResult()` ja existe | Alteracao em persist nao reflete em ajustar |
| Model factory inline | knowledge.gerarMetadataIa (tipc.ts) | `ia/config.ts` (`buildModelFactory`) | Re-implementacao de 50+ linhas |
| Bloqueio de aprendiz domingo | blocked_days pre-proc (3 lugares) | `add_h11_aprendiz_domingo` (constraint) | Tripla redundancia inofensiva |
| H5 excecoes | blocked_days pre-proc | `add_h5_excecoes` (constraint) | Dupla redundancia inofensiva |
| H17/H18 feriados proibidos | blocked_days pre-proc | `add_h17_h18_feriado_proibido` | Dupla redundancia inofensiva |
| Regras por geracao vs empresa | SolverConfigDrawer (299 linhas) | RegrasPagina (400+ linhas) | Confusao conceitual pro usuario |
| ~~`escalasGerar` inline INSERT loop~~ | ~~tipc.ts~~ | ~~`persistirSolverResult()` ja existe~~ | ✅ Eliminado Sprint 1 — agora usa `persistirSolverResult()` |

---

## 5. HALL DA VERGONHA — 24 PROBLEMAS CONFIRMADOS

### 1. REGIME DE ESCALA EM 3 LUGARES
- `EscalaPagina.tsx:145` — `regimeOverrides` dropdown POR COLABORADOR
- `ContratoLista.tsx:63` — campo `regime_escala` no contrato
- `SolverConfigDrawer.tsx` — bulkChange de regime por tipo CLT
- **Realidade:** Deveria ser config do SETOR, ponto.

### 2. CONTRATOS PEDINDO HORAS QUANDO NOME JA DIZ
- `ContratoLista.tsx:472-543` — campo `horas_semanais` editavel mesmo pra "CLT 44h"
- **Realidade:** 44h e 44. Autocomplete + readonly quando nome contem horas.

### 3. CHIPS DE REGRAS NAO-CLICAVEIS
- `RuleComplianceBadge.tsx` — badges "CLT 12/12", "SOFT 5/7" sem acao
- **Realidade:** Ruido visual. "CLT 12/12" nao significa nada pro pai do Marco.

### 4. AVISOS ESPALHADOS SEM LUGAR DEDICADO
- `ViolacoesAgrupadas.tsx` renderizado na view PRINCIPAL da escala
- **Realidade:** Deveria estar numa tab "Resumo". View principal = LIMPA.

### 5. KPIs COMPLEXAS PARA LEIGOS
- `IndicatorCard` com Cobertura %, Infracoes CLT, Antipadroes, Equidade %
- `PontuacaoBadge` com "Score 87"
- **Realidade:** Ninguem entende. Na view principal: "Gerada com sucesso" ou "2 avisos".

### 6. EXCECOES DE DEMANDA POR DATA
- `SetorDetalhe.tsx` — card inteiro dedicado a `demandas_excecao_data`
- **Realidade:** Ninguem usa. Se precisar, a IA configura via chat.

### 7. INTERFACE DO MOTOR COMPLEXA
- `EscalaPagina.tsx:123-156` — date pickers manuais (default: 1 mes, nao 3)
- SolverConfigDrawer com 35 toggles + solve_mode + max_time
- Preflight com modal bloqueante
- Solver logs visiveis por default em collapsible Terminal
- **Realidade:** Default 3 meses, botao "Gerar", sem drawer, logs hidden.

### 8. ESCALA DEVERIA ESTAR NA 1a PAGINA DO SETOR
- Fluxo atual: SetorDetalhe → clica "Abrir Escala" → navega → configura → gera
- **Realidade:** Botao "Gerar Escala" direto no SetorDetalhe.

### 9. PREVIEW = GRID INTERATIVO (NAO RESUMO)
- `EscalaGrid.tsx` e a primeira coisa que aparece — grid completo clicavel
- **Realidade:** Primeiro: resumo compacto. Depois: view completa.

### 10. EXPORTAR SEPARADO DO RESULTADO
- `ExportModal` e botao separado com modal intermediario
- **Realidade:** Dentro da view de resultado, botao "Exportar" direto.

### 11. OPCOES DE EXPORTACAO INUTEIS
- `ExportModal.tsx:124-144` — toggles "Incluir avisos" e "Incluir horas (Real vs Meta)"
- **Realidade:** Remover. So toggle "Incluir calendario visual".

### 12. POSTOS DENTRO DA CELULA (NAO COMO COLUNA)
- `EscalaGrid.tsx` e `ExportarEscala.tsx` — posto escrito dentro de cada celula
- **Realidade:** Postos como COLUNA. Nome do funcionario na frente.

### 13. PLANEJADO x EXECUTADO INCOMPREENSIVEL
- Cards de horas e comparacao de demanda na view principal
- **Realidade:** Faz parte do Resumo, NAO da view principal.

### 14. REGRAS DA EMPRESA vs CONFIG DO MOTOR
- `RegrasPagina.tsx` (400+ linhas) duplica `SolverConfigDrawer.tsx` (299 linhas)
- **Realidade:** Config e do SETOR. Regras sao do MOTOR. IA ajusta. Usuario nao edita.

### 15. CONFIG DE ESCALA ESPALHADA
- Date pickers + regimeOverrides dropdown + SolverConfigDrawer + preflight modal
- **Realidade:** Um unico card "Configurar" simples e compacto.

### 16. DISCOVERY DESIGN PESSIMO
- Sidebar expoe "Regras" e "Memoria" para leigos
- Configuracoes avancadas acessiveis sem esconder
- **Realidade:** 5 passos: setor → gerar → ver → oficializar → exportar.

### 17. DEFAULT `sexo: 'M'` HARDCODED
- `tools.ts:1097` — `if (!dados.sexo) dados.sexo = 'M'` na funcao `applyColaboradorDefaults()`
- `ColaboradorDetalhe.tsx:183` — form defaultValues tem `sexo: 'M'`
- **Realidade:** Sexismo implementado. IA cria lote de 20 colaboradores, todos viram masculino. Campo deveria ser OBRIGATORIO, nao ter default.

### 18. CONFIG IA EXPOSTA PRO LEIGO (API KEY, PROVIDER, MODELO)
- `ConfiguracoesPagina.tsx:214-350` — card "Inteligencia Artificial" com:
  - Dropdown de provider (Gemini / OpenRouter)
  - Input de API Key (dado sensivel)
  - Dropdown de modelo (20+ opcoes tecnicas)
  - Botao "Testar IA"
- **Realidade:** RH de supermercado NAO precisa saber o que e "Gemini 3 Flash Preview". Leigo muda provider sem querer, queima API key, IA para de funcionar. Deveria ser config de `.env` ou pagina "Dev Only".

### 19. SIDEBAR COM ITENS PERIGOSOS PARA LEIGO
- `AppSidebar.tsx:62-67` — grupo "Configuracao" tem:
  - "Tipos de Contrato" — leigo pode deletar "CLT 44h" e quebrar motor
  - "Regras" — leigo pode desligar H1 (repouso semanal) e violar CLT
  - "Memoria" — knowledge graph, docs, features de dev
- **Realidade:** Um clique inocente quebra o sistema. Esses itens deveriam ter lock visual ou estar escondidos.

### 20. COLABORADOR DETALHE E UM MONSTRO DE 1311 LINHAS
- `ColaboradorDetalhe.tsx` — 1311 linhas (nao 700 como estimado antes). Conteudo:
  - Card "Informacoes Pessoais" (70 linhas)
  - Card "Contrato" (180 linhas)
  - Card "Preferencias" com **7 DROPDOWNS** em grid 2x2
  - Card "Regras de Horario" Secao A: perfil, restricao, ciclo domingo, folga fixa, folga variavel, turno
  - Card "Regras de Horario" Secao B: **7 SWITCHES** (um por dia da semana) + input time cada
  - Card "Regras por Dia da Semana" — REPETE a complexidade da Secao B
  - Card "Excecoes" + 2 AlertDialogs
- **Realidade:** Leigo abre esta pagina e fecha o app. Zero tooltips, zero help. Precisa split em 2-3 paginas ou tabs.

### 21. DASHBOARD — PASSIVO POR DESIGN, MAS COM `violacoes_pendentes` HARDCODED
- `Dashboard.tsx` JA tem: card de setores com StatusBadge (SEM_ESCALA/RASCUNHO/OFICIAL), alertas, botao "Ver Escala"
- **Decisao:** Dashboard DEVE ser passivo. NAO complicar com acoes/CTAs/modais. Porem:
  - `tipc.ts:1368` — `violacoes_pendentes: 0` e HARDCODED. Nunca calcula real. Badge de alertas no Dashboard NUNCA aparece.
  - `dashboardResumo` (tipc.ts:1330-1390) NAO checa `input_hash` pra detectar escala desatualizada.
  - `discovery.ts:378-390` JA detecta `ESCALA_DESATUALIZADA` via hash comparado — mas so pra IA.
  - `escalasOficializar` (tipc.ts:1017-1030) JA bloqueia oficializacao se hash mudou.
- **FIX:** Card do setor no Dashboard deveria mostrar badge "Escala desatualizada" quando `input_hash` difere. Sem modal, sem explicacao. So a badge. Mesmo mecanismo que a IA ja usa (discovery) e que oficializar ja bloqueia.

### 22. MEMORIA PAGINA — FEATURE DE DEV NO FLUXO DO LEIGO
- `MemoriaPagina.tsx` — 827 linhas, 3 tabs (Memorias, Documentos, Relacoes)
- Tab "Documentos" — importar PDFs/TXTs (util pra quem?)
- Tab "Relacoes" — grafo visual de knowledge graph (dev tool puro)
- **Realidade:** Leigo nao precisa importar docs de CLT nem visualizar grafo de entidades. Se necessario, esconder atras de flag avancado.

### 23. HISTORICO IA TRUNCADO EM 320 CHARS — IA PERDE CONTEXTO
- `cliente.ts:32` — `TOOL_RESULT_LEGACY_MAX_CHARS = 320`
- `cliente.ts:126` — `truncateText(msg.conteudo, TOOL_RESULT_LEGACY_MAX_CHARS)`
- **Realidade:** Tool results no historico sao cortados em 320 chars. Se IA consultou 50 colaboradores, so ve os primeiros 320 chars na proxima mensagem. Perde contexto, repete consultas, fica burra.

### 24. ZERO DIRTY STATE / "SAIR SEM SALVAR" — DADOS SOMEM SILENCIOSAMENTE
- **Investigado:** Grep completo por `beforeunload`, `useBlocker`, `usePrompt`, `NavigationBlocker`, `onbeforeunload`, `dirty`, `unsaved`, `pendingChanges` — ZERO resultados em toda a codebase.
- **Impacto:** Qualquer formulario (ColaboradorDetalhe com 1311 linhas de inputs, SetorDetalhe, EmpresaConfig, regras de horario por dia) pode perder TUDO se o usuario navega pra outro lugar sem salvar. Nao tem aviso. Nao tem modal. Nao tem nada.
- **Conexao com #21:** O MESMO mecanismo de dirty tracking que resolveria "sair sem salvar" pode alimentar o badge "Escala desatualizada" no Dashboard. Dirty = algo mudou que afeta a escala vigente. Se hash do input difere do hash da escala, esta sujo.
- **Fluxo proposto (dirty unificado):**
  1. Qualquer mudanca em colab/demanda/regra/excecao → marca setor como dirty (hash difere)
  2. Dashboard → badge "Escala desatualizada" no card do setor (passivo, sem modal)
  3. Formularios → `useBlocker` do React Router v7 impede navegacao se form tem alteracoes nao salvas
  4. Oficializar → JA bloqueia via hash (existente, funciona)
- **Prioridade:** ALTA — perder dados preenchidos e uma das piores experiencias possiveis pro leigo.

---

## 6. TABELAS DO BANCO (22+)

### Operacionais (core)

| Tabela | Proposito | Observacao |
|--------|-----------|------------|
| `empresa` | Singleton config global (tolerancias, grid) | 1 registro |
| `tipos_contrato` | Templates: CLT 44h, 36h, Estagiario, Intermitente | 4 seed |
| `contrato_perfis_horario` | Janelas horarias por contrato (ex: MANHA_08_12) | |
| `setores` | Departamentos do supermercado | soft delete |
| `colaboradores` | Funcionarios (setor + contrato) | soft delete |
| `funcoes` | Postos de trabalho com cor_hex | soft delete |
| `demandas` | Cobertura minima por slot/dia_semana | |
| `demandas_excecao_data` | Override de demanda por data (Black Friday) | Raramente usado |
| `excecoes` | Ferias, atestado, bloqueio | |
| `feriados` | Feriados com `proibido_trabalhar` (CCT) | |
| `escalas` | RASCUNHO → OFICIAL → ARQUIVADA + indicadores + hash | |
| `alocacoes` | Um dia de trabalho/folga de uma pessoa | |
| `escala_decisoes` | Explicabilidade (por que cada decisao) | Cresce sem limpeza |
| `escala_comparacao_demanda` | Planejado vs executado por slot | Cresce sem limpeza |

### Regras e horarios

| Tabela | Proposito |
|--------|-----------|
| `empresa_horario_semana` | Horario funcionamento empresa por dia |
| `setor_horario_semana` | Override horario por setor/dia |
| `colaborador_regra_horario` | Regras individuais (janela, folga fixa, ciclo) |
| `colaborador_regra_horario_excecao_data` | Override pontual por data |
| `regra_definicao` | Catalogo 35 regras (16 CLT, 7 SOFT, 12 AP) |
| `regra_empresa` | Overrides de status por empresa |
| `escala_ciclo_modelos` | Modelos de ciclo rotativo |
| `escala_ciclo_itens` | Itens do ciclo |

### IA e Knowledge

| Tabela | Proposito |
|--------|-----------|
| `configuracao_ia` | Provider, API key, modelo |
| `ia_conversas` | Historico de conversas (status, resumo_compactado) |
| `ia_mensagens` | Mensagens (role, content, tool_calls_json TEXT) |
| `ia_memorias` | Memorias curtas RH (max 50, origem manual/auto, embedding 768d) |
| `knowledge_sources` | Documentos importados (titulo, conteudo, tipo, importance) |
| `knowledge_chunks` | Chunks com embedding vector(768) + FTS tsvector portugues |
| `knowledge_entities` | Entidades extraidas (nome, tipo, origem sistema/usuario) |
| `knowledge_relations` | Relacoes entre entidades (from, to, tipo, peso) |

---

## 7. HANDLERS IPC (~120 HANDLERS)

### Por dominio

| Dominio | Handlers | Arquivo destino sugerido |
|---------|----------|--------------------------|
| Empresa | 4 | tipc/empresa.ts |
| Tipos Contrato | 9 | tipc/contratos.ts |
| Setores | 16 (incl demandas, horarios, timeline) | tipc/setores.ts |
| Funcoes | 5 | tipc/funcoes.ts |
| Feriados | 3 | tipc/feriados.ts |
| Colaboradores | 12 (incl regras horario) | tipc/colaboradores.ts |
| Excecoes | 5 | tipc/excecoes.ts |
| Escalas | 12 (gerar, ajustar, oficializar, ciclo) | tipc/escalas.ts |
| Dashboard | 1 | tipc/dashboard.ts |
| Export | 4 | tipc/export.ts |
| Regras | 4 | tipc/regras.ts |
| IA Config | 4 | tipc/ia-config.ts |
| IA Chat | 4 | tipc/ia-chat.ts |
| IA Conversas/Mensagens | 13 | tipc/ia-conversas.ts |
| IA Session/Memorias | 6 | tipc/ia-memorias.ts |
| Knowledge | 15 | tipc/knowledge.ts |
| Backup | 2 | tipc/backup.ts |
| **TOTAL** | **~120** | |

---

## 8. TOOLS IA (33)

### Por categoria

| Categoria | Tools | Resumo |
|-----------|-------|--------|
| **Descoberta** | `consultar`, `buscar_colaborador`, `listar_perfis_horario`, `obter_alertas` | Leitura e exploração do banco |
| **CRUD Generico** | `criar`, `atualizar`, `deletar`, `cadastrar_lote` | Operações em qualquer entidade (com whitelist) |
| **Escalas** | `gerar_escala`, `ajustar_alocacao`, `ajustar_horario`, `oficializar_escala` | Ciclo completo de escala |
| **Validacao** | `preflight`, `preflight_completo`, `diagnosticar_escala`, `diagnosticar_infeasible`, `explicar_violacao` | Diagnostico e troubleshooting |
| **Regras** | `editar_regra`, `salvar_regra_horario_colaborador`, `upsert_regra_excecao_data`, `resetar_regras_empresa` | Configuracao de regras |
| **Config** | `configurar_horario_funcionamento`, `salvar_perfil_horario`, `deletar_perfil_horario` | Horarios e perfis |
| **KPI** | `resumir_horas_setor` | Agregacao de horas |
| **Demanda** | `salvar_demanda_excecao_data` | Override pontual |
| **Knowledge** | `buscar_conhecimento`, `salvar_conhecimento`, `listar_conhecimento`, `explorar_relacoes` | RAG e grafo |
| **Memorias** | `salvar_memoria`, `listar_memorias`, `remover_memoria` | Memoria curta do RH |

### Patterns usados

- Response 3-status: `toolOk()`, `toolError(msg, correction)`, `toolTruncated(data, total)`
- Zod `.describe()` em TODOS os campos de TODOS os 33 schemas
- Runtime validation via `safeParse` + mensagem de correcao
- FK enrichment: setor_id → setor_nome, tipo_contrato_id → tipo_contrato_nome
- Navigation metadata: `_meta.ids_usaveis_em`, `_meta.next_tools_hint`
- Whitelists de seguranca: ENTIDADES_LEITURA/CRIACAO/ATUALIZACAO/DELECAO_PERMITIDAS
- CAMPOS_VALIDOS: map entidade → Set de campos (SQL injection protection)
- CONSULTAR_MODEL_ROW_LIMIT = 50 com status 'truncated'

---

## 9. MOTOR PYTHON — CONSTRAINTS (20+)

### Constraints HARD (sempre ativas ou condicionais)

| Codigo | Nome | Tipo | Relaxavel? | Observacao |
|--------|------|------|-----------|------------|
| H1 | Max 6 dias consecutivos | HARD | Sim (Pass 3→SOFT) | Janela deslizante 7 dias |
| H2 | Interjornada 11h | HARD | NUNCA | Inativo na pratica (janela 08-20h = 12h min) |
| H4 | Max jornada diaria | HARD | NUNCA | max_minutos_dia por contrato |
| H5 | Excecoes (ferias/atestado) | HARD | NUNCA | Redundante com blocked_days |
| H6 | Blocos humanos (almoco) | HARD | Sim (Pass 2→SOFT) | ~~BUG: nao respeita fechamento por dia~~ ✅ per-day closing (Sprint 1) |
| H10 | Meta semanal | HARD | Sim (Pass 2→ELASTIC) | ±30min tolerancia. Intermitente pula |
| H11 | Aprendiz domingo | HARD | NUNCA | Triplicado com pre-processamento |
| H12 | Aprendiz feriado | HARD | NUNCA | |
| H13 | Aprendiz noturno | HARD | NUNCA | Inativo (janela 08-20h) |
| H14 | Aprendiz hora extra | HARD | NUNCA | Zero tolerancia vs H10 |
| H15 | Estagiario jornada | HARD | NUNCA | Max 6h/dia e 30h/semana |
| H16 | Estagiario hora extra | HARD | NUNCA | |
| H17/H18 | Feriados proibidos | HARD | NUNCA | So 25/12 e 01/01 (CCT) |
| H19 | Folga comp domingo | NO-OP | N/A | Funcao e `pass`. Delegada ao H1 |
| DIAS_TRABALHO | Dias/semana corretos | HARD | Sim (Pass 2→SOFT) | 5X2→5, 6X1→6 |
| MIN_DIARIO | Min 4h por dia | HARD | Sim (Pass 2→SOFT) | 240 minutos |
| — | Time window hard | HARD | Sim (Pass 3→skip) | Janela por colab/dia |
| — | Folga fixa 5X2 | HARD | Sim (Pass 3→skip) | Folga em dia fixo |
| — | Folga variavel XOR | HARD | Sim (Pass 3→skip) | XOR domingo + dia_var |

### Constraints SOFT (objetivo de otimizacao)

| Codigo | Nome | Peso | Observacao |
|--------|------|------|------------|
| S_DEFICIT | Deficit de cobertura | 10000 (40000 override) | Core — redistribui capacidade |
| S_SURPLUS | Super-cobertura | 5000 | Evita empilhamento |
| S_AP1_EXCESS | Jornada > 8h | 250 | ~~BUG: threshold 4h com grid 15min~~ ✅ Corrigido Sprint 1 |
| S_DOMINGO_CICLO | Ciclo de domingos | 3000 | N trabalha + M folga |
| S_TURNO_PREF | Preferencia de turno | 2000 | MANHA ou TARDE |
| S_CONSISTENCIA | Consistencia horario | 1000 | Penaliza variacao de entrada |
| — | Spread (equidade) | 800 | Equilibra horas entre colabs |

### Notas sobre constraints

**H7 (intervalo_15min):** Implementado como FLAG somente. Solver marca `intervalo_15min=true` para jornadas >4h e <=6h, mas NAO POSICIONA quando o intervalo acontece. Funcao `checkH7_IntervaloCurto()` em `validacao-compartilhada.ts:554-569` so valida que a flag existe. **Melhoria futura:** Posicionar o intervalo de 15min com restricoes: pelo menos 2h antes de sair + 3h apos chegar. Somente pra jornadas >=6h. NAO como substituicao de pessoa (so pausa).

**AP1 (conflito de nomes):** O codigo "AP1" significa coisas DIFERENTES no Python e no TS:
- Python `add_ap1_jornada_excessiva()` → penaliza jornada >8h (✅ corrigido Sprint 1 — antes bugava com grid 15min)
- TS `checkAP1_Clopening()` → penaliza descanso <13h entre turnos consecutivos (Clopening)
- Sao constraints DIFERENTES usando o mesmo identificador. Confusao garantida na manutencao.

### Multi-pass degradation

```
Pass 1 (50% budget) — regras como configuradas
  INFEASIBLE? →
Pass 2 (30% budget) — relaxa: H10→elastic, H6→soft, DIAS_TRABALHO→soft, MIN_DIARIO→soft
  INFEASIBLE? →
Pass 3 (20% budget) — modo emergencia: so H2+H4+H5 (skeleton CLT)
  INFEASIBLE? → erro final "cenario genuinamente impossivel"
```

---

## 10. HIERARQUIA DE PRECEDENCIA DE HORARIOS

O solver-bridge resolve a janela de horario de cada colaborador em cada dia com esta cascata:

```
1. colaborador_regra_horario_excecao_data (override pontual por data)
   ↓ se nao tem
2. colaborador_regra_horario WHERE dia_semana_regra = dia (regra por dia da semana)
   ↓ se nao tem
3. colaborador_regra_horario WHERE dia_semana_regra IS NULL (regra padrao)
   ↓ se nao tem
4. contrato_perfis_horario (janela do perfil do contrato)
   ↓ se nao tem
5. setor_horario_semana (horario do setor naquele dia)
   ↓ se nao tem
6. empresa.hora_abertura / hora_fechamento (defaults globais)
```

**Campos resolvidos por dia:** `inicio_min`, `inicio_max`, `fim_min`, `fim_max`, `preferencia_turno_soft`, `folga_fixa`, `domingo_forcar_folga`

---

## 11. PROBLEMAS DE BACKEND

### Criticos

1. **4 funcoes helper duplicadas** entre `tipc.ts` e `tools.ts` (listDays, dayLabel, minutesBetween, enrichPreflight). Bug corrigido em 1 nao propaga pro outro.

2. ~~**`escalasAjustar` E `escalasGerar` nao usam `persistirSolverResult()`**~~ ✅ **Parcialmente corrigido (Sprint 1):** `escalasGerar` agora usa `persistirSolverResult()`. `escalasAjustar` ainda tem INSERT inline (faz UPDATE, nao INSERT, por isso nao pode usar a mesma funcao diretamente).

3. **`knowledge.rebuildAndExportSistema`** (tipc.ts:3322-3351) escreve em disco (`fs.writeFileSync`) sem guard de `NODE_ENV`. Em producao, `process.cwd()` nao e o repo — escreve em lugar aleatorio. Rota IPC exposta ao renderer. Defesa atual e so por UI (botao visivel so em dev), nao por backend.

4. **`escalas.gerarPorCicloRotativo`** (tipc.ts:2076-2125) bypassa solver. INSERT bruto TRABALHO/FOLGA sem validar H1, H4, H5, H10. Retorna `violacoes_hard: 0` HARDCODED. Escala ilegal pode ser oficializada. (Ver BUG 5)

5. **JSON.parse sem try/catch em 5 locais** (tipc.ts:2459, 2462, 2605, 2606, 2948). Crash com SyntaxError se dado corrompido. (Ver BUG 7)

### Medio

6. **`knowledge.gerarMetadataIa`** reimplementa 50+ linhas de model factory inline em vez de usar `buildModelFactory()` de `ia/config.ts`.

7. **`ia.modelos.catalogo`** (tipc.ts:2209-2225) tem lista Gemini HARDCODED (5 modelos). Quando Google lancar modelo novo, lista fica desatualizada. OpenRouter tem fetch real; Gemini nao.

8. **`ia_mensagens.tool_calls_json`** e TEXT serializado manualmente. PGlite suporta JSONB nativo — seria mais seguro e queryable.

9. **Warm-start hints incluem escalas ARQUIVADAS** (solver-bridge.ts:410-442). Query nao filtra `status != 'ARQUIVADA'`. Hints de escala antiga podem piorar convergencia.

10. ~~**Bridge timeout default 3700s**~~ ✅ Corrigido Sprint 1 — agora 300s (5 min).

### OK (investigados e limpos)

- **`escala_decisoes` e `escala_comparacao_demanda`** — tem `ON DELETE CASCADE` na FK pra escalas. Sem lixo.
- **`computeSolverScenarioHash`** — deterministico. Arrays sorted, campos explicitos, SHA-256. Funciona.
- **Migrations** — todas idempotentes (IF NOT EXISTS, addColumnIfMissing). v17 e a ultima.
- **Seed** — sincronizado com schema. Sem `trabalha_domingo`, sem `piso_operacional`. 4 contratos corretos.
- **Error handling no spawn** — mensagens descritivas, fallbacks de path. OK.
- **Exportacoes solver-bridge.ts** — todas as 5 funcoes sao consumidas. Zero morto.

---

## 12. FLUXO IDEAL POS-REFATORACAO

```
[1] Abre app → Dashboard com setores
[2] Clica no setor → SetorDetalhe com equipe + botao "Gerar Escala"
[3] Clica "Gerar Escala" → sistema gera (3 meses, defaults inteligentes, zero config)
[4] Ve resumo rapido → "Escala gerada! 0 problemas." ou "2 avisos (ver resumo)"
[5] Clica "Ver Escala" → escala completa, decente, igual exportacao
[6] Clica "Exportar" → salva/imprime direto
[7] Se quiser detalhes → tab "Resumo" com avisos, metricas, comparacao
[8] Se quiser ajustar → chat IA ou edita inline

Total de cliques: 3 (setor → gerar → ver)
Hoje: ~8-10 cliques (configs, modais, warnings, tabs)
```

### Dirty state e protecao de dados

```
Mudou colab/demanda/regra/excecao?
  → Setor marcado dirty (hash difere da escala vigente)
  → Dashboard: badge "Escala desatualizada" (passivo, sem modal, sem explicacao)
  → Oficializar: JA bloqueia (existente)
  → Formularios: useBlocker impede navegacao sem salvar
```

---

## 13. DOCS EXISTENTES — O QUE MANTER vs DESCARTAR

### Manter (referencia util)

| Doc | Por que |
|-----|---------|
| `MOTOR_V3_RFC.md` | RFC canonico das 20 regras — referencia formal |
| `COMO_FAZER_RELEASE.md` | Guia pratico de release — operacional |
| `BUILD_CICLOS_V2.md` | Logica de ciclos (folga condicional, badges) — recente e relevante |
| `flowai/COMO_O_SISTEMA_FUNCIONA.md` | Visao geral do sistema de IA — util |

### Descartar ou arquivar (historico, desatualizado, ou substituido por este doc)

| Doc | Motivo |
|-----|--------|
| `ANALYST_*.md` (5 arquivos) | Analises pontuais ja absorvidas |
| `WARLOG_*.md` (2 arquivos) | Warlogs historicos resolvidos |
| `BUILD_V2_ESCALAFLOW.md` | Arquitetura v2 — substituida por esta |
| `BUILD_UX_ESCALAS_HUB_v2.md` | UX historica |
| `MOTOR_V3_*.md` (6 arquivos alem do RFC) | Specs, builds, analises do motor — ja implementados |
| `MIGRATION_PGLITE_INTELLIGENCE_LAYER.md` | Migracao concluida |
| `PLANTUML_CORRECTIONS_2026-02-16.md` | Correcoes pontuais |
| `PRD-ia-e-configuracoes-v1.md` | PRD antigo |
| `PRD_MOTOR_PYTHON_REGRAS_COLABORADOR_GRID15.md` | PRD implementado |
| `PROMPT_PATCH_RFC_V31_PRAGMATICO.md` | Patch historico |
| `RESEARCH_CLT_CCT_MOTOR_V3.md` | Pesquisa concluida |
| `SPEC-04-historico-chat-ia.md` | Spec implementada |
| `SPEC-05-capacidades-ia.md` | Spec implementada |
| `SPEC-V0-MODEL-PICKER.md` | Spec implementada |
| `IA_*.md` (3 arquivos) | Issues e triagem historicos |
| `flowai/*.md` (maioria) | Plans, status, playbooks historicos |
| `flowia/*.md` | Cadastro em massa — pontual |
| `legacy/*.md` | Legado explicito |

### Criar (documentacao que FALTA)

| Doc sugerido | Proposito |
|--------------|-----------|
| `docs/RAIO_X_SISTEMA.md` | **ESTE DOCUMENTO** — mapa completo do sistema |
| `docs/COMO_GERAR_ESCALA.md` | Fluxo de geracao explicado passo-a-passo (para contexto IA) |
| `docs/REGRAS_MOTOR.md` | Lista de todas as constraints com codigo, tipo, status, o que faz |
| `docs/TOOLS_IA.md` | Catalogo das 33 tools: nome, input, output, quando usar |

---

## 14. SERVICOS IPC FRONTEND (14 wrappers)

Todos seguem o mesmo padrao. ZERO inconsistencia. Snake_case ponta a ponta.

| Servico | Endpoints | Responsabilidade |
|---------|-----------|-----------------|
| `client.ts` | — | Factory tipc type-safe |
| `setores.ts` | 14 | CRUD + demandas + horarios + timeline |
| `colaboradores.ts` | 10 | CRUD + regras horario |
| `escalas.ts` | 8 | Gerar/ajustar/oficializar/historico |
| `tipos-contrato.ts` | 7 | CRUD contratos + perfis |
| `funcoes.ts` | ~4 | CRUD postos |
| `excecoes.ts` | ~4 | CRUD ferias/atestado |
| `empresa.ts` | ~5 | CRUD empresa + horarios |
| `feriados.ts` | ~4 | CRUD feriados |
| `regras.ts` | ~3 | Listar/atualizar/resetar |
| `exportar.ts` | 4 | HTML/PDF/CSV/batch |
| `memorias.ts` | ~4 | CRUD ia_memorias |
| `conhecimento.ts` | ~6 | CRUD knowledge + graph |

---

## 15. COMPONENTES FRONTEND — INVENTARIO RAPIDO

### Criticos (afetam fluxo principal)

| Componente | Linhas | Status | Problema |
|------------|--------|--------|----------|
| `ColaboradorDetalhe.tsx` | **1311** | 🔴 | Monstro: 7 dropdowns + 7 switches + 2 dialogs. Leigo fecha o app |
| `EscalaGrid.tsx` | 300+ | 🟡 | Postos na celula, nao como coluna |
| `SolverConfigDrawer.tsx` | 299 | 🔴 | Duplicata da RegrasPagina |
| `ExportModal.tsx` | 387 | 🔴 | 15 props, opcoes inuteis |
| `ExportarEscala.tsx` | 400+ | 🟡 | Dual-use OK, mas postos na celula |
| `DemandaEditor.tsx` | 700+ | 🟡 | Complexidade justificada |
| `RuleComplianceBadge.tsx` | 78 | 🔴 | Chips nao clicaveis, ruido |
| `PontuacaoBadge.tsx` | 23 | 🔴 | "Score 87" nao faz sentido pra leigo |
| `ViolacoesAgrupadas.tsx` | 145 | 🟡 | Bem feito, mal posicionado |
| `ResumoFolgas.tsx` | 79 | 🟡 | Util, posicao OK |

### OK (nao precisam de refatoracao)

| Componente | Status |
|------------|--------|
| `AppSidebar.tsx` | 🔴 Sidebar expoe Contratos/Regras/Memoria pra leigo |
| `ConfiguracoesPagina.tsx` | 🔴 API key e provider IA expostos pro leigo |
| `Dashboard.tsx` | 🟡 Passivo por design (OK), mas violacoes_pendentes HARDCODED + sem hash check |
| `MemoriaPagina.tsx` | 🟡 Knowledge graph e import docs = feature de dev |
| `PageHeader.tsx` | 🟡 Funcional |
| `StatusBadge.tsx` | 🟢 Perfeito |
| `BulkActionBar.tsx` | 🟢 Bem feito |
| `EscalaViewToggle.tsx` | 🟢 Simples |
| `EmptyState.tsx` | 🟢 Padrao |
| `ErrorBoundary.tsx` | 🟢 Necessario |
| `IconPicker.tsx` | 🟢 Funcional |
| Componentes IA (10) | 🟢 Bem estruturados |
| `GraphVisualizer.tsx` | 🟡 Util pra dev, questionavel pra usuario final |
| Tour (2) | 🟢 Onboarding OK |

---

## 16. PLANO DE RESOLUCAO — Motor & Validacao

> Os 4 temas abaixo sao interligados. Resolver um sem os outros cria inconsistencia.

### 16.1 — ~~BUG 9 FIX: Validacao pos-geracao~~ ✅ IMPLEMENTADO (Sprint 1)

**Problema:** `escalasGerar` e `escalasAjustar` retornavam `violacoes: []` hardcoded.
**Fix aplicado:** Ambos agora chamam `validarEscalaV3(escalaId)` e retornam `...validacao`. `escalasGerar` tambem foi refatorado para usar `persistirSolverResult()` (~50 linhas eliminadas).

### 16.2 — ~~BUG 1 FIX: Horario de fechamento por dia da semana~~ ✅ IMPLEMENTADO (Sprint 1)

**Problema:** Bridge enviava hora_fechamento GLOBAL. Solver calculava grade S uma vez. Domingo fecha 13h mas usava grade de 22h.

**Fix aplicado em 3 layers:**

| Layer | O que | Status |
|-------|-------|--------|
| Bridge | Le `setor_horario_semana` + `empresa_horario_semana`. Monta `horario_por_dia` com cascata setor > empresa > default. Hash inclui campo | ✅ |
| Solver | Calcula S do MAIOR dia. Computa `day_max_slot` por dia da semana. Zera `work[c,d,s]=0` para slots alem do fechamento | ✅ |
| Validacao TS | Safety net via `janelaOperacional()` no validador (ja existia). `checkH6` nao foi expandida — solver garante via constraint | ✅ (via existente) |
| Types | `SolverInput.empresa.horario_por_dia?` adicionado | ✅ |

**Tabelas usadas (zero migration):**
- `setor_horario_semana` — setor_id, dia_semana, hora_abertura, hora_fechamento
- `empresa_horario_semana` — dia_semana, hora_abertura, hora_fechamento

### 16.3 — H7: Intervalo 15 Minutos (Art. 71 §1 CLT)

**CLT — pesquisa confirmada:**
- **OBRIGATORIO** para jornadas >4h e <=6h (Art. 71 §1 CLT)
- **NAO conta como hora trabalhada** — unpaid (Art. 71 §2)
- **Deve ser registrado no ponto** em 10+ empregados (Art. 74 §2)
- **Se suprimido:** empregador paga periodo com 50% adicional
- Fontes: [Escala App](https://escala.app/blog/intervalo-intrajornada/), [Guia Trabalhista](https://www.guiatrabalhista.com.br/guia/intervalos_descanso.htm)

**Realidade do supermercado (Marco confirmou):**
- Funcionario CHEGA 15 MIN ANTES ou SAI 15 MIN DEPOIS
- As 5h de contrato sao pagas, mas fica 5h15m no local
- Intervalo NAO reduz minutos_trabalho — e tempo extra de presenca
- Horario pode EXTRAPOLAR o limite do setor (07:45 se abre 08:00)

**Estado atual no codigo:**
- Solver: `intervalo_15min = 240 < minutos <= 360` — FLAG booleana (solver_ortools.py:754)
- Solver NAO modela gap — shifts curtos = bloco continuo, `b_starts <= 1` (constraints.py:200)
- Persistido como boolean em `alocacoes.intervalo_15min` (schema.ts)
- Validacao `checkH7()` valida que flag existe, nao QUANDO o break acontece

**Resolucao: Post-processing (NAO modelar no solver)**

Racional: modelar gap de 15min no CP-SAT exigiria expandir a grade em ±1 slot, mudar `b_starts` pra shifts curtos, adicionar constraints de posicao minima. Complexidade desproporcional. O intervalo e concern de PONTO ELETRONICO, nao de scheduling.

**Como funciona:**
1. Solver resolve normalmente (5h de trabalho continuo)
2. Post-processing apos `extract_solution()`:
   - Se `intervalo_15min == True`:
     - Posiciona break: min 3h apos inicio, min 2h antes de fim
     - Calcula se precisa extrapolar: chegar antes OU sair depois
3. Novos campos em `alocacoes`:
   - `hora_intervalo_inicio TEXT` — quando comeca o break
   - `hora_intervalo_fim TEXT` — quando termina
   - `hora_real_inicio TEXT` — hora efetiva com extrapolacao (pode ser antes da abertura)
   - `hora_real_fim TEXT` — hora efetiva com extrapolacao (pode ser apos fechamento)
4. `minutos_trabalho` permanece inalterado (contrato paga X horas, break e extra)
5. Exportacao/impressao mostra horario REAL + marca intervalo
6. Grid/visualizacao mostra ±15min de margem quando tem extrapolacao

**Regra de prioridade:**
- CLT Art. 71 §1 (intervalo obrigatorio) > regra hard de colaborador (horario fixo)
- Estagiario com hard "sair 12:00" → intervalo ANTES (chega 07:45), nao depois
- Colab com hard "nao antes de 08:00" → 15min CLT prevalece (chega 07:45)

**Migration necessaria:** v18 — `addColumnIfMissing` para os 4 novos campos TEXT em alocacoes

### 16.4 — Comunicacao de Resultado (UX Tiered)

**Principio:** Se o motor GEROU, as regras HARD passaram. User NAO precisa inspecionar violacoes. Se motor FALHOU, e problema real.

**Mensagens por resultado:**

| Resultado | Mensagem | Cor | Acao |
|-----------|----------|-----|------|
| Pass 1 (normal) | "Escala gerada com sucesso." | Verde | Nenhuma |
| Pass 1 + avisos SOFT | "Escala gerada com X avisos." | Verde | Link pro Resumo |
| Pass 2 (regras relaxadas) | "Escala gerada com ajustes — X regras flexibilizadas." | Amber | Link pro Resumo |
| Pass 3 (emergencia) | "MODO EMERGENCIA — apenas CLT minimo. Revise." | Vermelho | Botao "Falar com IA" |
| INFEASIBLE | "Impossivel gerar escala para este cenario." | Vermelho | Diagnostico + "Falar com IA" |

**Reestruturacao da main view:**
- **Main view:** Banner de resultado + Grid + botao Export. SO ISSO. Limpa.
- **Resumo** (expandivel ou tab separado): ViolacoesAgrupadas, IndicatorCards, RuleComplianceBadge, Planejado x Executado
- SOFT/AP = "avisos" no Resumo, NAO na main view
- IA recebe contexto automatico do diagnostico (pass_usado, regras_relaxadas) via discovery

**Componentes afetados:**
- Mover pro Resumo: `ViolacoesAgrupadas.tsx`, `IndicatorCard`, `RuleComplianceBadge.tsx`, `PontuacaoBadge.tsx`
- Criar: `EscalaResultBanner.tsx` — le `diagnostico` e renderiza tier apropriado
- Arquivo principal: `EscalaPagina.tsx`

### 16.5 — Ordem de implementacao

```
1. BUG 9 (16.1) → 5 linhas em tipc.ts. Desbloqueia validacao real.
2. BUG 1 (16.2) → Bridge + Solver + Validacao. Fix motor per-day closing.
3. H7 (16.3)   → Post-processing + schema v18 + export. Enhancement independente.
4. UX (16.4)   → Frontend restructure. Banner + Resumo.
```

**Dependencias:**
- 16.1 desbloqueia 16.4 (sem validacao, UX nao faz sentido)
- 16.2 desbloqueia confianca em "0 violacoes" (sem per-day, motor produz bugs)
- 16.3 e independente mas beneficia-se de 16.2 (per-day closing evita break apos fechamento)
- 16.4 depende de 16.1 e 16.2 pra ser confiavel

### 16.6 — Referencia cruzada com Hall da Vergonha

| Resolvido por | Item do Hall |
|---------------|-------------|
| 16.4 | #3 — Chips de regras nao-clicaveis (movidos pro Resumo) |
| 16.4 | #4 — Avisos espalhados sem lugar dedicado (Resumo) |
| 16.4 | #5 — KPIs complexas para leigos (Banner substitui) |
| 16.4 | #9 — Preview = grid interativo (Banner + Grid limpo) |
| 16.4 | #13 — Planejado x Executado incompreensivel (movido pro Resumo) |

---

## 17. SPRINTS DE REFATORACAO

> Cada sprint e um chat/sessao. Tem que ser fechavel de ponta a ponta num unico warlog.
> A gente conversa, planeja, executa e valida CADA sprint antes de ir pro proximo.

### CRITERIOS DE PRIORIZACAO

1. **Dados errados > UX feia** — Bug que produz escala invalida vem antes de melhorar visual
2. **Desbloqueia > Melhora** — Fix que desbloqueia outros fixes vem primeiro
3. **Leigo-impactante > Dev-only** — O que os pais do Marco sofrem tem prioridade
4. **Simples primeiro** — Quick wins geram momentum

---

### SPRINT 1: MOTOR CONFIAVEL ✅ CONCLUIDO (2026-02-26)

**Objetivo:** O motor gera escalas CORRETAS e o usuario ve violacoes REAIS.

| # | Item | Ref | Status | O que foi feito |
|---|------|-----|--------|-----------------|
| 1 | BUG 9: `escalasGerar` retorna `violacoes: []` hardcoded | Bug 9, §16.1 | ✅ | Substituido por `validarEscalaV3(escalaId)`. Return usa `...validacao` |
| 2 | BUG 9b: `escalasAjustar` mesmo problema | Bug 9, §16.1 | ✅ | Idem: return substituido por `validarEscalaV3(escalaId)` |
| 3 | BUG 1: Horario global, domingo usa grade de 22h | Bug 1, §16.2 | ✅ | Bridge le `setor/empresa_horario_semana`, monta `horario_por_dia`. Solver zera slots alem do fechamento por dia. Type e hash atualizados |
| 4 | BUG 2: AP1 Python threshold 4h (deveria ser 8h) | Bug 2 | ✅ | `threshold_slots = 480 // grid_min`. Recebe `grid_min` como parametro |
| 5 | BUG 8: Bridge timeout 61 minutos | Bug 8 | ✅ | `3_700_000` → `300_000` (5 min) |
| 6 | Consolidar INSERT duplicado | Backend §11.2 | ✅ | `escalasGerar` agora usa `persistirSolverResult()`. ~50 linhas inline eliminadas |

**Resultado:** `npm run typecheck` 0 erros. Zero frontend tocado.

**Arquivos modificados:**

| Arquivo | Mudancas |
|---------|----------|
| `src/main/tipc.ts` | Import `persistirSolverResult`. `escalasGerar`: inline INSERT → `persistirSolverResult()` + `validarEscalaV3()`. `escalasAjustar`: return hardcoded → `validarEscalaV3()` |
| `src/main/motor/solver-bridge.ts` | Timeout 5min. Queries `setor_horario_semana` + `empresa_horario_semana`. Monta `horario_por_dia` com cascata. Campo no return + hash |
| `src/shared/types.ts` | `SolverInput.empresa.horario_por_dia?` adicionado |
| `solver/solver_ortools.py` | Le `horario_por_dia`, calcula S do maior dia, computa `day_max_slot`, zera slots alem do fechamento. Passa `grid_min` ao AP1 |
| `solver/constraints.py` | `add_ap1_jornada_excessiva()`: parametro `grid_min`, threshold dinamico `480 // grid_min`, guard `max_excess <= 0` |

**O que NAO foi tocado (e Sprint 2+ precisa saber):**
- `escalasAjustar` ainda tem INSERT inline de alocacoes/decisoes/comparacao (faz UPDATE na escala, nao INSERT — nao pode usar `persistirSolverResult` diretamente). Se precisar extrair, criar funcao auxiliar separada
- Validacao TS `checkH6` NAO foi expandida com awareness de fechamento por dia — o solver agora garante via constraint, e `janelaOperacional()` no validador ja resolve a cascata
- `add_human_blocks()` (constraint H6 de almoco) continua usando janela global de almoco 11-15h — mas slots apos fechamento sao zerados ANTES, entao o bug esta corrigido indiretamente. Se quiser fix cirurgico futuro: lunch window per-day

#### Checklist de teste manual (Sprint 1)

> Rodar apos `npm run dev`. Todos os testes assumem que o setor tem `setor_horario_semana` configurado com domingo fechando mais cedo (ex: DOM 07:00-13:00).

| # | Teste | Como verificar | Esperado |
|---|-------|---------------|----------|
| T1 | Violacoes reais apos gerar | Gerar escala para qualquer setor → olhar KPIs imediatamente (sem reload) | Violacoes HARD e antipatterns aparecem SE existirem. Nao mais `[]` vazio |
| T2 | Violacoes reais apos ajustar | Gerar escala → editar uma celula no grid (trocar TRABALHO/FOLGA) → clicar "Ajustar" | Violacoes recalculadas aparecem imediatamente |
| T3 | Domingo com horario reduzido | Configurar setor com DOM 07:00-13:00 (em setor_horario_semana). Gerar escala que inclua domingos | Alocacoes de domingo devem terminar ate 13:00. Nenhum `hora_fim` > 13:00 em domingos |
| T4 | Almoco nao ultrapassa fechamento | Mesmo cenario T3. Verificar colaboradores que trabalham domingo | `hora_almoco_fim` nao pode ser > hora_fechamento do domingo (13:00) |
| T5 | AP1 nao penaliza jornadas curtas | Gerar escala com estagiarios (5h/dia). Verificar score/antipatterns | AP1 (jornada excessiva) NAO deve aparecer para jornadas <= 8h |
| T6 | Timeout funciona | (Dificil de testar manualmente) Se solver demorar > 5min, deve mostrar erro de timeout | Erro "Solver excedeu timeout de 300s" em vez de ficar travado 1h |
| T7 | Typecheck limpo | `npm run typecheck` | 0 erros |
| T8 | Gerar + Oficializar | Gerar escala → se 0 violacoes HARD → oficializar | Oficializacao funciona normalmente. Se tem violacoes HARD, botao bloqueado |
| T9 | Hash de cenario | Gerar escala → mudar horario de funcionamento do setor → re-gerar | Badge "Escala desatualizada" deve aparecer (se IA ou discovery checar hash) |

---

### SPRINT 2: BUGS SECUNDARIOS + LIMPEZA DE CODIGO MORTO

**Objetivo:** Eliminar armadilhas, codigo morto, e bugs que nao quebram escala mas corrompem dados ou crasham.

**Nota pos-Sprint 1:** O motor agora retorna violacoes REAIS e respeita horarios por dia. BUG 5 (ciclo rotativo) e o proximo bug critico — escala gerada sem solver pode passar por oficializacao com violacoes CLT mascaradas. Sprint 1 corrigiu o mascaramento no fluxo normal, mas ciclo rotativo continua bypassando.

| # | Item | Ref | Escopo | Notas pos-Sprint 1 |
|---|------|-----|--------|---------------------|
| 1 | BUG 5: Ciclo rotativo bypassa solver | Bug 5, Backend §11.4 | tipc.ts | Pattern identico ao Sprint 1: chamar `validarEscalaV3()` pos-INSERT. `persistirSolverResult` NAO serve aqui (ciclo nao roda solver) |
| 2 | BUG 6: `cadastrar_lote` sem transacao | Bug 6 | tools.ts | Independente |
| 3 | BUG 7: JSON.parse sem try/catch (5 locais) | Bug 7 | tipc.ts | Independente |
| 4 | BUG 3: Badges F/V do Ciclos V2 — validar fluxo end-to-end | Bug 3 | bridge → Python → frontend | Verificar se `folga_variavel_dia_semana` esta chegando no Python e se resultado inclui info de ciclo |
| 5 | BUG 4: Rascunho some ao navegar | Bug 4 | EscalaPagina.tsx | Sprint 1 nao tocou frontend |
| 6 | Codigo morto: `estado/store.ts`, `add_h3_rodizio_domingo`, `add_h19_folga_comp_domingo`, `test-conversa.ts` | §4 | Deletar 4 itens |
| 7 | Helpers duplicados: `listDays/dayLabel/minutesBetween` | §4, Backend §11.1 | Unificar em shared |
| 8 | `knowledge.rebuildAndExportSistema` sem guard NODE_ENV | Backend §11.3 | tipc.ts |
| 9 | Warm-start hints incluem escalas ARQUIVADAS | Backend §11.9 | solver-bridge.ts — adicionar `AND status != 'ARQUIVADA'` na query de hints |
| 10 | Historico IA truncado em 320 chars | Hall #23 | cliente.ts |
| 11 | `escalasAjustar` INSERT inline ainda duplicado | Backend §11.2 | tipc.ts — extrair helper se necessario (UPDATE ≠ INSERT, nao pode usar `persistirSolverResult` diretamente) |

**Resultado:** `npm run typecheck` 0 erros. Zero codigo morto. Transacoes seguras. JSON resiliente.

---

### SPRINT 3: H7 (INTERVALO 15 MIN) + DASHBOARD REAL

**Objetivo:** Intervalo de 15min CLT representado com horarios reais. Dashboard mostra violacoes e escalas desatualizadas.

| # | Item | Ref | Escopo |
|---|------|-----|--------|
| 1 | H7: Migration v19 (4 colunas em alocacoes) | §16.3 | schema.ts |
| 2 | H7: Post-processing no Python `extract_solution()` | §16.3 | solver_ortools.py |
| 3 | H7: Persist novos campos (solver-bridge.ts + tipc.ts) | §16.3 | persistirSolverResult + INSERT |
| 4 | H7: Exportacao mostra horario REAL + marca intervalo | §16.3 | ExportarEscala.tsx |
| 5 | H7: Types atualizados (Alocacao interface) | §16.3 | types.ts |
| 6 | Dashboard: `violacoes_pendentes` real (nao mais hardcoded 0) | Hall #21 | tipc.ts (dashboardResumo) |
| 7 | Dashboard: badge "Escala desatualizada" via hash comparison | Hall #21 | tipc.ts + Dashboard.tsx |

**Resultado:** Estagiario 5h → horario real com ±15min. Dashboard mostra alertas reais.

---

### SPRINT 4: UX SIMPLIFICADA — A REFATORACAO VISUAL

**Objetivo:** Telas limpas pro leigo. Gerar escala em 3 cliques. Zero ruido na view principal.

| # | Item | Ref | Escopo |
|---|------|-----|--------|
| 1 | Banner tiered de resultado (verde/amber/vermelho) | §16.4 | EscalaPagina.tsx — novo componente |
| 2 | Resumo colapsavel (mover ViolacoesAgrupadas, KPIs, Comparacao) | Hall #3,#4,#5,#9,#13 | EscalaPagina.tsx — reorganizar |
| 3 | Simplificar interface do motor (default 3 meses, esconder drawer) | Hall #7,#15 | EscalaPagina.tsx |
| 4 | Preflight silencioso (so mostra se BLOQUEAR) | Hall #7 | EscalaPagina.tsx |
| 5 | Exportar direto (sem modal intermediario, menos opcoes) | Hall #10,#11 | ExportModal.tsx |
| 6 | Botao "Gerar Escala" no SetorDetalhe (atalho) | Hall #8 | SetorDetalhe.tsx |
| 7 | Esconder Regras/Memoria da sidebar e manter Contratos com lock visual | Hall #16,#19,#22 | AppSidebar.tsx + ContratoLista.tsx |
| 8 | Config IA escondida (flag dev-only) | Hall #18 | ConfiguracoesPagina.tsx |
| 9 | Dirty state / "sair sem salvar" nos forms | Hall #24 | useBlocker + forms principais |
| 10 | ColaboradorDetalhe: split em tabs ou simplificar | Hall #20 | ColaboradorDetalhe.tsx |

**Resultado:** Pai do Marco abre app → gera escala → exporta. Sem susto, sem modal, sem KPI.

**NAO inclui (backlog futuro):**
- Hall #2 (contratos autocomplete) — cosmético, nao bloqueia
- Hall #6 (excecoes de demanda por data) — esconder, nao remover
- Hall #12 (postos como coluna) — redesenho de grid, complexo
- Hall #14 (regras empresa vs config motor) — requer decisao arquitetural
- Hall #17 (default sexo M) — quick fix isolado, fazer quando quiser

---

### SPRINT RESOLVE-MERDAS: FECHAMENTO POS-SPRINT 4 ✅ CONCLUIDO (2026-02-27)

**Objetivo:** Fechar buracos operacionais que sobraram da refatoracao visual e reforcar regressao critica do lote atomico.

| # | Item | Ref | Status | O que foi feito |
|---|------|-----|--------|-----------------|
| 1 | ColaboradorDetalhe sem campos redundantes | Hall #2 / doc resolve-merdas | ✅ | `horas_semanais` e `tipo_trabalhador` ocultos na UI; submit deriva valores por contrato |
| 2 | Regime de escala no Setor (fonte de verdade) | Hall #1 | ✅ | `setores.regime_escala` + migration + dropdown em SetorDetalhe + solver bridge com precedencia `override > setor > contrato` |
| 3 | Tipos de Contrato de volta na sidebar com seguranca | Hall #19 | ✅ | item voltou na sidebar; contratos de sistema com cadeado e delete bloqueado |
| 4 | SetorDetalhe com card unico "Equipe" | Hall #12 (parcial UX) | ✅ | cards separados de Postos/Colaboradores unificados |
| 5 | Timeout operacional coerente | Bug UX pos S4 | ✅ | removido override local de 30s; fluxo usa default backend 90s |
| 6 | Regressao S2: `cadastrar_lote` atomico | Bug 6 | ✅ | fail-fast de validacao + transaction unica + rollback total sem sucesso parcial |

---

### BACKLOG (pos-Sprint 4)

| Item | Ref | Prioridade |
|------|-----|-----------|
| Contratos autocomplete + readonly horas | Hall #2 | Media |
| Postos como coluna no grid e export | Hall #12 | Media — redesenho visual |
| Regras empresa vs config motor — unificar conceito | Hall #14 | Media — decisao arquitetural |
| Default sexo M → campo obrigatorio | Hall #17 | Baixa — quick fix |
| Esconder excecoes de demanda | Hall #6 | Baixa |
| AP1 conflito de nomes Python vs TS | Bug 2 nota | Baixa — renomear |
| tipc.ts monolito → split por dominio | §7 | Baixa — refatoracao estrutural |
| Model factory duplicada no knowledge handler | Backend §11.6 | Baixa |
| Catalogo Gemini hardcoded | Backend §11.7 | Baixa |
| tool_calls_json TEXT → JSONB | Backend §11.8 | Baixa |
| SolverConfigDrawer duplicata da RegrasPagina | §4, Hall #14 | Resolve com Hall #14 |
| Docs: limpar 50+ .md historicos | §13 | Baixa |

---

### MAPA DE DEPENDENCIAS

```
SPRINT 1 (Motor Confiavel) ✅ CONCLUIDO
  └── desbloqueia SPRINT 2 (motor tem que funcionar pra validar fixes)
  └── desbloqueia SPRINT 3 (H7 precisa de per-day closing do Sprint 1)
  └── desbloqueia SPRINT 4 (UX so faz sentido com dados corretos)

SPRINT 2 (Bugs + Limpeza) ← PROXIMO
  └── independente de Sprint 3 e 4 (pode rodar em paralelo se quiser)

SPRINT 3 (H7 + Dashboard)
  └── depende de Sprint 1 ✅ (per-day closing + validacao real — pronto)
  └── independente de Sprint 4

SPRINT 4 (UX)
  └── depende de Sprint 1 ✅ (violacoes reais pro banner — pronto)
  └── melhor apos Sprint 3 (dashboard funcional)
```

---

### AJUSTE FINAL (2026-02-27): CICLO PRIMEIRO, DETALHES POR DESCOBERTA

Decisao consolidada de produto:
- Fluxo principal leigo: `setor -> gerar -> exportar ciclo`.
- Informacao tecnica (timeline, tabela detalhada, violações completas) fica em camada opt-in.

Aplicacao no frontend:
- `ExportarEscala` agora opera por `modo`:
  - `ciclo` (default operacional)
  - `detalhado` (uso avancado)
- `SetorDetalhe` prioriza card de Escala e remove ruído de warnings no preflight.
- `EscalaPagina` vira tela de detalhes com bloco colapsavel de "Dados extras".
- Sidebar remove "Escalas" do menu principal; Hub permanece em Configuracoes > Avancado.
- Dashboard prioriza abrir o Setor (operacao), com detalhes de escala em acao secundaria.

Checklist de aceite UX final:
- [x] Export principal sem modal/toggles no fluxo operacional
- [x] CSV como acao direta
- [x] Descoberta progressiva para dados tecnicos
- [x] Hub mantido para batch/avancado
