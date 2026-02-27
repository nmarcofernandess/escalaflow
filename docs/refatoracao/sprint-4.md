# SPRINT 4: UX SIMPLIFICADA — A REFATORACAO VISUAL

> Sprint mais complexo da refatoracao. Toca 15+ arquivos, reorganiza a pagina principal,
> protege o leigo de si mesmo, e adiciona dirty state que nunca existiu.
> Cada fase termina com `npm run typecheck` 0 erros.

---

## TL;DR EXECUTIVO

O pai do Marco abre o app, clica no setor, clica "Gerar Escala", ve "Escala gerada com sucesso!",
clica "Exportar", pronto. 3 cliques. Sem drawer de 35 regras. Sem modal de preflight.
Sem KPIs que ninguem entende. Sem sidebar com botao que quebra o motor.

**Hoje:** ~8-10 cliques, 3 modais intermediarios, 35 toggles expostos, zero protecao contra sair sem salvar.
**Depois:** 3 cliques, 0 modais desnecessarios, config escondida, dirty state em todos os forms.

---

## MAPA VISUAL: ANTES vs DEPOIS

### EscalaPagina — ANTES (hoje)

```
┌──────────────────────────────────────────────────────────────────┐
│ PageHeader: Setores > Padaria > Escala                           │
├──────────────────────────────────────────────────────────────────┤
│ Tabs: [Simulacao] [Oficial] [Historico]                          │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─ CARD: Configurar Geracao ──────────────────────────────────┐ │
│  │  Data Inicio [____]  Data Fim [____]                        │ │
│  │  [Cenario 5x2/6x1 ▼]  [⚙ Config]  [▶ Gerar Escala]       │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌─ CARD: Solver Terminal (aparece gerando) ───────────────────┐ │
│  │  > Gerando Pass 1... 8 colabs x 36 dias...                 │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌─ 5x IndicatorCards (Score, Cobertura, CLT, AP, Equidade) ──┐ │
│  │  [87]  [92%]  [2 ⚠]  [1 ⚠]  [85%]                        │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌─ RuleComplianceBadge ──────────────────────────────────────┐ │
│  │  🛡 Regras [CLT 12/12] [SOFT 5/7] [AP 8/10]               │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌─ ResumoFolgas ─────────────────────────────────────────────┐ │
│  │  Folgas fixas: SEG(2) TER(1) ...                           │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌─ CARD: Grid da Escala ─────────────────────────────────────┐ │
│  │  Header: Titulo + Badge Rascunho + ViewToggle + Pontuacao  │ │
│  │  ┌────────────────────────────────────────────────────────┐ │ │
│  │  │ GRID COMPLETO (todos colabs x todos dias)              │ │ │
│  │  │ Clicavel, com postos dentro das celulas                │ │ │
│  │  └────────────────────────────────────────────────────────┘ │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌─ CARD: Violacoes (colapsavel) ─────────────────────────────┐ │
│  │  ▶ Violacoes (3) — clique pra expandir                     │ │
│  │  ┌──────────────────────────────────────────────────────┐   │ │
│  │  │  [Avatar] Joao: H1 — 7 dias consecutivos sem folga  │   │ │
│  │  │  [Avatar] Maria: SOFT — Turno preferido nao atendido │   │ │
│  │  └──────────────────────────────────────────────────────┘   │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌─ CARD: Planejado x Executado ──────────────────────────────┐ │
│  │  7 barras de progresso, delta por dia...                    │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌─ CARD: Por que? (decisoes + antipatterns) ─────────────────┐ │
│  │  Lista de 50 decisoes do motor...                           │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌─ BOTOES: Oficializar | Exportar | Imprimir | Descartar ───┐ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  [ExportModal: 15 props, 5 formatos, 2 toggles inuteis]         │
│  [SolverConfigDrawer: 35 toggles, solve_mode, max_time]         │
│  [AlertDialog: Preflight warnings — modal bloqueante]            │
│  [AlertDialog: Regerar — escala desatualizada]                   │
└──────────────────────────────────────────────────────────────────┘

PROBLEMAS:
- 5 KPI cards que leigo nao entende
- RuleComplianceBadge ("CLT 12/12") = ruido
- PontuacaoBadge ("Score 87") = ruido
- Violacoes, Comparacao, Decisoes = TUDO na view principal
- 2 date pickers manuais (default 1 mes, deveria ser 3)
- Dropdown "Cenario 5x2/6x1" por colaborador
- Botao ⚙ que abre drawer com 35 toggles
- Preflight warning modal bloqueante
- Exportar abre modal com 15 props
- ~8 cards empilhados = scroll infinito
```

### EscalaPagina — DEPOIS (proposto)

```
┌──────────────────────────────────────────────────────────────────┐
│ PageHeader: Setores > Padaria > Escala                           │
├──────────────────────────────────────────────────────────────────┤
│ Tabs: [Simulacao] [Oficial] [Historico]                          │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─ GERAR (compacto) ─────────────────────────────────────────┐ │
│  │  Mar 2026 — Mai 2026 (3 meses) [Alterar]  [▶ Gerar]       │ │
│  │  (⚙ Avancado — so aparece se clicar "Alterar")             │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌─ RESULTADO BANNER ─────────────────────────────────────────┐ │
│  │  ✅ Escala gerada com sucesso!              [Exportar ▼]   │ │
│  │  ou                                                         │ │
│  │  ⚠ Escala gerada com 3 avisos. [Ver resumo] [Exportar ▼]  │ │
│  │  ou                                                         │ │
│  │  🔴 MODO EMERGENCIA — CLT minimo.  [Ver resumo] [💬 IA]   │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌─ GRID DA ESCALA ───────────────────────────────────────────┐ │
│  │  Header: Titulo + Badge + ViewToggle                        │ │
│  │  ┌────────────────────────────────────────────────────────┐ │ │
│  │  │ GRID LIMPO (read-only, sem ruido)                      │ │ │
│  │  └────────────────────────────────────────────────────────┘ │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌─ ACOES ────────────────────────────────────────────────────┐ │
│  │  [✓ Oficializar]                          [🗑 Descartar]   │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌─ RESUMO (colapsavel — FECHADO por default) ────────────────┐ │
│  │  ▶ Resumo Detalhado (3 avisos)                              │ │
│  │  ┌──────────────────────────────────────────────────────┐   │ │
│  │  │ ViolacoesAgrupadas                                   │   │ │
│  │  │ IndicatorCards (5)                                    │   │ │
│  │  │ RuleComplianceBadge                                   │   │ │
│  │  │ Comparacao Demanda                                    │   │ │
│  │  │ Decisoes do Motor                                     │   │ │
│  │  │ ResumoFolgas                                          │   │ │
│  │  └──────────────────────────────────────────────────────┘   │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  [Preflight: SILENCIOSO — so aparece se BLOQUEIO]                │
│  [SolverConfigDrawer: EXISTE, mas botao escondido por default]   │
│  [ExportModal: MORTO — dropdown direto no banner]                │
└──────────────────────────────────────────────────────────────────┘

GANHOS:
- Banner resume TUDO em 1 frase
- Grid e a UNICA coisa na view principal
- Resumo existe mas FECHADO (quem quer, abre)
- Exportar e dropdown no banner (0 modais)
- Preflight so aparece se impedir geracao
- Config de regras sumiu da view (IA ajusta)
- 3 meses default (nao 1)
- Scroll minimo: Banner + Grid + Acoes = 1 tela
```

