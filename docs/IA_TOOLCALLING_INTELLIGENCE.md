# IA TOOL CALLING — DOCUMENTO DE INTELIGÊNCIA MÁXIMA

**Data:** 2026-02-21
**Contexto:** EscalaFlow — Gemini API + Electron + SQLite
**Objetivo:** Fazer a IA mais burra possível operar sem cometer erros, sem mostrar erros ao usuário, sem perguntar o que pode buscar.

---

## PARTE 1 — OS PATTERNS (O QUE APRENDEMOS)

### 1.1 Discovery Explícito (Neural Pattern)

**Discovery implícito (ruim):** contexto no system prompt como string markdown. IA pode ignorar, markdown é ambíguo.

**Discovery explícito (bom):** tool `get_context()` obrigatória como primeira chamada. JSON estruturado é inequívoco, tool call é ação forçada.

```
Resultado medido:
Discovery implícito  → ~50% de compliance (IA pergunta IDs)
Discovery explícito  → ~95% de compliance (IA descobre sozinha)
```

### 1.2 Tool Use Examples (Anthropic, 2025)

Adicionar exemplos concretos `input → output` diretamente na description da tool, não só no system prompt.

```
Resultado medido (Anthropic):
Sem examples → 72% de acerto em parâmetros complexos
Com examples → 90% de acerto (+18 pontos percentuais)
```

### 1.3 Mensagens de Erro como Instrução (não como erro)

Erros retornados pelas tools devem ser escritos **para a IA**, não para o usuário. O erro deve:
1. Dizer exatamente o que estava errado
2. Dizer exatamente o que fazer em seguida
3. Nunca chegar visível ao usuário

```typescript
// RUIM — erro técnico que a IA não sabe resolver:
return { erro: "NOT NULL constraint failed: excecoes.colaborador_id" }

// BOM — instrução disfarçada de erro:
return {
  erro: "Campo obrigatório ausente: colaborador_id (number). " +
        "Chame get_context() para obter o ID pelo nome do colaborador."
}
```

### 1.4 JSON Schema como Força Comportamental

O schema JSON da tool declaration **ensina a IA antes de ela errar**. Usar `enum`, `pattern`, `description` detalhada.

```typescript
// RUIM — IA adivinha o valor:
tipo: { type: 'string', description: 'Tipo da exceção' }

// BOM — IA só pode escolher valores válidos:
tipo: {
  type: 'string',
  enum: ['FERIAS', 'ATESTADO', 'BLOQUEIO'],
  description: 'FERIAS = período de férias anuais | ATESTADO = afastamento médico | BLOQUEIO = indisponibilidade avulsa'
}
```

### 1.5 Consolidação de Tools (Anthropic)

> "More tools don't always lead to better outcomes."

Tools genéricas que exigem conhecimento de schema → tools semânticas que recebem linguagem natural e resolvem internamente.

```
RUIM:
consultar("excecoes", { colaborador_id: 5 })   ← IA precisa saber tabela + campo
consultar("colaboradores", { nome: "Maria" })  ← IA precisa saber que tabela é "colaboradores"

BOM:
buscar_colaborador("Maria")  ← retorna tudo com JOINs prontos
```

### 1.6 Retorno Semântico, Nunca IDs Crus

> "Resolver IDs para linguagem semanticamente significativa melhora dramaticamente a precisão."

```typescript
// RUIM — IA recebe ID e precisa resolver:
{ id: 3, setor_id: 2, tipo_contrato_id: 1 }

// BOM — IA recebe dados prontos:
{ id: 3, nome: "João Silva", setor: "Caixa", contrato: "CLT 44h", horas_semanais: 44 }
```

### 1.7 Loop Multi-Turn é Automático — Não Precisa Controlar Micro

A IA (Gemini) decide sozinha quando chamar mais tools e quando parar e responder em texto.
O app já implementa o loop corretamente: executa tool → devolve resultado → Gemini continua.
**Não precisa controlar micro.** O que controla é:
- A `description` da tool (quando usar)
- O system prompt (ordem e workflow)
- As mensagens de erro (o que fazer quando errar)
- O schema (quais valores são válidos)

```
Loop atual (MAX_TURNS = 10):
  Turn 1: Gemini chama get_context()
  Turn 2: Gemini chama consultar(...)
  Turn 3: Gemini não tem mais tool calls → retorna texto
```

