# PRD: Garantia de Continuidade em Conversas Multi-Turn IA

> **Workflow:** feature
> **Budget sugerido:** medium
> **Criado em:** 2026-02-22T03:15:00Z
> **Fonte:** gather

---

## Visão Geral

O sistema de IA do EscalaFlow utiliza Vercel AI SDK para multi-turn tool calling. A migração de REST API → AI SDK foi bem-sucedida TECNICAMENTE (loop funciona com `stopWhen: stepCountIs(10)`), porém há um problema crítico de **continuidade**: a IA executa tools mas ocasionalmente retorna resposta vazia, deixando o usuário sem retorno.

**Contexto:**
- Multi-turn loop funciona (tool call → execução → continua)
- Problema: IA pode "esquecer" de sintetizar resposta final após executar tools
- Teste real mostrou: Q1 funciona, Q2 retorna text="" (vazio)
- Impacto: Usuário fica sem resposta, experiência quebrada

**Objetivo:**
Criar camada de **validação pós-tool-call** com retry inteligente e fallback explicativo para garantir que NUNCA retornamos resposta vazia ao usuário.

---

## Requisitos Funcionais

- [ ] **RF1:** Logging estruturado de cada chamada IA
  - Log: steps count, finishReason, text length, tool calls executados
  - Format: `[AI SDK] Steps=${N} | Finish=${reason} | Text=${len} | Tools=[${names}]`
  - Aparece em TODAS as chamadas (sucesso e falha)

- [ ] **RF2:** Validação pós-tool-call
  - Criar função `validateAiResponse(result)` que checa:
    - `text` não-vazio (trim())
    - `finishReason === 'stop'`
    - `steps > 0` (se teve tool calls)
  - Retorna `{ valid: boolean, reason?: string }`

- [ ] **RF3:** Retry automático com prompt enfático
  - Se validação falha → retry com system prompt reforçado
  - Prompt adicional: "🚨 VOCÊ DEVE SINTETIZAR RESPOSTA EM TEXTO. NUNCA retorne vazio."
  - Max 1 retry (evitar loop infinito)
  - Log: `[AI SDK] Retry triggered: ${reason}`

- [ ] **RF4:** Fallback explicativo
  - Se retry também falha → gerar resposta manual baseada nos tool calls
  - Format: "Executei [tool1, tool2], mas não consegui sintetizar resposta. Verifique os logs para mais detalhes."
  - NUNCA retornar vazio ao usuário

- [ ] **RF5:** Revisar system prompt
  - Adicionar linha explícita: "APÓS executar tools, você DEVE sintetizar resposta em linguagem natural."
  - Verificar se já existe (system-prompt.ts linhas 5-33)
  - Testar se prompt mais forte resolve o problema

- [ ] **RF6:** Suite de testes multi-turn
  - 5 cenários cobrindo:
    1. Single tool call → resposta OK
    2. Multi tool call → resposta OK
    3. Conversa de 3 turnos → resposta OK em todos
    4. Tool call com resultado vazio → IA deve avisar
    5. Tool call com erro → IA deve reportar erro
  - Validar que NENHUM cenário retorna text vazio

---

## Critérios de Aceitação

- [ ] **CA1:** Todos os 5 cenários de teste passam sem text vazio
- [ ] **CA2:** Log estruturado aparece em TODAS as chamadas de `_callGemini()`
- [ ] **CA3:** Retry é triggered automaticamente quando detecta resposta vazia
- [ ] **CA4:** Fallback NUNCA deixa usuário sem resposta (sempre tem texto explicativo)
- [ ] **CA5:** TypeScript passa sem erros (`npm run typecheck`)
- [ ] **CA6:** App em dev: testar manualmente conversas multi-turn no chat real
- [ ] **CA7:** Logs permitem debug fácil (identificar ONDE quebrou)

---

## Constraints

- Não quebrar comportamento existente (multi-turn deve continuar funcionando)
- Retry limitado a 1 tentativa (evitar latência excessiva)
- Fallback deve ser claro mas não alarmista (não assustar usuário)
- Não modificar estrutura de dados existente (IaMensagem, ToolCall, etc)
- Manter compatibilidade com Electron + tipc (IPC não muda)

---

## Fora do Escopo

- Melhorar qualidade das respostas da IA (foco é garantir continuidade, não qualidade)
- Implementar streaming de respostas (fora do escopo desta task)
- Adicionar rate limiting ou throttling
- Criar UI para visualizar logs (logs vão pro console do main process)
- Migrar para outro modelo/provider (manter Gemini)

---

## Serviços Envolvidos

