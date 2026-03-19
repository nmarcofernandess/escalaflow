# PLAN: Avisos Lifecycle — Phase-Based Context + Humanizacao

> **Status:** PLANEJADO
> **Criado:** 2026-03-19
> **Contexto:** Sessao de debug que revelou 5 camadas de mensagens empilhadas sem coerencia

---

## 1. O Problema (Estado Atual)

### 1.1 Sintomas reportados pelo operador

- Mensagens se repetem 2-3x com fraseado diferente
- Termos tecnicos vazam pro RH: "INFEASIBLE", "Slot", "disponiveis=2", "preview"
- Apos cancelar sugestao, erros de geracao anterior ficam grudados
- Drawer mostra avisos do "antes" e do "depois" ao mesmo tempo
- Nao fica claro o que e aviso do sistema vs resultado do solver

### 1.2 Causa raiz arquitetural

Existem **5 fontes** de mensagens que convergem sem filtro nem lifecycle:

```
┌─────────────────┐   ┌───────────────────┐   ┌──────────────────┐
│ Python Solver    │   │ TS Validator      │   │ TS Preview       │
│ (diagnostico,   │   │ (Violacao[],      │   │ (PreviewDiag[],  │
│  erro, decisoes) │   │  mensagem, regra) │   │  capacity, etc)  │
└────────┬────────┘   └────────┬──────────┘   └────────┬─────────┘
         │                     │                       │
         ▼                     ▼                       ▼
┌────────────────────────────────────────────────────────────────┐
│                    tipc.ts (traducao parcial)                   │
│  buildInfeasibleMessage() traduz ALGUNS, vaza diagnostico_resumido │
└────────────────────────────────┬───────────────────────────────┘
                                 │
                                 ▼
┌────────────────────────────────────────────────────────────────┐
│              SetorDetalhe.tsx (merge manual)                    │
│                                                                │
│  useState(avisosOperacao) ← imperativo, nunca limpo            │
│  useMemo(previewDiagnostics) ← reativo, correto                │
│  useState(advisoryResult) ← imperativo, limpo so em 2 paths    │
│  store(previewAvisos) ← reativo, correto                       │
│                                                                │
│  buildPreviewAvisos() merge 4 fontes → dedup por id QUEBRADO   │
└────────────────────────────────┬───────────────────────────────┘
                                 │
                    ┌────────────┴────────────┐
                    ▼                         ▼
            AvisosSection              SugestaoSheet
            (pagina principal)         (drawer lateral)
            mostra TUDO misturado      mostra advisory + TS "antes"
```

### 1.3 Os dois problemas distintos

| # | Problema | Natureza | O que resolve |
|---|---------|----------|---------------|
| A | QUANDO mostrar (lifecycle) | Engenharia de estado | Phase-based context |
| B | O QUE mostrar (conteudo) | Traducao de mensagens | Camada de humanizacao |

Ambos sao **necessarios**. A sem B = avisos no momento certo mas incompreensiveis. B sem A = avisos legiveis mas duplicados/stale.

---

## 2. Solucao A: Phase-Based Context

### 2.1 Modelo de estados (FSM)

O sistema de avisos opera como uma **maquina de estados finita deterministica**:

```
                    ┌──────────┐
          ┌────────│  PREVIEW  │◄───────────────┐
          │        └──────┬───┘                 │
          │               │                     │
          │    sugerir()   │  gerar()            │
          │               │                     │
          ▼               ▼                     │
  ┌───────────────┐  ┌────────────┐             │
  │ ADVISORY_OPEN │  │ GENERATING │             │
  └───────┬───┬───┘  └──────┬─────┘             │
          │   │             │                   │
   aceitar│   │cancelar     │                   │
          │   │        ┌────┴────┐              │
          │   │        │         │              │
          │   │    sucesso    falha             │
          │   │        │         │              │
          │   └────────┼────┐    ▼              │
          │            │    │ ┌──────────┐      │
          └────────────┘    └►│INFEASIBLE│      │
                            │ └──────┬───┘      │
                            │        │          │
                            │   dismiss/novo    │
                            │   sugerir         │
                            │        │          │
                            └────────┴──────────┘
```

### 2.2 Tabela de transicoes (completa)

