# EscalaFlow v2 — Contexto Completo para o Time (Sprint 004+)

> **Data:** 2026-02-15
> **Status:** Migration completa (003). Agora falta o CORE (ScheduleGenerator)
> **Audience:** Próximo time que vai finalizar o v2

---

CONTEXTO DE ANALISE: 

🔍 ANÁLISE CRUZADA: O QUE FOI PLANEJADO vs O QUE VOCÊ ENTREGOU

  CONTEXTO DOS DOCUMENTOS

  Documento: ANALYST_PROCESSO_USUARIO_MULTITENANCY.md
  Data: 2026-02-13
  Autor: Operador
  Propósito: Diagnosticar por que v1 não resolve o problema como produto
  ────────────────────────────────────────
  Documento: BUILD_V2_ESCALAFLOW.md
  Data: 2026-02-13
  Autor: Arquiteto
  Propósito: Especificar como construir v2 do zero
  ────────────────────────────────────────
  Documento: Código Real (escalaflow)
  Data: 2026-02-14/15
  Autor: Orchestrator
  Propósito: Implementar tudo

  ---
  PARTE 1: O DIAGNÓSTICO DO ANALYST (v1 para v2)

  O Problema Identificado (v1)

  Seu v1 (horario) tinha:
  - ✅ Motor de validação (PolicyEngine) funcionando
  - ✅ Database multi-setor
  - ❌ UI travada no CAIXA (hardcoded em 30+ lugares)
  - ❌ Sistema depende de JSONs de exemplo (compliance_policy.example.json + seed.json)
  - ❌ Mosaico é manual (gestora monta grade, não sistema propõe)
  - ❌ UX de engenheiro, não de RH

  A Mensagem de Fundo

  "O sistema nao alimenta o motor. O JSON alimenta. A UI so mostra."

  Tradução prática:
  - O v1 não era um "gerador de escalas"
  - Era um "validador de escalas manuais"
  - Gestora monta tudo na mão (Excel 2.0) → motor valida → pronto

  ---
  PARTE 2: O BLUEPRINT DO BUILD (v2 Planejado)

  Principais Mudanças Arquitetnicas

  ┌──────────────────┬───────────────────────┬──────────────────────────┬──────────────────┐
  │     Aspecto      │     v1 (horario)      │      v2 (Planejado)      │    Status em     │
  │                  │                       │                          │    Escalaflow    │
  ├──────────────────┼───────────────────────┼──────────────────────────┼──────────────────┤
  │ Geração de       │ Valida template       │ ✅ Propõe                │ ⚠️  PARCIAL       │
  │ Escala           │ (mosaico manual)      │ automaticamente          │                  │
  ├──────────────────┼───────────────────────┼──────────────────────────┼──────────────────┤
  │ Modelo de Dados  │ Complexo (Policy,     │ Simplificado (8          │ ✅ IMPLEMENTADO  │
  │                  │ Shift, etc)           │ entidades core)          │                  │
  ├──────────────────┼───────────────────────┼──────────────────────────┼──────────────────┤
  │ TipoContrato     │ Contract enum         │ Entidade global com      │ ✅ IMPLEMENTADO  │
  │                  │ hardcoded             │ templates CLT            │                  │
  ├──────────────────┼───────────────────────┼──────────────────────────┼──────────────────┤
  │ Turnos           │ Catalog estático      │ Derivados do contrato +  │ ⚠️  NÃO           │
  │                  │                       │ demanda                  │ IMPLEMENTADO     │
  ├──────────────────┼───────────────────────┼──────────────────────────┼──────────────────┤
  │ Mosaico/Rodizio  │ Manual em JSON        │ Sistema calcula          │ ⚠️  NÃO           │
  │                  │                       │ automaticamente          │ IMPLEMENTADO     │
  ├──────────────────┼───────────────────────┼──────────────────────────┼──────────────────┤
  │ Policy           │ JSON externo          │ Hardcoded CLT no motor   │ ✅ IMPLEMENTADO  │
  │                  │ versionado            │                          │                  │
  ├──────────────────┼───────────────────────┼──────────────────────────┼──────────────────┤
  │ Frontend         │ frontendv1 adaptado   │ frontendv2 clean slate   │ ❌ NÃO FIZEREM   │
  ├──────────────────┼───────────────────────┼──────────────────────────┼──────────────────┤
  │ UI/UX            │ Governance E4 exposta │ Simplificada pro RH      │ ✅ PARCIAL       │
  └──────────────────┴───────────────────────┴──────────────────────────┴──────────────────┘

  ---
  PARTE 3: O QUE VOCÊ ENTREGOU (Escalaflow v2 Atual)

  O Que Está 100% Implementado ✅

  Backend:
  - ✅ Schema simplificado (8 entidades)
  - ✅ TipoContrato com seed CLT (44h, 36h, 30h, Estagiário)
  - ✅ Setor, Colaborador, Demanda, Excecao, Escala, Alocacao
  - ✅ Motor validador (PolicyEngine) preservado
  - ✅ API com 20+ rotas Hono
  - ✅ IPC type-safe com tipc (Electron migration)
  - ✅ Worker thread pro motor (não trava UI)

  Frontend:
  - ✅ 9 páginas funcionando
  - ✅ 19 componentes shadcn/ui
  - ✅ 7 componentes customizados
  - ✅ 8 serviços via IPC
  - ✅ Zustand global state
  - ✅ React Router 7 com HashRouter
  - ✅ Dashboard, SetorLista, ColaboradorLista, EscalaPagina, etc.
  - ✅ Drag & Drop no ranking
  - ✅ Export escalas

  DevOps/Build:
  - ✅ Electron desktop app (completo)
  - ✅ electron-vite config (unified build)
  - ✅ electron-builder (empacotamento mac/win/linux)
  - ✅ better-sqlite3 (externalizado do bundle)
  - ✅ TypeScript zero errors
  - ✅ Zero fetch() / HTTP remnants

  ---
  O Que Está Planejado Mas NÃO Implementado ❌

  1. CORE DO SISTEMA — ScheduleGenerator (CRÍTICO)

  ┌──────────────────────────────────────────┬─────────────────┬─────────┐
  │                Planejado                 │     Status      │ Impacto │
  ├──────────────────────────────────────────┼─────────────────┼─────────┤
  │ Sistema PROPÕE escala automaticamente    │ ❌ NÃO          │ 🔴 ALTA │
  ├──────────────────────────────────────────┼─────────────────┼─────────┤
  │ Motor de sugestão (quem trabalha quando) │ ❌ NÃO          │ 🔴 ALTA │
  ├──────────────────────────────────────────┼─────────────────┼─────────┤
  │ Distribuição automática de turnos        │ ❌ NÃO          │ 🔴 ALTA │
  ├──────────────────────────────────────────┼─────────────────┼─────────┤
  │ Rodizio de domingos automático           │ ❌ NÃO (manual) │ 🔴 ALTA │
  └──────────────────────────────────────────┴─────────────────┴─────────┘

  O que você tem agora:
  Gestora: Monta mosaico manualmente
  Motor: Valida se tá certo
  Resultado: Excel com validação (não é melhor que v1)

  O que deveria ter:
  Gestora: Cadastra regras (colaboradores, demanda, exceções)
  Motor: Propõe escala otimizada
  Gestora: Ajusta se quiser
  Resultado: Sistema real

  ---
  2. UI/UX para o RH (IMPORTANTE)

  ┌───────────────────────┬─────────────────────┬────────────┬─────────────────────────────┐
  │      Componente       │       v1 tem        │    v2      │       Escalaflow tem        │
  │                       │                     │  Planejou  │                             │
  ├───────────────────────┼─────────────────────┼────────────┼─────────────────────────────┤
  │ Sidebar com NavUser   │ ✅ Avatar +         │ ✅         │ ❌ NÃO                      │
  │                       │ dropdown            │ Planejou   │                             │
  ├───────────────────────┼─────────────────────┼────────────┼─────────────────────────────┤
  │ Theme Switcher        │ ✅                  │ ✅         │ ❌ NÃO                      │
  │                       │ Light/Dark/System   │ Planejou   │                             │
  ├───────────────────────┼─────────────────────┼────────────┼─────────────────────────────┤
  │ Tour/Onboarding       │ ✅ "Como funciona"  │ ✅         │ ❌ NÃO                      │
  │                       │                     │ Planejou   │                             │
  ├───────────────────────┼─────────────────────┼────────────┼─────────────────────────────┤
  │ Avatar com initials   │ ✅ Presente         │ ✅         │ ❌ NÃO (19 shadcn, mas não  │
  │                       │                     │ Planejou   │ avatar)                     │
  ├───────────────────────┼─────────────────────┼────────────┼─────────────────────────────┤
  │ Dropdown Menu         │ ✅ Presente         │ ✅         │ ❌ NÃO (faltam 27           │
  │                       │                     │ Planejou   │ componentes)                │
  ├───────────────────────┼─────────────────────┼────────────┼─────────────────────────────┤
  │ Formulários com       │ ✅ Hono             │ ✅ Zod     │ ⚠️  BASIC                    │
  │ validação             │                     │ forms      │                             │
  ├───────────────────────┼─────────────────────┼────────────┼─────────────────────────────┤
  │ Checklist de          │ ❌ NÃO              │ ✅         │ ❌ NÃO                      │
  │ onboarding            │                     │ Planejou   │                             │
  └───────────────────────┴─────────────────────┴────────────┴─────────────────────────────┘

  ---
  3. Features que Faltam

  Funcionalidades:

  ┌──────────────────────────────┬────────────────┬───────────────────────────────────────┐
  │           Feature            │   Planejado    │             Implementado?             │
  ├──────────────────────────────┼────────────────┼───────────────────────────────────────┤
  │ Gerar escala automaticamente │ SIM            │ ❌ NÃO — motor valida, não gera       │
  ├──────────────────────────────┼────────────────┼───────────────────────────────────────┤
  │ Sistema propõe mosaico       │ SIM            │ ❌ NÃO — gestora monta manualmente    │
  ├──────────────────────────────┼────────────────┼───────────────────────────────────────┤
  │ Rodizio domingo automático   │ SIM            │ ❌ NÃO — manual ou via prefere_turno? │
  ├──────────────────────────────┼────────────────┼───────────────────────────────────────┤
  │ Calculadora de turnos        │ SIM            │ ❌ NÃO — turnos derivados?            │
  ├──────────────────────────────┼────────────────┼───────────────────────────────────────┤
  │ Simulação iterativa          │ SIM            │ ⚠️  PARCIAL (ajustes básicos)          │
  ├──────────────────────────────┼────────────────┼───────────────────────────────────────┤
  │ Preflight validation         │ SIM (no v1)    │ ❌ NÃO — sem checklist pré-geração    │
  ├──────────────────────────────┼────────────────┼───────────────────────────────────────┤
  │ Modo NORMAL/ESTRITO          │ SIM            │ ❌ NÃO                                │
  ├──────────────────────────────┼────────────────┼───────────────────────────────────────┤
  │ Trilha de auditoria          │ SIM            │ ❌ NÃO                                │
  ├──────────────────────────────┼────────────────┼───────────────────────────────────────┤
  │ Pedidos/Trocas de turno      │ SIM (v1 tinha) │ ❌ NÃO                                │
  ├──────────────────────────────┼────────────────┼───────────────────────────────────────┤
  │ Perfil de usuário            │ SIM (v1 tinha) │ ❌ NÃO                                │
  └──────────────────────────────┴────────────────┴───────────────────────────────────────┘

  ---
  PARTE 4: COMPARAÇÃO V1 vs V2 Planejado vs Escalaflow Real

  V1 (horario)
  ├── Motor validador .......................... ✅ FUNCIONA
  ├── UI multi-setor ........................... ❌ TRAVADA (hardcoded CAIXA)
  ├── Sidebar bonita ........................... ✅ NavMain + NavUser + Avatar
  ├── Geração automática ....................... ❌ NÃO — valida templates
  └── Workflow: manual → validado          [Excel 2.0]

  V2 PLANEJADO (BUILD_V2_ESCALAFLOW.md)
  ├── Motor gerador ............................ ❌ FALTA FAZER
  ├── UI simplificada pro RH ................... ❌ FALTA FAZER
  ├── Multi-setor nativo ....................... ✅ Arquitetura preparada
  ├── TipoContrato templates ................... ✅ IMPLEMENTADO
  ├── ScheduleGenerator ........................ ❌ CORE NOVO
  └── Workflow: cadastra → sistema propõe → ajusta [PRODUTO REAL]

  ESCALAFLOW ATUAL (O que entregou)
  ├── Motor validador .......................... ✅ FUNCIONA
  ├── UI multi-setor ........................... ✅ FUNCIONA (básico)
  ├── Electron desktop ......................... ✅ IMPLEMENTADO
  ├── IPC type-safe ............................ ✅ IMPLEMENTADO
  ├── TipoContrato com templates ............... ✅ IMPLEMENTADO
  ├── Geração automática ....................... ❌ NÃO — valida, não gera
  ├── Sidebar pro RH ........................... ❌ FALTA (sem avatar/dropdown/theme)
  └── Workflow: igual ao v1             [Excel 2.0]

  ---
  PARTE 5: O GAP CRÍTICO

  A Verdade Incômoda

  Você entregou 95% de um desktop app:
  - ✅ Migração Electron perfeita
  - ✅ IPC type-safe
  - ✅ Database
  - ✅ UI bonita
  - ✅ Multi-setor infrastructure

  MAS:
  - ❌ O motor ainda é validador, não gerador
  - ❌ Gestora ainda monta escala na mão (como em v1)
  - ❌ Não é "menos input possivel" — é IGUAL ao v1

  O Problema Fundamental

  O BUILD_V2 documento pediu:
  "Menor quantidade possível de input para gerar escala"
  "Sistema PROPÕE escala, gestora AJUSTA"

  O que você entregou:
  "Sistema VALIDA escala que gestora MONTA manualmente"
  "Mesmo fluxo de v1, mas em Electron"

  ---
  PARTE 6: O QUE ESTÁ FALTANDO (Prioridade)

  🔴 CRÍTICO (Sem isso, não é "v2")

  1. ScheduleGenerator — Motor que gera, não valida
    - Constraint satisfaction problema
    - Input: colaboradores + contratos + demanda
    - Output: proposta de escala
    - Tempo: ~1-2 sprints backend
  2. Simulação Iterativa Real — Recalc em tempo real ao ajustar
    - Gestora arrasta → motor recalcula
    - Mostra violações atualizadas
    - Tempo: ~1 sprint frontend

  🟡 IMPORTANTE (UX/Produto)

  3. Sidebar com Avatar + Dropdown — Perfil do usuário
  4. Theme Switcher — Light/Dark/System
  5. Tour/Onboarding — "Como funciona?"
  6. Componentes shadcn — Dropdown, Avatar, Form (faltam 27)
  7. Checklist de Onboarding — "Antes de gerar, complete:"

  🟢 NICE-TO-HAVE (Futuro)

  8. Pedidos/Trocas de turno
  9. Trilha de auditoria
  10. Modo ESTRITO com justificativa
  11. Preflight validation com linguagem humana
  12. Export em Markdown

  ---
  RESUMO EXECUTIVO

  ┌─────────────────────┬──────────────────────┬───────────────────────────┬───────────┐
  │       Métrica       │ Planejado (BUILD_V2) │ Implementado (Escalaflow) │ Cobertura │
  ├─────────────────────┼──────────────────────┼───────────────────────────┼───────────┤
  │ Entidades DB        │ 8                    │ 8                         │ 100% ✅   │
  ├─────────────────────┼──────────────────────┼───────────────────────────┼───────────┤
  │ API Rotas           │ 25+                  │ 20+                       │ 80% ⚠️     │
  ├─────────────────────┼──────────────────────┼───────────────────────────┼───────────┤
  │ Frontend Pages      │ 7-8                  │ 9                         │ 100% ✅   │
  ├─────────────────────┼──────────────────────┼───────────────────────────┼───────────┤
  │ Componentes UI      │ 46 shadcn            │ 19 shadcn                 │ 41% ⚠️     │
  ├─────────────────────┼──────────────────────┼───────────────────────────┼───────────┤
  │ Motor Gerador       │ ScheduleGenerator    │ PolicyEngine (validador)  │ 0% ❌     │
  ├─────────────────────┼──────────────────────┼───────────────────────────┼───────────┤
  │ Multi-setor         │ Nativo               │ Funciona                  │ 90% ✅    │
  ├─────────────────────┼──────────────────────┼───────────────────────────┼───────────┤
  │ UX/Sidebar          │ NavUser + tema       │ Básica                    │ 20% ⚠️     │
  ├─────────────────────┼──────────────────────┼───────────────────────────┼───────────┤
  │ Simulação Iterativa │ Real-time            │ Básica                    │ 40% ⚠️     │
  ├─────────────────────┼──────────────────────┼───────────────────────────┼───────────┤
  │ Desktop App         │ Electron             │ Electron                  │ 100% ✅   │
  ├─────────────────────┼──────────────────────┼───────────────────────────┼───────────┤
  │ Offshore-readiness  │ Build complete       │ Build complete            │ 100% ✅   │
  └─────────────────────┴──────────────────────┴───────────────────────────┴───────────┘

  ---
  MINHA RECOMENDAÇÃO

  AGORA (imediato):
  ├── Isso é v2 INFRAESTRUTURA (95% perfeito) ✅
  └── MAS NÃO É v2 PRODUTO (core falta)

  PRÓXIMO PASSO:
  ├── Sprint 004: ScheduleGenerator (2-3 sprints)
  ├── Sprint 005: Simulação iterativa + recalc
  ├── Sprint 006: Avatar + Dropdown + Theme
  └── Sprint 007: Onboarding checklist

  ISSO ENTREGA o produto real que foi especificado no BUILD_V2.