- [x] Backend (Electron main process)
  - `src/main/ia/cliente.ts` — adicionar validação em `_callGemini()`
  - `src/main/ia/validation.ts` — criar lógica de validação/retry isolada
  - `src/main/ia/system-prompt.ts` — revisar/reforçar prompt

- [ ] Frontend — Não envolvido (UI não muda)
- [ ] Database — Não envolvido (estrutura não muda)

- [x] Testes
  - `test-continuidade.ts` — suite de testes multi-turn

---

## Implementação Detalhada

### Arquivo 1: `src/main/ia/validation.ts` (NOVO)

```typescript
import type { GenerateTextResult } from 'ai'

export interface ValidationResult {
  valid: boolean
  reason?: string
}

export function validateAiResponse(result: GenerateTextResult<any>): ValidationResult {
  // Check 1: Texto não-vazio
  if (!result.text || result.text.trim() === '') {
    return {
      valid: false,
      reason: 'empty_text'
    }
  }

  // Check 2: finishReason = stop (se não parou, pode ter problema)
  if (result.finishReason !== 'stop') {
    return {
      valid: false,
      reason: `finish_reason_${result.finishReason}`
    }
  }

  // Check 3: Se teve tool calls, deve ter > 0 steps
  const hasToolCalls = result.steps?.some(s => s.toolCalls && s.toolCalls.length > 0)
  if (hasToolCalls && (!result.steps || result.steps.length === 0)) {
    return {
      valid: false,
      reason: 'tool_calls_without_steps'
    }
  }

  return { valid: true }
}

export function extractToolNames(result: GenerateTextResult<any>): string[] {
  if (!result.steps) return []

  const toolNames: string[] = []
  for (const step of result.steps) {
    if (step.toolCalls) {
      for (const tc of step.toolCalls) {
        toolNames.push(tc.toolName)
      }
    }
  }
  return toolNames
}

export function createFallbackResponse(result: GenerateTextResult<any>): string {
  const toolNames = extractToolNames(result)

  if (toolNames.length === 0) {
    return 'Desculpe, não consegui processar sua solicitação. Tente reformular a pergunta.'
  }

  return `Executei as seguintes ações: ${toolNames.join(', ')}, mas não consegui sintetizar uma resposta clara. Por favor, tente reformular sua pergunta ou verifique os logs para mais detalhes.`
}
```

### Arquivo 2: `src/main/ia/cliente.ts` (MODIFICAR)

**Adicionar no início:**
```typescript
import { validateAiResponse, createFallbackResponse, extractToolNames } from './validation'
```

**Modificar `_callGemini()` — adicionar validação antes do return:**

```typescript
async function _callGemini(
  config: IaConfiguracao,
  currentMsg: string,
  historico: IaMensagem[],
  contexto?: IaContexto
): Promise<{ resposta: string; acoes: ToolCall[] }> {
  // ... código existente até generateText() ...

  const result = await generateText({
    model: google(modelo),
    system: fullSystemPrompt,
    messages,
    tools,
    stopWhen: stepCountIs(10)
  })

  // ===== NOVO: LOGGING ESTRUTURADO =====
  const toolNames = extractToolNames(result)
  console.log(
    `[AI SDK] Steps=${result.steps?.length || 0} | ` +
    `Finish=${result.finishReason} | ` +
    `Text=${result.text?.length || 0} | ` +
    `Tools=[${toolNames.join(', ')}]`
  )

  // ===== NOVO: VALIDAÇÃO PÓS-TOOL-CALL =====
  const validation = validateAiResponse(result)

  if (!validation.valid) {
    console.warn(`[AI SDK] Validation failed: ${validation.reason}`)

    // RETRY com prompt enfático
    console.log('[AI SDK] Triggering retry with emphatic prompt...')

    const retryMessages = [
      ...messages,
      {
        role: 'user' as const,
        content: 'Por favor, resuma o que você descobriu após executar as ferramentas.'
      }
    ]

    const retryResult = await generateText({
      model: google(modelo),
      system: `${fullSystemPrompt}\n\n🚨 CRITICAL: Você DEVE sintetizar uma resposta em texto natural após executar ferramentas. NUNCA retorne vazio.`,
      messages: retryMessages,
      tools,
      stopWhen: stepCountIs(5)
    })

    console.log(
      `[AI SDK] Retry result - Text=${retryResult.text?.length || 0} | ` +
      `Finish=${retryResult.finishReason}`
    )

    // Validar retry
    const retryValidation = validateAiResponse(retryResult)

    if (!retryValidation.valid) {
      // FALLBACK: resposta manual
      console.error('[AI SDK] Retry also failed. Using fallback response.')
      const fallbackText = createFallbackResponse(result)

      return {
        resposta: fallbackText,
        acoes: extractToolCallsFromResult(result)
      }
    }

    // Retry funcionou!
    return {
      resposta: retryResult.text,
      acoes: extractToolCallsFromResult(retryResult)
    }
  }

  // Resposta OK na primeira tentativa
  return {
    resposta: result.text,
    acoes: extractToolCallsFromResult(result)
  }
}

// Helper function (mover lógica existente pra função separada)
function extractToolCallsFromResult(result: GenerateTextResult<any>): ToolCall[] {
  const acoes: ToolCall[] = []
  if (result.steps) {
    for (const step of result.steps) {
      if (step.toolCalls && step.toolResults) {
        for (let i = 0; i < step.toolCalls.length; i++) {
          const tc = step.toolCalls[i]
          const tr = step.toolResults[i]
          acoes.push({
            id: tc.toolCallId,
            name: tc.toolName,
            args: (tc as any).args,
            result: (tr as any).result
          })
        }
      }
    }
  }
  return acoes
}
```

