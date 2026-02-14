# PRD: Frontend Completo — EscalaFlow v2

> **Workflow:** feature
> **Budget sugerido:** high
> **Criado em:** 2026-02-14T12:00:00Z
> **Fonte:** gather + analise V0 + analise codebase

---

## Visao Geral

O EscalaFlow v2 tem backend completo (20+ rotas API, motor de proposta funcional, seed com 4 setores e 16 colaboradores) mas o frontend esta em esqueleto: 3 paginas basicas (Dashboard, SetorLista, ContratoLista) com `fetch()` cru, AppShell manual, e zero componentes de UI padrao.

Este PRD cobre a implementacao COMPLETA do frontend, desde a fundacao (shadcn/ui + service layer) ate o componente core do produto (EscalaGrid).

**Diretriz critica:** Usar shadcn/ui como o shadcn pensa. Componentes originais. Zero hacks. Minimo de `className` manual. Minimo de `<div>` wrapper. Usar as composicoes prontas (Card, Dialog, Select, Tabs, Table, etc.) exatamente como a documentacao prescreve.

**Referencia visual:** O prototipo V0 em `~/Downloads/escala-flow-v2/` (Next.js + shadcn) serve como design spec. Adaptar a LOGICA e o LAYOUT para Vite + React Router, nao copiar Next.js patterns.

---

## FASE 0 — Fundacao shadcn/ui

### Objetivo
Instalar e configurar shadcn/ui no projeto Vite + React. Substituir o sistema de UI manual por componentes shadcn oficiais.

### Requisitos

- [ ] Executar `npx shadcn@latest init` configurado para Vite + React + Tailwind
- [ ] Instalar componentes necessarios via CLI:
  ```
  npx shadcn@latest add button card badge input label select dialog tabs
  npx shadcn@latest add tooltip table breadcrumb separator sidebar
  npx shadcn@latest add alert-dialog collapsible sonner scroll-area
  ```
- [ ] Instalar `lucide-react` como dependencia
- [ ] Confirmar que `lib/utils.ts` com `cn()` foi criado pelo init
- [ ] Configurar `globals.css` com variaveis de tema shadcn (geradas pelo init)
- [ ] Envolver app com `TooltipProvider` em `main.tsx`
- [ ] Verificar que path alias `@/` funciona para imports shadcn (`@/components/ui/button`)
- [ ] Garantir que `tailwind.config` inclui os caminhos shadcn no `content`

### Componentes shadcn necessarios (lista completa)

| Componente | Uso |
|------------|-----|
| `button` | Acoes em toda parte |
| `card` | Container principal de conteudo |
| `badge` | Status, tags, contadores |
| `input` | Formularios |
| `label` | Labels de formulario |
| `select` | Dropdowns (setor, sexo, contrato, turno, dia) |
| `dialog` | Modais de criacao (novo setor, novo colaborador, nova excecao, nova demanda) |
| `tabs` | EscalaPagina (Simulacao/Oficial/Historico) |
| `tooltip` | Tooltips na EscalaGrid |
| `table` | EscalaGrid (estrutura tabular) |
| `breadcrumb` | PageHeader navegacao |
| `separator` | Divisores visuais |
| `sidebar` | Navegacao lateral principal |
| `alert-dialog` | Confirmacao de arquivamento/delete |
| `collapsible` | Secao de violacoes expansivel |
| `sonner` | Toast de feedback (salvo, erro, etc.) |
| `scroll-area` | Scroll em listas longas |

### Criterios de aceitacao

- [ ] `npm run dev:web` roda sem erros
- [ ] `npm run build` compila sem erros de tipo
- [ ] Componentes shadcn importaveis como `import { Button } from "@/components/ui/button"`
- [ ] Tema shadcn aplicado (fontes, cores, espacamentos consistentes)

---

## FASE 1 — App Shell + Layout

### Objetivo
Substituir o AppShell manual por sidebar shadcn oficial. Criar PageHeader reutilizavel. Todas as rotas definidas.

### Requisitos

