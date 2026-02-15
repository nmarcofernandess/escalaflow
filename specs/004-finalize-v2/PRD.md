# PRD: Finalizar EscalaFlow v2 — Motor + UX + Recalc Completo

> **Workflow:** feature
> **Budget sugerido:** high
> **Criado em:** 2026-02-15T00:00:00Z
> **Fonte:** gather

---

## Visão Geral

Completar a implementação do EscalaFlow v2 para atingir paridade funcional com o blueprint BUILD_V2_ESCALAFLOW.md. O motor de geração de escalas JÁ EXISTE (776 linhas, 7 fases implementadas), mas precisa de refinamento de qualidade, recálculo iterativo inteligente, e UX completa para o RH (usuários não-técnicos).

**Contexto:**
- Sprint 003 entregou: Desktop Electron 100%, IPC, Database, 9 páginas React
- Motor atual: GERA escalas (não só valida), mas qualidade precisa ser testada/melhorada
- Gap: Recalc iterativo é básico (upsert+revalidate, não regenera), UX incompleta, sem validação com dados reais

**Objetivo:** Sistema PRONTO para os pais do Marco (RH do Supermercado Fernandes) usarem em produção.

---

## Requisitos Funcionais

### Motor de Geração (Refinamento)
- [ ] **RF1:** Validar qualidade do motor com dados reais (10+ colaboradores, 3+ setores, 30 dias)
- [ ] **RF2:** Corrigir bugs identificados na validação (violações CLT, cobertura insuficiente, preferências ignoradas)
- [ ] **RF3:** Melhorar distribuição de folgas (evitar concentração, respeitar `evitar_dia_semana`)
- [ ] **RF4:** Melhorar rodízio de domingo (equilíbrio M/F, respeitar consecutivos com lookback)
- [ ] **RF5:** Garantir que alocação de horários preenche déficit de cobertura corretamente

### Recálculo Iterativo Inteligente
- [ ] **RF6:** Quando gestora ajusta uma alocação (arrasta, troca), sistema deve REGENERAR distribuição ao redor (não só revalidar)
- [ ] **RF7:** Feedback em tempo real: indicadores atualizam < 1s após ajuste
- [ ] **RF8:** Preservar ajustes manuais durante recálculo (não sobrescrever o que gestora mexeu)

### UX Completa para RH
- [ ] **RF9:** Sidebar com Avatar do usuário + Dropdown (Perfil, Tema, Ajuda, Sair)
- [ ] **RF10:** Theme Switcher (Light/Dark/System) com persistência
- [ ] **RF11:** Loading states claros (spinner + mensagem "Gerando escala..." / "Recalculando...")
- [ ] **RF12:** Feedback de erro humanizado (não stack trace técnico)
- [ ] **RF13:** Tour/Onboarding ao primeiro uso ("Como funciona?")
- [ ] **RF14:** Grid interativa: click em célula → toggle TRABALHO/FOLGA → recalc automático
- [ ] **RF15:** Auto-preencher período com próximo mês (UX já implementada, validar)

### Validação e Qualidade
- [ ] **RF16:** Criar casos de teste com dados reais do supermercado
- [ ] **RF17:** Garantir 0 violações HARD em escalas geradas
- [ ] **RF18:** Pontuação > 80 em escalas geradas automaticamente
- [ ] **RF19:** Cobertura > 90% das faixas de demanda

---

## Critérios de Aceitação

### CA1: Motor Gera Escalas de Qualidade
- Testado com 3 setores diferentes (ex: Caixa 10 colabs, Açougue 5 colabs, Padaria 8 colabs)
- Período de 30 dias completo
- Resultado: 0 violações HARD, < 5 violações SOFT por setor
- Todas as regras CLT (R1-R8) respeitadas
- Preferências atendidas em > 80% dos casos (turno, dia)

### CA2: Recalc Iterativo Funciona
- Gestora ajusta 1 alocação na grid
- Sistema recalcula em < 1s
- Indicadores atualizam automaticamente
- Ajuste manual é preservado
- Outros colaboradores são redistribuídos se necessário

### CA3: UX Completa e Funcional
- Sidebar tem Avatar + Dropdown com 4 opções (Perfil, Tema, Ajuda, Sair)
- Theme switcher funciona (Light/Dark/System) e persiste no localStorage
- Loading spinner aparece durante geração (com texto "Gerando escala para [setor]...")
- Erros são mostrados em linguagem humana (sem stack trace)
- Tour aparece ao primeiro uso e pode ser fechado/revisitado

### CA4: Grid Interativa
- Click em célula TRABALHO → vira FOLGA → recalc automático
- Click em célula FOLGA → vira TRABALHO → recalc automático
- Feedback visual imediato (loading na célula)
- Violações aparecem/desaparecem conforme ajuste

### CA5: Pronto para Produção
- App desktop abre sem erros
- Gestora consegue:
  1. Cadastrar setor + colaboradores + demandas
  2. Clicar "Gerar Escala"
  3. Ver escala gerada com indicadores
  4. Ajustar se necessário
  5. Oficializar
  6. Exportar/Imprimir
- Todo fluxo funciona sem precisar de manual ou suporte técnico

---

## Constraints