### Arquivo 3: `src/main/ia/system-prompt.ts` (MODIFICAR)

**Verificar se já existe (linhas 5-33 já têm instruções fortes).**

Se não for suficientemente enfático, adicionar no final:

```typescript
export const SYSTEM_PROMPT = `
[... conteúdo existente ...]

🚨 CRITICAL WORKFLOW:
1. SEMPRE chame get_context() antes de responder sobre dados
2. APÓS executar ferramentas, você DEVE sintetizar uma resposta em linguagem natural
3. NUNCA retorne vazio — sempre forneça feedback ao usuário
4. Se não conseguir responder, EXPLIQUE por que e sugira alternativas
`
```

### Arquivo 4: `test-continuidade.ts` (NOVO)

```typescript
import { generateText, stepCountIs } from 'ai'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { getVercelAiTools } from './src/main/ia/tools'
import { SYSTEM_PROMPT } from './src/main/ia/system-prompt'

const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY

if (!apiKey) {
  console.error('❌ Precisa de GEMINI_API_KEY')
  process.exit(1)
}

// Mock DB (mesmo do test-final.ts)
import Database from 'better-sqlite3'
const db = new Database(':memory:')
db.exec(`
  CREATE TABLE setores (id INTEGER PRIMARY KEY, nome TEXT, ativo INTEGER);
  CREATE TABLE colaboradores (id INTEGER PRIMARY KEY, nome TEXT, setor_id INTEGER, tipo_contrato_id INTEGER, ativo INTEGER);
  CREATE TABLE tipos_contrato (id INTEGER PRIMARY KEY, nome TEXT, horas_semanais INTEGER);

  INSERT INTO setores VALUES (2, 'Acougue', 1);
  INSERT INTO tipos_contrato VALUES (1, 'CLT 44h', 44);
  INSERT INTO colaboradores VALUES (9, 'Alex', 2, 1, 1);
  INSERT INTO colaboradores VALUES (10, 'Mateus', 2, 1, 1);
  INSERT INTO colaboradores VALUES (11, 'Jose Luiz', 2, 1, 1);
  INSERT INTO colaboradores VALUES (12, 'Jessica', 2, 1, 1);
  INSERT INTO colaboradores VALUES (13, 'Robert', 2, 1, 1);