---

## PARTE 2 — ANÁLISE DO ESTADO ATUAL

### ✅ O que está bom

| Item | Status | Detalhe |
|------|--------|---------|
| `get_context()` com discovery explícito | ✅ | Pattern Neural implementado — JSON estruturado com todos os IDs |
| Loop multi-turn (MAX_TURNS=10) | ✅ | Gemini pode fazer múltiplas tool calls antes de responder |
| System prompt com exemplos práticos | ✅ | 4 exemplos de workflow, inclui caso de nome não encontrado |
| Regra de erro no system prompt | ✅ | "NUNCA mostre erro ao usuário, leia e corrija" |
| Auto-contexto via `buildContextBriefing` | ✅ | Injeta setor/colaborador da página atual no system prompt |
| Mensagens de erro guiadas em `consultar` | ✅ | Retorna lista de entidades válidas quando erra tabela |
| Discovery da página atual | ✅ | Colaboradores, demandas, escala da página já no contexto |

### ❌ O que está fraco

| Problema | Impacto | Localização |
|----------|---------|-------------|
| `consultar` sem enum nos parâmetros | IA adivinha nome de tabela e campo | `tools.ts` — schema do `consultar` |
| `criar` retorna erro SQL raw | IA não sabe o que fazer ao criar com campo errado | `tools.ts` — handler do `criar` |
| `criar` sem enum nos campos de valor fixo | IA pode enviar `"ferias"` em vez de `"FERIAS"` | `tools.ts` — schema do `criar` |
| `ajustar_alocacao` sem enum no `status` | IA pode enviar "Folga" em vez de "FOLGA" | `tools.ts` — schema do `ajustar_alocacao` |
| `criar` sem guia de data format | IA pode enviar "10/03/2026" em vez de "2026-03-10" | `tools.ts` — description do campo |
| Sem `buscar_colaborador` semântico | IA usa `consultar` genérico e pode errar campos | `tools.ts` — falta tool |
| Erros de constraint SQL chegam como `{ erro: "message" }` genérico | IA trava sem saber o que fazer | `tools.ts` — handlers de criar/atualizar |
| `consultar(excecoes)` exige saber `colaborador_id` | IA precisa resolver nome → ID antes | `tools.ts` — falta tool semântica |

---

## PARTE 3 — O QUE O RH VAI PEDIR

### Mapeamento completo: intenção → tool calls → onde a IA burra erra

---

#### 3.1 "Me dá as infos da Cleunice"

**Fluxo esperado:**
```
get_context() → encontra colaborador "Cleunice" (id=12) →
consultar("excecoes", { colaborador_id: 12 }) → responde
```

**Onde a IA burra erra:**
- Tenta `consultar("colaboradores", { nome: "Cleunice" })` → retorna `setor_id: 2` sem nome do setor → segunda chamada extra
- Tenta `consultar("funcionarios", ...)` → erro de entidade inválida

**Tratamento atual:**
- Erro de entidade inválida: retorna `{ erro: "Entidade 'funcionarios' não permitida. Use: colaboradores | setores | ..." }` ✅
- Retorno sem join: IA recebe `setor_id: 2` e não sabe o nome ❌

**Solução:** Tool `buscar_colaborador(nome)` que retorna tudo com joins prontos.

---

#### 3.2 "Quantas pessoas tem no Caixa?"

**Fluxo esperado:**
```
get_context() → encontra setor "Caixa" com colaboradores_count: 15 → responde direto
```

**Onde a IA burra erra:**
- Raro — get_context() já retorna `colaboradores_count` por setor ✅

**Tratamento atual:** ✅ Coberto pelo get_context().

---

#### 3.3 "A Maria tá de férias quando?"

**Fluxo esperado:**
```
get_context() → encontra "Maria" (id=8) →
consultar("excecoes", { colaborador_id: 8 }) → filtra tipo=FERIAS → responde
```

**Onde a IA burra erra:**
- Tenta `consultar("ferias", ...)` → erro de entidade inválida
- Tenta `consultar("excecoes", { nome: "Maria" })` → campo `nome` não existe em excecoes

**Tratamento atual:**
- `{ erro: "Entidade 'ferias' não permitida..." }` ✅
- Filtro `nome` inválido: retorna erro SQL raw ❌

