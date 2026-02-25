# SPEC: Chat UX Enhanced — Feedback Real-Time + Copy + Export + Edit/Fork

**Data:** 2026-02-24
**Autor:** Monday + Marco
**Status:** PLANO APROVADO — pronto pra executar

---

## TL;DR

5 features que transformam o chat de "funciona" pra "sabe o que ta fazendo":

1. **Tool Progress Inteligente** — feedback nomeado por tool com estimativa de tempo DO SISTEMA (nao da IA)
2. **Copy por Mensagem** — icone copy hover em cada bubble
3. **Menu 3 Pontinhos** — Copiar chat / Exportar .md / Exportar .json
4. **Edit + Fork** — editar msg do usuario, resubmit, perde historico abaixo
5. **Timeout Banner** — se 15s sem novidade, mostra "Ainda processando..."

---

## Feature 1: Tool Progress Inteligente

### O Problema

O usuario manda msg → ve "Pensando..." → silencio → de repente 30s depois aparece uma resposta.
O sistema SABE o que esta fazendo (gerando escala, consultando banco, rodando solver com maxTimeSeconds=30), mas nao conta pro usuario.

### O Insight do Marco

**O SISTEMA sabe o tempo.** A tool `gerar_escala` chama `runSolver(input, 60_000)` — o timeout e 60s. O `maxTimeSeconds` do solver config e configuravel (5-300s). Essa info existe ANTES de chamar o solver. A tool pode retornar `_meta.estimated_seconds` e o renderer pode mostrar.

### Arquitetura

```
Tool handler retorna { _meta: { estimated_seconds: 30 } }
         ↓
IaStreamEvent 'tool-call-start' inclui estimated_seconds
         ↓
iaStore armazena em tools_em_andamento
         ↓
IaChatView mostra: "Gerando escala... (~30s)" com countdown ou progress
```

### Mudancas

#### 1.1 — IaStreamEvent novo campo (types.ts)

```typescript
// Adicionar estimated_seconds ao tool-call-start
| { type: 'tool-call-start'; stream_id: string; tool_call_id: string;
    tool_name: string; args: Record<string, unknown>;
    estimated_seconds?: number }  // ← NOVO
```

#### 1.2 — Labels amigaveis (novo arquivo: src/renderer/src/lib/tool-labels.ts)

```typescript
export const TOOL_LABELS: Record<string, string> = {
  consultar: 'Consultando dados',
  buscar_colaborador: 'Buscando colaborador',
  gerar_escala: 'Gerando escala',
  preflight: 'Validando viabilidade',
  preflight_completo: 'Validacao completa',
  ajustar_alocacao: 'Ajustando alocacao',
  ajustar_horario: 'Ajustando horario',
  oficializar_escala: 'Oficializando escala',
  diagnosticar_escala: 'Diagnosticando escala',
  explicar_violacao: 'Explicando violacao',
  editar_regra: 'Editando regra',
  criar: 'Criando registro',
  atualizar: 'Atualizando registro',
  deletar: 'Removendo registro',
  cadastrar_lote: 'Cadastrando em lote',
  listar_perfis_horario: 'Listando perfis',
  salvar_perfil_horario: 'Salvando perfil',
  deletar_perfil_horario: 'Removendo perfil',
  configurar_horario_funcionamento: 'Configurando horario',
  resumir_horas_setor: 'Resumindo horas',
  salvar_demanda_excecao_data: 'Salvando demanda especial',
  upsert_regra_excecao_data: 'Salvando regra especial',
  resetar_regras_empresa: 'Resetando regras',
  obter_alertas: 'Verificando alertas',
  buscar_conhecimento: 'Buscando na base',
  salvar_conhecimento: 'Salvando conhecimento',
  listar_conhecimento: 'Listando conhecimento',
  explorar_relacoes: 'Explorando relacoes',
  salvar_memoria: 'Salvando memoria',
  listar_memorias: 'Listando memorias',
  remover_memoria: 'Removendo memoria',
  salvar_regra_horario_colaborador: 'Salvando regra individual',
  definir_janela_colaborador: 'Definindo janela',
}

export function toolLabel(name: string): string {
  return TOOL_LABELS[name] ?? name.replace(/_/g, ' ')
}
```

#### 1.3 — Estimativas de tempo por tool (tool-labels.ts — mesmo arquivo)

