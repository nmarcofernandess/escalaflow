# Plano Mestre v2 — Context + E2E + 6 Tools

> **Status:** Aprovado para execucao
> **Data:** 2026-03-22
> **Autor:** Monday (revisao sobre draft Codex)
> **Branch:** `fix/solver-distribution-folgas`
> **Premissa:** Se 6 tools nao funcionar, ajustamos context e voltamos. Branch experimental.

---

## 1. North Star

O LLM deve expor **6 tools publicas**. Handlers internos continuam existindo — a mudanca e de **surface**, nao de infra.

| Tool publica | Absorve | Tipo |
|--------------|---------|------|
| `consultar_contexto` | consultar, buscar_colaborador, preflight, diagnosticar_escala, diagnosticar_infeasible, explicar_violacao, resumir_horas_setor, listar_perfis_horario, obter_alertas | Read |
| `editar_ficha` | criar, atualizar, deletar, cadastrar_lote, salvar_posto_setor, salvar_regra_horario_colaborador, salvar_demanda_excecao_data, upsert_regra_excecao_data, salvar_perfil_horario, deletar_perfil_horario, configurar_horario_funcionamento, editar_regra, resetar_regras_empresa | Write |
| `executar_acao` | gerar_escala, ajustar_alocacao, ajustar_horario, oficializar_escala, fazer_backup | Action |
| `buscar_rag` | buscar_conhecimento, explorar_relacoes, salvar_conhecimento | Knowledge |
| `salvar_memoria` | salvar_memoria | Memory |
| `remover_memoria` | remover_memoria | Memory |

**Internals:** os handlers atuais (30) continuam como roteamento interno. A migracao e de contrato LLM, nao de codigo backend.

**Design influencia desde ja:**
- `ContextBundle` nasce compativel com `consultar_contexto` (shape = o que a tool retornaria)
- Campos de ficha informam `editar_ficha` schema
- Acoes observadas no E2E informam `executar_acao` routing

---

## 2. Vertical Slice — Primeiro tijolo

**Cenario:** Perguntar sobre folgas da Padaria no Electron real e provar o que aconteceu.

```
1. npm run build
2. Electron abre com seed E2E (Padaria)
3. Navegar para SetorDetalhe da Padaria
4. Abrir chat
5. Perguntar: "a distribuicao de folgas da padaria esta boa?"
6. Capturar resposta
7. Capturar tool calls (nomes)
8. Provar qual contexto entrou (secoes do bundle)
9. Concluir: respondeu por contexto, por tool, ou mistura?
```

**Criterio de sucesso:**
- Resposta nao pede ID
- Resposta menciona dados consistentes com o preview
- Se chamou tool, e justificavel (nao redundante com contexto)
- Teste consegue afirmar `pagina = setor_detalhe` e `setor = Padaria`

**Esse slice cruza Tasks 1-4 de uma vez.** Nao precisa de cada task "full" antes — precisa do MVP de cada uma.

---

## 3. Bugs conhecidos (corrigir durante execucao)

### Bug 1: cobertura_media errada (discovery.ts:1111)

```typescript
// ATUAL — divide totalCob por max_demanda global
const cobertura_media = totalCob / 7 / Math.max(1, Math.max(...demanda_por_dia))

// CORRETO — normaliza por dia antes de fazer media
const coveragePcts = cobertura_por_dia.map(d => d.demanda > 0 ? d.cobertura / d.demanda : 1)
const cobertura_media = coveragePcts.reduce((a, b) => a + b, 0) / 7
```

**Impacto:** Preview pode mostrar 78% quando a realidade e 93%. Contradiz warnings. Briefing inconsistente.

### Bug 2: CLI e evals sem mensagemUsuario

```typescript
// CLI (ia-chat-cli.ts:136) e evals (run-evals.ts:187)
buildContextBriefing(contexto)  // sem mensagem → sem RAG

// App real (cliente.ts:229)
buildFullSystemPrompt(contexto, currentMsg)  // com mensagem → com RAG
```

