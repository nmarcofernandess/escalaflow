# PROMPT — Implementar IA Assistente no EscalaFlow

## Contexto do Projeto

Você vai implementar um **assistente de IA integrado** no EscalaFlow — um app desktop Electron para geração de escalas de trabalho com compliance CLT.

**Localização:** `/Users/marcofernandes/escalaflow`
**Stack:** Electron 34 + React 19 + Vite + shadcn/ui + Zustand + @egoist/tipc + SQLite (better-sqlite3) + Tailwind CSS + TypeScript strict

---

## FASE 1 — INVESTIGAÇÃO (faça isso antes de escrever uma linha de código)

Leia tudo abaixo na ordem. Não pule nada.

### 1.1 Documentação
```
/docs/MOTOR_V3_RFC.md          ← Fonte de verdade do motor de escalas
/docs/COMO_FAZER_RELEASE.md    ← Arquitetura de build
/docs/BUILD_V2_ESCALAFLOW.md   ← Arquitetura histórica
/specs/                        ← Specs de features existentes
```

### 1.2 Schema do banco
```
/src/main/db/schema.ts         ← DDL completo (entidades, relações, constraints)
/src/main/db/database.ts       ← Conexão e configuração SQLite
/src/main/db/seed.ts           ← Dados iniciais (entende os defaults)
```

### 1.3 IPC Handlers (o coração do sistema)
```
/src/main/tipc.ts              ← TODOS os 67 handlers IPC — leia inteiro
```
Para cada handler, entenda: o que recebe, o que faz, o que retorna.

### 1.4 Tipos compartilhados
```
/src/shared/types.ts           ← Todas as interfaces TypeScript
/src/shared/constants.ts       ← Constantes de negócio (CLT, contratos)
/src/shared/index.ts
```

### 1.5 Motor de escalas
```
/solver/solver_ortools.py      ← Motor Python OR-Tools
/solver/constraints.py         ← 42 regras CLT/CCT implementadas
/src/main/motor/solver-bridge.ts   ← Como Node invoca o Python
/src/main/motor/validador.ts       ← PolicyEngine de revalidação
```

### 1.6 Páginas e fluxo do usuário
```
/src/renderer/src/paginas/     ← Leia TODAS as 10 páginas
/src/renderer/src/componentes/ ← Leia os 26 componentes custom
/src/renderer/src/servicos/    ← Wrappers IPC do renderer
/src/renderer/src/estado/      ← Stores Zustand
```

### 1.7 Entry points
```
/src/main/index.ts             ← Bootstrap Electron
/src/preload/index.ts          ← contextBridge
/src/renderer/src/main.tsx     ← React root
/src/renderer/src/App.tsx      ← Router + layout
```

### 1.8 Componente de layout existente
Procure onde está o **breadcrumb/header** que aparece em todas as páginas. Entenda sua estrutura. O botão da IA vai viver ali.

---

## FASE 2 — O QUE IMPLEMENTAR

São 3 entregas independentes, nessa ordem:

### ENTREGA 1 — Configuração de API Key

**Onde:** Página `/empresa` (configurações globais) — adicione uma seção "Assistente IA".

**O que implementar:**
- Campo para escolher provider: `Gemini` | `Claude (Anthropic)` | `OpenAI`
- Campo de API Key (input type password, com botão mostrar/ocultar)
- Campo de modelo (ex: `gemini-2.0-flash`, `claude-haiku-4-5-20251001`)
- Botão "Testar conexão" que faz uma chamada simples e mostra sucesso/erro
- Salvar no banco SQLite (crie tabela `configuracao_ia` ou campo em `empresa`)
- IPC handler: `iaConfiguracaoSalvar`, `iaConfiguracaoObter`, `iaConfiguracaoTestar`

**Schema sugerido:**
```sql
CREATE TABLE IF NOT EXISTS configuracao_ia (
  id INTEGER PRIMARY KEY DEFAULT 1,
  provider TEXT NOT NULL DEFAULT 'gemini',  -- 'gemini' | 'anthropic' | 'openai'
  api_key TEXT NOT NULL DEFAULT '',
  modelo TEXT NOT NULL DEFAULT 'gemini-2.0-flash',
  ativo INTEGER NOT NULL DEFAULT 0,         -- 0 = não configurado
  criado_em TEXT NOT NULL DEFAULT (datetime('now')),
  atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
);
```

---

### ENTREGA 2 — System Prompt da IA (o "treinamento")

Baseado em TUDO que você leu na Fase 1, escreva o system prompt da IA que ficará hardcoded no processo main. Ele deve ensinar a IA:

**Seção 1 — Identidade**
```
Você é o assistente do EscalaFlow, especialista em escalas de trabalho e CLT.
Você tem acesso total ao sistema: pode consultar dados, cadastrar, editar,
gerar escalas e ajudá-la a chegar na escala perfeita sem violações CLT.
```

