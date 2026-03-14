# MCP One-Click Connect — Design Spec

## TL;DR

Compilar o MCP server em binário nativo (Bun compile), empacotar no DMG, e oferecer botão de 1 clique na UI pra conectar Claude Code. Adicionar endpoint `/discovery` ao tool-server pra expor contexto dinâmico. Botão "Copiar Config" pra colar em qualquer IA que suporte MCP.

## Motivação

Hoje o setup do MCP requer Node.js + source code + comando manual no terminal. O público-alvo (devs e eventualmente RH) não deveria precisar de nada disso. O app já expõe HTTP em `127.0.0.1:17380` com 34 tools — falta só empacotar o proxy MCP como binário e automatizar a configuração.

## Decisões

| Decisão | Escolha | Razão |
|---------|---------|-------|
| Compilador | Bun compile | Single command, cross-compile, TS nativo, MCP SDK suporta Bun |
| Tamanho binário | ~90MB | Aceitável — Electron já é 200MB, solver 40MB |
| Discovery | Novo endpoint HTTP | Mesmo contexto da IA interna, sem duplicação |
| Config writing | `child_process.execFile` no main | Roda `claude mcp add` via args array (sem shell, seguro com espaços no path) |
| Fallback outras IAs | Copiar JSON pro clipboard | Genérico, funciona com qualquer tool MCP |

## Arquitetura

```
EscalaFlow.app (DMG)
├── Electron Main Process
│   └── tool-server HTTP 127.0.0.1:17380
│       ├── GET /health
│       ├── GET /tools
│       ├── GET /instructions
│       ├── GET /discovery         ← NOVO
│       ├── GET /discovery?setor=N ← NOVO
│       └── POST /tool
├── solver-bin/escalaflow-solver   (PyInstaller, já existe)
└── mcp-bin/escalaflow-mcp         (Bun compile, NOVO)
```

Fluxo MCP:
```
Claude Code → spawna escalaflow-mcp (stdio) → HTTP GET /tools, /instructions → proxy POST /tool
```

## Peça 1: Endpoint GET /discovery

**Arquivo:** `src/main/tool-server.ts`

Adicionar handler:
```
GET /discovery         → buildContextBriefing(syntheticCtx)
GET /discovery?setor=2 → buildContextBriefing(syntheticCtx com setor_id: 2)
```

**Contexto sintético:** `buildContextBriefing` retorna `""` se chamada sem `IaContexto`. O endpoint deve construir um contexto sintético:
```typescript
const syntheticCtx: IaContexto = {
  rota: '/mcp',
  pagina: 'externo',
  setor_id: parsedSetorId || undefined,
  colaborador_id: undefined
}
```

Adicionar `'externo'` ao `_dicaPagina()` em `discovery.ts`:
```typescript
externo: '\n💡 Contexto externo (MCP/terminal). Sem página visual — resolva nomes e IDs via tools.'
```

Retorna `{ discovery: string }` — o mesmo texto markdown que a IA interna recebe via `discovery.ts`.

**Contexto incluído:**
- Memórias do RH
- Resumo global (setores, colaboradores, escalas)
- Feriados próximos (30 dias)
- Regras com override
- Lista de setores com contagem de colaboradores
- Se `setor` query param: colaboradores, postos, exceções, demandas, escala atual
- Alertas proativos
- Status backup
- Stats knowledge base

**Nota:** Auto-RAG (busca semântica na mensagem do user) não entra aqui — depende de uma pergunta específica que não existe no contexto de discovery genérico.

## Peça 2: Compilar MCP Server

**Source:** `mcp-server/index.ts` (105 linhas, proxy HTTP → stdio MCP)

**Build:**
```bash
# Dev local / CI (compila nativo pro runner atual — sem --target)
cd mcp-server && bun install && cd ..
bun build --compile mcp-server/index.ts --outfile mcp-bin/escalaflow-mcp
```

Sem `--target` hardcoded — Bun compila nativamente pra arquitetura do runner. Cada CI runner (Mac ARM, Mac x64, Windows x64) gera o binário correto pro seu OS/arch. Mesmo padrão do solver (PyInstaller compila nativamente em cada runner).

No Windows, o outfile é `mcp-bin/escalaflow-mcp.exe`.

**npm script:**
```json
"mcp:build": "cd mcp-server && bun install && cd .. && bun build --compile mcp-server/index.ts --outfile mcp-bin/escalaflow-mcp"
```

**Dependências:** O `mcp-server/index.ts` importa `@modelcontextprotocol/sdk`. O `bun install` no subdiretório instala as deps. Bun resolve e embute no bundle automaticamente.

**.gitignore:** Adicionar `mcp-bin/` (binário gerado, não commitado — obrigatório pra evitar binário stale no repo).

## Peça 3: Empacotar no DMG

**Arquivo:** `electron-builder.yml`

Adicionar aos `extraResources`:
```yaml
- from: 'mcp-bin/'
  to: 'mcp-bin/'
  filter: ['**/*']
```

Resultado no app instalado:
```
/Applications/EscalaFlow.app/Contents/Resources/mcp-bin/escalaflow-mcp
```

## Peça 4: Resolver Path do Binário

**Novo arquivo:** `src/main/mcp-path.ts`