### Sidebar — ANTES vs DEPOIS

```
ANTES:                              DEPOIS:
┌─────────────────────┐             ┌─────────────────────┐
│ 🏠 Dashboard        │             │ 🏠 Dashboard        │
│ 🏢 Setores          │             │ 🏢 Setores          │
│ 👥 Colaboradores    │             │ 👥 Colaboradores    │
│ 📅 Escalas          │             │ 📅 Escalas          │
│ 🤖 Assistente IA    │             │ 🤖 Assistente IA    │
│                     │             │                     │
│ ─── Configuracao ─  │             │ ─── Configuracao ─  │
│ 📝 Tipos Contrato  ◄── PERIGO    │ 📅 Feriados         │
│ 📅 Feriados         │             │                     │
│ ⚙ Regras          ◄── PERIGO    │ ─── (footer) ────── │
│ 🧠 Memoria         ◄── DEV      │ [Avatar] Empresa    │
│                     │             │  ├─ Tema            │
│ ─── (footer) ────── │             │  ├─ Empresa         │
│ [Avatar] Empresa    │             │  ├─ Configuracoes   │
│  ├─ Tema            │             │  └─ Como Funciona?  │
│  ├─ Empresa         │             │                     │
│  ├─ Configuracoes   │             │ (Escondidos:        │
│  └─ Como Funciona?  │             │  Tipos Contrato,    │
└─────────────────────┘             │  Regras, Memoria    │
                                    │  → acessiveis via   │
                                    │  /configuracoes     │
                                    │  secao "Avancado")  │
                                    └─────────────────────┘

MUDANCAS:
- "Tipos de Contrato" sai da sidebar → vai pra Configuracoes (secao Avancado)
- "Regras" sai da sidebar → vai pra Configuracoes (secao Avancado)
- "Memoria" sai da sidebar → vai pra Configuracoes (secao Avancado)
- Feriados permanece (leigo precisa ver/editar feriados)
- Footer inalterado
```

### ColaboradorDetalhe — ANTES vs DEPOIS

```
ANTES (scroll infinito, 7 cards):       DEPOIS (3 tabs, ~2 cards por tab):
┌──────────────────────────────┐         ┌──────────────────────────────┐
│ CARD A: Info Pessoais        │         │ Tabs: [Geral] [Horarios] [Ausencias]
│  nome, sexo, setor           │         ├──────────────────────────────┤
├──────────────────────────────┤         │                              │
│ CARD B: Contrato             │         │ TAB "Geral":                 │
│  tipo, horas, tipo_trab      │         │ ┌─ CARD: Dados ───────────┐ │
│  funcao                      │         │ │ nome, sexo(*obrig),     │ │
├──────────────────────────────┤         │ │ setor, contrato, horas, │ │
│ CARD C: Preferencias         │         │ │ tipo_trabalhador, funcao│ │
│  prefere_turno               │         │ │ prefere_turno,          │ │
│  evitar_dia_semana           │         │ │ evitar_dia_semana       │ │
├──────────────────────────────┤         │ └─────────────────────────┘ │
│ CARD D: Excecoes Pontuais    │         │                              │
│  FERIAS/ATESTADO/BLOQUEIO    │         │ TAB "Horarios":              │
│  lista + dialog criar        │         │ ┌─ CARD: Regra Padrao ───┐ │
├──────────────────────────────┤         │ │ perfil, restricao,     │ │
│ CARD E: Regra Padrao         │         │ │ domingo ciclo,         │ │
│  perfil, restricao, domingo  │         │ │ folga fixa/variavel    │ │
│  ciclo, folga fixa/variavel  │         │ └─────────────────────────┘ │
│  turno pref                  │         │ ┌─ CARD: Por Dia Semana ─┐ │
├──────────────────────────────┤         │ │ 7 toggles colapsaveis  │ │
│ CARD F: Regras por Dia       │         │ └─────────────────────────┘ │
│  7 rows com toggle + time    │         │ ┌─ CARD: Excecoes Data ──┐ │
│  cada um colapsavel          │         │ │ Override pontual       │ │
├──────────────────────────────┤         │ └─────────────────────────┘ │
│ CARD G: Excecoes por Data    │         │                              │
│  override pontual por data   │         │ TAB "Ausencias":             │
│  restricao, turno, domingo   │         │ ┌─ CARD: Ferias/Atestado ┐ │
└──────────────────────────────┘         │ │ Lista ativa + criar    │ │
                                         │ └─────────────────────────┘ │
7 CARDS = scroll infinito               └──────────────────────────────┘
Leigo desiste na 3a card
                                         3 TABS = max 3 cards por tab
                                         Leigo ve so o que precisa
```

### Fluxo de Geracao — ANTES vs DEPOIS

