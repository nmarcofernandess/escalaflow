# PRD: Visualizacao Timeline/Gantt para Escalas

> **Workflow:** feature
> **Budget sugerido:** medium
> **Criado em:** 2026-02-15T19:00:00Z
> **Fonte:** gather (taskgen + red pill)

---

## Visao Geral

Adicionar uma **visualizacao estilo timeline/Gantt** na `EscalaPagina`, como alternativa a grade tabular (`EscalaGrid`) ja existente. O usuario vera barras horizontais representando os turnos de cada colaborador ao longo do dia, com eixo X = horario de funcionamento e eixo Y = colaboradores.

**Motivacao:** A grade tabular atual mostra "TRABALHO/FOLGA" por dia, mas NAO mostra a distribuicao temporal real dos turnos. Um gerente de RH (usuario nao-tecnico) precisa ver de relance: quem trabalha quando, onde ha sobreposicoes, onde ha buracos de cobertura, e quais sao os intervalos.

**Principio:** Menor input possivel, maximo de informacao visual. O sistema mostra, nao o usuario monta.

---

## Analise de Mercado (Red Pill)

### Como apps de escala fazem a timeline

| App | Abordagem | Detalhes |
|-----|-----------|----------|
| **When I Work** | Timeline horizontal | Barras coloridas por turno, drag-and-drop, sticky sidebar com nomes |
| **Deputy** | Gantt com resource rows | Linhas = funcionarios, blocos = shifts, cores por role/setor |
| **Sling** | Timeline semanal | Eixo X = dias, barras representam duracao do turno |
| **Homebase** | Grid hibrido | Celulas com barras internas mostrando hora inicio/fim |
| **Mobiscroll** | Timeline puro | Unassigned shifts no topo, drag para atribuir, zoom hora/dia |

### Padrao UI consolidado

O padrao dominante e: **horizontal timeline com resource rows**
- **Sidebar esquerda fixa:** nomes dos colaboradores (scroll independente)
- **Header superior fixo:** horas do dia (06:00, 07:00, ... 22:00)
- **Grid central:** barras horizontais coloridas (posicao = horario, largura = duracao)
- **Interacao:** hover para detalhes, click para editar, drag para mover
- **Cores:** por tipo de contrato, setor, ou status (GERADA/MANUAL/PINNED)

### Libs React avaliadas

| Lib | Fit | Bundle | Dark Mode | Manutencao | Licenca | Preco |
|-----|-----|--------|-----------|------------|---------|-------|
| **CSS Grid puro** | PERFEITO | 0 KB | Nativo (Tailwind) | Tu cuida | N/A | Free |
| **react-calendar-timeline** | BOM | +100 KB | Manual | Ativo (beta 0.30) | MIT | Free |
| **react-big-calendar** | ERRADO | +150 KB | Manual | Ativo | MIT | Free |
| **vis-timeline** | OK | +200 KB | Manual | Ativo | Apache | Free |
| **@bryntum/gantt** | OVERKILL | Grande | Sim | Comercial | Paga | $940/dev |
| **SVAR React Gantt** | BOM | ? | Provavel | Ativo | MIT | Free |

### Decisao: CSS Grid + Tailwind

**Razoes:**
1. Zero dependencias externas (Electron = offline)
2. Dark mode nativo via Tailwind `dark:` (ja funciona)
3. Performance excelente para 10-50 colaboradores x 7-30 dias
4. Integra com shadcn/ui e padroes existentes
5. Total controle sobre UX (usuarios nao-tecnicos)
6. @dnd-kit ja instalado se precisar drag-and-drop no futuro

**Fallback:** Se CSS Grid nao atender (zoom complexo, >1000 rows), migrar para `react-calendar-timeline` (MIT, timeline-focused).

---

## Proposta de Implementacao

### Componente: `TimelineGrid`

```
TimelineGrid.tsx
├── Props: alocacoes, colaboradores, setor, data (dia selecionado), readOnly, tiposContrato
├── Eixo X: horas do setor (hora_abertura..hora_fechamento) em slots de 30min
├── Eixo Y: colaboradores (sorted by rank)
├── Celulas: barras horizontais (position + width calculados via CSS Grid)
├── Cores: por tipo_contrato ou status da alocacao
├── Hover/Tooltip: nome, horario, minutos, tipo contrato
└── Legenda: cores dos tipos de contrato + status
```

