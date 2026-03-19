# BUILD: SugestaoSheet v2 — Drawer de Sugestao do Sistema

> Gerado por BUILD em 2026-03-18
> Input: Analise exaustiva do codigo atual + feedback do operador

---

## 1. O QUE E

O botao "Sugerir" no CicloGrid abre um drawer bottom-sheet que mostra:
1. **Validacao do arranjo atual** — o solver CP-SAT validou com as folgas do RH
2. **Diff de proposta** — o que o solver propoe de diferente (FF/FV por colaborador)
3. **Aceitar/Descartar** — aplica a proposta na simulacao ou fecha

**NAO e:** um validador standalone. A validacao TS ja roda no AvisosSection.
**E:** a confirmacao do solver + proposta alternativa + diff visual.

---

## 2. PERGUNTAS OBRIGATORIAS (20+) E RESPOSTAS

### Data Flow

**P1: O que handleSugerir envia pro advisory controller?**
```
EscalaAdvisoryInput {
  setor_id, data_inicio, data_fim,
  pinned_folga_externo: [{c, d, band}]  // pattern do preview convertido
  current_folgas: [{colaborador_id, fixa, variavel, origem_fixa, origem_variavel}]
  preview_diagnostics: PreviewDiagnostic[]  // resultados TS ja computados
  demanda_preview?: SemanaDraftAdvisory     // draft de demanda se editado
}
```

**P2: O que o advisory controller retorna?**
```
EscalaAdvisoryOutput {
  status: CURRENT_VALID | PROPOSAL_VALID | NO_PROPOSAL | CURRENT_INVALID
  current: { criteria: AdvisoryCriterion[5] }   // validacao do arranjo RH
  proposal?: { diff: AdvisoryDiffItem[], criteria: AdvisoryCriterion[5] }
  fallback?: { should_open_ia, reason, diagnosis_payload }
  normalized_diagnostics: PreviewDiagnostic[]   // pra merge com AvisosSection
}
```

**P3: Como advisoryResult flui pro SugestaoSheet?**
```
SetorDetalhe → SugestaoSheet props:
  open, onOpenChange, loading, advisory, onAceitar, onDescartar, onAnalisarIa
```

**P4: O que e converterPreviewParaPinned?**
Em `simula-ciclo.ts:742-769`. Converte o output do preview Level 1 (grid T/F por semana)
em formato `{c, d, band}` que o solver Python entende. band=0 OFF, band=3 INTEGRAL.

### Advisory Pipeline

**P5: O que o Phase 1 (pinned) valida?**
Roda `solve_folga_pattern` COM as folgas do RH pinadas. Valida:
- H1 (max 6 consecutivos), folga fixa 5x2, folga variavel XOR
- Min headcount por dia (peak demand), band demand (manha/tarde)
- H3 domingo ciclo/consecutivos (se HARD)
Se FEASIBLE = arranjo do RH e viavel no solver.

**P6: O que o free solve produz?**
Roda `solve_folga_pattern` SEM pins. Solver decide livremente o melhor arranjo.
Retorna `advisory_pattern: [{c, d, band}]` — de onde extraimos fixa/variavel.

**P7: Como extractFolgaFromPattern funciona?**
- Conta dias OFF (band=0) por dia-da-semana por colaborador
- Dia com >80% das semanas = folga FIXA
- Dia com 30-80% = folga VARIAVEL (XOR)
- Abaixo de 30% = descarta

**P8: Quando advisory_pattern existe?**
- Solver FEASIBLE/OPTIMAL + advisory_only=true → pattern existe
- Solver INFEASIBLE → pattern e array vazio []
- Solver crash/timeout → nao retorna

### UI States — O QUE RENDERIZA EM CADA CASO

**P9: Todos os status possiveis:**

| Status | Quando | O que mostra |
|--------|--------|-------------|
| PROPOSAL_VALID | Free solve achou algo diferente do RH | Criterios + DIFF + Aceitar/Descartar |
| CURRENT_VALID | Free solve concorda 100% com RH | Criterios + "Tudo certo!" + Fechar |
| NO_PROPOSAL | Solver falhou/INFEASIBLE | Auto-abre IA (drawer fecha antes de mostrar) |
| CURRENT_INVALID | TS falha + solver sem proposta diferente | Criterios com FAILs + Fechar (sem diff) |
| PROPOSAL_INVALID | NUNCA — dead code, criteria hardcoded PASS | N/A |

**P10: Quando o diff aparece?**
SOMENTE quando `advisory.proposal` existe → status PROPOSAL_VALID.

