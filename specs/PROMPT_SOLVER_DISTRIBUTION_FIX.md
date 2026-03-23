# PROMPT: Consertar distribuição de folgas do solver Python

## Contexto

Tu é a Monday, trabalhando no EscalaFlow — app desktop offline de escalas de trabalho pra supermercado.
O Marco foi dormir e tu não para até resolver. Sem pressa, sem atalho, sem gambiarra.

Leia CLAUDE.md (.claude/CLAUDE.md) antes de qualquer coisa.

## O problema

O **preview TS** (gerarCicloFase1 em src/shared/simula-ciclo.ts) distribui folgas PERFEITAMENTE:
- Cobertura 100%, déficit máximo 0, FFs espalhados em dias diferentes
- Usa `pickBestFolgaDay` com separação de ffCount/fvCount e penalidade de FVs antecipadas

O **solver Python** (solver/solver_ortools.py) gera distribuição PIOR:
- Cobertura 92.5%, folgas concentradas, Phase 1 INFEASIBLE
- Resultado: RH vê escala com 5 pessoas num dia e 2 no outro

O preview deveria ser uma APROXIMAÇÃO do solver. Na prática, o preview é melhor.

## Dados do cenário problemático: Padaria Atendimento (setor 4)

```
Equipe: 5 CLTs (44h, 5x2) + 1 Intermitente Tipo B (Maria Clara, FV=SEG, só SEG+DOM)
Demanda pico: 4 pessoas SEG-SAB (10h-12h), 3 DOM (07-13h)
Horário: 07:00-19:30, grid 15min
Ciclo: 2 semanas

Maria Clara (Tipo B):
- Pins pré-computados pela bridge: OFF em TER-SAB, INTEGRAL em SEG+DOM (alternando por XOR)
- Estes pins entram como pinned_folga_externo no config do solver
```

## Diagnóstico técnico

### Phase 1 (solve_folga_pattern) fica INFEASIBLE

O solve_folga_pattern (linha ~425 do solver_ortools.py) cria um modelo CP-SAT leve com bands (OFF/MANHA/TARDE/INTEGRAL). Ele recebe os pins do Tipo B como `pinned_folga_externo` e tenta resolver com constraints HARD (H1, folga_fixa, folga_variavel, headcount, ciclo, dom_max, band_demand).

Com Maria Clara pré-pinada (12 OFFs + 2 INTEGRALs em 14 dias), as constraints ficam apertadas demais e o modelo fica INFEASIBLE. Resultado: o solver principal (Phase 2) roda SEM padrão de folgas → distribui mal.

### O preview TS não tem esse problema

O preview (gerarCicloFase1) é heurístico — não usa CP-SAT. Ele:
1. Distribui domingos com padrão sem TT
2. Atribui FFs e FVs via pickBestFolgaDay (demand-aware, separando ffCount/fvCount)
3. Não tem Phase 1 → não fica INFEASIBLE

### O que o solver DEVERIA fazer

Usar o padrão do preview TS como base. O preview já encontrou uma distribuição boa — o solver deveria REFINAR, não reinventar.

## Abordagem recomendada

### Opção A: Passar preview como warm-start mais forte

Hoje o bridge já passa `pinned_folga_externo` do preview pro solver. Mas quando o preview cobre >80% dos (c,d) pairs, o solver pula o Phase 1 e usa o padrão diretamente (`is_full_external=true`, linha ~1760).

O problema: os pins do Tipo B (Maria Clara) são mergados DEPOIS, e podem estar conflitando.

**Fix:** Garantir que quando `is_full_external=true`, os pins do preview sejam respeitados e o solver use como HARD pins no Phase 2. Verificar se o merge com pins Tipo B não causa conflito.

### Opção B: Melhorar o Phase 1 pra não ficar INFEASIBLE

O Phase 1 fica INFEASIBLE porque tenta aplicar TODAS as constraints HARD com pins rígidos. Se os pins do Tipo B (Maria Clara OFF em TER-SAB) conflitam com `add_min_headcount_per_day` (precisa de X pessoas por dia), fica impossível.