- [ ] **Remover** o `AppShell.tsx` atual (sidebar manual com Tailwind cru)
- [ ] **Criar** `componentes/AppSidebar.tsx` — adaptar de V0 `app-sidebar.tsx`:
  - Usar `Sidebar`, `SidebarContent`, `SidebarGroup`, `SidebarGroupLabel`, `SidebarGroupContent`, `SidebarMenu`, `SidebarMenuItem`, `SidebarMenuButton`, `SidebarHeader`, `SidebarFooter`, `SidebarSeparator`
  - `collapsible="icon"` para sidebar colapsavel
  - Grupo "Principal": Dashboard, Setores, Colaboradores, Escala
  - Grupo "Configuracao": Tipos de Contrato, Empresa
  - Icones: `LayoutDashboard`, `Building2`, `Users`, `CalendarDays`, `FileText`, `Settings`
  - `isActive` baseado em `useLocation()` (react-router-dom, NAO `usePathname`)
  - `asChild` com `<Link to={...}>` (react-router-dom, NAO Next `<Link href>`)
  - Logo "EscalaFlow" no header com icone CalendarDays
  - Footer com nome da empresa (futuro: ler de API)
- [ ] **Criar** `componentes/PageHeader.tsx` — adaptar de V0 `page-header.tsx`:
  - Props: `breadcrumbs: {label: string, href?: string}[]`, `actions?: ReactNode`
  - Usar `SidebarTrigger`, `Separator`, `Breadcrumb`, `BreadcrumbList`, `BreadcrumbItem`, `BreadcrumbLink`, `BreadcrumbPage`, `BreadcrumbSeparator`
  - `BreadcrumbLink` usar `<Link to={href}>` (react-router-dom)
  - Slot de actions no lado direito
- [ ] **Atualizar** `App.tsx`:
  - Envolver com `SidebarProvider` + `SidebarInset`
  - `<AppSidebar />` fora do SidebarInset
  - Todas as rotas:
    ```
    /                     → Dashboard
    /setores              → SetorLista
    /setores/:id          → SetorDetalhe
    /setores/:id/escala   → EscalaPagina
    /colaboradores        → ColaboradorLista
    /colaboradores/:id    → ColaboradorDetalhe
    /tipos-contrato       → ContratoLista
    /empresa              → EmpresaConfig
    ```
- [ ] **Atualizar** `main.tsx`:
  - Envolver com `TooltipProvider delayDuration={0}`
  - Importar `Toaster` do sonner

### Criterios de aceitacao

- [ ] Sidebar renderiza com todos os 6 links de navegacao
- [ ] Sidebar colapsavel (icone mode) funciona
- [ ] Navegacao ativa (highlight) funciona em todas as rotas
- [ ] PageHeader mostra breadcrumbs clicaveis
- [ ] Layout identico visualmente ao V0 prototype
- [ ] Zero `className` ad hoc que deveria ser propriedade de componente shadcn

---

## FASE 2 — Service Layer + Estado

### Objetivo
Criar camada de servicos (fetch wrapper + servicos por entidade) e estado global minimo com Zustand.

### Requisitos

- [ ] **Criar** `servicos/api.ts`:
  ```typescript
  const BASE = '/api'

  async function request<T>(path: string, options?: RequestInit): Promise<T> {
    const res = await fetch(`${BASE}${path}`, {
      headers: { 'Content-Type': 'application/json', ...options?.headers },
      ...options,
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new ApiError(res.status, body.error ?? 'Erro desconhecido')
    }
    if (res.status === 204) return undefined as T
    return res.json()
  }

  export class ApiError extends Error {
    constructor(public status: number, message: string) {
      super(message)
    }
  }

  export const api = {
    get: <T>(path: string) => request<T>(path),
    post: <T>(path: string, body: unknown) =>
      request<T>(path, { method: 'POST', body: JSON.stringify(body) }),
    put: <T>(path: string, body: unknown) =>
      request<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
    del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  }
  ```