**Solução:** Validar filtros antes do SQL. Retornar `{ erro: "Campo 'nome' inválido para entidade excecoes. Campos válidos: colaborador_id, tipo, data_inicio, data_fim" }`.

---

#### 3.4 "Adiciona férias da Maria de 10 a 20 de março"

**Fluxo esperado:**
```
get_context() → encontra "Maria" (id=8) →
criar("excecoes", { colaborador_id: 8, data_inicio: "2026-03-10", data_fim: "2026-03-20", tipo: "FERIAS" })
```

**Onde a IA burra erra:**
- `tipo: "ferias"` (minúsculo) → SQLite CHECK constraint falha → erro raw
- `data_inicio: "10/03/2026"` → formato errado → erro de data
- `data_inicio: "10 de março"` → erro
- Esquece o `colaborador_id` → NOT NULL constraint

**Tratamento atual:** Erro SQL raw chega como `{ erro: "CHECK constraint failed: excecoes" }` — IA não sabe o que fazer ❌

**Solução necessária (alta prioridade):**
```typescript
// Schema com enum e pattern:
tipo: { type: 'string', enum: ['FERIAS', 'ATESTADO', 'BLOQUEIO'] }
data_inicio: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'Formato: YYYY-MM-DD' }

// Validação antes do SQL com mensagem guiada:
if (!['FERIAS', 'ATESTADO', 'BLOQUEIO'].includes(dados.tipo)) {
  return { erro: `Tipo '${dados.tipo}' inválido. Use exatamente: FERIAS | ATESTADO | BLOQUEIO` }
}
if (dados.colaborador_id == null) {
  return { erro: "colaborador_id obrigatório. Chame get_context() para obter o ID pelo nome do colaborador." }
}
```

---

#### 3.5 "Gera escala do açougue pra março"

**Fluxo esperado:**
```
get_context() → encontra "Açougue" (id=5) →
preflight({ setor_id: 5, data_inicio: "2026-03-01", data_fim: "2026-03-31" }) →
gerar_escala({ setor_id: 5, data_inicio: "2026-03-01", data_fim: "2026-03-31" })
```

**Onde a IA burra erra:**
- Calcula data_fim errada (31 de março vs 30 de março) — Gemini às vezes erra dias do mês
- Pula o preflight e vai direto para gerar → escala inviável sem aviso prévio

**Tratamento atual:**
- Erros de data: solver retorna INFEASIBLE → IA explica ✅ (funciona mesmo errando)
- Pular preflight: funciona, mas perde warnings importantes

**Solução:** System prompt já instrui preflight antes. Suficiente. ✅

---

#### 3.6 "Muda a Maria pra folga no dia 15 de março"

**Fluxo esperado:**
```
get_context() → encontra "Maria" (id=8) + escala do setor (id=42) →
ajustar_alocacao({ escala_id: 42, colaborador_id: 8, data: "2026-03-15", status: "FOLGA" })
```

**Onde a IA burra erra:**
- `status: "folga"` (minúsculo) → validação atual é string, não enum → passa e atualiza errado no banco
- `data: "15/03/2026"` → formato errado → UPDATE não acha registro
- Não sabe qual `escala_id` usar se houver mais de uma escala do setor

**Tratamento atual:** Status é validado (`statusValidos.includes(status)`) ✅ mas retorna `{ erro: "Status 'folga' inválido. Use: TRABALHO | FOLGA | INDISPONIVEL" }` — bom, mas o enum no schema previne antes ❌

**Solução:**
```typescript
// Schema:
status: { type: 'string', enum: ['TRABALHO', 'FOLGA', 'INDISPONIVEL'] }
data: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' }
```

---

#### 3.7 "Cria o colaborador João Silva, CLT 44h, no Caixa"

**Fluxo esperado:**
```
get_context() → encontra setor "Caixa" (id=3) e tipo_contrato "CLT 44h" (id=1) →
criar("colaboradores", { nome: "João Silva", setor_id: 3, tipo_contrato_id: 1, sexo: "M", horas_semanais: 44 })
```

**Onde a IA burra erra:**
- Não sabe o `tipo_contrato_id` — get_context() não retorna tipos de contrato
- Esquece campo `sexo` obrigatório → NOT NULL constraint
- Envia `sexo: "masculino"` em vez de `"M"` → CHECK constraint

**Tratamento atual:** Erros SQL raw ❌

