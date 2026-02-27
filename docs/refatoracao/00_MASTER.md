# REFATORACAO ESCALAFLOW — MASTER

> Documento-indice da refatoracao completa do EscalaFlow.
> Cada sprint e um chat/sessao separado. Plano debatido ANTES de implementar.
> Referencia diagnostica: `RAIO_X_SISTEMA.md` (mesmo diretorio).

---

## VISAO

O EscalaFlow gera escalas de trabalho automaticas para o Supermercado Fernandes — operado pelos **pais do Marco**, que NAO sao tecnicos. O sistema funciona, mas acumulou bugs no motor, codigo morto, e UX que assusta leigo.

**Objetivo da refatoracao:** Fazer o app que os pais do Marco CONFIAM e USAM sozinhos.

1. Motor que produz dados **corretos** (nao mascarados)
2. Backend **limpo** (sem duplicatas, sem armadilhas)
3. UX que **leigo entende** (3 cliques: setor → gerar → exportar)

**O que NAO e:**
- Rewrite do zero — aproveitamos tudo que funciona
- Adicionar features — so corrigir e simplificar
- SaaS / multitenancy — continua offline, desktop, single-user

---

## CRITERIOS DE PRIORIZACAO

1. **Dados errados > UX feia** — Bug que produz escala invalida vem antes de melhorar visual
2. **Desbloqueia > Melhora** — Fix que desbloqueia outros fixes vem primeiro
3. **Leigo-impactante > Dev-only** — O que os pais do Marco sofrem tem prioridade
4. **Simples primeiro** — Quick wins geram momentum

---

## PROGRESSO DOS SPRINTS

| Sprint | Objetivo | Status | Doc | Data |
|--------|----------|--------|-----|------|
| **1** | Motor Confiavel — bugs criticos que produzem dados errados | ✅ CONCLUIDO | [sprint-1.md](sprint-1.md) | 2026-02-26 |
| **2** | Bugs Secundarios + Limpeza de Codigo Morto (11 itens) | ✅ CONCLUIDO | [sprint-2.md](sprint-2.md) | 2026-02-26 |
| **3** | H7 (Intervalo 15min) + Dashboard Real (7 itens) | ✅ CONCLUIDO | [sprint-3.md](sprint-3.md) | 2026-02-26 |
| **4** | UX Simplificada — A Refatoracao Visual (5 fases, 20 itens do Hall) | ✅ CONCLUIDO | [sprint-4.md](sprint-4.md) | 2026-02-27 |
| **RM** | RESOLVE-MERDAS + Regressao critica S2 (`cadastrar_lote`) | ✅ CONCLUIDO | [SPRINT-RESOLVE-MERDAS.md](SPRINT-RESOLVE-MERDAS.md) | 2026-02-27 |

---

## MAPA DE DEPENDENCIAS

```
SPRINT 1 (Motor Confiavel) ✅ CONCLUIDO
  └── desbloqueia SPRINT 2 (motor tem que funcionar pra validar fixes)
  └── desbloqueia SPRINT 3 (H7 precisa de per-day closing do Sprint 1)
  └── desbloqueia SPRINT 4 (UX so faz sentido com dados corretos)

SPRINT 2 (Bugs + Limpeza) ✅ CONCLUIDO
  └── independente de Sprint 3 e 4 (pode rodar em paralelo se quiser)

SPRINT 3 (H7 + Dashboard)
  └── depende de Sprint 1 ✅ (per-day closing + validacao real — pronto)
  └── independente de Sprint 4

SPRINT 4 (UX)
  └── depende de Sprint 1 ✅ (violacoes reais pro banner — pronto)
  └── melhor apos Sprint 3 (dashboard funcional)

SPRINT RESOLVE-MERDAS ✅ CONCLUIDO
  └── fecha gaps pos-Sprint 4 (UX de contrato/setor/equipe)
  └── reforca regressao critica do Sprint 2 (lote atomico)
```

---

## CONTAGEM DE BUGS (atualizada)

**Total diagnosticado:** 9 bugs + 24 problemas UX + 10 problemas backend + 5 codigo morto

**Corrigidos no Sprint 1 (4 bugs + 3 backend):**
- ✅ BUG 1: Almoco em domingos apos fechamento (motor per-day closing)
- ✅ BUG 2: AP1 threshold quebrado com grid 15min
- ✅ BUG 8: Bridge timeout 61 minutos → 5min
- ✅ BUG 9: `escalasGerar` e `escalasAjustar` retornavam `violacoes: []` hardcoded
- ✅ INSERT duplicado em escalasGerar eliminado
- ✅ Timeout bridge corrigido

**Corrigidos no Sprint 2 (11 itens):**
- ✅ BUG 5: Ciclo rotativo agora valida via `validarEscalaV3()`
- ✅ BUG 6: `cadastrar_lote` com `transaction()` atomica (reforcado no RM com fail-fast + rollback total)
- ✅ BUG 7: `safeJsonParse` helper (4 locais protegidos)
- ✅ BUG 3: Badges F/V — cast `as number` removido + legend F/V no grid
- ✅ BUG 4: Rascunho `as any` removido
- ✅ Dead code: store.ts deletado, h3_rodizio + h19_folga_comp removidos (constraints.py)
- ✅ Helpers centralizados em `date-utils.ts`, guard NODE_ENV, warm-start filtro, historico 320→800, persistirAjusteResult()

