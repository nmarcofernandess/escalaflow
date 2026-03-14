# BACKLOG — Painel Unico de Escala

> Tudo que foi levantado na sessao de 2026-03-14 (14h de debate Marco x Monday)
> e que AINDA NAO FOI IMPLEMENTADO ou que precisa de decisao futura.
> Ref: `docs/ANALYST_PAINEL_UNICO_ESCALA.md` (38 secoes)
> Warlog: `specs/WARLOG_PAINEL_UNICO.md` (30 tasks)

---

## 1. INFRAESTRUTURA — Context Provider Global

### NAO IMPLEMENTADO
- [ ] AppDataStore (Zustand) com entidades globais + por setor
- [ ] Derivados automaticos (N, K, ciclo, cobertura, demanda, avisos)
- [ ] IPC `data:invalidated` em tipc.ts (toda mutacao emite)
- [ ] IPC `data:invalidated` em tools.ts (toda tool WRITE emite)
- [ ] Listener global em App.tsx
- [ ] useAppData() hook seletor tipado
- [ ] Migrar 50+ useApiData → useAppData (SetorDetalhe, EscalaPagina, Dashboard, etc)
- [ ] Snapshot do store pro IaContexto (discovery le ao inves de 15+ queries/msg)
- [ ] Eliminar 5 tools redundantes da IA (listar_memorias, consultar setores/feriados/regras, obter_alertas)

### DECISOES PENDENTES
- Granularidade do store: 1 store global ou 1 por dominio?
- Persistencia do store: reset ao trocar setor ou manter tudo?
- TTL do cache: quanto tempo sem invalidar?

---

## 2. LOGICA DO CICLO

### NAO IMPLEMENTADO
- [ ] **Fix folga_fixa=DOM no solver** — pular XOR, ciclo, dom_max pra pessoa com fixa=DOM
  - `add_folga_variavel_condicional`: skip se fixa==DOM
  - `add_domingo_ciclo_hard/soft`: skip se fixa==DOM
  - Bridge: zerar ciclo + nullar variavel se fixa=DOM
  - TS: tratar como caso especial (2 folgas fixas, sem rodizio)
- [ ] **add_dom_max_consecutivo** — IMPORTADO MAS NUNCA CHAMADO no solver. Implementar chamada real.
- [ ] **autoFolgaInteligente** — distribuir folgas baseado na demanda, nao p%6
  - Pseudo-codigo existe no ANALYST secao 23.4
  - PRECISA de decisao do Marco sobre heuristica
- [ ] **Elegibilidade domingo variavel por semana** — N_dom por semana, nao constante
  - Considerar ferias, atestados, bloqueios, excecao domingo_forcar_folga
  - Interface ElegibilidadeDomingo no ANALYST secao 37.4
- [ ] Guard solver: funcao_id=null nao entra na escala (verificar se buildSolverInput carrega)
- [ ] Guard: tipo_trabalhador derivado do contrato (prevenir CLT em intermitente)

### VERIFICADO E FUNCIONANDO
- [x] calcularCicloDomingo na bridge (tenta 1/2 → 1/1 → 2/1)
- [x] XOR same-week (offset negativo)
- [x] folga-inference same-week
- [x] H3_DOM_MAX_CONSEC no seed (regra_definicao)
- [x] checkH3 por sexo no validador
- [x] checkH10 guard horas_semanais=0
- [x] periodoCiclo filtra titular + INTERMITENTE
- [x] FolgaSelect filtra DOM na variavel
- [x] gerarCicloFase1 com folgas_forcadas

### PARCIALMENTE IMPLEMENTADO (VERIFICAR ESTADO REAL)
- [~] pinned_folga_externo — tipo existe no TS, Python NAO le. Handler tipc aceita. Mecanismo incompleto.
- [~] salvarPadraoFolgas — handler pode existir mas sem `force` param verificado
- [~] SimuladorCicloGrid — ainda importado no SetorDetalhe, deveria morrer

---

## 3. UI/UX — Painel Unico

### NAO IMPLEMENTADO
- [ ] **Prototipar layout do painel unico progressivo** — mockup ANTES de codar
  - Empty state → preview → avisos → solver → oficializado
  - Cada transicao muda o que aparece
