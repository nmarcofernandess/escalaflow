# STATUS — Painel Unico de Escala

> Atualizado: 2026-03-15 01:00
> Warlog: `specs/WARLOG_PAINEL_UNICO.md`
> Spec base: `docs/ANALYST_PAINEL_UNICO_ESCALA.md`

---

## REGRA

```
🔴 LEIA ESTE ARQUIVO ANTES DE QUALQUER ACAO.
   ATUALIZE APOS CADA TASK CONCLUIDA.
   SE O MARCO PERGUNTAR ALGO QUE NAO E SEU DOMINIO,
   DIGA QUAL DOMINIO E E APONTE PRO CLAUDE CORRETO.
```

---

## Em andamento
(nada — A11/A12 sao P2, podem esperar)

## Concluido
- [CLAUDE A] A1: AppDataStore globais ✅
- [CLAUDE A] A2: AppDataStore por setor (8 entidades, race guard, aliases) ✅
- [CLAUDE A] A3: Derivados automaticos (N, K, kMaxSemTT, cicloSemanas, demandaPorDia, avisos) ✅
- [CLAUDE A] A4: IPC `data:invalidated` em tipc.ts — 46 handlers com broadcast ✅
- [CLAUDE A] A5: IPC invalidacao em tools.ts — 21 tools com broadcast ✅
- [CLAUDE A] A6: Listener global em App.tsx — recebe e invalida store ✅
- [CLAUDE A] A7: `useAppData()` hook seletor tipado ✅
- [CLAUDE A] A8: SetorDetalhe migrado — 10 useApiData → store, 17 reloads removidos ✅
- [CLAUDE A] A9: EscalaPagina migrada — 9 useApiData → store ✅
- [CLAUDE A] A10: ColaboradorLista parcial (2/4 hooks migrados). Dashboard e EscalasHub sem useApiData do store ✅
- [CLAUDE B] B1: Fix folga_fixa=DOM no solver — 4 guards (XOR, ciclo hard, ciclo soft, dom_max) ✅
- [CLAUDE B] B2: Fix folga_fixa=DOM na bridge — zero ciclo, null variavel ✅
- [CLAUDE B] B3: Fix folga_fixa=DOM no TS — folga_fixa_dom flag + 4 unit tests ✅
- [CLAUDE B] B4: autoFolgaInteligente — demanda_por_dia no TS, folgas nos dias com mais sobra + folgaCount spreading ✅
- [CLAUDE B] B5: CANCELADA — postos fixos, cobertura por substituicao (decisao Marco) ✅
- [CLAUDE B] B6: Guard funcao_id=null — filtrado na bridge, sem posto = sem escala ✅
- [CLAUDE B] B7: Guard tipo_trabalhador — derivado do contrato na bridge com NFD normalization ✅
- [CLAUDE B] B8+B9: Toast INFEASIBLE com "Analisar com IA" — abre chat pra diagnostico ✅
- [CLAUDE C] C1: Prototipo CicloGrid unificado APROVADO pelo Marco ✅
  - View unica (morte do toggle Tabela/Resumo e botoes S1/S2)
  - Nome+Posto empilhados, Var/Fixo sticky, scroll horizontal
  - Header S1/S2/S3 sem fundo + dias com fundo
  - COBERTURA/DEMANDA como X/Y (1 linha so)
  - Sugestao via Sheet bottom (drawer de baixo)
  - Pos-solver = quadradinhos (horarios so em Ver Completo)
  - Prototipo: `specs/prototipos/ciclo-grid-final.html`

## Decisoes pendentes (PRECISA DO MARCO)
- C7: Diff validar/solucionar — contrato de componente (UX do Sheet bottom ja aprovada)

## Conectores prontos (CLAUDE C pode ligar)

### Avisos de operacao (preflight + solver) → area de avisos na UI
- **State:** `avisosOperacao: AvisoEscala[]` em SetorDetalhe.tsx (useState, ja populado)
- **Populado por:** preflight blockers (cada blocker vira AvisoEscala com origem='operacao') + solver INFEASIBLE (erro + sugestoes)
- **Interface:** `AvisoEscala` em `appDataStore.ts` — campo `origem?: 'setor' | 'operacao' | 'escala'`
- **O que falta (CLAUDE C):**
  - Renderizar `avisosOperacao` na area de avisos do SetorDetalhe (separado dos avisos por pessoa)
  - Renderizar na EscalaPagina (ver todos) como section separada
  - Avisos de setor (`derivados.avisos`) ja tem `origem='setor'` (default)
  - Avisos de operacao tem `origem='operacao'`
  - Avisos de escala (validador) podem ter `origem='escala'` no futuro

## Conflitos entre dominios
(nenhum)

## Mapa de dominios (quem faz o que)

| Dominio | Claude | Responsabilidade | Tasks |
|---------|--------|------------------|-------|
| A — Infraestrutura | CLAUDE A | Context store, invalidacao, migracao hooks, IA snapshot | A1-A12 |
| B — Logica ciclo | CLAUDE B | Fix DOM, auto inteligente, elegibilidade, solver guards, mensagens erro | B1-B9 |
| C — UI/UX | CLAUDE C | Prototipo, preflight UI, CicloGrid, siglas, avisos, diff | C1-C9 |

## Resumo de TODAS as 30 tasks (pra qualquer Claude saber do todo)

### Dominio A (Context)
- A1: AppDataStore globais (empresa, tipos, feriados, regras)
- A2: AppDataStore por setor (colabs, postos, demandas, regras, excecoes, escalas)
- A3: Derivados automaticos (N, K, ciclo, cobertura, avisos)
- A4: IPC `data:invalidated` no tipc.ts
- A5: IPC invalidacao nas tools.ts da IA
- A6: Listener global App.tsx
- A7: useAppData() hook
- A8: Migrar SetorDetalhe → useAppData
- A9: Migrar EscalaPagina → useAppData
- A10: Migrar Dashboard/EscalasHub/ColaboradorLista
- A11: Snapshot store → IaContexto
- A12: Eliminar tools redundantes da IA

### Dominio B (Logica)
- B1: Fix folga_fixa=DOM no solver (pular XOR/ciclo/dom_max)
- B2: Fix folga_fixa=DOM na bridge (zerar ciclo, nullar variavel)
- B3: Fix folga_fixa=DOM no TS (caso especial gerarCicloFase1)
- B4: autoFolgaInteligente (distribuir por demanda, nao p%6)
- B5: Elegibilidade domingo variavel por semana (mapa excecoes/feriados)
- B6: Guard solver: funcao_id=null nao entra
- B7: Guard: tipo_trabalhador derivado do contrato
- B8: InfeasibleDiagnostico automatico na UI
- B9: diagnosticar_infeasible automatico (nao so IA)

### Dominio C (UI)
- C1: Prototipar painel unico com Marco
- C2: Preflight itens minimos na UI (NUNCA ESQUECER)
- C3: CicloGrid unificado (view/edit/export/print)
- C4: Padronizar siglas (FF/FV/DT/DF)
- C5: Linha DEMANDA embaixo COBERTURA
- C6: Area de avisos com contexto_ia
- C7: Diff validar/solucionar
- C8: Matar SimuladorCicloGrid.tsx
- C9: Matar converterNivel1ParaEscala