```
ANTES (8-10 cliques):
┌─────────────┐    ┌──────────────┐    ┌───────────────┐    ┌──────────────┐
│ Dashboard   │───►│ SetorDetalhe │───►│ "Abrir Escala" │───►│ EscalaPagina │
│ (clique 1)  │    │ (clique 2)   │    │ (clique 3)     │    │              │
└─────────────┘    └──────────────┘    └───────────────┘    │ Ajustar datas│
                                                            │ (clique 4)   │
                                                            │              │
                                                            │ Abrir Config │
                                                            │ (clique 5)   │
                                                            │              │
                                                            │ Fechar Config│
                                                            │ (clique 6)   │
                                                            │              │
                                                            │ Clicar Gerar │
                                                            │ (clique 7)   │
                                                            │              │
                                                            │ MODAL Preflt │
                                                            │ "Continuar?" │
                                                            │ (clique 8)   │
                                                            │              │
                                                            │ ...espera... │
                                                            │              │
                                                            │ Clicar Export│
                                                            │ (clique 9)   │
                                                            │              │
                                                            │ MODAL Export │
                                                            │ Escolher fmt │
                                                            │ (clique 10)  │
                                                            └──────────────┘

DEPOIS (3 cliques):
┌─────────────┐    ┌──────────────────────┐    ┌──────────────────────────────┐
│ Dashboard   │───►│ SetorDetalhe         │───►│ EscalaPagina                 │
│ (clique 1)  │    │                      │    │                              │
└─────────────┘    │ [▶ Gerar Escala]     │    │ (gera automatico com        │
                   │ (clique 2)           │    │  defaults inteligentes)      │
                   └──────────────────────┘    │                              │
                                               │ ✅ Gerada! [Exportar ▼]     │
                                               │ (clique 3 = exportar)       │
                                               └──────────────────────────────┘

ALTERNATIVA (atalho direto):
┌─────────────┐    ┌──────────────────────────────────────────┐
│ Dashboard   │───►│ SetorDetalhe                             │
│ (clique 1)  │    │ [▶ Gerar Escala] (clique 2)             │
└─────────────┘    │ → navega pra EscalaPagina                │
                   │ → gera automatico (3 meses, defaults)    │
                   │ → resultado aparece                      │
                   │                                          │
                   │ ✅ Gerada! [Exportar ▼] (clique 3)      │
                   └──────────────────────────────────────────┘
```

### ConfiguracoesPagina — DEPOIS (com secao Avancado)

```
┌──────────────────────────────────────────────────────────────────┐
│ PageHeader: Configuracoes                                        │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─ CARD: Aparencia ──────────────────────────────────────────┐ │
│  │  (inalterado — tema, cor)                                   │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌─ CARD: Atualizacoes ──────────────────────────────────────┐  │
│  │  (inalterado — check update, install)                      │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌─ CARD: Backup e Restauracao ──────────────────────────────┐  │
│  │  (inalterado — export/import)                              │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌─ COLLAPSIBLE: Avancado ────────────────────────────────────┐ │
│  │  ▶ Configuracoes Avancadas                                  │ │
│  │  ┌──────────────────────────────────────────────────────┐   │ │
│  │  │ CARD: Assistente IA (provider, api_key, modelo)      │   │ │
│  │  │ CARD: Links rapidos                                   │   │ │
│  │  │  → Tipos de Contrato (/tipos-contrato)               │   │ │
│  │  │  → Regras do Motor (/regras)                         │   │ │
│  │  │  → Base de Conhecimento (/memoria)                   │   │ │
│  │  └──────────────────────────────────────────────────────┘   │ │
│  └─────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘

NOTA: As paginas /tipos-contrato, /regras, /memoria continuam
existindo e funcionando. So saem da sidebar e ficam acessiveis
via Configuracoes > Avancado > Links rapidos. Quem sabe a URL
direta continua podendo acessar.
```

---

## REGRAS DE NEGOCIO

```
PODE / NAO PODE:
- ✅ PODE: Gerar escala com 1 clique (defaults inteligentes)
- ✅ PODE: Ver grid limpo sem ruido na view principal
- ✅ PODE: Exportar direto do banner (sem modal)
- ✅ PODE: Acessar config avancada SE souber onde esta
- ❌ NAO PODE: Ver 35 toggles de regras na tela de escala
- ❌ NAO PODE: Sair de formulario sem aviso de dados nao salvos
- ❌ NAO PODE: Deletar contrato CLT 44h da sidebar sem querer
- ❌ NAO PODE: Mudar API key do Gemini sem querer

SEMPRE / NUNCA:
- 🔄 SEMPRE: Default 3 meses (proximo trimestre)
- 🔄 SEMPRE: Preflight silencioso (so mostra se BLOQUEIO)
- 🔄 SEMPRE: Banner de resultado em 1 frase
- 🚫 NUNCA: KPIs na view principal (vao pro Resumo)
- 🚫 NUNCA: Modal de exportacao intermediario
- 🚫 NUNCA: Dropdown de regime por colaborador na EscalaPagina

CONDICIONAIS:
- 🔀 SE pass 1 (sucesso) ENTAO banner verde, sem link resumo
- 🔀 SE pass 1 + avisos SOFT ENTAO banner verde, link "Ver resumo"
- 🔀 SE pass 2 (relaxado) ENTAO banner amber, link "Ver resumo"
- 🔀 SE pass 3 (emergencia) ENTAO banner vermelho, link "Falar com IA"
- 🔀 SE INFEASIBLE ENTAO banner vermelho, diagnostico + "Falar com IA"
- 🔀 SE form tem alteracoes nao salvas E usuario navega ENTAO dialog "Sair sem salvar?"
```

---

## FASES DE IMPLEMENTACAO

> Cada fase e independente, fechavel, e termina com tsc 0 erros.
> Ordem importa: Fase 1 e a maior e mais impactante. Fases 2-5 sao incrementais.

```
FASE 1: EscalaPagina (o coracao)
  ├── Banner tiered
  ├── Resumo colapsavel
  ├── Default 3 meses
  ├── Esconder SolverConfigDrawer
  ├── Preflight silencioso
  ├── Remover regimeOverrides
  └── Simplificar acoes

FASE 2: Export direto
  ├── Dropdown no banner (substitui ExportModal)
  ├── Remover toggles inuteis
  └── Manter 3 formatos uteis

FASE 3: Sidebar + Navegacao
  ├── Esconder Contratos/Regras/Memoria
  ├── Config IA → secao Avancado
  ├── "Gerar Escala" no SetorDetalhe
  └── Esconder demandas_excecao_data

FASE 4: Dirty State
  ├── Hook useDirtyGuard
  ├── Aplicar em 4 forms principais
  └── beforeunload fallback

FASE 5: ColaboradorDetalhe
  ├── Split em 3 tabs
  ├── Fix sexo default
  └── Simplificar cards
```

---

## FASE 1: ESCALAPAGINA — O CORACAO

### 1.1 — Componente `EscalaResultBanner.tsx` (NOVO)

**Proposito:** Banner unico que resume o resultado da geracao em 1 frase com cor.