**P11: Quando "Tudo certo!" aparece?**
Quando `!hasProposal` E status != NO_PROPOSAL. Na pratica: CURRENT_VALID e CURRENT_INVALID.

**P12: Quando fallback message aparece?**
Nunca na pratica — NO_PROPOSAL fecha o sheet e auto-abre IA antes de renderizar.

**P13: Onde fica "Analisar com IA"?**
- DENTRO do drawer: no FallbackMessage (dead — sheet fecha antes) e no footer se PROPOSAL_INVALID (dead)
- FORA do drawer: no AvisosSection (funciona)

**P14: O que "Aceitar" faz?**
```
onAceitar → atualizarSimulacaoConfig → overrides_locais recebe:
  { [colaborador_id]: { fixa: proposta, variavel: proposta } }
```
Aplica as folgas propostas como overrides locais na simulacao. NAO salva no banco.

**P15: O que "Descartar" faz?**
Fecha o sheet e limpa advisoryResult. Nada muda.

### Integracao

**P16: Como diagnostics mergem com avisos?**
`buildPreviewAvisos` em `build-avisos.ts` merge 4 fontes:
previewDiagnostics + storePreviewAvisos + avisosOperacao + advisoryDiagnostics.
Advisory diagnostics tem precedencia por code (deduplica).

**P17: O que normalizeAdvisoryToDiagnostics faz?**
Converte AdvisoryCriterion[] → PreviewDiagnostic[] pro AvisosSection.
FAIL → severity:error, PASS → severity:info, NOT_EVALUATED → skip.

**P18: Como funciona a invalidacao?**
`useEffect(() => setAdvisoryResult(null), [previewSetorRows])`
Qualquer mudanca nas folgas do preview limpa o resultado anterior.

**P19: O que habilita o botao "Sugerir" no CicloGrid?**
```
showCoverageSuggest: mode='edit' && modoSimulacaoEfetivo='SETOR' && onSuggest callback existe
disabled: advisoryLoading || gerandoEscala
```

### Edge Cases

**P20: preview_diagnostics vazio vs null vs undefined?**
- `null/undefined` → `hasPreviewDiags = false` → criterios via solver binary (fallback)
- `[]` (array vazio = TS diz tudo OK) → `hasPreviewDiags = true` → buildTsCriteria([]) → todos PASS

**P21: advisory_pattern vazio?**
INFEASIBLE retorna `advisory_pattern: []`. O `extractFolgaFromPattern` recebe 0 items,
`offsByColab` fica vazio, todos colabs ficam fixa=null, variavel=null.

**P22: Colaborador em current_folgas mas nao no solver?**
`input.current_folgas.find()` retorna undefined → fixa_atual/variavel_atual = null.
Diff mostra "null → proposta" = aparece como adicionado.

**P23: computeAdvisoryInputHash usado onde?**
NENHUM LUGAR. Exportado mas nunca chamado. Dead code. Invalidacao usa useEffect simples.

**P24: Auto-fallback IA funciona?**
Sim, mas bypassa o drawer. sheet abre (loading) → result chega com fallback.should_open_ia →
sheet fecha imediatamente → IA abre com prompt pre-populado. Usuario nunca ve NO_PROPOSAL no sheet.

**P25: Double solver call e necessario?**
Phase 1 (pinned) = VALIDACAO do arranjo RH → alimenta criterios
Free solve (unpinned) = PROPOSTA do solver → alimenta diff
Sao coisas diferentes. Ambos necessarios. Mas podemos otimizar: se Phase 1 retorna
um advisory_pattern, podemos usa-lo como base do diff tambem (evita 2a chamada quando
o solver com pins ja tem um pattern viavel).

---

## 3. ARQUITETURA DO DRAWER

### 3.1 Component Diagram

```
SugestaoSheet (bottom sheet)
├── Header
│   ├── StatusIcon (dinamico por status)
│   ├── "Sugestao do Sistema"
│   └── Subtitle (dinamico por status)
│
├── Content (condicional por status)
│   ├── CriteriaSection (SEMPRE — criterios do arranjo atual)
│   │   └── CriterionRow[] (5 cards com PASS/FAIL/NOT_EVALUATED)
│   │
│   ├── DiffSection (se proposal existe)
│   │   ├── DiffHeader ("Proposta do Solver" + badge "N alteracoes")
│   │   ├── DiffTable (TODOS colaboradores, destaque nos que mudaram)
│   │   │   └── DiffRow[] (nome + FF atual→proposta + FV atual→proposta)
│   │   └── DiffLegend (icones: manteve / mudou / adicionou)
│   │
│   └── MessageSection (se NAO tem proposal)
│       ├── CURRENT_VALID → "Tudo certo!" card verde
│       └── CURRENT_INVALID → "Problemas detectados" card + botao IA
│
└── Footer
    ├── "Aceitar sugestao" (se proposal) — verde
    ├── "Descartar" / "Fechar" (sempre)
    └── "Analisar com IA" (se problemas)
```