- [ ] **Preflight itens minimos na UI** — JA ESQUECIDO 6X. NUNCA MAIS.
  - Aparece ACIMA de tudo se faltam dados
  - NAO some quando aparece preview
- [ ] **CicloGrid unificado** — 1 componente com mode view/edit/export/print
  - Substitui EscalaCicloResumo + SimuladorCicloGrid
  - Formato CicloGridData unificado
- [ ] **Padronizar siglas** — FF/FV/DT/DF em todos os lugares (hoje: [F]/(V)/F em exports)
- [ ] **Linha DEMANDA embaixo COBERTURA** — deficit pintado de vermelho
- [ ] **Area de avisos separada** — formato padrao com contexto_ia
  - Taxonomia de codigos: COB_DEFICIT_SEG, TT_ALEX_S3, etc
  - Sem duplicacao, cada aviso com identidade
  - Acessivel pela IA via discovery
- [ ] **Diff validar/solucionar** — componente com atual vs proposta
  - Aceitar/Descartar
  - Hierarquia: manual > auto > default
  - Estado temporario (React state ou localStorage)
  - PRECISA de contrato de componente (props, estados, persistencia)

### DECISOES PENDENTES
- Layout do painel: quais estados existem? Como transiciona?
- Diff: como persiste? localStorage? React state?
- Avisos: bloqueiam Gerar ou so informam?
- Modo inteligente (toggle sugestoes): quando implementar?

---

## 4. MENSAGENS DE ERRO DO SOLVER

### NAO IMPLEMENTADO
- [ ] **InfeasibleDiagnostico estruturado** — substituir mensagem generica
  - Interface com causas[], sugestoes[], capacidade, regras_que_resolvem
  - 16 constraints catalogadas com mensagem bonita cada (ANALYST secao 25.3)
- [ ] **diagnosticar_infeasible AUTOMATICO** — rodar quando solver falha (hoje so IA chama)
- [ ] De 13 tipos de erro, 8 sao evitaveis pelo TS pre-flight

---

## 5. PYTHON HTTP (futuro)

### NAO IMPLEMENTADO — NICE TO HAVE
- [ ] Servidor Python persistente (FastAPI) ao inves de spawn por geracao
- [ ] Endpoint /validate (checa viabilidade do pinned em 1-2s sem gerar escala)
- [ ] Endpoint /phase1 (roda Phase 1 on-demand)
- [ ] Validacao real-time (~1-2s por request)
- [ ] Cache de modelo entre geracoes

---

## 6. PENDENCIAS ESPECIFICAS DESTA ETAPA

### Descobertas que precisam voltar
- [ ] **Demanda por faixa e leitura visual** — viabilidade/custo-beneficio de pessoa extra por pico curto (ANALYST secao 12.2)
- [ ] **Modo inteligente** — toggle no componente que mostra sugestoes de otimizacao (ANALYST secao 13)
- [ ] **Warm-start / hints da ultima escala** — ja existe no solver, verificar se funciona corretamente
- [ ] **Divergencia preview vs solver** — por reserva/posto/colaborador ativo. N_dom pode divergir.
- [ ] **Aceitar/cancelar solucao proposta** — fluxo de decisao local vs banco
- [ ] **Descarte de tentativa local** — como voltar ao estado anterior sem perder config

### Bugs conhecidos NAO resolvidos
- [ ] Solver pode carregar colabs sem posto (funcao_id=null) — verificar query
- [ ] Manoel no banco REAL pode ter tipo_trabalhador='CLT' — verificar e corrigir
- [ ] Preview nao reage quando muda demanda (useApiData stale) — resolve com Context
- [ ] SimuladorCicloGrid ainda importado no SetorDetalhe — matar

### Docs criados nesta sessao
- `docs/ANALYST_PAINEL_UNICO_ESCALA.md` — 38 secoes, spec principal
- `docs/diferenca-gerarciclo-com-sem-info.md` — prova de conceito pra Gracinha
- `docs/BUILD_CICLO_V3_FONTE_UNICA.md` — BUILD anterior (parcialmente implementado)
- `specs/WARLOG_PAINEL_UNICO.md` — warlog com 30 tasks em 3 dominios
- `specs/STATUS.md` — status compartilhado entre Claudes
- `specs/prompts/PROMPT_CLAUDE_{A,B,C}_*.md` — prompts pros 3 Claudes

---

*Atualizado: 2026-03-14 18:00*
