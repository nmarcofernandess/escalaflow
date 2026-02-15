# PRD: Motor + Fundação — Correções Críticas do Motor de Escalas

> **Workflow:** feature
> **Budget sugerido:** high
> **Criado em:** 2026-02-14T23:00:00Z
> **Fonte:** gather
> **Parent:** specs/004-finalize-v2 (ITERACAO.md — PARTE 1: BACK, fases B1-B4)

---

## Visao Geral

O motor de geracao de escalas do EscalaFlow v2 JA EXISTE (776 linhas, 7 fases implementadas), mas tem bugs criticos que impedem uso em producao:

1. **corte_semanal ignorado** — motor usa SEGUNDA hardcoded, supermercado pode usar QUI-QUA
2. **max_minutos_dia por contrato nao validado** — estagiario pode ter 5h sem violacao
3. **repair sobrescreve pinned cells** — quebra semantica do smart recalc
4. **threshold off-by-one** — forca folga no 6o dia (CLT permite 6 consecutivos)
5. **validador sem lookback** — nao detecta violacoes cross-escala
6. **estagiario no domingo nao flaggado** — validador nao impede ajuste manual invalido
7. **worker sem timeout** — motor pode travar e congelar UI indefinidamente
8. **pinnedCells nao preservado em todas as fases** — smart recalc nao funciona corretamente
9. **ZERO testes** — nenhuma forma de validar que o motor funciona

**Objetivo:** Motor 100% correto, testado, e robusto. Pronto pra producao.

**Spec detalhada:** Toda a logica, DoDs e QAs estao em `specs/004-finalize-v2/ITERACAO.md`, secoes B1.1-B1.4, B2.1-B2.5, B3.1-B3.2, B4.1.

---

## Requisitos Funcionais

### RF1: Scaffold de Testes (B4.1 scaffold)
- [ ] Criar `src/main/motor/test-motor.ts` executavel via `npx tsx`
- [ ] Estrutura basica: abre DB, roda seed, gera escala pra 1 setor, valida resultado
- [ ] Output claro: PASS/FAIL + metricas (pontuacao, cobertura, violacoes)
- [ ] Esse scaffold sera EXPANDIDO no RF9 apos todas as correcoes

### RF2: corte_semanal respeitado (B1.1)
- [ ] `getWeeks()` em `validacao-compartilhada.ts` recebe `corte_semanal` como parametro
- [ ] Motor passa `corte_semanal` da empresa pro `getWeeks()`
- [ ] Validador usa o mesmo `corte_semanal`
- [ ] Distribuicao de folgas (FASE 3) respeita o corte
- [ ] Meta semanal (R5) calculada com a semana correta

### RF3: max_minutos_dia por contrato (B1.2) — IMPLEMENTADO + MERGEADO com R4
- [x] Tipo `ColabValidacao` expandido com `max_minutos_dia`, `dias_trabalho`, `trabalha_domingo`
- [x] Violacao HARD (nao SOFT — contrato e lei)
- [x] **MERGE R4/R4b:** R4 (CLT 600min) e R4b (contrato) mergeados em check unico: `Math.min(CLT.MAX_JORNADA_DIARIA_MIN, c.max_minutos_dia)`. Campo `regra` e dinamico: `'CONTRATO_MAX_DIA'` ou `'MAX_JORNADA_DIARIA'` conforme o mais restritivo.

### RF4: Repair nao toca pinned cells (B1.3)
- [ ] FASE 4.5 filtra pinned cells dos candidatos de folga
- [ ] Se TODOS os dias do streak sao pinned, nao forca folga (validacao flagga depois)

### RF5: Threshold corrigido (B1.4)
- [ ] Linha ~270 do gerador.ts: `>=6` vira `>6` (CLT permite 6 consecutivos)

### RF6: Robustez do validador (B2.1-B2.5)
- [ ] B2.1: Validador carrega lookback da escala OFICIAL anterior pra R1 e R3
- [ ] B2.2: Nova regra R_ESTAGIARIO_DOMINGO (HARD) — trabalha_domingo=false + TRABALHO no domingo
- [ ] B2.3: Worker thread com timeout 30s via Promise.race + matar worker + erro humanizado
- [ ] B2.4: Motor valida inputs (setor existe, colabs > 0, datas validas) antes de processar
- [ ] B2.5: Unificar formula de metaDiariaMin entre gerador e validador (em validacao-compartilhada.ts)

### RF7: pinnedCells em todas as fases do motor (B3.1)
- [ ] FASE 2: Pinned cells iniciam com status pinned (nao default)
- [ ] FASE 3: Pinned cells nao entram no pool de folga (mas contam pro calculo semanal)
- [ ] FASE 4: Pinned cells nao entram no rodizio de domingo
- [ ] FASE 4.5: Repair nao toca pinned cells (ja coberto em RF4)
- [ ] FASE 5: Pinned TRABALHO com horas = skip. Pinned TRABALHO sem horas = motor atribui
- [ ] Validacao + scoring roda em TUDO (inclusive pins)
- [ ] Backward compatible: sem pinnedCells = comportamento atual

