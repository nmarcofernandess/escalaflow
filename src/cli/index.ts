#!/usr/bin/env node
import { Command } from 'commander'

const TOOL_SERVER = process.env.ESCALAFLOW_TOOL_SERVER || 'http://127.0.0.1:17380'
const NOT_RUNNING_MSG = 'EscalaFlow nao esta rodando. Abra o app primeiro.'

async function fetchJson(url: string): Promise<unknown> {
  try {
    const res = await fetch(url)
    if (!res.ok) {
      const text = await res.text()
      console.error(`Erro do servidor (${res.status}):`, text)
      process.exit(1)
    }
    return await res.json()
  } catch (err: unknown) {
    if (isConnectionRefused(err)) console.error(NOT_RUNNING_MSG)
    else console.error('Erro de conexao:', (err as Error).message)
    process.exit(1)
  }
}

async function postJson(pathname: string, body: Record<string, unknown>): Promise<unknown> {
  try {
    const res = await fetch(`${TOOL_SERVER}${pathname}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const text = await res.text()
      console.error(`Erro do servidor (${res.status}):`, text)
      process.exit(1)
    }
    return await res.json()
  } catch (err: unknown) {
    if (isConnectionRefused(err)) console.error(NOT_RUNNING_MSG)
    else console.error('Erro de conexao:', (err as Error).message)
    process.exit(1)
  }
}

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  return postJson('/tool', { name, args })
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

function printJson(data: unknown): void {
  console.log(JSON.stringify(data, null, 2))
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

const program = new Command()

program
  .name('escalaflow')
  .description('EscalaFlow CLI - chat, tools and schedule solver control')
  .version('1.0.0')

program
  .command('status')
  .description('Status do EscalaFlow e do tool server local')
  .action(async () => {
    const health = await fetchJson(`${TOOL_SERVER}/health`) as {
      app?: string
      version?: string
      tools?: number
      ia?: { provider?: string | null; modelo?: string | null }
    }
    console.log(`\n  ${health.app ?? 'EscalaFlow'} v${health.version ?? '?'}  (${health.tools ?? '?'} tools)`)
    if (health.ia) {
      console.log(`  IA: ${health.ia.provider ?? 'n/a'} / ${health.ia.modelo ?? 'n/a'}`)
    }
    console.log()
  })

program
  .command('tools')
  .description('Lista tools disponiveis no servidor')
  .action(async () => {
    const tools = await fetchJson(`${TOOL_SERVER}/tools`) as Array<{ name: string; description?: string }>
    if (!Array.isArray(tools) || tools.length === 0) {
      console.log('Nenhuma tool disponivel.')
      return
    }

    console.log(`\n  ${tools.length} tool(s) disponiveis:\n`)
    for (const tool of tools) {
      console.log(`  - ${tool.name}`)
      if (tool.description) console.log(`    ${tool.description}`)
    }
    console.log()
  })

program
  .command('tool')
  .description('Executa uma tool do app')
  .argument('<name>', 'Nome da tool')
  .option('--json <json>', 'Argumentos da tool em JSON')
  .action(async (name: string, options: { json?: string }) => {
    const args = parseJsonArg(options.json)
    printJson(await callTool(name, args))
  })

program
  .command('chat')
  .description('Conversa com a IA do EscalaFlow pelo app aberto')
  .argument('[message]', 'Mensagem unica. Sem mensagem, abre REPL.')
  .option('--attach', 'Alias semantico para conectar ao app aberto')
  .action(async (message?: string) => {
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
    console.log('EscalaFlow chat conectado. Digite "sair" para encerrar.')

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

const jobs = program.command('jobs').description('Jobs locais')

jobs.command('list').action(async () => {
  printJson(await fetchJson(`${TOOL_SERVER}/jobs`))
})

jobs.command('cancel').argument('<id>').action(async (id: string) => {
  printJson(await postJson(`/jobs/${encodeURIComponent(id)}/cancel`, {}))
})

program
  .command('mcp')
  .description('Utilitarios MCP')
  .command('config')
  .description('Imprime configuracao MCP local')
  .action(() => {
    printJson({
      mcpServers: {
        escalaflow: {
          command: 'npm',
          args: ['run', 'mcp:dev'],
          cwd: process.cwd(),
        },
      },
    })
  })

program.parse()