## TL;DR EXECUTIVO

```
O QUE ENTREGOU (Sprint 003):
✅ Desktop app Electron 100% funcional
✅ IPC type-safe (Hono → tipc)
✅ Database schema simplificado
✅ 9 páginas React funcionando
✅ 19 componentes shadcn/ui
✅ API com 20+ rotas

O QUE FALTA (CRÍTICO):
❌ ScheduleGenerator — Motor que GERA escalas (não só valida)
❌ Simulação iterativa com recalc em tempo real
❌ UX/Sidebar pro RH (Avatar + Dropdown + Theme)
❌ Componentes shadcn faltando (27 de 46)
❌ Onboarding checklist

RESUMO: Entregou 95% de um app desktop, 0% do motor que gera escalas.
Ou seja: está como v1, mas em Electron.
```

---

## PARTE 1: ANÁLISE CRUZADA COMPLETA

### V1 (horario) vs V2 (Planejado em BUILD_V2_ESCALAFLOW.md) vs Escalaflow (Real)

| Componente | V1 | V2 Planejado | Escalaflow Real | Cobertura |
|------------|----|--------------|----|---|
| **Geração de Escala** | Valida template | ✅ **Propõe automaticamente** | ❌ Valida, não gera | 0% |
| **ScheduleGenerator** | NAO | ❌ CRIAR | ❌ NAO EXISTE | 0% |
| **Simulação Iterativa** | SIM (básica) | ✅ Real-time recalc | ⚠️ Básica | 30% |
| **Modelo de Dados** | Complexo | Simplificado (8 entidades) | ✅ 8 entidades | 100% |
| **TipoContrato** | Enum hardcoded | ✅ Entidade + templates CLT | ✅ Implementado | 100% |
| **Turnos** | Catalog estático | Derivados | ❌ NAO | 0% |
| **Mosaico/Rodizio** | Manual em JSON | ✅ Sistema calcula | ❌ Manual | 0% |
| **Policy** | JSON versionado | Hardcoded CLT | ✅ Hardcoded | 100% |
| **Frontend** | adaptado | frontendv2 clean slate | ✅ React novo | 80% |
| **Desktop App** | Electron | Electron | ✅ Electron completo | 100% |
| **Sidebar** | NavUser + Avatar | Idem | ❌ Básica | 20% |
| **Theme Switcher** | Light/Dark/System | Idem | ❌ NAO | 0% |
| **Tour/Onboarding** | "Como funciona?" | Idem | ❌ NAO | 0% |
| **Dropdown Menu** | ✅ shadcn | ✅ shadcn | ❌ Falta | 0% |