### 3.2 Layout do Diff — O CORE

Marco pediu: `[ter] [quarta] → [~quinta] [quarta]`

Design: tabela com 4 colunas visuais por linha:

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Proposta do Solver                                    2 alteracoes    │
├──────────────┬──────────────────────┬───┬──────────────────────────────┤
│ Colaborador  │ Atual                │   │ Proposta                     │
├──────────────┼──────────────────────┼───┼──────────────────────────────┤
│ Alex         │ FF:Ter   FV:Seg      │ → │ FF:⚡Qui  FV:Seg             │
│ Maria        │ FF:Qua   FV:—        │ → │ FF:Qua   FV:+Sex            │
│ Carlos       │ FF:Qui   FV:Ter      │   │ FF:Qui   FV:Ter             │
├──────────────┴──────────────────────┴───┴──────────────────────────────┤
│  ⚡ mudou   + adicionou   sem icone = manteve                         │
└─────────────────────────────────────────────────────────────────────────┘
```

Regras visuais:
- **Sem mudanca**: texto muted, sem seta no meio
- **Mudou**: seta `→` no meio, valor novo com ⚡ e cor amber
- **Adicionou** (era null, agora tem): seta `→`, valor novo com + e cor verde
- **Removido** (tinha, agora null): seta `→`, valor novo com cor vermelha
- Linhas que mudaram: background highlight sutil
- Linhas sem mudanca: agrupadas embaixo, collapsed ou opacity reduzida

### 3.3 Criterios — Design

5 cards empilhados, cada um com:
- Icone (check verde / X vermelho / minus cinza)
- Titulo
- Detail expandido quando FAIL

Os criterios ficam ACIMA do diff. Sao a validacao. O diff e a proposta.

### 3.4 Mensagens por Status

| Status | Subtitle | Content | Footer |
|--------|----------|---------|--------|
| Loading | "Analisando o arranjo atual..." | Spinner | — |
| PROPOSAL_VALID | "O sistema encontrou uma proposta melhor." | Criterios + DiffTable | Aceitar + Descartar |
| CURRENT_VALID | "O arranjo atual esta valido." | Criterios + "Tudo certo!" | Fechar |
| CURRENT_INVALID | "O arranjo atual tem problemas." | Criterios + card problema + IA btn | Fechar + IA btn |
| NO_PROPOSAL | (usuario nunca ve — auto-abre IA) | — | — |

---

## 4. FLUXO COMPLETO

```
Usuario clica "Sugerir" no CicloGrid
         │
         ▼
handleSugerir()
  ├── setSugestaoOpen(true) — abre drawer
  ├── setAdvisoryLoading(true) — mostra spinner
  │
  ├── Monta input:
  │   ├── pinnedFolgaExterno ← converterPreviewParaPinned(preview)
  │   ├── currentFolgas ← previewSetorRows (fixa/variavel de cada colab)
  │   └── preview_diagnostics ← previewDiagnostics (resultados TS)
  │
  ├── await escalasService.advisory(input)
  │         │
  │         ▼ (backend — advisory-controller.ts)
  │   ┌─────────────────────────────────────────────┐
  │   │ 1. buildSolverInput (query DB)              │
  │   │ 2. buildTsCriteria(preview_diagnostics)     │
  │   │ 3. checkDescansoFromHorario                 │
  │   │ 4. Phase 1: solver com pins → criterios     │
  │   │ 5. Free solve: solver sem pins → diff       │
  │   │ 6. mergeCriteria (TS + solver + horario)    │
  │   │ 7. Determina status                         │
  │   └─────────────────────────────────────────────┘
  │         │
  │         ▼
  ├── setAdvisoryResult(result)
  │
  ├── Se fallback.should_open_ia:
  │   ├── setSugestaoOpen(false) — fecha drawer
  │   └── Abre IA com prompt pre-populado
  │
  └── setAdvisoryLoading(false)
         │
         ▼
SugestaoSheet renderiza com advisory result
  ├── PROPOSAL_VALID → Criterios + DiffTable + Aceitar
  ├── CURRENT_VALID → Criterios + "Tudo certo!" + Fechar
  └── CURRENT_INVALID → Criterios com FAILs + Fechar

         │ (se usuario clica "Aceitar")
         ▼
