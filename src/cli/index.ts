#!/usr/bin/env node
import { Command } from 'commander'
import { readFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { resolveToolServerUrl } from '../shared/tool-server-url'
import { isTerminalExecSuccess } from '../shared/types'
import { buildToolServerAuthHeaders } from '../node/tool-server-auth'

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const TOOL_SERVER = resolveToolServerUrl()

const NOT_RUNNING_MSG =
  'EscalaFlow nao esta rodando. Abra o app primeiro.'

function authHeaders(): Record<string, string> {
  return buildToolServerAuthHeaders()
}

function authTokenForEnv(): string | null {
  const authorization = authHeaders().Authorization
  return authorization ? authorization.replace(/^Bearer\s+/i, '') : null
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface ServerErrorPayload {
  status?: string
  message?: string
  readiness?: {
    ok?: boolean
    provider?: string | null
    model?: string | null
    reason?: string
    message?: string
    action?: string
  }
}

function formatServerError(status: number, text: string): string {
  try {
    const parsed = JSON.parse(text) as ServerErrorPayload
    const readiness = parsed.readiness
    const message = readiness?.message || parsed.message || text
    const action = readiness?.action
    const provider = readiness?.provider ? `\nProvider: ${readiness.provider}` : ''
    const model = readiness?.model ? `\nModelo: ${readiness.model}` : ''
    const actionLine = action ? `\nAcao: ${action}` : ''
    return `Erro do EscalaFlow (${status}): ${message}${provider}${model}${actionLine}`
  } catch {
    return `Erro do EscalaFlow (${status}): ${text}`
  }
}

async function checkHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${TOOL_SERVER}/health`, { headers: authHeaders() })
    if (!res.ok) return false
    return true
  } catch (err: unknown) {
    if (isConnectionRefused(err)) {
      console.error(NOT_RUNNING_MSG)
    } else {
      console.error('Erro ao verificar saude do servidor:', (err as Error).message)
    }
    return false
  }
}

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  try {
    const res = await fetch(`${TOOL_SERVER}/tool`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ name, args })
    })

    if (!res.ok) {
      const text = await res.text()
      console.error(formatServerError(res.status, text))
      process.exit(1)
    }

    return await res.json()
  } catch (err: unknown) {
    if (isConnectionRefused(err)) {
      console.error(NOT_RUNNING_MSG)
    } else {
      console.error('Erro de conexao:', (err as Error).message)
    }
    process.exit(1)
  }
}

async function fetchJson(url: string): Promise<unknown> {
  try {
    const res = await fetch(url, { headers: authHeaders() })
    if (!res.ok) {
      const text = await res.text()
      console.error(formatServerError(res.status, text))
      process.exit(1)
    }
    return await res.json()
  } catch (err: unknown) {
    if (isConnectionRefused(err)) {
      console.error(NOT_RUNNING_MSG)
    } else {
      console.error('Erro de conexao:', (err as Error).message)
    }
    process.exit(1)
  }
}

function parseJsonArg(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('JSON precisa ser um objeto.')
    }
    return parsed as Record<string, unknown>
  } catch (err) {
    console.error(`JSON invalido em --json. ${(err as Error).message}`)
    process.exit(1)
  }
}

async function postJson(pathname: string, body: Record<string, unknown>): Promise<unknown> {
  try {
    const res = await fetch(`${TOOL_SERVER}${pathname}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const text = await res.text()
      console.error(formatServerError(res.status, text))
      process.exit(1)
    }
    return await res.json()
  } catch (err: unknown) {
    if (isConnectionRefused(err)) console.error(NOT_RUNNING_MSG)
    else console.error('Erro de conexao:', (err as Error).message)
    process.exit(1)
  }
}

function printJson(data: unknown): void {
  console.log(JSON.stringify(data, null, 2))
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks).toString('utf-8')
}

function isConnectionRefused(err: unknown): boolean {
  if (err && typeof err === 'object') {
    const code = (err as { code?: string }).code
    const cause = (err as { cause?: { code?: string } }).cause
    const message = (err as { message?: string }).message
    return code === 'ECONNREFUSED' || cause?.code === 'ECONNREFUSED' || message === 'fetch failed'
  }
  return false
}

async function ensureChatReady(): Promise<void> {
  try {
    const res = await fetch(`${TOOL_SERVER}/chat/preflight`, { headers: authHeaders() })
    const text = await res.text()
    if (res.ok) return

    console.error(formatServerError(res.status, text))
    process.exit(1)
  } catch (err: unknown) {
    if (isConnectionRefused(err)) console.error(NOT_RUNNING_MSG)
    else console.error('Erro ao verificar chat:', (err as Error).message)
    process.exit(1)
  }
}

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