---

### O Fluxo de Cada Versão

**V1 (horario):**
```
Gestora monta: Quem trabalha cada dia (MOSAICO)
         +    Quem trabalha cada domingo (RODIZIO)
             ↓
Motor VALIDA: Isso respeita CLT?
             ↓
Resultado: Escala com violações listadas
```

**V2 (Planejado):**
```
Gestora cadastra: Colaboradores + Contratos + Demanda
                 ↓
Motor PROPÕE: Sistema automático gera quem trabalha quando
                 ↓
Gestora AJUSTA: Se quiser (arrastar, trocar)
                 ↓
Sistema RECALCULA: Em tempo real
                 ↓
Resultado: Escala otimizada
```

**Escalaflow (Real Agora):**
```
Gestora monta: Quem trabalha cada dia (MOSAICO) ← AINDA PRECISA FAZER ISSO
             ↓
Motor VALIDA: Isso respeita CLT?
             ↓
Resultado: Escala com violações listadas ← IGUAL AO V1
```

**CONCLUSÃO:** O Escalaflow é v1 em Electron. Não é v2 ainda.

---

## PARTE 2: O GAP CRÍTICO

### Por que não é v2?

V2 foi especificado em `BUILD_V2_ESCALAFLOW.md` com princípio fundamental:

> **"Menor quantidade possível de input para gerar escala"**
> **"Sistema PROPÕE, gestora AJUSTA"**