### Layout Visual (ASCII Mockup)

```
┌─────────────────────────────────────────────────────────────────────────┐
│  ◀ 01/Mar ▶   [Dia] [Semana]                                          │
├──────────┬──────────────────────────────────────────────────────────────┤
│          │ 06:00  08:00  10:00  12:00  14:00  16:00  18:00  20:00  22:00│
│          │   │      │      │      │      │      │      │      │      │ │
├──────────┼──────────────────────────────────────────────────────────────┤
│ MF Maria │          ████████████████░░░░████████████████████            │
│ CLT 44h  │          08:00──────────12:00 13:00──────────17:20          │
├──────────┼──────────────────────────────────────────────────────────────┤
│ CF Carlos│   ██████████████████████████████                             │
│ CLT 44h  │   06:00────────────────────14:00                            │
├──────────┼──────────────────────────────────────────────────────────────┤
│ AS Ana   │                              ██████████████████████████      │
│ CLT 36h  │                              13:00────────────────21:00      │
├──────────┼──────────────────────────────────────────────────────────────┤
│ JL João  │   ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░   │
│ Estag20h │   FOLGA                                                      │
├──────────┼──────────────────────────────────────────────────────────────┤
│          │                                                              │
│ COBERTURA│ ▓▓▓1▓▓ ▓▓▓2▓▓ ▓▓▓3▓▓ ▓▓▓2▓▓ ▓▓▓3▓▓ ▓▓▓2▓▓ ▓▓▓1▓▓ ▓▓▓0▓▓ │
│ min: 2   │  ❌1    ✅2    ✅3    ✅2    ✅3    ✅2    ❌1    ❌0       │
└──────────┴──────────────────────────────────────────────────────────────┘

LEGENDA: ████ Trabalho  ░░░░ Intervalo/Folga  ▓▓▓ Cobertura (verde ✅ / vermelho ❌)
CORES:   🟢 CLT 44h  🔵 CLT 36h  🟣 Estagiario 20h  🔴 INDISPONIVEL
```

### Modos de Visualizacao

1. **Dia** (padrao): Um dia, eixo X = horas, mostra todos os colaboradores
2. **Semana** (mini): 7 colunas, cada coluna e um mini-timeline condensado

### Integracao com EscalaPagina

A timeline sera um **toggle de view** dentro das tabs existentes (Simulacao, Oficial, Historico):

```
[Simulacao] [Oficial] [Historico]

Periodo: [01/03/2026] - [31/03/2026]   [Gerar Escala]

Visualizacao: [📊 Grade] [📈 Timeline]     ← NOVO ViewToggle

┌──────────────────────────────────────┐
│  (conteudo muda baseado no toggle)   │
│  Grade → EscalaGrid (atual)          │
│  Timeline → TimelineGrid (novo)      │
└──────────────────────────────────────┘
```

### Informacoes no Hover/Tooltip

```
┌─────────────────────────┐
│ Maria Fernandes          │
│ CLT 44h | Padaria        │
│ ─────────────────────── │
│ 08:00 → 12:00 (4h)      │
│ INTERVALO (1h)           │
│ 13:00 → 17:20 (4h20)    │
│ ─────────────────────── │
│ Total: 8h20 / 9h30 meta │
│ Tipo: GERADA             │
└─────────────────────────┘
```

### Tratamento de Intervalos (Almoco/Folga)

- **Intervalo:** Se ha gap entre `hora_fim` da primeira alocacao e `hora_inicio` da segunda no mesmo dia, renderizar como barra translucida (10% opacity) com label "Intervalo"
- **Folga:** Linha inteira vazia com badge "FOLGA" centralizado
- **Indisponivel:** Linha inteira com fundo hachurado (diagonal stripes CSS) + badge "AUS."

### Barra de Cobertura

Na parte inferior da timeline, uma barra horizontal mostra a cobertura por faixa horaria:
- Verde: cobertura >= demanda minima
- Vermelho: cobertura < demanda minima
- Numeros: quantidade atual / necessaria