**Solução necessária:**
```typescript
// Adicionar tipos_contrato no get_context()
// Validação com mensagem guiada para campos obrigatórios
// Schema:
sexo: { type: 'string', enum: ['M', 'F'] }
```

---

#### 3.8 "Por que a escala tem violação?"

**Fluxo esperado:**
```
get_context() → encontra escala com violacoes_hard > 0 →
explicar_violacao({ codigo_regra: "H1" }) → responde
```

**Onde a IA burra erra:** Raro — fluxo simples. ✅

---

## PARTE 4 — O PLANO DE CORREÇÃO

### Prioridade ALTA (corrigem erros silenciosos no banco)

#### 4.1 Adicionar `enum` nos schemas de todas as tools com valores fixos

```typescript
// ajustar_alocacao
status: { type: 'string', enum: ['TRABALHO', 'FOLGA', 'INDISPONIVEL'] }
data: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'Formato YYYY-MM-DD. Ex: 2026-03-15' }

// criar excecoes
tipo: { type: 'string', enum: ['FERIAS', 'ATESTADO', 'BLOQUEIO'] }
data_inicio: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' }
data_fim: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' }

// criar colaboradores
sexo: { type: 'string', enum: ['M', 'F'] }
```

#### 4.2 Substituir erros SQL raw por mensagens guiadas no handler `criar`

```typescript
// Antes de executar o SQL, validar campos críticos:
function validarCriarExcecao(dados: Record<string, any>): string | null {
  if (!dados.colaborador_id) {
    return "colaborador_id obrigatório. Use get_context() para obter o ID pelo nome."
  }
  if (!['FERIAS', 'ATESTADO', 'BLOQUEIO'].includes(dados.tipo)) {
    return `tipo '${dados.tipo}' inválido. Use: FERIAS | ATESTADO | BLOQUEIO`
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dados.data_inicio)) {
    return `data_inicio '${dados.data_inicio}' inválida. Use formato YYYY-MM-DD. Ex: 2026-03-10`
  }
  return null
}
```

#### 4.3 Adicionar `tipos_contrato` no `get_context()`

A IA precisa saber os IDs dos tipos de contrato para criar colaboradores. Hoje isso não está no get_context e força a IA a usar `consultar("tipos_contrato")` — dependência de SQL knowledge.

```typescript
// Adicionar ao get_context():
const tipos_contrato = db.prepare(`
  SELECT id, nome, horas_semanais, regime_escala
  FROM tipos_contrato WHERE ativo = 1 ORDER BY nome
`).all()

return { ..., tipos_contrato }
```

### Prioridade MÉDIA (melhoram acerto em perguntas sobre colaboradores)

#### 4.4 Tool semântica `buscar_colaborador(nome)`

Retorna dados completos com joins, exceções ativas e última alocação. A IA passa o nome, a tool resolve tudo internamente.

```typescript
{
  name: 'buscar_colaborador',
  description: 'Busca informações completas de um colaborador pelo NOME. Retorna setor, contrato, exceções ativas e histórico recente. Use quando o usuário pergunta sobre uma pessoa específica.',
  parameters: {
    type: 'object',
    properties: {
      nome: { type: 'string', description: 'Nome ou parte do nome. Ex: "Maria", "João Silva"' }
    },
    required: ['nome']
  }
}
// Handler: busca colaboradores WHERE nome LIKE %nome%, faz JOINs, retorna dados enriquecidos
```

#### 4.5 Validar filtros do `consultar` antes do SQL

```typescript
const CAMPOS_VALIDOS: Record<string, string[]> = {
  colaboradores: ['id', 'setor_id', 'tipo_contrato_id', 'nome', 'sexo', 'ativo', 'tipo_trabalhador'],
  excecoes: ['id', 'colaborador_id', 'tipo', 'data_inicio', 'data_fim'],
  alocacoes: ['id', 'escala_id', 'colaborador_id', 'data', 'status'],
  // ...
}

// Antes do SELECT:
const camposInvalidos = Object.keys(filtros).filter(k => !CAMPOS_VALIDOS[entidade]?.includes(k))
if (camposInvalidos.length > 0) {
  return {
    erro: `Campos inválidos para '${entidade}': ${camposInvalidos.join(', ')}. ` +
          `Campos válidos: ${CAMPOS_VALIDOS[entidade]?.join(', ')}`
  }
}
```

---