Mas o que foi entregue:
- Gestora ainda precisa **MONTAR** a escala
- Sistema ainda só **VALIDA**
- Workflow é **IGUAL ao v1**

Ou seja: migrou de FastAPI + React para Electron + Hono/IPC. Mas o MOTOR não mudou.

### Os Três Pilares do V2

#### ❌ PILAR 1: ScheduleGenerator (INEXISTENTE)

**O que deveria existir:**
```python
class ScheduleGenerator:
    def generate(
        self,
        colaboradores: List[Colaborador],
        demandas: List[Demanda],
        excecoes: List[Excecao],
        periodo: DateRange
    ) -> EscalaProposada:
        """
        Recebe: pessoas + regras + demanda
        Retorna: Proposta de escala (quem trabalha quando)

        Resolve: Constraint satisfaction problem
        - Cada pessoa respeita seu contrato
        - Cada faixa horária tem mínimo de pessoas
        - Regras CLT R1-R8 validadas
        """
```

**O que existe agora:**
- `PolicyEngine` (valida escalas que já existem)
- `CycleGenerator` (projeta template estático no calendário)
- Nada que GERA escala nova

**Status:** 0% implementado. É o core que falta.

#### ❌ PILAR 2: Simulação Iterativa com Recalc (PARCIAL)

