# PRD — EscalaFlow: IA, Configurações e Capacidades
**Versão:** 3.2
**Data:** 2026-02-21
**Status:** APROVADO — Todas as decisões resolvidas. SPEC-01, SPEC-02B, SPEC-03, SPEC-04 e SPEC-07 implementadas.

---

## CONTEXTO

O EscalaFlow é um app Electron de gestão de escalas com sidebar shadcn, motor OR-Tools, e um Assistente IA recém-integrado via Gemini. Este PRD cobre 8 frentes de melhoria que precisam ser planejadas, divididas em specs e executadas em sequência.

---

## ÍNDICE

1. [SPEC-01: Chat IA — Posicionamento Correto](#spec-01) — IMPLEMENTADO
2. [SPEC-02A: Reorganização da Navegação](#spec-02a)
3. [SPEC-02B: Sistema de Regras Configuráveis (Engine)](#spec-02b) — IMPLEMENTADO
4. [SPEC-03: Remoção do Ícone IA da Sidebar](#spec-03) — IMPLEMENTADO
5. [SPEC-04: Sistema de Histórico de Chats da IA](#spec-04) — IMPLEMENTADO
6. [SPEC-05: Mapa de Capacidades da IA para RH](#spec-05)
7. [SPEC-06: Atualização do Tour "Como Funciona"](#spec-06)
8. [SPEC-07: Drawer de Configuração do Motor](#spec-07) — IMPLEMENTADO

---

<a id="spec-01"></a>
## SPEC-01: Chat IA — Posicionamento Correto — IMPLEMENTADO

### Implementação Concluída

- `SidebarProvider className="h-svh overflow-hidden"` (`App.tsx:54`)
- `SidebarInset className="h-full overflow-hidden"` cascateando (`App.tsx:60-62`)
- `<aside>` custom com `w-[380px] h-full shrink-0` (`IaChatPanel.tsx:87`)
- Painel fixo na viewport, scroll apenas dentro da ScrollArea de mensagens
- Offcanvas: `if (!aberto) return null` — some completamente
- Resize do conteudo central automatico via flex layout

### Decisões Aplicadas

| # | Decisão | Resolução |
|---|---------|-----------|
| 1.1 | SidebarProvider ou CSS custom? | **CUSTOM `<aside>`** — implementado. |
| 1.2 | Comportamento ao fechar | **OFFCANVAS** — implementado. |
| 1.3 | Largura | **FIXA 380px** — implementado. |

---

<a id="spec-02a"></a>
## SPEC-02A: Reorganização da Navegação

### Problema Atual
A página de Empresa/Configurações (`/empresa`) está poluída com muitas seções misturadas: dados da empresa, período semanal, intervalo de almoço, piso operacional, feriados, tema, IA, atualização, regras.

### Reorganização Proposta

#### A. Sidebar — Itens de Navegação Direta

| Item | Rota | Descrição |
|------|------|-----------|
| Dashboard | `/` | Já existe |
| Setores | `/setores` | Já existe |
| Colaboradores | `/colaboradores` | Já existe |
| Escalas | `/escalas` | Já existe |
| **Tipos de Contrato** | `/tipos-contrato` | Já existe |
| **Calendário de Feriados** | `/feriados` | **MOVER** para página própria na sidebar |
| **Regras** | `/regras` | **NOVA PÁGINA** — ver SPEC-02B |

#### B. Dropdown do Usuário (Footer da Sidebar)

| Item | Ação | Detalhamento |
|------|------|-------------|
| **Empresa** | Abre `/empresa` | Dados da empresa: nome, CNPJ, telefone. **INCLUI:** horários de abertura/fechamento por dia da semana (fallback geral — setores podem override via `setor_horario_semana`). |
| **Configurações** | Abre `/configuracoes` | Tema/aparência, Assistente IA (provider, modelo, API key), Atualizações do sistema |
| Tema (submenu) | Quick switch | Manter submenu light/dark/system |
| Como Funciona? | Inicia tour | Já existe |
| Sobre | Info | Já existe |

#### C. O que REMOVER / MOVER

- **REMOVER** `piso_operacional` — Campo morto no schema `setores` (INTEGER DEFAULT 1). A demanda por faixa horária (`demandas` table) já substituiu completamente. Remover do schema e UI.
- **MOVER** `usa_cct_intervalo_reduzido` (almoço CCT) → página `/regras` (SPEC-02B). Toggle funcional que o motor usa.
- **MOVER** `corte_semanal` + `tolerancia_semanal_min` → página `/regras` (SPEC-02B). Regra operacional do motor, não "dado da empresa".

### Decisões Tomadas

| # | Decisão | Resolução |
|---|---------|-----------|
| 2A.1 | Horários de funcionamento | **`/empresa`** — são dados operacionais, não regras. |
| 2A.2 | Nome da página de regras | **"Regras"** — direto, claro. |
| 2A.3 | Piso operacional | **REMOVER** do schema `setores`. |
| 2A.4 | Intervalo almoço CCT | **MANTER, mover para `/regras`**. |
| 2A.5 | Corte semanal | **MANTER, mover para `/regras`**. |

### Entregáveis
- Página `/empresa` simplificada (só dados + horários de funcionamento)
- Página `/configuracoes` nova (tema, IA, atualizações)
- Página `/feriados` extraída como página própria na sidebar
- Dropdown do usuário reorganizado
- Remoção do `piso_operacional` do schema e UI
- Routing novo para `/regras` (conteúdo vem da SPEC-02B)
- Routing novo para `/configuracoes`

---

<a id="spec-02b"></a>
## SPEC-02B: Sistema de Regras Configuráveis (Engine) — IMPLEMENTADO ✅

### Implementação Concluída

**Implementado em:** 2026-02-21

| Entregável | Status | Notas |
|-----------|--------|-------|
| Tabelas `regra_definicao` + `regra_empresa` no schema | ✅ | `DDL_V6_REGRAS` em `schema.ts` |
| Seed de 35 regras (CLT, SOFT, ANTIPATTERN) | ✅ | `seedRegrasDefinicao()` em `seed.ts` |
| Types `RuleStatus`, `RuleDefinition`, `RuleConfig` | ✅ | `src/shared/types.ts` |
| IPC handlers: `regras.listar`, `regras.atualizar`, `regras.resetarEmpresa` | ✅ | `tipc.ts` (77 → 80 handlers) |
| Service `regras.ts` (renderer) | ✅ | `src/renderer/src/servicos/regras.ts` |
| Bridge: `buildRulesConfig()` — merge DB + rulesOverride | ✅ | `solver-bridge.ts` |
| Python: `rule_is()` helper + wrappers condicionais | ✅ | `solver/solver_ortools.py` |
| Python: 4 funções SOFT penalty | ✅ | `solver/constraints.py` — h1_soft, human_blocks_soft, dias_trabalho_soft, min_diario_soft |
| Validador TS: lê regras do DB, AP checkers condicionais | ✅ | `validador.ts` — try/catch defensivo |
| `RegrasPagina.tsx`: 3 cards (CLT, Preferências, Antipadrões) | ✅ | Bulk action, lock icon, aviso_dependencia, auto-save |
| Botão "Restaurar Padrões do Sistema" | ✅ | Chama `regrasService.resetarEmpresa()` |

**Não implementado (fora de escopo desta sprint):**
- Mover `corte_semanal` / `tolerancia_semanal_min` de `constants.ts` para contexto `/regras` — continua em `constants.ts` como constante de sistema.

### Decisões Aplicadas

| # | Decisão | Resolução |
|---|---------|-----------|
| 2B.1 | Regras SOFT — escopo | **POR EMPRESA (global)** — implementado. |
| 2B.2 | Regras travadas | **H2, H4, H5, H11-H18** — lock icon + dropdown disabled. |
| 2B.3 | Dois níveis de reset | **SIM** — "Restaurar Sistema" no `/regras`, "Restaurar Empresa" e "Restaurar Sistema" no Drawer. |
| 2B.4 | Status por regra | **HARD / SOFT / OFF** para CLT. **ON / OFF** para AP/SOFT. |
| 2B.5 | Cross-rule warnings | **SIM** — `aviso_dependencia` no seed, exibido na UI ao mudar status. |
| 2B.6 | Versão SOFT de regras HARD | **Implementado:** H1, H6 (human_blocks), DIAS_TRABALHO, MIN_DIARIO. |

---

### Problema Original (Histórico)
Todas as regras do motor estão hardcoded — no Python (solver/constraints.py), no TypeScript (validador.ts), e nas constantes (constants.ts). O único controle é o `nivel_rigor` (ALTO/MEDIO/BAIXO), que liga/desliga GRUPOS de regras de forma grosseira. O gestor de RH não tem visibilidade nem controle sobre regras individuais.

### Pesquisa: Estado Atual das Regras no Motor

#### Inventário Completo — Python Solver (solver_ortools.py + constraints.py)

**HARD Constraints (adicionadas via `model.add()` — solver REJEITA violações):**

| Código | Regra | Gating Atual | Sempre ON? |
|--------|-------|-------------|------------|
| H1 | Max 6 dias consecutivos (Art. 67 + OJ 410 TST) | `nivel_rigor in ["ALTO", "MEDIO"]` | Não — OFF em BAIXO |
| H2 | Min 11h interjornada (Art. 66 CLT) | ALWAYS | Sim |
| H4 | Max jornada diária por contrato | ALWAYS | Sim |
| H5 | Exceções (férias, atestado, bloqueio) | ALWAYS | Sim |
| H6/H7b/H9/H9b/H20 | Human blocks (almoço, 2-blocos, gaps) | `nivel_rigor == "ALTO"` | Não — OFF em MEDIO/BAIXO |
| H10 | Meta semanal ± tolerância | ALWAYS | Sim |
| H11 | Aprendiz nunca domingo | ALWAYS | Sim |
| H12 | Aprendiz nunca feriado | ALWAYS | Sim |
| H13 | Aprendiz nunca noturno (22h-5h) | ALWAYS | Sim |
| H14 | Aprendiz nunca hora extra | ALWAYS | Sim |
| H15 | Estagiário max 6h/dia 30h/sem (Lei 11.788) | ALWAYS | Sim |
| H16 | Estagiário nunca hora extra | ALWAYS | Sim |
| H17/H18 | Feriados proibidos (CCT 25/12, 01/01) | ALWAYS | Sim |
| H19 | Folga compensatória domingo em 7 dias | NO-OP (redundante com H1) | Desativado |
| — | Janela horário por colaborador/dia | ALWAYS | Sim |
| — | Folga fixa 5x2 | ALWAYS | Sim |
| — | Dias trabalho por semana | `nivel_rigor in ["ALTO", "MEDIO"]` | Não — OFF em BAIXO |
| — | Min diário (4h) | `nivel_rigor == "ALTO"` | Não — OFF em MEDIO/BAIXO |
| — | Piso operacional | ALWAYS | Sim (remover — SPEC-02A) |

**SOFT Constraints (penalização no objetivo — solver PREFERE não violar):**

| Código | Regra | Peso | Configurável Hoje? |
|--------|-------|------|-------------------|
| DEMAND_DEFICIT | Cobertura insuficiente | 10000 | Não (hardcoded) |
| SURPLUS | Over-coverage | 5000 | Não |
| DOMINGO_CICLO | Rodízio de domingos | 3000 | Não |
| TIME_WINDOW_PREF | Preferência de turno (manhã/tarde) | 2000 | Não |
| CONSISTENCIA | Consistência de horário entre dias | 1000 | Não |
| AP1_EXCESS | Jornada excessiva (>8h) | 250 | Não |
| SPREAD | Equilíbrio de carga entre equipe | 800 | Não |

**Antipatterns (TypeScript — validador.ts, pós-geração):**

| Tier | Código | Regra | Peso |
|------|--------|-------|------|
| 1 | AP1 | Clopening (fechar + abrir no dia seguinte) | -15 |
| 1 | AP3 | Almoço simultâneo (>50% equipe) | -20 |
| 1 | AP4 | Desequilíbrio de carga | -8 |
| 1 | AP7 | Fome de fim de semana (>5 sem sem folga sáb/dom) | -8 |
| 1 | AP15 | Clustering de dias de pico | -6 |
| 1 | AP16 | Júnior sozinho em slot de alta demanda | -12 |
| 2 | AP2 | Instabilidade de horários (ioiô) | -10 |
| 2 | AP5 | Folga isolada (1 dia entre 2 de trabalho) | -5 |
| 2 | AP6 | Inequidade de turnos (índice <40%) | -3 |
| 2 | AP8 | Almoço fora da janela ideal | -3/-8 |
| 2 | AP9 | Hora morta (microturno + gap + microturno) | -3 |
| 2 | AP10 | Overstaffing (2+ pessoas quando meta=1) | (incluso no AP4) |

#### Como `nivel_rigor` Funciona Hoje

| Constraint | ALTO | MEDIO | BAIXO |
|-----------|------|-------|-------|
| H1 (6 dias consecutivos) | ON | ON | **OFF** |
| H2 (descanso 11h) | ON | ON | ON |
| H4 (max jornada diária) | ON | ON | ON |
| H5 (exceções) | ON | ON | ON |
| Human blocks (almoço, gaps) | ON | **OFF** | **OFF** |
| H10 (meta semanal) | ON | ON | ON |
| H11-H18 (aprendiz/estagiário/feriado) | ON | ON | ON |
| Dias trabalho semanal | ON | ON | **OFF** |
| Min diário (4h) | ON | **OFF** | **OFF** |
| SOFTs (deficit, surplus, etc.) | ON | ON | ON |

**Problema:** É tudo-ou-nada por grupo. Se H6 (human blocks) está impedindo solução, o RH tem que baixar de ALTO para MEDIO — o que desliga H6 MAS TAMBÉM desliga min diário. Não há granularidade.

### Arquitetura Proposta: Regras Configuráveis

#### Dois Níveis de Defaults

```
DEFAULTS DO SISTEMA (factory reset, hardcoded no código)
    → Todas as HARD = HARD
    → Todas as SOFT = SOFT
    → Todos os AP = ativados com pesos originais
    → Equivale ao nivel_rigor = "ALTO" atual

DEFAULTS DA EMPRESA (persistido no banco, editável em /regras)
    → RH customiza: desliga AP3 (almoço simultâneo funciona assim no supermercado deles)
    → RH relaxa: H6 human blocks vira SOFT (não impede, só penaliza)
    → Corte semanal, tolerância, almoço CCT vivem aqui também

CONFIGURAÇÃO POR GERAÇÃO (Drawer — SPEC-07, NÃO persistida)
    → Override temporário na hora de gerar
    → "Restaurar Padrões da Empresa" → volta pro que tá em /regras
    → "Restaurar Padrões do Sistema" → volta pro factory reset
```

#### Schema Proposto

```sql
-- Tabela de referência (seed, read-only) — todas as regras que existem
CREATE TABLE IF NOT EXISTS regra_definicao (
    codigo TEXT PRIMARY KEY,                 -- 'H1', 'H2', 'AP1', 'S_DEFICIT', etc.
    nome TEXT NOT NULL,                      -- 'Max 6 dias consecutivos'
    descricao TEXT,                          -- Explicação em português para o RH
    categoria TEXT NOT NULL                  -- 'CLT' | 'SOFT' | 'ANTIPATTERN'
        CHECK (categoria IN ('CLT', 'SOFT', 'ANTIPATTERN')),
    status_sistema TEXT NOT NULL DEFAULT 'HARD'  -- Default do SISTEMA (factory)
        CHECK (status_sistema IN ('HARD', 'SOFT', 'OFF')),
    editavel INTEGER NOT NULL DEFAULT 1,     -- 0 = regra travada (CLT core), 1 = pode mudar
    ordem INTEGER NOT NULL DEFAULT 0         -- Ordem de exibição na UI
);

-- Configuração da empresa (editável pelo RH em /regras)
CREATE TABLE IF NOT EXISTS regra_empresa (
    codigo TEXT PRIMARY KEY REFERENCES regra_definicao(codigo),
    status TEXT NOT NULL DEFAULT 'HARD'      -- Override da empresa
        CHECK (status IN ('HARD', 'SOFT', 'OFF')),
    atualizado_em DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

**Fluxo:**
1. App inicia → seed `regra_definicao` com todas as regras (factory defaults)
2. `regra_empresa` começa vazia → usa `regra_definicao.status_sistema` como fallback
3. RH edita em `/regras` → insere/atualiza `regra_empresa`
4. Bridge lê: `regra_empresa.status ?? regra_definicao.status_sistema` por regra
5. Drawer override é in-memory, nunca persiste

#### Regras TRAVADAS (não editáveis)

Algumas regras são CLT core e **nunca devem ser desligáveis**, nem para SOFT:

| Código | Regra | Por quê está travada |
|--------|-------|---------------------|
| H2 | Descanso 11h interjornada | Art. 66 CLT — mínimo legal inegociável |
| H5 | Exceções (férias/atestado) | Férias é lei, atestado é afastamento médico |
| H11-H16 | Proteções aprendiz/estagiário | Lei do Aprendiz + Lei 11.788 — menores de idade |
| H17/H18 | Feriados CCT proibidos | Convenção coletiva — multa pesada se violar |

**Na UI:** Essas aparecem com cadeado e tooltip "Regra legal — não pode ser desativada".

#### Regras FLEXÍVEIS (podem virar SOFT ou OFF)

| Código | Default Sistema | Pode virar SOFT? | Pode virar OFF? |
|--------|----------------|-------------------|-----------------|
| H1 (6 dias consecutivos) | HARD | Sim | Sim (com aviso) |
| H6/H7b/H9/H9b/H20 (human blocks) | HARD | Sim | Sim |
| H10 (meta semanal) | HARD | Sim | Não (afeta cálculo) |
| Dias trabalho semanal | HARD | Sim | Sim |
| Min diário (4h) | HARD | Sim | Sim |
| DEMAND_DEFICIT | SOFT | N/A | Sim |
| DOMINGO_CICLO | SOFT | N/A | Sim |
| TIME_WINDOW_PREF | SOFT | N/A | Sim |
| CONSISTENCIA | SOFT | N/A | Sim |
| AP1-AP16 (todos) | ATIVO | N/A | Sim |

#### Risco: Cross-Rule Dependencies

Desligar uma regra pode tornar outra infeasible. Exemplos mapeados:

| Se desligar... | Pode causar... | Mitigação |
|----------------|---------------|-----------|
| H1 (6 dias) | H10 (meta semanal) infeasible se poucos colaboradores | Warning na UI: "Desligar H1 pode afetar cálculo semanal" |
| Human blocks | Escalas sem almoço (viola CLT na prática) | Warning: "Sem human blocks, motor pode gerar jornadas sem intervalo" |
| DEMAND_DEFICIT | Motor ignora demanda mínima do setor | Warning: "Setores podem ficar descobertos" |
| Min diário (4h) | Microturnos de 15min-1h (inúteis) | Warning: "Motor pode gerar turnos muito curtos" |

**Implementação:** Cada regra tem um campo `dependencias_aviso` no seed, e a UI mostra o warning ao desligar.

#### Impacto no Python Solver

Refatoração necessária em `solver_ortools.py::build_model()` (linhas 396-468):

```python
# ANTES (nivel_rigor grosso):
if nivel_rigor in ["ALTO", "MEDIO"]:
    add_h1_max_dias_consecutivos(model, ...)

# DEPOIS (granular por regra):
rules = config.get("rules", {})
if rules.get("H1", "HARD") != "OFF":
    if rules.get("H1") == "SOFT":
        add_h1_as_soft_penalty(model, ...)  # penalização no objetivo
    else:
        add_h1_max_dias_consecutivos(model, ...)  # constraint hard
```

**Escopo:** ~20 funções `add_*()` precisam do wrapper condicional. Para regras que hoje são só HARD, criar versão SOFT (penalização) é trabalho adicional caso a caso.

#### Impacto no Validador TypeScript

O `validarTudoV3()` em `validacao-compartilhada.ts` chama todos os checkers incondicionalmente. Precisa:
1. Receber config de regras como parâmetro
2. Wrap cada checker em `if regra !== 'OFF'`
3. Se regra === 'SOFT', marcar violação como severity 'soft' em vez de 'hard'

#### Config Granular Enviada ao Python

```typescript
// SolverInput.config (novo formato)
config: {
  strategy: 'fast' | 'timed',
  max_time_seconds: number,       // só se strategy='timed', default 30
  rules: {
    H1:  'HARD' | 'SOFT' | 'OFF',
    H2:  'HARD',                   // travada, sempre HARD
    H4:  'HARD' | 'SOFT' | 'OFF',
    H5:  'HARD',                   // travada
    H6:  'HARD' | 'SOFT' | 'OFF', // human blocks
    H10: 'HARD' | 'SOFT',         // não pode OFF
    H11: 'HARD',                   // travada (aprendiz)
    // ... todas as regras
    DEMAND_DEFICIT: 'SOFT' | 'OFF',
    DOMINGO_CICLO:  'SOFT' | 'OFF',
    AP1: 'ON' | 'OFF',            // antipatterns são binários
    AP3: 'ON' | 'OFF',
    // ...
  }
}
```

### Decisões Tomadas

| # | Decisão | Resolução |
|---|---------|-----------|
| 2B.1 | Regras SOFT — escopo | **POR EMPRESA (global)** — por-setor é complexidade enorme. v1 global, extensível no futuro. |
| 2B.2 | Regras travadas | **H2, H5, H11-H18** — CLT core, nunca desligáveis. Cadeado na UI. |
| 2B.3 | Dois níveis de reset | **SIM** — "Padrões do Sistema" (factory) e "Padrões da Empresa" (persistido). |
| 2B.4 | Status por regra | **HARD / SOFT / OFF** para constraints. **ON / OFF** para antipatterns. |
| 2B.5 | Cross-rule warnings | **SIM** — warnings ao desligar regras que afetam outras. |
| 2B.6 | Versão SOFT de regras HARD | **Caso a caso** — nem toda regra HARD tem versão SOFT natural. Começar com as que já têm (H1, H6, H10, dias_trabalho, min_diario). |

### Entregáveis
- Tabelas `regra_definicao` (seed) e `regra_empresa` (editável) no schema
- Seed com todas as ~35 regras catalogadas (código, nome, descrição, categoria, status default, editável)
- IPC handlers: listar regras (join definicao+empresa), atualizar status, resetar para sistema
- Página `/regras` com 3 seções (CLT, Soft, Antipatterns), toggles por regra, cadeado nas travadas
- Warnings de cross-rule dependencies ao mudar status
- Botão "Restaurar Padrões do Sistema" (factory reset)
- Bridge TS atualizada: lê config de regras e monta dict `rules: {...}` no SolverInput
- Python solver refatorado: cada `add_*()` condicional ao status da regra
- Validador TS: respeita config de regras ao revalidar

### Arquivos Impactados

| Arquivo | Mudança |
|---------|---------|
| `src/main/db/schema.ts` | +2 tabelas (regra_definicao, regra_empresa) |
| `src/main/db/seed.ts` | +seed de ~35 regras |
| `src/shared/types.ts` | +RuleConfig, +RuleDefinition, atualizar SolverInput.config |
| `src/main/tipc.ts` | +4 handlers (regras.listar, regras.atualizar, regras.resetar, regras.resetarSistema) |
| `src/main/motor/solver-bridge.ts` | buildSolverInput lê regras do banco, monta dict rules |
| `solver/solver_ortools.py` | ~20 funções add_*() com wrapper condicional |
| `solver/constraints.py` | Criar versões SOFT de H1, H6, H10, dias_trabalho, min_diario |
| `src/main/motor/validador.ts` | validarTudoV3 recebe config, checkers condicionais |
| `src/shared/constants.ts` | Mover corte_semanal e tolerancia para /regras context |
| `src/renderer/src/paginas/RegrasPagina.tsx` | NOVA — UI completa da página /regras |
| `src/renderer/src/servicos/servicoRegras.ts` | NOVO — IPC client para regras |

---

<a id="spec-03"></a>
## SPEC-03: Remoção do Ícone IA da Sidebar — IMPLEMENTADO

### Implementação Concluída

- Zero icone IA na `AppSidebar.tsx` (removido)
- Toggle IA no `PageHeader.tsx` (`BrainCircuit` / `PanelRightClose`, linhas 154-157)
- Atalho `Cmd+J` implementado em `App.tsx` (linhas 31-34)
- `Cmd+B` nativo do shadcn SidebarProvider (toggle sidebar esquerda)

### Decisões Aplicadas

| # | Decisão | Resolução |
|---|---------|-----------|
| 3.1 | Manter em modo icon? | **NÃO** — implementado. |
| 3.2 | Atalho de teclado | **SIM** — `Cmd+J` e `Cmd+B` — implementado. |

---

<a id="spec-04"></a>
## SPEC-04: Sistema de Histórico de Chats da IA — IMPLEMENTADO ✅

> **Spec detalhada:** [`docs/SPEC-04-historico-chat-ia.md`](./SPEC-04-historico-chat-ia.md)

### Resumo

Persistencia SQLite para conversas da IA + navegacao interna no proprio `<aside>` (duas telas: chat e historico). Schema: `ia_conversas` + `ia_mensagens`. 10 IPC handlers novos (67 → 77). Zustand redesign completo (5 → 15 campos, 12 acoes async). 7 componentes React novos. Acoes bulk (arquivar todas / deletar arquivadas) como icon-only com tooltip.

**Implementado em:** 2026-02-21

### Decisões Tomadas

| # | Decisão | Resolução |
|---|---------|-----------|
| 4.1 | Nomeação | **Primeiras ~50 chars + edição manual** — zero custo API. |
| 4.2 | Conversas arquivadas | **REATIVÁVEIS** — restaurar = mudar status para `ativo`. |
| 4.3 | Painel de histórico | **Navegação interna no aside** (duas telas: chat ↔ historico). |
| 4.4 | Busca | **SÓ TÍTULO** — FTS5 é over-engineering para v1. |
| 4.5 | Limite | **ILIMITADO** — SQLite aguenta. |
| 4.6 | Persistência | **SQLITE** — Zustand = cache de sessão. |
| 4.7 | Acoes bulk | **Icon-only + Tooltip** na mesma linha do header de secao. |

### Componentes Criados

| Componente | Responsabilidade |
|-----------|-----------------|
| `IaChatPanel.tsx` | Router interno (chat ↔ historico), inicializacao lazy |
| `IaChatHeader.tsx` | Header adaptavel por tela |
| `IaChatView.tsx` | Tela de chat com persistencia SQLite |
| `IaChatInput.tsx` | Textarea + Send extraido |
| `IaMensagemBubble.tsx` | Bolha de mensagem extraida |
| `IaHistoricoView.tsx` | Lista de conversas com busca + secoes |
| `IaConversaItem.tsx` | Item com rename inline, DropdownMenu, AlertDialog |
| `IaSecaoConversas.tsx` | Secao reutilizavel com bulk actions e confirmacao |

---

<a id="spec-05"></a>
## SPEC-05: Mapa de Capacidades da IA para RH

### Objetivo
Mapear TODAS as operações que o RH pode pedir para a IA, verificar se o sistema tem tools e safeguards para atender, e garantir que a IA não crie estados inválidos.

### Categorias de Pedidos

#### 1. CONSULTAS (Read-only)
| Pedido do RH | Tool IA | UI Saga? |
|-------------|---------|---------|
| "Quantos colaboradores temos?" | `consultar(colaboradores)` | N/A |
| "Quem tá de férias?" | `consultar(excecoes, {tipo: 'FERIAS'})` | N/A |
| "Mostra escala do Açougue" | `consultar(escalas, {setor_id})` | Sim |
| "Quantas horas o João fez?" | `consultar(escalas)` + cálculo | Não |
| "Tem violação na escala?" | `preflight` | Sim |
| "Setores sem escala?" | `resumo_sistema` | Sim |

#### 2. GERAÇÃO DE ESCALAS
| Pedido | Tool | Motor? | Fallback? |
|--------|------|--------|-----------|
| "Gera escala do Açougue" | `gerar_escala` | OR-Tools | Violações detalhadas |
| "Gera todas as escalas" | Loop por setor | OR-Tools | Falha parcial por setor |
| "Refaz sem o João" | `gerar_escala` após exceção | OR-Tools | — |

#### 3. AJUSTES MANUAIS
| Pedido | Tool | Motor? |
|--------|------|--------|
| "Troca João pelo Pedro" | `ajustar_alocacao` | Re-gerar com pin |
| "Folga pro João na sexta" | `ajustar_alocacao(FOLGA)` | Valida H1/H2 |
| "Fixa Maria de manhã" | `ajustar_alocacao` + pin | Motor respeita |

#### 4. CADASTROS
| Pedido | Tool | UI Form? |
|--------|------|---------|
| "Cadastra Ana, 44h, Açougue" | `criar(colaboradores)` | Sim |
| "Férias do Pedro 01-15/03" | `criar(excecoes)` | Sim |
| "Feriado Carnaval 04/03" | `criar(feriados)` | Sim |

#### 5. ANÁLISE
| Pedido | Existe? | Prioridade |
|--------|---------|-----------|
| "Quem mais trabalhou domingos?" | Não | P2 |
| "Equilíbrio de turnos?" | Não | P2 |
| "Resumo geral" | Sim | P0 |
| "Compara fev com jan" | Não | Nice-to-have |

### Segurança: IA + Duplicidade de Dados

A IA usa as **mesmas queries SQL** que a UI (via `tools.ts`). Safeguards existentes:

| Proteção | Status | Notas |
|----------|--------|-------|
| FK constraints (setor_id, tipo_contrato_id) | OK | SQLite rejeita se FK inválida |
| UNIQUE constraints | OK | Não duplica por ex. mesmo colaborador |
| CHECK constraints (status, tipos) | OK | Rejeita valores inválidos |
| Soft delete (`ativo=1`) | OK | IA não deleta fisicamente |
| Validação de campos obrigatórios | **PARCIAL** | IA não tem Zod schemas dos forms |

**Gap identificado:** A IA cria registros via SQL direto, sem as validações Zod dos forms React. Exemplo: form de colaborador exige `nome.min(2)`, mas o tool `criar` aceita `nome: "A"`.

**Ação:** Adicionar validação no layer de tools (`tools.ts`) para campos críticos, replicando as regras essenciais dos forms Zod. Não precisa ser idêntico — só os invariantes de integridade (nome não-vazio, datas válidas, setor existente).

### Pipeline IA → Motor → IA → Humano

```
1. Humano pede: "Gera escala do Açougue pra março"
2. IA entende → chama tool preflight(setor_id, datas)
3. Preflight retorna: viável ou lista de problemas
4. SE viável:
   - IA chama gerar_escala
   - Motor resolve (com config de regras da empresa)
   - IA apresenta: "Escala gerada! 12 colaboradores, 0 violações hard, 2 soft warnings."
5. SE NÃO viável:
   - IA NÃO tenta gerar
   - IA EXPLICA o que está acontecendo
   - IA GUIA com perguntas exploratórias
6. SE falha no motor:
   - Motor retorna violacoes[] + diagnostico
   - IA traduz pra linguagem humanizada
   - IA faz perguntas que levam o RH a encontrar solução
```

### Filosofia de Fallback: IA Socrática (NÃO prescritiva)

O motor **NÃO deve sugerir fixes**. A IA também não. Motivos:

1. **Causalidade incerta** — Constraint que falhou pode ser sintoma de problema upstream. Solver travou em H2 (descanso 11h), mas causa real é poucos colaboradores. Sugerir "relaxar H2" = tratar sintoma.

2. **Respeito às decisões do gestor** — RH configurou regra, IA sugerindo oposto é paternalista e irritante. Conflito de autoridade.

3. **Abordagem correta: IA como facilitadora:**
   - **Explicar** o que está acontecendo
   - **Contextualizar** quais constraints estão envolvidas
   - **Guiar com perguntas** exploratórias ("Quer ver quantos colaboradores estão disponíveis?" / "Alguma exceção pode ser ajustada?")
   - **O humano decide**, a IA executa

4. **Implementação:** Via system prompt. A IA recebe violações e traduz em diagnóstico + perguntas.

### Decisões Tomadas

| # | Decisão | Resolução |
|---|---------|-----------|
| 5.1 | Fallback do motor | **P3 FUTURO** (sugestões automáticas). IA socrática via system prompt por agora. |
| 5.2 | Preflight automático | **SIM, SEMPRE** — obrigatório no tool `gerar_escala`. |
| 5.3 | Análises essenciais | **P0:** Consultas, geração, ajustes, explicações, preflight, resumo. **P2:** Analytics. |
| 5.4 | Batch generation | **NÃO para v1** — IA faz loop sequencial se pedido. |
| 5.5 | Limite tool-calls | **SEM LIMITE** — Gemini tem seu próprio limite. |
| 5.6 | Log do solver | **SIM** — expor `diagnostico` no retorno do Python. |
| 5.7 | Validação IA | **SIM** — adicionar validação de campos no layer de tools. |

### Entregáveis
- Preflight obrigatório dentro do tool `gerar_escala`
- Campo `diagnostico` no retorno do solver Python
- System prompt atualizado com abordagem socrática
- Validação de campos críticos em `tools.ts`
- Tool `consultar` melhorado com JOINs básicos (horas semanais, etc.)

---

<a id="spec-07"></a>
## SPEC-07: Drawer de Configuração do Motor — IMPLEMENTADO ✅

### Implementação Concluída

**Implementado em:** 2026-02-21

| Entregável | Status | Notas |
|-----------|--------|-------|
| Remover dropdowns "Rápido/Otimizado" e "Nível de Rigor" de `EscalaPagina` | ✅ | Estados `solveMode` e `nivelRigor` removidos |
| Botão `Settings2` ao lado de "Gerar Escala" | ✅ | Abre Sheet à direita |
| `SolverConfigDrawer.tsx` (NOVO) | ✅ | Sheet 420px — strategy, CLT, Preferências, Antipadrões |
| RadioGroup strategy: Rápido / Tempo N segundos | ✅ | Default: Rápido |
| Toggles de regras in-memory (rulesOverride) | ✅ | Começa vazio → bridge usa empresa+sistema |
| Bulk actions por seção | ✅ | Dropdown "Aplicar todos" por categoria |
| "Restaurar Padrões da Empresa" | ✅ | Preenche rulesOverride com estado empresa atual |
| "Restaurar Padrões do Sistema" | ✅ | Preenche rulesOverride com `status_sistema` |
| Bridge passa `rulesOverride` + `solveMode` + `maxTimeSeconds` | ✅ | `escalasService.gerar()` atualizado |
| System prompt: instrução sobre `rules_override` | ✅ | `system-prompt.ts` seção 6 |
| `SolverSessionConfig` interface exportada | ✅ | `solveMode`, `maxTimeSeconds`, `rulesOverride` |

**Não implementado (decisão 7.5 — backlog):**
- **Feedback Pós-Geração**: Métricas de aderência `[ 100% HARD | 80% SOFT ]` após geração. O backend retorna `violacoes[]`, mas não calcula nem exibe porcentagens de aderência. Requer: (1) validador computar `hard_count` / `hard_total` e `soft_count` / `soft_total`; (2) UI exibir badge de aderência no resultado. Adicionado ao backlog como **SPEC-07b**.

### Decisões Aplicadas

| # | Decisão | Resolução |
|---|---------|-----------|
| 7.1 | Modos de geração | **2 MODOS: Rápido + Tempo** (default 30s) — implementado. |
| 7.2 | Persistência | **POR GERAÇÃO** — in-memory, não persiste entre gerações. |
| 7.3 | Regras toggleáveis | **TODAS** — editáveis no drawer, travadas com lock icon. |
| 7.4 | Config para Python | **Dict granular** — `{ solve_mode, max_time_seconds, rules: {...} }`. |
| 7.5 | Feedback aderência | **NÃO IMPLEMENTADO** — backlog SPEC-07b. |
| 7.6 | Dois resets | **SIM** — "Empresa" e "Sistema" funcionando. |

---

### Problema Original (Histórico)
A Action Bar tem dropdowns hardcoded de speed/rigor que abstraem demais. RH não tem controle granular quando o motor falha.

### Ação Necessária

#### 1. Remover Elementos Abstratos
- Remover dropdown "Rápido / Otimizado"
- Remover dropdown "Nível de Rigor"
- Manter botão "Gerar Escala"

#### 2. Ícone de Configuração e Drawer
- Botão de configurações (ex: `Settings2`) **do lado esquerdo** do "Gerar Escala"
- Abre `<Sheet>` na direita: **Modo de Geração e Parâmetros**

#### 3. Estratégia de Geração (Topo do Drawer)
**2 modos apenas:**
- **Rápido:** Primeira solução válida (CP-SAT: `StopAfterFirstSolution=true`)
- **Tempo:** Otimiza dentro de N segundos (CP-SAT: `max_time_in_seconds=N`, default 30s)

#### 4. Controle Granular de Regras
O Drawer carrega os **defaults da empresa** (SPEC-02B) e permite override por-geração:
- **SEÇÃO CLT:** Regras travadas com cadeado + regras flexíveis com toggle HARD/SOFT/OFF
- **SEÇÃO Anti-Patterns:** Toggle ON/OFF por antipattern
- **SEÇÃO Soft/Preferências:** Toggle SOFT/OFF por preferência
- **Dropdown Master** por seção para mudar grupo inteiro de uma vez

#### 5. Dois Botões de Reset
- **"Restaurar Padrões da Empresa"** → volta ao que está persistido em `regra_empresa` (SPEC-02B)
- **"Restaurar Padrões do Sistema"** → volta ao factory reset (`regra_definicao.status_sistema`)

#### 6. Feedback Pós-Geração
Métricas de aderência: **[ 100% HARD | 80% SOFT ]**
- Porcentagem de constraints hard atendidas
- Porcentagem de soft preferences respeitadas
- Lista de violações com código e explicação

### Decisões Tomadas

| # | Decisão | Resolução |
|---|---------|-----------|
| 7.1 | Modos de geração | **2 MODOS: Rápido + Tempo** (default 30s). |
| 7.2 | Persistência | **POR GERAÇÃO** — defaults da `/regras`, não salva entre gerações. |
| 7.3 | Regras toggleáveis | **TODAS** (exceto travadas). Status: `HARD`/`SOFT`/`OFF`. |
| 7.4 | Config para Python | **Dict granular** — `{ strategy, max_time_seconds, rules: {...} }`. |
| 7.5 | Feedback | **Métricas de aderência** + lista de violações. |
| 7.6 | Dois resets | **SIM** — "Empresa" (banco) e "Sistema" (factory). |

### Entregáveis
- Componente `SolverConfigDrawer` com seções CLT, AP, Soft
- Limpeza da Action Bar (remover dropdowns hardcoded)
- 2 botões de reset (empresa + sistema)
- Bridge TS refatorada: `{ strategy, max_time_seconds, rules: {...} }`
- Python solver: cada `add_*()` condicional ao status da regra
- Métricas de aderência no resultado

---

<a id="spec-06"></a>
## SPEC-06: Atualização do Tour "Como Funciona"

### Problema Atual
Com as mudanças de SPEC-01 a SPEC-07, os steps do tour ficarão desatualizados.

### Ação
1. Mapear steps atuais do `TourProvider`
2. Atualizar textos para incluir IA no header, página /regras, etc.
3. Atualizar seletores (IDs de elementos que mudaram)
4. Step novo para o botão do Assistente IA

### Entregáveis
- Steps do tour atualizados
- Componente `TourSetup` ajustado
- Teste manual completo

---

## PRIORIZAÇÃO E SPRINTS

| Sprint | Spec | Prioridade | Peso | Status |
|--------|------|-----------|------|--------|
| **S1** | SPEC-01 + SPEC-03 | P0 | Leve | **CONCLUIDO** |
| **S2** | SPEC-02A | P1 | Leve — reorganizar sidebar/routing/cleanup | **CONCLUIDO** |
| **S3** | SPEC-04 | P1 | Média — schema + IPC + Zustand + UI interna | **CONCLUIDO** |
| **S4** | SPEC-02B | P1 | **PESADA** — engine de regras, schema, seed, IPC, UI /regras | **CONCLUIDO** |
| **S5** | SPEC-07 | P2 | **PESADA** — Drawer + bridge refactor + Python refactor | **CONCLUIDO** (7.5 → backlog) |
| **S6** | SPEC-05 | P2 | Média — tools, system prompt, validações IA | Pendente |
| **S7** | SPEC-06 | P3 | Leve — tour update (ÚLTIMA) | Pendente |

**Nota:** S4 (SPEC-02B) e S5 (SPEC-07) são o "bloco motor" — compartilham a mesma refatoração do Python solver e da bridge. Devem ser feitos em sequência: 02B cria a engine, 07 consome no Drawer.

**Nota:** SPEC-04 tem spec detalhada em [`docs/SPEC-04-historico-chat-ia.md`](./SPEC-04-historico-chat-ia.md) com schema, IPC, store, componentes e diagramas PlantUML.

---

## DEPENDÊNCIAS

```
SPEC-01 (fix chat) ──────────────────┐
SPEC-03 (remove icon) ──────────────┐│
                                     ││
                                     ▼▼
SPEC-02A (reorg nav) ──────────► SPEC-04 (histórico chats)
      │                              │
      ▼                              ▼
SPEC-02B (rules engine) ◄──── SPEC-05 (capabilities IA)
      │
      ▼
SPEC-07 (drawer motor) ──────► SPEC-06 (tour — ÚLTIMA)
```

- **S1** (01+03): Independentes, desbloqueiam tudo
- **S2** (02A): Reorganiza routing — precisa estar pronto antes de 02B
- **S3** (04): Precisa do chat fixo (S1), independente de 02B
- **S4** (02B): Cria engine de regras — **bloqueia** S5 (SPEC-07)
- **S5** (07): Consome engine de regras no Drawer
- **S6** (05): Precisa de 02B (regras) para saber o que a IA pode configurar
- **S7** (06): Última — depende de tudo

---

## NOTAS PARA A IA QUE VAI IMPLEMENTAR

1. **App Electron** — React + shadcn/ui + Tailwind + Zustand + SQLite (better-sqlite3)
2. **Motor** — OR-Tools via Python bridge (solver-bridge.ts → stdin/stdout JSON)
3. **Sidebar** — shadcn `Sidebar` com `collapsible="icon"`
4. **Estado IA** — Zustand (`useIaStore`)
5. **API IA** — REST direto ao Gemini (fetch puro, sem SDK)
6. **Tools IA** — `src/main/ia/tools.ts`, executam SQL diretamente
7. **Tipos** — `src/shared/types.ts`
8. **Prioridades** — funcional > bonito, nativo shadcn > custom, sem over-engineering

### Arquivos-chave
- `src/renderer/src/App.tsx` — Layout principal
- `src/renderer/src/componentes/AppSidebar.tsx` — Sidebar esquerda
- `src/renderer/src/componentes/IaChatPanel.tsx` — Painel de chat IA
- `src/renderer/src/componentes/PageHeader.tsx` — Header sticky
- `src/renderer/src/paginas/EmpresaConfig.tsx` — Config (a ser desmembrada)
- `src/renderer/src/estado/iaStore.ts` — State global do chat
- `src/main/ia/cliente.ts` — Backend Gemini
- `src/main/ia/tools.ts` — Tools da IA
- `src/main/ia/system-prompt.ts` — System prompt
- `src/main/db/schema.ts` — Schema SQLite
- `src/main/db/seed.ts` — Seed de dados iniciais
- `src/main/tipc.ts` — IPC handlers (77+)
- `src/main/motor/solver-bridge.ts` — Bridge TS → Python
- `src/main/motor/validador.ts` — Validador pós-geração
- `solver/solver_ortools.py` — Solver Python (constraints)
- `solver/constraints.py` — Funções de constraint individuais
- `src/shared/constants.ts` — CLT constants, AP weights

---

*Todas as decisões resolvidas em 2026-02-21. Documento pronto para implementação sprint-a-sprint.*