| Estado atual | Evento | Proximo estado | Efeito colateral |
|-------------|--------|---------------|------------------|
| PREVIEW | sugerir_solver() | ADVISORY_OPEN | advisoryResult = loading → result |
| PREVIEW | sugerir_ts() | ADVISORY_OPEN | advisoryResult = ts_result |
| PREVIEW | validar() | ADVISORY_OPEN | advisoryResult = validate_result |
| PREVIEW | gerar() | GENERATING | — |
| ADVISORY_OPEN | aceitar() | PREVIEW | aplica overrides, advisoryResult = null |
| ADVISORY_OPEN | cancelar() | PREVIEW | advisoryResult = null |
| GENERATING | sucesso | PREVIEW | escala no historico |
| GENERATING | infeasible | INFEASIBLE | infeasibleError = parsed |
| GENERATING | erro_generico | PREVIEW | toast de erro |
| INFEASIBLE | dismiss() | PREVIEW | infeasibleError = null |
| INFEASIBLE | sugerir_solver() | ADVISORY_OPEN | infeasibleError = null |

**Propriedade critica: toda transicao limpa o estado anterior.** Nao existe caminho onde lixo de um estado anterior sobrevive no proximo.

### 2.3 Derivacao de avisos por fase

```typescript
// Puro, determinístico, sem efeitos colaterais
function derivarAvisos(phase: AvisosPhase, ctx: AvisosContext): Aviso[] {
  switch (phase) {
    case 'PREVIEW':
      // Unica fonte: TS preview (reativo, sempre fresh)
      return humanizar(ctx.previewDiagnostics)

    case 'ADVISORY_OPEN':
      // Unica fonte: resultado do advisory
      // NAO inclui TS preview (seria do "antes", contraditorio)
      return humanizar(ctx.advisoryResult.diagnostics)

    case 'GENERATING':
      // Nenhum aviso — loading state
      return []

    case 'INFEASIBLE':
      // Unica fonte: erro estruturado do solver (ja humanizado)
      return humanizarInfeasible(ctx.infeasibleError)
  }
}
```

### 2.4 Prova de corretude

**Propriedade 1 — Sem duplicacao:**
Cada fase usa exatamente 1 fonte. Impossivel ter a mesma mensagem de 2 fontes diferentes.

**Propriedade 2 — Sem stale:**
Avisos sao derivados (useMemo), nao armazenados (useState). Quando a fase muda, o derivado recomputa. Nao existe `setAvisosOperacao` que precisa ser limpo manualmente.

**Propriedade 3 — Consistencia temporal:**
Em ADVISORY_OPEN, o user ve apenas o que o solver disse sobre a PROPOSTA. Nao ve TS diagnostics do ANTES. Contradição impossivel.

**Propriedade 4 — Reversibilidade:**
Cancelar → fase volta pra PREVIEW → avisos sao recalculados do TS preview → identico ao que era antes de sugerir. Sem residuo.

**Propriedade 5 — Convergencia:**
Aceitar → overrides aplicados → simulacao recalcula → previewDiagnostics atualiza → avisos refletem o novo arranjo. Caminho unico, sem race condition (tudo e derivado sincrono no mesmo render cycle).

### 2.5 O que MORRE

| Componente atual | Destino |
|-----------------|---------|
| `useState(avisosOperacao)` | **DELETADO** — substituido por fase INFEASIBLE |
| `useState(advisoryResult)` | Move pro context como parte do phase state |
| `buildPreviewAvisos()` (4 fontes, dedup quebrado) | **DELETADO** — substituido por `derivarAvisos()` |
| `avisosOperacao` como Source 4 no merge | **DELETADO** — nao existe mais merge |
| `previewDiagnostics` como prop do SugestaoSheet | **REMOVIDO** — drawer so mostra advisory |
| Triple-duplication de previewDiagnostics | **IMPOSSIVEL** — 1 fase = 1 fonte |

### 2.6 Onde vive no codigo

```
src/renderer/src/
├── store/
│   └── avisosStore.ts (NOVO)     ← phase + derivacao
│       export { phase, avisos, transition }
│
├── componentes/
│   ├── AvisosSection.tsx          ← recebe avisos derivados (sem mudanca)
│   └── SugestaoSheet.tsx          ← recebe SO advisory.diagnostics
│
├── paginas/
│   └── SetorDetalhe.tsx           ← chama transition() em vez de setState manual
│       - remove useState(avisosOperacao)
│       - remove buildPreviewAvisos merge
│       - handleSugerirSolver → transition('ADVISORY_OPEN')
│       - handleGerarEscala → transition('GENERATING')
│       - onAceitar → transition('PREVIEW')
│       - onDescartar → transition('PREVIEW')
```