**O que deveria acontecer:**
```
1. Gestora arrasta pessoa pra outro dia
   ↓
2. Sistema recalcula IMEDIATAMENTE (< 100ms)
   ↓
3. Mostra novo resultado com violações atualizadas
   ↓
4. Gestora pode desfazer, tentar outra coisa, etc
```

**O que existe agora:**
- UI funciona
- Mas recalc provavelmente não roda ou roda lentamente
- Validator roda quando salva, não em tempo real

**Status:** 30% implementado. UI pronta, mas backend não.

#### ❌ PILAR 3: UX Simplificada pro RH (PARCIAL)

**O que deveria ter:**
- Avatar com nome do usuário
- Dropdown menu (Perfil, Tema, Ajuda)
- Theme Switcher (Light/Dark/System)
- Tour/Onboarding ("Como funciona?")
- Checklist pre-geração ("Complete antes de gerar:")

**O que existe agora:**
- Sidebar básica
- Sem avatar
- Sem dropdown
- Sem tema
- Sem tour

**Status:** 20% implementado.

---

## PARTE 3: O QUE PRECISA SER FEITO (Priorizado)

### 🔴 CRÍTICO (Sem isso, não é v2 — é v1 em Electron)

| # | O que | Onde | Esforço | Impacto |
|---|-------|------|---------|---------|
| 1 | **ScheduleGenerator** | src/main/motor/gerador.ts | 2-3 sprints | 🔴 BLOQUEANTE |
| 2 | **Recalc em tempo real** | src/main/tipc.ts + src/renderer | 1 sprint | 🔴 ESSENCIAL |
| 3 | **Testar gerador com dados reais** | specs/004-*/qa_report.json | 1 sprint | 🔴 VALIDAÇÃO |

