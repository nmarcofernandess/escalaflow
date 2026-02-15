# ITERACAO — EscalaFlow v2 Finalizacao

> **Status:** DRAFT — em construcao iterativa
> **Principio:** Escala gerada TEM que passar 100% ou o sistema declara impossivel. Sem "55% passou".
> **Regra:** Cada fase tem QA proprio. Nao avanca sem QA verde. No final, QA geral.
> **Criado:** 2026-02-14

---

## REGRA DE OURO

O sistema PROPOE. O RH NAO monta na mao.
Menor input possivel. Maximo output correto.

Preferencias de domingo, turno, dia — NAO sao config do usuario.
Sao SOLICITACOES no modo simulacao (ex: "Joao pediu folga segunda").
O motor decide, nao o RH.

---

## COMO LER ESTE DOCUMENTO

- **BACK** = Logica, motor, validador, IPC, dados. O cerebro.
- **FRONT** = Implementacao de UI que conecta ao back, bugs, padronizacao visual (dark mode, shadcn patterns, tema). A pele.
- **UX** = Experiencia de uso, fluxos, navegacao, o que facilita o dia a dia do RH. A alma.

Cada item tem:
- **O que:** Descricao
- **Por que:** Motivacao
- **DoD:** Definition of Done — PARRUDA
- **QA:** Como verificar que ta pronto

---

## FUNC: AUDITORIA DE FUNCIONALIDADE (2026-02-14)

> **Status:** COMPLETO ✅
> **Auditor:** func-guardian
> **Total de achados:** 87 (56 completos, 31 gaps)

### RESUMO EXECUTIVO

**✅ PONTOS FORTES:**
- **IPC:** 27 handlers completos
- **CRUD:** 100% completo para todas as 6 entidades (Empresa, Tipos Contrato, Setores, Colaboradores, Exceções, Escalas)
- **Páginas:** 9 páginas implementadas
- **Smart Recalc:** IMPLEMENTADO (tipc.ts:470-556 — pinnedCells + worker thread + regeneração)
- **UX Core:** RF9-RF15 do PRD todos implementados (Avatar, Theme, Loading, Erros, Tour, Grid interativa, Auto-fill)
- **Export/Oficializar:** Funcionando (HTML self-contained, validação de violacoes_hard)

**❌ GAPS CRÍTICOS (31 items → 18 resolvidos pelo orchestrate 005):**

1. **~~Motor (13 gaps)~~ ✅ TODOS RESOLVIDOS (orchestrate 005):**
   - ~~B1.1: corte_semanal ignorado~~ ✅
   - ~~B1.2: Validador não checa max_minutos_dia por contrato~~ ✅ (R4/R4b merge)
   - ~~B1.3: Repair pode sobrescrever pinned cells~~ ✅
   - ~~B1.4: threshold >=6 deveria ser >6~~ ✅
   - ~~B2.1: Lookback no validador zerado~~ ✅
   - ~~B2.2: Validação de estagiário no domingo~~ ✅
   - ~~B2.5: Cálculo de metaDiariaMin inconsistente~~ ✅ (design intencional)
   - ~~B3.1: pinnedCells preservado nas 7 fases~~ ✅
   - ~~B3.2: Worker thread deserializa pinnedCells~~ ✅
   - ~~B4.1: test-motor.ts~~ ✅ (10 testes, 10 PASS)

2. **Dark Mode (4 gaps):**
   - F1.1: PontuacaoBadge.tsx sem dark variants (ALTO — invisível em dark mode)
   - F1.2: EscalaPagina indicadores sem dark variants (ALTO — 5 cards invisíveis)
   - F1.3: Badges Oficial/Rascunho hardcoded (MÉDIO — ilegíveis em dark mode)
   - F1.4: Varredura geral de cores hardcoded (ALTO — várias páginas ilegíveis)

3. **Validações (10 gaps → 2 resolvidos):**
   - ZERO schemas Zod em nenhuma página (MÉDIO — dados malformados podem chegar no IPC)
   - ~~B2.3: Timeout worker thread faltando~~ ✅ (orchestrate 005 — withTimeout 30s)
   - ~~B2.4: Validação de input no gerador~~ ✅ (orchestrate 005 — throw com mensagem)
   - F4.1: Mapper de erros incompleto (BAIXO — erros já aparecem, só não humanizados)

4. **UX (4 gaps):**
   - F5.1: Página `/perfil` não existe (BAIXO — não bloqueia funcionalidade)
   - F1.5: ThemeSwitcher.tsx é dead code (BAIXO — deletar)
   - UX1-UX5: Propostas iterativas pendentes (BAIXO — melhorias UX, não bugs)

### MAPEAMENTO DETALHADO

**IPC Handlers (27 completos):**
- Empresa: buscar, atualizar
- Tipos Contrato: listar, buscar, criar, atualizar, deletar
- Setores: listar, buscar, criar, atualizar, deletar + listarDemandas, criarDemanda, atualizarDemanda, deletarDemanda + reordenarRank
- Colaboradores: listar, buscar, criar, atualizar, deletar
- Exceções: listar, criar, atualizar, deletar
- Escalas: gerar, buscar, listarPorSetor, ajustar (SMART RECALC), oficializar, deletar
- Dashboard: resumo

**Páginas (9 completas):**
1. Dashboard
2. EmpresaConfig
3. ContratoLista
4. SetorLista
5. SetorDetalhe (DnD rank funcional)
6. ColaboradorLista
7. ColaboradorDetalhe
8. EscalaPagina (689 linhas — CORE do sistema)
9. NaoEncontrado

**Componentes Críticos:**
- ✅ ExportarEscala (258 linhas — HTML self-contained, print-ready)
- ✅ OnboardingTour (166 linhas — 4 passos, localStorage, evento custom)
- ✅ AppSidebar (261 linhas — Avatar + Dropdown + Theme inline + Tour)
- ✅ EscalaGrid (grid interativa — readOnly, onCelulaClick, loadingCell, changedCells)
- ❌ PontuacaoBadge (SEM dark mode — F1.1)
- ❌ ThemeSwitcher (DEAD CODE — nunca importado, AppSidebar implementou inline)

**Validações de Formulário:**
- ❌ ZERO schemas Zod
- Todos os formulários fazem validação manual (`if !nome.trim()`)
- Risco: dados malformados chegam no IPC sem validação prévia

**Feedback & Loading:**
- ✅ TODAS as ações têm toast (sonner)
- ✅ TODOS os estados async têm loading
- ✅ EscalaPagina: overlay completo durante geração (linha 341-355)
- ✅ Grid: loadingCell durante ajuste (spinner por célula)

**Campos Editáveis vs Read-only:**
- ColaboradorDetalhe: ✅ nome, sexo, setor, tipo_contrato, horas_semanais, prefere_turno, evitar_dia_semana (editáveis) | rank via DnD (read-only)
- SetorDetalhe: ✅ nome, hora_abertura, hora_fechamento (editáveis) | escala_atual (calculado)
- EscalaPagina: ✅ data_inicio, data_fim (editáveis) | grid read-only exceto toggle TRABALHO/FOLGA via click

**Hardcodes que Deveriam ser Configuráveis:**
- ~~❌~~ ✅ Timeout worker thread (30s — B2.3 RESOLVIDO orchestrate 005)
- ~~❌~~ ✅ Corte semanal (motor agora le empresa.corte_semanal — B1.1 RESOLVIDO orchestrate 005)
- ✅ Tolerância semanal (empresa.tolerancia_semanal_min JÁ É USADO)

### ARQUIVOS ESSENCIAIS PARA ENTENDER

1. `src/main/tipc.ts` (782 linhas) — Todos os handlers IPC
2. `src/renderer/src/paginas/EscalaPagina.tsx` (814 linhas) — CORE do frontend
3. `src/main/motor/gerador.ts` (~776 linhas) — Motor de geração (7 fases)
4. `src/main/motor/validador.ts` — PolicyEngine (R1-R8)
5. `src/renderer/src/componentes/AppSidebar.tsx` (261 linhas) — Avatar + Dropdown + Theme + Tour
6. `src/renderer/src/componentes/ExportarEscala.tsx` (258 linhas) — Export/Print
7. `src/renderer/src/componentes/OnboardingTour.tsx` (166 linhas) — Tour 4 passos
8. `src/renderer/src/componentes/EscalaGrid.tsx` — Grid interativa

### PRIORIDADES SUGERIDAS

1. **ALTA (17 items):**
   - 13 gaps do motor (B1.1-B1.4, B2.1-B2.5, B3.1-B3.2, B4.1)
   - 4 gaps dark mode (F1.1-F1.4)

2. **MÉDIA (2 items):**
   - Validações Zod (todas as páginas)
   - Timeout worker + validação input gerador (B2.3 + B2.4)

3. **BAIXA (12 items):**
   - Mapper de erros (F4.1)
   - Página perfil (F5.1)
   - Dead code (F1.5 — deletar ThemeSwitcher.tsx)
   - Propostas UX (UX1-UX5)
   - Validações IPC (colaboradores.atualizar, setores.criarDemanda, excecoes.criar)

### VERIFICAÇÕES ESPECÍFICAS

**ColaboradorDetalhe `evitar_dia_semana`:**
- ✅ Frontend envia `evitar_dia_semana` (linha 151)
- ✅ IPC aceita `evitar_dia_semana` (tipc.ts:340)
- ✅ Persiste corretamente no DB

**ExportarEscala:**
- ✅ Funciona (HTML self-contained, CSS inline, print-ready)
- ✅ Landscape A4, tabela pessoa x dia com horários
- ✅ Agrupada por semanas, legenda + footer

**Oficializar:**
- ✅ Valida violacoes_hard > 0 → bloqueia (tipc.ts:454-455)
- ✅ Arquiva oficial anterior → ARQUIVADA (tipc.ts:459-462)
- ✅ Oficializa nova escala → OFICIAL (tipc.ts:465)

**Smart Recalc (escalas.ajustar):**
- ✅ Recebe alocações ajustadas (tipc.ts:472)
- ✅ Monta pinnedCells (tipc.ts:483-488)
- ✅ Spawna worker thread (tipc.ts:495-515)
- ✅ Regenera tudo ao redor (motor com pinnedCells)
- ✅ Retorna EscalaCompleta com indicadores atualizados (tipc.ts:544-555)
- ~~❌~~ ✅ ~~GAP:~~ Motor PRESERVA pinnedCells nas 7 fases (B3.1 — RESOLVIDO orchestrate 005)
- ~~❌~~ ✅ ~~GAP:~~ Worker DESERIALIZA pinnedCells corretamente (B3.2 — RESOLVIDO orchestrate 005)

---

# PARTE 1: BACK (Motor + Validador + IPC)

## Fase B1: Correcoes Criticas do Motor ✅ COMPLETO (orchestrate 005)

> QA da Fase: Rodar `test-motor.ts` com 4 setores, 30 dias.
> **0 HARD violations. 100% dos setores. Sem excecao.**
> **Status:** IMPLEMENTADO — specs/005-motor-fundacao/ (QA APPROVED)

### B1.1 — corte_semanal IGNORADO pelo motor

**O que:** O campo `empresa.corte_semanal` existe no DB, existe na UI (EmpresaConfig), mas o motor usa SEGUNDA como inicio de semana HARDCODED. A funcao `getWeeks()` em `validacao-compartilhada.ts` ignora completamente.

**Por que:** Se o RH configurar semana QUI-QUA (comum em supermercado), o motor distribui folgas na semana ERRADA e calcula meta semanal com dias ERRADOS.

**DoD:**
- [x] `getWeeks()` recebe `corte_semanal` como parametro
- [x] Motor passa `corte_semanal` da empresa pro `getWeeks()`
- [x] Validador tambem usa o mesmo `corte_semanal`
- [x] Distribuicao de folgas (FASE 3) respeita o corte
- [x] Meta semanal (R5) calculada com a semana correta
- [x] test-motor.ts testa com corte diferente de SEG

**QA:** Gerar escala com `corte_semanal = QUI_QUA`. Verificar que as folgas caem dentro da semana QUI-QUA, nao SEG-DOM. Verificar que meta semanal R5 nao gera falso positivo.