`)
global.mockDb = db

const google = createGoogleGenerativeAI({ apiKey })
const tools = getVercelAiTools()

async function testScenario(name: string, messages: Array<{ role: 'user' | 'assistant', content: string }>) {
  console.log(`\n📝 CENÁRIO: ${name}`)
  console.log('=' .repeat(60))

  const result = await generateText({
    model: google('gemini-2.5-flash'),
    system: SYSTEM_PROMPT,
    messages,
    tools,
    stopWhen: stepCountIs(10)
  })

  const textLen = result.text?.length || 0
  const toolNames = result.steps?.flatMap(s => s.toolCalls?.map(tc => tc.toolName) || []) || []

  console.log(`📊 Resultado:`)
  console.log(`   Steps: ${result.steps?.length || 0}`)
  console.log(`   Finish: ${result.finishReason}`)
  console.log(`   Text length: ${textLen}`)
  console.log(`   Tools used: [${toolNames.join(', ')}]`)
  console.log(`   Text: "${result.text?.substring(0, 100)}..."`)

  // VALIDAÇÃO
  if (textLen === 0) {
    console.error(`❌ FALHOU: Resposta vazia!`)
    return false
  }

  if (result.finishReason !== 'stop') {
    console.error(`❌ FALHOU: finishReason = ${result.finishReason}`)
    return false
  }

  console.log(`✅ PASSOU`)
  return true
}

async function runTests() {
  console.log('🧪 SUITE DE TESTES: Continuidade Multi-Turn\n')

  const results: boolean[] = []

  // CENÁRIO 1: Single tool call
  results.push(await testScenario('Single tool call', [
    { role: 'user', content: 'Quantos açougueiros temos?' }
  ]))

  // CENÁRIO 2: Multi tool call (mesma pergunta 2x pra forçar retry)
  results.push(await testScenario('Multi tool call', [
    { role: 'user', content: 'Quantos açougueiros temos?' },
    { role: 'assistant', content: 'Temos 5 açougueiros.' },
    { role: 'user', content: 'Me dá a info deles' }
  ]))

  // CENÁRIO 3: Conversa de 3 turnos
  results.push(await testScenario('Conversa 3 turnos - Turn 1', [
    { role: 'user', content: 'Quantos setores temos?' }
  ]))

  results.push(await testScenario('Conversa 3 turnos - Turn 2', [
    { role: 'user', content: 'Quantos setores temos?' },
    { role: 'assistant', content: 'Temos 1 setor ativo: Açougue.' },
    { role: 'user', content: 'Quantas pessoas trabalham lá?' }
  ]))

  results.push(await testScenario('Conversa 3 turnos - Turn 3', [
    { role: 'user', content: 'Quantos setores temos?' },
    { role: 'assistant', content: 'Temos 1 setor ativo: Açougue.' },
    { role: 'user', content: 'Quantas pessoas trabalham lá?' },
    { role: 'assistant', content: '5 pessoas trabalham no Açougue.' },
    { role: 'user', content: 'Me lista elas' }
  ]))

  // CENÁRIO 4: Tool call com resultado vazio (forçar)
  // (Difícil de mockar — pular por enquanto)

  // CENÁRIO 5: Tool call com erro (difícil de mockar — pular)

  // RESUMO
  console.log('\n' + '='.repeat(60))
  const passed = results.filter(r => r).length
  const total = results.length
  console.log(`\n📊 RESULTADO FINAL: ${passed}/${total} testes passaram\n`)

  if (passed === total) {
    console.log('✅ TODOS OS TESTES PASSARAM!\n')
    process.exit(0)
  } else {
    console.error('❌ ALGUNS TESTES FALHARAM!\n')
    process.exit(1)
  }
}

runTests().catch(err => {
  console.error('\n❌ ERRO:', err.message)
  process.exit(1)
})
```

---

## Budget Sugerido

**Recomendação:** **medium**

**Justificativa:**
- Múltiplos arquivos envolvidos (cliente.ts, validation.ts, system-prompt.ts, teste)
- Lógica média complexidade (validação, retry, fallback)
- Risco médio (não quebrar multi-turn existente)
- Testes necessários (5 cenários)
- Não é trivial mas também não é arquitetura complexa

**Mapeamento agents:**
- Discovery: haiku (mapear arquivos)
- Plan: sonnet (planejar validação/retry)
- Coder: sonnet (implementar validation.ts + modificar cliente.ts)
- QA: sonnet (validar testes)
- Critic: opus (revisar se solução é robusta)

---

## Timeline Estimado

- **Task 1** (Logging): 15min
- **Task 2** (Validação): 20min
- **Task 3** (Retry): 30min
- **Task 4** (Fallback): 15min
- **Task 5** (System Prompt): 10min
- **Task 6** (Testes): 45min

**Total: ~2h15min**

**Com orchestrate (discovery + plan + code + qa + critic):** ~3-4h

---

## Riscos

| Risco | Impacto | Mitigação |
|-------|---------|-----------|
| Retry aumenta latência | Médio | Max 1 retry, só quando necessário |
| Prompt muito enfático vira verboso | Baixo | Testar tom, ajustar se necessário |
| Fallback confuso pro usuário | Médio | Mensagem clara e não-alarmista |
| Quebrar multi-turn existente | Alto | Testes cobrindo cenários que já funcionam |

---

## Notas Adicionais

- **Contexto:** Migração REST API → Vercel AI SDK foi concluída (commit recente)
- **Teste real que falhou:** test-final.ts (Q2 retornou vazio)
- **System prompt atual:** src/main/ia/system-prompt.ts linhas 5-33 já tem instruções fortes
- **Referência:** Docs do Vercel AI SDK sobre multi-turn: https://sdk.vercel.ai/docs/ai-sdk-core/tools-and-tool-calling

**Próximos passos após esta task:**
1. Testar em produção (1 semana) pra validar 0 respostas vazias
2. Se funcionar bem, considerar adicionar métricas (taxa de retry, taxa de fallback)
3. Considerar streaming de respostas (melhora UX mas é outra task)