- [ ] **Criar** servicos por entidade (todos em `servicos/`):

  **`setores.ts`**:
  ```
  listar(ativo?: boolean) → GET /api/setores[?ativo=true]
  buscar(id) → GET /api/setores/:id
  criar(data) → POST /api/setores
  atualizar(id, data) → PUT /api/setores/:id
  deletar(id) → DELETE /api/setores/:id
  listarDemandas(setorId) → GET /api/setores/:id/demandas
  criarDemanda(setorId, data) → POST /api/setores/:id/demandas
  atualizarDemanda(id, data) → PUT /api/demandas/:id
  deletarDemanda(id) → DELETE /api/demandas/:id
  reordenarRank(setorId, colaboradorIds) → PUT /api/setores/:id/rank
  ```

  **`colaboradores.ts`**:
  ```
  listar(params?: {setor_id?, ativo?}) → GET /api/colaboradores[?query]
  buscar(id) → GET /api/colaboradores/:id
  criar(data) → POST /api/colaboradores
  atualizar(id, data) → PUT /api/colaboradores/:id
  deletar(id) → DELETE /api/colaboradores/:id
  ```

  **`tipos-contrato.ts`**:
  ```
  listar() → GET /api/tipos-contrato
  buscar(id) → GET /api/tipos-contrato/:id
  criar(data) → POST /api/tipos-contrato
  atualizar(id, data) → PUT /api/tipos-contrato/:id
  deletar(id) → DELETE /api/tipos-contrato/:id
  ```

  **`excecoes.ts`**:
  ```
  listar(colaboradorId) → GET /api/colaboradores/:id/excecoes
  criar(colaboradorId, data) → POST /api/colaboradores/:id/excecoes
  atualizar(id, data) → PUT /api/excecoes/:id
  deletar(id) → DELETE /api/excecoes/:id
  ```

  **`escalas.ts`**:
  ```
  gerar(setorId, data) → POST /api/setores/:id/gerar-escala
  buscar(id) → GET /api/escalas/:id
  listarPorSetor(setorId, params?) → GET /api/setores/:id/escalas[?status=]
  oficializar(id) → PUT /api/escalas/:id/oficializar
  ajustar(id, data) → POST /api/escalas/:id/ajustar
  deletar(id) → DELETE /api/escalas/:id
  ```

  **`empresa.ts`**:
  ```
  buscar() → GET /api/empresa
  atualizar(data) → PUT /api/empresa
  ```

  **`dashboard.ts`**:
  ```
  resumo() → GET /api/dashboard
  ```

- [ ] **Criar** `estado/store.ts` — Zustand store minimo:
  ```typescript
  interface AppState {
    setorAtivoId: number | null
    setSetorAtivo: (id: number | null) => void
  }
  ```

- [ ] **Criar** `lib/cores.ts` — constantes de cor por status:
  ```typescript
  export const CORES_STATUS_ESCALA = {
    OFICIAL: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    RASCUNHO: 'border-amber-200 bg-amber-50 text-amber-700',
    ARQUIVADA: 'border-muted-foreground/20 bg-muted text-muted-foreground',
    SEM_ESCALA: 'border-muted-foreground/20 bg-muted text-muted-foreground',
  }

  export const CORES_ALOCACAO = {
    TRABALHO: 'bg-emerald-50 text-emerald-800 border-emerald-200',
    TRABALHO_DOMINGO: 'bg-sky-100 text-sky-800 border-sky-200',
    FOLGA: 'bg-muted/60 text-muted-foreground border-border',
    INDISPONIVEL: 'bg-amber-50 text-amber-700 border-amber-200',
  }

  export const CORES_EXCECAO = {
    FERIAS: 'text-emerald-600',
    ATESTADO: 'text-amber-600',
    BLOQUEIO: 'text-red-600',
  }

  export const CORES_VIOLACAO = {
    HARD: { border: 'border-red-200', bg: 'bg-red-50/50', text: 'text-red-800', textLight: 'text-red-700' },
    SOFT: { border: 'border-amber-200', bg: 'bg-amber-50/50', text: 'text-amber-800', textLight: 'text-amber-700' },
  }
  ```

- [ ] **Criar** `lib/formatadores.ts`:
  ```typescript
  formatarData(iso: string) → "01/03/2026"
  formatarMinutos(min: number) → "7h30"
  formatarMes(iso: string) → "Mar/2026"
  iniciais(nome: string) → "AJ" (primeiras 2 letras)
  ```