---

### B1.2 — Validador NAO checa max_minutos_dia por contrato

**O que:** R4 valida contra CLT.MAX_JORNADA_DIARIA_MIN = 600 (10h global). Nao valida contra `max_minutos_dia` do contrato do colaborador. Estagiario (max 240min/dia) poderia ter ajuste manual de 5h e o validador diz "OK".

**Por que:** A gestora pode ajustar manualmente e violar o contrato sem saber. O sistema prometeu proteger.

**DoD:**
- [x] ~~Nova regra R_CONTRATO_MAX_DIA em `validarRegras()`~~ → **MERGE R4/R4b:** R4 e R_CONTRATO_MAX_DIA unificados num unico check com `Math.min(CLT.MAX_JORNADA_DIARIA_MIN, c.max_minutos_dia)`. Uma violacao, uma mensagem. Regra nomeada como `CONTRATO_MAX_DIA` se limite do contrato < CLT, senao `MAX_JORNADA_DIARIA`.
- [x] Checa `cel.minutos <= Math.min(CLT_MAX, contrato.max_minutos_dia)` para cada dia
- [x] Tipo `ColabValidacao` expandido com `max_minutos_dia`, `dias_trabalho`, `trabalha_domingo`
- [x] Violacao HARD se exceder (nao SOFT — contrato e lei)
- [x] test-motor.ts `testMaxMinutosDia` verifica que estagiario com horas acima do contrato gera HARD violation

**QA:** Ajustar manualmente alocacao de estagiario pra 5h. Validador DEVE gerar HARD violation. Ajustar CLT 44h pra 9h (dentro do max_minutos_dia=570). Validador DEVE aprovar.

> **DECISAO DE DESIGN (R4/R4b merge):** O outro chat decidiu unificar as duas regras. Backend envia UMA violacao com o limite mais restritivo. Frontend vai agrupar violations por COLABORADOR (nao por regra) — a mae do Marco pensa "quem ta com problema?", nao "qual lei violou?". Cards por pessoa + borda vermelha na grid. Ver F6.2.

---

### B1.3 — FASE 4.5 (Repair) pode sobrescrever pinned cells

**O que:** O repair busca o melhor dia do streak pra forcar FOLGA, mas nao filtra pinned cells dos candidatos. Se 6 dos 7 dias sao pinned TRABALHO, o repair sobrescreve um deles.

**Por que:** Semantica quebrada. "Pinned = imovivel" e a promessa. Se o motor quebra isso, a gestora perde confianca.

**DoD:**
- [x] FASE 4.5 filtra pinned cells dos candidatos de folga (`unpinned` filter)
- [x] Se TODOS os dias do streak sao pinned, nao forca folga (validacao flagga depois)
- [x] test-motor.ts `testPartialPinnedStreak` testa streak com 5 pinned + 2 livres

**QA:** Pinar 5 TRABALHO consecutivos + gerar. Motor nao deve sobrescrever nenhum pin. Se o streak ultrapassa R1, validacao gera HARD violation (responsabilidade da gestora que pinou).

---

### B1.4 — FASE 3: threshold >=6 deveria ser >6

**O que:** CLT permite 6 dias consecutivos. O `>=6` forca folga no 6o dia, permitindo apenas 5 consecutivos. Over-correction.

**Por que:** Colabs recebem folga desnecessaria em dias de alta demanda. Cobertura sofre sem razao.

**DoD:**
- [x] Linha 268 do gerador.ts: `>=` vira `>` (threshold corrigido)
- [x] test-motor.ts confirma que 6 consecutivos sao permitidos
- [x] test-motor.ts confirma que 7 consecutivos geram repair

**QA:** Gerar escala. Verificar que existem colabs com exatamente 6 dias consecutivos (permitido). Verificar que NENHUM colab tem 7+ consecutivos.

---

## Fase B2: Robustez do Validador ✅ COMPLETO (orchestrate 005)

> QA da Fase: Validador pega TUDO que o gerador pega + ajustes manuais.
> **Validador = ultima linha de defesa. Nao pode ter buraco.**
> **Status:** IMPLEMENTADO — specs/005-motor-fundacao/ (QA APPROVED)

### B2.1 — Lookback no validador

**O que:** O validador roda com lookback ZERADO. Se a gestora ajustar os primeiros dias da escala e criar streak cross-escala (5 do fim da anterior + 2 do inicio da nova = 7), ninguem flagga.

**Por que:** O validador e a ultima barreira antes de oficializar. Se ele nao ve, ninguem ve.

**DoD:**
- [x] `validarEscala()` carrega lookback da escala OFICIAL anterior (validador.ts:80-118)
- [x] R1 (consecutivos) e R3 (domingos) usam lookback no validador
- [x] test-motor.ts `testLookback` cria escala OFICIAL anterior e testa streak cross-escala

**QA:** Criar escala onde colab trabalhou 5 dias no fim da anterior. Ajustar manualmente pra trabalhar 2 primeiros dias da nova (total 7). Validador DEVE gerar HARD violation R1.

---

### B2.2 — Validacao de estagiario no domingo

**O que:** O gerador previne estagiario (trabalha_domingo=false) no domingo. Mas o validador nao tem regra que flagge se a gestora colocar manualmente.

**Por que:** Protecao so no gerador nao e suficiente. Smart Recalc pode nao regenerar aquele domingo especifico se a celula for pinned.

**DoD:**
- [x] Nova regra R_ESTAGIARIO_DOMINGO (HARD) no validador (validacao-compartilhada.ts:171-184)
- [x] Checa: se `trabalha_domingo === false` e status === TRABALHO em domingo -> HARD violation
- [x] test-motor.ts `testEstagiarioDomingo` testa cenario

**QA:** Pinar estagiario TRABALHO no domingo. Validador DEVE gerar HARD violation.

---

### B2.3 — Timeout no worker thread

**O que:** Se o motor travar (dados malformados, loop), o worker roda pra sempre. A UI congela.

**Por que:** Producao. Os pais do Marco nao podem ficar com tela congelada.

**DoD:**
- [x] `tipc.ts`: `withTimeout()` helper com Promise.race + 30s timeout (tipc.ts:16-27)
- [x] Se timeout, mata o worker e retorna erro humanizado
- [x] Frontend mostra "A geracao demorou mais que o esperado. Tente novamente."
- [x] Timer limpo com `clearTimeout` quando worker resolve primeiro (fix do orphaned timer)

**QA:** (Simulado) Verificar que timeout retorna erro limpo, nao crash.

---

### B2.4 — Validacao de input no gerador

**O que:** `gerarProposta` nao valida se setor existe, se tem colabs, se datas fazem sentido. Crash obscuro.

**Por que:** Defensiva. O IPC valida algumas coisas, mas o motor deve se proteger.

**DoD:**
- [x] Motor valida: setor existe e ativo, data_inicio <= data_fim (gerador.ts:73-80)
- [x] Retorna erro claro (throw com mensagem) ao inves de crash em `undefined`
- [x] Erro mapeado no frontend pra mensagem humanizada

**QA:** Chamar gerarProposta com setor_id inexistente. Deve retornar erro claro, nao stack trace.

---

### B2.5 — Unificar calculo de metaDiariaMin

**O que:** Gerador usa `(horas_semanais * 60) / dias_trabalho`. Validador usa `(horas_semanais * 60) / 7`. Inconsistencia matematica.

**Por que:** Pode mascarar ou amplificar violacoes R5 de formas sutis.

**DoD:**
- [x] `calcMetaDiariaMin()` extraido em `validacao-compartilhada.ts` (linha 89-91)
- [x] Gerador e validador importam a mesma funcao

> **DECISAO DE DESIGN (B2.5):** As duas formulas sao INTENCIONALMENTE diferentes:
> - `calcMetaDiariaMin(horas_semanais, dias_trabalho)` = `/dias_trabalho` → FASE 5 do gerador (meta diaria pra atribuir horarios)
> - R5 tolerancia = `(horas_semanais * 60) / 7` → validacao semanal (tolerancia absorve rodizio de domingo)
> Servem propositos diferentes. A funcao compartilhada resolve a inconsistencia de ter cada modulo calculando por conta propria.

**QA:** Gerar escala. Pontuacao R5 do gerador e do validador devem ser identicas.

---

## Fase B3: Smart Recalc (pinnedCells) ✅ COMPLETO (orchestrate 005)

> QA da Fase: Pinar 3 celulas. Regenerar. Pins PRESERVADOS. 0 HARD violations. Redistribuicao correta.
> **Status:** IMPLEMENTADO — specs/005-motor-fundacao/ (QA APPROVED)

### B3.1 — Parametro pinnedCells no gerarProposta

**O que:** Motor recebe `pinnedCells?: Map<string, {status, hora_inicio?, hora_fim?}>`. Fases 2-5 skipam pins. Validacao roda em tudo.

**DoD:**
- [x] FASE 2: Pinned cells iniciam com status pinned (nao default)
- [x] FASE 3: Pinned cells nao entram no pool de folga (mas contam pro calculo semanal)
- [x] FASE 4: Pinned cells nao entram no rodizio de domingo (guard `isPinned`)
- [x] FASE 4.5: Repair nao toca pinned cells (corrigido em B1.3 — `unpinned` filter)
- [x] FASE 5: Pinned TRABALHO com horas = skip. Pinned TRABALHO sem horas = motor atribui
- [x] Validacao + scoring roda em TUDO (inclusive pins)
- [x] Backward compatible: sem pinnedCells = comportamento atual

**QA:**
1. Gerar sem pins: resultado identico ao atual
2. Pinar 1 FOLGA->TRABALHO: celula muda, motor atribui hora, outros redistribuem, 0 HARD
3. Pinar 1 TRABALHO->FOLGA: celula muda, outros preenchem a cobertura, 0 HARD
4. Pinar celula que cria conflito R1 (7 consecutivos): validacao gera HARD (correto — responsabilidade da gestora)

---

### B3.2 — Worker thread suporta pinnedCells

**O que:** Serializar Map como array de [key, value] pairs (Map nao e serializavel via workerData).

**DoD:**
- [x] WorkerInput tem campo `pinnedCellsArr?: [string, PinnedCell][]` (worker.ts:12)
- [x] Worker deserializa pra Map via `toPinnedMap()` antes de chamar gerarProposta (worker.ts:17-20)
- [x] TypeScript compila sem erros

**QA:** Typecheck passa. Worker recebe pinnedCells e gera escala correta.

---

### B3.3 — IPC handler escalas.ajustar reescrito ✅ IMPLEMENTADO

> **Status:** JA IMPLEMENTADO em tipc.ts:470-556. Confirmado pelo func-guardian (2026-02-14).

**DoD:**
- [x] Recebe alocacoes ajustadas (as celulas que a gestora mexeu)
- [x] Monta pinnedCells Map das celulas ajustadas
- [x] Spawna worker thread (nao bloqueia)
- [x] Deleta alocacoes antigas, insere novas do motor
- [x] Atualiza indicadores da escala
- [x] Retorna EscalaCompleta (escala + alocacoes + indicadores + violacoes)
- [x] Resposta < 1s para 30 dias com 10 colabs (verificado — timeout de 30s como safety net)

**QA:** Ajustar 1 celula via IPC. Resposta contem escala regenerada com pin preservado. Indicadores atualizados. < 1s.

---

## Fase B4: Testes de Motor Expandidos ✅ COMPLETO (orchestrate 005)

> QA da Fase: test-motor.ts roda TODOS os cenarios e retorna 0 HARD violations nos cenarios possiveis.
> **Status:** IMPLEMENTADO — 10 testes, 10 PASS / 0 FAIL / 0 SKIP

### B4.1 — Expandir test-motor.ts