```typescript
// Estimativas BASE por tool (o sistema sabe!)
export const TOOL_TIME_ESTIMATES: Record<string, number> = {
  // Instantaneas (<1s)
  consultar: 1,
  buscar_colaborador: 1,
  listar_perfis_horario: 1,
  listar_memorias: 1,
  listar_conhecimento: 1,
  obter_alertas: 2,
  explicar_violacao: 1,

  // Rapidas (1-5s)
  preflight: 2,
  buscar_conhecimento: 3,
  explorar_relacoes: 3,
  resumir_horas_setor: 2,

  // Medias (5-15s)
  preflight_completo: 10,

  // Lentas (depende de config)
  gerar_escala: 30,       // ← override por maxTimeSeconds do solver config
  diagnosticar_escala: 15,
}

// Se a tool tem estimated_seconds no stream event, usa isso.
// Se nao, usa a estimativa base.
export function toolEstimatedSeconds(name: string, fromStream?: number): number | undefined {
  if (fromStream) return fromStream
  return TOOL_TIME_ESTIMATES[name]
}
```

#### 1.4 — Emitir estimated_seconds no stream (cliente.ts)

Em `_callWithVercelAiSdkToolsStreaming`, quando emitimos `tool-call-start`, ja temos o `tool_name`:

```typescript
// Para gerar_escala: ler maxTimeSeconds do solver config atual
// Para outras: usar estimativa base
if (part.type === 'tool-call') {
  const est = part.toolName === 'gerar_escala'
    ? (part.input as any)?.max_time_seconds ?? 30
    : undefined
  emitStream({
    type: 'tool-call-start',
    stream_id: streamId,
    tool_call_id: part.toolCallId,
    tool_name: part.toolName,
    args: normalizeToolArgs(part.input) ?? {},
    estimated_seconds: est,
  })
}
```

**Obs:** `gerar_escala` nao recebe `max_time_seconds` como arg direto (vem do solver config). Mas o handler da tool chama `runSolver(input, 60_000)` — entao o timeout e ~60s. A estimativa base de 30s e conservadora e correta.

Para o caso da **UI** (onde o usuario configura via SolverConfigDrawer), quem chama a geracao e o `tipc.ts` handler `escalasGerar`, nao a tool IA. Entao o `maxTimeSeconds` do drawer NAO afeta a tool da IA — a tool tem seu proprio timeout de 60s hard-coded.

**Decisao:** Usar estimativa base de 30s pra `gerar_escala` via IA. Se quiser refinar depois, a tool pode ler o solver config do DB e calcular dinamicamente.

#### 1.5 — Store atualizado (iaStore.ts)

```typescript
// tools_em_andamento ganha estimated_seconds e started_at
tools_em_andamento: Record<string, {
  tool_name: string;
  args?: Record<string, unknown>;
  estimated_seconds?: number;   // ← NOVO
  started_at: number;           // ← NOVO (Date.now())
}>

// No case 'tool-call-start':
[event.tool_call_id]: {
  tool_name: event.tool_name,
  args: event.args,
  estimated_seconds: event.estimated_seconds,
  started_at: Date.now(),
}
```

#### 1.6 — Pill com label e countdown (IaChatView.tsx)

Trocar o Badge simples por um componente mini:

```tsx
function ToolProgressPill({ info }: { info: { tool_name: string; estimated_seconds?: number; started_at: number } }) {
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    const interval = setInterval(() => setElapsed(Math.floor((Date.now() - info.started_at) / 1000)), 1000)
    return () => clearInterval(interval)
  }, [info.started_at])

  const label = toolLabel(info.tool_name)
  const est = toolEstimatedSeconds(info.tool_name, info.estimated_seconds)

  return (
    <Badge variant="secondary" className="animate-pulse gap-1.5 py-1">
      <Loader2 className="size-3 animate-spin" />
      <span>{label}</span>
      {est ? (
        <span className="text-muted-foreground">({elapsed}s / ~{est}s)</span>
      ) : (
        <span className="text-muted-foreground">({elapsed}s)</span>
      )}
    </Badge>
  )
}
```

#### 1.7 — Timeout banner (IaChatView.tsx)

Se `carregando = true` e nenhum evento novo em 15s:

```tsx
// Estado
const [lastEventAt, setLastEventAt] = useState(Date.now())
const [showTimeoutBanner, setShowTimeoutBanner] = useState(false)

// Resetar em cada evento de stream
useEffect(() => setLastEventAt(Date.now()), [texto_parcial, tools_em_andamento])

// Timer de 15s
useEffect(() => {
  if (!carregando) { setShowTimeoutBanner(false); return }
  const timer = setInterval(() => {
    if (Date.now() - lastEventAt > 15_000) setShowTimeoutBanner(true)
  }, 1000)
  return () => clearInterval(timer)
}, [carregando, lastEventAt])

// Render
{showTimeoutBanner && (
  <div className="text-xs text-muted-foreground text-center py-2 animate-pulse">
    Ainda processando... A IA esta trabalhando na resposta.
  </div>
)}
```

---

## Feature 2: Copy por Mensagem

### Mudancas

#### 2.1 — Hover actions no IaMensagemBubble.tsx

Adicionar grupo de acoes que aparece no hover:

```tsx
import { Copy, Check, Pencil } from 'lucide-react'

export function IaMensagemBubble({ msg, onEdit, showActions = true }: Props) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(msg.conteudo)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className={cn('group flex flex-col gap-0.5 text-sm', ...)}>
      <div className="relative">
        <div className={cn('px-3 py-2 rounded-2xl ...', ...)}>
          {/* conteudo existente */}
        </div>

        {/* Hover actions */}
        {showActions && (
          <div className={cn(
            'absolute -bottom-3 opacity-0 group-hover:opacity-100 transition-opacity flex gap-0.5',
            msg.papel === 'usuario' ? 'right-2' : 'left-2',
          )}>
            <button
              onClick={handleCopy}
              className="size-6 rounded-md bg-background border shadow-sm flex items-center justify-center hover:bg-muted"
              title="Copiar"
            >
              {copied ? <Check className="size-3 text-green-500" /> : <Copy className="size-3 text-muted-foreground" />}
            </button>
            {msg.papel === 'usuario' && onEdit && (
              <button
                onClick={() => onEdit(msg)}
                className="size-6 rounded-md bg-background border shadow-sm flex items-center justify-center hover:bg-muted"
                title="Editar"
              >
                <Pencil className="size-3 text-muted-foreground" />
              </button>
            )}
          </div>
        )}
      </div>

      <span className="text-[10px] ...">
        {/* timestamp/icon existente */}
      </span>
    </div>
  )
}
```

**Props adicionais:**
- `onEdit?: (msg: IaMensagem) => void` — callback pra Feature 5
- `showActions?: boolean` — desabilitar durante streaming

---

## Feature 3: Menu 3 Pontinhos (IaChatHeader)

### Mudancas

#### 3.1 — Dropdown no header (IaChatHeader.tsx)

Substituir o botao `+` por um DropdownMenu com 3 opcoes + Nova Conversa:

```tsx
import { MoreVertical, Copy, FileDown, FileJson, Plus } from 'lucide-react'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'

// No header do chat (tela === 'chat'):
<DropdownMenu>
  <DropdownMenuTrigger asChild>
    <Button variant="ghost" size="icon" className="size-8 shrink-0">
      <MoreVertical className="size-4" />
    </Button>
  </DropdownMenuTrigger>
  <DropdownMenuContent align="end">
    <DropdownMenuItem onClick={handleNovaConversa}>
      <Plus className="mr-2 size-3.5" />
      Nova conversa
    </DropdownMenuItem>
    <DropdownMenuSeparator />
    <DropdownMenuItem onClick={handleCopiarChat}>
      <Copy className="mr-2 size-3.5" />
      Copiar chat
    </DropdownMenuItem>
    <DropdownMenuItem onClick={handleExportarMd}>
      <FileDown className="mr-2 size-3.5" />
      Exportar .md
    </DropdownMenuItem>
    <DropdownMenuItem onClick={handleExportarJson}>
      <FileJson className="mr-2 size-3.5" />
      Exportar .json
    </DropdownMenuItem>
  </DropdownMenuContent>
</DropdownMenu>
```

#### 3.2 — Funcoes de export

**Copiar chat (clipboard):**

```typescript
async function handleCopiarChat() {
  const md = formatChatAsMarkdown(mensagens, conversa_ativa_titulo)
  await navigator.clipboard.writeText(md)
  toast.success('Chat copiado!')
}
```

