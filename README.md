# EscalaFlow

App desktop offline para gerar escalas de trabalho em supermercados, com motor de compliance CLT e interface para gestores de RH nao tecnicos.

---

## 1) O que o sistema entrega hoje

- Geracao automatica de escala otimizada por periodo (motor de 7 fases).
- Validacao de 10 regras CLT nomeadas (6 HARD bloqueantes + 4 SOFT alertas).
- Assistente IA Integrado (Gemini 2.5 Flash/Pro) contextual ao sistema.
- Simulacao iterativa: click na grid alterna TRABALHO/FOLGA, sistema recalcula em tempo real.
- Oficializacao com bloqueio de violacoes criticas.
- Export HTML self-contained para impressao (A4 landscape).
- Dark mode 100% funcional.
- 10 paginas + Perfil, 7 formularios com validacao Zod.
- App 100% offline — sem login, sem internet, sem servidor.

---

## 2) Stack

| Camada | Tecnologia |
|--------|-----------|
| Shell | Electron 34 |
| Build | electron-vite |
| IPC | @egoist/tipc (type-safe) |
| Database | SQLite via better-sqlite3 |
| Motor | Python OR-Tools (`solver/solver_ortools.py`) via bridge TS |
| IA | Integração nativa Google Gemini API (`generateContent`) |
| Frontend | React 19 + Vite |
| Estilo | Tailwind CSS + shadcn/ui (23 componentes) |
| Estado | Zustand |
| Formularios | Zod + react-hook-form + shadcn Form |
| Notificacoes | sonner |
| DnD | @dnd-kit |
| Roteamento | React Router v7 |

---

## 3) Setup inicial (primeira vez)

```bash
cd escalaflow
npm install
```

Pronto. O banco SQLite e criado automaticamente no primeiro `npm run dev` com seed de 4 tipos de contrato CLT.

---

## 3.1) Configurar o Assistente IA (Gemini)

O assistente usa a API do Google Gemini. Para ativar:

### Passo a passo para obter a API Key