**Input:**
```typescript
interface EscalaResultBannerProps {
  diagnostico: DiagnosticoSolver
  violacoes_hard: number
  violacoes_soft: number
  antipatterns: number
  onVerResumo: () => void
  onFalarComIA: () => void
  exportDropdown: ReactNode     // Slot pro dropdown de export
}
```

**Logica de tier:**

```
┌─────────────────────────────────────────────────────────────────────────┐
│ TIER   │ CONDICAO                       │ COR    │ MENSAGEM            │
├────────┼────────────────────────────────┼────────┼─────────────────────┤
│ SUCESSO│ pass_usado=1, violacoes_hard=0 │ VERDE  │ "Escala gerada com  │
│        │ violacoes_soft=0, AP=0         │ bg-emerald│ sucesso!"          │
├────────┼────────────────────────────────┼────────┼─────────────────────┤
│ AVISOS │ pass_usado=1, hard=0           │ VERDE  │ "Escala gerada com  │
│        │ MAS soft>0 OU AP>0             │ bg-emerald│ N avisos."         │
│        │                                │        │ + [Ver resumo]      │
├────────┼────────────────────────────────┼────────┼─────────────────────┤
│ RELAXA │ pass_usado=2                   │ AMBER  │ "Escala gerada com  │
│        │                                │ bg-amber│ ajustes — N regras  │
│        │                                │        │ flexibilizadas."    │
│        │                                │        │ + [Ver resumo]      │
├────────┼────────────────────────────────┼────────┼─────────────────────┤
│ EMERG  │ pass_usado=3                   │ VERMELH│ "MODO EMERGENCIA —  │
│        │                                │ bg-red  │ apenas CLT minimo." │
│        │                                │        │ + [Ver resumo]      │
│        │                                │        │ + [Falar com IA]    │
├────────┼────────────────────────────────┼────────┼─────────────────────┤
│ IMPOSS │ INFEASIBLE                     │ VERMELH│ "Impossivel gerar   │
│        │                                │ bg-red  │ escala." +          │
│        │                                │        │ diagnostico         │
│        │                                │        │ + [Falar com IA]    │
└─────────────────────────────────────────────────────────────────────────┘
```

**Dependencia:** Campo `diagnostico.pass_usado` ja existe no output do solver Python (`solver_ortools.py` → `extract_solution()`). Valor 1, 2, ou 3 conforme qual pass resolveu.

**Verificar:** Se `pass_usado` ja chega no frontend via `EscalaCompletaV3.diagnostico`. Se nao, adicionar ao bridge/types.

**Layout visual:**
```
┌────────────────────────────────────────────────────────────┐
│ [✅ icon]  Escala gerada com sucesso!     [Exportar ▼]    │
│            Mar 2026 — Mai 2026                             │
└────────────────────────────────────────────────────────────┘
```

**Arquivo:** `src/renderer/src/componentes/EscalaResultBanner.tsx` (~80 linhas)

---

### 1.2 — Resumo Colapsavel (Collapsible)

**O que se move pra dentro do Resumo:**

| Componente atual | Onde esta hoje | Vai pra |
|-----------------|----------------|---------|
| `IndicatorCard` (5x) | SimulacaoResult linhas 1221-1278 | Resumo |
| `RuleComplianceBadge` | SimulacaoResult linhas 1280-1283 | Resumo |
| `ResumoFolgas` | SimulacaoResult linhas 1285-1292 | Resumo |
| `ViolacoesAgrupadas` | SimulacaoResult linhas 1344-1365 | Resumo |
| Comparacao Demanda card | SimulacaoResult linhas 1367-1435 | Resumo |
| "Por que?" card (decisoes) | SimulacaoResult linhas 1437-1506 | Resumo |
| `PontuacaoBadge` | Grid card header | **REMOVIDO** da main view |

**O que FICA na view principal:**
1. Configuracao de geracao (compacto)
2. `EscalaResultBanner` (novo)
3. Grid da escala (EscalaGrid / TimelineGrid) + ViewToggle
4. Botoes de acao (Oficializar, Descartar)
5. Resumo (colapsavel, FECHADO por default)

**Implementacao:** Usar shadcn `Collapsible` com `CollapsibleTrigger` e `CollapsibleContent`.

```tsx
// Dentro de SimulacaoResult, APOS o grid e acoes:
<Collapsible open={resumoAberto} onOpenChange={setResumoAberto}>
  <CollapsibleTrigger asChild>
    <Button variant="ghost" className="w-full justify-between">
      <span>Resumo Detalhado {totalAvisos > 0 && `(${totalAvisos} avisos)`}</span>
      <ChevronDown className={cn("transition", resumoAberto && "rotate-180")} />
    </Button>
  </CollapsibleTrigger>
  <CollapsibleContent className="space-y-4 pt-4">
    {/* ViolacoesAgrupadas */}
    {/* IndicatorCards (5x) */}
    {/* RuleComplianceBadge */}
    {/* Comparacao Demanda */}
    {/* Decisoes do Motor */}
    {/* ResumoFolgas */}
  </CollapsibleContent>
</Collapsible>
```

**Trigger via banner:** O link "Ver resumo" no `EscalaResultBanner` chama `setResumoAberto(true)` e faz scroll ate o Collapsible.

---

### 1.3 — Default 3 Meses + Config Compacta

**Hoje:**
- `dataInicio` = 1o dia do proximo mes
- `dataFim` = ultimo dia do proximo mes (1 mes)
- 2 date pickers manuais sempre visiveis
- Botao "Cenario 5x2/6x1" sempre visivel
- Botao ⚙ Config sempre visivel

**Depois:**
- `dataInicio` = 1o dia do proximo mes
- `dataFim` = ultimo dia de proximo mes + 2 (3 meses)
- **Texto resumido:** "Mar 2026 — Mai 2026 (3 meses)"
- **Link "Alterar"** → expande date pickers + config avancada
- Cenario 5x2/6x1 → **REMOVIDO** da UI (IA configura via chat se necessario)
- Botao ⚙ → **ESCONDIDO** por default, aparece apenas se "Alterar" expandido

**Mudancas no state:**

```typescript
// ANTES:
const [dataFim, setDataFim] = useState(() => {
  const hoje = new Date()
  const ultimoDia = new Date(hoje.getFullYear(), hoje.getMonth() + 2, 0) // +1 mes
  return ultimoDia.toISOString().split('T')[0]
})

// DEPOIS:
const [dataFim, setDataFim] = useState(() => {
  const hoje = new Date()
  const ultimoDia = new Date(hoje.getFullYear(), hoje.getMonth() + 4, 0) // +3 meses
  return ultimoDia.toISOString().split('T')[0]
})

// NOVO:
const [configExpandida, setConfigExpandida] = useState(false)
```

