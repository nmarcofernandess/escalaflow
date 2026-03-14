# WARLOG — Painel Unico de Escala

> Data: 2026-03-14
> Status: EM GUERRA
> Spec base: `docs/ANALYST_PAINEL_UNICO_ESCALA.md` (38 secoes, 3500 linhas)

---

## MISSAO

Transformar o sistema de escalas de 3 motores separados (brinquedo TS + preview + solver Python)
em 1 fluxo progressivo com context reativo, UI unificada, e mensagens inteligentes.

## OBJETIVO

RH abre o setor → ve o ciclo instantaneamente → edita → avisos aparecem →
clica Gerar → escala com horarios → oficializa. Sem surpresas, sem erros genericos,
sem dados stale.

---

## REGRA DE OURO

```
🔴 TODA TASK PRECISA SER VALIDADA COM O MARCO (produto + codigo).
   NAO FIZEMOS DISCOVERY COMPLETA PRA TUDO.
   CADA PARTE ENVOLVE: DISCOVERY → ANALISE → DECISAO COM MARCO → IMPLEMENTACAO → TESTE.
   NENHUM CLAUDE IMPLEMENTA SEM APROVACAO DO MARCO.
```

---

## DOMINIOS E EPICOS

### DOMINIO A: INFRAESTRUTURA (Context + Invalidacao)

**Objetivo:** Criar a fundacao reativa que tudo depende.

| ID | Task | Tipo | Viab. | Dep. | Est. |
|----|------|------|-------|------|------|
| A1 | Criar AppDataStore (Zustand) com entidades globais (empresa, tipos, feriados, regras) | Feature | G | - | G |
| A2 | Criar AppDataStore entidades por setor (colabs, postos, demandas, regras, excecoes, escalas) | Feature | G | A1 | G |
| A3 | Criar derivados automaticos no store (N, K, ciclo, cobertura, demanda, avisos) | Feature | Y | A2 | G |
| A4 | Implementar IPC event `data:invalidated` no tipc.ts (toda mutacao emite) | Feature | G | - | M |
| A5 | Implementar IPC event nas tools.ts da IA (toda tool WRITE emite) | Feature | G | A4 | M |
| A6 | Listener global em App.tsx que recebe invalidacao e recarrega store | Feature | G | A4 | M |
| A7 | Criar useAppData() hook seletor tipado | Feature | G | A2 | P |
| A8 | Migrar SetorDetalhe de 10 useApiData → useAppData() | Refactor | Y | A7 | G |
| A9 | Migrar EscalaPagina de 10 useApiData → useAppData() | Refactor | Y | A7 | G |
| A10 | Migrar Dashboard, EscalasHub, ColaboradorLista → useAppData() | Refactor | Y | A7 | G |
| A11 | Snapshot do store pro IaContexto (discovery le do snapshot) | Feature | Y | A3 | M |
| A12 | Eliminar tools redundantes da IA (listar_memorias, consultar setores/feriados/regras, obter_alertas) | Refactor | Y | A11 | M |

### DOMINIO B: LOGICA DO CICLO (TS inteligente + Guards)

**Objetivo:** O TS gera certo, valida certo, e o solver respeita.

| ID | Task | Tipo | Viab. | Dep. | Est. |
|----|------|------|-------|------|------|
| B1 | Fix folga_fixa=DOM no solver: pular XOR, ciclo, dom_max pra essa pessoa | Bug | G | - | M |
| B2 | Fix folga_fixa=DOM na bridge: zerar ciclo, nullar variavel | Bug | G | - | P |
| B3 | Fix folga_fixa=DOM no TS: tratar como caso especial no gerarCicloFase1 | Bug | G | - | M |
| B4 | autoFolgaInteligente: distribuir folgas baseado na demanda (nao p%6) | Feature | Y | - | G |
| B5 | Elegibilidade domingo variavel por semana (mapa com excecoes/feriados) | Feature | Y | - | G |
| B6 | Guard no solver: colaborador sem posto (funcao_id=null) nao entra na escala | Bug | G | - | P |
| B7 | Guard no solver: tipo_trabalhador deve ser derivado do contrato (prevenir CLT em intermitente) | Bug | Y | - | M |
| B8 | Mensagens de erro bonitinhas: InfeasibleDiagnostico automatico na UI (nao so pra IA) | Feature | Y | - | G |
| B9 | Rodar diagnosticar_infeasible AUTOMATICAMENTE quando solver falha (hoje so IA chama) | Feature | G | B8 | M |

### DOMINIO C: UI/UX (Componente unificado + Painel)

**Objetivo:** Um layout, um componente, uma experiencia.