Segue o padrão de `resolveSolverPath()` em `solver-bridge.ts`:

```
Precedência:
1. Env var ESCALAFLOW_MCP_PATH (override explícito)
2. Dev: mcp-bin/escalaflow-mcp no cwd do projeto
3. Prod: process.resourcesPath + '/mcp-bin/escalaflow-mcp' (ou .exe no Windows)
4. Fallback dev: 'npx tsx mcp-server/index.ts' (source, requer Node)
```

Retorna o path absoluto ou throw se não encontrar.

## Peça 5: IPC Handlers

**Arquivo:** `src/main/tipc.ts`

Dois novos handlers:

### `mcp.path`
Retorna o path resolvido do binário MCP. Usado pela UI pra montar comandos.

### `mcp.connectClaudeCode`
1. Resolve o path do binário via `resolveMcpPath()`
2. Usa `execFile` (sem shell) com args array — seguro com espaços no path:
   ```typescript
   execFile('claude', ['mcp', 'add', 'escalaflow', '--transport', 'stdio', '--scope', 'user', '--', resolvedPath])
   ```
3. Retorna `{ success: boolean, message: string }`

Se `claude` CLI não estiver instalado, retorna erro amigável: "Claude Code não encontrado. Instale em https://claude.ai/download"

### `mcp.configJson`
Retorna o JSON no formato compatível com Claude Desktop / Cursor / Windsurf:
```json
{
  "mcpServers": {
    "escalaflow": {
      "command": "/path/to/escalaflow-mcp"
    }
  }
}
```
O path é resolvido dinamicamente via `resolveMcpPath()`. Sem campo `transport` — stdio é o default implícito na maioria dos clients MCP.

## Peça 6: UI Card

**Arquivo:** `src/renderer/src/paginas/ConfiguracoesPagina.tsx`

Redesign do card "Claude Code" → "Controle via Terminal"

**Posição:** Abaixo do card de IA existente.

**Layout:**
```
┌───────────────────────────────────────────────────────┐
│                                                       │
│  >_ Controle via Terminal                             │
│                                                       │
│  Use qualquer IA com MCP pra operar o EscalaFlow      │
│  direto do terminal. O app precisa estar aberto.      │
│                                                       │
│  [ Conectar Claude Code ]  [ Copiar Config MCP ]      │
│                                                       │
│  Status: ✅ Conectado / (vazio se nunca conectou)     │
│                                                       │
└───────────────────────────────────────────────────────┘
```

**Botão "Conectar Claude Code":**
- Chama IPC `mcp.connectClaudeCode`
- Loading state durante execução
- Sucesso: mostra "Reinicie o Claude Code pra ativar"
- Erro: mostra mensagem (Claude CLI não encontrado, etc)

**Botão "Copiar Config MCP":**
- Chama IPC `mcp.configJson` → copia pro clipboard
- Toast: "Config copiado! Cole no config da sua IA."

## Peça 7: CI/CD

**Arquivo:** `.github/workflows/release.yml`

Adicionar steps em ambos os runners (Mac + Windows), ANTES do electron-builder:

```yaml
- name: Install Bun
  uses: oven-sh/setup-bun@v2

- name: Install MCP server dependencies
  run: cd mcp-server && bun install

- name: Build MCP binary
  run: bun build --compile mcp-server/index.ts --outfile mcp-bin/escalaflow-mcp
```

No runner Windows, ajustar outfile pra `mcp-bin/escalaflow-mcp.exe`.

**Sem `--target`:** Cada runner compila nativamente pro seu OS/arch (Mac ARM, Mac x64, Win x64). Mesmo padrão do solver.

## Arquivos Tocados

| Arquivo | Ação |
|---------|------|
| `src/main/tool-server.ts` | Adicionar GET /discovery |
| `src/main/ia/discovery.ts` | Adicionar dica `'externo'` ao `_dicaPagina()` |
| `src/main/mcp-path.ts` | **Novo** — resolver path do binário MCP |
| `src/main/tipc.ts` | 3 handlers: mcp.path, mcp.connectClaudeCode, mcp.configJson |
| `src/renderer/src/paginas/ConfiguracoesPagina.tsx` | Redesign card MCP |
| `electron-builder.yml` | Adicionar mcp-bin/ aos extraResources |
| `.github/workflows/release.yml` | Steps Bun install + MCP build |
| `package.json` | Script mcp:build |
| `.gitignore` | Adicionar mcp-bin/ |
| `mcp-server/index.ts` | Possível ajuste pra funcionar melhor com Bun compile |

## Riscos

| Risco | Mitigação |
|-------|-----------|
| Stdio transport edge case no Bun | Testar E2E. Fallback: source + Node no dev |
| +90MB no DMG | Aceitável — Electron já é 200MB+ |
| `claude` CLI não instalada | Mensagem de erro amigável com link |
| Porta 17380 ocupada | Já tratado no tool-server (EADDRINUSE warning) |

## Fora de escopo

- Suporte a Claude Desktop (config diferente) — futuro
- Auth/HTTPS pra acesso remoto — não é caso de uso offline
- Auto-RAG no discovery (depende de mensagem do user) — não faz sentido pra endpoint genérico