**Layout compacto:**
```
┌────────────────────────────────────────────────────────────┐
│  📅 Mar 2026 — Mai 2026 (3 meses)  [Alterar]   [▶ Gerar] │
└────────────────────────────────────────────────────────────┘

// Se "Alterar" clicado:
┌────────────────────────────────────────────────────────────┐
│  Data Inicio [2026-03-01]  Data Fim [2026-05-31]           │
│  [⚙ Configurar regras]                    [▶ Gerar]       │
└────────────────────────────────────────────────────────────┘
```

**O que MORRE:**
- State `regimeOverrides` + `setRegimeOverrides` (50+ linhas)
- Funcao `regimesOverridePayload()` (10 linhas)
- `getContratoRegime()` helper (15 linhas)
- AlertDialog do "Cenario de Regimes" (70 linhas)
- `regimes_override` param na chamada de `escalasService.gerar()` → passa `[]` fixo

**O que NAO morre:**
- Backend `regimes_override` continua funcionando (IA usa via tool `gerar_escala`)
- `SolverConfigDrawer` continua existindo, so escondido atras de "Alterar" > "Configurar regras"

---

### 1.4 — Preflight Silencioso

**Hoje:** Preflight roda e se tem WARNINGS, abre modal `AlertDialog` que BLOQUEIA o fluxo.
Usuario tem que ler avisos e clicar "Continuar mesmo assim".

**Depois:** Preflight continua rodando, mas:

| Resultado preflight | Comportamento |
|---------------------|---------------|
| OK (sem blockers, sem warnings) | Gera direto |
| WARNINGS (soft) | Gera direto, mostra toast.info com resumo |
| BLOCKERS (hard) | Para, mostra toast.error com mensagem |

**O que MORRE:**
- State `preflightWarningsOpen` + `preflightWarningsText` + `preflightResolveRef` (15 linhas)
- `AlertDialog` de preflight warnings (43 linhas: 1032-1075)
- Logica de Promise resolve/reject no handleGerar (20 linhas)

**O que MUDA no `handleGerar()`:**

```typescript
// ANTES (simplificado):
const preflight = await escalasService.preflight(...)
if (!preflight.ok) { toast.error(...); return }
if (preflight.warnings.length > 0) {
  // MODAL BLOQUEANTE — espera usuario decidir
  const proceed = await new Promise(resolve => { ... })
  if (!proceed) return
}
// gera...

// DEPOIS:
const preflight = await escalasService.preflight(...)
if (!preflight.ok) { toast.error(...); return }
if (preflight.warnings.length > 0) {
  // TOAST INFORMATIVO — nao bloqueia
  toast.info(`${preflight.warnings.length} aviso(s): ${preflight.warnings[0].mensagem}...`)
}
// gera direto...
```

---

### 1.5 — Solver Terminal Escondido

**Hoje:** Card "Solver OR-Tools" com terminal preto aparece durante geracao.

**Depois:** Terminal NAO aparece. Loading overlay ja cobre a tela (existe).
Logs continuam sendo capturados (util pra debug via DevTools), mas nao renderizados.

**O que MORRE da UI:**
- Card do terminal (linhas 690-717) — ~27 linhas de JSX
- State `solverLogs` pode ficar (util pra debug) mas nao renderiza

---

### 1.6 — Simplificar Acoes

**Hoje (SimulacaoResult, linhas 1508-1574):**
- Oficializar (com dialog de confirmacao)
- Texto warning se violacoes
- Botao Regerar se desatualizada
- Exportar
- Imprimir
- Descartar (com dialog)

**Depois:**
- Oficializar (mantido, com dialog)
- Descartar (mantido, com dialog)
- Exportar e Imprimir → **movidos pro banner** (dropdown)
- Warning e Regerar → **movidos pro banner** (inline)

**Layout:**
```
┌────────────────────────────────────────────────────────────┐
│  [✅ Oficializar]                          [🗑 Descartar]  │
│  (desabilitado se violacoes_hard > 0)                      │
└────────────────────────────────────────────────────────────┘
```

---

### 1.7 — Resumo de Mudancas na EscalaPagina

**States REMOVIDOS:**
- `regimeOverrides`, `setRegimeOverrides`
- `preflightWarningsOpen`, `preflightWarningsText`, `preflightResolveRef`

**States ADICIONADOS:**
- `configExpandida` (boolean, default false)
- `resumoAberto` (boolean, default false)

**Componentes CRIADOS:**
- `EscalaResultBanner.tsx` (~80 linhas)

**Componentes REMOVIDOS da main view (movidos pro Resumo):**
- 5x `IndicatorCard`
- `RuleComplianceBadge`
- `PontuacaoBadge` (removido completamente da main view)
- `ViolacoesAgrupadas`
- Comparacao Demanda card
- "Por que?" card (decisoes)
- `ResumoFolgas`

**JSX REMOVIDO:**
- AlertDialog preflight warnings (~43 linhas)
- AlertDialog cenario regimes (~70 linhas)
- Solver Terminal card (~27 linhas)

**Estimativa de reducao:** SimulacaoResult vai de ~430 linhas → ~200 linhas.

---

## FASE 2: EXPORT DIRETO

### 2.1 — Dropdown no Banner (substitui ExportModal)

**Hoje:** Botao "Exportar" → abre `ExportModal` (387 linhas) → escolhe formato → escolhe opcoes → clica "Baixar".

**Depois:** `DropdownMenu` no banner com acoes diretas:

```
[Exportar ▼]
┌────────────────────────┐
│ 📄 Baixar HTML         │  ← Escala completa (formato padrao)
│ 🖨 Imprimir            │  ← window.print() direto
│ 📊 Baixar CSV          │  ← Dados brutos
│ ─────────────────────  │
│ 👤 Por funcionario...  │  ← Abre sub-dialog simples (select colab)
└────────────────────────┘
```

**O que MORRE:**
- `ExportModal.tsx` inteiro como componente intermediario (387 linhas)
  - NAO deletar o arquivo — pode ser util no EscalasHub (batch export)
  - Remover apenas o USO na EscalaPagina
