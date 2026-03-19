# PROMPT: Review do Preview/Advisory + Estudo 6x1

## Contexto

Acabamos de fazer uma refatoracao grande no sistema de preview de ciclo e advisory (sugestao do sistema). Preciso que voce:

1. **REVISE** todo o trabalho feito nesta sessao (listado abaixo)
2. **ESTUDE** se o preview de ciclo pode ser adaptado pra 6x1
3. **CORRIJA** o bug onde o setor em 6x1 mostra o preview 5x2 incorretamente

---

## O que foi feito nesta sessao (REVISAR TUDO)

### Arquivos modificados (leia TODOS inteiramente):

| Arquivo | O que mudou |
|---------|-----------|
| `src/shared/simula-ciclo.ts` | +FolgaWarning type, +pre-check beco sem saida (folgas fixas > capacidade), +warnings FF/FV conflito no loop greedy |
| `src/shared/preview-diagnostics.ts` | +DemandaSegmento type, +computeHalfDemand (split manha/tarde), +check DEMANDA_FAIXA_INSUFICIENTE, +check FOLGA_VARIAVEL_CONFLITO e FOLGA_FIXA_CONFLITO |
| `src/shared/preview-multi-pass.ts` | +propagacao de demandaSegmentos/horaAbertura/horaFechamento |
| `src/shared/advisory-types.ts` | SIMPLIFICADO: removido AdvisoryCriterion, AdvisoryCriterionStatus, PROPOSAL_INVALID, CURRENT_INVALID. Output agora usa PreviewDiagnostic[] direto |
| `src/main/motor/advisory-controller.ts` | REESCRITO: removida toda camada de criterios (buildTsCriteria, mergeCriteria, checkDescansoFromHorario, normalizeAdvisoryToDiagnostics). Agora emite PreviewDiagnostic[] unificado. Strip feriados/excecoes (ciclo abstrato). Free solve sempre roda. |
| `src/renderer/src/componentes/SugestaoSheet.tsx` | REESCRITO: renderiza PreviewDiagnostic[] (nao mais AdvisoryCriterion[]). DiffTable lado-a-lado com colunas Nome/Atual/Sugestao. |
| `src/renderer/src/paginas/SetorDetalhe.tsx` | handleSugerir roda TS liberado (tudo auto) ANTES do solver. Passa demandaSegmentos e preview_diagnostics. |

### Documentacao criada (LEIA TUDO):

| Doc | Conteudo |
|-----|---------|
| `docs/BUILD_SUGESTAO_SHEET_V2.md` | BUILD completo com 25 perguntas respondidas, arquitetura, fluxos, layout |
| `docs/ANALYST_SUGERIR_PIPELINE_V2.md` | Spec da pipeline TS + solver integrado, mensagens, hierarquia |

### Decisoes arquiteturais tomadas:

1. **Ciclo e abstrato** — sem data, sem feriado, sem excecao. Phase 1 do solver agora strip feriados/excecoes.
2. **TS e autoritativo** pra mensagens pattern-level (cobertura dia, H3 domingos, ciclo). Solver adiciona so COBERTURA_FAIXA e SOLVER_INFEASIVEL.
3. **Mensagens unificadas** — TS e solver usam o mesmo tipo (PreviewDiagnostic). Sem traducao.
4. **"Sugerir" roda TS liberado primeiro** (<1ms) com tudo auto, depois solver valida em background.
5. **AdvisoryCriterion eliminado** — era camada de abstracao desnecessaria que traduzia TS→criterio→UI.

---

## BUG PRA CORRIGIR: 6x1 mostra preview 5x2

### Sintoma
Quando o usuario muda o regime do setor pra 6x1, o CicloGrid continua mostrando o preview de ciclo 5x2 (com FF/FV selectors, grid de semanas, cobertura, botao Sugerir). Deveria mostrar mensagem "disponivel apenas para 5x2" ou nao mostrar o CicloGrid.

### Causa provavel
`SetorDetalhe.tsx` ~L1170:
```typescript
const multiPassResult: MultiPassResult | null =
  modoSimulacaoEfetivo === 'SETOR' && setor?.regime_escala !== '5X2'
    ? null
    : runPreviewMultiPass(...)
```
A guarda so funciona se `modoSimulacaoEfetivo === 'SETOR'`. Quando e 'LIVRE' ou quando o setor no store ainda nao atualizou, o preview roda com 5x2 mesmo sendo 6x1.

### O que corrigir
1. A guarda deve funcionar independente do modo
2. Se setor e 6x1, CicloGrid nao deve aparecer na aba de escala
3. Verificar se o `setor?.regime_escala` ta atualizado quando o usuario muda no form

---

## ESTUDO: Preview de ciclo para 6x1

### O que o 5x2 faz hoje (estudar `src/shared/simula-ciclo.ts`):
- `gerarCicloFase1`: N pessoas, K trabalham domingo, 2 folgas por semana (fixa + variavel XOR)
- Pattern de domingos: rotativo sem TT (preflight) ou round-robin (relaxed)
- Folga fixa: 1 dia fixo por semana (SEG-SAB)
- Folga variavel: 1 dia que so acontece quando trabalha domingo (XOR)
- Output: grid T/F por pessoa/semana, cobertura por dia, stats

### Como seria o 6x1:
- 6 dias trabalho, 1 folga por semana
- SEM folga variavel (so 1 folga)
- A folga RODA entre os dias (pode ser fixa ou rotativa)
- Domingo: similar ao 5x2 (quem trabalha/folga domingo)
- Demanda: ainda precisa checar cobertura por dia

### Perguntas pra responder:
1. `gerarCicloFase1` pode ser adaptado pra 6x1 ou precisa de funcao separada?
2. O CicloGrid pode renderizar 6x1 (sem coluna FV, sem XOR)?
3. O solver Phase 1 (`solve_folga_pattern`) ja suporta 6x1? (checar `add_dias_trabalho` com dias_trabalho=6)
4. Qual o ciclo minimo pra 6x1? (ex: N=5, K=3 → ciclo = ?)
5. O `buildPreviewDiagnostics` funciona pra 6x1 ou precisa adaptar?

### Arquivos pra estudar:
- `src/shared/simula-ciclo.ts` — INTEIRO (770 linhas)
- `src/shared/preview-diagnostics.ts` — INTEIRO
- `src/shared/preview-multi-pass.ts` — INTEIRO
- `src/renderer/src/componentes/CicloGrid.tsx` — como renderiza, props, condicoes
- `src/renderer/src/paginas/SetorDetalhe.tsx` — como monta previewSetorRows, simulacaoPreview, guarda de regime
- `solver/solver_ortools.py` — `solve_folga_pattern` e `add_dias_trabalho` (suporte a dias_trabalho=6)
- `solver/constraints.py` — `add_dias_trabalho`, `add_folga_fixa_5x2` (nome implica 5x2 only?)
- `src/shared/constants.ts` — CLT constants por regime

### Entregavel esperado:
1. **Bug fix** do 6x1 mostrando preview 5x2
2. **Analise** se o TS pode gerar ciclo 6x1 e o que precisaria mudar
3. **Review** de todo o trabalho feito (listar bugs, gaps, melhorias)
4. **Plano** pra implementar preview 6x1 se for viavel

---

## Comandos uteis

```bash
npm run dev          # rodar o app
npm run typecheck    # verificar tipos
npm run solver:cli -- list   # listar setores
```

## Regras do projeto

Leia `CLAUDE.md` na raiz — tem todas as convencoes, stack, patterns.
Snake_case ponta a ponta. Layout contract inviolavel. Checar `npm run typecheck` sempre.