- **C1:** Não adicionar features além do BUILD_V2_ESCALAFLOW.md (nada de multi-tenancy, nada de pedidos/trocas)
- **C2:** Manter snake_case ponta a ponta (DB = JSON = TS)
- **C3:** Motor roda em worker thread (não pode travar UI)
- **C4:** Recalc deve ser < 1s para períodos de até 30 dias
- **C5:** Código deve seguir padrões existentes (IPC via tipc, React com shadcn/ui, Zustand para state)
- **C6:** Zero breaking changes em schema de banco existente

---

## Fora do Escopo

- ❌ Multi-tenancy (deixar para v3)
- ❌ Pedidos/Trocas de turno (deixar para v2.1)
- ❌ Trilha de auditoria completa (deixar para v2.1)
- ❌ Modo ESTRITO com justificativa (deixar para v2.1)
- ❌ Preflight validation com linguagem humana (deixar para v2.1)
- ❌ Export em Markdown (deixar para v2.1)
- ❌ Drag & Drop na grid (deixar para v2.1)
- ❌ Reescrever motor do zero (refinar o existente)

---

## Serviços Envolvidos

- [x] **Frontend** (`src/renderer/`) — UX polish, Grid interativa, Theme, Tour
- [x] **Backend** (`src/main/`) — Motor refinement, Recalc iterativo
- [x] **Database** (SQLite) — Nenhuma mudança de schema necessária
- [x] **IPC** (`src/main/tipc.ts`) — Novos handlers se necessário para recalc
- [x] **Worker Thread** (`src/main/motor/worker.ts`) — Motor roda aqui

---

## Arquivos Críticos

### Motor (Refinamento)
- `src/main/motor/gerador.ts` — 776 linhas, 7 fases implementadas (auditar qualidade)
- `src/main/motor/validador.ts` — PolicyEngine (R1-R8)
- `src/main/motor/worker.ts` — Worker thread wrapper
- `src/shared/constants.ts` — CLT rules (imutáveis)

### Frontend (UX + Grid)
- `src/renderer/src/paginas/EscalaPagina.tsx` — CORE frontend (689 linhas)
- `src/renderer/src/componentes/AppSidebar.tsx` — Adicionar Avatar + Dropdown + Theme
- `src/renderer/src/componentes/EscalaGrid.tsx` — Tornar interativa (click → toggle → recalc)
- `src/renderer/src/componentes/ThemeSwitcher.tsx` — CRIAR (novo componente)
- `src/renderer/src/componentes/OnboardingTour.tsx` — CRIAR (novo componente)

### IPC (Recalc)
- `src/main/tipc.ts` — Handler `escalas.ajustar` precisa ser inteligente (regenerar, não só revalidar)

### Testes/Validação
- `src/main/db/seed.ts` — Adicionar dados de teste realistas (ou criar seed-real.ts)
- `specs/004-finalize-v2/test-cases.md` — CRIAR com casos de teste

---

## Budget Sugerido

**Recomendação:** **HIGH**

**Justificativa:**
- Task complexa com múltiplas frentes (Motor, Recalc, UX)
- Refinamento de algoritmo existente (precisa entender 776 linhas antes de mexer)
- UX requer componentes novos + integração com shadcn/ui
- Recalc iterativo é arquiteturalmente complexo (regenerar sem sobrescrever ajustes)
- Precisa de validação extensiva com dados reais
- Alto risco de quebrar algo se não for feito com cuidado

**Budget high garante:**
- Discovery agent com opus (entende motor complexo)
- Critic agent com opus (pega bugs antes de virar problema)
- Coder agent com sonnet (implementa com qualidade)
- QA rigoroso com múltiplos cenários de teste

---

## Notas Adicionais

### Descoberta Importante (2026-02-15)
Durante análise do código, descobri que o **motor JÁ GERA escalas** (não só valida). O documento CONTEXT_FOR_TEAM.md estava incorreto ao afirmar que o ScheduleGenerator precisava ser criado do zero. O motor atual:
- ✅ Fase 1: Preparação + lookback
- ✅ Fase 2: Mapa de disponibilidade
- ✅ Fase 3: Distribuição de folgas
- ✅ Fase 4: Rodízio de domingo
- ✅ Fase 4.5: Repair pass (>6 dias consecutivos)
- ✅ Fase 5: Alocação de horários
- ✅ Fase 6: Validação (R1-R8)
- ✅ Fase 7: Scoring

**Implicação:** Não precisamos CRIAR o motor, precisamos REFINAR e VALIDAR o existente.

### Referências
- `docs/BUILD_V2_ESCALAFLOW.md` — Fonte de verdade (350 linhas)
- `docs/ANALYST_PROCESSO_USUARIO_MULTITENANCY.md` — Diagnóstico de v1 (1400 linhas)
- `specs/003-electron-migration/CONTEXT_FOR_TEAM.md` — Análise de gap (parcialmente incorreta)
- `specs/003-electron-migration/MIGRATION_COMPLETE.md` — O que foi entregue na sprint 003

### Próximos Passos Sugeridos
Após este PRD ser aprovado:
1. Rodar `/orchestrate --resume 004 --budget high`
2. Discovery fase: auditar motor atual, identificar bugs/melhorias
3. Plan fase: desenhar arquitetura de recalc iterativo
4. Code fase: implementar refinamentos + UX + recalc
5. QA fase: validar com dados reais, garantir 0 violações HARD

---

**Criado por:** Miss Monday
**Para:** Marco (Operador)
**Projeto:** EscalaFlow v2 — Sistema de Escalas de Trabalho para Supermercado Fernandes
