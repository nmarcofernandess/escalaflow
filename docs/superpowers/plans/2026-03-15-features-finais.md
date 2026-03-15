# Features Finais — C7 Sugestao + Viabilidade + Avisos Operacao

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar a lógica de sugestão no SugestaoSheet (C7), adicionar cálculos de viabilidade por faixa horária nos derivados, e garantir que avisos de operação apareçam corretamente.

**Architecture:** O SugestaoSheet já existe como componente React (142 linhas) com diff visual. Falta a função que calcula propostas otimizadas de F/V (usando autoFolgaInteligente). Viabilidade é cálculo puro nos derivados do appDataStore. Avisos de operação já são populados mas precisam renderizar na EscalaPagina também.

**Tech Stack:** TypeScript, React 19, Zustand, shadcn/ui Sheet

---

## Task 1: Lógica de sugestão — calcularSugestaoFolgas()

**Files:**
- Create: `src/shared/sugestao-folgas.ts`
- Modify: `src/renderer/src/paginas/SetorDetalhe.tsx` (linhas ~2935-2959)

- [ ] **Step 1: Criar função calcularSugestaoFolgas**

Arquivo `src/shared/sugestao-folgas.ts`:

```typescript
import type { DiaSemana } from './index'
import type { SugestaoFolga } from '../renderer/src/componentes/SugestaoSheet'

interface CalcSugestaoInput {
  colaboradores: Array<{
    id: number
    nome: string
    posto_apelido: string
    fixa_atual: DiaSemana | null
    variavel_atual: DiaSemana | null
    tipo_trabalhador: string
  }>
  demandaPorDia: number[] // [SEG..SAB] = 6 valores
  N: number
}

export function calcularSugestaoFolgas(input: CalcSugestaoInput): {
  sugestoes: SugestaoFolga[]
  resultados: string[]
} {
  const { colaboradores, demandaPorDia, N } = input
  const DIAS: DiaSemana[] = ['SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB']

  // Track folgas por dia pra calcular cobertura
  const folgaCount = [0, 0, 0, 0, 0, 0]

  const sugestoes: SugestaoFolga[] = []

  // Pra cada colaborador elegível, calcular melhor F/V
  const elegiveis = colaboradores.filter(c => c.tipo_trabalhador !== 'INTERMITENTE')

  for (const colab of elegiveis) {
    // Melhor dia pra folga fixa: dia com MAIS sobra (N - demanda - folgasJa)
    let bestFixa = 0
    let bestFixaScore = -Infinity
    for (let d = 0; d < 6; d++) {
      const score = (N - (demandaPorDia[d] ?? 0)) - folgaCount[d]
      if (score > bestFixaScore) {
        bestFixaScore = score
        bestFixa = d
      }
    }

    // Melhor dia pra variável: segundo melhor (que não seja fixa)
    let bestVar = 0
    let bestVarScore = -Infinity
    for (let d = 0; d < 6; d++) {
      if (d === bestFixa) continue
      const score = (N - (demandaPorDia[d] ?? 0)) - folgaCount[d]
      if (score > bestVarScore) {
        bestVarScore = score
        bestVar = d
      }
    }

    folgaCount[bestFixa]++

    sugestoes.push({
      colaborador_id: colab.id,
      nome: `${colab.nome} (${colab.posto_apelido})`,
      fixa_atual: colab.fixa_atual,
      fixa_proposta: DIAS[bestFixa],
      variavel_atual: colab.variavel_atual,
      variavel_proposta: DIAS[bestVar],
    })
  }

  // Calcular resultados da proposta
  const coberturaPropostaPorDia = DIAS.map((_, d) => N - folgaCount[d])
  const temDeficit = coberturaPropostaPorDia.some((cob, d) => cob < (demandaPorDia[d] ?? 0))
  const temTT = false // autoFolga nunca gera TT por construção

  const resultados: string[] = []
  if (!temDeficit) resultados.push('Cobertura OK')
  else resultados.push(`Deficit em ${coberturaPropostaPorDia.filter((c, d) => c < (demandaPorDia[d] ?? 0)).length} dia(s)`)
  if (!temTT) resultados.push('Sem TT')
  resultados.push('H1 OK')

  return { sugestoes, resultados }
}
```