onAceitar → atualizarSimulacaoConfig
  └── overrides_locais[colab_id] = { fixa: proposta, variavel: proposta }
  └── Preview recalcula com novos overrides
  └── Sheet fecha
```

---

## 5. O QUE ESTA ERRADO/FALTANDO HOJE

| # | Issue | Impacto |
|---|-------|---------|
| 1 | PROPOSAL_INVALID nunca e emitido | Dead status + dead UI code |
| 2 | proposal.criteria hardcoded PASS | Secao "Resultado com proposta" sempre verde |
| 3 | CURRENT_INVALID sem fallback mostra area vazia | UX quebrada |
| 4 | showIaButton em StatusConfig nunca consumido | Dead code |
| 5 | posto_apelido sempre '' | DiffCard nunca mostra posto |
| 6 | NO_PROPOSAL nunca visivel (auto-abre IA) | UI de fallback no drawer e dead code |
| 7 | computeAdvisoryInputHash nunca usado | Dead code exportado |
| 8 | SimulacaoAdvisorySnapshot nunca usado | Dead type |
| 9 | Diff so mostra quando PROPOSAL_VALID | CURRENT_VALID nao mostra "solver concorda" visualmente |
| 10 | Double solver call = 2x latencia | Poderia otimizar |

---

## 6. DESIGN FINAL — O QUE IMPLEMENTAR

### 6.1 Simplificar status

Remover PROPOSAL_INVALID (dead). Manter:
- `PROPOSAL` — solver propoe algo diferente (tem diff)
- `AGREE` — solver concorda com RH (sem diff)
- `NO_PROPOSAL` — solver falhou

### 6.2 DiffTable redesenhada

Layout lado-a-lado com setas:

```
┌──────────┬─────────────────┬───┬─────────────────┐
│ Nome     │ Hoje (RH)       │   │ Proposta (Solver)│
├──────────┼─────────────────┼───┼─────────────────┤
│ Alex     │ FF:Ter  FV:Seg  │ → │ FF:⚡Qui  FV:Seg │  ← row highlight
│ Maria    │ FF:Qua  FV:—    │ → │ FF:Qua  FV:+Sex │  ← row highlight
│ Carlos   │ FF:Qui  FV:Ter  │   │ FF:Qui  FV:Ter  │  ← muted
└──────────┴─────────────────┴───┴─────────────────┘
```

### 6.3 Criterios compactos

Manter os 5 criterios como cards ACIMA do diff. Sem secao separada pro proposal criteria
(eram hardcoded PASS, remover).

### 6.4 Footer limpo

- PROPOSAL: `[Aceitar sugestao]  [Descartar]  "Aplica so na simulacao"`
- AGREE: `[Fechar]`
- CURRENT_INVALID: `[Analisar com IA]  [Fechar]`

### 6.5 Mensagens contextuais

- PROPOSAL: "O solver encontrou um arranjo diferente. Veja as diferencas abaixo."
- AGREE: "O solver concorda com o arranjo configurado."
- CURRENT_INVALID: "O arranjo atual tem problemas. O solver tambem nao encontrou alternativa."
- NO_PROPOSAL: (auto-abre IA, usuario nao ve)

---

## 7. CHECKLIST DE IMPLEMENTACAO

| # | Item | Tipo | O que fazer |
|---|------|------|-------------|
| 1 | Cleanup dead code | Refactor | Remover PROPOSAL_INVALID, showIaButton, computeAdvisoryInputHash, SimulacaoAdvisorySnapshot |
| 2 | Remover proposal.criteria | Simplify | Proposal so tem diff, sem criteria separados (eram hardcoded PASS) |
| 3 | DiffTable lado-a-lado | UI | Redesenhar com colunas Hoje/Proposta + setas + badges |
| 4 | Linhas changed vs unchanged | UI | Changed com highlight, unchanged muted/collapsed |
| 5 | Fix CURRENT_INVALID vazio | UI | Mostrar card explicativo + botao IA |
| 6 | Mensagens contextuais | UX | Subtitle e content corretos por status |
| 7 | Footer contextual | UX | Botoes corretos por status |

---

## 8. RISCOS

| Risco | Impacto | Mitigacao |
|-------|---------|-----------|
| Double solver call lento (20-30s) | UX ruim, usuario acha que travou | Spinner com mensagem de progresso. Otimizar depois. |
| extractFolgaFromPattern 80%/30% pode nao capturar padroes reais | Diff mostra fixa/variavel errado | Threshold funciona com ciclos regulares. Edge case aceitavel. |
| posto_apelido vazio | Diff nao mostra funcao | Popular do SolverInputColab se possivel, ou remover campo |