### RF8: Worker deserializa pinnedCells (B3.2)
- [ ] WorkerInput tem campo `pinnedCells?: [string, {...}][]`
- [ ] Worker deserializa pra Map antes de chamar gerarProposta
- [ ] TypeScript compila sem erros

### RF9: Testes expandidos (B4.1 completo) — 10 TESTES IMPLEMENTADOS
- [x] Teste basico: 4 setores, 30 dias, 0 HARD, pontuacao > 80, cobertura > 90%
- [x] Teste pinned FOLGA: pinar 1 celula FOLGA, verificar preservacao + 0 HARD
- [x] Teste lookback: criar escala OFICIAL anterior, gerar nova, verificar continuidade
- [x] Teste estagiario: verificar que NAO aparece no domingo
- [x] Teste R2 (descanso): cenario apertado, verificar 11h entre jornadas
- [x] Teste pinned conflito: pinar streak de 7 TRABALHO, verificar HARD violation R1
- [x] **Teste partial pinned streak (NOVO — GAP 2):** Pinar 5 TRABALHO + 2 dias livres. Repair usa dia livre (nao toca pinned). 0 HARD violations.
- [x] **Teste max_minutos_dia (NOVO — GAP 1):** Pinar celula com minutos > max_minutos_dia do contrato. Verifica CONTRATO_MAX_DIA HARD violation.
- [x] Teste cobertura impossivel: 2 colabs, demanda de 10 → cobertura baixa, SOFT (nao HARD)
- [x] Teste corte_semanal: gerar com corte QUI_QUA, verificar folgas na semana certa
- [x] TODOS os testes: output PASS/FAIL + metricas

---

## Criterios de Aceitacao

### CA1: Motor gera escalas sem HARD violations
- [ ] `npx tsx src/main/motor/test-motor.ts` retorna 0 failures
- [ ] 4 setores testados (Caixa 8 colabs, Acougue 3, Padaria 3, Hortifruti 2): 0 HARD violations CADA
- [ ] Pontuacao > 80 CADA setor
- [ ] Cobertura > 90% CADA setor (ou mensagem clara de impossibilidade)

### CA2: Validador e ultima barreira
- [x] Lookback cross-escala detecta streak de 7 consecutivos
- [x] Estagiario manualmente colocado no domingo = HARD violation
- [x] max_minutos_dia violado = HARD violation (R4 mergeado — usa `Math.min(CLT, contrato)`)
- [x] Validador e gerador concordam nos indicadores (mesma formula metaDiariaMin)

### CA3: Smart Recalc funciona end-to-end
- [ ] Pinar 2 celulas (1 TRABALHO→FOLGA, 1 FOLGA→TRABALHO)
- [ ] Motor regenera ao redor preservando pins
- [ ] 0 HARD violations no resultado
- [ ] Pinar streak de 7 TRABALHO = HARD violation (correto — responsabilidade da gestora)

### CA4: Robustez em producao
- [x] Worker com timeout: se motor travar, erro limpo em 30s (nao UI congelada) + clearTimeout no success (GAP 3 fix)
- [x] Input invalido: erro claro, nao stack trace
- [x] corte_semanal QUI_QUA: folgas distribuidas na semana correta
- [x] TypeScript compila sem erros (`npx tsc --noEmit`)

---

## Constraints

- **C1:** snake_case ponta a ponta (DB = JSON = TS). Sem camelCase.
- **C2:** Motor roda em worker thread (nao pode travar UI)
- **C3:** Zero breaking changes no schema de banco existente
- **C4:** Backward compatible: sem pinnedCells = comportamento atual do motor
- **C5:** Seguir patterns existentes (tipc, validacao-compartilhada.ts, etc)
- **C6:** Nao mexer em frontend neste orchestrate (so motor + validador + IPC + worker)

---

## Fora do Escopo

- Frontend (dark mode, grid, UX) — orchestrate 2
- ContratoLista CRUD — orchestrate 2
- Formularios Zod — orchestrate 3
- UX proposals (Dashboard tabs, Sidebar Escalas) — backlog
- Reescrever motor do zero — REFINAR o existente
- Novas entidades ou tabelas no banco

---

## Servicos Envolvidos

- [x] **Motor** (`src/main/motor/gerador.ts`) — Correcoes fases 3, 4, 4.5, 5 + pinnedCells
- [x] **Validador** (`src/main/motor/validador.ts`) — Lookback, estagiario, max_minutos_dia
- [x] **Validacao Compartilhada** (`src/main/motor/validacao-compartilhada.ts`) — getWeeks, metaDiariaMin
- [x] **Worker** (`src/main/motor/worker.ts`) — Deserializar pinnedCells, timeout
- [x] **IPC** (`src/main/tipc.ts`) — Timeout no handler, validacao de input
- [x] **Testes** (`src/main/motor/test-motor.ts`) — CRIAR (novo arquivo)
- [ ] Frontend — NAO TOCAR
- [ ] Database schema — NAO TOCAR

