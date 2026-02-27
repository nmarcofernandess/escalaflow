# SPRINT RESOLVE-MERDAS

> **Data:** 2026-02-27
> **Contexto:** Pos-Sprint 4. O sistema gera escalas, mas a UX tem buracos que fazem o usuario leigo pensar que o app e quebrado.
> **Ref:** `RAIO_X_SISTEMA.md` (diagnostico), `sprint-4.md` (o que ja foi feito)

---

## TL;DR EXECUTIVO

5 problemas concretos + 1 regressao critica (lote atomico). Inclui frontend, backend e migration de banco pequena (`setores.regime_escala`, `tipos_contrato.protegido_sistema`). Objetivo: o RH abre o app e **nao fica confuso com campos que nao precisavam estar ali, paginas que sumiram, e um solver que nao gera por falta de tempo**.

---

## PROBLEMA 1: ColaboradorDetalhe — Campos Redundantes

### O que ta errado

Screenshot do card "Dados do Colaborador" mostra 6 campos. Tres sao **redundantes** quando o contrato e selecionado:

| Campo | Valor | Necessario? | Veredito |
|-------|-------|-------------|----------|
| Nome | Alex | SIM | Fica |
| Sexo | Masculino | SIM | Fica |
| Setor | Acougue | SIM | Fica |
| Funcao/Posto | AC1 | SIM | Fica |
| **Tipo de Contrato** | CLT 44h | **SIM** | Fica — e a fonte de verdade |
| **Horas Semanais** | 44 | **NAO** | CLT 44h = 44. O nome JA DIZ. |
| **Tipo de Trabalhador** | CLT | **NAO** | CLT 44h = CLT. O contrato JA DIZ. |

O info box no final ja diz: "Template: **CLT 44h** | 5 dias/semana | Max 585min/dia". Entao porque o usuario precisa ver/editar `horas_semanais` e `tipo_trabalhador` separado?

### Como deveria ser

```
┌─ CARD: Dados do Colaborador ──────────────────────────────┐
│                                                            │
│  Nome    [________________]        Sexo    [M ▼]          │
│  Setor   [Acougue ▼      ]        Funcao  [AC1 ▼]        │
│  Contrato [CLT 44h ▼     ]                                │
│                                                            │
│  ℹ️ CLT 44h — 44h/sem, 5x2, max 9h45/dia                  │
│                                                            │
│  ── Preferencias ──────────────────────────────────────    │
│  Turno pref.  [Nenhum ▼]       Evitar dia  [Nenhum ▼]    │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

### Regras

- **Horas Semanais**: ESCONDER. Valor vem do contrato. So aparece se `horas_semanais != tipo_contrato.horas_semanais` (override por pessoa — caso raro, IA resolve).
- **Tipo de Trabalhador**: ESCONDER. Valor vem do contrato. `CLT 44h` = CLT, `Estagiario` = ESTAGIARIO. Mapeamento implicito.
- **Info box**: Manter e expandir — mostrar regime (5X2/6X1), horas, max diario. E o resumo human-readable do contrato.

### Arquivo

| Arquivo | Acao |
|---------|------|
| `src/renderer/src/paginas/ColaboradorDetalhe.tsx` | EDITAR — remover FormField de `horas_semanais` e `tipo_trabalhador` do card unificado. Manter no form schema (enviar ao backend normalmente, so nao mostrar ao leigo). Info box ja existe — enriquecer. |

### Risco

BAIXO. Campos continuam no banco e no form (hidden). So muda visibilidade na UI. Se precisar override por pessoa, a IA faz via chat.

---

## PROBLEMA 2: SetorDetalhe — Falta Dropdown de Regime (5X2 / 6X1)

### O que ta errado

O RAIO_X diz que regime_escala existia em 3 lugares (EscalaPagina, ContratoLista, SolverConfigDrawer). Removemos da EscalaPagina. Mas **nao colocamos em lugar nenhum acessivel**.

No SetorDetalhe (screenshot) so tem: Nome, Hora Abertura, Hora Fechamento. Nao tem como o RH definir se o setor opera em 5X2 ou 6X1.

Hoje o regime vem do **tipo_contrato** (campo `regime_escala`). Mas:
- Todos os contratos seed sao `5X2`
- Se o RH quiser `6X1` pra um setor, nao tem como configurar pela UI

### Como deveria ser

Adicionar dropdown **"Regime Padrao"** no card de info do setor:

```
┌─ Informacoes do Setor ────────────────────────────────────┐
│                                                            │
│  Nome    [Acougue        ]                                 │
│  Hora Abertura [07:00]        Hora Fechamento [19:30]     │
│  Regime Padrao [5X2 ▼]  ← NOVO                            │
│                                                            │
│  ℹ️ Regime define folgas: 5X2 = 2 folgas/sem,             │
│     6X1 = 1 folga/sem (gera mais horas extras)            │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