**DoD:**
- [x] Teste basico: `testBasic4Setores` — 4 setores, 30 dias, 0 HARD, pontuacao > 80, cobertura > 90%
- [x] Teste lookback: `testLookback` — criar escala OFICIAL anterior, gerar nova, verificar continuidade
- [x] Teste estagiario: `testEstagiarioDomingo` — verificar que NAO aparece no domingo
- [x] Teste R2 (descanso): `testR2Descanso` — cenario apertado, verificar 11h entre jornadas
- [x] Teste pinned cells: `testPinnedFolgaBasic` — pinar 2 celulas, verificar preservacao + 0 HARD
- [x] Teste pinned conflito: `testPinnedConflito` — pinar streak de 7 TRABALHO, verificar HARD violation
- [x] Teste cobertura impossivel: `testCoberturaImpossivel` — setor com 1 colab e demanda de 3, cobertura baixa, SOFT violation (nao HARD)
- [x] Teste corte_semanal: `testCorteSemanal` — gerar com corte QUI_QUA, verificar folgas na semana certa
- [x] Teste max_minutos_dia: `testMaxMinutosDia` — pinar horas acima do contrato, verificar CONTRATO_MAX_DIA HARD
- [x] Teste partial pinned streak: `testPartialPinnedStreak` — 5 pinned + 2 livres, repair usa livre, 0 R1 HARD
- [x] TODOS os testes tem output claro: PASS/FAIL + metricas (10 testes total)

**QA:** `npx tsx src/main/motor/test-motor.ts` sai 0 (todos passam) ou lista exatamente o que falhou.

---

# PARTE 2: FRONT (Implementacao + Bugs + Padronizacao)

## Fase F1: Dark Mode 100%

> QA da Fase: Alternar entre Light/Dark/System. TODA a app legivel. Nenhum elemento invisivel.
> **Nao e "quase tudo funciona". E TUDO funciona.**

### F1.1 — PontuacaoBadge.tsx sem dark variants

**O que:** Todas as cores (emerald, red, amber) sao light-only. Badge usado em 3+ lugares. Completamente quebrado no dark mode.

**DoD:**
- [x] TODAS as 3 variantes (good/bad/medium) tem `dark:` classes
- [x] Contraste legivel em dark mode (WCAG AA)

**QA:** Dark mode. PontuacaoBadge visivel em: indicadores, historico, header do grid.

---

### F1.2 — EscalaPagina indicadores sem dark variants

**O que:** Circulos de icones (bg-emerald-100, bg-red-100, bg-amber-100) e icones (text-X-600) sem dark.

**DoD:**
- [x] Circulos: `dark:bg-X-950/30`
- [x] Icones: `dark:text-X-400`
- [x] Todos os 5 cards de indicadores legiveis em dark

**QA:** Dark mode. 5 cards de indicadores visiveis e legiveis.

---

### F1.3 — Badges Oficial/Rascunho hardcoded

**O que:** Badges em EscalaPagina usam cores inline ao inves das constantes de `cores.ts`.

**DoD:**
- [x] Badge Oficial usa `CORES_STATUS_ESCALA.OFICIAL` de cores.ts
- [x] Badge Rascunho usa `CORES_STATUS_ESCALA.RASCUNHO` de cores.ts
- [x] Dashboard.tsx tambem usa constantes (se tiver badges hardcoded)

**QA:** Dark mode. Badges Oficial e Rascunho legiveis em todas as paginas.

---

### F1.4 — Varredura geral de cores hardcoded

**O que:** Varrer TODOS os arquivos .tsx e .ts pra encontrar cores sem `dark:` variant. Qualquer `bg-X-50`, `bg-X-100`, `text-X-600`, `text-X-700`, `text-X-800`, `border-X-200` que nao tenha `dark:` correspondente.

**DoD:**
- [x] Grep por cores light-only em todos os componentes
- [x] Cada uma corrigida ou justificada (ex: ja usa CSS variable do shadcn)
- [x] Zero cores light-only escapando

**QA:** Navegar por TODAS as 9 paginas em dark mode. Nenhum elemento invisivel/ilegivel.

---

### F1.5 — Deletar ThemeSwitcher.tsx (dead code)

**O que:** Componente criado mas nunca importado. AppSidebar implementou inline.

**DoD:**
- [x] Arquivo deletado
- [x] Nenhuma referencia restante

**QA:** Build passa. Grep nao encontra "ThemeSwitcher".

---

## Fase F2: Grid Interativa (Conectar Front ao Smart Recalc) ✅ IMPLEMENTADO

> **Status:** JA IMPLEMENTADO. RF14 confirmado pelo func-guardian (2026-02-14).
> EscalaPagina.tsx:146-178 (click handler), EscalaGrid.tsx (loadingCell, changedCells).
> QA da Fase: Click em celula -> toggle -> indicadores atualizam < 1s -> pin preservado.

### F2.1 — Handler de click na EscalaPagina

**O que:** `onCelulaClick` ja existe como prop no EscalaGrid mas EscalaPagina nunca passa. Conectar.

**DoD:**
- [x] `handleCelulaClick(colaboradorId, data, statusAtual)` implementado
- [x] INDISPONIVEL nao e clicavel (retorna early)
- [x] TRABALHO -> FOLGA: envia ajuste, recebe escala regenerada
- [x] FOLGA -> TRABALHO: envia ajuste (sem horas — motor atribui), recebe escala regenerada
- [x] Estado de loading: celula mostra spinner durante recalc
- [x] Erro: toast humanizado

**QA:**
1. Click TRABALHO -> vira FOLGA -> indicadores atualizam
2. Click FOLGA -> vira TRABALHO (com horas atribuidas) -> indicadores atualizam
3. Click INDISPONIVEL -> nada acontece
4. Spinner aparece durante recalc
5. Celula pinada preservada apos recalc

---

### F2.2 — Loading per-cell no EscalaGrid

**O que:** Prop `loadingCell` pra mostrar Loader2 na celula sendo ajustada.

**DoD:**
- [x] Celula em loading mostra Loader2 spinner
- [x] Opacidade reduzida durante loading
- [x] INDISPONIVEL tem `cursor-not-allowed`

**QA:** Click numa celula. Spinner aparece. Apos recalc, spinner some e celula atualiza.

---

### F2.3 — Feedback visual de celulas alteradas

**O que:** Apos recalc, celulas que mudaram flash/highlight brevemente.

**DoD:**
- [x] Store alocacoes anteriores antes do ajuste
- [x] Computar diff apos recalc
- [x] Celulas alteradas recebem `ring-2 ring-primary` que fade em 1.5s
- [x] Celula clicada + celulas redistribuidas = todas flasham

**QA:** Toggle uma celula. Celulas que mudaram flasham. Celulas que nao mudaram ficam iguais.

---

## Fase F3: Onboarding Tour ✅ IMPLEMENTADO

> **Status:** JA IMPLEMENTADO. RF13 confirmado pelo func-guardian (2026-02-14).
> OnboardingTour.tsx (166 linhas, 4 passos, localStorage, evento custom).
> Integrado no App.tsx + AppSidebar dropdown.
> QA da Fase: Primeiro uso -> tour aparece automaticamente. Fecha -> nao aparece mais.
> Dropdown do user -> "Tour do Sistema" -> tour reaparece.

### F3.1 — Componente OnboardingTour.tsx

**O que:** Dialog com 4 steps:
1. "Bem-vindo ao EscalaFlow" (CalendarDays)
2. "Cadastre seu setor" (Building2)
3. "Gere a escala" (Zap)
4. "Ajuste e oficialize" (CheckCircle2)

**DoD:**
- [x] 4 steps com titulo + descricao (2-3 frases, portugues simples)
- [x] Navegacao: Anterior / Proximo / Concluir
- [x] "Nao mostrar novamente" checkbox no ultimo step
- [x] State em localStorage `escalaflow-onboarding-v1`
- [x] Self-managed: mostra automaticamente se localStorage vazio
- [x] Funciona em dark mode

**QA:** Limpar localStorage. Abrir app. Tour aparece. Completar. Fechar e reabrir: tour NAO aparece.

---

### F3.2 — Integrar Tour no App + Sidebar

**O que:** Tour acessivel de 2 formas: automatico (primeiro uso) e manual (sidebar dropdown).

**DoD:**
- [x] OnboardingTour renderizado no App.tsx (global, nao por pagina)
- [x] Sidebar dropdown item: "Tour do Sistema" -> reseta localStorage e abre tour
- [x] O item de "Ajuda" existente no dropdown vira "Tour do Sistema"

**QA:** Click "Tour do Sistema" no dropdown do user. Tour abre. Fecha. Click de novo: abre de novo.

---

## Fase F4: Error Messages Humanizadas

> QA da Fase: NENHUM stack trace visivel pro usuario. Todas as mensagens em portugues simples.

### F4.1 — Mapper de erros

**O que:** Funcao `mapError(err: Error): string` que traduz erros tecnicos pra portugues humano.

**DoD:**
- [x] "Setor nao tem colaboradores ativos" -> "Cadastre ao menos 1 colaborador ativo neste setor antes de gerar a escala."
- [x] "Setor nao tem faixas de demanda" -> "Defina as faixas de demanda antes de gerar."
- [x] "Escala tem N violacoes criticas" -> "A escala tem N problemas que violam a legislacao trabalhista."
- [x] Timeout -> "A geracao demorou mais que o esperado. Tente novamente."
- [x] Generico -> "Erro inesperado. Tente novamente."
- [x] Funcao reutilizavel (importavel de qualquer pagina)

**QA:** Testar cada cenario. Nenhum stack trace visivel.

---

## Fase F5: Pagina de Perfil do Usuario

> QA da Fase: Pagina simples, funcional, sem excesso.

### F5.1 — Pagina de perfil basica

**O que:** Pagina simples com: avatar (iniciais), nome do usuario (editavel), nome da empresa (read-only).

**Por que:** Nao precisa de auth completo. E so pra pessoa se identificar no sistema.

**DoD:**
- [x] Rota `/perfil` no App.tsx
- [x] Avatar com iniciais (shadcn Avatar)
- [x] Nome do usuario: input editavel, salva em localStorage (ou empresa.contato)
- [x] Nome da empresa: read-only (de empresa.nome via IPC)
- [x] Visual clean, shadcn components
- [x] Dark mode compativel

**QA:** Navegar pra /perfil. Ver avatar + nome. Editar nome. Recarregar: nome persiste.

---

## Fase F6: Blockers UX (SPRINT CRITICO)

> QA da Fase: RH nao se confunde com botoes. Violacoes explicadas em portugues. ContratoLista editavel.
> **BLOCKERS — resolver antes de entregar aos pais.**

### F6.1 — SetorDetalhe: 3 botoes pro mesmo destino (UX-C1)

**O que:** "Abrir Escala", "Gerar Nova" e "Gerar Escala" fazem `navigate` pro mesmo `/setores/:id/escala`. Labels sugerem acoes diferentes mas fazem a mesma coisa.

**Por que:** Os pais do Marco vao ver 3 botoes e nao saber qual clicar. Confusao direta.

**DoD:**
- [x] Se TEM escala ativa (RASCUNHO ou OFICIAL): 1 botao "Abrir Escala" (variant default)
- [x] Se NAO tem escala: 1 botao "Gerar Escala" (variant default)
- [x] NUNCA 2+ botoes que levam pro mesmo destino
- [x] Botao fica no card "Escala Atual" do SetorDetalhe (posicao existente)

**QA:** Setor com escala: mostra "Abrir Escala" e SO ele. Setor sem escala: mostra "Gerar Escala" e SO ele.

---

### F6.2 — Violacoes sem guidance humanizada (UX-C2)

**O que:** Botao "Oficializar" disabled mostra "Corrija X violacao(oes) critica(s)" com codigos tecnicos (R1, R2...). RH nao sabe o que e "R1: MAX_DIAS_CONSECUTIVOS".

**Por que:** Se o RH nao entende o problema, nao consegue resolver. Tela vira muro.

**DoD:**
- [x] Mapa de regras pra texto humano em `formatadores.ts` ou `constants`:
  - MAX_DIAS_CONSECUTIVOS → "Colaborador trabalhou mais de 6 dias seguidos sem folga"
  - DESCANSO_ENTRE_JORNADAS → "Intervalo entre jornadas menor que 11 horas"
  - RODIZIO_DOMINGO → "Rodizio de domingo nao respeitado"
  - MAX_JORNADA_DIARIA → "Jornada diaria excede o limite de 10 horas (CLT)"
  - CONTRATO_MAX_DIA → "Jornada diaria excede o limite do contrato"
  - ESTAGIARIO_DOMINGO → "Estagiario nao pode trabalhar no domingo"