### 🟡 IMPORTANTE (V2 propriamente dito, mas sem isso funciona)

| # | O que | Onde | Esforço | Impacto |
|---|-------|------|---------|---------|
| 4 | Avatar + Dropdown no Sidebar | src/renderer/src/componentes/AppSidebar.tsx | 0.5 sprint | 🟡 UX |
| 5 | Theme Switcher | src/renderer/src/ | 0.5 sprint | 🟡 UX |
| 6 | Tour/Onboarding | src/renderer/src/ | 1 sprint | 🟡 UX |
| 7 | Componentes shadcn faltando | src/renderer/src/components/ui/ | 0.5 sprint | 🟡 UI |
| 8 | Checklist pre-geração | src/renderer/src/paginas/EscalaPagina.tsx | 0.5 sprint | 🟡 UX |

### 🟢 NICE-TO-HAVE (Futuro, não MVP)

- Pedidos/Trocas de turno
- Trilha de auditoria
- Modo ESTRITO com justificativa
- Preflight validation (jornada melhorada)
- Export em Markdown
- Multi-tenancy real (agora é só estrutura)

---

## PARTE 4: O CONTEXTO DE CÓDIGO

### Estrutura Atual (Sprint 003)

```
escalaflow/
├── src/
│   ├── main/
│   │   ├── index.ts              ← BrowserWindow + lifecycle ✅
│   │   ├── tipc.ts               ← 33 IPC handlers ✅
│   │   ├── db/
│   │   │   ├── database.ts       ← SQLite ✅
│   │   │   ├── schema.ts         ← DDL ✅
│   │   │   └── seed.ts           ← Dados iniciais ✅
│   │   └── motor/
│   │       ├── gerador.ts        ← 776 linhas, mas VALIDA não GERA ⚠️
│   │       ├── validador.ts      ← PolicyEngine (R1-R8) ✅
│   │       └── worker.ts         ← Worker thread ✅
│   ├── preload/
│   │   └── index.ts              ← contextBridge ✅
│   ├── renderer/
│   │   ├── index.html            ✅
│   │   └── src/
│   │       ├── App.tsx           ← Router com 9 rotas ✅
│   │       ├── paginas/          ← 9 páginas ✅
│   │       ├── componentes/      ← 7 custom ✅
│   │       ├── components/ui/    ← 19 shadcn (faltam 27) ⚠️
│   │       ├── servicos/         ← 8 tipc clients ✅
│   │       └── estado/           ← Zustand ✅
│   └── shared/
│       ├── types.ts              ← 18 interfaces ✅
│       └── constants.ts          ← CLT rules ✅
├── docs/
│   ├── BUILD_V2_ESCALAFLOW.md    ← Spec completa (REFER A ISSO)
│   └── ANALYST_PROCESSO_USUARIO_MULTITENANCY.md ← Diagnóstico v1
├── specs/
│   ├── 001-frontend-completo/
│   ├── 002-gaps-auditoria/
│   └── 003-electron-migration/   ← Concluído
└── MIGRATION_COMPLETE.md         ← Entrega da sprint 003
```