---

## Arquitetura do Componente

### Props

```typescript
interface TimelineGridProps {
  colaboradores: Colaborador[]
  alocacoes: Alocacao[]
  setor: Setor                    // para hora_abertura/hora_fechamento
  dataSelecionada: string         // "2026-03-01" — dia a exibir
  demandas?: Demanda[]
  tiposContrato?: TipoContrato[]
  readOnly?: boolean
  onCelulaClick?: (colaboradorId: number, data: string, statusAtual: string) => void
  loadingCell?: { colaboradorId: number; data: string } | null
  changedCells?: Set<string>
  violatedCells?: Set<string>
}
```

### Estrutura Interna

```
TimelineGrid/
├── TimelineGrid.tsx        # Componente principal
├── TimelineBar.tsx         # Barra individual de turno
├── TimelineHeader.tsx      # Header com horas do dia
├── TimelineCoverageRow.tsx # Linha de cobertura
└── useTimelineLayout.ts    # Hook: calcula posicoes das barras
```

**Ou** tudo em `TimelineGrid.tsx` como sub-componentes internos (como `EscalaGrid.tsx` faz hoje).

### Calculo de Posicao (CSS Grid)

```typescript
function calcBarPosition(
  horaInicio: string,          // "08:00"
  horaFim: string,             // "14:00"
  setorAbertura: string,       // "06:00"
  setorFechamento: string,     // "22:00"
  totalSlots: number           // ex: 32 slots de 30min para 16h
): { gridColumnStart: number; gridColumnEnd: number } {
  const startMin = toMinutes(horaInicio) - toMinutes(setorAbertura)
  const endMin = toMinutes(horaFim) - toMinutes(setorAbertura)
  const slotSize = 30 // minutos por slot

  return {
    gridColumnStart: Math.floor(startMin / slotSize) + 2, // +2 pq col 1 = nome
    gridColumnEnd: Math.floor(endMin / slotSize) + 2,
  }
}
```

### State Management

- **dataSelecionada**: useState local no TimelineGrid (ou prop da EscalaPagina)
- **viewMode**: 'dia' | 'semana' — state no EscalaPagina (novo)
- **Sem Zustand extra**: dados ja vem via props (alocacoes, colaboradores)

### Navegacao de Dia

- Botoes ◀ ▶ para navegar entre dias do periodo
- Click em dia no modo semana → alterna para modo dia daquele dia
- Teclado: ← → para navegar (acessibilidade)

---

## Requisitos Funcionais

- [ ] RF1: Renderizar barras horizontais representando turnos por colaborador num dia
- [ ] RF2: Eixo X = horas do setor (hora_abertura ate hora_fechamento) em slots de 30min
- [ ] RF3: Eixo Y = colaboradores ordenados por rank
- [ ] RF4: Sidebar esquerda fixa (nomes) com scroll horizontal independente
- [ ] RF5: Header superior fixo (horas) com scroll vertical independente
- [ ] RF6: Tooltip no hover com detalhes do turno (nome, horario, minutos, contrato, tipo)
- [ ] RF7: Cores das barras por tipo_contrato (CLT 44h = verde, CLT 36h = azul, Estagiario = roxo)
- [ ] RF8: Intervalos visiveis (gap entre blocos) com barra translucida
- [ ] RF9: Linha de cobertura no rodape (atual/necessario por faixa horaria)
- [ ] RF10: Folga e Indisponivel com visual diferenciado (badge, hachurado)
- [ ] RF11: Navegacao por dia (botoes ◀ ▶ ou teclado ← →)
- [ ] RF12: ViewToggle para alternar entre Grade (EscalaGrid) e Timeline (TimelineGrid)
- [ ] RF13: Dark mode completo (Tailwind dark: classes)
- [ ] RF14: Funcionar nas 3 tabs (Simulacao, Oficial, Historico)
- [ ] RF15: Celulas violadas destacadas (ring-destructive, como no EscalaGrid atual)

---

## Criterios de Aceitacao