- [x] **Agrupar violations por COLABORADOR** (nao por regra):
  - Card HARD: avatar + nome + lista de problemas por dia
  - Card SOFT: avatar + nome + alertas
  - "Quem ta com problema?" > "Qual lei violou?"
- [x] Dica de acao: "Clique em um dia de trabalho desse colaborador para trocar por folga"
- [x] Celulas que violam regra recebem borda vermelha (`ring-2 ring-destructive`) na grid
- [x] Dark mode compativel

> **NOTA DE DESIGN (decidido na iteracao do orchestrate 005):**
> R4 e R_CONTRATO_MAX_DIA foram MERGED no backend — `Math.min(CLT_MAX, contrato.max_minutos_dia)`.
> Uma violacao, uma mensagem, o limite mais restritivo. Regra nomeada automaticamente:
> - Se `contrato.max_minutos_dia < CLT.MAX` → `CONTRATO_MAX_DIA`
> - Senao → `MAX_JORNADA_DIARIA`
> Frontend so precisa mapear os nomes finais (sem duplicacao).

**QA:**
1. Gerar escala que tenha HARD violation (ex: pinar 7 TRABALHO consecutivos)
2. Lista de violacoes mostra cards por COLABORADOR em portugues
3. Celulas violadas tem borda vermelha na grid
4. Dica de acao visivel
5. Botao Oficializar continua disabled ate 0 HARD

---

### F6.3 — ContratoLista CRUD completo (UX-R1)

**O que:** Pagina lista templates de contrato mas e read-only. Templates definem regras do motor (horas_semanais, dias_trabalho, max_minutos_dia, trabalha_domingo).

**Por que:** Sem CRUD, o RH nao pode criar contrato novo (ex: "PJ 30h") nem ajustar limites. Produto incompleto.

**DoD:**
- [x] Card por template (nome + resumo: "44h/semana, 6 dias, max 9h30/dia")
- [x] Botao "Editar" em cada card → abre Dialog
- [x] Dialog de edicao com 4 campos editaveis:
  - `horas_semanais` (number input, min 1, max 44)
  - `dias_trabalho` (number input, min 1, max 6)
  - `max_minutos_dia` (number input, min 60, max 600)
  - `trabalha_domingo` (switch/checkbox)
- [x] Disclaimer CLT no dialog: "Regras como max 6 dias consecutivos e 11h de descanso sao leis trabalhistas e nao podem ser alteradas."
- [x] Botao "Novo Template" → mesmo dialog, campos vazios
- [x] Botao "Excluir" com confirmacao (se template nao tem colabs vinculados)
- [x] IPC ja tem handlers: tiposContrato.criar, atualizar, deletar (confirmado pela auditoria)
- [x] Empty state: "Nenhum tipo de contrato cadastrado. Crie um template para comecar."
- [x] Dark mode compativel

**QA:**
1. Listar templates existentes (seed tem 4)
2. Editar "CLT 44h" → mudar horas_semanais pra 40 → salvar → lista atualiza
3. Criar "PJ 30h" → preencher 4 campos → salvar → aparece na lista
4. Excluir template sem colabs → confirma → some da lista
5. Tentar excluir template COM colabs → erro humanizado

---

# PARTE 3: UX (Experiencia de Uso — ITERACAO)

> IMPORTANTE: Esta secao e ITERATIVA. Os items aqui sao propostas que precisam ser
> discutidas, prototipadas e validadas antes de implementar. Nao sao specs finais.

## UX1 — Dashboard com tabs de setores

**Hipotese:** Hoje o Dashboard mostra cards de setores que linkam pra SetorDetalhe. Pra ver a escala, precisa: Dashboard -> Setor -> Escala. Sao 2 cliques.

**Proposta:** Dashboard mostra tabs com os setores (Caixa | Acougue | Padaria | Hortifruti). Cada tab mostra a escala OFICIAL (grid read-only + indicadores). Pra editar, link "Editar escala" leva pra EscalaPagina.

**Beneficio:** RH veria TODAS as escalas num relance, sem navegar.

**Questoes pra iterar:**
- Quantos setores cabem em tabs? Se tiver 10 setores, tabs overflow?
- A grid read-only compacta cabe no Dashboard?
- Faz sentido manter stats (total colabs, ferias, atestados) no topo do dash?
- Se o dash JA mostra escalas, precisa de link "Escalas" na sidebar? Provavelmente NAO.

**Status:** PROPOSTA — precisa de prototipo visual.

---

## UX2 — Eliminar entrada dupla pra Escalas

**Hipotese:** Hoje tem 2 caminhos pra chegar na escala:
1. Dashboard -> click setor -> escala
2. Sidebar: nao tem link direto, vai por Setores -> click setor -> Escala tab

**Proposta:** Se o Dashboard JA mostra escalas por setor (UX1), o fluxo fica:
- VER: Dashboard (todas as escalas de todos os setores)
- EDITAR: Dashboard -> "Editar escala" -> EscalaPagina
- CONFIGURAR: Sidebar -> Setores -> SetorDetalhe (colabs, demandas, etc)

**Beneficio:** Caminho unico e claro. Ver = Dashboard. Editar = click. Configurar = Setores.

**Status:** PROPOSTA — depende de UX1.

---

## UX3 — Tour do Sistema refinado

**Hipotese:** Tour de 4 steps generico pode nao ser suficiente. O RH precisa entender o FLUXO completo.

**Proposta de refinamento:**
1. "Bem-vindo" — o que o sistema faz (gera escalas automaticamente)
2. "Seu painel" — o Dashboard mostra todas as escalas (ver UX1)
3. "Gerar escala" — click no setor -> Gerar -> pronto
4. "Ajustar" — click na celula -> troca trabalho/folga -> sistema recalcula
5. "Oficializar" — quando estiver bom, oficializa (trava a escala)

**Acesso:** Dropdown do usuario na sidebar -> "Tour do Sistema"

**Status:** PROPOSTA — depende de UX1 (step 2 muda se dash mudar).

---

## UX4 — Dropdown do usuario

**O que existe hoje:** Footer da sidebar com avatar da empresa + dropdown (Tema, Ajuda, Sobre).

**Proposta de refinamento:**
- Avatar: mostra iniciais do USUARIO (nao da empresa)
- Dropdown items:
  - **Meu Perfil** -> vai pra /perfil
  - **Tema** -> sub-menu (Claro/Escuro/Sistema) — JA FUNCIONA
  - **Tour do Sistema** -> abre onboarding
  - **Sobre** -> versao, etc

**NAO precisa:** Pagina separada de "Preferencias visuais" — tema ja ta no dropdown.

**Status:** IMPLEMENTAVEL apos F3 (tour) e F5 (perfil).

---

## UX5 — Pagina de perfil minima

**O que:** Pagina simples: avatar, nome do usuario, nome da empresa. Sem overengineering.

**Por que:** Os pais do Marco precisam sentir que o sistema "e deles". Um nome e um avatar ja fazem isso.

**Proposta:**
- Avatar grande (editavel? ou so iniciais)
- Nome do usuario (editavel, salva em localStorage ou campo na tabela empresa)
- Nome da empresa (read-only)
- MAIS NADA por enquanto

**Status:** IMPLEMENTAVEL (item F5.1).

---

# QA GERAL (Final)

> So roda quando TODAS as fases (B1-B4, F1-F5) estao verdes.

## QG1 — Jornada completa do usuario

**Steps:**
1. App abre sem erros
2. Tour aparece automaticamente (primeiro uso)
3. Completar tour
4. Dashboard carrega com resumo dos setores
5. Navegar pra setor Caixa > Escala
6. Click "Gerar Escala" com datas default (proximo mes)
7. Escala gerada: 0 HARD violations, pontuacao > 80, cobertura > 90%
8. Click celula TRABALHO -> vira FOLGA -> indicadores atualizam < 1s
9. Click celula FOLGA -> vira TRABALHO (com horas) -> indicadores atualizam
10. Celula pinada PRESERVADA apos recalc
11. Oficializar escala: sucesso (0 HARD violations)
12. Tab Oficial mostra escala oficializada
13. Gerar nova escala -> antiga vai pro Historico
14. Alternar tema Light/Dark/System: TODA a app legivel
15. Imprimir/Exportar escala funciona

**DoD:** Todos os 15 steps passam. Sem excecao.

---

## QG2 — Motor em producao

**Steps:**
1. `npx tsx src/main/motor/test-motor.ts` retorna 0 failures
2. 4 setores testados: 0 HARD violations CADA
3. Pontuacao > 80 CADA
4. Cobertura > 90% CADA (ou declaracao de impossivel com justificativa)
5. Pinned cells preservadas em 100% dos testes
6. Corte semanal respeitado
7. Estagiario NUNCA no domingo
8. Descanso inter-jornada R2 respeitado
9. Lookback cross-escala funciona

**DoD:** Todos passam. Se algum setor nao atingir cobertura > 90%, o motor DEVE retornar uma mensagem clara: "Cobertura de X% — setor tem N colaboradores para demanda de M pessoas. Considere adicionar mais colaboradores."

---

## QG3 — Build e TypeScript

**Steps:**
1. `npx tsc --noEmit` retorna 0 erros
2. `npm run build` completa sem erros
3. App Electron abre e navega sem console errors

**DoD:** Limpo. Sem warnings, sem erros.

---

# PRIORIZACAO FINAL

> Ver secao "ATUALIZACAO DA PRIORIZACAO (pos-delta)" no final do documento.
> Items ja implementados: B3.3, F2, F3, RF9-RF11, RF14-RF15.

---

# AUDITORIA DO TEAM (2026-02-14)

> 3 agentes especializados auditaram o codebase em paralelo.
> Resultados abaixo. Formato: O que / Onde / Proposta / Impacto / Esforco.
> **NAO e spec de implementacao — e DIAGNOSTICO pra informar priorizacao.**

---

## SHADCN: Auditoria de Componentes e Dark Mode

### Inventario

| Metrica | Valor |
|---------|-------|
| Componentes shadcn instalados | 22 |
| Componentes efetivamente usados | 16 |
| Componentes nao usados | 6 (collapsible, scroll-area, sheet, skeleton, table, + dead code) |
| Arquivos com cores hardcoded sem dark | 7 |
| Layouts inconsistentes entre paginas | 3 tipos diferentes de card |

### SHADCN-1: PontuacaoBadge.tsx — ZERO dark mode

- **O que:** Todas as 3 variantes (emerald/amber/red) sem `dark:` classes. Componente usado em 3+ lugares. Completamente quebrado no dark.
- **Onde:** `src/renderer/src/componentes/PontuacaoBadge.tsx:5-14`
- **Proposta:** Seguir padrao de `CORES_STATUS_ESCALA` do `cores.ts` — adicionar dark variants.
- **Impacto:** ALTO
- **Esforco:** BAIXO

### SHADCN-2: EscalaPagina — 5 cards indicadores sem dark

- **O que:** Circulos de icones (`bg-emerald-100`, `bg-red-100`, `bg-amber-100`, `bg-primary/10`) e icones (`text-X-600`) sem dark variants. Pagina CORE do app.
- **Onde:** `src/renderer/src/paginas/EscalaPagina.tsx:636-671`
- **Proposta:** Adicionar `dark:bg-X-950/30` nos circulos e `dark:text-X-400` nos icones.
- **Impacto:** ALTO
- **Esforco:** MEDIO

### SHADCN-3: ColaboradorLista — Avatares genero sem dark

- **O que:** Cores de genero (pink/sky) hardcoded sem dark. Ja existe `CORES_GENERO` em `cores.ts:43-46`.
- **Onde:** `src/renderer/src/paginas/ColaboradorLista.tsx:196-200`
- **Proposta:** Substituir por `CORES_GENERO.F` / `CORES_GENERO.M` que ja tem dark.
- **Impacto:** MEDIO
- **Esforco:** BAIXO

### SHADCN-4: Dashboard — Badges hardcoded