### O Motor Agora (Precisa Mudar)

**src/main/motor/gerador.ts (AGORA):**
```typescript
export function gerarProposta(
  setor_id: number,
  data_inicio: Date,
  data_fim: Date,
  db: Database
): MotorResultado {
  // Lê MOSAICO do DB (grade manual que gestora montou)
  // Lê RODIZIO do DB (domingos que gestora definiu)
  // Projeta no calendário
  // Valida (R1-R8)
  // Retorna violações

  // NÃO GERA NADA — só valida template existente
}
```

**O que precisa ser:**
```typescript
export function gerarProposta(
  setor_id: number,
  data_inicio: Date,
  data_fim: Date,
  db: Database
): MotorResultado {
  // NÃO lê mosaico — CALCULA
  // NÃO lê rodizio — PROPÕE
  // Resolve constraint satisfaction:
  //   - Cada pessoa em seu contrato
  //   - Demanda coberta
  //   - CLT respeitada
  // Retorna ESCALA INTEIRA (quem trabalha quando)
}
```

---

## PARTE 5: DOCUMENTAÇÃO ESSENCIAL (LEIA PRIMEIRO)

**Para o próximo time, LEIA NESTA ORDEM:**

1. **BUILD_V2_ESCALAFLOW.md** (350 linhas)
   - O blueprint do que foi pedido
   - Modelo de dados
   - Fluxos esperados
   - API routes

