# LÓGICA DE NEGÓCIO — Escala: Export Blindado + Cobertura Consistente

## TL;DR EXECUTIVO

Dois bugs estruturais na tela de Escala:

1. **Export CSV ignora validação** — permite exportar escala com 272 violações HARD. O app exporta lixo sem avisar.
2. **KPI e Gráfico mostram coberturas diferentes** — KPI diz 39%, gráfico diz 103.4%. São duas fontes de dados calculando a mesma métrica de formas incompatíveis.

---

## PROBLEMA 1: Export CSV Sem Validação

### O que FAZ hoje

```
Usuário clica "Exportar" → "CSV" → salva arquivo
```

**Zero checks.** Nenhuma verificação de:
- Violações HARD/SOFT
- Cobertura mínima
- Status da escala (RASCUNHO/OFICIAL/ARQUIVADA)

O único gate é `loading=true` durante o download. O CSV exportado pode ter 272 erros trabalhistas e nenhum aviso.

### Contraste com Oficializar

O `escalasOficializar` tem 2 guards:
1. ✅ `input_hash` — bloqueia se cenário mudou
2. ✅ `indicadores.violacoes_hard > 0` — bloqueia se tem HARD

O Export não tem NENHUM.

### Regra de Negócio

- ✅ **PODE:** Exportar escala OFICIAL (já validada)
- ✅ **PODE:** Exportar escala RASCUNHO com SOFT violations (avisos/preferências)
- ❌ **NÃO PODE:** Exportar escala com violações HARD sem aviso explícito
- 🔀 **SE** escala tem HARD violations **ENTÃO** mostrar modal de confirmação com contagem + opção "Exportar mesmo assim" ou "Ver Problemas"
- 🚫 **NUNCA:** Exportar silenciosamente algo que não é oficializável — o RH vai imprimir e aplicar uma escala ilegal

### Arquivos Afetados

| Arquivo | O que mudar |
|---------|-------------|
| `src/renderer/src/componentes/ExportModal.tsx` | Receber `violacoesHard: number` como prop. Se > 0, mostrar warning + confirmação |
| `src/renderer/src/paginas/EscalaPagina.tsx` | Passar `violacoesHard` do `escalaCompleta.indicadores.violacoes_hard` ao ExportModal |
| `src/renderer/src/paginas/EscalasHub.tsx` | Idem para export multi-setor |

### UX Proposta

```
SE violacoes_hard > 0:
  ┌──────────────────────────────────────────────┐
  │  ⚠️  Escala com {N} problemas críticos       │
  │                                              │
  │  Esta escala tem violações que impedem       │
  │  oficialização. Exportar mesmo assim?        │
  │                                              │
  │  [Ver Problemas]  [Exportar mesmo assim]     │
  └──────────────────────────────────────────────┘

SE violacoes_hard === 0:
  → Export normal (sem modal extra)
```

---

## PROBLEMA 2: KPI 39% vs Gráfico 103.4%

### Diagnóstico

O `escalasBuscar` (tipc.ts:950) monta o `EscalaCompletaV3` misturando DUAS fontes:

```typescript
const base = await validarEscalaV3(input.id)
// base.indicadores.cobertura_percent = 39% (recalculado pelo validador TS)
// base.comparacao_demanda = [...] (recalculado pelo validador TS)

return {
  ...base,
  comparacao_demanda: snapshotComparacao  // ← SOBRESCREVE com snapshot do Python!
}
```

| Dado | Fonte | Resultado |
|------|-------|-----------|
| `indicadores.cobertura_percent` (KPI card) | Validador TypeScript (recalculado ao carregar) | **39%** |
| `comparacao_demanda` (gráfico) | Solver Python (snapshot armazenado no banco) | **103.4%** |

### Por que divergem

**Validador TS** (`calcularIndicadoresV3`):
- Gera grid 15-min para cada dia do período
- Resolve target por slot via `resolveDemandaSlot()` usando demanda ATUAL do banco
- Conta executado via `countExecutadoNoSlot()` — EXCLUI worker durante almoço
- Binary check: `executado >= target` → slot coberto
- Resultado: `slotsCobertos / slotsTotal = 39%`