- **O que:** Badge amarelo inline ao inves de constantes. Alertas ilegiveis no dark.
- **Onde:** `src/renderer/src/paginas/Dashboard.tsx:104-106`
- **Proposta:** Usar `CORES_VIOLACAO.SOFT` ou adicionar `dark:` variants.
- **Impacto:** MEDIO
- **Esforco:** BAIXO

### SHADCN-5: ColaboradorDetalhe — Icones excecao sem dark

- **O que:** `ExcecaoIcon` retorna cores hardcoded. Ja existe `CORES_EXCECAO` em `cores.ts`.
- **Onde:** `src/renderer/src/paginas/ColaboradorDetalhe.tsx:63-73`
- **Proposta:** Usar constantes existentes.
- **Impacto:** BAIXO
- **Esforco:** BAIXO

### SHADCN-6: Table component instalado mas nao usado

- **O que:** Todas as paginas usam divs customizados ao inves de `<Table>` do shadcn. Dashboard (lista setores), SetorDetalhe (lista demandas), ColaboradorDetalhe (lista excecoes) seriam candidatos naturais.
- **Onde:** Dashboard.tsx, SetorDetalhe.tsx, ColaboradorDetalhe.tsx
- **Proposta:** Manter Card pra grids (SetorLista, ColaboradorLista). Usar Table pra listas tabulares (Demandas, Excecoes).
- **Impacto:** MEDIO
- **Esforco:** ALTO

### SHADCN-7: Skeleton instalado mas nao usado

- **O que:** Loading states usam texto "Carregando..." ao inves de Skeleton. Todos os useApiData retornam estado loading que mostra texto.
- **Onde:** Todas as paginas
- **Proposta:** Adicionar Skeleton nos principais: Dashboard (4 stat cards), SetorLista (grid), EscalaPagina (grid durante geracao).
- **Impacto:** BAIXO
- **Esforco:** MEDIO

### SHADCN-8: Badge inconsistente entre paginas

- **O que:** Mesmo tipo de info (status, alertas) usa estilos diferentes em cada pagina. Dashboard inline, SetorDetalhe inline, ColaboradorLista inline. Apenas EscalaPagina usa StatusBadge wrapper corretamente.
- **Onde:** Dashboard.tsx:104, SetorDetalhe.tsx:432, ColaboradorLista.tsx:227
- **Proposta:** Padronizar — Alertas/Violacoes = `CORES_VIOLACAO.SOFT`, Status = `StatusBadge`, Metadados = `variant="outline"` padrao.
- **Impacto:** MEDIO
- **Esforco:** BAIXO

### SHADCN-9: ThemeSwitcher.tsx — DEAD CODE

- **O que:** Componente criado mas NUNCA importado. AppSidebar ja implementou inline (linhas 210-233).
- **Onde:** `src/renderer/src/componentes/ThemeSwitcher.tsx`
- **Proposta:** Deletar arquivo. Zero referencias.
- **Impacto:** BAIXO (limpeza)
- **Esforco:** BAIXO

### SHADCN-10: Varredura geral de cores hardcoded

- **O que:** Grep por `bg-X-50`, `bg-X-100`, `text-X-600`, `text-X-700`, `text-X-800`, `border-X-200` sem `dark:` correspondente em TODOS os .tsx.
- **Onde:** Todos os componentes e paginas
- **Proposta:** Grep sistematico + correcao um por um. Ou justificar (ex: usa CSS variable do shadcn).
- **Impacto:** ALTO
- **Esforco:** MEDIO

### SHADCN: O que ja esta BOM

- EscalaGrid — dark mode 100%, cores via constantes, Tooltip ✅
- AppSidebar — Theme switcher inline, dropdown bem estruturado ✅
- StatusBadge — Wrapper correto usando constantes ✅
- OnboardingTour — Dialog + Checkbox funcional ✅
- PageHeader — Breadcrumb + actions pattern consistente ✅
- ExportarEscala — HTML self-contained, contexto print OK ✅

### SHADCN: Plano de Acao

**Fase 1 — Dark Mode (1-2h, impacto ALTO):**
1. PontuacaoBadge dark variants (SHADCN-1)
2. EscalaPagina indicadores dark (SHADCN-2)
3. ColaboradorLista avatares → CORES_GENERO (SHADCN-3)
4. Dashboard badges → constantes (SHADCN-4)

**Fase 2 — Consistencia (30min, impacto MEDIO):**
1. Padronizar Badge entre paginas (SHADCN-8)
2. Deletar ThemeSwitcher.tsx (SHADCN-9)
3. ColaboradorDetalhe ExcecaoIcon → CORES_EXCECAO (SHADCN-5)

**Fase 3 — Polish (2-4h, opcional):**
1. Avaliar Table pra listas tabulares (SHADCN-6)
2. Skeleton nos loading states (SHADCN-7)

---

## UX: Mapa de Fluxos e Problemas de Usabilidade

### Mapa de Fluxos (contagem de cliques)

#### Fluxo Principal: Gerar Escala Nova
```
Dashboard → Click "Ver setor" (2) → SetorDetalhe → Scroll → "Gerar Nova" (3) → EscalaPagina → Gerar → Ajustar → Oficializar (5+)
TOTAL: ~10 cliques da home ate escala gerada
```
**Problema:** Caminho longo demais pra acao MAIS FREQUENTE do sistema.

#### Fluxo: Ver Escalas Existentes
```
Caminho 1: Dashboard → Setor → SetorDetalhe → Scroll → "Abrir Escala" → EscalaPagina (4 cliques)
Caminho 2: Sidebar → Setores → SetorLista → Setor → SetorDetalhe → Scroll → "Abrir Escala" (5 cliques)
```
**Problema:** 2 caminhos diferentes pra mesma coisa.

#### Fluxo: Cadastrar Colaborador
```
Caminho 1: Dashboard → "Novo Colaborador" (acao rapida) → Dialog (2 cliques)
Caminho 2: Sidebar → Colaboradores → "Novo Colaborador" → Dialog (3 cliques)
Caminho 3: SetorDetalhe → "Gerenciar" → ColaboradorLista → "Novo" (4 cliques)
```
**Problema:** 3 caminhos pro mesmo destino.

#### Fluxo: Configurar Demandas
```
UNICO caminho: SetorDetalhe → Scroll → "Nova Faixa" → Dialog (3 cliques)
```
**Problema:** Demandas sao CRITICAS pro motor mas enterradas no SetorDetalhe.

### UX-P1: Sidebar sem link direto pra Escalas

- **O que:** Sidebar tem Dashboard, Setores, Colaboradores, Config. NAO tem "Escalas". Escalas e a FUNCAO CORE.
- **Onde:** `AppSidebar.tsx:49-58`
- **Proposta:** Adicionar item "Escalas" → lista setores com status (OFICIAL/RASCUNHO/SEM_ESCALA).
- **Impacto:** ALTO
- **Esforco:** MEDIO

### UX-P2: Dashboard mostra setores, nao escalas

- **O que:** Dashboard tem cards de setores. Nao mostra grid de escala. RH precisa de 4 cliques pra ver.
- **Onde:** `Dashboard.tsx:85-115`
- **Proposta:** Tabs por setor no Dashboard, cada tab mostra grid read-only da escala OFICIAL.
- **Impacto:** ALTO (reduz 4 cliques pra 1)
- **Esforco:** ALTO

### UX-P3: SetorDetalhe sobrelotado

- **O que:** Info basica + demandas + colaboradores (DnD rank) + escala atual. Tudo na mesma tela. 625 linhas.
- **Onde:** `SetorDetalhe.tsx`
- **Proposta:** Tabs: "Geral" (info + demandas), "Colaboradores" (lista + rank), "Escalas" (atual + historico).
- **Impacto:** MEDIO
- **Esforco:** BAIXO

### UX-P4: Breadcrumbs nao totalmente clicaveis

- **O que:** Nem todos os niveis intermediarios sao links.
- **Onde:** Todas as paginas via `PageHeader.tsx`
- **Proposta:** Garantir que todos os niveis sejam clicaveis.
- **Impacto:** BAIXO
- **Esforco:** BAIXO

### UX-R1: ContratoLista e READ-ONLY (BLOQUEADOR)

- **O que:** Pagina lista templates mas NAO pode editar, criar, ou desativar. Templates definem regras do motor.
- **Onde:** `ContratoLista.tsx` (108 linhas)
- **O que NAO pode mexer (CLT = LEI):** Max 6 dias consecutivos, min 11h entre jornadas, max 10h diaria, rodizio domingo.
- **O que PODE customizar (template):** horas_semanais, dias_trabalho, max_minutos_dia, trabalha_domingo.
- **Proposta:** Card + "Editar" → Dialog com 4 campos + disclaimer CLT. Botao "Novo Template".
- **Impacto:** ALTO (produto incompleto sem isso)
- **Esforco:** MEDIO

### UX-R2: EmpresaConfig — manter como pagina separada

- **Decisao:** MANTER. E config de sistema, nao operacao diaria. RH mexe 1x.
- **Impacto:** BAIXO | **Esforco:** ZERO

### UX-S1: Unificar "Novo Colaborador" em Dialog global

- **O que:** 3 caminhos pro mesmo destino.
- **Proposta:** Todos abrem o MESMO dialog sem navegar.
- **Impacto:** MEDIO | **Esforco:** BAIXO

### UX-S2: Botao "Gerar Escala" mais visivel no SetorDetalhe

- **O que:** Botao "Gerar Nova" fica enterrado no card "Escala Atual" (pode estar vazio).
- **Onde:** `SetorDetalhe.tsx:510-555`
- **Proposta:** CTA primario no topo se nao houver rascunho ativo.
- **Impacto:** MEDIO | **Esforco:** BAIXO

### UX-S3: Tour com links clicaveis

- **O que:** Tour funcional mas Step 2 menciona "Va em Setores" sem linkar.
- **Proposta:** Links clicaveis que fecham tour e navegam.
- **Impacto:** BAIXO | **Esforco:** BAIXO

### UX-A1: Demandas enterradas — sem validacao pre-geracao

- **O que:** Demandas sao CRITICAS pro motor mas enterradas. Sem demandas, motor gera com cobertura 0%.
- **Onde:** `SetorDetalhe.tsx:394-462`
- **Proposta:** (1) Validar demandas >= 1 antes de gerar. (2) Banner de alerta se setor sem demandas.
- **Impacto:** ALTO | **Esforco:** MEDIO

### UX-A2: Mensagem "Rode o seed" e tecnica

- **O que:** RH nao sabe o que e "seed".
- **Onde:** `ContratoLista.tsx:35-44`
- **Proposta:** "Nenhum tipo de contrato cadastrado. Clique em [Criar Padroes]..."
- **Impacto:** BAIXO | **Esforco:** BAIXO

### UX-A3: ColaboradorDetalhe — "Historico de Escalas" placeholder vazio

- **O que:** Secao sem implementacao. Cria expectativa falsa.
- **Proposta:** Remover ate implementar.
- **Impacto:** BAIXO | **Esforco:** BAIXO

### UX: Sentimento por pagina

| Pagina | Sentimento | Veredicto |
|--------|-----------|-----------|
| Dashboard | "Visao geral, controlado" | OK, mas nao mostra escalas |
| SetorLista | "Limpo, organizado" | ✅ |
| SetorDetalhe | "MUITA COISA, scroll" | Precisa tabs (UX-P3) |
| EscalaPagina | "Aqui eu trabalho" | ✅ MELHOR UX do sistema |
| ColaboradorLista | "Lista, filtro, OK" | ✅ |
| ColaboradorDetalhe | "Perfil completo" | Remover placeholder vazio |
| ContratoLista | "So leitura?" | ❌ Incompleta (UX-R1) |
| EmpresaConfig | "Config, 1x e esqueco" | ✅ |
| Perfil | "Meu cantinho" | ✅ |
| 404 | "Perdi, volta home" | ✅ |

---

## FUNC: Completude Funcional e Gaps

### Status Geral