// Tool server returns flat objects from toolOk():
// { status, summary, total?, melhor_score?, context_for_llm?, _meta?, ... }
interface ToolResponse {
  status: string
  summary?: string
  total?: number
  melhor_score?: number
  context_for_llm?: string
  sugestao_refinamento?: string | null
  _meta?: Record<string, unknown>
  [key: string]: unknown
}

function formatChatResults(data: ToolResponse, query: string): void {
  if (!data.total || data.total === 0) {
    console.log(`Nenhum resultado encontrado para: ${query}`)
    if (data.sugestao_refinamento) console.log(`  Dica: ${data.sugestao_refinamento}`)
    return
  }

  console.log(`\n  ${data.summary ?? `${data.total} resultado(s)`}\n`)
  if (data.context_for_llm) {
    // Show first 500 chars of context as preview
    const preview = data.context_for_llm.slice(0, 500).replace(/\n{3,}/g, '\n\n')
    console.log(preview)
    if (data.context_for_llm.length > 500) console.log('  ...(truncado)')
  }
  console.log()
}

function formatSearchResults(data: ToolResponse, term: string): void {
  if (!data.total || data.total === 0) {
    console.log(`Nenhum resultado encontrado para: ${term}`)
    if (data.sugestao_refinamento) console.log(`  Dica: ${data.sugestao_refinamento}`)
    return
  }

  console.log(`\n  ${data.total} resultado(s) para "${term}"`)
  console.log(`  Melhor score: ${data.melhor_score != null ? (data.melhor_score * 100).toFixed(1) + '%' : 'n/a'}`)
  console.log('  ' + '-'.repeat(60))

  if (data.context_for_llm) {
    console.log(data.context_for_llm.slice(0, 1000).replace(/\n{3,}/g, '\n\n'))
    if (data.context_for_llm.length > 1000) console.log('  ...(truncado)')
  }
  console.log('  ' + '-'.repeat(60))
  console.log()
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const program = new Command()

program
  .name('escalaflow')
  .description('EscalaFlow CLI — chat, search and manage your knowledge base')
  .version('1.0.0')

// -- chat ------------------------------------------------------------------

program
  .command('chat [message]')
  .description('Conversa com a IA do EscalaFlow pelo app aberto')
  .option('--attach', 'Alias semantico para conectar ao app aberto')
  .action(async (message?: string) => {
    await ensureChatReady()

    if (message && message.trim()) {
      const data = await postJson('/chat', {
        message,
        history: [],
        context: { page: 'cli', route: '/cli' },
        stream: false,
      }) as { response?: string }
      console.log(data.response ?? '')
      return
    }

    const readline = await import('node:readline/promises')
    const { stdin, stdout } = await import('node:process')
    const rl = readline.createInterface({ input: stdin, output: stdout })
    const history: Array<{ id: string; papel: 'usuario' | 'assistente'; conteudo: string; timestamp: string }> = []
    console.log('EscalaFlow chat conectado e IA validada. Digite "sair" para encerrar.')

    while (true) {
      const input = await rl.question('Voce > ')
      const trimmed = input.trim()
      if (!trimmed) continue
      if (trimmed.toLowerCase() === 'sair' || trimmed.toLowerCase() === 'exit') break

      const data = await postJson('/chat', {
        message: trimmed,
        history,
        context: { page: 'cli', route: '/cli' },
        stream: false,
      }) as { response?: string }
      const response = data.response ?? ''
      console.log(`IA > ${response}`)
      const timestamp = new Date().toISOString()
      history.push({ id: `cli_user_${history.length}`, papel: 'usuario', conteudo: trimmed, timestamp })
      history.push({ id: `cli_ai_${history.length}`, papel: 'assistente', conteudo: response, timestamp: new Date().toISOString() })
    }

    rl.close()
  })

// -- search ----------------------------------------------------------------

program
  .command('search <term>')
  .description('Busca detalhada com scores e fontes')
  .action(async (term: string) => {
    const data = await callTool('buscar_conhecimento', { consulta: term })
    formatSearchResults(data as ToolResponse, term)
  })

// -- import ----------------------------------------------------------------

program
  .command('import <file>')
  .description('Importa arquivo para o knowledge base')
  .action(async (file: string) => {
    let conteudo: string
    try {
      conteudo = readFileSync(file, 'utf-8')
    } catch (err: unknown) {
      console.error(`Erro ao ler arquivo: ${(err as Error).message}`)
      process.exit(1)
    }

    const filename = basename(file)
    const bytes = Buffer.byteLength(conteudo, 'utf-8')

    await callTool('salvar_conhecimento', { titulo: filename, conteudo })
    console.log(`Importado: ${filename} (${bytes} bytes)`)
  })

// -- status ----------------------------------------------------------------

program
  .command('status')
  .description('Status do EscalaFlow e estatisticas do knowledge base')
  .action(async () => {
    const healthy = await checkHealth()
    if (!healthy) {
      process.exit(1)
    }

    const health = (await fetchJson(`${TOOL_SERVER}/health`)) as {
      app?: string
      version?: string
      tools?: number
      db?: { connected?: boolean; error?: string }
      ia?: {
        provider?: string | null
        modelo?: string | null
        ativo?: boolean
        readiness?: { ok?: boolean; message?: string; action?: string }
      }
      status?: string
      issues?: string[]
    }

    console.log(`\n  ${health.app ?? 'EscalaFlow'} v${health.version ?? '?'}  (${health.tools ?? '?'} tools)`)
    console.log(`  Server: ${health.status ?? 'ok'}`)
    console.log(`  DB:     ${health.db?.connected ? 'conectado' : `degradado${health.db?.error ? ` (${health.db.error})` : ''}`}`)
    if (health.ia) {
      console.log(`  IA:     ${health.ia.provider ?? 'n/a'} / ${health.ia.modelo ?? 'n/a'}`)
      if (health.ia.readiness?.message) {
        console.log(`  Chat:   ${health.ia.readiness.ok ? 'pronto' : 'bloqueado'} - ${health.ia.readiness.message}`)
        if (health.ia.readiness.action) console.log(`  Acao:   ${health.ia.readiness.action}`)
      }
    }
    if (health.issues?.length) console.log(`  Issues: ${health.issues.join('; ')}`)
    console.log()
  })

// -- tools -----------------------------------------------------------------

program
  .command('tools')
  .description('Lista tools disponiveis no servidor')
  .action(async () => {
    const tools = (await fetchJson(`${TOOL_SERVER}/tools`)) as Array<{
      name: string
      description?: string
    }>

    if (!Array.isArray(tools) || tools.length === 0) {
      console.log('Nenhuma tool disponivel.')
      return
    }

    console.log(`\n  ${tools.length} tool(s) disponiveis:\n`)
    for (const t of tools) {
      console.log(`  - ${t.name}`)
      if (t.description) {
        console.log(`    ${t.description}`)
      }
    }
    console.log()
  })

program
  .command('tool <name>')
  .description('Executa uma tool do app')
  .option('--json <json>', 'Argumentos da tool em JSON')
  .action(async (name: string, options: { json?: string }) => {
    const args = parseJsonArg(options.json)
    const data = await callTool(name, args)
    printJson(data)
  })

const rag = program.command('rag').description('Comandos de RAG')

rag
  .command('search <query>')
  .description('Busca na base RAG')
  .action(async (query: string) => {
    const data = await callTool('buscar_conhecimento', { consulta: query })
    formatSearchResults(data as ToolResponse, query)
  })

rag
  .command('import <path>')
  .description('Importa arquivo ou pasta para o RAG')
  .option('--group <name>', 'Nome do grupo')
  .option('--recursive', 'Inclui subpastas', true)
  .option('--no-recursive', 'Nao inclui subpastas')
  .option('--wait', 'Aguarda o job terminar e imprime o resultado final')
  .option('--enrich', 'Forca enrichment automatico ao fim da importacao')
  .option('--no-enrich', 'Desativa enrichment automatico para este import')
  .action(async (targetPath: string, options: { group?: string; recursive?: boolean; wait?: boolean; enrich?: boolean }) => {
    const resolvedPath = resolve(targetPath)
    const groupName = options.group?.trim() || basename(resolvedPath)
    const data = await postJson('/rag/import', {
      path: resolvedPath,
      group_name: groupName,
      recursive: options.recursive !== false,
      ...(typeof options.enrich === 'boolean' ? { auto_enrich: options.enrich } : {}),
    }) as {
      app_job?: { id: string; status: string }
      import_job?: {
        id: number
        status: string
        processed_files?: number
        total_files?: number
        error_message?: string | null
      }
      job?: { id: string; status: string }
    }

    const appJob = data.app_job ?? data.job
    const importJob = data.import_job
    if (!appJob?.id || !importJob?.id) {
      console.error('Servidor nao retornou job de importacao.')
      process.exit(1)
    }

    console.log(`Job iniciado: app=${appJob.id} rag=${importJob.id} (${appJob.status})`)

    if (!options.wait) {
      console.log(`Use: escalaflow rag job ${importJob.id}  ou  escalaflow rag cancel ${importJob.id}`)
      return
    }

    while (true) {
      const current = await fetchJson(`${TOOL_SERVER}/rag/jobs/${encodeURIComponent(String(importJob.id))}`) as {
        job?: {
          status: string
          processed_files?: number
          total_files?: number
          chunks_created?: number
          failed_files?: number
          error_message?: string | null
        }
      }
      const job = current.job
      if (!job) {
        console.error(`Job RAG "${importJob.id}" nao encontrado.`)
        process.exit(1)
      }

      const done = job.processed_files ?? 0
      const total = job.total_files ?? 0
      process.stdout.write(`\r${job.status} ${done}/${total}`)

      if (['done', 'failed', 'cancelled'].includes(job.status)) {
        process.stdout.write('\n')
        printJson(job)
        if (job.status === 'failed') process.exit(1)
        return
      }

      await new Promise((resolvePoll) => setTimeout(resolvePoll, 1000))
    }
  })

rag.command('jobs').description('Lista jobs persistentes de importacao RAG').action(async () => {
  printJson(await fetchJson(`${TOOL_SERVER}/rag/jobs`))
})

rag.command('job <id>').description('Mostra progresso e arquivos de um job RAG').action(async (id: string) => {
  printJson(await fetchJson(`${TOOL_SERVER}/rag/jobs/${encodeURIComponent(id)}`))
})

rag.command('cancel <id>').description('Cancela um job RAG persistente').action(async (id: string) => {
  printJson(await postJson(`/rag/jobs/${encodeURIComponent(id)}/cancel`, {}))
})

rag.command('pause <id>').description('Pausa um job RAG persistente').action(async (id: string) => {
  printJson(await postJson(`/rag/jobs/${encodeURIComponent(id)}/pause`, {}))
})

rag.command('resume <id>').description('Retoma um job RAG persistente').action(async (id: string) => {
  printJson(await postJson(`/rag/jobs/${encodeURIComponent(id)}/resume`, {}))
})

rag
  .command('enrich')
  .description('Enriquece chunks de um grupo RAG')
  .requiredOption('--group <id>', 'ID numerico do grupo RAG')
  .option('--provider <provider>', 'auto, local, gemini ou openrouter')
  .option('--model <model>', 'Modelo a usar')
  .option('--force-all', 'Reprocessa chunks ja enriquecidos')
  .action(async (options: { group: string; provider?: string; model?: string; forceAll?: boolean }) => {
    printJson(await postJson(`/rag/groups/${encodeURIComponent(options.group)}/enrich`, {
      provider: options.provider,
      modelo: options.model,
      force_all: Boolean(options.forceAll),
    }))
  })

const jobs = program.command('jobs').description('Jobs locais')

jobs.command('list').action(async () => {
  printJson(await fetchJson(`${TOOL_SERVER}/jobs`))
})

jobs.command('cancel <id>').action(async (id: string) => {
  printJson(await postJson(`/jobs/${encodeURIComponent(id)}/cancel`, {}))
})

jobs.command('pause <id>').action(async (id: string) => {
  printJson(await postJson(`/jobs/${encodeURIComponent(id)}/pause`, {}))
})

jobs.command('resume <id>').action(async (id: string) => {
  printJson(await postJson(`/jobs/${encodeURIComponent(id)}/resume`, {}))
})

const terminal = program.command('terminal').description('Harness local de terminal e arquivos')

terminal
  .command('exec <command...>')
  .description('Executa comando no computador local via app aberto')
  .option('--cwd <path>', 'Diretorio de trabalho')
  .option('--timeout <ms>', 'Timeout em ms', (value) => Number(value))
  .option('--wait', 'Aguarda resultado em vez de criar job')
  .action(async (commandParts: string[], options: { cwd?: string; timeout?: number; wait?: boolean }) => {
    const command = commandParts.join(' ')
    const data = await postJson('/terminal/exec', {
      command,
      cwd: options.cwd,
      timeout_ms: options.timeout,
      wait: Boolean(options.wait),
    }) as {
      status: string
      job?: { id: string; status: string }
      result?: { stdout: string; stderr: string; exit_code: number | null; timed_out: boolean; signal: string | null }
      message?: string
      command?: string
      cwd?: string
    }

    if (data.status === 'pending_approval') {
      console.log(`Pendente de aprovacao: ${data.command}`)
      if (data.cwd) console.log(`cwd: ${data.cwd}`)
      if (data.message) console.log(data.message)
      return
    }

    if (!options.wait) {
      console.log(`Job iniciado: ${data.job?.id} (${data.job?.status})`)
      return
    }

    if (data.result?.stdout) process.stdout.write(data.result.stdout)
    if (data.result?.stderr) process.stderr.write(data.result.stderr)
    if (data.result && !isTerminalExecSuccess(data.result)) {
      if (data.result.timed_out) process.stderr.write('\n[timeout]\n')
      process.exit(data.result.exit_code ?? 1)
    }
  })

terminal
  .command('open-cli')
  .description('Abre o EscalaFlow CLI no Terminal do sistema')
  .option('--command <command>', 'Comando a abrir', 'npm run cli -- chat --attach')
  .option('--cwd <path>', 'Diretorio de trabalho')
  .action(async (options: { command?: string; cwd?: string }) => {
    printJson(await postJson('/terminal/open-cli', {
      command: options.command,
      cwd: options.cwd ? resolve(options.cwd) : undefined,
    }))
  })

terminal
  .command('read <file>')
  .description('Le arquivo local via app aberto')
  .option('--max-bytes <n>', 'Limite de leitura', (value) => Number(value))
  .action(async (file: string, options: { maxBytes?: number }) => {
    const data = await postJson('/terminal/read-file', {
      path: resolve(file),
      max_bytes: options.maxBytes,
    }) as { file?: { content: string; truncated: boolean } }

    process.stdout.write(data.file?.content ?? '')
    if (data.file?.truncated) {
      process.stderr.write('\n[truncated]\n')
    }
  })

terminal
  .command('write <file>')
  .description('Escreve arquivo local via app aberto')
  .option('--content <text>', 'Conteudo literal')
  .option('--stdin', 'Le conteudo do stdin')
  .action(async (file: string, options: { content?: string; stdin?: boolean }) => {
    const content = options.stdin ? await readStdin() : options.content
    if (content === undefined) {
      console.error('Use --content <text> ou --stdin.')
      process.exit(1)
    }
    printJson(await postJson('/terminal/write-file', {
      path: resolve(file),
      content,
    }))
  })

const solver = program.command('solver').description('Comandos do motor de escalas')

solver
  .command('list-setores')
  .description('Lista setores via tool consultar')
  .action(async () => {
    printJson(await callTool('consultar', { entidade: 'setores', limite: 100 }))
  })

solver
  .command('preflight')
  .requiredOption('--setor <id>', 'ID do setor')
  .requiredOption('--inicio <date>', 'Data inicial YYYY-MM-DD')
  .requiredOption('--fim <date>', 'Data final YYYY-MM-DD')
  .action(async (options: { setor: string; inicio: string; fim: string }) => {
    printJson(await postJson('/solver/preflight', {
      setor_id: Number(options.setor),
      data_inicio: options.inicio,
      data_fim: options.fim,
    }))
  })

solver
  .command('generate')
  .requiredOption('--setor <id>', 'ID do setor')
  .requiredOption('--inicio <date>', 'Data inicial YYYY-MM-DD')
  .requiredOption('--fim <date>', 'Data final YYYY-MM-DD')
  .option('--full', 'Retorna output completo do solver')
  .action(async (options: { setor: string; inicio: string; fim: string; full?: boolean }) => {
    printJson(await postJson('/solver/generate', {
      setor_id: Number(options.setor),
      data_inicio: options.inicio,
      data_fim: options.fim,
      summary: !options.full,
    }))
  })

program
  .command('mcp')
  .description('Utilitarios MCP')
  .command('config')
  .description('Imprime configuracao MCP local')
  .action(() => {
    const token = authTokenForEnv()
    printJson({
      mcpServers: {
        escalaflow: {
          command: 'npm',
          args: ['run', 'mcp:dev'],
          cwd: process.cwd(),
          env: {
            ESCALAFLOW_TOOL_SERVER: TOOL_SERVER,
            ...(token ? { ESCALAFLOW_TOOL_SERVER_TOKEN: token } : {}),
          },
        },
      },
    })
  })

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

program.parse()