**Hotfix pos-Sprint 2 (2026-02-26):**
- ✅ Removido toggle click-to-FOLGA no grid (escala gerada e sagrada, nao editavel)
- ✅ Grid agora `readOnly` — EscalaGrid e TimelineGrid so visualizam
- ✅ Overlay de loading: `absolute inset-0` → `fixed inset-0 z-50` (visivel no viewport, nao enterrado no conteudo)

**Corrigidos no Sprint 3 (7 itens):**
- ✅ H7 intervalo 15min: post-processing Python posiciona break + calcula hora_real (4 campos novos em alocacoes)
- ✅ Migration v19: hora_intervalo_inicio/fim + hora_real_inicio/fim
- ✅ Types: Alocacao + SolverOutputAlocacao + SetorResumo.escala_desatualizada
- ✅ Persist: persistirSolverResult + persistirAjusteResult (17 campos)
- ✅ Dashboard: violacoes_pendentes REAL (lê escalas.violacoes_hard, nao mais hardcoded 0)
- ✅ Dashboard: badge "Desatualizada" (timestamp comparison colabs/demandas vs escala.criada_em)
- ✅ Dashboard: alertas VIOLACAO_HARD (vermelho) + ESCALA_DESATUALIZADA (amber)
- ✅ Export: hora_real no resumo macro + marcacao "Pausa HH:MM-HH:MM" (roxo)

**Corrigidos no Sprint RESOLVE-MERDAS (2026-02-27):**
- ✅ ColaboradorDetalhe: ocultar `horas_semanais` + `tipo_trabalhador` e derivar por contrato
- ✅ SetorDetalhe: dropdown `regime_escala` (setor como fonte de verdade)
- ✅ Sidebar: "Tipos de Contrato" restaurado no menu
- ✅ Tipos de Contrato: lock visual + bloqueio de delete para contratos de sistema
- ✅ SetorDetalhe: card unico "Equipe" (postos + colaboradores)
- ✅ Timeout operacional: remover override local de 30s; usar default backend 90s
- ✅ Regressao S2: `cadastrar_lote` agora atomico tudo-ou-nada (sem sucesso parcial)

**Ajustes finais de UX (2026-02-27) — Ciclo Primeiro, Detalhes por Descoberta:**
- ✅ SetorDetalhe: card "Escala" priorizado visualmente no topo do fluxo operacional
- ✅ Preflight: warnings nao interrompem nem poluem o fluxo principal (somente blockers param)
- ✅ EscalaResultBanner: CTA principal "Exportar Ciclo"; CTA secundario "Detalhes"
- ✅ Exportacao HTML: `modo='ciclo'` como default operacional e `modo='detalhado'` no contexto avancado
- ✅ EscalaPagina: camada base enxuta + bloco "Dados extras" colapsavel (grid/timeline/resumo tecnico)
- ✅ Sidebar: item "Escalas" removido do menu principal; Hub mantido via Configuracoes > Avancado
- ✅ Dashboard: CTA prioriza abrir setor operacional; detalhes da escala ficam secundarios

**Ajustes finais de UX (2026-02-27) — Postos v2 (DnD + Autocomplete + Reserva Operacional):**
- ✅ Semantica travada: posto = 1 titular; cobertura fica na "Reserva operacional"
- ✅ Novo IPC atomico: `colaboradores.atribuirPosto` (swap/remocao em transacao unica)
- ✅ Novo IPC atomico: `colaboradores.restaurarPostos` (undo de snapshot completo)
- ✅ SetorDetalhe: swap imediato sem modal + toast com acao "Desfazer"
- ✅ SetorDetalhe: coluna "Colaborador alocado" com acoes por linha (Editar por busca e Remover titular)
- ✅ Busca por nome mostra todos ativos do setor com contexto (posto atual, contrato, status)

**Pendencias criticas:**
- Nenhuma pendencia critica aberta nos itens do plano de resgate.

---

## DOCUMENTOS NESTA PASTA

| Arquivo | Proposito |
|---------|-----------|
| `00_MASTER.md` | **ESTE** — indice, visao, progresso |
| `RAIO_X_SISTEMA.md` | Diagnostico completo do sistema (141 arquivos, 22+ tabelas, 33 tools, 120 handlers) |
| `sprint-1.md` | Sprint 1: Motor Confiavel — plano, execucao, resultado, testes |
| `sprint-2.md` | Sprint 2: Bugs Secundarios + Limpeza — executado |
| `sprint-3.md` | Sprint 3: H7 + Dashboard — executado |
| `sprint-4.md` | Sprint 4: UX Simplificada — executado |
| `SPRINT-RESOLVE-MERDAS.md` | Fechamento pos-Sprint 4 + regressao critica do lote atomico |

---

## COMO USAR (para outras sessoes/IAs)

1. Comece lendo `00_MASTER.md` (este arquivo) pra entender o estado geral
2. Se precisa de contexto profundo do sistema → `RAIO_X_SISTEMA.md`
3. Se precisa saber o que ja foi feito → `sprint-N.md` correspondente
4. Antes de implementar um sprint, **debater o plano** com o Marco no chat
5. Cada sprint deve terminar com `npm run typecheck` 0 erros

---

*Ultima atualizacao: 2026-02-27 — Sprint 1, 2, 3, 4, RESOLVE-MERDAS e ajustes finais de UX (ciclo primeiro).*