2. **ANALYST_PROCESSO_USUARIO_MULTITENANCY.md** (1400 linhas)
   - O diagnóstico de v1
   - Por que v2 precisa ser diferente
   - Decisões de design justificadas
   - Fluxo do usuário final

3. **MIGRATION_COMPLETE.md** (neste specs/003/)
   - O que foi entregue na sprint 003
   - Estrutura do código
   - Próximos passos

4. **CLAUDE.md** (raiz do projeto)
   - Convenções: snake_case DB = JSON = TS
   - Padrões arquiteturais
   - Como buildar/testar

---

## PARTE 6: O PROMPT PARA O PRÓXIMO CHAT

```
Salva este arquivo como referência:
/Users/marcofernandes/escalaflow/specs/003-electron-migration/CONTEXT_FOR_TEAM.md

Quando for spawnar o time, usa este prompt:

---

[COPY PASTE ABAIXO NO CHAT NOVO]

Olá time. Eu sou o Marco. Nós completamos a Sprint 003
(Migração Web → Electron Desktop). O app está 100% funcional,
mas o CORE não foi implementado. Agora preciso de um time especializado
para finalizar v2.

LEIA ISSO PRIMEIRO:
/Users/marcofernandes/escalaflow/specs/003-electron-migration/CONTEXT_FOR_TEAM.md

DEPOIS, SPAWNAR TIME com estes 4 roles:

1. BUILD v2 Architect
   - Conhece BUILD_V2_ESCALAFLOW.md de cor
   - Heurística: previne over-engineering
   - Arquiteta ScheduleGenerator (CORE novo)
   - Arquivo: src/main/motor/gerador.ts

2. UX Flow Heuristics
   - Valida fluxo do RH: quanto menos cliques, melhor
   - Red flags: confuso? Complexo? Precisa manual?
   - Simplifica a experiência
   - Arquivo: src/renderer/src/paginas/EscalaPagina.tsx

3. Product Validator — Generator Guardian
   - Valida CONSTANTEMENTE: "Gera escalas ou não gera?"
   - Test cases: happy path + sad paths
   - Checa: proposição? CLT? Cobertura? Recalc?
   - Red flag: "Tá igual v1" → bloqueia

4. Implementation Engineer
   - Coda com propósito (não "porque sim")
   - Implementa decisões dos outros 3
   - Código limpo, documentado, testável
   - Executa sempre com contexto

MISSAO DO TIME:
Finalizar v2 do EscalaFlow focando no CORE:
✅ ScheduleGenerator que GERA escalas (não valida)
✅ Simulação iterativa com recalc real-time
✅ UX simplificada pro RH
❌ NÃO deixar virar complexo/espalhado (como v1)

CONTEXTO:
- Sprint 003 entregou: Desktop Electron 100%, API, DB, 9 páginas
- Falta: Motor que gera (CRÍTICO), UX pro RH, recalc em tempo real
- Documentação: BUILD_V2_ESCALAFLOW.md é a FONTE DE VERDADE

COMO FUNCIONA:
1. Architect diz como fazer
2. UX valida se é simples
3. Validator checa se funciona
4. Engineer implementa

Se divergem, resolvem nos argumentos (sem ego).

PRONTIDÃO: Sim, pode começar. Contexto completo em CONTEXT_FOR_TEAM.md

---
```

---

## PART 7: Checklist para o Próximo Time

Antes de começar qualquer code, o time deve:

- [ ] Ler BUILD_V2_ESCALAFLOW.md completamente
- [ ] Ler ANALYST_PROCESSO_USUARIO_MULTITENANCY.md (sections 9-13)
- [ ] Entender a diferença: VALIDA vs GERA
- [ ] Mapear ScheduleGenerator interface (input/output)
- [ ] Definir "recalc em tempo real" (< 100ms? < 500ms?)
- [ ] Validar com Marco antes de cualquier code major

---

**Status:** Ready for next sprint.
**Team:** Await confirmation and spawning.
**Next move:** Copy prompt acima, paste em novo chat, confirme roles.