---

## 3. Solucao B: Camada de Humanizacao

### 3.1 Principio

Toda mensagem que chega de qualquer fonte (solver, TS, preflight) passa por uma funcao `humanizar()` antes de entrar no contexto de avisos. A funcao:

1. Traduz termos tecnicos
2. Formata datas (ISO → "sabado, 15/mar")
3. Remove jargao interno ("Slot" → "faixa horaria", "INFEASIBLE" → "impossivel gerar")
4. Colapsa multiplas sugestoes em 1 card com lista
5. Remove duplicatas semanticas (mesmo problema, fontes diferentes)

### 3.2 Mapeamento de traducoes

| Original | Humanizado |
|----------|-----------|
| `Solver retornou INFEASIBLE: impossivel satisfazer todas as restricoes simultaneamente` | `Nao foi possivel gerar a escala com as regras atuais.` |
| `Capacidade insuficiente em 2026-03-15: disponiveis=2, minimo requerido=3.` | `Sabado, 15/mar: so 2 pessoas disponiveis, mas a demanda pede 3.` |
| `QUA (manha: 3, tarde: 2, disponiveis: 1)` | `Quarta: demanda de 3 de manha e 2 de tarde, mas so 1 pessoa disponivel.` |
| `Slot 12:00-13:00 em 2026-03-12 tem 4 pessoas mas demanda e 2` | `Quinta, 12/mar das 12:00 as 13:00: 4 pessoas alocadas, mas a demanda e de 2.` |
| `N participante(s) intermitente(s) ficaram fora do preview.` | `N colaborador(es) intermitente(s) nao entram na simulacao automatica.` |
| `Folga variavel de Ana em QUA: sobram 1, demanda e 2.` | `Quarta com folga da Ana: fica 1 pessoa, mas a demanda e 2.` |
| `H2B_DSR_INTERJORNADA` (fallback code) | `Descanso entre jornadas insuficiente (minimo 11h)` |
| `H3_DOM_MAX_CONSEC_F` (fallback code) | `Domingos consecutivos acima do limite (mulheres)` |

### 3.3 Estrutura

```typescript
// src/renderer/src/lib/humanizar-avisos.ts (NOVO)

// 1. Dicionario de codigos → texto RH
const CODIGO_PARA_TEXTO: Record<string, string> = {
  H1_MAX_DIAS_CONSECUTIVOS: 'Limite de dias seguidos de trabalho excedido',
  H2_DESCANSO_ENTRE_JORNADAS: 'Descanso entre jornadas menor que 11 horas',
  H2B_DSR_INTERJORNADA: 'Descanso entre jornadas insuficiente',
  H3_RODIZIO_DOMINGO: 'Rodizio de domingos nao respeitado',
  H3_DOM_MAX_CONSEC: 'Limite de domingos consecutivos excedido',
  H3_DOM_MAX_CONSEC_M: 'Domingos consecutivos acima do limite (homens)',
  H3_DOM_MAX_CONSEC_F: 'Domingos consecutivos acima do limite (mulheres)',
  H4_MAX_JORNADA_DIARIA: 'Jornada acima do maximo diario (10h)',
  // ... todos os 35 codigos
}

// 2. Regex patterns para substituicao inline
const HUMANIZADORES: Array<[RegExp, (match: RegExpMatchArray) => string]> = [
  [/Solver retornou INFEASIBLE:?\s*/i, () => ''],
  [/disponiveis=(\d+)/g, (m) => `${m[1]} pessoas disponiveis`],
  [/minimo requerido=(\d+)/g, (m) => `demanda pede ${m[1]}`],
  [/Slot (\d{2}:\d{2})-(\d{2}:\d{2})/g, (m) => `Faixa ${m[1]} as ${m[2]}`],
  [/(\d{4})-(\d{2})-(\d{2})/g, (m) => formatarDataCurta(m[0])],
  [/\bpreview\b/gi, () => 'simulacao'],
]

// 3. Funcao principal
function humanizar(diagnostics: PreviewDiagnostic[]): Aviso[] { ... }
function humanizarInfeasible(error: InfeasibleError): Aviso[] { ... }
```

### 3.4 Prova de corretude

**Propriedade 1 — Idempotente:** Humanizar 2x produz o mesmo resultado (patterns ja humanizados nao matcham de novo).