---

## Arquivos Criticos

| Arquivo | Linhas | O que mexer |
|---------|--------|-------------|
| `src/main/motor/gerador.ts` | ~776 | Fases 3-5: corte_semanal, threshold, pinnedCells |
| `src/main/motor/validador.ts` | ~84 | Lookback, R_ESTAGIARIO_DOMINGO, R_CONTRATO_MAX_DIA |
| `src/main/motor/validacao-compartilhada.ts` | ~324 | getWeeks(corte_semanal), metaDiariaMin unificado |
| `src/main/motor/worker.ts` | ~36 | Deserializar pinnedCells, tipagem |
| `src/main/tipc.ts` | ~782 | Timeout worker (escalas.gerar + escalas.ajustar), validacao input |
| `src/main/motor/test-motor.ts` | ~699 | 10 cenarios de teste (8 originais + 2 GAPs) |
| `src/shared/types.ts` | ref | ColabValidacao expandido (max_minutos_dia) |
| `src/shared/constants.ts` | ref | Regras CLT (nao mexer, so referenciar) |

---

## Ordem de Execucao Sugerida

A ordem importa porque cada fase depende da anterior:

```
1. B4.1 scaffold    → Ferramenta basica pra validar tudo
2. B1.4 threshold   → Fix mais simples, desbloqueia testes
3. B1.1 corte       → getWeeks refatorado, folgas corretas
4. B1.2 max_minutos → Nova regra no validador
5. B1.3 repair pins → Fase 4.5 respeita pins
6. B2.5 metaDiaria  → Unifica formula
7. B2.1 lookback    → Validador carrega escala anterior
8. B2.2 estagiario  → Nova regra domingo
9. B2.3 timeout     → Worker protegido
10. B2.4 input val  → Motor defensivo
11. B3.1 pinnedCells → Todas as fases preservam pins
12. B3.2 worker pin → Deserializacao correta
13. B4.1 expandido  → TODOS os testes passam
```

---

## Budget Sugerido

**Recomendacao:** **HIGH**

**Justificativa:**
- Motor tem 776+ linhas de logica complexa interligada
- 13 correcoes que afetam umas as outras (sequenciais)
- Precisa entender 7 fases do motor antes de mexer
- Risco alto de regressao se feito sem cuidado
- Testes sao criticos — nao pode "achar que funciona"
- Discovery precisa de opus pra entender o motor inteiro
- Critic precisa de opus pra pegar edge cases

---

## Notas Adicionais

### Referencia Completa
Todos os DoDs e QAs detalhados estao em `specs/004-finalize-v2/ITERACAO.md`:
- B1.1-B1.4: linhas 196-258
- B2.1-B2.5: linhas 261-337
- B3.1-B3.2: linhas 340-374
- B4.1: linhas 395-413

### Seed Data Disponivel
O `src/main/db/seed.ts` ja tem dados realistas:
- 4 setores (Caixa, Acougue, Padaria, Hortifruti)
- 16 colaboradores distribuidos
- 10 faixas de demanda
- 3 excecoes (ferias + atestado)
- Empresa com corte SEG_DOM e tolerancia 30min

### O que JA funciona (NAO quebrar)
- B3.3 (IPC escalas.ajustar) — JA IMPLEMENTADO em tipc.ts:470-556
- Grid interativa (F2) — JA IMPLEMENTADA
- Smart Recalc base — funciona, so precisa de pinnedCells consistente

### Riscos (pos-implementacao)
- ~~**ALTO:** Mudar getWeeks() pode quebrar scoring existente~~ → Testado, funciona (teste corte-semanal-qui-qua PASS)
- ~~**ALTO:** pinnedCells em 5 fases = muitos pontos de falha~~ → Verificado fase a fase, 1 bug encontrado e corrigido (FASE 3 guard)
- **MEDIO:** Timeout 30s no worker pode matar geracao legitima em setores grandes (mitigacao: mensagem clara + sugestao de reduzir periodo)
- **BAIXO:** Novas regras no validador (R3b, R4b merged) podem flaggar escalas que antes "passavam" — correto por design

### Gaps Pos-QA (Resolvidos)
- ~~**GAP 1:** Teste max_minutos_dia ausente~~ → testMaxMinutosDia implementado
- ~~**GAP 2:** Teste partial pinned streak ausente~~ → testPartialPinnedStreak implementado
- ~~**GAP 3:** withTimeout nao limpava timer~~ → clearTimeout adicionado no .then()

### Divida Tecnica Pendente
- **Lookback duplicado:** gerador.ts e validador.ts tem ~45 linhas identicas de carregamento de lookback. Extrair pra funcao compartilhada.
- **Teste gerar→persistir→revalidar:** Nenhum teste verifica concordancia entre gerador e validador apos persistencia.
- **Detalhes completos:** Ver `specs/005-motor-fundacao/ISSUES_MOTOR.md`