- [ ] **Step 2: Conectar no SetorDetalhe — substituir dados hardcoded**

No `SetorDetalhe.tsx`, substituir o bloco do SugestaoSheet (~linhas 2935-2959):

Trocar `variavel_proposta: regra?.folga_variavel_dia_semana` por chamada a `calcularSugestaoFolgas`.

- [ ] **Step 3: Implementar onAceitar — salvar propostas no banco**

O `onAceitar` deve chamar `colaboradoresService.salvarPadraoFolgas` com as propostas e `force: true`, depois recarregar o store.

- [ ] **Step 4: Typecheck + teste visual**

```bash
npm run typecheck
```

- [ ] **Step 5: Commit**

---

## Task 2: Viabilidade por faixa horária nos derivados

**Files:**
- Modify: `src/renderer/src/store/appDataStore.ts` (calcularDerivados)

- [ ] **Step 1: Adicionar campos de viabilidade ao Derivados**

Na interface `Derivados`:
```typescript
viabilidade?: {
  temPicoIsolado: boolean  // faixa com demanda > resto
  picoFaixa?: string       // ex: "07:00-08:00"
  picoDemanda?: number     // ex: 3
  restoDemanda?: number    // ex: 2
  jornadaMinPessoa?: number // minutos minimos por dia (contrato)
  duracaoPico?: number     // minutos do pico
  ratio?: number           // jornadaMin / duracaoPico (> 3 = caro)
  aviso?: string           // mensagem user-friendly
}
```

- [ ] **Step 2: Calcular no calcularDerivados**

Dentro de `calcularDerivados()`, após calcular demandaPorDia:
```typescript
// Viabilidade: detectar pico isolado
const demandaFaixas = demandas.filter(d => d.dia_semana === null || d.dia_semana === 'DOM')
const maxDemanda = Math.max(...demandaFaixas.map(d => d.min_pessoas), 0)
const modeDemanda = // moda das demandas (mais frequente)
if (maxDemanda > modeDemanda) {
  // Tem pico isolado
  const picoFaixas = demandaFaixas.filter(d => d.min_pessoas === maxDemanda)
  // calcular duração, ratio, etc
}
```

- [ ] **Step 3: Gerar aviso se ratio > 3**

Adicionar aos derivados.avisos:
```typescript
if (viab.ratio && viab.ratio > 3) {
  avisos.push({
    id: 'pico_ratio_alto',
    nivel: 'aviso',
    titulo: `Pessoa extra pra faixa ${viab.picoFaixa} custa ${Math.round(viab.jornadaMinPessoa!/60)}h pra cobrir ${Math.round(viab.duracaoPico!/60)}h de pico`,
    detalhe: 'Considere redistribuir demanda ou usar intermitente pra esse horario.',
  })
}
```

- [ ] **Step 4: Typecheck**

```bash
npm run typecheck
```

- [ ] **Step 5: Commit**

---

## Task 3: Avisos de operação na EscalaPagina

**Files:**
- Modify: `src/renderer/src/paginas/EscalaPagina.tsx` (se tiver seção de avisos)

- [ ] **Step 1: Verificar se EscalaPagina tem seção de avisos**

Se não tiver, não adicionar (a EscalaPagina pode não precisar — é "Ver completo").
Verificar se faz sentido nesse contexto.

- [ ] **Step 2: Se fizer sentido, renderizar avisos de escala (violações)**

A EscalaPagina já mostra violações da escala via `escalaCompleta.violacoes`.
Pode não precisar de avisos de operação separados.

- [ ] **Step 3: Typecheck + parity test**

```bash
npm run typecheck
npm run solver:test:parity
```

- [ ] **Step 4: Commit**

---

## Task 4: Verificação final

- [ ] **Step 1: Typecheck completo**
- [ ] **Step 2: Parity test**
- [ ] **Step 3: Teste visual no app**
- [ ] **Step 4: Commit final + push**