| Area | Status | Detalhe |
|------|--------|---------|
| IPC Handlers | 27/27 ✅ | Todos os dominios cobertos |
| Paginas | 9/9 ✅ | Todas implementadas |
| CRUD | 100% ✅ | Todas as entidades |
| Smart Recalc | ✅ IMPLEMENTADO | tipc.ts:470-556 (pinnedCells + regeneracao) |
| RF6-RF8 (Recalc) | ✅ | Ajustar recebe pins, spawna worker, regenera |
| RF9 (Avatar+Dropdown) | ✅ | AppSidebar.tsx:164-254 |
| RF10 (Theme) | ✅ | Inline no AppSidebar |
| RF11 (Loading) | ✅ | Overlay + spinner + loadingCell |
| RF12 (Erros) | ✅ parcial | mapError existe, cobertura a verificar |
| RF13 (Tour) | ✅ | OnboardingTour.tsx (4 passos, localStorage) |
| RF14 (Grid interativa) | ✅ | Click → toggle → recalc automatico |
| RF15 (Auto-fill periodo) | ✅ | Proximo mes automatico |
| RF16-RF19 (Qualidade motor) | ✅ | Motor 10 testes PASS (orchestrate 005 + 007) |
| ExportarEscala | ✅ | HTML self-contained, print-ready |
| Oficializar | ✅ | Valida HARD, arquiva anterior |
| Validacoes Zod | ✅ 7 forms Zod | shadcn Form + react-hook-form + @hookform/resolvers + Zod |
| Pagina Perfil | ✅ | /perfil implementado (Avatar + nome + empresa) |

### ~~FUNC-1: Formularios manuais + ZERO validacoes Zod~~ ✅ RESOLVIDO (orchestrate 007)

- **O que:** ~~5 formularios (3 paginas + 2 dialogs) usam `useState` manual + `Input`/`Label` direto. Nenhum usa react-hook-form, FormField, FormMessage, ou Form pattern do shadcn. Nenhum schema Zod. Dados malformados podem chegar no IPC.~~ → **7 formularios migrados pra shadcn Form + Zod:** SetorLista, SetorDetalhe, ColaboradorLista, ColaboradorDetalhe, ContratoLista, EmpresaConfig, Perfil.
- **Onde:** SetorDetalhe.tsx, ColaboradorDetalhe.tsx, EmpresaConfig.tsx (paginas) + SetorLista.tsx, ColaboradorLista.tsx (dialogs de criacao) + ContratoLista.tsx + Perfil.tsx
- **Status:** ✅ IMPLEMENTADO — shadcn Form + react-hook-form + @hookform/resolvers + Zod
- **Impacto:** MEDIO
- **Esforco:** MEDIO-ALTO (7 formularios migrados)

### FUNC-2: escalas.gerar — sem validacao de input (B2.4)

- **O que:** Nao valida setor existe, colabs > 0, datas fazem sentido. Crash obscuro no worker.
- **Onde:** `tipc.ts:567-656`
- **Proposta:** Validar inputs, retornar erro claro.
- **Impacto:** ALTO
- **Esforco:** BAIXO

### FUNC-3: Worker sem timeout (B2.3)

- **O que:** Worker pode rodar pra sempre. UI congela.
- **Onde:** `tipc.ts:495-515`
- **Proposta:** `Promise.race` 30s + matar worker + erro limpo.
- **Impacto:** ALTO
- **Esforco:** MEDIO

### FUNC-4: mapError — cobertura a verificar

- **O que:** Existe e e usado, mas cenarios cobertos desconhecidos.
- **Onde:** `src/renderer/src/lib/formatadores.ts`
- **Proposta:** Verificar cobertura dos 5 cenarios mapeados em F4.1.
- **Impacto:** BAIXO
- **Esforco:** BAIXO

### ~~FUNC-5: Pagina de perfil nao existe (F5.1)~~ ✅ RESOLVIDO (orchestrate 007)

- **O que:** ~~Rota `/perfil` nao existe.~~ → Rota `/perfil` implementada com Avatar (iniciais), nome usuario (localStorage), empresa (IPC read-only), Zod validation.
- **Status:** ✅ IMPLEMENTADO — Link "Meu Perfil" no dropdown do AppSidebar
- **Impacto:** BAIXO
- **Esforco:** MEDIO

### FUNC: Gaps do Motor (confirmacao)

Todos os gaps B1.1-B4.1 da PARTE 1 foram CONFIRMADOS pelo func-guardian como REAIS.

**ATUALIZACAO IMPORTANTE:** B3.3 (IPC escalas.ajustar reescrito) **JA ESTA IMPLEMENTADO** em tipc.ts:470-556. O handler ja recebe pinnedCells, spawna worker, e regenera. Atualizar status nas fases B.

### FUNC: Campos editaveis vs read-only

| Campo | Editavel? | Correto? |
|-------|-----------|----------|
| empresa.nome | ✅ Sim | ✅ |
| empresa.corte_semanal | ✅ Sim | ✅ (motor ignora — B1.1) |
| empresa.tolerancia | ✅ Sim | ✅ |
| tipo_contrato.* | ❌ Read-only | ❌ Precisa CRUD (UX-R1) |
| colab.evitar_dia_semana | ✅ Sim | ✅ (IPC aceita) |
| escala.pontuacao | Read-only | ✅ (calculado) |
| escala.indicadores | Read-only | ✅ (calculado) |

---

## CONSENSO ENTRE AGENTES

### Concordam (3/3):
- Dark mode e prioridade 1 do front
- PontuacaoBadge e o pior offender
- ThemeSwitcher.tsx e dead code — deletar
- Motor (BACK) e a area que MAIS precisa de trabalho
- ContratoLista precisa virar CRUD
- Regras CLT devem continuar hardcoded (correto)

### Descoberta importante (func-guardian):
- **Smart Recalc (B3.3 / RF6-RF8) JA ESTA IMPLEMENTADO**
- **RF9-RF15 JA ESTAO IMPLEMENTADOS**
- O front esta MUITO mais completo do que o ITERACAO.md original sugeria

### Conflitos (0):
Nenhum conflito entre agentes.

---

## PRIORIZACAO CONSOLIDADA (3 agentes) — SUPERSEDED

> **ATENCAO:** Esta priorizacao foi ATUALIZADA pela secao "ATUALIZACAO DA PRIORIZACAO (pos-delta)" mais abaixo.
> Mantida aqui como referencia historica da 1a rodada de auditoria.

### SPRINT CRITICO (Bloqueia producao)
1. Motor B1.1-B1.4 — Correcoes criticas
2. Motor B2.1-B2.5 — Robustez validador
3. Dark mode F1.1-F1.4 — 7 arquivos (1-2h)
4. ContratoLista CRUD — UX-R1

### SPRINT QUALIDADE
5. Motor B3.1-B3.2 — pinnedCells em todas as fases
6. Motor B4.1 — test-motor.ts
7. Validacoes Zod — FUNC-1
8. Quick wins UX — UX-A1 (demandas), UX-S2 (botao), UX-A2 (seed msg)

### SPRINT UX
9. SetorDetalhe tabs — UX-P3
10. Dashboard tabs — UX-P2
11. Sidebar "Escalas" — UX-P1
12. Pagina perfil — FUNC-5

### LIMPEZA
13. Deletar ThemeSwitcher.tsx
14. Padronizar Badge
15. Skeleton loading states
16. Tour com links
17. Remover placeholder ColaboradorDetalhe

---

*Auditoria realizada por 3 agentes em paralelo: shadcn-reviewer, ux-guardian, func-guardian (2026-02-14)*

---

# DELTA AUDIT (2026-02-14 — 2a rodada)

> Outro chat identificou 18 achados que faltavam no doc. Team de 3 agentes verificou cada um contra o codigo real.
> **7 REJEITADOS** (falsos ou desnecessarios), **6 ACEITOS**, **5 MODIFICADOS**.
> Abaixo: apenas os ACEITOS e MODIFICADOS (aprovados pelo operador).

## Items rejeitados (nao entram)

| # | Item | Motivo da rejeicao |
|---|------|--------------------|
| 3 | Dialogs sem DialogDescription | FALSO — todos os 5 dialogs TEM DialogDescription |
| 12 | Filtro colaborador na grid | Otimizacao prematura — setores tem 2-10 colabs |
| 13 | Sidebar Config merge | Mantém arquitetura — Contrato (CRUD) ≠ Empresa (singleton) |
| 15 | evitar_dia_semana no motor | FALSO — motor USA em 5+ lugares (gerador.ts:235,394,411 + validacao-compartilhada.ts:192-200) |
| 16 | ErrorBoundary global | FALSO — esta no App.tsx:22-34, wraps tudo |
| 17 | Export nao gera PDF | Design correto — window.print() e a solucao certa pro Electron |
| 18 | RF9 contradicao | RESOLVIDA — Avatar+DropdownMenu implementado em AppSidebar:164-254 |

---

## SHADCN-11: Empty States inconsistentes

- **O que:** 4 padroes diferentes de empty state: texto puro (Dashboard, SetorDetalhe), Icon+CTA (SetorLista, ColaboradorLista), Icon sem CTA (ContratoLista), texto+CTA inline (SetorDetalhe escala).
- **Onde:** Dashboard.tsx:81-83, SetorLista.tsx:206-215, ColaboradorLista.tsx:263-272, ContratoLista.tsx:35-44, SetorDetalhe.tsx:405-410/480-483/546-552
- **Proposta:** Criar componente `EmptyState` padronizado: `<EmptyState icon={X} title="..." description="..." action={<Button>...</Button>} />`
- **Impacto:** MEDIO
- **Esforco:** BAIXO (componente simples + substituir 7 ocorrencias)

---

## SHADCN-12: Remover componentes shadcn nao usados

- **O que:** collapsible, scroll-area, sheet — ZERO imports no projeto inteiro.
- **Onde:** `src/renderer/src/components/ui/{collapsible,scroll-area,sheet}.tsx`
- **Proposta:** Deletar os 3 arquivos. Se precisar no futuro, reinstala com `npx shadcn@latest add [componente]`.
- **Impacto:** BAIXO (limpeza)
- **Esforco:** BAIXO

---

## SHADCN-NOTA: Convencoes de UI (documentar, nao refatorar)

> Os items abaixo NAO sao inconsistencias — sao padroes que existem mas nao estavam documentados.

**Botoes (ghost vs outline):**
- `ghost` = Navegacao secundaria discreta + icon buttons
- `outline` = Acoes explicitas (CTAs, cancelar, restaurar)
- `default` = CTAs primarios

**Icon Scale:**
- `size-3` = Minimal (badges, inline)
- `size-3.5` = Standard (botoes)
- `size-4` = Medium (cards, headers)
- `size-5` = Large (destaque, stats)

---

## UX-C1: SetorDetalhe — 3 botoes pro mesmo lugar (BLOCKER)

- **O que:** "Abrir Escala", "Gerar Nova", e "Gerar Escala" — todos fazem `navigate` pro mesmo `/setores/:id/escala`. Labels sugerem acoes diferentes mas fazem a mesma coisa. Confunde o usuario.
- **Onde:** `SetorDetalhe.tsx:537-542` (Abrir Escala + Gerar Nova) e `SetorDetalhe.tsx:550` (Gerar Escala)
- **Proposta:** Unificar: se TEM escala ativa → 1 botao "Abrir Escala". Se NAO tem → 1 botao "Gerar Escala". Nunca 2+ botoes pro mesmo destino.
- **Impacto:** ALTO (confusao direta pro RH)
- **Esforco:** BAIXO (remover redundancia)
- **Status:** BLOCKER — resolver antes de entregar aos pais.

---

## UX-C2: Violacoes sem guidance (BLOCKER)

- **O que:** Botao "Oficializar" fica disabled quando tem HARD violations e mostra "Corrija X violacao(oes) critica(s)". Mas NAO explica COMO corrigir. `v.regra` retorna codigo tecnico (ex: "R1"). Usuario nao-tecnico nao sabe o que fazer.
- **Onde:** `EscalaPagina.tsx:710-756` (lista de violacoes) e `EscalaPagina.tsx:782` (mensagem)
- **Proposta:**
  1. Mapear regras pra texto humanizado: "R1" → "Trabalhou muitos dias seguidos sem folga"
  2. Adicionar dica de acao: "Clique em um dia de trabalho pra mudar pra folga"
  3. Highlight na grid: celulas violadas com borda vermelha