| ID | Task | Tipo | Viab. | Dep. | Est. |
|----|------|------|-------|------|------|
| C1 | Prototipar layout do painel unico progressivo (mockup com Marco) | Design | R | - | M |
| C2 | Preflight itens minimos NA UI (NUNCA MAIS ESQUECER) | Feature | G | - | P |
| C3 | CicloGrid unificado: 1 componente com mode view/edit/export/print | Refactor | Y | A7 | G |
| C4 | Padronizar siglas (FF/FV/DT/DF em todos os lugares) | Bug | G | - | P |
| C5 | Linha DEMANDA embaixo de COBERTURA no grid | Feature | G | - | M |
| C6 | Area de avisos separada com formato padrao + contexto_ia | Feature | Y | A3 | G |
| C7 | Diff validar/solucionar (contrato de componente + props + estados) | Feature | R | C1,A3 | G |
| C8 | Morte do SimuladorCicloGrid.tsx (substituir por CicloGrid) | Refactor | G | C3 | M |
| C9 | Morte do converterNivel1ParaEscala (context fornece formato certo) | Refactor | G | A3 | P |

---

## DEPENDENCIAS

```
DOMINIO B (logica) ──── independente, pode comecar JA
    │
    │ B1-B3 (fix DOM) → validar antes de B4-B5
    │ B4 (auto inteligente) → precisa de decisao de UX com Marco
    │ B8-B9 (mensagens) → independente dos outros
    │
DOMINIO A (context) ── fundacao, comecar JUNTO com B
    │
    │ A1-A2 (store) → A3 (derivados) → A7 (hook) → A8-A10 (migracao)
    │ A4-A6 (invalidacao) → pode paralelo com A1-A3
    │ A11-A12 (IA) → depois que store funcionar
    │
DOMINIO C (UI) ──── precisa de A3 e decisoes com Marco
    │
    │ C1 (prototipo) → PRIMEIRO, com Marco, antes de qualquer codigo
    │ C2 (preflight) → independente, pode ja
    │ C3-C8 (componente) → precisa de A7 (useAppData)
    │ C7 (diff) → precisa de C1 (prototipo) + A3 (avisos do context)
```

---

## SEQUENCIA RECOMENDADA

```
SEMANA 1:
  B1-B3 (fix folga_fixa=DOM) → CLAUDE B
  A1-A2 (AppDataStore base) → CLAUDE A
  C1 (prototipo com Marco) → CLAUDE C + MARCO
  C2 (preflight na UI) → CLAUDE C
  C4 (padronizar siglas) → CLAUDE C

SEMANA 2:
  B4 (auto inteligente) → CLAUDE B + MARCO (decisao UX)
  A3-A4-A6 (derivados + invalidacao) → CLAUDE A
  B5 (elegibilidade variavel) → CLAUDE B
  C5 (linha demanda) → CLAUDE C

SEMANA 3:
  A7-A8-A9 (useAppData + migracao) → CLAUDE A
  B8-B9 (mensagens erro) → CLAUDE B
  C3 (CicloGrid unificado) → CLAUDE C

SEMANA 4:
  A10-A11-A12 (migracoes restantes + IA) → CLAUDE A
  B6-B7 (guards solver) → CLAUDE B
  C6-C7-C8-C9 (avisos + diff + cleanup) → CLAUDE C + MARCO
```

---

## STATUS COMPARTILHADO

Cada Claude DEVE ler e atualizar `specs/STATUS.md` antes de comecar qualquer task.

```markdown
# STATUS — Painel Unico

## Atualizado: [data/hora]

## Em andamento
- [CLAUDE A] A1: criando AppDataStore...
- [CLAUDE B] B1: fix folga_fixa=DOM no solver...
- [CLAUDE C] C2: preflight na UI...

## Concluido
- (nada ainda)

## Decisoes pendentes (PRECISA DO MARCO)
- B4: autoFolgaInteligente — qual heuristica? Score por sobra? Ou greedy?
- C1: layout do painel — mockup necessario antes de codar
- C7: diff — como persiste? localStorage? React state?

## Conflitos
- (nenhum)

## Dominio do outro (se o Marco perguntar algo que nao e seu)
- CLAUDE A: context, stores, invalidacao, migracao hooks, IA tools
- CLAUDE B: logica ciclo, solver guards, TS inteligente, mensagens erro
- CLAUDE C: UI, componentes, layout, prototipo, siglas, export
```

---

## PRIORIDADES

```
🔴 P0 — CRITICO (bloqueia tudo):
  A1-A4 (context store + invalidacao)
  B1-B3 (fix folga_fixa=DOM)
  C1 (prototipo com Marco)
  C2 (preflight na UI)

🟡 P1 — IMPORTANTE (melhora muito):
  A7-A9 (migracao hooks)
  B4-B5 (auto inteligente + elegibilidade)
  B8-B9 (mensagens erro)
  C3-C5 (grid unificado + demanda)
  C6 (area avisos)

🟢 P2 — NICE TO HAVE:
  A11-A12 (IA snapshot + eliminar tools)
  C7 (diff validar/solucionar)
  C8-C9 (cleanup)
```