### Criterios de aceitacao

- [ ] Todos os servicos tipados com interfaces de `@escalaflow/shared`
- [ ] `ApiError` captura erros HTTP e expoe `status` + `message`
- [ ] Nenhum `fetch()` direto em componentes — tudo via servicos
- [ ] Zero logica de negocio nos servicos (sao proxies puros)

---

## FASE 3 — Reconstruir Paginas Existentes com shadcn

### Objetivo
Reescrever Dashboard, SetorLista e ContratoLista usando componentes shadcn e service layer.

### Dashboard (`/`)

- [ ] Adaptar de V0 `app/page.tsx`
- [ ] 4 stat cards (Setores Ativos, Colaboradores, Em Ferias, Em Atestado) usando `Card` + `CardContent`
- [ ] Layout 2 colunas: setores overview (lg:col-span-2) + alertas + acoes rapidas
- [ ] Componente `StatusBadge` reutilizavel (OFICIAL=emerald, RASCUNHO=amber, SEM_ESCALA=muted)
- [ ] Carregar dados via `dashboardService.resumo()`
- [ ] Icones: `Building2`, `Users`, `Palmtree`, `Stethoscope`, `AlertTriangle`, `CircleAlert`, `CalendarDays`
- [ ] Links de setor levam para `/setores/:id`
- [ ] Acoes rapidas: "Gerar Nova Escala" → `/setores`, "Novo Colaborador" → `/colaboradores`, "Novo Setor" → `/setores`

### SetorLista (`/setores`)

- [ ] Adaptar de V0 `app/setores/page.tsx`
- [ ] Toolbar: Input com icone Search + botao Arquivados com contagem
- [ ] Grid responsivo (`sm:grid-cols-2 lg:grid-cols-3`) de cards
- [ ] Cada card: icone Building2 + nome + horario + contagem colabs + botao "Abrir"
- [ ] Cards arquivados: opacity + badge "Arquivado" + botao "Restaurar"
- [ ] Empty state com icone e texto
- [ ] **Dialog** de criacao (novo setor): nome + hora abertura + hora fechamento
- [ ] Criar setor via `setoresService.criar()` + toast de sucesso + reload lista
- [ ] Restaurar setor via `setoresService.atualizar(id, {ativo: true})` + toast

### ContratoLista (`/tipos-contrato`)

- [ ] Reescrever com Cards shadcn
- [ ] Cada card: nome do contrato + horas semanais + dias trabalho + trabalha domingo + max minutos/dia
- [ ] Carregar via `tiposContratoService.listar()`
- [ ] Usar `Badge` para metadados

### Criterios de aceitacao

- [ ] Todas as 3 paginas usam service layer (zero fetch direto)
- [ ] Layout visual identico ao V0 prototype
- [ ] Dialog de criacao funcional (cria no backend, atualiza lista)
- [ ] Toast de feedback em operacoes (sonner)
- [ ] Loading state: "Carregando..." ou skeleton enquanto fetch

---

## FASE 4 — Novas Paginas CRUD (F6)

### SetorDetalhe (`/setores/:id`)

- [ ] Adaptar de V0 `app/setores/[id]/page.tsx`
- [ ] `useParams()` para pegar `id` (react-router-dom)
- [ ] Carregar setor + demandas + colaboradores + escala atual via services
- [ ] PageHeader com breadcrumbs: Setores > {nome} + botao Salvar
- [ ] **Card: Info do Setor** — nome (Input), hora abertura (Input type=time), hora fechamento (Input type=time)
- [ ] **Card: Demanda por Faixa** — lista de faixas com hora_inicio-hora_fim + min_pessoas + Badge dia_semana + botoes editar/deletar
  - Botao "+ Nova Faixa" abre Dialog com campos: dia_semana (Select, opcional), hora_inicio, hora_fim, min_pessoas
  - Criar via `setoresService.criarDemanda()` + toast
  - Deletar via `setoresService.deletarDemanda()` com AlertDialog de confirmacao