- Toggle "Incluir avisos" (ninguem usa)
- Toggle "Incluir horas (Real vs Meta)" (ninguem usa)
- State `exportOpen` da EscalaPagina

**O que FICA:**
- `ExportarEscala.tsx` (componente HTML) — usado internamente pra renderizar
- `useExportController` hook — reutilizado, chamado diretamente
- Formato "batch" e "batch-geral" — so no EscalasHub, nao na EscalaPagina

**Opcoes de export na EscalaPagina ficam:**
1. HTML completa (default)
2. Imprimir (print window)
3. CSV
4. Por funcionario (com select simples, nao modal inteiro)

---

## FASE 3: SIDEBAR + NAVEGACAO

### 3.1 — Esconder Itens da Sidebar

**Arquivo:** `src/renderer/src/componentes/AppSidebar.tsx`

**Remover do grupo "Configuracao":**
- "Tipos de Contrato" (`/tipos-contrato`)
- "Regras" (`/regras`)
- "Memoria" (`/memoria`)

**Manter no grupo "Configuracao":**
- "Feriados" (`/feriados`) — leigo precisa ver/editar feriados

**Implementacao:** Simplesmente remover os 3 `SidebarMenuItem` do JSX. As rotas continuam existindo no React Router (acessiveis via URL direta e via Configuracoes > Avancado).

---

### 3.2 — Secao Avancado na ConfiguracoesPagina

**Arquivo:** `src/renderer/src/paginas/ConfiguracoesPagina.tsx`

**Adicionar apos o card de Backup:**

```tsx
<Collapsible>
  <CollapsibleTrigger asChild>
    <Button variant="ghost" className="w-full justify-between">
      Configuracoes Avancadas
      <ChevronDown />
    </Button>
  </CollapsibleTrigger>
  <CollapsibleContent className="space-y-4 pt-4">
    {/* Card IA existente (mover pra dentro) */}
    {/* Card de links rapidos (novo) */}
  </CollapsibleContent>
</Collapsible>
```

**Card de links rapidos:**
```tsx
<Card>
  <CardContent className="space-y-2 pt-4">
    <Link to="/tipos-contrato" className="flex items-center gap-2 ...">
      <FileText className="size-4" /> Tipos de Contrato
    </Link>
    <Link to="/regras" className="flex items-center gap-2 ...">
      <Shield className="size-4" /> Regras do Motor
    </Link>
    <Link to="/memoria" className="flex items-center gap-2 ...">
      <Brain className="size-4" /> Base de Conhecimento
    </Link>
  </CardContent>
</Card>
```

---

### 3.3 — Botao "Gerar Escala" no SetorDetalhe

**Arquivo:** `src/renderer/src/paginas/SetorDetalhe.tsx`

**Hoje:** Link "Abrir Escala" que navega pra `/setores/:id/escala`.

**Depois:** Botao prominente "Gerar Escala" que navega pra `/setores/:id/escala?gerar=1`.
Na EscalaPagina, se `searchParams.get('gerar') === '1'`, dispara `handleGerar()` automaticamente apos carregar dados.

**Implementacao na EscalaPagina:**

```typescript
const [searchParams] = useSearchParams()

useEffect(() => {
  // Auto-gerar se veio com ?gerar=1 (atalho do SetorDetalhe)
  if (searchParams.get('gerar') === '1' && !escalaCompleta && !gerando && setor && colaboradores?.length) {
    handleGerar()
    // Limpar param pra nao re-gerar em re-render
    window.history.replaceState({}, '', window.location.pathname)
  }
}, [setor, colaboradores]) // Esperar dados carregarem
```

**No SetorDetalhe:**

```tsx
<Button
  size="lg"
  onClick={() => navigate(`/setores/${setorId}/escala?gerar=1`)}
>
  <Play className="size-4 mr-2" /> Gerar Escala
</Button>
```

**Posicao:** Proeminente, acima ou ao lado do card de colaboradores. Visualmente destacado.

---

### 3.4 — Esconder Demandas Excecao Data

**Arquivo:** `src/renderer/src/paginas/SetorDetalhe.tsx`

**Hoje:** Card inteiro dedicado a `demandas_excecao_data` (Black Friday etc). Ninguem usa.

**Depois:** Card removido do JSX. A feature continua existindo no backend (IA configura via tool `salvar_demanda_excecao_data`).

---

## FASE 4: DIRTY STATE

### 4.1 — Hook `useDirtyGuard`

**Proposito:** Hook reutilizavel que:
1. Monitora `formState.isDirty` do react-hook-form
2. Ativa `useBlocker` do React Router v7 quando dirty
3. Mostra dialog "Sair sem salvar?" quando usuario tenta navegar
4. Adiciona `beforeunload` como fallback pra fechar aba/window

**Arquivo:** `src/renderer/src/hooks/useDirtyGuard.ts` (NOVO, ~50 linhas)

```typescript
import { useEffect } from 'react'
import { useBlocker } from 'react-router-dom'

interface UseDirtyGuardOptions {
  isDirty: boolean
  message?: string
}

export function useDirtyGuard({ isDirty, message }: UseDirtyGuardOptions) {
  // React Router v7 blocker
  const blocker = useBlocker(isDirty)

  // Browser beforeunload fallback (fecha aba)
  useEffect(() => {
    if (!isDirty) return
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = message || ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [isDirty, message])

  return blocker
}
```

**Dialog de confirmacao:** Componente `DirtyGuardDialog.tsx` (NOVO, ~30 linhas) que renderiza `AlertDialog` baseado no `blocker.state === 'blocked'`.

```tsx
export function DirtyGuardDialog({ blocker }: { blocker: Blocker }) {
  if (blocker.state !== 'blocked') return null
  return (
    <AlertDialog open>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Alteracoes nao salvas</AlertDialogTitle>
          <AlertDialogDescription>
            Voce tem alteracoes que nao foram salvas. Deseja sair mesmo assim?
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => blocker.reset()}>
            Continuar editando
          </AlertDialogCancel>
          <AlertDialogAction onClick={() => blocker.proceed()}>
            Sair sem salvar
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
```

### 4.2 — Aplicar nos Forms

| Pagina | Form hook | Como pegar isDirty | Complexidade |
|--------|-----------|-------------------|--------------|
| `ColaboradorDetalhe` | `useForm()` → `colabForm` | `colabForm.formState.isDirty` | MEDIA — form principal cobre Card A+B, mas Cards E-G usam useState separado |
| `SetorDetalhe` | `useForm()` → `setorForm` | `setorForm.formState.isDirty` | MEDIA — form cobre Card 1, demanda editor e funcoes sao separados |
| `EmpresaConfig` | `useForm()` → `form` | `form.formState.isDirty` | FACIL — form unico |
| `ConfiguracoesPagina` | `useForm()` → IA form | `iaForm.formState.isDirty` | FACIL — form unico |

