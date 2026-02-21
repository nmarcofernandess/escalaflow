# PRD — EscalaFlow: IA, Configurações e Capacidades
**Versão:** 1.0  
**Data:** 2026-02-21  
**Status:** RASCUNHO — Pendente decisões do Operador  

---

## CONTEXTO

O EscalaFlow é um app Electron de gestão de escalas com sidebar shadcn, motor OR-Tools, e um Assistente IA recém-integrado via Gemini. Este PRD cobre 5 frentes de melhoria que precisam ser planejadas, divididas em specs e executadas em sequência.

---

## ÍNDICE

1. [SPEC-01: Chat IA — Posicionamento Correto (tipo Sidebar)](#spec-01)
2. [SPEC-02: Reorganização da Página de Configurações](#spec-02)
3. [SPEC-03: Remoção do Ícone IA da Sidebar](#spec-03)
4. [SPEC-04: Sistema de Histórico de Chats da IA](#spec-04)
5. [SPEC-05: Mapa de Capacidades da IA para RH](#spec-05)
6. [SPEC-06: Atualização do Tour "Como Funciona"](#spec-06)

---

<a id="spec-01"></a>
## SPEC-01: Chat IA — Posicionamento Correto

### Problema Atual
O painel de chat da IA está scrollando junto com a content area. Ele deveria estar **fixo** na tela igual a sidebar esquerda — ocupando 100% da altura da viewport, com scroll APENAS dentro da área de mensagens.

Tentativas anteriores (flex-row com `h-svh`, `h-full`, `overflow-hidden`) não resolveram porque conflitam com a forma que o `SidebarInset` do shadcn gerencia o layout.

### Investigação Necessária

#### Pergunta 1: O shadcn tem blocos/exemplos de dual-sidebar ou "sidebar + chat panel"?
- Verificar a documentação do shadcn em `https://ui.shadcn.com/docs/components/sidebar`
- Procurar por exemplos com `side="right"` e como o `SidebarProvider` gerencia dois `Sidebar` components
- Verificar se existe exemplo de "AI chat panel" ou "assistant sidebar" nos blocos do shadcn (`https://ui.shadcn.com/blocks`)

#### Pergunta 2: Deveria ser um segundo `<Sidebar side="right">`?
- O `Sidebar` do shadcn aceita `side="right"` e `collapsible="icon" | "offcanvas" | "none"`
- MAS: dois Sidebars no mesmo `SidebarProvider` compartilham o contexto `open/setOpen`, o que gera conflito
- **Solução possível:** Dois `SidebarProvider` aninhados (um para cada sidebar) ou gerenciar o right sidebar via state externo (Zustand, que já temos)

#### Pergunta 3: Ou deve ser um painel customizado com posicionamento fixo?
- `position: sticky` ou `position: fixed` com cálculo de offset da sidebar esquerda
- Ou CSS `display: grid` com `grid-template-columns: 1fr auto` dentro do SidebarInset

### Direção Sugerida
Usar um segundo `<Sidebar side="right" collapsible="offcanvas">` com `SidebarProvider` dedicado gerenciado pelo `useIaStore`. Isso dá:
- Collapse/expand nativo do shadcn (animação, acessibilidade, keyboard shortcuts)
- O painel fica fixo na viewport (o Sidebar do shadcn já faz isso)
- O `SidebarInset` se ajusta automaticamente entre os dois sidebars

### Decisões em Aberto
- [ ] Usar segundo `SidebarProvider` ou gerenciar via Zustand com CSS custom?
- [ ] O painel deve ter `collapsible="offcanvas"` (some completamente) ou `collapsible="icon"` (mostra ícone quando fechado)?
- [ ] Largura fixa (380px) ou redimensionável pelo usuário?

### Entregáveis
- Painel de chat fixo na viewport, sem scrollar com a content area
- Scroll interno apenas na área de mensagens
- Header do chat e input field sempre visíveis
- Resize do conteúdo central ao abrir/fechar o chat

---

<a id="spec-02"></a>
## SPEC-02: Reorganização da Página de Configurações

### Problema Atual
A página de Empresa/Configurações (`/empresa`) está poluída com muitas seções misturadas:
- Dados da empresa
- Período semanal (corte)
- Intervalo de almoço da CCT (over-engineering para agora)
- Piso operacional (não deveria mais existir)
- Calendário de feriados
- Tema e aparência
- Assistente IA
- Atualização do sistema
- Regras trabalhistas (CLT)

### Reorganização Proposta

#### A. Sidebar — Itens de Navegação Direta

| Item | Rota | Descrição |
|------|------|-----------|
| Dashboard | `/` | Já existe |
| Setores | `/setores` | Já existe |
| Colaboradores | `/colaboradores` | Já existe |
| Escalas | `/escalas` | Já existe |
| **Tipos de Contrato** | `/tipos-contrato` | Já existe (seção Configuração) |
| **Calendário de Feriados** | `/feriados` | **MOVER** para página própria na sidebar |
| **Regras da Empresa** | `/regras` | **NOVA PÁGINA** — ver detalhamento abaixo |

#### B. Dropdown do Usuário (Footer da Sidebar)

| Item | Ação | Detalhamento |
|------|------|-------------|
| **Empresa** | Abre modal/página `/empresa` | Dados da empresa: nome, CNPJ, telefone, cidade, logo/ícone. **INCLUI:** horários de abertura/fechamento de cada dia da semana (segunda a domingo). Esses horários são o fallback geral — setores podem dar override. |
| **Configurações** | Abre `/configuracoes` | Tema/aparência, Assistente IA (provider, modelo, API key), Atualizações do sistema |
| Tema (submenu) | Quick switch | Manter submenu light/dark/system (atalho rápido) |
| Como Funciona? | Inicia tour | Já existe |
| Sobre | Info | Já existe |

#### C. O que REMOVER
- ❌ **Piso operacional** — Não deveria mais existir. A demanda é definida no "quantidade por horário" do setor. Remover do schema e UI.
- ❌ **Intervalo de almoço CCT** — Over-engineering. Usar apenas CLT padrão. Se necessário no futuro, vai na página de Regras da Empresa.
- ❌ **Período semanal (corte)** — Decisão: manter apenas CLT? Ou é necessário definir corte? (perguntar ao operador)

#### D. Nova Página: Regras da Empresa (`/regras`)

Visão: Uma página dedicada que mostra TODAS as regras que o motor e a IA seguem. Divididas em categorias:

##### Seções:

**1. Regras HARD (Invioláveis - CLT)**
| Código | Regra | Editável? | Resetável? |
|--------|-------|-----------|------------|
| H1 | Descanso mínimo 11h entre jornadas | ❌ CLT fixa | — |
| H2 | Jornada máxima 10h/dia (8h + 2h extra) | ❌ CLT fixa | — |
| H3 | Máximo 44h semanais | ❌ CLT fixa | — |
| H4 | Mínimo 1 folga semanal (preferencialmente domingo) | ❌ CLT fixa | — |
| ... | (listar todas) | | |

**2. Regras SOFT (Preferências configuráveis)**
| Código | Regra | Editável? | Default |
|--------|-------|-----------|---------|
| S1 | Respeitar preferência de turno | ✅ On/Off | On |
| S2 | Rodízio justo de domingos | ✅ Frequência | Mulheres: 1:2, Homens: 1:3 |
| S3 | Distribuição equilibrada de carga | ✅ Peso | Normal |
| ... | (listar todas) | | |

**3. Anti-patterns (O que o motor NUNCA deve fazer)**
| Código | Regra | Descrição |
|--------|-------|-----------|
| AP1 | Não escalar mesmo funcionário 2x no dia | Proteção contra bug |
| AP2 | Não ignorar exceções registradas | Férias/atestado devem ser respeitados |
| ... | | |

**4. Horários de Funcionamento (Empresa)**
- Tabela editável: Dia da semana → Abertura → Fechamento → Ativo?
- Funciona como fallback. Setores podem sobrescrever.
- Se um setor não tem horários próprios, usa os da empresa.
- A IA usa esses horários como contexto para não pedir info redundante.

##### Funcionalidades da Página:
- ✅ Visualizar todas as regras em vigor
- ✅ Editar regras SOFT (toggle on/off, ajustar valores)
- ✅ Botão "Restaurar Padrões" para resetar SOFTs ao default
- ❌ Regras HARD não são editáveis (são lei)
- ✅ Tooltip explicando cada regra

### Decisões em Aberto
- [ ] Período semanal (corte): manter ou remover? É necessário para o cálculo de horas semanais?
- [ ] Horários de funcionamento ficam em `/empresa` (junto com dados da empresa) ou em `/regras` (junto com regras)?
- [ ] As regras SOFT devem ser por empresa ou por setor? (hoje parece ser global)
- [ ] "Regras da Empresa" deveria se chamar "Regras e Compliance"? Ou "Motor de Escalas"?

### Entregáveis
- Página `/empresa` simplificada (só dados + horários de funcionamento)
- Página `/configuracoes` nova (tema, IA, atualizações)
- Página `/feriados` extraída como página própria na sidebar
- Página `/regras` nova com todas as regras categorizadas
- Dropdown do usuário reorganizado
- Remoção do piso operacional e CCT

---

<a id="spec-03"></a>
## SPEC-03: Remoção do Ícone IA da Sidebar

### Problema
O botão "Assistente IA" está duplicado:
1. Na sidebar esquerda (item de navegação com `BrainCircuit`)
2. No header sticky (toggle com `BrainCircuit` / `PanelRightClose`)

Agora que o toggle está **sempre visível no header** (que é sticky), o item da sidebar é redundante.

### Ação
- Remover o `SidebarMenuItem` do "Assistente IA" do `AppSidebar.tsx`
- Manter o botão no `PageHeader.tsx` como forma primária de abrir/fechar
- Manter o atalho de teclado (se implementado no futuro, ex: `Cmd+J`)

### Decisões em Aberto
- [ ] Manter o item na sidebar quando estiver em modo `collapsible="icon"` (pois o header pode ficar apertado)?
- [ ] Adicionar atalho de teclado? (ex: `Cmd+J` = toggle IA, `Cmd+B` = toggle sidebar)

### Entregáveis
- Remover item "Assistente IA" da sidebar esquerda
- Verificar que o toggle do header funciona bem em todos os tamanhos de tela

---

<a id="spec-04"></a>
## SPEC-04: Sistema de Histórico de Chats da IA

### Problema Atual
O chat da IA tem apenas uma conversa ativa, sem histórico. Ao limpar, perde tudo. Não há como voltar a conversas anteriores.

### Modelo de Dados

```sql
CREATE TABLE ia_conversas (
  id TEXT PRIMARY KEY,              -- UUID
  titulo TEXT NOT NULL DEFAULT 'Nova conversa',
  status TEXT NOT NULL DEFAULT 'ativo',  -- 'ativo' | 'arquivado'
  criado_em TEXT NOT NULL DEFAULT (datetime('now')),
  atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE ia_mensagens (
  id TEXT PRIMARY KEY,              -- UUID
  conversa_id TEXT NOT NULL REFERENCES ia_conversas(id) ON DELETE CASCADE,
  papel TEXT NOT NULL,              -- 'usuario' | 'assistente' | 'tool_result'
  conteudo TEXT NOT NULL,
  timestamp TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### Fluxo de Nomeação
- Quando o usuário envia a **primeira mensagem** de uma conversa, a IA gera um título automaticamente
- Opção A: Pedir ao Gemini em uma chamada separada: "Dê um título curto (3-5 palavras) para esta conversa: [mensagem]"
- Opção B: Usar as primeiras ~50 chars da mensagem do usuário como título (mais simples, sem custo de API)
- O título pode ser editado manualmente pelo usuário

### UX — Painel de Histórico (Estilo Cursor)

Ao clicar em um botão de histórico no header do chat, abre um **sub-painel lateral** (ou dropdown expandido) com:

```
┌─────────────────────────────┐
│ 🔍 Buscar conversas...     │
├─────────────────────────────┤
│ ATIVAS                      │
│ [📌 Arquivar todos]         │
│                             │
│ • Escala Março Açougue  ···│  ← ··· abre menu: Arquivar / Renomear
│ • Conflito João Silva   ···│
│ • Folgas pendentes      ···│
│                             │
├─────────────────────────────┤
│ ▸ ARQUIVADAS (5)            │  ← Accordion, clicável pra expandir
│   [🗑 Limpar arquivadas]    │  ← Deleta TODAS arquivadas
│                             │
│   • Teste inicial       ···│  ← ··· abre menu: Restaurar / Deletar
│   • Debug solver        ···│
│   • ...                     │
└─────────────────────────────┘
```

### Ações no Chat Panel

| Elemento Atual | Novo Comportamento |
|---------------|-------------------|
| 🗑 Botão Lixo (limpar histórico) | Substituir por **➕ Novo Chat** |
| — | Adicionar botão **📋 Histórico** (abre o painel lateral descrito acima) |

### Ações por Conversa

| Status | Ações Disponíveis |
|--------|------------------|
| **Ativa** | Abrir · Renomear · Arquivar |
| **Arquivada** | Abrir (read-only?) · Restaurar · Deletar |

### Ações em Bulk

| Ação | Onde |
|------|------|
| Arquivar todas ativas | Botão no header da seção "Ativas" |
| Limpar todas arquivadas | Botão no header do accordion "Arquivadas" |

### Decisões em Aberto
- [ ] Nomeação automática: API call ao Gemini (custa tokens) ou primeiras palavras da mensagem (grátis)?
- [ ] Conversas arquivadas são read-only (não pode enviar novas mensagens) ou podem ser reativadas?
- [ ] O sub-painel de histórico é um segundo sidebar (estilo Cursor), um dropdown, ou um sheet?
- [ ] Busca: implementar busca full-text nas mensagens ou apenas no título?
- [ ] Limite de conversas armazenadas? Ou ilimitado?
- [ ] Persistir mensagens no SQLite ou manter em memória (Zustand) e só títulos no banco?

### Entregáveis
- Tabelas `ia_conversas` e `ia_mensagens` no SQLite
- IPC handlers: criar conversa, listar conversas, buscar, arquivar, deletar, renomear
- Zustand store atualizado com conceito de conversa ativa
- UI: botão "Novo Chat", painel de histórico, ações por conversa
- Auto-nomeação de conversas

---

<a id="spec-05"></a>
## SPEC-05: Mapa de Capacidades da IA para RH

### Objetivo
Mapear TODAS as operações que um profissional de RH pode pedir para a IA do EscalaFlow, verificar se o sistema tem UI sagas e gatilhos para atender, e garantir que o motor NÃO quebre em nenhum cenário — sempre dando fallback detalhado.

### Categorias de Pedidos

#### 1. CONSULTAS (Read-only)
| Pedido do RH | Tool IA | UI Saga Existente? | Motor? |
|-------------|---------|-------------------|--------|
| "Quantos colaboradores temos?" | `consultar(colaboradores)` | ❌ Não precisa | N/A |
| "Quem tá de férias esta semana?" | `consultar(excecoes, {tipo: 'FERIAS'})` | ❌ | N/A |
| "Mostra a escala do Açougue de março" | `consultar(escalas, {setor_id, periodo})` | ✅ Página de escala | N/A |
| "Quem trabalhou no último domingo?" | `consultar(escalas)` + filtro | ❌ | N/A |
| "Quantas horas o João fez esta semana?" | `consultar(escalas)` + cálculo | ❌ | N/A |
| "Tem violação na escala atual?" | `preflight` ou `consultar` | ✅ Validador | Motor |
| "Quais setores estão sem escala?" | `resumo_sistema` | ✅ Dashboard | N/A |

#### 2. GERAÇÃO DE ESCALAS
| Pedido do RH | Tool IA | UI Saga? | Motor? | Fallback? |
|-------------|---------|---------|--------|-----------|
| "Gera a escala do Açougue para março" | `gerar_escala` | ✅ | Motor OR-Tools | Deve retornar violações detalhadas se infeasible |
| "Gera todas as escalas do mês" | Loop `gerar_escala` por setor | ❌ Não existe batch | Motor | Falha parcial: reportar por setor |
| "Refaz a escala sem o João (ele saiu)" | `gerar_escala` após excecao | ✅ | Motor | — |

#### 3. AJUSTES MANUAIS
| Pedido do RH | Tool IA | UI Saga? | Motor? | Fallback? |
|-------------|---------|---------|--------|-----------|
| "Troca o João pelo Pedro na terça" | `ajustar_alocacao` | ✅ Drag-and-drop | Re-gerar com pin | Avisar se cria conflito |
| "Dá folga pro João na sexta" | `ajustar_alocacao(FOLGA)` | ✅ | — | Verificar se viola H1/H2 |
| "Fixa a Maria no turno da manhã" | `ajustar_alocacao` + pin | ✅ | Motor respeita pin | — |

#### 4. CADASTROS
| Pedido do RH | Tool IA | UI Saga? |
|-------------|---------|---------|
| "Cadastra novo funcionário: Ana, 44h, Açougue" | `criar(colaboradores, {...})` | ✅ Form |
| "Registra férias do Pedro de 01/03 a 15/03" | `criar(excecoes, {tipo: FERIAS})` | ✅ Form |
| "Adiciona feriado: Carnaval 04/03" | `criar(feriados, {...})` | ✅ Form |

#### 5. ANÁLISE E RELATÓRIOS
| Pedido do RH | Tool IA | Existe? | Necessário? |
|-------------|---------|---------|------------|
| "Quem mais trabalhou domingos este mês?" | `consultar` + cálculo | ❌ | ✅ Útil |
| "Tá equilibrado a distribuição de turnos?" | `consultar` + análise | ❌ | ✅ Útil |
| "Resumo geral do sistema" | `resumo_sistema` | ✅ | ✅ |
| "Compara a escala de fevereiro com janeiro" | `consultar` + diff | ❌ | 🟡 Nice-to-have |

#### 6. EXPLICAÇÕES
| Pedido do RH | Tool IA | Existe? |
|-------------|---------|---------|
| "Por que o João não pode trabalhar segunda?" | `explicar_violacao` + `consultar` | ✅ Parcial |
| "O que é regra H1?" | `explicar_violacao` | ✅ |
| "Por que a escala ficou infeasible?" | Precisa de log do solver | ❌ |

### Estratégia de Fallback do Motor

O motor **NUNCA** deve quebrar silenciosamente. Para cada cenário de falha:

```
┌────────────────────────────────────────────────────────────────┐
│ CENÁRIO DE FALHA          │ FALLBACK ESPERADO                  │
├────────────────────────────────────────────────────────────────┤
│ Infeasible (sem solução   │ Retornar QUAIS constraints         │
│ possível)                 │ conflitam e SUGESTÕES:             │
│                           │ "Colaborador X no Setor Y não tem  │
│                           │ horas suficientes. Sugestão:       │
│                           │ adicionar colaborador ou reduzir   │
│                           │ demanda no horário Z"              │
├────────────────────────────────────────────────────────────────┤
│ Conflito de hierarquia    │ "João (prioridade 2) conflita com  │
│ (dois colaboradores no    │ Maria (prioridade 1) no turno X.   │
│ mesmo slot)               │ A hierarquia favorece Maria.       │
│                           │ Deseja fixar João manualmente?"    │
├────────────────────────────────────────────────────────────────┤
│ Exceção não respeitada    │ "Pedro tem férias de 01/03 a       │
│                           │ 15/03 mas foi escalado em 05/03.   │
│                           │ Isso indica bug. Reportar."        │
├────────────────────────────────────────────────────────────────┤
│ Descanso 11h violado      │ "Ana fechou às 23h (dia X) e      │
│                           │ abriria às 07h (dia X+1). São 8h   │
│                           │ de descanso. CLT exige 11h.        │
│                           │ Sugestão: trocar turno de X+1      │
│                           │ para tarde ou dar folga."           │
├────────────────────────────────────────────────────────────────┤
│ Timeout do solver         │ Retornar melhor solução parcial    │
│                           │ encontrada + avisar que não é      │
│                           │ ótima. Permitir que o RH aceite    │
│                           │ ou peça nova tentativa com mais    │
│                           │ tempo.                              │
└────────────────────────────────────────────────────────────────┘
```

### Pipeline IA → Motor → IA → Humano

```
1. Humano pede: "Gera escala do Açougue pra março"
2. IA entende → chama tool `preflight(setor_id, datas)`
3. Preflight retorna: viável ou lista de problemas
4. SE viável:
   - IA chama `gerar_escala`
   - Motor resolve
   - IA apresenta resultado: "Escala gerada! 12 colaboradores, 0 violações hard, 2 soft warnings."
5. SE NÃO viável:
   - IA NÃO tenta gerar
   - IA explica: "Não é possível gerar porque: [lista de problemas]"
   - IA sugere: "Você pode: [ações possíveis]"
6. SE falha no motor:
   - Motor retorna fallback detalhado (ver tabela acima)
   - IA traduz pra linguagem humana
   - IA sugere próximos passos
```

### Decisões em Aberto
- [ ] O motor já retorna fallback detalhado ou precisa ser implementado?
- [ ] A IA deve fazer preflight automaticamente antes de gerar, ou gerar direto e lidar com o erro?
- [ ] Quais análises/relatórios são essenciais vs nice-to-have?
- [ ] A IA deve poder gerar escalas de TODOS os setores em batch?
- [ ] Limite de tool-calls por conversa? (pra não gastar tokens infinitos)
- [ ] Log do solver deve ser exposto para a IA explicar infeasibility?

---

<a id="spec-06"></a>
## SPEC-06: Atualização do Tour "Como Funciona"

### Problema Atual
O sistema possui um tour guiado (onboarding) interativo. Com a introdução do painel lateral fixo da IA (SPEC-01), a separação da página de Regras/Compliance (SPEC-02) e a remoção do ícone da barra lateral (SPEC-03), os steps do tour atual ficarão desatualizados ou apontarão para elementos que mudaram de lugar/não existem mais.

### Ação Necessária
1. Mapear os steps atuais do `TourProvider` (onde ele passa, quais IDs ele procura).
2. Atualizar os textos explicativos para incluir a existência do Assistente IA (que agora fica sempre acessível via header).
3. Atualizar os seletores do tour (ex: se ele manda clicar em "Configurações" para ver regras, agora ele deve referenciar "Regras e Compliance").
4. Criar um step específico para apresentar o botão do Assistente IA no Header.

### Entregáveis
- Arquivo de configuração de steps do tour atualizado.
- Componente `TourSetup` ou similar ajustado para os novos hooks/IDs de tela.
- Teste end-to-end (manual) passando por todo o tour após todas as outras SPECs estarem em `main`.

---

## PRIORIZAÇÃO SUGERIDA

| Spec | Prioridade | Justificativa |
|------|-----------|---------------|
| SPEC-01 | 🔴 P0 | Blocker de UX — chat inutilizável se não ficar fixo |
| SPEC-03 | 🟢 P0 | Trivial — 1 linha de código |
| SPEC-02 | 🟡 P1 | Organização necessária mas não bloqueia uso |
| SPEC-04 | 🟡 P1 | Histórico é essencial para uso real da IA |
| SPEC-05 | 🟠 P2 | Estratégico — define a capacidade do produto |
| SPEC-06 | 🔵 P3 | Fechamento — Deve ser a ÚLTIMA coisa a fazer após testar a nova organização |

---

## DEPENDÊNCIAS ENTRE SPECS

```
SPEC-01 (fix chat) ─────────────────┐
SPEC-03 (remove icon) ─────────────┐│
                                    ││
                                    ▼▼
SPEC-02 (reorg configs) ────────► SPEC-04 (histórico chats)
                                    │
                                    ▼
                              SPEC-05 (capabilities map)
                                    │
                                    ▼
                              SPEC-06 (atualiza tour)
```

- SPEC-01 e SPEC-03 são independentes e podem ser feitos primeiro
- SPEC-02 reorganiza a sidebar, o que afeta onde os itens ficam (pré-requisito para organizar o fluxo)
- SPEC-04 depende do chat estar funcionando (SPEC-01) e precisa de novas tabelas no banco
- SPEC-05 é uma análise que guia as melhorias do motor e das tools, pode ser feito em paralelo

---

## NOTAS PARA A IA QUE VAI PLANEJAR

1. **Este é um app Electron** com React + shadcn/ui + Tailwind + Zustand + SQLite (better-sqlite3).
2. **O motor de escalas** usa OR-Tools via Python bridge (solver-bridge.ts).
3. **A sidebar** usa o componente `Sidebar` nativo do shadcn com `collapsible="icon"`.
4. **O estado da IA** está em Zustand (`useIaStore`).
5. **A API da IA** é REST direta ao Gemini (sem SDK — fetch puro).
6. **As tools da IA** estão em `src/main/ia/tools.ts` e executam queries SQL diretamente.
7. **O sistema de tipos** está em `src/shared/types.ts`.
8. **O operador** (Marco) prioriza: funcional > bonito, nativo shadcn > custom, sem over-engineering.

### Arquivos-chave para contexto:
- `src/renderer/src/App.tsx` — Layout principal
- `src/renderer/src/componentes/AppSidebar.tsx` — Sidebar esquerda
- `src/renderer/src/componentes/IaChatPanel.tsx` — Painel de chat IA
- `src/renderer/src/componentes/PageHeader.tsx` — Header sticky com breadcrumb
- `src/renderer/src/paginas/EmpresaConfig.tsx` — Página de configurações (a ser desmembrada)
- `src/renderer/src/store/iaStore.ts` — State global do chat
- `src/main/ia/cliente.ts` — Backend: chamada ao Gemini
- `src/main/ia/tools.ts` — Definição e execução de tools
- `src/main/ia/system-prompt.ts` — System prompt da IA
- `src/main/db/schema.ts` — Schema do banco SQLite
- `src/main/tipc.ts` — Handlers IPC (router)
- `src/renderer/src/components/ui/sidebar.tsx` — Componente sidebar shadcn

---

## PERGUNTAS PARA O OPERADOR (antes de dividir em tasks)

### Sobre SPEC-02 (Configurações):
1. O **período semanal** (corte) é necessário? Podemos usar apenas CLT padrão (domingo a sábado)?
2. **Horários de funcionamento** da empresa devem ficar em `/empresa` ou `/regras`?
3. A palavra "Regras" é boa ou prefere "Compliance", "Motor", "Políticas"?

### Sobre SPEC-04 (Histórico):
4. Nomeação automática de chats: usar Gemini (custa tokens) ou primeiras palavras da mensagem (grátis)?
5. Conversas arquivadas podem ser reabertas para novas mensagens ou são read-only?
6. O painel de histórico deve ser um sub-sidebar (estilo Cursor) ou um dropdown?

### Sobre SPEC-05 (Capacidades):
7. O motor já tem fallback detalhado para infeasibility ou retorna apenas "falhou"?
8. A IA deve fazer `preflight` automático antes de qualquer `gerar_escala`?
9. Geração em batch (todos os setores de uma vez) é necessária agora?
