# STATUS — Painel Unico de Escala

> Atualizado: 2026-03-14 17:30
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
(nada — aguardando lancamento dos 3 Claudes)

## Concluido
(nada)

## Decisoes pendentes (PRECISA DO MARCO)
- C1: Layout do painel unico — prototipo necessario ANTES de codar
- B4: autoFolgaInteligente — qual heuristica usar
- C7: Diff validar/solucionar — contrato de componente

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