**Nota sobre ColaboradorDetalhe:** O form principal (react-hook-form) cobre Cards A-C (info, contrato, preferencias). Mas Cards E-G (regras horario, regras dia, excecoes data) usam `useState` puro. Pra dirty state COMPLETO, precisamos:
- `formState.isDirty` do react-hook-form (Cards A-C)
- OU um `hasUnsavedRules` state manual (Cards E-G) comparando state atual vs carregado
- Combinar: `isDirty = colabForm.formState.isDirty || hasUnsavedRules`

**Abordagem pragmatica:** Na Fase 4, cobrir apenas o `formState.isDirty` do react-hook-form (Cards A-C). Os cards de regras salvam individualmente (botao "Salvar" por secao), entao o risco de perda e menor. Se necessario, expandir depois.

---

## FASE 5: COLABORADORDETALHE

### 5.1 — Split em 3 Tabs

**Tabs propostas:**

| Tab | Conteudo | Cards incluidos |
|-----|----------|-----------------|
| **Geral** | Dados pessoais + contrato + preferencias | Cards A + B + C (unificados) |
| **Horarios** | Regras de horario | Cards E + F + G |
| **Ausencias** | Ferias, atestados, bloqueios | Card D |

**Implementacao:** Usar shadcn `Tabs` com `TabsList` + `TabsTrigger` + `TabsContent`.

```tsx
<Tabs defaultValue="geral">
  <TabsList>
    <TabsTrigger value="geral">Geral</TabsTrigger>
    <TabsTrigger value="horarios">Horarios</TabsTrigger>
    <TabsTrigger value="ausencias">
      Ausencias {excecoesAtivas.length > 0 && <Badge>{excecoesAtivas.length}</Badge>}
    </TabsTrigger>
  </TabsList>

  <TabsContent value="geral">
    {/* Card unificado: info + contrato + preferencias */}
  </TabsContent>

  <TabsContent value="horarios">
    {/* Card E: Regra padrao */}
    {/* Card F: Regras por dia */}
    {/* Card G: Excecoes por data */}
  </TabsContent>

  <TabsContent value="ausencias">
    {/* Card D: Excecoes (ferias/atestado/bloqueio) */}
  </TabsContent>
</Tabs>
```

### 5.2 — Unificar Cards A + B + C

**Hoje:** 3 cards separados (Info Pessoal, Contrato, Preferencias).
**Depois:** 1 card unico "Dados do Colaborador" com layout grid 2 colunas.

```
┌─ CARD: Dados do Colaborador ──────────────────────────────┐
│                                                            │
│  Nome         [________________]   Sexo    (M) (F) ← OBRIG│
│  Setor        [Padaria ▼      ]   Funcao  [Caixa ▼]      │
│  Contrato     [CLT 44h ▼     ]   Horas   [44] (readonly) │
│  Tipo Trab.   [CLT           ]                             │
│                                                            │
│  ── Preferencias ──────────────────────────────────────    │
│  Turno pref.  [Nenhum ▼]       Evitar dia  [Nenhum ▼]    │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

### 5.3 — Fix Default `sexo: 'M'`

**Hoje:**
- `tools.ts:1097` — `if (!dados.sexo) dados.sexo = 'M'`
- `ColaboradorDetalhe.tsx:183` — `defaultValues: { sexo: 'M' }`

**Depois:**
- `tools.ts` — REMOVER default. Campo obrigatorio no schema Zod (ja e `.describe()`, falta `.min(1)` ou tornar required sem default)
- `ColaboradorDetalhe.tsx` — `defaultValues: { sexo: '' }` + validacao Zod `z.enum(['M', 'F'])` sem `.default()`
- IA tool `criar` — se sexo nao informado, IA deve PERGUNTAR (correction message no toolError)

---

## DEPENDENCIAS ENTRE FASES

```
FASE 1 (EscalaPagina)
  └── independente — nao depende de nada

FASE 2 (Export direto)
  └── depende da FASE 1 (banner precisa existir pro dropdown)

FASE 3 (Sidebar + Navegacao)
  └── independente da FASE 1 e 2
  └── "Gerar Escala" no SetorDetalhe beneficia-se da FASE 1 (auto-gerar)

FASE 4 (Dirty State)
  └── independente de tudo
  └── pode rodar em paralelo com qualquer fase

FASE 5 (ColaboradorDetalhe)
  └── independente de tudo
  └── melhor apos FASE 4 (dirty guard ja existe)