**Solver Python** (`comparacao_demanda` snapshot):
- Gerado no momento da execução do solver
- Usa a demanda que EXISTIA quando o solver rodou
- Pode usar grid/targets DIFERENTES do validador TS
- Armazenado uma vez, nunca atualizado
- Chart calcula: `sum(executado) / sum(planejado) = 103.4%`

### Por que isso é grave

1. **Informação contraditória** — KPI diz "ruim", gráfico diz "excelente". RH não sabe em quem confiar.
2. **Gráfico é enganoso** — Deficit 0, Excesso 129 sugere que tudo está perfeito. Mas 272 violações HARD dizem o contrário.
3. **Snapshot fica stale** — Se o RH editar demanda depois de gerar, o gráfico continua mostrando dados antigos. O KPI atualiza, o gráfico não.

### Causa Raiz

O `comparacao_demanda` do snapshot Python é SOBRESCRITO por cima do `comparacao_demanda` recalculado pelo validador TS (tipc.ts:1006). O validador TS gera um `comparacao_demanda` correto e atualizado — mas ele é jogado fora.

### Solução Correta

**Usar SEMPRE o `comparacao_demanda` do validador TS.** O snapshot Python serviu para persistência histórica, mas o validador já recalcula tudo ao carregar.

```typescript
// tipc.ts — escalasBuscar — ANTES (bugado)
return {
  ...base,
  comparacao_demanda: snapshotComparacao  // ← sobrescreve o TS com Python stale
}

// DEPOIS (correto)
return {
  ...base,
  // comparacao_demanda já vem correto do validarEscalaV3
  // snapshot só para decisões (explicabilidade do solver)
  decisoes: snapshotDecisoes.length > 0 ? snapshotDecisoes : base.decisoes,
}
```

**Alternativa conservadora:** se quiser manter o snapshot Python como referência, renomeie para `comparacao_demanda_solver` e use `base.comparacao_demanda` para o gráfico.

### Arquivos Afetados

| Arquivo | O que mudar |
|---------|-------------|
| `src/main/tipc.ts` → `escalasBuscar` | Não sobrescrever `comparacao_demanda` do base. Manter decisoes do snapshot |

### Validação

Após a mudança:
- KPI e gráfico devem mostrar a MESMA cobertura (fonte única: validador TS)
- Se demanda mudar após gerar, ambos refletem a realidade ATUAL
- Se o solver Python calcular diferente do validador TS, a discrepância fica invisível ao usuário (que é o correto — uma única verdade)

---

## DISCLAIMERS CRÍTICOS

- 🚨 **O snapshot Python (`escala_comparacao_demanda`) NÃO deve ser deletado** — serve como log histórico do que o solver gerou. Só não deve alimentar o gráfico.
- 🚨 **As decisões do solver (`escala_decisoes`) DEVEM continuar vindo do snapshot** — o validador gera decisões genéricas ("alocado"), o solver tem explicações ricas ("preferiu turno manhã porque...").
- 🚨 **O CSV de violações do Marco mostra 272 erros de H20_ALMOCO_POSICAO** — o solver Python está posicionando almoço no começo da jornada (06:30) sem respeitar mínimo 2h de trabalho antes. Isso é um bug separado no solver (constraint H20 não está sendo enforced pelo Python).

---

## CASOS PRÁTICOS

### Antes (estado atual)
- **KPI:** 39% cobertura (vermelho, assustador)
- **Gráfico:** 103.4% cobertura, Deficit 0 (verde, tranquilo)
- **Export:** CSV gerado silenciosamente com 272 erros
- **RH:** Confuso. "Tá bom ou tá ruim?"

### Depois (com as correções)
- **KPI:** 39% cobertura (vermelho)
- **Gráfico:** ~39% cobertura, mostrando os gaps reais
- **Export:** Modal avisa "272 problemas críticos. Exportar mesmo assim?"
- **RH:** Informação consistente. Sabe que precisa ajustar.

---

## RESUMO DE AÇÕES

| # | Ação | Complexidade | Impacto |
|---|------|-------------|---------|
| 1 | Não sobrescrever `comparacao_demanda` no `escalasBuscar` | Trivial (1 linha) | Gráfico fica consistente com KPI |
| 2 | Adicionar warning no ExportModal quando `violacoes_hard > 0` | Baixa (modal + prop) | Impede export cego de escala ilegal |
| 3 | Investigar por que o Python não enforma H20 no solver | Média (solver Python) | Bug separado — almoço posicionado errado |