**Propriedade 2 — Lossless:** Toda informacao original e preservada, so a forma muda. Numeros, nomes, horarios mantem-se.

**Propriedade 3 — Fallback seguro:** Se um codigo nao tem traducao, `humanizar()` retorna a `mensagem` original (que o validador sempre seta). So usa o dicionario quando `mensagem` esta ausente.

---

## 4. Plano de Execucao

### Fase 1: Context Phase (resolve lifecycle)

| # | Task | Arquivos | Estimativa |
|---|------|----------|-----------|
| 1.1 | Criar `avisosStore.ts` com FSM + derivacao | novo arquivo | pequeno |
| 1.2 | Mover `advisoryResult` pro store | SetorDetalhe.tsx | medio |
| 1.3 | Deletar `useState(avisosOperacao)` | SetorDetalhe.tsx | pequeno |
| 1.4 | Deletar `buildPreviewAvisos()` | build-avisos.ts → deletar | pequeno |
| 1.5 | Substituir calls por `transition()` | SetorDetalhe.tsx (6 pontos) | medio |
| 1.6 | Remover `previewDiagnostics` prop do SugestaoSheet | SugestaoSheet.tsx | pequeno |
| 1.7 | AvisosSection consume `avisos` derivado do store | AvisosSection.tsx | pequeno |

### Fase 2: Humanizacao (resolve conteudo)

| # | Task | Arquivos | Estimativa |
|---|------|----------|-----------|
| 2.1 | Criar `humanizar-avisos.ts` com dicionario + patterns | novo arquivo | medio |
| 2.2 | Mapear todos os 35 codigos de regra | humanizar-avisos.ts | medio |
| 2.3 | Integrar `humanizar()` na derivacao do store | avisosStore.ts | pequeno |
| 2.4 | Matar `REGRAS_TEXTO` em formatadores.ts | formatadores.ts | pequeno |
| 2.5 | Humanizar `diagnostico_resumido` no tipc.ts | tipc.ts | pequeno |
| 2.6 | Colapsar `sugestoes[]` do solver em 1 card | tipc.ts ou humanizar-avisos.ts | pequeno |

### Fase 3: Verificacao

| # | Task |
|---|------|
| 3.1 | Testar: sugerir → aceitar → avisos refletem novo arranjo |
| 3.2 | Testar: sugerir → cancelar → avisos voltam ao que era |
| 3.3 | Testar: gerar → INFEASIBLE → 1 card sem jargao |
| 3.4 | Testar: gerar → sucesso → avisos limpos |
| 3.5 | Testar: nenhuma mensagem com "INFEASIBLE", "Slot", "disponiveis=", "preview", codigo raw |
| 3.6 | Testar: nenhuma duplicacao (mesmo aviso 2x) |

---

## 5. Riscos e Mitigacoes

| Risco | Probabilidade | Mitigacao |
|-------|--------------|-----------|
| TS preview recalcula entre transicoes, flash visual | Media | Derivacao sincrona no mesmo render cycle (useMemo, nao useEffect) |
| Algum codigo de regra sem traducao vaza | Baixa | Fallback: usa `violacao.mensagem` (sempre presente). Dicionario e bonus, nao requisito |
| SugestaoSheet depende de previewDiagnostics pra algo alem de mostrar | Baixa | Auditar usos antes de remover — se existir, mover pro advisory context |
| Store novo cria acoplamento com SetorDetalhe | Baixa | Store e generico (phase + data), SetorDetalhe so chama transition() |

---

## 6. Criterios de Sucesso

- [ ] Zero mensagens com "INFEASIBLE", "Slot", "preview", codigos H*/AP* crus na UI
- [ ] Zero duplicacao de avisos (mesmo problema aparece 1x, nao 2-3x)
- [ ] Cancelar sugestao = avisos identicos ao que era antes
- [ ] Aceitar sugestao = avisos refletem o novo arranjo
- [ ] INFEASIBLE = 1 card vermelho com sugestoes como lista, sem cards amarelos separados
- [ ] `buildPreviewAvisos()` deletado
- [ ] `useState(avisosOperacao)` deletado
- [ ] `REGRAS_TEXTO` em formatadores.ts deletado ou substituido

---

*Principio do EscalaFlow: O SISTEMA propoe, o RH ajusta. Se o RH precisa decifrar mensagens tecnicas, o sistema falhou.*