```

**Ordem recomendada:** 1 → 2 → 3 → 4 → 5
**Podem rodar em paralelo:** (1,4), (3,4), (3,5)

---

## ITENS DO HALL DA VERGONHA RESOLVIDOS

| # | Problema | Fase | Como resolve |
|---|----------|------|--------------|
| 1 | Regime de escala em 3 lugares | F1 | Remove dropdown da EscalaPagina. Regime fica no contrato (IA ajusta) |
| 3 | Chips de regras nao-clicaveis | F1 | Move pro Resumo colapsavel |
| 4 | Avisos espalhados sem lugar | F1 | Move pro Resumo colapsavel |
| 5 | KPIs complexas para leigos | F1 | Move pro Resumo colapsavel. Banner substitui |
| 6 | Excecoes demanda por data | F3 | Card escondido do SetorDetalhe |
| 7 | Interface do motor complexa | F1 | Default 3 meses, config escondida, preflight silencioso |
| 8 | Escala na 1a pagina do setor | F3 | Botao "Gerar Escala" no SetorDetalhe |
| 9 | Preview = grid interativo | F1 | Grid limpo na main view, detalhes no Resumo |
| 10 | Exportar separado do resultado | F2 | Dropdown no banner |
| 11 | Opcoes de exportacao inuteis | F2 | Remove toggles |
| 13 | Planejado x Executado | F1 | Move pro Resumo colapsavel |
| 14 | Regras empresa vs config motor | F1+F3 | SolverConfigDrawer escondido. Regras saem da sidebar |
| 15 | Config de escala espalhada | F1 | Card compacto unico |
| 16 | Discovery design pessimo | F3 | Sidebar limpa, Regras/Memoria escondidos |
| 17 | Default sexo: 'M' | F5 | Campo obrigatorio sem default |
| 18 | Config IA exposta | F3 | Dentro de Configuracoes > Avancado |
| 19 | Sidebar com itens perigosos | F3 | Contratos/Regras/Memoria saem da sidebar |
| 20 | ColaboradorDetalhe monstro | F5 | Split em 3 tabs |
| 22 | Memoria pagina = feature dev | F3 | Sai da sidebar, vai pra Avancado |
| 24 | Zero dirty state | F4 | Hook useDirtyGuard + dialog |

**NAO resolvidos neste sprint (backlog futuro):**
- #2: Contratos pedindo horas quando nome ja diz (melhoria UX menor)
- #12: Postos dentro da celula vs como coluna (rewrite do grid/export — muito complexo)
- #21: Dashboard melhorias (ja resolvido no Sprint 3)
- #23: Historico IA truncado (ja resolvido no Sprint 2)

### Addendum pos-sprint (2026-02-27) — UX ciclo-primeiro

Refino aplicado apos validacao de uso real:
- Export principal padronizado em `ciclo` no fluxo operacional (SetorDetalhe/EscalaPagina).
- Export `detalhado` mantido apenas para contexto avancado (Hub e analise).
- `EscalaPagina` com "Dados extras" colapsavel (progressive disclosure).
- Item "Escalas" removido da sidebar principal; acesso ao Hub movido para Configuracoes > Avancado.
- Dashboard passa a priorizar CTA de abrir Setor, com detalhe tecnico como acao secundaria.

---

## ARQUIVOS TOCADOS POR FASE

### Fase 1 (EscalaPagina)

| Arquivo | Acao | Linhas impactadas |
|---------|------|-------------------|
| `src/renderer/src/paginas/EscalaPagina.tsx` | REFATORAR | ~400 linhas removidas/movidas |
| `src/renderer/src/componentes/EscalaResultBanner.tsx` | CRIAR | ~80 linhas |
| (nenhum componente DELETADO — movidos pro Resumo) | — | — |

### Fase 2 (Export)

| Arquivo | Acao | Linhas impactadas |
|---------|------|-------------------|
| `src/renderer/src/paginas/EscalaPagina.tsx` | EDITAR | ExportModal usage removido, dropdown adicionado |
| `src/renderer/src/componentes/ExportModal.tsx` | NAO TOCAR | Continua existindo pro EscalasHub |

### Fase 3 (Sidebar + Navegacao)

| Arquivo | Acao | Linhas impactadas |
|---------|------|-------------------|
| `src/renderer/src/componentes/AppSidebar.tsx` | EDITAR | ~15 linhas removidas (3 menu items) |
| `src/renderer/src/paginas/ConfiguracoesPagina.tsx` | EDITAR | +Collapsible Avancado + links |
| `src/renderer/src/paginas/SetorDetalhe.tsx` | EDITAR | +Botao "Gerar Escala" |
| `src/renderer/src/paginas/EscalaPagina.tsx` | EDITAR | +auto-gerar via ?gerar=1 |

### Fase 4 (Dirty State)

| Arquivo | Acao | Linhas impactadas |
|---------|------|-------------------|
| `src/renderer/src/hooks/useDirtyGuard.ts` | CRIAR | ~50 linhas |
| `src/renderer/src/componentes/DirtyGuardDialog.tsx` | CRIAR | ~30 linhas |
| `src/renderer/src/paginas/ColaboradorDetalhe.tsx` | EDITAR | +3 linhas (import + hook + dialog) |
| `src/renderer/src/paginas/SetorDetalhe.tsx` | EDITAR | +3 linhas |
| `src/renderer/src/paginas/EmpresaConfig.tsx` | EDITAR | +3 linhas |
| `src/renderer/src/paginas/ConfiguracoesPagina.tsx` | EDITAR | +3 linhas |

### Fase 5 (ColaboradorDetalhe)

| Arquivo | Acao | Linhas impactadas |
|---------|------|-------------------|
| `src/renderer/src/paginas/ColaboradorDetalhe.tsx` | REFATORAR | Tabs wrapper + unificar Cards A-C |
| `src/main/ia/tools.ts` | EDITAR | Remover `sexo: 'M'` default |

---

## VERIFICACAO POS-CADA-FASE

```
┌─────────────────────────────────────────────────────────────┐
│ CHECKLIST (rodar apos CADA fase):                           │
│                                                             │
│ □ npm run typecheck → 0 erros                               │
│ □ npm run dev → app abre sem crash                          │
│ □ Gerar escala funciona (setor real com colabs)             │
│ □ Oficializar funciona (se 0 violacoes HARD)               │
│ □ Exportar funciona (HTML abre no browser)                  │
│ □ Navegacao entre paginas sem crash                         │
│ □ Layout chain intacto (sem scroll duplo, sem gap preto)    │
│ □ Dark mode nao quebrou                                     │
└─────────────────────────────────────────────────────────────┘
```

---

## DISCLAIMERS CRITICOS

- **`pass_usado`:** Verificar se o campo `diagnostico.pass_usado` chega no frontend. Se nao, adicionar no bridge/types ANTES da Fase 1. Sem ele, o banner nao sabe qual tier mostrar.

- **`ExportModal` no EscalasHub:** O ExportModal continua sendo usado no `EscalasHub.tsx` (batch export). NAO deletar o componente. So remover o USO na EscalaPagina.

- **Rotas continuam existindo:** As paginas `/tipos-contrato`, `/regras`, `/memoria` continuam acessiveis via URL direta. So saem da sidebar. Se alguem bookmarkou, continua funcionando.

- **IA continua usando regimeOverrides:** A IA tool `gerar_escala` aceita `regimes_override`. So a UI perde o dropdown. IA configura via chat se necessario.

- **Dirty state nao cobre tudo:** Na Fase 4, o `useDirtyGuard` cobre `formState.isDirty` do react-hook-form. Os cards de regras do ColaboradorDetalhe (E-G) usam useState puro. Cobertura completa exigiria estado derivado. Risco aceito — regras salvam individualmente.

- **useBlocker do React Router v7:** Verificar se a versao 7.1.0 instalada tem `useBlocker` estavel. Se nao, usar `useBeforeUnload` como fallback (menos elegante mas funcional).

---

*Ultima atualizacao: 2026-02-26 — Spec completa, pronta pra debater e implementar fase a fase.*