**Impacto:** CLI e evals nunca testam o caminho RAG. Resultados divergem do app real.

### Bug 3: Preview pode contradizer warnings

O resumo do preview usa `cobertura_media` (media global), mas os warnings vem de `gerarCicloFase1` que olha semana-a-semana. Resultado possivel: "deficit maximo zero" e ao mesmo tempo "cobertura 3/4 em sabado".

**Correcao:** Entra na Task 2 (bundle coerente).

---

## 4. Tasks com MVP e Full

### Task 1 — Bootstrap reproduzivel

**Objetivo:** Electron sobe, Padaria aparece, chat abre. Sempre. Sem ritual.

**MVP (~2h):**
- Garantir que `npm run test:e2e:build` sobe o app e Padaria aparece
- Validar que `global-setup.ts` limpa banco e userData
- Confirmar que seed E2E roda automaticamente (ESCALAFLOW_E2E=1)
- Smoke test verde

**Full:**
- Documentar contrato de bootstrap (build-first = canonico, clean+dev = debug)
- Screenshot on failure em todos os testes
- Seed E2E com dados mais ricos (4-5 colabs, excecoes, escala existente)
- Override explicito de userData confirmado

**Arquivos:**
- `tests/e2e/global-setup.ts`
- `tests/e2e/helpers/electron-app.ts`
- `src/main/db/seed-e2e.ts`
- `tests/e2e/README.md`

**Criterio MVP:** smoke test roda 3x seguidas sem falha.

---

### Task 2 — Bundle coerente e dumpavel

**Objetivo:** O contexto que o LLM recebe e consistente, inspecionavel e compartilhado entre app/CLI.

**MVP (~3h):**
- Corrigir bug cobertura_media (discovery.ts:1111)
- Garantir que preview nao contradiz warnings
- Passar mensagemUsuario na CLI (`ia:chat`) e evals — fechar gap de RAG
- `preview:cli --context` mostra briefing identico ao que o app manda

**Full:**
- Shape do ContextBundle compativel com futura `consultar_contexto`
- `preview:cli --json` dumpa bundle estruturado
- Orcamento de tokens por secao (metricas no dump)
- Teste unitario: `buildContextBundle(padaria_fixture) → snapshot test`

**Arquivos:**
- `src/main/ia/discovery.ts` (bug fix + shape)
- `scripts/preview-cli.ts` (--json mode)
- `tests/ia/live/ia-chat-cli.ts` (passar mensagemUsuario)
- `tests/ia/evals/run-evals.ts` (passar mensagemUsuario)

**Criterio MVP:** `preview:cli --context 1` (Padaria) nao tem contradicao entre resumo e warnings.

---

### Task 3 — Observabilidade minima de turno

**Objetivo:** Provar o que entrou e o que saiu em cada turno do chat.

**MVP (~2h):**
- Emitir metadata de turno no stream event (ou side-channel):
  ```typescript
  { rota, pagina, setor_id, bundle_sections: string[], tool_calls: string[] }
  ```
- Expor via data-attribute no DOM (ex: `data-turn-meta` no assistant message)
- Helper E2E `getTurnMeta(page)` que le esse atributo

**Full:**
- Log estruturado no main process (JSON por turno)
- `briefing_hash` + `briefing_chars` para detectar drift
- Modo debug visual no chat (collapsible com secoes que entraram)
- Distinguir "respondeu so com context" vs "precisou de tool" automaticamente

**Arquivos:**
- `src/main/ia/cliente.ts` (emitir metadata)
- `src/renderer/src/componentes/IaMensagemBubble.tsx` (data attribute)
- `tests/e2e/helpers/ia-chat.ts` (helper getTurnMeta)

**Criterio MVP:** E2E consegue afirmar `setor_id = Padaria` e `bundle_sections includes 'preview'`.

---