## PARTE 5 — CONTROLE MICRO vs AUTOMÁTICO

**Resposta:** A IA controla o loop automaticamente. Não precisa e não deve controlar micro.

```
O que o APP controla:
  ✅ MAX_TURNS = 10 (segurança contra loop infinito)
  ✅ Execução das tools (handler)
  ✅ Devolução do functionResponse ao Gemini

O que o GEMINI controla:
  ✅ Quando chamar qual tool
  ✅ Quantas tools chamar antes de responder
  ✅ O que fazer com o resultado de cada tool
  ✅ Quando parar de chamar tools e responder ao usuário

O que o DESIGN controla (onde você tem poder):
  ✅ Schema da tool (enum, pattern, required) → previne erros antes de acontecer
  ✅ Description da tool → ensina quando e como usar
  ✅ Mensagem de erro da tool → instrui o que fazer ao errar
  ✅ System prompt → workflow geral e regras de conduta
  ✅ Exemplos no system prompt → reforça o pattern com casos concretos
```

**Analogia:** Você não controla como o funcionário pensa. Você controla:
- O manual de procedimentos (system prompt)
- O formulário que ele preenche (schema com enum/pattern)
- A mensagem de erro do sistema quando ele faz errado (tool error messages)

---

## PARTE 6 — CHECKLIST DE IMPLEMENTAÇÃO

### Fase 1 — Schema (sem quebrar nada, só melhora)
- [ ] Adicionar `enum` em `ajustar_alocacao.status`
- [ ] Adicionar `pattern` em todas as `data` fields
- [ ] Adicionar `enum` em `criar excecoes.tipo`
- [ ] Adicionar `enum` em `criar colaboradores.sexo`
- [ ] Adicionar descrições mais ricas nos parâmetros do `criar`

### Fase 2 — Validação semântica antes do SQL
- [ ] Validar campos obrigatórios em `criar(excecoes)` com mensagem guiada
- [ ] Validar campos obrigatórios em `criar(colaboradores)` com mensagem guiada
- [ ] Validar filtros do `consultar` contra lista de campos válidos por entidade

### Fase 3 — Enriquecer get_context
- [ ] Adicionar `tipos_contrato` no retorno do `get_context()`
- [ ] Adicionar exemplos de uso diretamente na description do `consultar` e `criar`

### Fase 4 — Tool semântica
- [ ] Implementar `buscar_colaborador(nome)` com JOINs completos + exceções ativas
- [ ] Avaliar se `buscar_excecoes(colaborador_nome)` faz sentido ou se `buscar_colaborador` já resolve

---

## RESUMO EXECUTIVO

| O que muda | Por que | Impacto estimado |
|-----------|---------|-----------------|
| `enum` nos schemas | IA aprende valores válidos antes de errar | Elimina ~80% dos erros de FERIAS/folga/M |
| Validação semântica no `criar` | Erro orientado em vez de SQL raw | IA resolve sozinha em vez de travar |
| `tipos_contrato` no `get_context` | IA resolve nome→ID de contratos | Permite criar colaboradores sem SQL knowledge |
| `buscar_colaborador` semântica | IA passa nome, recebe tudo pronto | Elimina `consultar` duplo para info de pessoa |
| Validação de filtros do `consultar` | Erro guiado quando campo errado | Evita SQL error incompreensível |

**O sistema já está ~70% do caminho certo.** As correções acima levam para ~95%.
O que separa 70% de 95% é: `enum` no schema + validação semântica antes do SQL + `get_context` com tipos_contrato.

---

## Parte 7: Fix do Erro 400 Gemini (Arrays em functionResponse)

### Problema

Gemini API rejeita arrays diretos em `functionResponse.response`:

```json
{
  "error": {
    "message": "Invalid JSON payload received. Unknown name \"response\" at 'contents[10].parts[0].function_response': Proto field is not repeating, cannot start list."
  }
}
```

### Causa

Tools que retornam arrays (ex: `consultar`, `get_context`) eram passados diretamente:

```typescript
// ❌ ERRADO
functionResponseParts.push({
  functionResponse: {
    name: fn.name,
    response: [{ id: 1 }, { id: 2 }]  // Gemini rejeita
  }
})
```

### Solução

Encapsular arrays em um objeto wrapper:

```typescript
// ✅ CORRETO (cliente.ts linha 129)
const responsePayload = Array.isArray(result)
  ? { result }  // Encapsula array
  : result      // Objeto direto OK

functionResponseParts.push({
  functionResponse: {
    name: fn.name,
    response: responsePayload
  }
})
```

### Referência

- Arquivo: `src/main/ia/cliente.ts` linha 129
- Commit: [adicionar link quando implementar]
- Gemini API docs: https://ai.google.dev/gemini-api/docs/function-calling

---

## Parte 8: UI Visual de Tool Calls (Pattern Auto-Claude)

### Motivação

Esconder tool calls completamente gera desconfiança. O usuário não vê:
- Que dados a IA buscou
- Quantas tentativas fez
- Se houve erros e como se recuperou

**Referências que mostram tool calls:**
- Auto-Claude: TaskLogs collapsible (tools visíveis, status, timing)
- Cursor: Thinking steps visíveis
- Claude Code: Tool use logs no sidebar

### Implementação

**Componente:** `IaToolCallsCollapsible.tsx`

**Padrão:**
1. Collapsible card com resumo: "X ferramentas utilizadas"
2. Cada tool call mostra:
   - Ícone específico (🔍 get_context, ➕ criar, etc)
   - Nome da tool em `mono`
   - Badge de status (✅ OK / ❌ Erro)
   - `<details>` para args e result (opt-in de ver detalhes)
3. Cores dark/light mode via Tailwind pairs

**Persistência:**
- Coluna `tool_calls_json TEXT` em `ia_mensagens`
- Serializar em `iaMensagensSalvar` (tipc.ts)
- Deserializar em `iaConversasObter` (tipc.ts)

**Renderização:**
- Logo APÓS cada mensagem do assistente
- Só mostra se `msg.tool_calls?.length > 0`

### Benefícios

✅ Transparência — usuário vê o raciocínio da IA
✅ Confiança — erros visíveis mas não alarmantes
✅ Educação — usuário aprende quais tools existem
✅ Debug — dev vê exatamente o que a IA tentou

### Referência

- Componente: `src/renderer/src/componentes/IaToolCallsCollapsible.tsx`
- Integração: `src/renderer/src/componentes/IaChatView.tsx` linha 144-156
- Persistência: `src/main/tipc.ts` handlers `iaMensagensSalvar` e `iaConversasObter`

---

## Parte 9: Zod Schemas para Type-Safety Estrutural

### Motivação

JSON Schema manual coloca valores permitidos em `description` (texto que a IA pode ignorar):

```typescript
// ❌ PROBLEMA: enum só em description
{
  name: 'ajustar_alocacao',
  parameters: {
    type: 'object',
    properties: {
      status: {
        type: 'string',
        description: 'TRABALHO | FOLGA | INDISPONIVEL'  // IA pode ignorar
      }
    }
  }
}
```

IA pode tentar `status: "INVALIDO"` e só descobre erro no SQL.

### Solução: Zod → Gemini API valida estruturalmente

```typescript
// ✅ CORRETO: enum como constraint estrutural
const AjustarAlocacaoSchema = z.object({
  escala_id: z.number().int().positive(),
  colaborador_id: z.number().int().positive(),
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  status: z.enum(['TRABALHO', 'FOLGA', 'INDISPONIVEL'])
})

const parameters = zodToJsonSchema(AjustarAlocacaoSchema as any)
// Gemini API vê: enum é parte do schema, não texto
```

### Benefícios

✅ **Validação dupla:** Gemini antes + Zod no handler
✅ **Type-safety:** TypeScript infere tipos dos schemas
✅ **DX melhor:** Menos bugs, autocomplete grátis
✅ **Impossível errar:** `status: "INVALIDO"` rejeitado ANTES do SQL

### Referência

- Command Center: Vercel AI SDK + Zod (mesma arquitetura)
- Arquivo: `src/main/ia/tools.ts`
- Package: `zod` + `zod-to-json-schema`
- Implementação: Fase 0 do plano de melhorias (2026-02-22)

---

*Autor: Miss Monday — EscalaFlow AI Intelligence Document*
*Referências: [Anthropic Writing Tools for Agents](https://www.anthropic.com/engineering/writing-tools-for-agents) | [Anthropic Advanced Tool Use](https://www.anthropic.com/engineering/advanced-tool-use) | Neural System (CognitiveOverflow) como padrão de referência*
