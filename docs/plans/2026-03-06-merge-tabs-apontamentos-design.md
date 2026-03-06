# Design: Merge Tabs — Escala + Apontamentos

**Data:** 2026-03-06
**Status:** Aprovado

---

## Contexto

A EscalaPagina hoje tem 3 tabs: Resumo, Escala, Avisos. A mesma lista de violacoes aparece em ate 3 lugares (coluna Avisos na ResumoTable, aba Avisos com ViolacoesAgrupadas, toggle Avisos na aba Escala). Objetivo: reduzir para 2 tabs sem perder informacao.

## Decisao

### 2 Tabs

| Ordem | Nome | Conteudo |
|-------|------|----------|
| 1 | **Escala** | Ciclo, Timeline, Funcionarios (toggles como hoje, SEM toggle Avisos) |
| 2 | **Apontamentos** (com badge count) | Card KPIs + Tabela por colaborador (avisos como contagem) + ViolacoesAgrupadas (detalhe HARD/SOFT) |

### Layout da aba Apontamentos

```
Card KPIs (cobertura, HARD count, SOFT count, pontuacao)
  |
Tabela "Por colaborador"
  Colab | Real | Meta | Delta | Avisos (contagem com icones, NAO texto)
  |
ViolacoesAgrupadas (HARD cards + SOFT cards — detalhe completo)
```

### O que muda

1. Tab "Avisos" removida
2. Tab "Resumo" renomeada para "Apontamentos", vira a SEGUNDA tab
3. Tab "Escala" vira a PRIMEIRA tab (defaultValue)
4. Coluna Avisos da ResumoTable: texto completo -> contagem com icones (ex: icone HARD + "1" / icone SOFT + "2" / "—")
5. ViolacoesAgrupadas renderizado abaixo da tabela na aba Apontamentos (se houver violacoes)
6. Toggle "Avisos" removido da aba Escala (4 toggles -> 3: Ciclo, Timeline, Funcionarios)
7. Badge de contagem de violacoes na tab "Apontamentos" (como hoje na tab Avisos)

### O que NAO muda

- Card KPIs (identico)
- ViolacoesAgrupadas component (identico, so muda onde renderiza)
- Aba Escala: Ciclo, Timeline, Funcionarios (identicos)
- ExportModal e logica de export (inalterados)

### Racional

- Opcao A (so tabela): perde separacao HARD/SOFT e detalhe com data
- Opcao B (so cards): perde correlacao horas x aviso na mesma linha
- Opcao C (hibrido — escolhida): tabela da "quem tem problema", cards dao "qual problema"

### Arquivos impactados

| Arquivo | Mudanca |
|---------|---------|
| `EscalaPagina.tsx` | Reorder tabs, rename, remove tab Avisos, remove toggle avisos da aba Escala, mover ViolacoesAgrupadas |
| `EscalaPagina.tsx` (ResumoTable) | Coluna Avisos: texto -> contagem com icones |
| Nenhum outro arquivo | ViolacoesAgrupadas, ExportModal, formatadores — inalterados |