**Seção 2 — Domínio de negócio (você vai preencher com o que aprendeu)**
- O que é uma escala, como funciona o motor
- As regras CLT mais importantes (jornada, descanso, horas extras)
- O que são violações HARD vs SOFT
- Como interpretar os indicadores (cobertura_percent, equilibrio, violacoes_hard)
- O que é pinned_cell, por que usar
- O ciclo completo: configurar → gerar → ajustar → oficializar

**Seção 3 — Schema do banco (resumido)**
Liste as entidades principais e seus campos mais importantes para a IA saber o que perguntar/preencher.

**Seção 4 — Tools disponíveis**
Descreva cada tool com exemplos de quando usar.

**Seção 5 — Jornada da escala perfeita**
Guia passo a passo que a IA deve seguir quando o usuário quer gerar uma escala do zero:
1. Verificar se empresa está configurada
2. Verificar se há colaboradores no setor
3. Verificar se há demandas configuradas
4. Verificar se há exceções (férias, atestados) no período
5. Rodar preflight → identificar problemas antes de gerar
6. Gerar escala → interpretar resultado
7. Analisar violações → sugerir ajustes específicos
8. Ajustar com pinned cells → regerar
9. Checar indicadores → quando oficializar

Salve o system prompt em: `/src/main/ia/system-prompt.ts` (exporta como string)

---

### ENTREGA 3 — Chat Lateral

**Comportamento:**
- Painel lateral (drawer) que desliza da direita
- Largura: 380px (desktop), full width (< 768px)
- Abre/fecha com:
  - Clique num botão ✨ na área direita do breadcrumb/header de todas as páginas
  - Atalho `Cmd+L` (Mac) / `Ctrl+L` (Win/Linux)
- Persiste aberto ao navegar entre páginas (estado global Zustand)
- Não bloqueia a UI principal (não é modal)

**Interface do chat:**
- Header do painel: "Assistente IA" + badge com modelo em uso + botão fechar (X) + botão limpar conversa (🗑️)
- Área de mensagens com scroll automático para última
- Mensagem de boas-vindas inicial (quando sem histórico):
  ```
  Olá! Sou seu assistente de escalas. Posso gerar escalas,
  cadastrar colaboradores, explicar violações CLT e te guiar
  até a escala perfeita. Como posso ajudar?
  ```
- Bolhas de mensagem: usuário (direita, cor primária) e IA (esquerda, muted)
- Indicador de "digitando..." (três pontos animados) enquanto IA processa
- Input de texto com `Enter` para enviar, `Shift+Enter` para quebra de linha
- Botão enviar desabilitado enquanto IA processa
- Se provider não configurado: banner "Configure sua API Key em Empresa → Assistente IA" com link direto

**Estado Zustand (novo store `useIaStore`):**
```typescript
interface IaMensagem {
  id: string
  papel: 'usuario' | 'assistente' | 'tool_result'
  conteudo: string
  timestamp: string
  tool_calls?: ToolCall[]   // para exibir ações executadas
}

interface IaStore {
  aberto: boolean
  mensagens: IaMensagem[]
  processando: boolean
  toggle: () => void
  fechar: () => void
  limpar: () => void
  enviar: (texto: string) => Promise<void>
}
```

**Exibição de tool calls:**
Quando a IA executa uma ação, mostra um card compacto ANTES da resposta:
```
⚙️ Consultou colaboradores do setor Açougue → 8 encontrados
⚙️ Gerou escala semana 17-23/02 → OPTIMAL, cobertura 94%
⚙️ Criou colaborador "Maria Santos" → ID 42
```

---

## FASE 3 — TOOLS DA IA

Implemente no processo main (`/src/main/ia/tools.ts`). São as funções que a IA pode chamar. Mapeiam para os handlers IPC existentes ou chamam o banco diretamente.