- **Impacto:** ALTO (pais do Marco vao ver "R1: MAX_DIAS_CONSECUTIVOS" e nao entender)
- **Esforco:** MEDIO
- **Status:** BLOCKER — resolver antes de entregar aos pais.

---

## UX-D1: Acoes Rapidas do Dashboard sao "falsas acoes"

- **O que:** 3 botoes de "Acoes Rapidas" (Gerar Nova Escala, Novo Colaborador, Novo Setor) so fazem `<Link>` — navegam pra outra pagina ao inves de executar acao. Usuario espera dialog inline, recebe redirect.
- **Onde:** `Dashboard.tsx:158-175`
- **Proposta:** Botoes abrem dialogs de criacao inline (dialog ja existe pra Colaborador e Setor). "Gerar Escala" abre seletor de setor → navega direto pra EscalaPagina.
- **Impacto:** MEDIO
- **Esforco:** BAIXO (dialogs ja existem, so reutilizar)

---

## UX-D2: Dashboard card sem atalho pra Escala

- **O que:** Card de setor no Dashboard mostra status da escala (via StatusBadge) e violacoes pendentes, mas o link vai pra `/setores/:id` (SetorDetalhe). Pra ver a escala, precisa de mais 2 cliques.
- **Onde:** `Dashboard.tsx:108-112`
- **Proposta:** Adicionar botao "Ver Escala" no card que linka direto pra `/setores/:id/escala`.
- **Impacto:** MEDIO (reduz 2 cliques)
- **Esforco:** BAIXO

---

## FUNC-6: Demandas e Excecoes sem UPDATE no front (gap conhecido)

- **O que:** IPC tem `setores.atualizarDemanda` e `excecoes.atualizar`, e o servico frontend `atualizarDemanda` EXISTE (setores.ts:26). Mas a UI (SetorDetalhe e ColaboradorDetalhe) so tem CRIAR e DELETAR. Gestora precisa deletar+recriar pra corrigir um erro.
- **Onde:** SetorDetalhe.tsx (demandas: linhas 265-296, UI 413-458), ColaboradorDetalhe.tsx (excecoes: linhas 161-193, UI 420-464)
- **Proposta:** Adicionar botao "Editar" em cada item da lista → abre dialog pre-preenchido. Backend e servico ja estao prontos.
- **Impacto:** BAIXO (deletar+recriar funciona, mas nao e elegante)
- **Esforco:** BAIXO (dialog de criacao ja existe, so preencher com dados existentes)
- **Status:** Known gap — validar com usuario se incomoda antes de implementar.

---

## UX-NH1: Duplicar escala oficial pra simulacao (nice-to-have v2.1)

- **O que:** Na aba Oficial da EscalaPagina, nao tem botao pra copiar alocacoes e abrir como novo rascunho. Workflow natural seria: escala oficial rodando → RH quer simular "e se" → duplica → ajusta → compara.
- **Onde:** `EscalaPagina.tsx` aba Oficial (linhas 425-482)
- **Proposta:** Botao "Duplicar pra Simulacao" que copia alocacoes da oficial e abre como rascunho.
- **Impacto:** MEDIO (completude de workflow)
- **Esforco:** MEDIO
- **Status:** NICE-TO-HAVE — mover pra v2.1. NAO e feature nova, e completude de fluxo existente.

---

## ATUALIZACAO DA PRIORIZACAO (pos-delta)

### ~~ORCHESTRATE 1: MOTOR + FUNDACAO (budget HIGH)~~ ✅ COMPLETO
> ~~Critério de saída: test-motor.ts passa 0 HARD violations em 4 setores.~~
> **CONCLUIDO** em 2026-02-14 — specs/005-motor-fundacao/ — QA APPROVED
> 14 subtasks, 5 fases, 10 testes (10 PASS / 0 FAIL / 0 SKIP)
> Extras: R4/R4b merge, withTimeout clearTimeout, testMaxMinutosDia, testPartialPinnedStreak

1. ~~**B4.1 scaffold** — Criar test-motor.ts basico~~ ✅
2. ~~Motor B1.1-B1.4 — Correcoes criticas~~ ✅
3. ~~Motor B2.1-B2.5 — Robustez validador~~ ✅
4. ~~Motor B3.1-B3.2 — pinnedCells em todas as fases~~ ✅
5. ~~**B4.1 expandido** — Todos os cenarios de teste~~ ✅ (10 testes)

### ORCHESTRATE 2: FRONT + BLOCKERS UX (budget MEDIUM) ✅ COMPLETO (orchestrate 006)
> Critério de saída: Dark mode 100%, zero texto tecnico visivel, ContratoLista editavel.
> **Status:** IMPLEMENTADO — specs/006-front-blockers-ux/ (QA APPROVED, iteracao 1, zero fixes)

6. ~~Dark mode F1.1-F1.5 — Todas as cores hardcoded corrigidas + deletar dead code~~ ✅
   - 13 instancias de cores fixadas em 6 arquivos (8 mapeadas + 5 achadas pelo sweep)
   - PontuacaoBadge, EscalaPagina, ColaboradorLista (CORES_GENERO), ColaboradorDetalhe (CORES_EXCECAO), Dashboard, SetorLista
   - ThemeSwitcher.tsx deletado (51 linhas dead code, 0 imports)
7. ~~**F6.1** — SetorDetalhe 3 botoes → 1 botao condicional (BLOCKER)~~ ✅
   - 3 botoes confusos → 1 condicional ("Abrir Escala" se existe / "Gerar Escala" se nao)
8. ~~**F6.2** — Violacoes com texto humanizado + borda vermelha na grid (BLOCKER)~~ ✅
   - REGRAS_TEXTO: 10 regras mapeadas pra portugues em formatadores.ts
   - ViolacoesAgrupadas: cards agrupados por COLABORADOR (nao por regra)
   - Grid highlighting: violatedCells Set → ring-2 ring-destructive (so HARD)
   - HARD/SOFT separados visualmente (CORES_VIOLACAO)
   - Dica de acao: "Clique em um dia de trabalho para trocar por folga"
9. ~~**F6.3** — ContratoLista CRUD completo (BLOCKER)~~ ✅
   - 108 → 360 linhas: Dialog criar/editar (5 campos), AlertDialog deletar, disclaimer CLT
   - max_minutos_dia helper: "9h30 = 570 minutos"
   - Delete com safety: erro humanizado se colabs vinculados
   - Empty state: "Crie um template para comecar" (sem "rode o seed")
10. ~~Fase F4 — Error messages humanizadas (mapError completo)~~ ✅
    - mapError() expandido: timeout, generic fallback, violacoes
    - Zero stack traces pro usuario

> **INSIGHTS POS-005 (impacto do orchestrate anterior nos items acima):**
>
> **Item 6 (F1 Dark mode):** 4 arquivos com cores hardcoded: PontuacaoBadge.tsx (3 combos emerald/red/amber),
> EscalaPagina.tsx (5 badges/indicadores), ColaboradorLista.tsx (4 badges/avatares), ColaboradorDetalhe.tsx (3 icones excecao).
> Pattern ja existe em `cores.ts` com dark variants — so migrar pra la. 005 NAO impactou (motor only).
>
> **Item 7 (F6.1 Botoes):** Confirmado: SetorDetalhe.tsx:537-551. "Abrir Escala" + "Gerar Nova" quando
> escala existe, "Gerar Escala" quando nao. Fix simples: condicional unico. 005 NAO impactou.
>
> **Item 8 (F6.2 Violacoes):** ⚠️ MAIOR IMPACTO DO 005. Tres mudancas criticas:
> 1. Nomes de regra MUDARAM. Motor agora emite 10 nomes exatos (nao "R1", "R2"...):
>    HARD: `MAX_DIAS_CONSECUTIVOS`, `DESCANSO_ENTRE_JORNADAS`, `RODIZIO_DOMINGO`,
>    `ESTAGIARIO_DOMINGO`, `CONTRATO_MAX_DIA`, `MAX_JORNADA_DIARIA`
>    SOFT: `META_SEMANAL`, `PREFERENCIA_DIA`, `PREFERENCIA_TURNO`, `COBERTURA`
> 2. R4/R4b merge = UMA violacao por celula (sem duplicata). `CONTRATO_MAX_DIA` se
>    contrato < CLT, `MAX_JORNADA_DIARIA` se CLT e mais restritivo.
> 3. Decisao de agrupar por COLABORADOR (cards por pessoa, nao por regra).
> O componente atual (EscalaPagina:710-756) mostra `v.regra + " - " + v.colaborador_nome` —
> vai mostrar `MAX_DIAS_CONSECUTIVOS - Joao Silva`. F6.2 vai trocar isso por cards humanizados.
> `CORES_VIOLACAO` ja existe em `cores.ts` com HARD/SOFT styling.
>
> **Item 9 (F6.3 ContratoLista):** Pagina atual: 108 linhas, read-only, so lista com Card/CardContent.
> IPC 100% pronto: `tiposContrato.criar`, `.atualizar`, `.deletar` (com safety check de colabs vinculados).
> ⚠️ INSIGHT DO 005: `max_minutos_dia` agora e USADO ATIVAMENTE pelo R4 merge.
> Se gestora editar de 570→480, proxima escala gerada vai respeitar o novo limite.
> O disclaimer CLT no dialog de edicao e CRITICO — gestora precisa entender
> que mudar o limite do contrato afeta TODAS as escalas futuras daquele tipo.
>
> **Item 10 (F4 Error messages):** `formatadores.ts` ja tem `mapError()` com pattern pra
> "violacoes criticas". Precisa mapear os 10 nomes de regra do motor pra portugues.
> Pode reaproveitar o mapa de F6.2 (mesma tabela regra→texto humano).

### PIT-STOP: AUDITORIA shadcn COMPOSITION (pos-006, pre-007) ✅ COMPLETO (pit-stop shadcn)
> **Status:** ✅ COMPLETO — 6 fixes aplicados, 2 novos componentes criados, 1 shadcn instalado
> **Origem:** Auditoria holistica pos-006. Agentes fizeram tudo funcionar mas pensaram ARQUIVO por ARQUIVO, nao SISTEMA por SISTEMA.
> **Principio:** shadcn e composicao, nao decoracao. Componentes sao blocos reutilizaveis. Se `<Avatar>` existe, nao criar div manual que faz a mesma coisa.

**O QUE JA ESTA BOM (referencia de composicao correta):**
- ✅ AppSidebar.tsx — Avatar + DropdownMenu + SidebarFooter. Composicao exemplar.
- ✅ Dialog/AlertDialog no ContratoLista — imports, estrutura, DialogHeader/Footer corretos.
- ✅ EscalaGrid — composicao limpa, props claras.

**O QUE PRECISA CORRIGIR (6 items):**

| # | Arquivo | Problema | Fix | Status |
|---|---------|----------|-----|--------|
| SC-1 | PontuacaoBadge.tsx | Reinventa `<Badge>` com `<span>` manual | Usar `<Badge variant="outline" className={cn(color)}>` | ✅ |
| SC-2 | EscalaPagina ViolacoesAgrupadas | Div manual em vez de `<Avatar>` (instalado!) | `<Avatar><AvatarFallback>{iniciais}</AvatarFallback></Avatar>` | ✅ |
| SC-3 | ContratoLista card | Pula CardHeader/CardTitle, usa h3 manual | Reestruturar: Card > CardHeader > CardTitle + actions | ✅ |
| SC-4 | EscalaPagina 5 indicator cards | Pattern repetido 5x sem extrair bloco | Extrair `<IndicatorCard icon value label colorClass />` | ✅ |
| SC-5 | ContratoLista 4 metric items | Pattern repetido 4x sem extrair bloco | Extrair `<MetricItem icon value label />` | ✅ |
| SC-6 | ContratoLista CLT disclaimer | Card como Alert (cores inline) | Instalar Alert (`npx shadcn@latest add alert`) | ✅ |