**Exportar .md (arquivo):**

```typescript
// Novo IPC handler: ia.conversas.exportar
// Main process: gera string → dialog.showSaveDialog → writeFile

async function handleExportarMd() {
  await client['ia.conversas.exportar']({
    conversa_id: conversa_ativa_id,
    formato: 'md',
  })
  toast.success('Chat exportado!')
}
```

**Exportar .json (arquivo):**

```typescript
async function handleExportarJson() {
  await client['ia.conversas.exportar']({
    conversa_id: conversa_ativa_id,
    formato: 'json',
  })
  toast.success('Chat exportado!')
}
```

#### 3.3 — Formato Markdown do export

```typescript
// src/renderer/src/lib/chat-export.ts (novo)

export function formatChatAsMarkdown(mensagens: IaMensagem[], titulo: string): string {
  const lines: string[] = []
  lines.push(`# ${titulo}`)
  lines.push(`*Exportado em ${new Date().toLocaleString('pt-BR')}*`)
  lines.push('')

  for (const m of mensagens) {
    if (m.papel === 'tool_result') continue

    const role = m.papel === 'usuario' ? '**Voce**' : '**IA**'
    lines.push(`### ${role}`)
    lines.push(m.conteudo)

    if (m.tool_calls?.length) {
      lines.push('')
      lines.push('<details><summary>Ferramentas utilizadas</summary>')
      lines.push('')
      for (const tc of m.tool_calls) {
        lines.push(`- **${tc.name}**${tc.args ? `: \`${JSON.stringify(tc.args)}\`` : ''}`)
      }
      lines.push('</details>')
    }

    if (m.anexos?.length) {
      lines.push('')
      for (const a of m.anexos) {
        lines.push(`> Anexo: ${a.nome} (${a.mime_type})`)
      }
    }

    lines.push('')
    lines.push('---')
    lines.push('')
  }

  return lines.join('\n')
}
```

#### 3.4 — IPC handler novo (tipc.ts)

```typescript
const iaConversasExportar = t.procedure
  .input<{ conversa_id: string; formato: 'md' | 'json' }>()
  .action(async ({ input }) => {
    const { dialog } = require('electron')
    const { writeFile } = require('node:fs/promises')

    // Busca msgs
    const msgs = await queryAll<any>(
      `SELECT papel, conteudo, timestamp, tool_calls_json, anexos_meta_json
       FROM ia_mensagens WHERE conversa_id = $1 ORDER BY timestamp`,
      input.conversa_id,
    )
    const conversa = await queryOne<any>(
      'SELECT titulo FROM ia_conversas WHERE id = $1',
      input.conversa_id,
    )
    const titulo = conversa?.titulo ?? 'Chat IA'

    // Parse msgs
    const mensagens = msgs.map(m => ({
      ...m,
      tool_calls: m.tool_calls_json ? JSON.parse(m.tool_calls_json) : undefined,
      anexos: m.anexos_meta_json ? JSON.parse(m.anexos_meta_json) : undefined,
    }))

    let content: string
    let ext: string
    if (input.formato === 'json') {
      content = JSON.stringify({ titulo, exportado_em: new Date().toISOString(), mensagens }, null, 2)
      ext = 'json'
    } else {
      content = formatChatAsMarkdownServer(mensagens, titulo)
      ext = 'md'
    }

    const { filePath } = await dialog.showSaveDialog({
      title: 'Exportar conversa',
      defaultPath: `escalaflow-chat-${titulo.slice(0, 30).replace(/[^a-zA-Z0-9]/g, '-')}.${ext}`,
      filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
    })

    if (filePath) {
      await writeFile(filePath, content, 'utf-8')
      return { exportado: true, caminho: filePath }
    }
    return { exportado: false }
  })
```

---

## Feature 4: Edit Mensagem + Fork Simples

### O Approach: Fork Simples (nao complexo)

Quando o usuario edita uma msg:
1. **Remove todas as mensagens ABAIXO** daquela (inclusive resposta da IA)
2. **Atualiza o conteudo** da mensagem editada
3. **Resubmit** automaticamente pra IA
4. Resultado: como se a conversa tivesse sido "cortada" naquele ponto e reenviada

**NAO faz:**
- ❌ Branch/fork paralelo (complexo demais, sem valor real)
- ❌ Historico de versoes da mensagem
- ❌ Diff visual

### Mudancas

#### 4.1 — IPC handler: deletar msgs depois de timestamp (tipc.ts)

```typescript
const iaMensagensDeletarApos = t.procedure
  .input<{ conversa_id: string; timestamp: string }>()
  .action(async ({ input }) => {
    // Deleta todas as msgs com timestamp >= input.timestamp
    // (ou timestamp > input.timestamp se quiser manter a propria)
    await execute(
      `DELETE FROM ia_mensagens WHERE conversa_id = $1 AND timestamp > $2`,
      input.conversa_id,
      input.timestamp,
    )
    // Limpa resumo_compactado (invalidado pela edicao)
    await execute(
      `UPDATE ia_conversas SET resumo_compactado = NULL WHERE id = $1`,
      input.conversa_id,
    )
    return { ok: true }
  })
```

#### 4.2 — IPC handler: atualizar conteudo de msg (tipc.ts)

```typescript
const iaMensagensAtualizar = t.procedure
  .input<{ id: string; conteudo: string }>()
  .action(async ({ input }) => {
    await execute(
      `UPDATE ia_mensagens SET conteudo = $1 WHERE id = $2`,
      input.conteudo,
      input.id,
    )
    return { ok: true }
  })
```

#### 4.3 — Store: acao editarEReenviar (iaStore.ts)

```typescript
editarEReenviar: async (msgId: string, novoConteudo: string) => {
  const { mensagens, conversa_ativa_id } = get()
  const msgIndex = mensagens.findIndex(m => m.id === msgId)
  if (msgIndex < 0 || !conversa_ativa_id) return

  const msg = mensagens[msgIndex]

  // 1. Deletar msgs posteriores no DB
  await client['ia.mensagens.deletarApos']({
    conversa_id: conversa_ativa_id,
    timestamp: msg.timestamp,
  })

  // 2. Atualizar conteudo da msg no DB
  await client['ia.mensagens.atualizar']({
    id: msgId,
    conteudo: novoConteudo,
  })

  // 3. Atualizar state local — cortar mensagens e atualizar conteudo
  const novasMensagens = mensagens.slice(0, msgIndex)
  novasMensagens.push({ ...msg, conteudo: novoConteudo })
  set({ mensagens: novasMensagens })

  // 4. Return novoConteudo — IaChatView vai chamar enviar() com esse texto
  return novoConteudo
}
```

#### 4.4 — UI: inline edit no IaMensagemBubble

Quando usuario clica no icone Pencil:

```tsx
// IaChatView.tsx
const [editingMsgId, setEditingMsgId] = useState<string | null>(null)
const [editText, setEditText] = useState('')

const handleStartEdit = (msg: IaMensagem) => {
  setEditingMsgId(msg.id)
  setEditText(msg.conteudo)
}

const handleConfirmEdit = async () => {
  if (!editingMsgId || !editText.trim()) return
  const novoConteudo = await editarEReenviar(editingMsgId, editText.trim())
  setEditingMsgId(null)
  setEditText('')
  if (novoConteudo) {
    // Trigger reenvio automatico
    await enviar(novoConteudo)
  }
}

const handleCancelEdit = () => {
  setEditingMsgId(null)
  setEditText('')
}
```

No render de cada mensagem:

```tsx
{editingMsgId === m.id ? (
  <div className="flex flex-col gap-2 w-full max-w-[88%] self-end">
    <Textarea
      value={editText}
      onChange={e => setEditText(e.target.value)}
      className="resize-none text-sm"
      rows={3}
      autoFocus
    />
    <div className="flex gap-1 justify-end">
      <Button size="sm" variant="ghost" onClick={handleCancelEdit}>Cancelar</Button>
      <Button size="sm" onClick={handleConfirmEdit}>Reenviar</Button>
    </div>
  </div>
) : (
  <IaMensagemBubble
    msg={m}
    onEdit={m.papel === 'usuario' ? handleStartEdit : undefined}
    showActions={!carregando}
  />
)}
```

---

## Feature 5: Timeout Banner (ja incluida na Feature 1)

Ja descrita na secao 1.7.

---

## Arquivos a Modificar

| # | Arquivo | O que muda |
|---|---------|------------|
| 1 | `src/shared/types.ts` | +`estimated_seconds?` no IaStreamEvent `tool-call-start` |
| 2 | `src/renderer/src/lib/tool-labels.ts` | NOVO — labels PT-BR + estimativas de tempo por tool |
| 3 | `src/renderer/src/lib/chat-export.ts` | NOVO — `formatChatAsMarkdown()` |
| 4 | `src/main/ia/cliente.ts` | Emitir `estimated_seconds` no stream event |
| 5 | `src/renderer/src/store/iaStore.ts` | +`started_at` e `estimated_seconds` no `tools_em_andamento`, +`editarEReenviar` |
| 6 | `src/renderer/src/componentes/IaMensagemBubble.tsx` | +Copy button hover, +Pencil edit button, +props |
| 7 | `src/renderer/src/componentes/IaChatView.tsx` | +`ToolProgressPill` com countdown, +timeout banner, +edit inline, +showActions |
| 8 | `src/renderer/src/componentes/IaChatHeader.tsx` | +DropdownMenu 3 pontinhos (Nova, Copiar, Export .md, Export .json) |
| 9 | `src/main/tipc.ts` | +`ia.conversas.exportar`, +`ia.mensagens.deletarApos`, +`ia.mensagens.atualizar` |

**Arquivos novos: 2** (`tool-labels.ts`, `chat-export.ts`)
**Arquivos modificados: 7**

---

## Ordem de Execucao

```
Fase 1 — Infra (nao visual)
  1. types.ts → estimated_seconds no IaStreamEvent
  2. tool-labels.ts → labels + estimativas
  3. chat-export.ts → formatChatAsMarkdown
  4. tipc.ts → 3 novos IPC handlers

Fase 2 — Backend
  5. cliente.ts → emitir estimated_seconds

Fase 3 — Store
  6. iaStore.ts → started_at, estimated_seconds, editarEReenviar

Fase 4 — UI
  7. IaMensagemBubble.tsx → copy + edit buttons
  8. IaChatView.tsx → ToolProgressPill + timeout banner + edit inline
  9. IaChatHeader.tsx → DropdownMenu 3 pontinhos

Fase 5 — Verificacao
  10. npm run typecheck → 0 erros
```

---

## Verificacao

| # | Teste | O que verificar |
|---|-------|-----------------|
| 1 | `npm run typecheck` | 0 erros |
| 2 | Enviar msg, IA chama tool | Pill mostra label PT-BR + countdown (ex: "Consultando dados (2s / ~3s)") |
| 3 | IA chama gerar_escala | Pill mostra "Gerando escala (5s / ~30s)" com countdown real |
| 4 | 15s sem evento | Banner "Ainda processando..." aparece |
| 5 | Hover em mensagem assistente | Copy icon aparece |
| 6 | Clicar copy | Texto copiado, icon vira Check verde 2s |
| 7 | Hover em mensagem usuario | Copy + Pencil icons aparecem |
| 8 | Clicar Pencil | Textarea inline com texto atual, botoes Cancelar/Reenviar |
| 9 | Confirmar edit | Msgs abaixo removidas, IA recebe novo texto, responde |
| 10 | 3 pontinhos → Copiar chat | Chat completo no clipboard como markdown |
| 11 | 3 pontinhos → Exportar .md | Dialog salvar, gera arquivo .md |
| 12 | 3 pontinhos → Exportar .json | Dialog salvar, gera arquivo .json |
| 13 | 3 pontinhos → Nova conversa | Funciona como antes |
| 14 | Edit durante streaming | Botoes de edit desabilitados (showActions=false) |
| 15 | Chat vazio → 3 pontinhos | Copiar/Exportar desabilitados |

---

## Riscos e Mitigacoes

| Risco | Mitigacao |
|-------|-----------|
| Countdown impreciso (tool demora mais que estimativa) | Pill continua contando alem do estimado, nao explode |
| Edit/fork invalida compaction | Handler `deletarApos` limpa `resumo_compactado` |
| Export de chat grande (100+ msgs) | Paginacao nao necessaria — markdown e leve. JSON tbm |
| `navigator.clipboard` falha (permissao) | Fallback: `document.execCommand('copy')` ou toast de erro |
| Timer do countdown vaza (component unmount) | Cleanup no useEffect return |
