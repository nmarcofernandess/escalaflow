# PROMPT: Resolver Inconsistência Solver Python vs Validador TypeScript

> **Status em 2026-03-13:** este documento virou registro historico do problema original.
>
> **Como o sistema funciona hoje:**
> - o solver Python e gerador; o validador TypeScript e a autoridade de oficializacao
> - `escalas.gerar` persiste a base do solver, roda `validarEscalaV3()` e sobrescreve KPIs/cobertura oficiais com o resultado autoritativo
> - existe `generation_mode` (`OFFICIAL` vs `EXPLORATORY`) derivado da policy compartilhada
> - no modo `OFFICIAL`, o multi-pass e legal-first: `H10` nao e mais relaxada automaticamente; `H1/H6` so entram em relaxacao via override exploratorio
> - a UI de geracao (`SolverConfigDrawer`) ja permite endurecer/afrouxar regras temporariamente por geracao
>
> Para a descricao canonica atual do motor e da IA, veja [docs/flowai/COMO_O_SISTEMA_FUNCIONA.md](/Users/marcofernandes/escalaflow/docs/flowai/COMO_O_SISTEMA_FUNCIONA.md).

## Contexto

EscalaFlow é um app desktop offline que gera escalas de trabalho para supermercados. Tem dois sistemas que avaliam a mesma escala:

1. **Solver Python (OR-Tools CP-SAT)** — gera as alocações (quem trabalha quando)
2. **Validador TypeScript** — revalida as alocações contra 20 regras HARD (CLT/CCT)

O problema: esses dois sistemas **discordam sobre o que é HARD**. O solver relaxa regras em passes de degradação e depois se autoavalia como "0 violações HARD". O validador TS mantém as regras como HARD e encontra 200+ violações nas mesmas alocações.

O resultado é que o usuário (RH não-técnico) vê informação contraditória: o solver diz que tá perfeito, o validador diz que tá ilegal.

## O Bug Específico (exemplo concreto)

**Cenário:** Rotisseria, 4 colaboradoras CLT 44h, período 3 meses.

**O que o solver faz:**
1. Pass 1: tenta com todas as regras HARD → INFEASIBLE
2. Pass 1b: relaxa H6 (almoço obrigatório), H10 (meta semanal), DIAS_TRABALHO, MIN_DIARIO para SOFT
3. Solver gera alocações com jornadas de 9h30 SEM almoço (porque H6 virou SOFT)
4. Solver reporta: "97% cobertura, 0 violações HARD" (na visão dele, H6 é SOFT agora)

**O que o validador TS faz:**
- Pega as mesmas alocações
- Roda H6 como HARD (sempre)
- Encontra 200+ violações H6_ALMOCO_OBRIGATORIO ("jornada de 9h30 exige almoço")
- KPI mostra 39% cobertura com 272 problemas

**Resultado para o usuário:** Informação contraditória. Gráfico de cobertura (que usava dados do solver) dizia 103%. KPIs (do validador) diziam 39%. Escala não oficializável mas sem explicação clara do porquê.

## Arquitetura Atual

```
renderer → IPC → solver-bridge.ts → spawn(Python solver)
                                   ← JSON: alocações + indicadores + comparacao_demanda

                → validarEscalaV3() → roda 20 regras HARD (H1-H20) + APs + SOFTs
                                    → gera indicadores + comparacao_demanda + violações
```

### Solver Python (`solver/solver_ortools.py`)

Multi-pass com degradação graceful:
- **Pass 1:** Todas as regras HARD → se INFEASIBLE, cai pro 1b
- **Pass 1b:** Relaxa H10→elastic, DIAS_TRABALHO→SOFT, MIN_DIARIO→SOFT, H6→SOFT
- **Pass 2:** Idem ao 1b com mais tempo
- **Pass 3 (emergency):** Relaxa quase tudo