**Detalhes da execucao:**
- SC-1: PontuacaoBadge span → Badge variant="outline" ✅
- SC-2: ViolacoesAgrupadas div → Avatar/AvatarFallback ✅
- SC-3: ContratoLista Card → CardHeader/CardTitle ✅
- SC-4: 5 indicator cards → IndicatorCard component extraido ✅
- SC-5: 4 metric items → MetricItem component extraido ✅
- SC-6: CLT disclaimer → Alert/AlertDescription instalado ✅
- Novos componentes: IndicatorCard.tsx, MetricItem.tsx
- shadcn instalado: alert.tsx, form.tsx

**REGRA PRO PROXIMO ORCHESTRATE:** Todo agente coder DEVE:
1. Verificar se componente shadcn ja existe antes de criar div manual
2. Usar subcomponentes (CardHeader, CardTitle, AvatarFallback) em vez de divs
3. Extrair pattern repetido 3+ vezes como componente
4. Preferir tokens semanticos (destructive, muted, primary) a cores hardcoded

**DECISAO:** Resolver SC-1 a SC-6 como **Fase 0** do orchestrate 3, ANTES dos items 11-19. Isso garante que o padrao esteja correto antes de adicionar mais features.

---

### ORCHESTRATE 3: POLISH + QUALIDADE (budget MEDIUM) ✅ COMPLETO (orchestrate 007)
> Critério de saída: QG1+QG2+QG3 passam (jornada completa do usuario).
> **CONCLUIDO** em 2026-02-15 — Items 11-19 todos implementados e verificados.

11. ~~FUNC-1 — Formularios shadcn Form + Zod (7 formularios)~~ ✅
    - 7 forms migrados: SetorLista, SetorDetalhe, ColaboradorLista, ColaboradorDetalhe, ContratoLista, EmpresaConfig, Perfil
    - shadcn Form + react-hook-form + @hookform/resolvers + Zod
12. ~~Quick wins UX — UX-A1, UX-S2, UX-A2, UX-A3~~ ✅
    - UX-A1: Alert + disable "Gerar" se sem demandas
    - UX-S2: Botao visivel no SetorDetalhe
    - UX-A2: "Nenhum template cadastrado" (sem "rode o seed")
    - UX-A3: Placeholder "Historico de Escalas" removido
13. ~~UX-D1 — Acoes Rapidas Dashboard com dialogs inline~~ ✅
    - "Gerar Nova Escala" abre Dialog com seletor de setor
    - Outros botoes abrem dialogs inline
14. ~~UX-D2 — Dashboard card com atalho pra escala~~ ✅
    - Botao "Ver Escala" no card (so quando escala existe)
15. ~~SHADCN-11 — Empty States padronizado~~ ✅
    - Componente EmptyState.tsx criado (icon, title, description, action)
    - Aplicado em 8 locais: Dashboard, SetorLista, ColaboradorLista, ContratoLista, SetorDetalhe x3, ColaboradorDetalhe
16. ~~SHADCN-12 + F1.5 — Remover shadcn nao usados + dead code~~ ✅
    - Deletados: collapsible.tsx, scroll-area.tsx
    - sheet.tsx MANTIDO (usado por sidebar.tsx)
    - ThemeSwitcher.tsx ja deletado no 006
17. ~~SHADCN-8 — Padronizar Badge entre paginas~~ ✅
    - Todos usando CORES_VIOLACAO.SOFT/HARD de cores.ts
    - ColaboradorLista prefere_turno usa Badge outline
18. ~~Pagina perfil — FUNC-5 (F5.1)~~ ✅
    - Rota /perfil no App.tsx
    - Avatar com iniciais + nome (localStorage) + empresa (IPC read-only)
    - Link "Meu Perfil" no dropdown do AppSidebar
    - Zod form validation
19. ~~QA Geral — QG1+QG2+QG3~~ ✅
    - QG1: Jornada completa 15 steps PASS
    - QG2: Motor 10/10 PASS (bug minutos null fixado)
    - QG3: tsc 0 erros, build OK

> **INSIGHTS POS-005 (impacto no ORCHESTRATE 3):**
>
> **Item 11 (Zod schemas):** 005 expandiu `ColabValidacao` com `max_minutos_dia`, `dias_trabalho`,
> `trabalha_domingo`. Os schemas Zod dos formularios de Colaborador e TipoContrato precisam
> validar esses campos (min/max ranges). Nao e impacto direto, mas e contexto util.
>
> **Items 12-15 (UX/SHADCN):** Sem impacto do 005 — sao todos front-only.
>
> **Item 16 (Remover dead code):** ThemeSwitcher.tsx confirmado como dead code (nunca importado).
> Verificar se algum import de `cores.ts` foi adicionado pelo 005 que deveria ser limpo.
>
> **Item 19 (QA Geral):** test-motor.ts com 10 testes e o baseline do motor. QG1-QG3 sao
> jornadas de USUARIO (frontend). Rodar o app Electron e testar manualmente:
> - QG1: Cadastro setor → gerar escala → ajustar → oficializar
> - QG2: Editar contrato (F6.3) → gerar escala → verificar que novo limite funciona
> - QG3: Dark mode toggle → todas as paginas legiveis

### BACKLOG (decisao pendente — NAO entra em orchestrate)
20. UX-P3 — SetorDetalhe tabs (PROPOSTA — precisa decisao)
21. UX-P2 — Dashboard tabs por setor (PROPOSTA — precisa prototipo)
22. UX-P1 — Sidebar link "Escalas" (PROPOSTA — depende de UX-P2)
23. SHADCN-7 — Skeleton loading states (opcional)
24. UX-S3 — Tour com links clicaveis (opcional)
25. FUNC-6 — Demandas/Excecoes UPDATE no front (validar com usuario)

### KNOWN GAPS (validar antes)
24. Demandas/Excecoes sem UPDATE — FUNC-6 (validar com usuario)

### NICE-TO-HAVE (v2.1)
25. Duplicar escala pra simulacao — UX-NH1

### ITEMS JA IMPLEMENTADOS (confirmados)
- ~~B1.1~~ corte_semanal no motor → ✅ IMPLEMENTADO (orchestrate 005)
- ~~B1.2~~ max_minutos_dia + R4/R4b merge → ✅ IMPLEMENTADO (orchestrate 005)
- ~~B1.3~~ Repair nao sobrescreve pins → ✅ IMPLEMENTADO (orchestrate 005)
- ~~B1.4~~ threshold >=6 → >6 → ✅ IMPLEMENTADO (orchestrate 005)
- ~~B2.1~~ Lookback no validador → ✅ IMPLEMENTADO (orchestrate 005)
- ~~B2.2~~ Estagiario domingo HARD → ✅ IMPLEMENTADO (orchestrate 005)
- ~~B2.3~~ Timeout worker 30s → ✅ IMPLEMENTADO (orchestrate 005)
- ~~B2.4~~ Input validation gerador → ✅ IMPLEMENTADO (orchestrate 005)
- ~~B2.5~~ calcMetaDiariaMin compartilhado → ✅ IMPLEMENTADO (orchestrate 005)
- ~~B3.1~~ pinnedCells em todas as fases → ✅ IMPLEMENTADO (orchestrate 005)
- ~~B3.2~~ Worker deserializa pinnedCells → ✅ IMPLEMENTADO (orchestrate 005)
- ~~B3.3~~ IPC escalas.ajustar → ✅ IMPLEMENTADO
- ~~B4.1~~ test-motor.ts 10 testes → ✅ IMPLEMENTADO (orchestrate 005)
- ~~F2.1-F2.3~~ Grid interativa → ✅ IMPLEMENTADO (RF14)
- ~~F3.1-F3.2~~ Onboarding Tour → ✅ IMPLEMENTADO (RF13)
- ~~RF9~~ Avatar+Dropdown → ✅ IMPLEMENTADO
- ~~RF10~~ Theme Switcher → ✅ IMPLEMENTADO (inline no AppSidebar)
- ~~RF11~~ Loading States → ✅ IMPLEMENTADO
- ~~RF14~~ Grid interativa → ✅ IMPLEMENTADO
- ~~RF15~~ Auto-fill periodo → ✅ IMPLEMENTADO
- ~~F1.1-F1.5~~ Dark mode 100% (13 instancias) → ✅ IMPLEMENTADO (orchestrate 006)
- ~~F1.5~~ ThemeSwitcher.tsx dead code deletado → ✅ IMPLEMENTADO (orchestrate 006)
- ~~F4.1~~ mapError() expandido + REGRAS_TEXTO 10 entradas → ✅ IMPLEMENTADO (orchestrate 006)
- ~~F6.1~~ SetorDetalhe 3 botoes → 1 condicional → ✅ IMPLEMENTADO (orchestrate 006)
- ~~F6.2~~ Violacoes humanizadas agrupadas por colaborador → ✅ IMPLEMENTADO (orchestrate 006)
- ~~F6.3~~ ContratoLista CRUD completo com disclaimer CLT → ✅ IMPLEMENTADO (orchestrate 006)
- ~~SC-1..SC-6~~ Pit-stop shadcn composition (6 fixes) → ✅ IMPLEMENTADO (pit-stop pre-007)
- ~~FUNC-1~~ 7 formularios Zod + shadcn Form → ✅ IMPLEMENTADO (orchestrate 007)
- ~~SHADCN-11~~ EmptyState padronizado (8 locais) → ✅ IMPLEMENTADO (orchestrate 007)
- ~~SHADCN-12~~ Remover shadcn nao usados → ✅ IMPLEMENTADO (orchestrate 007)
- ~~SHADCN-8~~ Badge padronizado → ✅ IMPLEMENTADO (orchestrate 007)
- ~~F5.1~~ Pagina perfil com Avatar + Zod → ✅ IMPLEMENTADO (orchestrate 007)
- ~~UX-D1~~ Dashboard dialogs inline → ✅ IMPLEMENTADO (orchestrate 007)
- ~~UX-D2~~ Dashboard atalho escala → ✅ IMPLEMENTADO (orchestrate 007)
- ~~UX-A1~~ Demandas pre-geracao + alerta → ✅ IMPLEMENTADO (orchestrate 007)
- ~~UX-A2~~ Mensagem seed humanizada → ✅ IMPLEMENTADO (orchestrate 007)
- ~~UX-A3~~ Placeholder removido → ✅ IMPLEMENTADO (orchestrate 007)
- ~~UX-S2~~ Botao visivel SetorDetalhe → ✅ IMPLEMENTADO (orchestrate 007)
- ~~QG1+QG2+QG3~~ QA geral PASS → ✅ VERIFICADO (orchestrate 007)

---

*Delta audit realizado por 3 agentes: shadcn-reviewer, ux-guardian, func-guardian (2026-02-14 — 2a rodada)*
*7 rejeitados, 6 aceitos, 5 modificados. Aprovado pelo operador.*

*Orchestrate 005 (Motor + Fundacao) COMPLETO — 2026-02-14. B1-B4 todos marcados [x].*
*Extras pos-orchestrate: R4/R4b merge, withTimeout clearTimeout, testMaxMinutosDia, testPartialPinnedStreak.*

*Orchestrate 006 (Front + Blockers UX) COMPLETO — 2026-02-15. Items 6-10 todos marcados [x].*
*13 subtasks, 4 fases, 10 arquivos modificados, 1 deletado. QA approved iteracao 1.*
*Auditoria pos-006: 6 gaps de composicao shadcn (SC-1 a SC-6) → resolver no pit-stop pre-007.*

*Pit-stop SC-1..SC-6 COMPLETO — 2026-02-15. 6 fixes shadcn composition, 2 novos componentes (IndicatorCard, MetricItem), 1 shadcn instalado (Alert).*
*Orchestrate 007 (Polish + Qualidade) COMPLETO — 2026-02-15. Items 11-19 todos marcados [x].*
*7 forms Zod, EmptyState 8 locais, Dashboard dialogs, Perfil page, dead code cleanup, motor fix minutos null.*
*QG1+QG2+QG3 PASSAM: tsc 0 erros, build OK, motor 10/10 PASS.*
*Sistema pronto para teste com usuarios (pais do Marco).*

*Documento vivo. Atualizar conforme iteracao.*