```typescript
// Tools que a IA pode invocar
const TOOLS = [
  {
    name: "consultar",
    description: "Consulta dados do sistema. Use para buscar colaboradores, setores, escalas, exceções, demandas, contratos, feriados.",
    parameters: {
      entidade: "colaboradores | setores | escalas | excecoes | demandas | contratos | empresa | violacoes | feriados | funcoes",
      filtros: "objeto opcional com filtros (ex: { setor_id: 2, ativo: true })"
    }
  },
  {
    name: "criar",
    description: "Cria um novo registro no sistema.",
    parameters: {
      entidade: "colaborador | excecao | demanda | contrato | setor | feriado | funcao",
      dados: "objeto com os campos necessários para criação"
    }
  },
  {
    name: "atualizar",
    description: "Atualiza um registro existente.",
    parameters: {
      entidade: "colaborador | empresa | contrato | setor | demanda",
      id: "ID do registro",
      dados: "objeto com os campos a atualizar"
    }
  },
  {
    name: "deletar",
    description: "Remove um registro.",
    parameters: {
      entidade: "excecao | demanda | feriado | funcao",
      id: "ID do registro"
    }
  },
  {
    name: "gerar_escala",
    description: "Gera escala para um setor em um período. Usa o motor OR-Tools com todas as regras CLT.",
    parameters: {
      setor_id: "ID do setor",
      data_inicio: "YYYY-MM-DD",
      data_fim: "YYYY-MM-DD"
    }
  },
  {
    name: "ajustar_alocacao",
    description: "Fixa (pina) uma alocação específica e regenera. Use para resolver violações pontuais.",
    parameters: {
      escala_id: "ID da escala",
      colaborador_id: "ID do colaborador",
      data: "YYYY-MM-DD",
      tipo: "TRABALHO | FOLGA | INDISPONIVEL"
    }
  },
  {
    name: "oficializar_escala",
    description: "Oficializa a escala, tornando-a definitiva. Só use quando todas as violações HARD estiverem zeradas.",
    parameters: {
      escala_id: "ID da escala"
    }
  },
  {
    name: "preflight",
    description: "Verifica se o setor está pronto para gerar escala. Identifica problemas antes de tentar gerar.",
    parameters: {
      setor_id: "ID do setor",
      data_inicio: "YYYY-MM-DD",
      data_fim: "YYYY-MM-DD"
    }
  },
  {
    name: "resumo_sistema",
    description: "Retorna visão geral do sistema: total de colaboradores, setores, escalas abertas, alertas pendentes.",
    parameters: {}
  },
  {
    name: "explicar_violacao",
    description: "Explica em linguagem simples o que significa uma violação CLT específica e como resolver.",
    parameters: {
      codigo_regra: "Ex: H3, S2, AP7",
      contexto: "objeto com dados da alocação envolvida (opcional)"
    }
  }
]
```

---

## FASE 4 — INTEGRAÇÃO COM API (processo main)

Crie `/src/main/ia/cliente.ts`:

```typescript
// Suporta Gemini, Anthropic e OpenAI (mesma interface)
// Carrega config do banco
// Executa loop de tool use:
//   1. Envia mensagem + histórico + tools para a API
//   2. Se response tem tool_calls → executa tools → adiciona resultado → volta pro 1
//   3. Se response é texto final → retorna
// Timeout de 60s por chamada
// Retry com backoff em rate limit (429)
```

IPC handler novo: `iaEnviarMensagem(input: { mensagem: string, historico: IaMensagem[] })` → `{ resposta: string, acoes: ToolCall[] }`

---

## REGRAS DE IMPLEMENTAÇÃO

1. **Siga os padrões existentes:** Leia como outros componentes usam shadcn/ui, tipc, Zustand. Não invente padrão novo.
2. **TypeScript strict:** Zero `any`. Tipar tudo.
3. **Não quebre nada:** A feature é aditiva. Nenhuma página existente deve ser modificada além do header/breadcrumb (apenas adicionando o botão).
4. **Dark mode:** O drawer deve funcionar perfeitamente em dark mode (o app já tem tema completo).
5. **Sem dependências novas desnecessárias:** Para o cliente HTTP use `node-fetch` ou o nativo do Node 18+. Para o chat use componentes shadcn/ui já instalados.
6. **Erro claro ao usuário:** Se a API key for inválida, mostrar mensagem clara no chat, não crash silencioso.

---

## ENTREGÁVEIS FINAIS

```
/src/main/ia/
  system-prompt.ts      ← System prompt completo da IA
  tools.ts              ← Definição e implementação das 10 tools
  cliente.ts            ← Cliente HTTP multi-provider com tool use loop

/src/renderer/src/
  estado/ia.ts          ← useIaStore (Zustand)
  componentes/
    IaDrawer.tsx         ← Painel lateral completo
    IaMensagem.tsx       ← Bolha de mensagem
    IaToolCard.tsx       ← Card de ação executada

/src/main/tipc.ts       ← Adicionar: iaEnviarMensagem, iaConfiguracaoSalvar,
                                       iaConfiguracaoObter, iaConfiguracaoTestar
/src/main/db/schema.ts  ← Adicionar: tabela configuracao_ia
```

---

## VERIFICAÇÃO FINAL

Antes de considerar pronto, teste esses fluxos manualmente:

- [ ] Abre o chat com Cmd+L
- [ ] Chat mostra banner "configure API key" quando não configurado
- [ ] Salva API key em Empresa → Assistente IA
- [ ] "Testar conexão" funciona e mostra sucesso
- [ ] Chat abre com boas-vindas
- [ ] "Quais colaboradores estão no setor Caixa?" → lista correta
- [ ] "Cadastra João Silva no setor Açougue com contrato 44h" → cria e confirma
- [ ] "Gera a escala do Caixa para a semana de 24/02 a 02/03" → gera e descreve resultado
- [ ] "Tem violações?" → explica o que está quebrando e sugere ajuste
- [ ] "Fixa folga da Maria na sexta" → executa ajuste e regenera
- [ ] "Pode oficializar?" → verifica e oficializa (ou avisa por que não pode)
- [ ] Chat permanece aberto ao navegar entre páginas
- [ ] Funciona em dark mode
- [ ] Funciona em light mode