### Task 4 — Suite E2E da Padaria (vertical slice completo)

**Objetivo:** Provar o produto real com evidencia, nao com sensacao.

**MVP (~3h):**
- **4A — Folgas:** pergunta sobre distribuicao de folgas, resposta nao pede ID, menciona dados do preview
- **4B — Deficit:** pergunta sobre deficit, resposta coerente com preview
- **4C — Operacional:** "quem esta fora do posto?", resposta usa setor atual
- Cada teste captura tool calls e valida se context era suficiente

**Full:**
- **4D — Acao visivel:** `salvar_memoria` com marker, verifica persistencia (ja existe!)
- **4E — Gerar escala:** trigger solver via chat, validar que escala aparece
- Assertions de turn metadata (Task 3)
- Flaky detection: cada teste roda 2x, deve passar ambas

**Arquivos:**
- `tests/e2e/ia-chat-tool-calls.spec.ts` (expandir)
- `tests/e2e/helpers/ia-chat.ts` (novos helpers)

**Criterio MVP:** 3 cenarios da Padaria passam com evidencia de contexto.

---

### Task 5 — Correcoes por cenario (decomposicao obrigatoria)

**Objetivo:** Corrigir comportamento real, nao abstrato. Cada cenario tem aceite binario.

**5A — Folgas/preview:**
- Pergunta sobre distribuicao de folgas
- Resposta NAO pede ID do setor
- Resposta NAO ignora preview
- Se chamar `consultar`, precisa ser justificavel (dado que nao esta no preview)
- **Aceite:** resposta menciona ciclo, cobertura ou folga com dados reais

**5B — Deficit:**
- Pergunta sobre deficit
- Resposta NAO contradiz o preview
- Se houver undercoverage, aparece claramente
- **Aceite:** resposta menciona deficit_max ou cobertura_por_dia consistente com bundle

**5C — Operacional:**
- "quem esta fora do posto?"
- Resposta coerente com setor atual
- Usa excecoes do contexto, nao faz query desnecessaria
- **Aceite:** resposta lista nomes corretos ou diz "ninguem ausente" se verdade

**5D — Acao visivel:**
- `salvar_memoria` ou acao reversivel
- Tool de escrita chamada
- Reflexo visivel na UI (navegar para /memoria e encontrar)
- **Aceite:** tool call confirmada + persistencia verificada

**5E — Gerar escala via chat:**
- "gera a escala da padaria"
- Solver roda
- Resultado aparece no setor
- **Aceite:** escala com status RASCUNHO criada

**Modo de trabalho:** Rodar cenario → ver resultado → diagnosticar via observabilidade (Task 3) → corrigir prompt/context/tool conforme evidencia.

---

### Task 6 — Migracao de surface para 6 tools

**Pre-requisito (gate):** Tasks 1-5 MVP fechadas com evidencia.

**Objetivo:** Colapsar surface publica do LLM de 30 para 6 tools.

**Estrategia:** Encapsular primeiro, apagar depois.

**Passo 1 — Adapter layer:**
- Criar 6 tools novas com schemas Zod
- Cada uma roteia internamente para handlers existentes
- Registrar no IA_TOOLS como surface publica
- Manter 30 tools como internals (nao expostas ao LLM)

**Passo 2 — System prompt:**
- Reescrever secao de tools para 6 familias
- Instrucoes de routing: "use `editar_ficha` com `entidade: 'colaborador'`" etc
- Exemplos de uso por familia

**Passo 3 — Validacao:**
- Regressao E2E: todos os cenarios da Task 4+5 devem continuar passando
- Comparar round-trips antes/depois (deve cair)
- Smoke com CLI

**Passo 4 — Cleanup:**
- Remover tools antigas do IA_TOOLS (manter handlers como internals)
- Atualizar TOOL_SCHEMAS
- Atualizar docs

**Criterio de aceite:**
- LLM ve 6 tools, nao 30
- Cenarios 5A-5E passam
- Round-trips nao aumentaram