- [ ] **Card: Colaboradores** — lista com drag handles (GripVertical) + rank badge (#1, #2...) + nome + contrato badge + sexo + preferencia
  - Subtitulo: "(arraste para reordenar prioridade)"
  - Cada item: link "Ver perfil" → `/colaboradores/:id`
  - Botao "Gerenciar" → `/colaboradores`
  - **DnD reordenacao** salva via `setoresService.reordenarRank(setorId, ids)` — usar lib leve tipo `@dnd-kit/core` + `@dnd-kit/sortable`
- [ ] **Card: Escala Atual** — mostra status da escala mais recente (ou "Nenhuma escala")
  - Se existe: periodo + status badge + pontuacao + botoes "Abrir Escala" e "Gerar Nova"
  - Link "Abrir Escala" → `/setores/:id/escala`
- [ ] Botao Salvar: `setoresService.atualizar(id, formData)` + toast

### ColaboradorLista (`/colaboradores`)

- [ ] Adaptar de V0 `app/colaboradores/page.tsx`
- [ ] Toolbar: Search + Select filtro por setor + botao Arquivados
- [ ] Grid responsivo de cards
- [ ] Cada card: avatar circular (iniciais, cor por sexo: pink=F, sky=M) + nome + setor + badges (contrato, horas, sexo, turno preferido)
- [ ] Botao "Ver Perfil" → `/colaboradores/:id`
- [ ] **Dialog** de criacao: nome + sexo (Select) + setor (Select) + tipo contrato (Select)
  - Criar via `colaboradoresService.criar()` + toast + reload
- [ ] Filtro por setor: `colaboradoresService.listar({setor_id})` ou filtro local
- [ ] Arquivados: toggle mostra inativos com botao "Restaurar"
- [ ] Carregar setores e tipos contrato para popular Selects no Dialog

### ColaboradorDetalhe (`/colaboradores/:id`)

- [ ] Adaptar de V0 `app/colaboradores/[id]/page.tsx`
- [ ] PageHeader: Colaboradores > {nome} + botao Salvar
- [ ] **Card: Info Pessoais** — nome (Input), sexo (Select: F/M), setor (Select: setores ativos)
- [ ] **Card: Contrato** — tipo contrato (Select), horas semanais (Input number, editavel)
  - Info box com template: "{nome} | {dias} dias/semana | Max {min}min/dia | Domingo: Sim/Nao"
- [ ] **Card: Preferencias** — prefere turno (Select: Sem preferencia/Manha/Tarde), evitar dia (Select: 7 dias + sem preferencia)
  - Helper text: "O motor tenta respeitar, mas nao garante..."
- [ ] **Card: Excecoes** — lista com icone por tipo (Palmtree=FERIAS, Stethoscope=ATESTADO, Ban=BLOQUEIO) + data_inicio-data_fim + nota + botoes editar/deletar
  - Botao "+ Nova Excecao" abre Dialog: tipo (Select), data inicio (Input date), data fim (Input date), observacao (Input)
  - Criar via `excecoesService.criar()` + toast
  - Deletar com AlertDialog
- [ ] **Card: Historico de Escalas** — lista read-only de periodos com dias trab, domingos, horas/sem
  - Carregar: buscar escalas do setor do colaborador, calcular stats das alocacoes
- [ ] Salvar: `colaboradoresService.atualizar(id, formData)` + toast

### EmpresaConfig (`/empresa`)

- [ ] Pagina simples: Card com nome (Input), cidade (Input), estado (Input)
- [ ] Carregar via `empresaService.buscar()`, salvar via `empresaService.atualizar()`
- [ ] PageHeader: Empresa + botao Salvar
- [ ] Toast de confirmacao ao salvar

### Criterios de aceitacao

- [ ] Todas as paginas carregam dados reais da API
- [ ] Formularios salvam no backend com feedback visual (toast)
- [ ] Dialogs de criacao criam entidades reais
- [ ] AlertDialog de confirmacao em acoes destrutivas (delete, arquivar)
- [ ] DnD de rank no SetorDetalhe funcional e salva no backend
- [ ] Navegacao entre paginas (breadcrumbs, links) funciona

---

## FASE 5 — EscalaPagina + EscalaGrid (F7 — CORE DO PRODUTO)

### EscalaPagina (`/setores/:id/escala`)

- [ ] Adaptar de V0 `app/escala/page.tsx`
- [ ] `useParams()` para pegar `id` do setor (ja vem da URL, nao precisa de Select)
- [ ] PageHeader: Escala > {nome do setor}
- [ ] **3 tabs** via shadcn `Tabs`:
  - `Simulacao` (default)
  - `Oficial`
  - `Historico`

### Tab: Simulacao

- [ ] **Controles de geracao**: data inicio (Input date) + data fim (Input date) + botao "Gerar Escala"
- [ ] Ao clicar "Gerar Escala": `escalasService.gerar(setorId, {data_inicio, data_fim})`
- [ ] Loading state enquanto motor roda (spinner ou skeleton)
- [ ] Ao receber resposta:
  - [ ] **Indicadores** (5 cards em grid `grid-cols-2 md:grid-cols-5`):
    - Pontuacao (com PontuacaoBadge: verde>=85, amber>=70, red<70)
    - Cobertura %
    - Violacoes Hard
    - Violacoes Soft
    - Equilibrio %
    - Cada indicador: icone em circulo colorido + numero bold + label text-[10px]
  - [ ] **EscalaGrid** (o componente core — ver abaixo)
  - [ ] **Violacoes** (Collapsible) — lista de violacoes com icone e cor por severidade
    - HARD: borda vermelha + bg vermelho + icone XCircle
    - SOFT: borda amber + bg amber + icone AlertTriangle
    - Cada violacao: regra + colaborador_nome + mensagem
  - [ ] **Acoes**:
    - "Oficializar" → `escalasService.oficializar(id)` + toast
    - "Exportar HTML" → gerar HTML standalone para impressao
    - "Imprimir" → `window.print()`
    - "Descartar" → AlertDialog → `escalasService.deletar(id)` + limpar estado

### Tab: Oficial

- [ ] Buscar escala OFICIAL do setor: `escalasService.listarPorSetor(id, {status: 'OFICIAL'})`
- [ ] Se existe: mostrar EscalaGrid em `readOnly` + info da escala + botoes exportar/imprimir
- [ ] Se nao existe: empty state "Nenhuma escala oficial. Gere na aba Simulacao."

### Tab: Historico

- [ ] Listar escalas ARQUIVADAS: `escalasService.listarPorSetor(id, {status: 'ARQUIVADA'})`
- [ ] Cada item: mes/ano + periodo + PontuacaoBadge + Badge "Arquivada" + botao "Ver"
- [ ] "Ver" expande EscalaGrid inline (readOnly) — busca detalhes via `escalasService.buscar(id)`

### EscalaGrid (componente `componentes/EscalaGrid.tsx`)

**ESTE E O COMPONENTE MAIS IMPORTANTE DO SISTEMA.**

- [ ] Adaptar de V0 `components/escala-grid.tsx` (210 linhas)
- [ ] Props:
  ```typescript
  interface EscalaGridProps {
    colaboradores: Colaborador[]
    alocacoes: Alocacao[]
    dataInicio: string
    dataFim: string
    demandas?: Demanda[]  // para cobertura real (nao mock)
    readOnly?: boolean
    onCelulaClick?: (colaboradorId: number, data: string, statusAtual: string) => void
  }
  ```

- [ ] **Navegacao semanal**: botoes "Semana Anterior" / "Proxima Semana" + label "Semana X de Y"
  - State: `weekOffset`
  - Agrupar datas em semanas (segunda-domingo)

- [ ] **Header**: coluna "Colaborador" (sticky left) + 7 colunas de dia (SEG-DOM) com dia_semana + dd/mm + coluna "Horas/sem"

- [ ] **Corpo**: cada linha = 1 colaborador
  - Coluna nome (sticky left): avatar iniciais (cor por sexo) + nome curto + tipo contrato
  - 7 celulas por dia:
    - TRABALHO (dia util): `bg-emerald-50` + hora_inicio + hora_fim
    - TRABALHO (domingo): `bg-sky-100` + hora_inicio + hora_fim
    - FOLGA: `bg-muted/60` + "FOLGA"
    - INDISPONIVEL: `bg-amber-50` + "AUS."
  - Cada celula envolta em `Tooltip` com detalhes
  - Se `!readOnly`: celula clicavel (dispara `onCelulaClick`)
  - Coluna horas/semana: total calculado vs meta, verde se ok, amber se fora

- [ ] **Linha de cobertura** (footer): "COBERTURA" + contagem por dia (atual/necessario)
  - Necessario: calculado a partir de `demandas` prop (nao mock)
  - Verde se `atual >= necessario`, amber se deficit

- [ ] **Legenda**: 4 status com cor sample

- [ ] **Performance**: lookup de alocacao por Map (nao .find() em array por celula)

### Criterios de aceitacao

- [ ] EscalaGrid renderiza dados reais da API (nao mock)
- [ ] Navegacao semanal funciona
- [ ] Tooltips mostram detalhes por celula
- [ ] Cores consistentes com V0 prototype
- [ ] Coluna nome sticky ao scroll horizontal
- [ ] Cobertura calculada com demandas reais do setor
- [ ] Tab Simulacao: gera escala, mostra indicadores + grid + violacoes
- [ ] Tab Oficial: mostra escala oficial em read-only
- [ ] Tab Historico: lista escalas arquivadas com expansao inline
- [ ] Oficializar funciona (chama API, toast, atualiza estado)
- [ ] Descartar funciona (AlertDialog, chama API, limpa grid)

---

## FASE 6 — Polish + Integracao Final

### Objetivo
Error handling, loading states, empty states, e integracao de fluxos entre paginas.

### Requisitos

- [ ] **Toast** (sonner) em toda operacao CRUD:
  - Sucesso: "Setor criado", "Colaborador salvo", "Escala oficializada"
  - Erro: mensagem do `ApiError.message` (vem do backend em portugues)
- [ ] **Loading states**: cada pagina mostra algo enquanto carrega (texto "Carregando..." ou spinner)
- [ ] **Empty states**: mensagem + icone + CTA quando lista vazia (ver V0 para padroes)
- [ ] **Error boundary**: componente wrapper que captura erros de render
- [ ] **404**: pagina de "Nao encontrado" para IDs invalidos
- [ ] **Confirmacao de arquivamento**: AlertDialog com mensagem de cascata
  - Setor: "O setor {nome} tem {N} colaboradores. Eles nao entrarao em novas escalas."
  - Colaborador: "Ao arquivar {nome}, ele nao sera incluido em novas escalas."
- [ ] **Navegacao cross-page**:
  - SetorDetalhe > "Ver perfil" do colaborador → `/colaboradores/:id`
  - ColaboradorDetalhe > botao voltar → `/colaboradores`
  - SetorDetalhe > "Abrir Escala" → `/setores/:id/escala`
  - Dashboard > setor card → `/setores/:id`
- [ ] **Hook `useApiData`** (opcional — sugar para fetch + loading + error):
  ```typescript
  function useApiData<T>(fetcher: () => Promise<T>, deps: unknown[]) {
    const [data, setData] = useState<T | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    // ... useEffect com fetcher
    return { data, loading, error, reload }
  }
  ```

### Criterios de aceitacao

- [ ] Nenhuma operacao fica silenciosa (sempre tem feedback)
- [ ] Erros da API exibem mensagem amigavel (em portugues, vinda do backend)
- [ ] Navegacao entre paginas e fluida e logica
- [ ] Nenhum console.error em uso normal

---

## Constraints

- **Framework**: Vite + React 19 + React Router 7 + Tailwind 3 + Zustand 5 (ja instalados)
- **UI Library**: shadcn/ui — componentes oficiais, sem customizacao excessiva
- **Tipos**: `@escalaflow/shared` — TODAS as interfaces ja existem, nao duplicar
- **API**: Todas as rotas ja existem e funcionam. Frontend so consome
- **Naming**: snake_case ponta a ponta (DB = JSON = TS). Nao traduzir para camelCase
- **Porta API**: 3333 (proxy Vite ja configurado em `/api`)
- **Porta Web**: 5173
- **DB**: SQLite local, seed roda com `npm run db:seed`
- **Next.js**: NAO usar. Adaptar V0 para Vite + React Router
  - `Link href` → `Link to` (react-router-dom)
  - `usePathname()` → `useLocation()` (react-router-dom)
  - `useRouter().push()` → `useNavigate()` (react-router-dom)
  - `use(params)` → `useParams()` (react-router-dom)
  - `"use client"` → remover (tudo e client no Vite)
- **shadcn purity**: Usar composicoes do shadcn como projetadas. Se um componente tem prop `variant`, `size`, `asChild` — usar. Nao recriar com className manual.
- **Minimo classname**: Usar utility classes do Tailwind SOMENTE quando shadcn nao tem prop equivalente. Ex: layout (`grid`, `flex`, `space-y`), spacing (`p-6`, `gap-4`), responsive (`sm:`, `lg:`) — esses sao aceitaveis. Cor, borda, hover em componentes shadcn — NAO.

---

## Fora do Escopo

- Drag-and-drop na EscalaGrid (mover alocacoes entre celulas) — F9 futuro
- Exportar para PDF — F8 futuro
- Electron shell — F9 futuro
- Dark mode — nao necessario agora
- Testes automatizados — nao neste sprint
- Responsivo mobile completo — desktop first, mobile acceptable
- Auth/login — app local, sem autenticacao
- Multi-empresa — sempre 1 empresa (singleton)
- Historico por colaborador (quantos domingos trabalhou) — nice to have futuro

---

## Servicos Envolvidos

- [x] Frontend (Vite + React + shadcn)
- [ ] Backend (somente consumo — nao alterar rotas)
- [ ] Database (somente via API — nao acessar direto)

---

## Budget Sugerido

**Recomendacao:** `high`

Justificativa:
- 8 paginas completas (5 novas, 3 reescritas)
- 20+ componentes (incluindo EscalaGrid que e o core do produto)
- Service layer completa (8 servicos)
- Fundacao shadcn/ui do zero (install, config, 17 componentes)
- DnD de rank (lib extra)
- Integracao com API real (20+ endpoints)
- Cross-cutting concerns (toast, loading, error handling, navigation)

---

## Notas Adicionais

### Prioridade se precisar cortar escopo

1. **CRITICO**: Fase 0 + 1 + 2 + EscalaGrid (sem isso nao e produto)
2. **IMPORTANTE**: Fase 3 + 4 (CRUD completo)
3. **NICE**: Fase 6 (polish)

### Dependencias de pacotes a instalar

```bash
# shadcn e feito via CLI (instala Radix primitives automaticamente)
npx shadcn@latest init
npx shadcn@latest add [components...]

# Extras
npm install lucide-react        # Icones
npm install @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities  # DnD para rank
npm install sonner               # Toast (pode vir com shadcn add sonner)
```

### Arquivos do V0 prototype para referencia

| Arquivo V0 | Adaptar para | Notas |
|------------|-------------|-------|
| `components/app-sidebar.tsx` | `componentes/AppSidebar.tsx` | Link→Link, usePathname→useLocation |
| `components/page-header.tsx` | `componentes/PageHeader.tsx` | href→to |
| `components/escala-grid.tsx` | `componentes/EscalaGrid.tsx` | Remover mock, usar demandas reais |
| `app/page.tsx` | `paginas/Dashboard.tsx` | Remover mock, usar service |
| `app/setores/page.tsx` | `paginas/SetorLista.tsx` | Remover mock, Dialog funcional |
| `app/setores/[id]/page.tsx` | `paginas/SetorDetalhe.tsx` | use(params)→useParams(), DnD real |
| `app/colaboradores/page.tsx` | `paginas/ColaboradorLista.tsx` | Remover mock, Dialog funcional |
| `app/colaboradores/[id]/page.tsx` | `paginas/ColaboradorDetalhe.tsx` | Excecoes reais, historico real |
| `app/escala/page.tsx` | `paginas/EscalaPagina.tsx` | Setor pela URL, API real |