As regras relaxáveis hoje: H1, H6, H10, DIAS_TRABALHO, MIN_DIARIO, FOLGA_FIXA, FOLGA_VARIAVEL, TIME_WINDOW.

Quando uma regra vira SOFT no solver, ela vira uma penalidade na função objetivo — o solver PODE violá-la se o custo for menor que o benefício.

### Validador TypeScript (`src/main/motor/validacao-compartilhada.ts`)

Sempre roda TODAS as regras como HARD. Não tem conceito de "relaxar". H6 é HARD, ponto.

As 20 regras: H1 (max 6 dias consecutivos), H2 (interjornada 11h), H4 (max jornada diária), H5 (exceções), H6 (almoço obrigatório >6h), H7b (max 6h sem pausa), H9 (almoço 1-2h), H10 (meta semanal), H11-H16 (aprendiz/estagiário), H17-H18 (feriados), H19 (DSR), H20 (posição do almoço 11:00-14:00, min 2h antes/depois).

### Gráfico de Cobertura (`CoberturaChart.tsx`)

Mostra `comparacao_demanda` — planejado vs executado por slot de 15min. Atualmente pode mostrar dados do solver Python (stale) ou do validador TS, dependendo de como `escalasBuscar` monta o retorno. Esse gráfico TEM que mostrar a realidade — a mesma realidade que o KPI mostra. Se cobertura é 39%, o gráfico tem que visualizar ONDE estão os 61% de gap.

## O Problema Estrutural

Não é um bug pontual de "H6 tá sendo relaxada". É um problema de arquitetura:

1. **O solver muda as regras do jogo e se autoavalia** — quem relaxou a regra diz "não violei nenhuma regra" (porque mudou a definição de violação)
2. **Dois sistemas calculam a mesma métrica de formas diferentes** — o solver tem seu conceito de cobertura/violações, o validador TS tem outro
3. **Não existe fonte única de verdade** — o solver armazena `indicadores` e `comparacao_demanda` no banco, depois o validador recalcula por cima mas o gráfico pode usar dados stale

## O Que Precisa Ser Resolvido

### 1. Fonte Única de Verdade

Precisa haver UMA autoridade sobre "essa escala é legal ou não". O validador TS é a escolha natural porque:
- Roda no app (não depende de Python)
- Tem as 20 regras implementadas
- É o que bloqueia oficialização
- É o que o usuário vê nos KPIs

O solver Python deveria ser GERADOR, não JUIZ. Ele gera alocações, o validador julga.

### 2. O Solver Não Pode Gerar Lixo

Se o solver relaxa H6 e gera uma jornada de 9h sem almoço, o validador vai SEMPRE reprovar. O usuário fica num limbo — o solver entregou algo que nunca será oficializável.

Opções:
- **O solver NUNCA relaxa certas regras** (H6 almoço, H2 interjornada, H4 max jornada) — são CLT, não negociáveis
- **O solver usa o validador TS como pós-filtro** — mas isso é caro e complexo
- **O multi-pass é redesenhado** — o 1b não relaxa regras CLT fundamentais, relaxa apenas regras de "preferência organizacional" (meta semanal exata, dias de trabalho exatos, folga fixa)
- **Outra abordagem que eu não pensei**

### 3. O Gráfico Tem Que Ser Real

O gráfico de "Cobertura de Demanda" precisa mostrar a mesma realidade dos KPIs. Se cobertura é 39%, o gráfico mostra onde estão os gaps. Não pode ser um dado fake calculado por um sistema que mudou as regras.

## Arquivos Para Análise

