 Plano: Fase 5 — Session Indexing + Smart Extraction + History Compaction                        

 STATUS: IMPLEMENTADO + COMPATIVEL COM CHAT IA ENHANCED

 Fase 5 implementada na sessao anterior. Auditoria de compatibilidade com Chat IA Enhanced
 (anexos, multimodal, IaAnexo, schema v13) confirmou zero conflitos.

 O que foi feito:

 - session-processor.ts CRIADO (~220 linhas) — sanitize, indexSession, extractMemories,
 maybeCompact, enforceSourceLimit
 - schema.ts — migration v12 (+resumo_compactado, +memoria_automatica, CHECK constraint expandido)
 - types.ts — +resumo_compactado em IaConversa, +memoria_automatica em IaConfiguracao,
 +'session'|'auto_extract' em KnowledgeSource.tipo
 - config.ts — +buildModelFactory helper (reusa pattern de iaEnviarMensagem)
 - cliente.ts — maybeAutoCapture REMOVIDO, +conversa_id em toda a chain, +compaction em
 buildChatMessages
 - tipc.ts — +2 handlers (ia.sessao.processar, ia.config.memoriaAutomatica), +conversa_id em
 iaChatEnviar, +cache invalidation em iaMensagensSalvar
 - iaStore.ts — trigger fire-and-forget em novaConversa/carregarConversa
 - IaChatView.tsx — +conversa_id no invoke, stripToolCallResult REMOVIDO (tool results salvos
 inteiros)
 - MemoriaPagina.tsx — +toggle "Memoria Automatica"
 - memorias.ts — +getMemoriaAutomatica/setMemoriaAutomatica

 Compatibilidade com Chat IA Enhanced (sessao paralela):

 - IaAnexo/anexos — IaChatView passa conversa_ativa_id ao lado dos anexos, sem conflito
 - buildChatMessages aceita currentAnexos?: IaAnexo[] como 4o param (Phase 5 adicionou
 resumoCompactado como 3o)
 - schema v13 (anexos_meta_json) coexiste com v12 (resumo_compactado + memoria_automatica)
 - sanitizeTranscript ignora field anexos por design (so extrai texto)

 Proximos passos:

 - npm run typecheck ja retornou 0 erros
 - Testar E2E via UI: conversar → mudar chat → verificar session indexing + smart extraction
 - Phase 6 (Graph por Chunk) permanece como P3 backlog

 Contexto Original

 A IA do EscalaFlow era amnesica entre conversas. Quando o RH mudava de chat, tudo se perdia.

 Estrategia adotada (pesquisa OpenClaw): "salva tudo, busca bem". Indexar conversas
 automaticamente (embedding local, gratis) + extrair fatos via LLM (1 call ao trocar de chat) +
 compactar historico longo.

 ---
 O Que Sera Implementado (3 sub-features)

 A. Session Indexing (GRATIS — embedding local)

 - Trigger: User muda de chat (novaConversa/carregarConversa)
 - Pega historico da conversa anterior
 - Sanitiza: so user + assistant text, sem tool_calls JSON
 - Chunk + embed (local, gratis) via ingestKnowledge()
 - Dedup por conversa_id no metadata (idempotente)
 - Limit: max 50 session sources → remove oldest never-accessed

 B. Smart Extraction (PAGO — 1 LLM call)

 - Trigger: Mesmo que Session Indexing
 - generateObject() com schema Zod → extrai facts, preferences, corrections, decisions, entities
 - Dedup por cosine > 0.85 contra knowledge existente (atualiza em vez de duplicar)
 - Limit: max 100 dynamic sources → remove oldest never-accessed
 - So roda se toggle ON + LLM configurado

 C. History Compaction (PAGO — 1 LLM call quando necessario)

 - Trigger: A cada mensagem, antes do LLM call
 - Estima tokens do historico (~chars / 3.5)
 - Se > 30K tokens E > 10 msgs: resume msgs antigas com LLM, mantem 10 recentes
 - Cache resumo em ia_conversas.resumo_compactado (invalidado a cada nova msg)

 D. Remover maybeAutoCapture()

 - Regex CLT substituida por Session Indexing (transcript) + Smart Extraction (fatos)

 E. Toggle "Memoria Automatica" na UI

 - Switch na MemoriaPagina (tab memorias)
 - ON: Session Indexing + Smart Extraction rodam ao trocar de chat
 - OFF: Nada automatico

 ---
 Arquivos a Modificar/Criar

 ┌─────┬─────────────────────────────────────────────┬─────────────────────────────────────────┐
 │  #  │                   Arquivo                   │                  Acao                   │
 ├─────┼─────────────────────────────────────────────┼─────────────────────────────────────────┤
 │     │                                             │ NOVO — modulo com sanitize,             │
 │ 1   │ src/main/ia/session-processor.ts            │ indexSession, extractMemories,          │
 │     │                                             │ maybeCompact                            │
 ├─────┼─────────────────────────────────────────────┼─────────────────────────────────────────┤
 │     │                                             │ Migration: +resumo_compactado em        │
 │ 2   │ src/main/db/schema.ts                       │ ia_conversas, +memoria_automatica em    │
 │     │                                             │ configuracao_ia                         │
 ├─────┼─────────────────────────────────────────────┼─────────────────────────────────────────┤
 │ 3   │ src/shared/types.ts                         │ +resumo_compactado em IaConversa,       │
 │     │                                             │ +memoria_automatica em IaConfiguracao   │
 ├─────┼─────────────────────────────────────────────┼─────────────────────────────────────────┤
 │ 4   │ src/main/ia/cliente.ts                      │ Remover maybeAutoCapture, +conversa_id  │
 │     │                                             │ param, compaction em buildChatMessages  │
 ├─────┼─────────────────────────────────────────────┼─────────────────────────────────────────┤
 │     │                                             │ +2 IPC handlers (ia.sessao.processar,   │
 │ 5   │ src/main/tipc.ts                            │ ia.config.memoriaAutomatica),           │
 │     │                                             │ +conversa_id em iaChatEnviar, invalidar │
 │     │                                             │  cache em iaMensagensSalvar             │
 ├─────┼─────────────────────────────────────────────┼─────────────────────────────────────────┤
 │ 6   │ src/renderer/src/store/iaStore.ts           │ Trigger ia.sessao.processar ao trocar   │
 │     │                                             │ de chat                                 │
 ├─────┼─────────────────────────────────────────────┼─────────────────────────────────────────┤
 │ 7   │ src/renderer/src/componentes/IaChatView.tsx │ +conversa_id no invoke ia.chat.enviar   │
 ├─────┼─────────────────────────────────────────────┼─────────────────────────────────────────┤
 │ 8   │ src/renderer/src/paginas/MemoriaPagina.tsx  │ +Toggle "Memoria Automatica" na tab     │
 │     │                                             │ memorias                                │
 ├─────┼─────────────────────────────────────────────┼─────────────────────────────────────────┤
 │ 9   │ src/renderer/src/servicos/memorias.ts       │ +toggleMemoriaAutomatica method         │
 └─────┴─────────────────────────────────────────────┴─────────────────────────────────────────┘

 ---
 Decisoes de Design (da pesquisa OpenClaw, aprovadas)

 ┌────────────────┬─────────────────────────────────────────┬────────────────────────────────┐
 │    Decisao     │                 Escolha                 │             Motivo             │
 ├────────────────┼─────────────────────────────────────────┼────────────────────────────────┤
 │ Quando salvar  │ Ao MUDAR de chat (nao por exchange)     │ 1 LLM call por conversa        │
 │                │                                         │ inteira > N calls por msg      │
 ├────────────────┼─────────────────────────────────────────┼────────────────────────────────┤
 │ LLM para       │ Mesmo modelo do chat                    │ Zero config extra, usuario     │
 │ extracao       │                                         │ nao-tecnico                    │
 ├────────────────┼─────────────────────────────────────────┼────────────────────────────────┤
 │ Toggle state   │ Campo em configuracao_ia                │ E config de IA, nao de empresa │
 ├────────────────┼─────────────────────────────────────────┼────────────────────────────────┤
 │ Trigger vive   │ Renderer store → IPC fire-and-forget    │ Store ja sabe quando muda de   │
 │ onde           │                                         │ chat                           │
 ├────────────────┼─────────────────────────────────────────┼────────────────────────────────┤
 │ Compaction     │ Em _callWithVercelAiSdkTools antes do   │ Ja e async, precisa de         │
 │ onde           │ generateText                            │ conversa_id                    │
 ├────────────────┼─────────────────────────────────────────┼────────────────────────────────┤
 │ Resumo         │ Cache em ia_conversas, invalidado por   │ Nao recalcula toda vez         │
 │ compactado     │ nova msg                                │                                │
 ├────────────────┼─────────────────────────────────────────┼────────────────────────────────┤
 │ Dedup          │ Cosine > 0.85 → UPDATE existente        │ Evita "Pedro 44h" + "Pedro     │
 │ extraction     │                                         │ 36h" conflitante               │
 ├────────────────┼─────────────────────────────────────────┼────────────────────────────────┤
 │ File-first     │ REJEITADO — PGlite e melhor             │ Insights adotados: sanitizar,  │
 │ (OpenClaw)     │ (transacional, indice inline)           │ debounce, conversa atomica     │
 └────────────────┴─────────────────────────────────────────┴────────────────────────────────┘

 ---
 Detalhes por Passo

 Passo 1: session-processor.ts — NOVO modulo (~200 linhas)

 // src/main/ia/session-processor.ts

 // Constants
 const SESSION_MAX_SOURCES = 50
 const DYNAMIC_MAX_SOURCES = 100
 const COMPACTION_TOKEN_THRESHOLD = 30_000
 const COMPACTION_KEEP_RECENT = 10
 const DEDUP_COSINE_THRESHOLD = 0.85
 const TRANSCRIPT_MAX_CHARS = 8000

 // sanitizeTranscript(mensagens) → string
 //   Filtra so usuario + assistente (sem tool_result)
 //   Usa so .conteudo (sem tool_calls JSON)
 //   Formato: "Usuario: ...\nAssistente: ..."
 //   Skip msgs vazias

 // estimateTokens(text) → number
 //   Math.ceil((text?.length ?? 0) / 3.5)

 // indexSession(conversa_id, titulo, mensagens) → void
 //   1. sanitizeTranscript()
 //   2. Dedup: SELECT id FROM knowledge_sources WHERE metadata::text LIKE '%"conversa_id":"' ||
 $1 || '"%'
 //   3. Se ja existe: return (idempotente)
 //   4. ingestKnowledge(titulo, transcript, 'low', {tipo: 'session', conversa_id})
 //   5. Enforce limit: DELETE oldest never-accessed se count > 50

 // extractMemories(conversa_id, mensagens, model) → void
 //   1. sanitizeTranscript() → slice(0, 8000)
 //   2. Se < 100 chars: return
 //   3. generateObject({ model, schema: ExtractionSchema, prompt })
 //   4. Para cada item extraido:
 //      a. generateQueryEmbedding(item.summary)
 //      b. Busca dedup: SELECT com cosine distance
 //      c. Se cosine > 0.85: deleta source+chunks antigo, reingest atualizado
 //      d. Senao: ingestKnowledge(titulo, summary, importance, {tipo:'auto_extract', category})
 //   5. Enforce limit: DELETE oldest se count > 100

 // maybeCompact(conversa_id, historico, model) → string | null
 //   1. Estima tokens total
 //   2. Se <= threshold OU <= 10 msgs: return null
 //   3. Busca cache: SELECT resumo_compactado FROM ia_conversas WHERE id = $1
 //   4. Se tem cache: return cache
 //   5. Gera: generateText({ model, prompt: "Resuma preservando decisoes..." })
 //   6. Salva cache: UPDATE ia_conversas SET resumo_compactado = $1
 //   7. Return resumo

 Passo 2: Schema Migration

 schema.ts — nova migration na funcao migrateSchema():

 -- v9: Phase 5 — Session Indexing + Compaction
 ALTER TABLE ia_conversas ADD COLUMN IF NOT EXISTS resumo_compactado TEXT;
 ALTER TABLE configuracao_ia ADD COLUMN IF NOT EXISTS memoria_automatica BOOLEAN NOT NULL DEFAULT
 TRUE;

 Nota: knowledge_sources.tipo NAO tem CHECK constraint — e TEXT livre. "session" e "auto_extract"
 funcionam sem migration.

 Passo 3: Types

 types.ts — adicionar campos:

 // Em IaConversa:
 resumo_compactado?: string | null

 // Em IaConfiguracao (se existir interface):
 memoria_automatica: boolean

 Passo 4: Modificar cliente.ts

 4a. Remover maybeAutoCapture():
 - Deletar funcao (linhas ~248-265)
 - Remover 3 chamadas: maybeAutoCapture(resposta).catch(() => {}) (linhas ~341, ~476, ~482)

 4b. Adicionar conversa_id param:
 - iaEnviarMensagem(mensagem, historico, contexto?, conversa_id?)
 - iaEnviarMensagemStream(mensagem, historico, streamId, contexto?, conversa_id?)
 - Propagar para _callWithVercelAiSdkTools e _callWithVercelAiSdkToolsStreaming

 4c. Compaction:
 - Dentro de _callWithVercelAiSdkTools e _callWithVercelAiSdkToolsStreaming, ANTES do
 generateText:
 let resumoCompactado: string | null = null
 if (conversa_id) {
   resumoCompactado = await maybeCompact(conversa_id, historico, createModel)
 }
 const messages = buildChatMessages(historico, currentMsg, resumoCompactado)

 4d. Modificar buildChatMessages:
 - Novo param: resumoCompactado?: string | null
 - Se resumoCompactado e historico > 10 msgs:
   - Prepend: {role:'user', content: '[Resumo do contexto anterior]\n' + resumo}
   - Prepend: {role:'assistant', content: 'Entendido. Tenho o contexto anterior.'}
   - Converter so as ultimas 10 msgs do historico

 Passo 5: IPC Handlers

 5a. ia.sessao.processar — fire-and-forget chamado pelo renderer
 Input: { conversa_id: string }
 Flow:
   1. Carrega config (memoria_automatica, provider, api_key)
   2. Carrega conversa (titulo) + mensagens
   3. Se < 2 msgs: return
   4. Session Indexing (SEMPRE — gratis)
   5. Smart Extraction (so se toggle ON + api_key configurada)
 Return: { ok: true }

 5b. ia.config.memoriaAutomatica — getter/setter do toggle
 Input: { valor?: boolean }
 Flow: Se valor presente, UPDATE. Retorna estado atual.
 Return: { memoria_automatica: boolean }

 5c. Modificar iaChatEnviar:
 - Adicionar conversa_id?: string no input
 - Propagar para iaEnviarMensagem/iaEnviarMensagemStream

 5d. Modificar iaMensagensSalvar:
 - Apos inserir mensagem: UPDATE ia_conversas SET resumo_compactado = NULL WHERE id = $1
 - Invalida cache de compaction (forcara re-gerar se threshold atingido de novo)

 5e. Helper buildModelFactory(config) em config.ts:
 - Cria model instance a partir da config (reusa pattern de iaEnviarMensagem)
 - Usado por session-processor.ts (compaction, extraction) e tipc.ts (ia.sessao.processar)

 5f. Router:
 'ia.sessao.processar': iaSessaoProcessar,
 'ia.config.memoriaAutomatica': iaConfigMemoriaAutomatica,

 Passo 6: Renderer Store

 iaStore.ts — modificar novaConversa() e carregarConversa():

 // ANTES da logica existente, no topo de cada funcao:
 const { conversa_ativa_id, mensagens } = get()
 if (conversa_ativa_id && mensagens.length >= 2) {
   // Fire-and-forget: processa conversa anterior em background
   ipc.invoke('ia.sessao.processar', { conversa_id: conversa_ativa_id }).catch(() => {})
 }
 // ... resto da logica existente ...

 Passo 7: IaChatView

 IaChatView.tsx — adicionar conversa_id no invoke:

 const resp = await window.electron.ipcRenderer.invoke('ia.chat.enviar', {
   mensagem: msg.conteudo,
   historico: mensagens,
   contexto,
   stream_id: streamId,
   conversa_id: useIaStore.getState().conversa_ativa_id,  // NOVO
 })

 Passo 8: Toggle na MemoriaPagina

 Card no topo da tab "memorias" (antes do card "Memorias do RH"):

 ┌─────────────────────────────────────────────┐
 │ Memoria Automatica                [toggle]   │
 │ Salva informacoes das conversas              │
 │ automaticamente ao trocar de chat            │
 └─────────────────────────────────────────────┘

 - Estado: memoriaAutomatica, loadingToggle
 - Load on mount via ia.config.memoriaAutomatica
 - Toggle chama IPC com { valor: newValue }

 ---
 Ordem de Execucao

 1. session-processor.ts  — NOVO modulo (sem deps externas alem de ingest/embeddings/query)
 2. schema.ts             — Migration v9 (+2 colunas)
 3. types.ts              — +2 campos
 4. config.ts             — +buildModelFactory helper
 5. cliente.ts            — Remove maybeAutoCapture, +conversa_id, +compaction
 6. tipc.ts               — +2 handlers, modificar iaChatEnviar e iaMensagensSalvar
 7. iaStore.ts            — Trigger session processing
 8. IaChatView.tsx        — +conversa_id
 9. MemoriaPagina.tsx     — +Toggle
 10. memorias.ts          — +toggleMemoriaAutomatica
 11. npm run typecheck    — 0 erros

 ---
 Verificacao

 ┌─────┬──────────────────────────────┬───────────────────────────────────────────────────────┐
 │  #  │            Teste             │                    O que verificar                    │
 ├─────┼──────────────────────────────┼───────────────────────────────────────────────────────┤
 │ 1   │ npm run typecheck            │ 0 erros                                               │
 ├─────┼──────────────────────────────┼───────────────────────────────────────────────────────┤
 │ 2   │ Conversar + mudar chat       │ Session Indexing: nova source tipo "session" aparece  │
 │     │                              │ em knowledge_sources                                  │
 ├─────┼──────────────────────────────┼───────────────────────────────────────────────────────┤
 │ 3   │ Toggle ON + conversar +      │ Smart Extraction: novas sources tipo "auto_extract"   │
 │     │ mudar chat                   │ com fatos extraidos                                   │
 ├─────┼──────────────────────────────┼───────────────────────────────────────────────────────┤
 │ 4   │ Toggle OFF + conversar +     │ Session Indexing roda (gratis), Smart Extraction NAO  │
 │     │ mudar chat                   │ roda                                                  │
 ├─────┼──────────────────────────────┼───────────────────────────────────────────────────────┤
 │ 5   │ Mesma conversa processada 2x │ Dedup: nao cria fonte duplicada (idempotente)         │
 ├─────┼──────────────────────────────┼───────────────────────────────────────────────────────┤
 │ 6   │ Conversa longa (>30K tokens) │ Compaction: resumo gerado, resumo_compactado          │
 │     │                              │ preenchido, msgs antigas resumidas                    │
 ├─────┼──────────────────────────────┼───────────────────────────────────────────────────────┤
 │ 7   │ Nova msg apos compaction     │ Cache invalidado (resumo_compactado = NULL)           │
 ├─────┼──────────────────────────────┼───────────────────────────────────────────────────────┤
 │ 8   │ "O que discutimos sobre X?"  │ Auto-RAG encontra chunks da conversa indexada         │
 │     │ em novo chat                 │                                                       │
 ├─────┼──────────────────────────────┼───────────────────────────────────────────────────────┤
 │ 9   │ Fato extraido contradiz      │ Dedup cosine > 0.85: atualiza existente em vez de     │
 │     │ existente                    │ duplicar                                              │
 ├─────┼──────────────────────────────┼───────────────────────────────────────────────────────┤
 │ 10  │ 51 conversas indexadas       │ Enforce limit: oldest never-accessed deletado         │
 ├─────┼──────────────────────────────┼───────────────────────────────────────────────────────┤
 │ 11  │ IA nao configurada (sem      │ Session Indexing funciona (gratis), Smart Extraction  │
 │     │ api_key)                     │ + Compaction skip gracefully                          │
 ├─────┼──────────────────────────────┼───────────────────────────────────────────────────────┤
 │ 12  │ npm run test                 │ Testes existentes passam                              │
 ├─────┼──────────────────────────────┼───────────────────────────────────────────────────────┤
 │ 13  │ MemoriaPagina toggle         │ Switch funciona, persiste entre reloads               │
 └─────┴──────────────────────────────┴───────────────────────────────────────────────────────┘

 ---
 Riscos e Mitigacoes

 ┌───────────────────────────┬────────────────────────────────────────────────────────────────┐
 │           Risco           │                           Mitigacao                            │
 ├───────────────────────────┼────────────────────────────────────────────────────────────────┤
 │ generateObject nunca      │ Verificar que funciona com Gemini via @ai-sdk/google. AI SDK   │
 │ usado no codebase         │ v6 docs confirmam suporte                                      │
 ├───────────────────────────┼────────────────────────────────────────────────────────────────┤
 │ Race condition: user muda │ Dedup por conversa_id no indexSession e idempotente.           │
 │  de chat rapido           │ extractMemories dedup por cosine                               │
 ├───────────────────────────┼────────────────────────────────────────────────────────────────┤
 │ Compaction bloqueia       │ generateText pro resumo e rapido (~1-2s). So trigga 1x por     │
 │ resposta (latencia)       │ conversa quando threshold atingido                             │
 ├───────────────────────────┼────────────────────────────────────────────────────────────────┤
 │ PGlite metadata JSONB     │ Usar metadata::text LIKE ou metadata->>'conversa_id' — PGlite  │
 │ query                     │ suporta operadores JSONB                                       │
 ├───────────────────────────┼────────────────────────────────────────────────────────────────┤
 │ buildChatMessages vira    │ NAO — compaction roda ANTES, passa resumo como param.          │
 │ async?                    │ buildChatMessages continua sync                                │
 ├───────────────────────────┼────────────────────────────────────────────────────────────────┤
 │ Testes unitarios de       │ __iaClienteTestables.buildChatMessages agora aceita 3o param   │
 │ buildChatMessages         │ opcional — testes existentes nao quebram                       │
 └───────────────────────────┴────────────────────────────────────────────────────────────────┘
╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌

 Claude has written up a plan and is ready to execute. Would you like to proceed?