**Fallback:** Se 6 tools piora comportamento significativamente, voltar para 30 e investir mais no context. Branch experimental permite isso sem drama.

---

## 5. Waves de execucao

```
Wave A (fundacao paralela)           Wave B (vertical slice)
┌──────────────────────────┐         ┌──────────────────────────┐
│ Task 1 MVP (bootstrap)   │────────►│ Task 4 MVP (Padaria E2E) │
│ Task 2 MVP (bundle fix)  │────────►│   cenarios 4A, 4B, 4C   │
│ Task 3 MVP (turn meta)   │────────►│   com evidencia de ctx   │
│ Bug fixes (3 bugs)       │         │                          │
└──────────────────────────┘         └──────────────────────────┘
                                              │
                                              ▼
Wave C (correcoes por cenario)       Wave D (migracao)
┌──────────────────────────┐         ┌──────────────────────────┐
│ Task 5A (folgas)         │         │ Task 6 (6 tools)         │
│ Task 5B (deficit)        │────────►│   adapter layer          │
│ Task 5C (operacional)    │         │   prompt rewrite         │
│ Task 5D (acao visivel)   │         │   regressao E2E          │
│ Task 5E (gerar escala)   │         │   cleanup                │
└──────────────────────────┘         └──────────────────────────┘
```

### Dependencias reais

| De | Para | Porque |
|----|------|--------|
| Task 1 MVP | Task 4 | Sem bootstrap, E2E nao roda |
| Task 2 MVP | Task 4 | Sem bundle coerente, nao da pra provar contexto |
| Task 3 MVP | Task 4 | Sem metadata, nao da pra distinguir context vs tool |
| Task 4 MVP | Task 5 | Sem E2E, correcoes sao chute |
| Task 5 (maioria) | Task 6 | Sem baseline corrigido, migracao e cega |

### O que pode rodar em paralelo

- Task 1, 2, 3 MVPs → **Wave A inteira** (sem dependencia entre elas)
- Bug fixes → junto com Wave A
- Design da surface de 6 tools → comeca em Wave A, executa em Wave D
- Task 5A-5E → independentes entre si dentro da Wave C

---

## 6. Gate para Wave D (migracao)

A Wave D so comeca quando:

- [ ] Smoke E2E verde (Task 1)
- [ ] `preview:cli --context` sem contradicao (Task 2)
- [ ] Turn metadata capturavel no E2E (Task 3)
- [ ] Pelo menos 3 cenarios da Padaria passam com evidencia (Task 4)
- [ ] Pelo menos 5A e 5B corrigidos com evidencia (Task 5 parcial)

Se o gate nao passar, a decisao e: **investir mais no context** antes de mudar a surface.

---

## 7. O que NAO fazer

- Nao usar `localhost:5173` (browser) como se fosse o app
- Nao tratar CLI como prova final do produto
- Nao cortar tools antes de provar que o context segura
- Nao criar caminho paralelo de briefing
- Nao deixar debug so no console sem acesso pelo teste
- Nao tratar E2E como cosmetica de QA
- Nao tentar resolver tudo antes de ter o primeiro slice vertical verde
- Nao fazer waterfall disfarçado — se Wave A trava, investigar e destravar, nao esperar

---

## 8. Criterio de conclusao do plano

Este plano esta concluido quando:

1. Vertical slice da Padaria roda no Electron real com evidencia de contexto
2. Bugs 1-3 corrigidos
3. Cenarios 5A-5E passam
4. Surface publica = 6 tools OU decisao documentada de manter 30 com context melhorado
5. Branch mergeavel ou decisao de pivot documentada

---

## 9. Proximo passo imediato

**Wave A — comecar pelos 3 bugs + Task 1 MVP.**

Os bugs sao cirurgicos (< 1h). O Task 1 MVP e confirmar que o smoke roda 3x. Isso destrava tudo o mais.