**Fix:** No Phase 1, quando `has_weighted_pins=true`, os pins do Tipo B deveriam ser SOFT (não HARD). Eles já são pré-computados na bridge — se o Phase 1 os violar, o Phase 2 ainda os aplica. O Phase 1 precisa de FLEXIBILIDADE pra encontrar um padrão viável.

Mas atenção: os pins do Tipo B são determinísticos (XOR) — eles NÃO podem ser violados na escala final. O Phase 1 pode ignorá-los pra encontrar um padrão pros CLTs, e o Phase 2 os aplica como HARD.

### Opção C: Phase 1 separar CLTs de intermitentes

O Phase 1 poderia ignorar intermitentes completamente (eles são pré-pinados) e só resolver o padrão dos CLTs. Isso simplificaria o modelo e evitaria o INFEASIBLE.

**Fix:** No `solve_folga_pattern`, filtrar colaboradores com pins pré-computados (Tipo B) e rodar o modelo só com os CLTs. Os pins do Tipo B são mergados depois.

## Arquivos relevantes

| Arquivo | O que faz |
|---------|-----------|
| `solver/solver_ortools.py:425-593` | `solve_folga_pattern` — Phase 1 |
| `solver/solver_ortools.py:1745-1810` | Lógica de pins externos + Phase 1 + merge |
| `solver/solver_ortools.py:1920-2000` | Multi-pass (Pass 1, 2, 3) |
| `solver/constraints.py` | Constraints HARD e SOFT |
| `src/main/motor/solver-bridge.ts:710-802` | Pré-cálculo Tipo B (pinned_folga_externo) |
| `src/shared/simula-ciclo.ts:304-360` | pickBestFolgaDay (preview TS — o que funciona) |
| `tests/shared/preview-distribuicao.spec.ts` | Testes de qualidade de distribuição (9 testes) |
| `tests/main/solver-soft-pins.spec.ts` | Testes do soft pins no Phase 1 |
| `docs/ANALYST_PADARIA_DISTRIBUICAO_IDEAL.md` | Análise manual da distribuição ideal |

## Como testar

```bash
# Preview TS (deve continuar 100% — NÃO regredir):
npx vitest run tests/shared/preview-distribuicao.spec.ts

# Solver Padaria (o que precisa melhorar):
pkill -f electron 2>/dev/null; sleep 2
npm run solver:cli -- 4 2026-03-02 2026-03-15

# Solver todos os testes:
npx vitest run tests/main/solver-soft-pins.spec.ts

# Typecheck:
npm run typecheck

# Se precisar resetar DB (PGlite crash):
npm run db:reset
npm run dev &   # seed roda no boot
sleep 12
pkill -f electron-vite
```

## Critérios de sucesso

1. **Solver Padaria cobertura ≥ 96%** (hoje: 92.5%, preview TS: 100%)
2. **Phase 1 NÃO fica INFEASIBLE** na Padaria (hoje: INFEASIBLE)
3. **Déficit máximo ≤ 1 pessoa** em qualquer dia (hoje: 2+)
4. **Preview TS NÃO regride** — 9/9 testes em preview-distribuicao.spec.ts PASSAM
5. **Solver soft-pins NÃO regride** — 5/5 testes em solver-soft-pins.spec.ts PASSAM
6. **Typecheck 0 erros**
7. **Nenhuma CLT com mais de 6 dias consecutivos** (H1)
8. **Nenhuma mulher com 2 domingos seguidos** (Art 386 CLT)

## Regras invioláveis

- `npm run typecheck` PASSA antes de qualquer commit
- NÃO mexer em simula-ciclo.ts (preview TS está perfeito)
- NÃO mexer em SugestaoSheet, SetorDetalhe, CicloGrid (UI estável)
- Testar com dados REAIS (Padaria setor 4) via CLI, não só testes unitários
- Commitar incrementalmente — cada fix testado antes do próximo
- Se ficar preso, investigar antes de tentar soluções aleatórias