1. Acesse [aistudio.google.com/apikey](https://aistudio.google.com/apikey)
2. Faca login com sua conta Google
3. Clique em **"Create API Key"**
4. Selecione um projeto Google Cloud (ou crie um novo)
5. Copie a chave gerada (formato: `AIza...`)

### Configurar no app

1. Abra o EscalaFlow
2. Va em **Configuracoes** (menu lateral inferior)
3. Na secao **Assistente IA**:
   - Ative o toggle **"Ativar Assistente"**
   - Selecione o modelo (`Gemini 2.5 Flash` e o recomendado — rapido e eficiente)
   - Cole a API Key no campo correspondente
4. Clique em **"Salvar IA"**
5. Clique em **"Testar"** para confirmar que esta funcionando

> **Custo:** A API do Gemini tem um tier gratuito generoso (suficiente para uso interno do RH). Verifique limites em [aistudio.google.com](https://aistudio.google.com).

---

## 4) Executar o sistema

```bash
npm run dev
```

Um comando. Abre o app Electron com hot reload (main + renderer).

---

## 5) Comandos

| Comando | O que faz |
|---------|-----------|
| `npm run dev` | Abre app Electron com hot reload |
| `npm run build` | Build de producao (main + preload + renderer) |
| `npm run preview` | Preview do build de producao |
| `npm run typecheck` | TypeScript check (node + web) |
| `npm run solver:test` | Smoke test no DB real com o motor Python real |
| `npm run pack` | Empacota sem gerar instalador |
| `npm run dist:mac` | Gera .dmg (macOS) localmente |
| `npm run dist:win` | Gera .exe installer (Windows) |
| `npm run dist:linux` | Gera .AppImage (Linux) |
| `npm run release:mac` | **Build + upload automatico para GitHub Releases** |

---

## 6) Tutorial operacional

### Passo 1 — Cadastre setores

Em `Setores`, crie os departamentos do supermercado (Caixa, Acougue, Padaria).
Defina horario de abertura e fechamento.

### Passo 2 — Defina demandas

Dentro de cada setor, cadastre as faixas de demanda:
- 08:00-10:00 = 3 pessoas
- 10:00-15:00 = 5 pessoas
- 15:00-19:30 = 4 pessoas

### Passo 3 — Cadastre colaboradores

Em `Colaboradores`, adicione funcionarios com nome, sexo e tipo de contrato.
Horas semanais sao preenchidas automaticamente pelo template do contrato.

### Passo 4 — Gere a escala

Em `Setores > [Setor] > Escala`, selecione o periodo e clique em "Gerar Escala".
O motor propoe uma escala otimizada automaticamente.

### Passo 5 — Ajuste se quiser

Clique em qualquer celula da grid para alternar entre TRABALHO e FOLGA.
O sistema recalcula indicadores em tempo real (Smart Recalc com pinnedCells).

### Passo 6 — Oficialize

Quando estiver satisfeito (0 violacoes HARD), clique em "Oficializar".
A escala e travada e pode ser exportada/impressa.

---

## 7) Regras de compliance (motor)

### HARD (bloqueiam oficializacao)

| Regra | Descricao |
|-------|-----------|
| `MAX_DIAS_CONSECUTIVOS` | Max 6 dias consecutivos de trabalho |
| `DESCANSO_ENTRE_JORNADAS` | Min 11h (660min) entre jornadas |
| `MAX_JORNADA_DIARIA` | Max 10h (600min) por dia (CLT absoluto) |
| `CONTRATO_MAX_DIA` | Max minutos/dia do contrato (ex: estagiario 4h) |
| `RODIZIO_DOMINGO` | Mulher: max 1 DOM seguido. Homem: max 2 |
| `ESTAGIARIO_DOMINGO` | Estagiario nunca trabalha domingo |

### SOFT (alertas, nao bloqueiam)

| Regra | Descricao |
|-------|-----------|
| `META_SEMANAL` | Desvio da meta semanal de horas (com tolerancia) |
| `PREFERENCIA_DIA` | Colaborador pediu folga em dia especifico |
| `PREFERENCIA_TURNO` | Colaborador prefere manha/tarde |
| `COBERTURA` | Faixa de demanda nao atingiu minimo de pessoas |

---

## 8) Paginas da UI

| Rota | Pagina | Descricao |
|------|--------|-----------|
| `/` | Dashboard | Visao geral dos setores, alertas, acoes rapidas |
| `/setores` | SetorLista | Cards de setores com criacao inline |
| `/setores/:id` | SetorDetalhe | Info + demandas + colaboradores (DnD rank) + escala |
| `/setores/:id/escala` | EscalaPagina | **CORE** — Simulacao / Oficial / Historico |
| `/colaboradores` | ColaboradorLista | Lista com filtro por setor |
| `/colaboradores/:id` | ColaboradorDetalhe | Perfil + contrato + preferencias + excecoes |
| `/tipos-contrato` | ContratoLista | Templates de contrato CLT (CRUD completo) |
| `/empresa` | EmpresaConfig | Nome, corte semanal, tolerancia |
| `/perfil` | Perfil | Avatar + nome do usuario (localStorage) |

---

## 9) Estrutura do projeto

```
escalaflow/
├── src/
│   ├── main/                          # Electron Main Process
│   │   ├── index.ts                   # App lifecycle, window
│   │   ├── tipc.ts                    # 27+ IPC handlers
│   │   ├── db/
│   │   │   ├── database.ts            # better-sqlite3 connection
│   │   │   ├── schema.ts             # DDL (CREATE TABLE)
│   │   │   └── seed.ts               # Seed 4 contratos CLT
│   │   ├── ia/
│   │   │   ├── cliente.ts             # Cliente Gemini REST
│   │   │   ├── tools.ts               # Ferramentas da IA (queries SQL)
│   │   │   └── system-prompt.ts       # Persona e contexto
│   │   └── motor/
│   │       ├── solver-bridge.ts       # Bridge TS -> solver Python
│   │       ├── validador.ts           # PolicyEngine (10 regras)
│   │       └── validacao-compartilhada.ts
│   │
│   ├── renderer/src/                  # React Frontend
│   │   ├── paginas/                   # 10 paginas
│   │   ├── componentes/               # Componentes custom (incluindo IaChatPanel)
│   │   ├── components/ui/             # shadcn primitives
│   │   ├── lib/                       # cores.ts, formatadores.ts, utils.ts
│   │   ├── hooks/                     # useApiData.ts
│   │   ├── estado/                    # Zustand store
│   │   └── servicos/                  # IPC client wrappers
│   │
│   ├── preload/                       # contextBridge (IPC seguro)
│   └── shared/                        # Types + constants compartilhados
│
├── solver/                            # Motor real Python (OR-Tools)
│   ├── solver_ortools.py
│   └── constraints.py
│
├── specs/                             # Specs de features isoladas
│   ├── 003-electron-migration/
│   ├── 004-finalize-v2/               # ROADMAP E FONTE DE VERDADE AQUI (.md)
│   └── ...
│
├── docs/                              # Documentacao de Arquitetura e Produto
│   ├── PRD-ia-e-configuracoes-v1.md   # Planning de expansão UX IA
│   ├── BUILD_V2_ESCALAFLOW.md         # Arquitetura completa
│   ├── COMO_FAZER_RELEASE.md          # CI/CD guias
│   └── legacy/                        # Prompts e arquivos históricos
│
├── .claude/                           # Arquivos e configs específicos da IA
│   └── CLAUDE.md                      # Instruções de contexto para agentes Code
├── electron.vite.config.ts
├── electron-builder.yml
├── tailwind.config.js
├── tsconfig.json / tsconfig.node.json / tsconfig.web.json
└── package.json
```

---

## 10) Modelo de dados

8 entidades, todas em portugues, snake_case ponta a ponta:

| Entidade | Tabela | Descricao |
|----------|--------|-----------|
| Empresa | `empresa` | Config global (singleton) |
| TipoContrato | `tipos_contrato` | Templates: CLT 44h, 36h, 30h, Estagiario 20h |
| Setor | `setores` | Departamentos do supermercado |
| Demanda | `demandas` | Faixas horarias com minimo de pessoas |
| Colaborador | `colaboradores` | Funcionarios vinculados a setor + contrato |
| Excecao | `excecoes` | Ferias, atestado, bloqueio |
| Escala | `escalas` | Escala gerada (RASCUNHO → OFICIAL → ARQUIVADA) |
| Alocacao | `alocacoes` | Um dia de uma pessoa numa escala |

---

## 11) Troubleshooting

- **App nao abre:** `npm run build` primeiro, depois `npm run dev`.
- **Banco corrompido:** Delete `data/escalaflow.db` e reinicie. Seed roda automaticamente.
- **Typecheck falha:** `npm run typecheck` mostra erros separados por node e web.
- **Motor trava:** Timeout de 30s protege. Se persistir, verifique dados do setor (demandas, colabs).
- **Teste do motor falha:** `npm run solver:test` roda no DB real e mostra status/erro do solver Python real.
- **Dark mode quebrado:** Todas as cores usam tokens semanticos de `cores.ts`. Se adicionou cor nova, inclua `dark:` variant.

---

## 12) Releases e Auto-Update

O app tem sistema de atualizacao automatica via GitHub Releases.

### Como funciona para o usuario

1. App abre → checa GitHub silenciosamente (5s de delay)
2. Se tem versao nova → baixa em background
3. Card "Atualizacoes" em Configuracoes acende com botao "Reiniciar e instalar"
4. Pronto — versao nova instalada sem reinstalar nada

### Como fazer um release (para o dev)

```bash
# 1. Sobe a versao no package.json (ex: 1.0.0 → 1.1.0)
# 2. Commit e tag
git add package.json
git commit -m "chore: bump v1.1.0"
git tag v1.1.0
git push && git push --tags

# 3. Build Mac + upload automatico para o GitHub Release
GH_TOKEN=$(gh auth token) npm run release:mac

# 4. Acesse github.com/nmarcofernandess/escalaflow/releases
#    Revise o draft e clique em "Publish release"
```

Guia completo com todos os detalhes: `docs/COMO_FAZER_RELEASE.md`

---

## 13) Documentacao

| Arquivo | Conteudo |
|---------|----------|
| `docs/COMO_FAZER_RELEASE.md` | **Guia completo de releases e auto-update** |
| `docs/MOTOR_V3_RFC.md` | RFC canonico do motor v3 (20 HARD + SOFT) |
| `docs/BUILD_V2_ESCALAFLOW.md` | Arquitetura completa (modelo, motor, frontend) |
| `specs/` | Specs e logs de cada feature implementada |
| `CLAUDE.md` | Instrucoes para Claude Code |