- [ ] CA1: Timeline renderiza corretamente para 10-50 colaboradores sem lag perceptivel
- [ ] CA2: Barras posicionadas precisamente (hora_inicio/hora_fim mapeados para grid columns)
- [ ] CA3: Dark mode identico ao resto do app (sem "flash" ou cores inconsistentes)
- [ ] CA4: Tooltip mostra informacoes corretas (validar contra dados reais)
- [ ] CA5: Cobertura no rodape consistente com EscalaGrid (mesmos numeros)
- [ ] CA6: ViewToggle persiste durante a sessao (nao reseta ao trocar tab)
- [ ] CA7: tsc --noEmit passa com 0 erros
- [ ] CA8: Build electron-vite completa sem erros
- [ ] CA9: Componente readOnly funciona (sem click handlers, sem cursor-pointer)

---

## Constraints

- Electron desktop (nao web responsivo mobile)
- shadcn/ui + Tailwind (sem Material UI, Chakra, etc)
- CSS Grid puro (sem lib externa tipo react-calendar-timeline)
- Dark mode obrigatorio (ja existe no app)
- Usuarios nao-tecnicos (visual claro, sem jargao)
- snake_case ponta a ponta (props podem ser camelCase no React, dados sao snake_case)
- Nao alterar EscalaGrid existente — timeline e ADICAO, nao substituicao

---

## Fora do Escopo

- Drag-and-drop para mover turnos (futuro — v2.2)
- Resize de barras para ajustar horario (futuro)
- Zoom hora/dia/semana/mes (modo semana e stretch goal, nao obrigatorio)
- Impressao/exportacao da timeline (usar EscalaGrid + ExportarEscala existente)
- Criacao de novos turnos diretamente na timeline
- Animacoes complexas (transicoes simples ok)

---

## Servicos Envolvidos

- [x] Frontend (TimelineGrid, ViewToggle, integracao com EscalaPagina)
- [ ] Backend (nenhuma alteracao — dados ja existem via IPC)
- [ ] Database (nenhuma alteracao)
- [ ] Motor (nenhuma alteracao)

---

## Arquivos a Criar/Modificar

### Criar
- `src/renderer/src/componentes/TimelineGrid.tsx` — componente principal
- `src/renderer/src/componentes/ViewToggle.tsx` — toggle Grade/Timeline (pode ja existir)

### Modificar
- `src/renderer/src/paginas/EscalaPagina.tsx` — adicionar ViewToggle + render condicional
- `src/renderer/src/lib/cores.ts` — adicionar cores por tipo_contrato (se nao existem)

---

## Budget Sugerido

Baseado na complexidade:

- **Componente CSS Grid**: Logica de posicionamento moderada, mas padrao conhecido
- **Integracao**: Modificacao de 1 pagina existente (EscalaPagina)
- **Dark mode**: Ja padronizado, sem esforco extra
- **Sem backend**: Pure frontend

**Recomendacao:** **medium** — Componente visual complexo mas sem backend, sem migrations, sem IPC novo. Coder sonnet, critic opus.

---

## Notas Adicionais

### Performance

- CSS Grid com 50 colaboradores x 32 slots (30min) = ~1600 celulas → SEM PROBLEMA
- Electron desktop tem mais recursos que browser web
- Se performance degradar: virtualizar linhas com `react-window` (improvavel)

### Referencia de Mercado

O padrao When I Work / Deputy e o alvo visual. Nao copiar funcionalidade (drag-and-drop), apenas o LAYOUT (barras horizontais, sidebar fixa, header de horas).

### Componente ViewToggle

Pode ja existir em `src/renderer/src/componentes/ViewToggle.tsx` (visto no git status como untracked). Verificar e reusar se aplicavel.

### Paleta de Cores por Tipo de Contrato

```typescript
const CORES_CONTRATO: Record<string, { bar: string; text: string }> = {
  'CLT 44h':       { bar: 'bg-emerald-500/80 dark:bg-emerald-600/70', text: 'text-emerald-950 dark:text-emerald-100' },
  'CLT 36h':       { bar: 'bg-blue-500/80 dark:bg-blue-600/70',      text: 'text-blue-950 dark:text-blue-100' },
  'Estagiario 20h': { bar: 'bg-purple-500/80 dark:bg-purple-600/70',  text: 'text-purple-950 dark:text-purple-100' },
}
```