### Regras

- **Regime e do SETOR, nao do colaborador** (RAIO_X Hall #1: "Deveria ser config do SETOR, ponto.")
- Opcoes: `5X2` (padrao) | `6X1`
- Persistir em `setores.regime_escala` (campo novo, DEFAULT '5X2')
- Bridge: se setor tem `regime_escala`, usar como override pra todos os colabs do setor (ao inves de puxar do contrato)
- **Migration**: `ALTER TABLE setores ADD COLUMN regime_escala TEXT NOT NULL DEFAULT '5X2'`

### Arquivos

| Arquivo | Acao |
|---------|------|
| `src/main/db/schema.ts` | EDITAR — migration nova: ADD COLUMN regime_escala |
| `src/shared/types.ts` | EDITAR — Setor type: +regime_escala |
| `src/renderer/src/paginas/SetorDetalhe.tsx` | EDITAR — +Select dropdown regime |
| `src/main/motor/solver-bridge.ts` | EDITAR — usar setor.regime_escala como override |
| `src/main/tipc.ts` | EDITAR — retornar regime_escala nos handlers de setor |

### Risco

MEDIO. Toca o solver bridge — precisa teste end-to-end apos mudar.

---

## PROBLEMA 3: Pagina de Contratos Sumiu da Navegacao

### O que ta errado

Sprint 4 removeu "Tipos de Contrato" da sidebar e colocou num link dentro de Configuracoes > Avancado (Collapsible fechado por default). Marco diz: **"nao pedi para deletar, pedi para deixar no sistema"**.

A pagina EXISTE (rota `/tipos-contrato` funciona). Mas ta escondida num Collapsible que ninguem vai abrir.

### Como deveria ser

**Voltar o item na sidebar.** O RAIO_X flaggou o perigo de leigos quebrarem contratos (Hall #19), mas a solucao e **lock visual**, nao esconder.

Opcao recomendada: Manter na sidebar dentro do grupo Configuracao, junto com Feriados. Adicionar um badge/icon de cadeado nos itens sensíveis.

```
Sidebar — Configuracao:
├── Feriados
└── Tipos de Contrato   ← VOLTAR
```

Regras e Memoria ficam no Avancado (ConfiguracoesPagina). Contratos sao **operacionais** — o RH precisa consultar.

**Regra final implementada:** contratos de sistema aparecem com cadeado e **nao podem ser deletados**. Criar/editar continua permitido.

### Arquivo

| Arquivo | Acao |
|---------|------|
| `src/renderer/src/componentes/AppSidebar.tsx` | EDITAR — adicionar "Tipos de Contrato" de volta no configNav |

### Risco

ZERO. So adicionar um item no array.

---

## PROBLEMA 4: Postos e Colaboradores Separados no SetorDetalhe

### O que ta errado

Screenshot mostra 2 cards separados: "Postos" (AC1-AC5 com badges Ocupado) e "Colaboradores" (tabela com dropdown de posto por pessoa). Sao informacoes **do mesmo contexto** — quem trabalha onde.

Pra um leigo, ver dois cards separados e confuso. "Postos" sozinho nao diz nada. "Colaboradores" ja mostra o posto de cada um.

### Como deveria ser

**Fundir num card unico "Equipe":**

```
┌─ Equipe ──────────────────────────────── 5/5 postos preenchidos ┐
│                                                                   │
│  #  Nome        Contrato   Posto    Sexo    Status               │
│  ─────────────────────────────────────────────────────────       │
│  1  Robert      CLT 44h    [AC5 ▼]  Masc    Ativo      →       │
│  2  Jessica     CLT 44h    [AC4 ▼]  Fem     Ativo      →       │
│  3  Jose Luiz   CLT 44h    [AC3 ▼]  Masc    Ativo      →       │
│  4  Mateus      CLT 44h    [AC2 ▼]  Masc    Ativo      →       │
│  5  Alex        CLT 44h    [AC1 ▼]  Masc    Ativo      →       │
│                                                                   │
│  [+ Novo Posto]  [Gerenciar]                                     │
└───────────────────────────────────────────────────────────────────┘
```

- Badge "5/5 preenchidos" no header (ja existe no card Postos)
- Botao "+ Novo Posto" migra do card Postos
- Card Postos separado **some**
- Colaboradores ganham inline assignment de posto (ja funciona)

### Arquivos

| Arquivo | Acao |
|---------|------|
| `src/renderer/src/paginas/SetorDetalhe.tsx` | EDITAR — fundir cards Postos + Colaboradores em card "Equipe" unico |

### Risco

BAIXO. JSX restructure. Sem mudanca de logica.

---

## PROBLEMA 5: Solver Timeout Default Muito Baixo

### O que ta errado

Solver default era 30 segundos. Cenarios apertados (Acougue: 5 CLT 44h cobrindo 228h/semana, ratio 0.96) precisam de ~60s+ pra encontrar solucao. Com 30s dividido em 3 passes (15/10/10), INFEASIBLE.

### O que ja foi feito

**FIX APLICADO:** `solver-bridge.ts` — default de `30` → `90` segundos. Divide em 45/27/18 nos 3 passes. Testado via CLI: Acougue gera FEASIBLE em ~62s com 88.5% cobertura.

### Status

- [x] Fix aplicado
- [x] Testar via app

---

## STATUS FINAL DE IMPLEMENTACAO (2026-02-27)

- [x] P1 — Campos redundantes removidos da UI de ColaboradorDetalhe; valores derivados por contrato no submit
- [x] P2 — Regime no setor com migration + UI + bridge (setor manda)
- [x] P3 — Tipos de Contrato voltou na sidebar com lock visual de contrato de sistema
- [x] P4 — SetorDetalhe com card unico "Equipe"
- [x] P5 — Timeout local 30s removido; fluxo operacional usa default backend (90s)
- [x] Regressao Sprint 2 — `cadastrar_lote` atomico tudo-ou-nada (sem sucesso parcial)

---

## RESUMO DE ACOES

| # | Problema | Complexidade | Arquivos | Precisa migration? |
|---|----------|-------------|----------|-------------------|
| 1 | Campos redundantes ColaboradorDetalhe | FACIL | 1 arquivo | NAO |
| 2 | Dropdown regime 5X2/6X1 no SetorDetalhe | MEDIO | 5+ arquivos | SIM (`setores.regime_escala`) |
| 3 | Pagina Contratos sumiu + lock de sistema | MEDIO | 3+ arquivos | SIM (`tipos_contrato.protegido_sistema`) |
| 4 | Postos e Colabs separados | FACIL | 1 arquivo | NAO |
| 5 | Solver timeout | FEITO | 1 arquivo | NAO |

### Ordem Recomendada

```
3 (Contratos na sidebar)  ← 5 minutos
    ↓
1 (Campos redundantes)    ← 30 minutos
    ↓
4 (Fundir Postos+Colabs)  ← 1 hora
    ↓
2 (Regime no Setor)        ← 2 horas (migration + bridge + teste)
    ↓
5 (Solver timeout)         ← JA FEITO
```

---

## FORA DO ESCOPO (NAO TOCAR AGORA)

- Reescrever RegrasPagina (backlog)
- Mover Knowledge Layer pra outro lugar (backlog)
- Regime por colaborador individual (caso raro, IA resolve)
- Dashboard melhorias (resolvido Sprint 3)
- Export por postos no grid (backlog futuro)

---

## DISCLAIMERS CRITICOS

- **Regime no Setor (P2)** toca o solver bridge. Precisa teste end-to-end com geracao real apos implementar.
- **Campos escondidos (P1)** continuam no banco e no form. Se o usuario tiver override de horas (ex: CLT 44h mas trabalha 40h por acordo), precisa da IA pra editar. Risco aceito — caso raro.
- **Contratos na sidebar (P3)** — o RAIO_X alertou que leigos podem quebrar contratos. Considerar lock visual futuro.