| Arquivo | O que tem |
|---------|-----------|
| `solver/solver_ortools.py` | Solver completo: build_model, multi-pass, indicadores |
| `solver/constraints.py` | 20+ constraint builders (HARD e SOFT versions) |
| `src/main/motor/validacao-compartilhada.ts` | Validador TS: 20 regras, indicadores, comparacao_demanda |
| `src/main/motor/validador.ts` | Orquestrador do validador |
| `src/main/motor/solver-bridge.ts` | Bridge TS→Python e persistência |
| `src/main/tipc.ts` → `escalasBuscar` | Onde o resultado é montado (mistura solver + validador) |
| `src/renderer/src/componentes/CoberturaChart.tsx` | Gráfico que mostra comparacao_demanda |
| `docs/MOTOR_V3_RFC.md` | RFC com as 20 regras documentadas |

## Perguntas Que Preciso Que Você Responda

1. **O multi-pass de degradação (Pass 1 → 1b → 2 → 3) é uma boa ideia ou uma gambiarra?** Analise trade-offs. Existe um pattern melhor na indústria de scheduling para lidar com cenários infeasible?

2. **Quais regras NUNCA deveriam ser relaxáveis?** Faça a análise regra por regra. Considere que o público é RH de supermercado que vai imprimir e aplicar a escala. Se a escala viola CLT Art. 71 (almoço), o supermercado leva multa.

3. **Como unificar a fonte de verdade?** O solver Python deveria usar os mesmos critérios de avaliação do validador TS? Deveria haver um contrato formal (JSON schema?) que define quais regras são HARD/SOFT/OFF e ambos respeitam?

4. **O que fazer quando o cenário é genuinamente infeasible?** 4 pessoas, demanda de 3 simultâneas, jornadas de 10h com almoço obrigatório... pode simplesmente não caber. O solver deveria retornar "impossível, precisa de mais gente" ao invés de relaxar regras CLT?

5. **Proposta de arquitetura concreta.** Me dê um plano implementável. Não teoria — código. Quais funções mudam, qual o novo fluxo de dados, como o gráfico fica consistente.

## Advisory System (2026-03-15)

Alem do solver Python e do validador TypeScript, o sistema agora tem uma 3a camada de validacao: o **advisory solver-backed**.

### Como funciona

1. O drawer "Sugestao do Sistema" roda o solver em modo `advisory_only` (Phase 1 apenas)
2. Phase 1 valida folgas, cobertura diaria, domingos consecutivos, ciclo — sem horarios
3. O resultado eh normalizado para `PreviewDiagnostic[]` pelo `advisory-controller.ts`
4. Diagnosticos do advisory TEM PRECEDENCIA sobre os do preview TS para mesmos codigos
5. Se advisory falha, fallback automatico para IA com diagnostico em contexto

### Convergencia preview TS ↔ advisory solver

O preview TS (instantaneo) e o advisory solver (10-30s) agora convergem:

- `preview-multi-pass.ts` tenta strict → relaxed baseado em HARD/SOFT config
- `buildPreviewDiagnostics` valida com as mesmas regras H3 que o solver
- Quando advisory roda, seus diagnosticos substituem os do preview para mesmos criterios
- O painel de Avisos unificado (`AvisosSection`) mostra a melhor verdade disponivel

### Arquivos chave

| Arquivo | Papel |
|---------|-------|
| `src/main/motor/advisory-controller.ts` | Orquestra pipeline advisory |
| `src/shared/preview-multi-pass.ts` | Multi-pass TS (strict → relaxed) |
| `src/shared/preview-diagnostics.ts` | Validacao rule-aware |
| `src/renderer/src/lib/build-avisos.ts` | Merge avisos (advisory substitui preview) |
| `tests/main/solver-advisory-parity.spec.ts` | Parity test Phase 1 ↔ TS |

## Restrições

- O solver Python existe porque OR-Tools CP-SAT é ordens de magnitude mais eficiente que qualquer solução TS
- O validador TS existe porque precisa rodar no app sem Python (revalidação após ajuste manual)
- Ambos precisam existir. A questão é como fazer eles concordarem.
- Não pode virar uma colcha de retalhos de ifs e elses — cada bug novo não pode exigir um patch ad-hoc nos dois sistemas
- A solução precisa ser SISTÊMICA, não pontual
