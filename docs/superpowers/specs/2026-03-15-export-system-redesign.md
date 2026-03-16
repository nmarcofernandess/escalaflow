# Spec: Redesign Completo do Sistema de Exportação

**Data:** 2026-03-15
**Autor:** Marco + Monday (brainstorming session)
**Protótipo visual:** `.superpowers/brainstorm/96051-1773612355/export-inlined.html`
**Status:** APROVADO — pronto para implementação

---

## TL;DR

Refatoração completa do sistema de exportação do EscalaFlow. Três modos de export no mesmo componente modal (Setor, Funcionário, Em Massa). Novo componente de timeline com barras Gantt. CicloGrid paginado (máx 4 semanas por bloco). Avisos unificados (violações solver + avisos operacionais). Tudo cabe em A4 sem page-break lateral. Remoção do `gerarHTMLFuncionario.ts` e do fluxo Hub multi-setor antigo.

---

## 1. Contexto e Motivação

### 1.1 Problemas atuais

| Problema | Onde | Impacto |
|----------|------|---------|
| CicloGrid com 7 semanas estoura A4 | ExportarEscala.tsx | Tabela cortada na impressão |
| Export por funcionário é batch separado (HTMLs numa pasta) | gerarHTMLFuncionario.ts | Sem preview no modal, HTML interativo com JS que não imprime |
| Avisos operacionais (AvisosSection) não aparecem no export | ExportarEscala.tsx | RH perde alertas de cobertura e ciclo |
| EscalaTimelineDiaria (grid 15min) estoura A4 | EscalaTimelineDiaria.tsx | 49 colunas × 28px = 1372px, A4 landscape = 1047px |
| Fluxo Hub multi-setor obsoleto | ExportModal context="hub" | Código morto, UX confusa |
| Sem export na página do colaborador | ColaboradorDetalhe.tsx | Não dá pra gerar folha individual |
| Sem controle de page-break | ExportarEscala.tsx | Conteúdo cortado no meio pela impressora |
| `@page { size: A4 landscape }` fixo | ExportarEscala.tsx | Folha funcionário deveria ser portrait |
| "Semana 1, Semana 2" ao invés do número da semana do ano | EscalaTimelineDiaria | Confuso quando período cruza meses |

### 1.2 Decisões tomadas nesta sessão

Cada decisão foi discutida e confirmada pelo Marco.

---

## 2. Arquitetura de Componentes

### 2.1 Componente unificado: ExportarEscala (refatorado)

O componente `ExportarEscala.tsx` é refatorado para ser a fonte única de renderização do export. Ele recebe props que controlam quais seções são visíveis. O MESMO componente é usado tanto no preview do modal quanto na renderização final (HTML/print).

```
ExportarEscala.tsx (refatorado)
├── Header
│   ├── Título: "ESCALA: {SETOR}" (mode setor) ou nome do colaborador (mode func)
│   ├── Período: data_inicio a data_fim
│   ├── Pontuação (só mode setor)
│   └── Badge de status (OFICIAL/RASCUNHO/ARQUIVADA)
│
├── Seção: Ciclo Rotativo                    ← controlado por prop `mostrarCiclo`
│   └── CicloGrid mode="view" com paginação (max 4 sem/bloco)
│
├── Seção: Escala Semanal                    ← controlado por prop `mostrarSemanal`
│   └── Tabela por semana (S10, S11... = semana do ANO)
│   └── 7 colunas (DOM-SAB) com data, hora_inicio, hora_fim por célula
│   └── Total de horas por semana
│
├── Seção: Timeline Diária                   ← controlado por prop `mostrarTimeline`
│   └── Sub-modo controlado por prop `timelineMode: 'barras' | 'grid'`
│   ├── Barras (Gantt): proporcionais ao eixo de horas, almoço hachurado, cobertura embaixo
│   └── Grid (Slots 15min): tabela com 1 célula por slot (alternativa)
│   └── Cada dia empilhado verticalmente (Seg, Ter, Qua...)
│
├── Seção: Avisos                            ← controlado por prop `mostrarAvisos`
│   └── Bloco único unificado: violações solver (HARD/SOFT) + avisos operacionais (COB_DEFICIT, etc)
│
└── Footer
    ├── Legenda dos símbolos
    └── "EscalaFlow v{version} | {data}"
```

### 2.2 Props do ExportarEscala refatorado

```typescript
interface ExportarEscalaProps {
  // Dados
  escala: Escala
  alocacoes: Alocacao[]
  colaboradores: Colaborador[]
  setor: Setor
  violacoes?: Violacao[]
  avisos?: Aviso[]               // NOVO: avisos operacionais (AvisosSection)
  tiposContrato?: TipoContrato[]
  funcoes?: Funcao[]
  horariosSemana?: SetorHorarioSemana[]
  regrasPadrao?: RegraHorarioColaborador[]

  // Controle de seções visíveis
  mostrarCiclo?: boolean         // default true
  mostrarSemanal?: boolean       // default true
  mostrarTimeline?: boolean      // default true
  timelineMode?: 'barras' | 'grid'  // default 'barras'
  mostrarAvisos?: boolean        // default true

  // Mode
  mode?: 'setor' | 'funcionario'
  colaboradorId?: number         // só quando mode='funcionario'
}
```

### 2.3 Quando mode='funcionario'

- Header mostra dados do colaborador (nome, posto, contrato, setor, período)
- Seções Ciclo/Semanal/Timeline são OCULTADAS (não renderizam)
- Renderiza a "Folha do Funcionário" (ver seção 3.5)
- Avisos filtrados para aquele colaborador
- Os dados de ciclo/escala PERMANECEM nas props (não são removidos) — são usados internamente para derivar as informações do funcionário

---

## 3. Componentes de Renderização (Detalhes)

### 3.1 CicloGrid Paginado

**Mudança principal:** quando o ciclo tem mais de 4 semanas, quebra em blocos de até 4 semanas, repetindo os nomes dos colaboradores em cada bloco.

**Regras:**
- Máximo 4 semanas por bloco (28 colunas de dados + 3 sticky = 31 colunas)
- Se ciclo <= 4 semanas: 1 bloco, sem título de bloco
- Se ciclo 5-7 semanas: 2 blocos (ex: S1–S4 + S5–S7)
- Se ciclo 8 semanas (teórico): 2 blocos de 4
- Cada bloco repete: header completo (nomes, Var, Fixo, letras dos dias)
- Linha de COBERTURA aparece no fim de CADA bloco
- Borda roxa de fim de ciclo só aparece no dia correto (último sábado do ciclo)
- Legenda aparece UMA VEZ, depois do último bloco
- `table-layout: fixed` — colunas se distribuem igualmente no espaço
- Para print: cada bloco tem `break-inside: avoid`
- Título do bloco: "S1 – S4" (quando há mais de 1 bloco)

**Cálculo de fit A4 landscape (277mm = 1047px@96dpi):**
- 3 sticky cols: nome (90px) + var (30px) + fixo (30px) = 150px
- 28 day cols: (1047 - 150) ÷ 28 = ~32px por célula
- Com font 9-10px e padding 2px: cabe perfeitamente

**Cores dos símbolos (tokens semânticos — já implementados):**
| Símbolo | Cell class | Significado |
|---------|-----------|-------------|
| T | `bg-success/10 text-success` | Trabalho |
| FF | `bg-muted text-muted-foreground` | Folga fixa |
| FV | `bg-warning/10 text-warning` | Folga variável |
| DT | `bg-warning/10 text-warning ring-1 ring-inset ring-warning/40` | Domingo trabalhado |
| DF | `bg-primary/10 text-primary ring-1 ring-inset ring-primary/30` | Domingo folga |
| I | `bg-destructive/10 text-destructive` | Indisponível |

### 3.2 Escala Semanal

Tabela por semana com horários reais (output do solver) em cada célula.

**Layout:**
```
S10 — 01/03 a 07/03/2026

| Colaborador | DOM 01/03 | SEG 02/03 | TER 03/03 | ... | SAB 07/03 |
|-------------|-----------|-----------|-----------|-----|-----------|
| Alex        | **08**    | F         | **08**    | ... | **08**    |
|             | 15:10     |           | 15:10     |     | 15:10     |
| Mateus      | F         | **08**    | **08**    | ... | **08**    |
|             |           | 15:20     | 15:20     |     | 15:20     |
```

**Regras:**
- Título: `S{número_da_semana_do_ano}` — ex: S10, S11, S12 (NÃO "Semana 1, Semana 2")
  - Cálculo: `getWeekNumber(date)` — ISO 8601 week number
- Subtítulo: `{data_inicio} a {data_fim}/{ano}`
- Colunas: 7 (DOM a SAB) com data embaixo do dia
- Domingo: cor `primary` (bold)
- Sábado: bold
- Trabalho: hora_inicio (bold, grande) + hora_fim (small, abaixo)
- Folga: "F", "FF", "FV", "DF" — cor muted
- Indisponível: "I" — cor destructive
- Uma tabela por semana, empilhadas verticalmente
- Última semana pode ser parcial (ex: 29-31/03 = 3 dias)
- Total de alocações por semana (rodapé)
- Cabe em A4 portrait OU landscape (7 colunas = fácil)
- Para print: `break-inside: avoid` por tabela de semana. Se não couber vertical, pula página — as linhas da MESMA tabela continuam na próxima.

### 3.3 Timeline Diária — Barras (Gantt)

**Visualização preferida pelo Marco.** Barras horizontais proporcionais ao eixo de horas.

**Layout por dia:**
```
Segunda 02/03/2026

07:00    09:00    11:00    13:00    15:00    17:00    19:15
  |        |        |        |        |        |        |
Mateus    ████████████████   ALM   ████████████
AC2                07:00–11:00      12:00–15:20          7h20

Jose Luiz    ████████████████████   ALM   ████████████
AC3              07:30–12:00           13:00–16:00       7h30

Pedro                              Folga Fixa (Seg)      —
AC4

─────────────────────────────────────────────────────────
Cobertura   [1] [  2  ] [ 3 ] [1] [ 2 ] [  3  ] [2] [1]    max 3
```

**Regras:**
- Eixo de horas: proporcional (hora_abertura do setor até hora_fechamento)
- Barra de trabalho: `bg-primary` com hora início–fim em branco dentro
- Almoço: gap hachurado (diagonal stripes) com "ALM" em warning
- Folga: texto muted italic ("Folga Fixa", "Folga Variável", "Folga (dom ciclo)")
- Indisponível: barra hachurada vermelha com border dashed
- Total de horas: à direita de cada linha
- Barra de cobertura: abaixo de todos, intensidade de cor proporcional ao número de pessoas
  - 1 pessoa: `rgba(primary, 0.25)` — cor fraca
  - 2 pessoas: `rgba(primary, 0.5)` — cor média
  - 3+ pessoas: `rgba(primary, 0.7)` — cor forte
  - Texto: número de pessoas dentro do segmento
  - "max N" à direita
- Cada dia empilhado verticalmente: Segunda, Terça, Quarta...
- Nome do dia: "Segunda 02/03/2026" como section title
- Para print: cada dia tem `break-inside: avoid`
- **Sempre cabe em A4 landscape** — largura é proporcional (não colunas fixas)
- Domingo trabalhado: "★" ao lado do nome do posto

### 3.4 Timeline Diária — Grid (Slots 15min)

**Alternativa para quem prefere tabela.** Mantém o componente `EscalaTimelineDiaria` atual.

**Regras:**
- Mesmos dados que Barras, apresentação diferente
- Uma célula por slot de 15 minutos
- Cada dia empilhado (mesma lógica de "um abaixo do outro")
- A4 landscape: 49 colunas (07:00–19:15) estoura? → aceitar o scroll no app, mas no print agrupar por hora (12 colunas) OU manter 49 com font 8px
- Toggle entre Barras e Grid: dropdown no header da seção ("Barras ▾" / "Grid")
- Grid herda do componente existente `EscalaTimelineDiaria.tsx`

### 3.5 Folha do Funcionário

**O que o funcionário recebe na mão.** A4 portrait. Acessado via ColaboradorDetalhe → botão "Exportar Escala".

**Layout:**
```
┌──────────────────────────────────────────────────┐
│  [MA]  Mateus Silva                    44h  Seg  │
│        Açougue — AC2 | CLT 44h        contr FF   │
│        01/03 a 31/03/2026                   Qua  │
│                                            FV    │
├──────────────────────────────────────────────────┤
│  S10 — 01/03 a 07/03/2026                       │
│  ┌──────┬──────────────┬───────────┬─────┬─────┐ │
│  │ Dia  │ Horário      │ Almoço    │Total│ Obs │ │
│  ├──────┼──────────────┼───────────┼─────┼─────┤ │
│  │DOM 01│ 08:00–15:20  │11:00–12:00│7h20 │DT   │ │
│  │SEG 02│ Folga Fixa   │           │     │FF   │ │
│  │TER 03│ 08:00–15:20  │11:00–12:00│7h20 │     │ │
│  │QUA 04│ Folga Var.   │           │     │FV   │ │
│  │QUI 05│ 08:00–15:20  │11:00–12:00│7h20 │     │ │
│  │SEX 06│ 08:00–15:20  │11:00–12:00│7h20 │     │ │
│  │SAB 07│ 08:00–15:20  │11:00–12:00│7h20 │     │ │
│  ├──────┴──────────────┴───────────┼─────┼─────┤ │
│  │                   Total semana: │36h40│/ 44h│ │
│  └─────────────────────────────────┴─────┴─────┘ │
│                                                  │
│  S11 — 08/03 a 14/03/2026                       │
│  (mesma estrutura, próxima semana)               │
│  ... S12, S13, S14 continuam nas páginas seg.    │
│                                                  │
│  Avisos (1)                                      │
│  ┌──────────────────────────────────────────────┐│
│  │ S3: 2 domingos consecutivos (01/03 e 08/03)  ││
│  └──────────────────────────────────────────────┘│
│                                                  │
│  FF=Fixa FV=Var DF=Dom Folga DT=Dom Trab ALM=Alm│
│  EscalaFlow v1.5.6 | 15/03/2026                 │
└──────────────────────────────────────────────────┘
```

**Regras:**
- **Header do funcionário:**
  - Avatar com iniciais (ex: "MA")
  - Nome completo
  - Setor — Posto
  - Contrato (CLT 44h, Estag 20h)
  - Período da escala
  - Stats: horas contrato, folga fixa, folga variável
- **Tabela por semana:** S{número_ano} — data_inicio a data_fim
  - Colunas: Dia (DOW + dd), Horário (hora_inicio–hora_fim), Almoço, Total, Obs
  - Domingo: cor primary, bold
  - Folga: "Folga Fixa", "Folga Variável", "Folga (dom ciclo)" — colspan 3
  - Obs: badge FF/FV/DF/DT quando aplicável
  - Total semana no rodapé: soma de minutos / horas contrato
- **Avisos:** apenas os que mencionam ESTE colaborador (filtrados por `colaborador_id` ou `colaborador_nome`)
- **Footer:** legenda + versão
- **Print:** A4 portrait, `break-inside: avoid` por tabela de semana
- **Horários vêm do solver (alocações)** — NÃO do perfil de horário. O solver pode variar o horário dia a dia conforme a demanda.
- **Dados do ciclo/escala permanecem** nas props do componente — são usados internamente para gerar a folha. As seções Ciclo/Semanal/Timeline ficam OCULTAS (não renderizam), mas os dados não são removidos.

### 3.6 Avisos Unificados

**Mudança:** unificar violações do solver (HARD/SOFT) com avisos operacionais do `AvisosSection` (COB_DEFICIT, TT_CONSECUTIVO, etc) num bloco único.

**Fonte dos dados:**
- `escala.violacoes[]` — vem do solver (regra, severidade, colaborador_nome, data, mensagem)
- `avisosOperacao[]` — vem do `buildAvisosFromPreview()` ou equivalente (id, nivel, titulo, descricao, contexto_ia)

**Renderização no export:**
```
Avisos (5)
┌─ HARD ──────────────────────────────────────────────────────┐
│ Jose Luiz — H1: mais de 6 dias consecutivos (02/03–08/03)  │
│ Jessica — H3: mulher 2 dom consecutivos (Art 386 CLT)       │
└─────────────────────────────────────────────────────────────┘
┌─ SOFT ──────────────────────────────────────────────────────┐
│ Mateus — S3: 2 domingos consecutivos trabalhados            │
│ Robert — S5: preferência de turno ignorada                  │
└─────────────────────────────────────────────────────────────┘
┌─ INFO ──────────────────────────────────────────────────────┐
│ COB_DEFICIT: cobertura abaixo da demanda em Qua (2/3 10–12h)│
└─────────────────────────────────────────────────────────────┘
```

**CSS classes (já existem):**
- `.av-h` = HARD (destructive-bg)
- `.av-s` = SOFT (warning-bg)
- `.av-i` = INFO (primary-bg)

---

## 4. Modal de Export (ExportModal — refatorado)

### 4.1 Mesmo componente, 3 modos

O `ExportModal.tsx` é refatorado para ser um componente único com 3 modos (`mode: 'setor' | 'funcionario' | 'massa'`).

```typescript
interface ExportModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: 'setor' | 'funcionario' | 'massa'

  // Mode 'setor'
  escala?: Escala
  alocacoes?: Alocacao[]
  colaboradores?: Colaborador[]
  setor?: Setor
  violacoes?: Violacao[]
  avisos?: Aviso[]
  tiposContrato?: TipoContrato[]
  funcoes?: Funcao[]
  horariosSemana?: SetorHorarioSemana[]
  regrasPadrao?: RegraHorarioColaborador[]

  // Mode 'funcionario'
  colaborador?: Colaborador         // o colaborador selecionado
  // (+ mesmos dados de escala acima, filtrados pro colaborador)

  // Mode 'massa'
  setoresDisponiveis?: SetorExportItem[]

  // Callbacks
  onExportHTML?: () => void
  onPrint?: () => void
  onCSV?: () => void
  onExportMassa?: (setorIds: number[]) => void
}
```

### 4.2 Mode A: Setor

**Onde abre:** EscalaPagina → botão Exportar. OU SetorDetalhe → seção Escala → botão Exportar.
**Ambos usam o MESMO modal, mesmo código.** Não duplicar.

**Layout do modal:**
```
┌─────────────────────────────────────────────────────────────────────┐
│  Exportar Escala — Açougue                                    [X]  │
├─────────────────────────────────────┬───────────────────────────────┤
│                                     │  Conteúdo                     │
│         PREVIEW (60%)               │                               │
│                                     │  [✓] Ciclo Rotativo           │
│  (renderiza ExportarEscala          │  [✓] Escala Semanal           │
│   com os toggles ativos,            │  [✓] Timeline Diária          │
│   escalado via zoom/transform)      │       [Barras ▾] ← dropdown   │
│                                     │  [✓] Avisos                   │
│  Muda em TEMPO REAL conforme        │                               │
│  liga/desliga os toggles.           │                               │
│                                     │                               │
├─────────────────────────────────────┴───────────────────────────────┤
│                          [Cancelar]  [CSV]  [Baixar HTML]  [Print] │
└─────────────────────────────────────────────────────────────────────┘
```

**Comportamento dos toggles:**
- Toggle ON → seção visível no preview e no export final
- Toggle OFF → seção oculta, MAS o estado do toggle é preservado (ex: se desliga Semanal e depois liga de novo, ele volta no estado anterior)
- Toggle OFF visualmente: switch desligado, texto muted
- Dropdown "Barras ▾" / "Grid" → sub-modo da Timeline Diária. Só aparece quando Timeline está ON.
- **Pelo menos 1 toggle deve estar ON** para habilitar os botões de export. Se todos OFF: botões disabled + tooltip "Selecione ao menos um conteúdo".

**Preview:**
- Usa o componente `ExportPreview.tsx` existente (wrapper com zoom e forced light mode)
- Dentro: `<ExportarEscala>` com as props dos toggles ativos
- Escala do preview: `zoom: 0.4` (ou `transform: scale(0.55)` com `width: 182%`)

**Footer:**
- CSV: exporta alocações + comparação demanda + violações (se avisos ON)
- Baixar HTML: gera `renderToStaticMarkup()` + `buildStandaloneHtml()` → salva .html
- Imprimir: gera HTML → iframe → `window.print()`

### 4.3 Mode B: Funcionário

**Onde abre:** ColaboradorDetalhe → botão "Exportar Escala"
**Condição de visibilidade:** o botão SÓ aparece se o setor do colaborador tem escala com status `OFICIAL`.
**Se não tem escala OFICIAL:** botão não renderiza.

**Layout do modal:**
```
┌─────────────────────────────────────────────────────────────────────┐
│  Exportar Escala — Mateus Silva                               [X]  │
├─────────────────────────────────────┬───────────────────────────────┤
│                                     │  Escala de                    │
│         PREVIEW (60%)               │  Mateus Silva                 │
│                                     │                               │
│  (renderiza ExportarEscala          │  Açougue — AC2                │
│   mode='funcionario'                │  CLT 44h                      │
│   colaboradorId={id})               │  01/03 a 31/03/2026           │
│                                     │  Status: OFICIAL              │
│  = Folha do Funcionário             │                               │
│                                     │  [✓] Avisos pessoais          │
│                                     │                               │
├─────────────────────────────────────┴───────────────────────────────┤
│                              [Cancelar]  [Baixar HTML]    [Print]  │
└─────────────────────────────────────────────────────────────────────┘
```

**Diferenças do Mode A:**
- Painel de opções simplificado: só info do colaborador + toggle de avisos pessoais
- Preview renderiza a Folha do Funcionário (não a escala completa)
- SEM botão CSV (não faz sentido pra folha individual)
- SEM toggles de Ciclo/Semanal/Timeline (sempre renderiza a folha)
- Print: `@page { size: A4 portrait }` (não landscape)

### 4.4 Mode C: Em Massa

**Onde abre:** Página Escalas (EscalasHub) → botão "Exportar em Massa" no header, alinhado à direita.

**Layout do modal:**
```
┌─────────────────────────────────────────────────────┐
│  Exportar em Massa                             [X]  │
├─────────────────────────────────────────────────────┤
│  Selecione os setores com escala oficial.           │
│                                                     │
│  [─] Selecionar todos              3 de 5           │
│  ─────────────────────────────────────────────      │
│  [✓] Açougue                         OFICIAL        │
│  [✓] Rotisseria                      OFICIAL        │
│  [✓] Caixa                           OFICIAL        │
│  [ ] Frios                      sem escala (dim)    │
│  [ ] Padaria                     RASCUNHO (dim)     │
│                                                     │
│  ─────────────────────────────────────────────      │
│  [✓] Incluir avisos                                 │
│                                                     │
├─────────────────────────────────────────────────────┤
│  3 setores selecionados    [Cancelar] [Exportar 3]  │
└─────────────────────────────────────────────────────┘
```

**Regras:**
- **SEM preview** — modal mais estreito (~500px), sem split de preview/opções
- **Só OFICIAL habilitado** — setores sem escala ou com RASCUNHO ficam disabled (opacity 0.3, checkbox desabilitado)
- **Checkbox "Selecionar todos":**
  - Se todos OFICIAL estão selecionados: `[✓]` (checked)
  - Se nenhum: `[ ]` (unchecked)
  - Se alguns: `[─]` (indeterminate)
  - Clicar em `[─]` → desmarca todos. Clicar em `[ ]` → marca todos os OFICIAL.
- **Toggle "Incluir avisos":** ON por padrão
- **Botão "Exportar N setores":** gera batch de HTMLs (1 por setor selecionado), salva numa pasta via dialog do sistema
- **Contagem:** "N setores selecionados" no footer

---

## 5. Fluxos de Navegação

### 5.1 Fluxo A — Export Setor

```
Setores → Açougue → aba Escala → botão [Exportar]
                                    ↓
                            ExportModal mode='setor'
                                    ↓
                    [Print] / [Baixar HTML] / [CSV]
```

OU:

```
Setores → Açougue → SetorDetalhe → seção Escala → botão [Exportar]
                                                      ↓
                                              ExportModal mode='setor'
                                              (MESMO componente, MESMO código)
```

### 5.2 Fluxo B — Export Funcionário

```
Colaboradores → Mateus → ColaboradorDetalhe
                              ↓
              botão [Exportar Escala] (só se setor tem OFICIAL)
                              ↓
                      ExportModal mode='funcionario'
                              ↓
                    [Print] / [Baixar HTML]
```

**Como obter os dados do colaborador:**
1. ColaboradorDetalhe já tem `colab.setor_id`
2. Buscar escala OFICIAL do setor: `SELECT * FROM escalas WHERE setor_id = ? AND status = 'OFICIAL' ORDER BY id DESC LIMIT 1`
3. Buscar alocações, violações, regras pra essa escala + filtrar pro `colaborador_id`
4. Passar pro ExportModal

### 5.3 Fluxo C — Export em Massa

```
Escalas (EscalasHub) → botão [Exportar em Massa] (header, direita)
                              ↓
                      ExportModal mode='massa'
                              ↓
              Selecionar setores → [Exportar N setores]
                              ↓
                   Batch: 1 HTML por setor → pasta
```

---

## 6. Regras de Impressão e A4

### 6.1 Tamanhos

| Componente | Orientação A4 | Largura real | Cabe? |
|-----------|---------------|-------------|-------|
| CicloGrid (4 sem/bloco) | Landscape | 150px sticky + 28×32px = 1046px | ✅ sim (1047px disponível) |
| CicloGrid (2-3 sem) | Landscape | 150 + 14-21×40px = 710-990px | ✅ folgado |
| Escala Semanal | Portrait ou Landscape | 7 colunas ≈ 600px | ✅ folgado |
| Timeline Barras | Landscape | Proporcional (flex) | ✅ sempre cabe |
| Timeline Grid | Landscape | 49 cols × 20px + 120px = 1100px | ⚠️ apertado, font 8px |
| Folha Funcionário | Portrait | 5 colunas ≈ 500px | ✅ folgado |
| Avisos | Qualquer | Texto corrido | ✅ |

### 6.2 Page-break

| Regra | Implementação |
|-------|--------------|
| **Page-break lateral: NUNCA** | Conteúdo sempre cabe na largura da orientação escolhida |
| **Page-break vertical entre seções** | `break-before: page` quando muda de tipo (ciclo → semanal → timeline) |
| **Page-break vertical dentro de seção** | Flui naturalmente. Ex: 5 semanas de "Escala Semanal" = se a 4ª não couber, vai pra próxima página |
| **CicloGrid blocos** | `break-inside: avoid` por bloco. Se bloco não couber, pula página inteira |
| **Timeline dias** | `break-inside: avoid` por dia. Se dia não couber, próxima página |
| **Folha Funcionário semanas** | `break-inside: avoid` por tabela de semana |

### 6.3 @page dinâmico

```css
/* Mode setor */
@page { size: A4 landscape; margin: 10mm; }

/* Mode funcionário */
@page { size: A4 portrait; margin: 10mm; }
```

O componente `ExportarEscala` injeta o `<style>` correto baseado no `mode`.

### 6.4 Print color-adjust

```css
body { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
```

Já existe no componente atual. Manter.

---

## 7. CSV

### 7.1 O que exporta

| Bloco CSV | Condição |
|-----------|----------|
| Alocações (data, colaborador, status, horários, minutos) | Sempre |
| Comparação Demanda (data, hora, planejado, executado, delta) | Sempre |
| Violações + Avisos (colaborador, regra, severidade, mensagem) | Se toggle "Avisos" ON |

### 7.2 Formato

- Separador: `;` (ponto-e-vírgula) — compatível com Excel BR e Numbers
- Encoding: UTF-8 com BOM (`\uFEFF`) — já implementado
- Blocos separados por linha em branco
- Nome do arquivo: `escala-{setor-slug}.csv`

### 7.3 Compatibilidade Numbers/Excel

**Validar durante implementação:**
- Abrir no Numbers (macOS) — verificar que encoding e separador funcionam
- Abrir no Excel — verificar que BOM é reconhecido
- Acentos (çãéí) devem aparecer corretamente
- Datas no formato ISO (`2026-03-01`) — Excel reconhece automaticamente
- Horas no formato `HH:MM` — Excel reconhece como hora

---

## 8. O que REMOVE (código morto)

| Item | Arquivo(s) | Motivo |
|------|-----------|--------|
| `ExportModal` context="hub" | ExportModal.tsx | Fluxo Hub multi-setor não existe mais |
| `HubOptions` component | ExportModal.tsx | Substituído por Mode C (Em Massa) |
| `gerarHTMLFuncionario.ts` | lib/gerarHTMLFuncionario.ts | HTML interativo com JS (batch) — substituído por Folha do Funcionário inline |
| Formatos "batch", "batch-geral", "funcionario" | ExportModal.tsx, EscalaPagina.tsx | Não existem mais como opções |
| `handleExportFuncionariosBatch()` | EscalaPagina.tsx | Substituído pelo Mode C |
| `gerarHTMLFuncionarioById()` | EscalaPagina.tsx | Substituído pelo Mode B |
| `EscalaTimelineDiaria` como componente de export | ExportarEscala.tsx | Absorvido como sub-modo "Grid" dentro do ExportarEscala refatorado |
| Gráfico de cobertura no export | — | Nunca existiu, mas confirmar que NÃO entra. CSV basta. |

---

## 9. O que CRIA (código novo)

| Item | Arquivo(s) sugerido(s) | Descrição |
|------|----------------------|-----------|
| Timeline Barras (Gantt) no export | componentes/ExportTimelineBarras.tsx | Novo componente de renderização. Barras proporcionais, almoço hachurado, cobertura em barra de intensidade |
| Folha do Funcionário | componentes/ExportFolhaFuncionario.tsx | Header com dados + tabela dia-a-dia por semana + avisos pessoais |
| CicloGrid paginação | componentes/CicloGrid.tsx (refatorar) | Lógica de "max 4 sem/bloco" com repetição de nomes |
| Avisos unificados | componentes/ExportAvisos.tsx ou inline | Unifica violações solver + avisos AvisosSection |
| Botão "Exportar em Massa" | paginas/EscalasHub.tsx | No header, alinhado à direita |
| Mode 'massa' no ExportModal | componentes/ExportModal.tsx | Checkbox list com indeterminate, só OFICIAL |
| Mode 'funcionario' no ExportModal | componentes/ExportModal.tsx | Preview da folha + info do colaborador |
| Botão "Exportar Escala" em ColaboradorDetalhe | paginas/ColaboradorDetalhe.tsx | Só visível se setor tem OFICIAL |
| Semana do ano (S10, S11...) | Qualquer lugar que mostra semana | `getISOWeekNumber()` helper |
| Dropdown Barras/Grid | componentes/ExportModal.tsx | No toggle de Timeline Diária |
| CSS de print dinâmico | componentes/ExportarEscala.tsx | `@page { size: A4 landscape }` vs `portrait` |

---

## 10. Views no App (não export)

As views de escala no app (dentro de SetorDetalhe, EscalaPagina) também precisam de ajustes para consistência com o export.

### 10.1 Toggles no header da seção Escala

```
[✓ Ciclo] [✓ Semanal] [✓ Timeline Diária]
```

- Toggle ON → seção visível no app
- Toggle OFF → seção oculta
- Timeline Diária tem sub-toggle: `[Grid ⊞]` `[Barras ≡]` (ícones de view mode)
- Os toggles do app correspondem 1:1 com os toggles do modal de export
- Estado persistido no `localStorage` (ou Zustand store)

### 10.2 Semana do ano

Em TODOS os lugares que mostram "Semana 1", "Semana 2" → trocar para S{ISO_WEEK}:
- Escala Semanal (export)
- Folha do Funcionário (export)
- EscalaTimelineDiaria (app)
- Qualquer outro lugar

### 10.3 Timeline no app

O `TimelineGrid.tsx` existente (barras no app) permanece como está — já é a visualização tipo Gantt. A versão de export (`ExportTimelineBarras.tsx`) é um componente de renderização estático (sem interação, sem hover, sem click), otimizado pra print.

---

## 11. Cores e Tokens Semânticos

Todas as cores no export usam tokens semânticos. **Nenhum hardcoded.** Isso foi implementado na sessão anterior (shadcn cleanup) e se aplica também aos novos componentes.

| Uso | Token |
|-----|-------|
| Trabalho | `success` |
| Folga fixa | `muted` |
| Folga variável | `warning` |
| Domingo trabalhado | `warning` com ring |
| Domingo folga | `primary` com ring |
| Indisponível | `destructive` |
| Barras de turno | `primary` |
| Barra de cobertura | `primary` com opacidades |
| Avisos HARD | `destructive-bg` |
| Avisos SOFT | `warning-bg` |
| Avisos INFO | `primary-bg` |
| Fim de ciclo | `#8b5cf6` (roxo fixo — marca visual, não semântico) |

---

## 12. Dependências e Ordem de Implementação

### 12.1 Dependências

```
CicloGrid paginação ← não depende de nada
Semana do ano helper ← não depende de nada
ExportTimelineBarras ← não depende de nada
ExportFolhaFuncionario ← depende de Semana do ano helper
ExportAvisos ← não depende de nada
ExportarEscala refatorado ← depende de todos acima
ExportModal refatorado ← depende de ExportarEscala refatorado
Botão em ColaboradorDetalhe ← depende de ExportModal
Botão em EscalasHub ← depende de ExportModal
Remoção de código morto ← depende de tudo acima estar funcionando
```

### 12.2 Ordem sugerida

1. `getISOWeekNumber()` helper
2. CicloGrid paginação (max 4 sem/bloco)
3. ExportTimelineBarras (Gantt estático)
4. ExportFolhaFuncionario
5. ExportAvisos (unificação)
6. ExportarEscala refatorado (compõe 2-5)
7. ExportModal refatorado (3 modes)
8. Botão em ColaboradorDetalhe (Mode B)
9. Botão em EscalasHub "Exportar em Massa" (Mode C)
10. Remoção de código morto (gerarHTMLFuncionario, HubOptions, etc)
11. Testes visuais (print em PDF, verificar A4)

---

## 13. Critérios de Aceitação

### 13.1 Export Setor (Mode A)

- [ ] Modal abre de EscalaPagina e SetorDetalhe (mesmo componente)
- [ ] Preview renderiza em tempo real conforme toggles
- [ ] Toggle OFF oculta seção, toggle ON mostra
- [ ] Dropdown Barras/Grid funciona na Timeline
- [ ] Pelo menos 1 toggle ON para habilitar botões
- [ ] [Print] gera PDF que cabe em A4 landscape sem cortar
- [ ] [Baixar HTML] gera arquivo self-contained que abre no browser
- [ ] [CSV] exporta alocações + comparação demanda + violações
- [ ] CicloGrid com 7 semanas pagina em 2 blocos (4+3) sem estourar
- [ ] Semanas usam número do ano (S10, S11...)
- [ ] Avisos unificados (solver + operacionais)
- [ ] Footer com legenda e versão

### 13.2 Export Funcionário (Mode B)

- [ ] Botão "Exportar Escala" aparece em ColaboradorDetalhe só se setor tem OFICIAL
- [ ] Modal renderiza Folha do Funcionário (header + tabelas por semana)
- [ ] Toggle de avisos pessoais funciona
- [ ] Print gera PDF A4 portrait
- [ ] HTML é self-contained
- [ ] Horários corretos (do solver, não do perfil)
- [ ] Total por semana correto
- [ ] Semanas com S{ISO_WEEK}

### 13.3 Export em Massa (Mode C)

- [ ] Botão "Exportar em Massa" aparece no header do EscalasHub
- [ ] Modal mostra checkboxes para setores com OFICIAL
- [ ] Setores sem escala ou RASCUNHO ficam disabled
- [ ] "Selecionar todos" com comportamento indeterminate
- [ ] Toggle "Incluir avisos" funciona
- [ ] Exporta batch de HTMLs numa pasta
- [ ] Sem preview

### 13.4 Print/A4

- [ ] Nenhum conteúdo estoura lateralmente em A4 landscape (setor) ou portrait (func)
- [ ] Page-break vertical natural entre seções
- [ ] CicloGrid: break-inside avoid por bloco
- [ ] Escala Semanal: break-inside avoid por tabela
- [ ] Timeline: break-inside avoid por dia
- [ ] Cores aparecem na impressão (print-color-adjust: exact)

---

## 14. Backend / IPC / Infra

### 14.1 IPC Handlers existentes (manter)

Os handlers de export no `tipc.ts` já existem e continuam funcionando. Não precisam de mudança estrutural:

| Handler | O que faz | Manter? |
|---------|-----------|---------|
| `export.salvarHTML` | `dialog.showSaveDialog()` → `writeFile()` com html string | ✅ Manter |
| `export.salvarCSV` | `dialog.showSaveDialog()` → `writeFile()` com BOM + csv string | ✅ Manter |
| `export.batchHTML` | `dialog.showOpenDialog(directory)` → loop `writeFile()` por arquivo | ✅ Manter (usado pelo Mode C em massa) |
| `export.imprimirPDF` | `BrowserWindow` offscreen → `printToPDF()` → `showSaveDialog()` | ✅ Manter |

### 14.2 IPC Handler novo: `export.batchSetores`

O Mode C (em massa) precisa gerar 1 HTML por setor. A lógica de montar o HTML de cada setor **roda no renderer** (React → `renderToStaticMarkup`), mas o salvar em batch roda no main via `export.batchHTML` existente.

**Fluxo Mode C:**
```
Renderer:
  1. Para cada setor selecionado:
     a. Buscar escala OFICIAL do setor (pode já estar no appDataStore ou fetch via IPC)
     b. Buscar alocacoes, violacoes, colaboradores, funcoes, regras
     c. Renderizar <ExportarEscala> com renderToStaticMarkup()
     d. Wrappear com buildStandaloneHtml()
  2. Montar array: [{ nome: 'acougue', html: '...' }, { nome: 'rotisseria', html: '...' }]
  3. Chamar exportarService.batchHTML(array)

Main (export.batchHTML):
  1. showOpenDialog → escolher pasta
  2. writeFile cada arquivo
  3. Retornar { pasta, count }
```

**Não precisa de handler novo.** O `export.batchHTML` existente já faz isso. A mudança é só no renderer (quem monta o HTML).

### 14.3 Serviço renderer (exportar.ts)

O serviço `exportar.ts` já tem os métodos necessários:

```typescript
// src/renderer/src/servicos/exportar.ts — MANTER COMO ESTÁ
export const exportarService = {
  salvarHTML: (html, filename?) => client['export.salvarHTML'](...),
  imprimirPDF: (html, filename?) => client['export.imprimirPDF'](...),
  salvarCSV: (csv, filename?) => client['export.salvarCSV'](...),
  batchHTML: (arquivos) => client['export.batchHTML'](...),
}
```

Nenhum método novo necessário. Os 4 métodos cobrem todos os 3 modes.

### 14.4 buildStandaloneHtml — ajuste para @page dinâmico

O `buildStandaloneHtml()` em `lib/export-standalone-html.ts` precisa de um ajuste: aceitar um parâmetro de orientação da página.

```typescript
// ANTES
interface BuildStandaloneHtmlOptions {
  title?: string
  extraCss?: string
  forceLight?: boolean
}

// DEPOIS
interface BuildStandaloneHtmlOptions {
  title?: string
  extraCss?: string
  forceLight?: boolean
  pageOrientation?: 'landscape' | 'portrait'  // NOVO — default 'landscape'
}
```

Na geração do CSS, injetar:
```css
@page {
  size: A4 ${options.pageOrientation ?? 'landscape'};
  margin: 10mm;
}
```

O Mode A (setor) usa `landscape`. O Mode B (funcionário) usa `portrait`.

### 14.5 IPC handler `export.imprimirPDF` — ajuste de tamanho

O handler `exportImprimirPDF` atual usa `pageSize: 'A4'` fixo e `landscape: undefined` (default portrait). Precisa:

```typescript
// ANTES
const pdfBuffer = await win.webContents.printToPDF({
  pageSize: 'A4',
  printBackground: true,
  margins: { top: 0.4, bottom: 0.4, left: 0.4, right: 0.4 },
})

// DEPOIS — aceitar landscape como param
const exportImprimirPDF = t.procedure
  .input<{ html: string; filename?: string; landscape?: boolean }>()
  .action(async ({ input }) => {
    // ...
    const pdfBuffer = await win.webContents.printToPDF({
      pageSize: 'A4',
      landscape: input.landscape ?? true,  // default landscape pro setor
      printBackground: true,
      margins: { top: 0.4, bottom: 0.4, left: 0.4, right: 0.4 },
    })
    // ...
  })
```

O renderer passa `landscape: true` pro Mode A e `landscape: false` pro Mode B.

Atualizar o serviço renderer:
```typescript
export const exportarService = {
  // ...
  imprimirPDF: (html: string, filename?: string, landscape?: boolean) =>
    client['export.imprimirPDF']({ html, filename, landscape }),
}
```

### 14.6 Dados necessários por mode

#### Mode A (Setor) — dados já disponíveis

Todos os dados já existem na EscalaPagina e SetorDetalhe:

| Dado | Fonte | Já disponível? |
|------|-------|---------------|
| `escala` | `escalasService.obterCompleta(escalaId)` | ✅ Sim |
| `alocacoes` | `escalaCompleta.alocacoes` | ✅ Sim |
| `colaboradores` | `equipeEscala.colaboradores` | ✅ Sim |
| `setor` | `setoresService.obter(setorId)` | ✅ Sim |
| `violacoes` | `escalaCompleta.violacoes` | ✅ Sim |
| `avisos` (operacionais) | `previewAvisos` (useMemo em SetorDetalhe) | ⚠️ Precisa expor pro modal |
| `tiposContrato` | appDataStore | ✅ Sim |
| `funcoes` | `funcoesService.listar(setorId)` | ✅ Sim |
| `horariosSemana` | `horariosService.listar(setorId)` | ✅ Sim |
| `regrasPadrao` | `regrasService.listarPorSetor(setorId)` | ✅ Sim |

**Ação:** `previewAvisos` (avisos operacionais) hoje é computado dentro do SetorDetalhe como `useMemo`. Precisa ser passado como prop pro ExportModal, ou computado dentro do ExportarEscala a partir dos mesmos dados (alocacoes, ciclo, demandas).

#### Mode B (Funcionário) — dados parcialmente disponíveis

ColaboradorDetalhe tem dados do colaborador mas NÃO tem a escala completa do setor.

| Dado | Fonte | Já disponível? |
|------|-------|---------------|
| `colaborador` | `colaboradoresService.obter(colabId)` | ✅ Sim |
| `setor` | Via `colab.setor_id` | ✅ Sim |
| `escala OFICIAL do setor` | Query: `escalas WHERE setor_id = ? AND status = 'OFICIAL' ORDER BY id DESC LIMIT 1` | ❌ Precisa buscar |
| `alocacoes do colaborador` | Filtrar: `escala.alocacoes.filter(a => a.colaborador_id === colabId)` | ❌ Precisa buscar escala primeiro |
| `violacoes do colaborador` | Filtrar: `escala.violacoes.filter(v => v.colaborador_id === colabId)` | ❌ Precisa buscar |
| `regras do colaborador` | `regrasService.obterPorColaborador(colabId)` | ✅ Sim (já carrega no detalhe) |
| `tipo contrato` | appDataStore | ✅ Sim |

**Ação necessária:**

Criar um helper ou hook que:
1. Dado um `colaborador_id` e `setor_id`, busca a escala OFICIAL mais recente
2. Retorna os dados filtrados pro colaborador
3. Pode ser um `useExportFuncionario(colabId, setorId)` hook, ou uma chamada IPC direta

```typescript
// Opção: usar escalasService existente
async function carregarDadosExportFuncionario(colabId: number, setorId: number) {
  // 1. Buscar escala oficial do setor
  const escalas = await escalasService.listarPorSetor(setorId)
  const oficial = escalas.find(e => e.status === 'OFICIAL')
  if (!oficial) return null

  // 2. Buscar detalhes completos
  const completa = await escalasService.obterCompleta(oficial.id)

  // 3. Filtrar pro colaborador
  return {
    escala: completa.escala,
    alocacoes: completa.alocacoes.filter(a => a.colaborador_id === colabId),
    violacoes: completa.violacoes.filter(v => v.colaborador_id === colabId),
    setor: await setoresService.obter(setorId),
    // ... etc
  }
}
```

#### Mode C (Em Massa) — dados parcialmente disponíveis

EscalasHub já tem a lista de setores e status. Mas pra gerar cada HTML, precisa carregar a escala completa de cada setor.

| Dado | Já disponível no EscalasHub? |
|------|---------------------------|
| Lista de setores + status | ✅ Sim |
| Escala completa por setor | ❌ Precisa carregar sob demanda |

**Ação:** Para cada setor selecionado, fazer `escalasService.obterCompleta(escalaId)` + buscar colaboradores, funcoes, regras. Pode ser pesado se muitos setores. Considerar:
- Progress bar no modal (já tem na interface: `progress` prop)
- Carregar sequencialmente (não paralelo) pra não sobrecarregar

### 14.7 Avisos operacionais — unificação com violações

**Problema:** avisos operacionais (`Aviso[]`) são gerados no renderer (SetorDetalhe via `useMemo`), enquanto violações (`Violacao[]`) vêm do banco (solver output). São tipos diferentes.

**Solução:** No componente `ExportarEscala` refatorado, aceitar AMBOS:

```typescript
interface ExportarEscalaProps {
  violacoes?: Violacao[]    // do solver (banco)
  avisos?: Aviso[]          // operacionais (AvisosSection)
}
```

Na renderização do bloco de avisos, unificar:
```typescript
const todosAvisos = [
  ...violacoesHard.map(v => ({ tipo: 'h' as const, texto: `${v.colaborador_nome} — ${v.mensagem || v.regra}` })),
  ...violacoesSoft.map(v => ({ tipo: 's' as const, texto: `${v.colaborador_nome} — ${v.mensagem || v.regra}` })),
  ...avisos.filter(a => a.nivel === 'error').map(a => ({ tipo: 'h' as const, texto: a.titulo + (a.descricao ? ': ' + a.descricao : '') })),
  ...avisos.filter(a => a.nivel === 'warning').map(a => ({ tipo: 's' as const, texto: a.titulo + (a.descricao ? ': ' + a.descricao : '') })),
  ...avisos.filter(a => a.nivel === 'info').map(a => ({ tipo: 'i' as const, texto: a.titulo + (a.descricao ? ': ' + a.descricao : '') })),
]
```

Nenhuma mudança no banco. A unificação é só na camada de apresentação.

### 14.8 gerarCSV — incluir avisos operacionais

O `gerarCSVViolacoes()` hoje só exporta `violacoes[]`. Precisa aceitar `avisos[]` também:

```typescript
// lib/gerarCSV.ts — AJUSTAR
export function gerarCSVViolacoes(
  escalas: EscalaCompletaV3[],
  setores: Setor[],
  avisos?: Aviso[],      // NOVO param opcional
): string {
  // ... violações existentes ...

  // Adicionar avisos operacionais ao final
  if (avisos && avisos.length > 0) {
    for (const a of avisos) {
      lines.push(row([
        '',                    // colaborador (avisos são do setor)
        setores[0]?.nome ?? '',
        a.id,                  // "regra" = código do aviso
        a.nivel,               // severidade
        '',                    // data
        a.titulo + (a.descricao ? ': ' + a.descricao : ''),
      ]))
    }
  }

  return lines.join('\n')
}
```

---

## 15. Limpeza de Código Morto

### 15.1 Arquivos a REMOVER

| Arquivo | Motivo | Seguro? |
|---------|--------|---------|
| `src/renderer/src/lib/gerarHTMLFuncionario.ts` | Substituído por ExportFolhaFuncionario. Batch de HTMLs interativos com JS não é mais usado. | ✅ Verificar que nenhum import sobra |

### 15.2 Código a REMOVER dentro de arquivos existentes

| Arquivo | O que remover | Motivo |
|---------|-------------|--------|
| `ExportModal.tsx` | `HubOptions` component inteiro | Substituído por Mode C (massa) |
| `ExportModal.tsx` | Props `context`, `formato`, `onFormatoChange`, `funcionarioId`, `onFuncionarioChange`, `setoresExport`, `onSetoresExportChange` | Substituídos por `mode` + props específicas |
| `EscalaPagina.tsx` | `gerarHTMLFuncionarioById()` function | Era pro batch de funcionários |
| `EscalaPagina.tsx` | `handleExportFuncionariosBatch()` function | Batch antigo |
| `EscalaPagina.tsx` | Import de `gerarHTMLFuncionario` | Arquivo vai ser deletado |
| `EscalasHub.tsx` | `gerarHTMLFuncionario` import e uso | Arquivo vai ser deletado |
| `EscalasHub.tsx` | `HubOptions` import e props no ExportModal | Componente vai ser removido |
| `EscalasHub.tsx` | Formatos "batch", "batch-geral", "funcionario" no state | Não existem mais |

### 15.3 Verificação de imports órfãos

Após remover, rodar:
```bash
npx tsc --noEmit -p tsconfig.web.json   # deve dar 0 erros
grep -rn "gerarHTMLFuncionario" src/    # deve dar 0 resultados
grep -rn "HubOptions" src/              # deve dar 0 resultados
grep -rn "context.*hub" src/renderer/   # deve dar 0 resultados
```

---

## 16. Banco de Dados

### 16.1 Nenhuma mudança no schema

O export é 100% leitura. Nenhuma tabela nova, nenhuma coluna nova, nenhuma migration.

### 16.2 Queries necessárias (já existem)

| Query | Handler IPC | Usado por |
|-------|-------------|-----------|
| Escala OFICIAL do setor | `escalas.listar` + filter `status = 'OFICIAL'` | Mode B (func), Mode C (massa) |
| Escala completa (alocacoes + violacoes + etc) | `escalas.obterCompleta` | Todos os modes |
| Colaboradores do setor | `colaboradores.listar({ setor_id })` | Mode A, Mode C |
| Funções do setor | `funcoes.listar(setorId)` | Mode A |
| Regras por colaborador | `regras.listarPorSetor(setorId)` | Mode A, Mode B |
| Horários da semana do setor | `setorHorarios.listar(setorId)` | Mode A |

Nenhuma query nova. Tudo já está implementado nos serviços existentes.

---

## 17. Lógica de Negócio no Export

O export NÃO é só visual — ele PRECISA refletir as regras CLT/CCT, o solver, o ciclo e o estado real da escala. Cada campo exportado tem uma fonte de verdade.

### 17.1 Fontes de verdade por dado exportado

| Dado no export | Fonte de verdade | NÃO usar |
|---------------|-----------------|----------|
| Hora início/fim de trabalho | `alocacoes.hora_inicio`, `alocacoes.hora_fim` (output do solver) | ❌ Perfil de horário do contrato (é só preferência, solver pode ignorar) |
| Hora almoço | `alocacoes.hora_almoco_inicio`, `alocacoes.hora_almoco_fim` (solver) | ❌ Horário fixo hardcoded |
| Minutos trabalhados | `alocacoes.minutos_trabalho` (solver, já descontou almoço/intervalo) | ❌ Cálculo manual hora_fim - hora_inicio |
| Status do dia (TRABALHO/FOLGA/INDISPONIVEL) | `alocacoes.status` | ❌ Deduzir do ciclo (ciclo é padrão, solver é resultado real) |
| Folga fixa (dia) | `regra_horario_colaborador.folga_fixa_dia_semana` | ❌ Alocação (alocação diz FOLGA, regra diz QUAL tipo de folga) |
| Folga variável (dia) | `regra_horario_colaborador.folga_variavel_dia_semana` | ❌ Ciclo (ciclo mostra padrão, regra é config real) |
| Domingo trabalhado vs folga | `alocacoes.status` onde `data.getDay() === 0` | ❌ Ciclo (solver pode divergir do ciclo previsto) |
| Tipo de folga (FF/FV/DF) no export | Cruzar: `status=FOLGA` + dia_semana + regra do colaborador | ❌ Só "F" genérico |
| Violações | `escala.violacoes[]` — output do validador pós-solver | ❌ Recalcular no frontend |
| Cobertura (pessoas por faixa) | Contar `alocacoes` com `status=TRABALHO` por slot de tempo | ❌ `comparacao_demanda` (que é planejado vs demanda, não cobertura real pra export) |
| Pontuação da escala | `escala.pontuacao` (calculada pelo solver/validador) | ❌ Recalcular |
| Horas semanais contrato | `tipos_contrato.horas_semanais` (ou `colaborador.horas_semanais`) | ❌ Somar alocações (isso é o real, contrato é a meta) |

### 17.2 Regras CLT que afetam o export visual

O export deve MOSTRAR (não enforçar) o resultado das regras. O solver já aplicou. Mas o visual precisa refletir:

| Regra CLT | Como aparece no export |
|-----------|----------------------|
| **H1: Max 6 dias consecutivos** | Se violada: aviso HARD no bloco de avisos |
| **H3: Domingo max consecutivos** (mulher=1, homem=2) | Domingos trabalhados marcados como DT. Se violou: aviso HARD. Na folha do funcionário, coluna Obs mostra "Dom trabalhado" |
| **H10: Horas semanais** | Total por semana na Escala Semanal e Folha Funcionário. Comparado com meta do contrato: `36h40 / 44h` |
| **Folga fixa (FF)** | Marcada no CicloGrid + Escala Semanal + Folha Funcionário. Badge "FF" na coluna Obs |
| **Folga variável (FV)** | Condicional ao domingo trabalhado. Se trabalhou dom, FV ativa na mesma semana. Badge "FV" + nota "(dom trab.)" |
| **XOR mesma semana** | FV aplica offset negativo na mesma semana. Se dom=DT, FV aparece em SEG-SAB da mesma semana |
| **Estagiário** | Pode domingo. Sem almoço obrigatório se < 6h. Total semanal = 20h |
| **Intermitente** | Excluído do ciclo. Mas aparece nas alocações se o solver alocou |
| **Intervalo 15min (Art 71 CLT)** | Não aparece como linha no export. Já está descontado em `minutos_trabalho` |
| **Feriado proibido_trabalhar** | Se caiu no período: dia aparece como FOLGA com obs "Feriado" |

### 17.3 Ciclo no export

O CicloGrid no export mostra o PADRÃO TEÓRICO do ciclo (output de `simula-ciclo.ts` ou `escalaParaCicloGrid()`), NÃO as alocações reais dia a dia. É um mapa de como o ciclo DEVERIA ser.

**Diferença crucial:**
- **CicloGrid** = padrão: "Mateus trabalha DOM, folga SEG (FF), trabalha TER, folga QUA (FV)..."
- **Escala Semanal** = realidade: "Mateus 08:00-15:20 no DOM 01/03, folga SEG 02/03..."
- **Timeline Barras** = realidade visual: barra de 08:00 a 15:20 com gap de almoço

O CicloGrid pode DIVERGIR da escala real (exceções de data, ajustes manuais, feriados). Por isso as 3 views existem — ciclo é o plano, semanal/timeline é a execução.

### 17.4 Avisos no export — regras de geração

Os avisos unificados vêm de 2 fontes:

**Fonte 1: Violações do solver/validador** (já existem no banco)
```
escala.violacoes[] → cada uma tem: regra, severidade, colaborador_id, data, mensagem
```
Exemplos: H1 (6 dias consec), H3 (dom consec mulher), S3 (dom consec), S5 (turno ignorado)

**Fonte 2: Avisos operacionais** (gerados no renderer, AvisosSection)
```
buildAvisosFromPreview() → cada um tem: id, nivel, titulo, descricao, contexto_ia
```
Exemplos: COB_DEFICIT (cobertura < demanda), TT_CONSECUTIVO (muitos dom seguidos no ciclo), sem_titular (posto sem ninguém)

**Regra de merge para export:**
1. Violações solver → mapear severidade: HARD→error, SOFT→warning
2. Avisos operacionais → já têm nivel (error/warning/info)
3. Ordenar: error primeiro, depois warning, depois info
4. Deduplicar por mensagem (pode haver overlap entre violação e aviso)
5. Na folha do funcionário: filtrar apenas os que mencionam aquele `colaborador_id` ou `colaborador_nome`

### 17.5 O que NÃO entra no export

| Item | Motivo |
|------|--------|
| Gráfico CoberturaChart (recharts) | Canvas/SVG não imprime bem. CSV dos dados basta. |
| Decisões do solver (campo `decisoes` do JSON) | Texto livre do solver, muito longo, não formatável |
| Comparação demanda slot-a-slot | 4000+ slots, ilegível. CSV exporta separado |
| Sugestões de folga (SugestaoSheet) | São ações, não dados de export |
| Status dirty/unsaved | Estado da UI, não dado persistido |
| Configurações do motor (regras custom, rule-policy) | Meta-dado, não resultado |

---

## 18. Componentes — Inventário Completo com Modes

### 18.1 Mapa de componentes: existentes, novos e refatorados

```
src/renderer/src/componentes/
├── CicloGrid.tsx                    ← REFATORAR (adicionar mode 'export' com paginação)
├── ExportarEscala.tsx               ← REFATORAR (componente unificado, aceita props de seções)
├── ExportModal.tsx                  ← REFATORAR (3 modes: setor, funcionario, massa)
├── ExportPreview.tsx                ← MANTER (wrapper com zoom + forced light)
├── ExportTimelineBarras.tsx         ← NOVO (Gantt estático pra export/print)
├── ExportFolhaFuncionario.tsx       ← NOVO (Folha A4 portrait pra funcionário)
├── ExportAvisos.tsx                 ← NOVO (bloco unificado violações + avisos)
├── EscalaTimelineDiaria.tsx         ← MANTER (grid 15min — usado como sub-mode "grid")
├── AvisosSection.tsx                ← MANTER (avisos no app, não no export)
├── TimelineGrid.tsx                 ← MANTER (barras interativas no app)
├── EscalaGrid.tsx                   ← MANTER (grid semanal interativo no app)
├── SugestaoSheet.tsx                ← MANTER (não exporta)
├── ResumoFolgas.tsx                 ← MANTER (não exporta)
└── CoberturaChart.tsx               ← MANTER (não exporta)
```

### 18.2 CicloGrid — modes detalhados

O `CicloGrid.tsx` ganha um prop `variant` que controla o comportamento:

```typescript
interface CicloGridProps {
  data: CicloGridData
  mode: 'edit' | 'view'
  variant?: 'app' | 'export'         // NOVO — default 'app'
  onFolgaChange?: (...)  => void
  coverageActions?: CicloGridCoverageActions
  className?: string
}
```

| Variant | Comportamento |
|---------|--------------|
| `app` (default) | Como é hoje. Scroll horizontal. Sticky columns. Font 14px. Selects de folga editáveis. Botões de ação na cobertura. |
| `export` | Paginado (max 4 sem/bloco). `table-layout: fixed`. Font 9-10px. Sem scroll. Sem selects (tudo texto). Sem sticky (não precisa, cabe na largura). Sem botões de ação. Otimizado pra print. |

**Lógica de paginação (só variant='export'):**
```typescript
const MAX_WEEKS_PER_BLOCK = 4

if (variant === 'export' && totalSemanas > MAX_WEEKS_PER_BLOCK) {
  // Dividir em blocos
  const blocks: { start: number; end: number }[] = []
  for (let i = 0; i < totalSemanas; i += MAX_WEEKS_PER_BLOCK) {
    blocks.push({ start: i, end: Math.min(i + MAX_WEEKS_PER_BLOCK, totalSemanas) })
  }
  // Renderizar cada bloco como tabela separada, repetindo header
  return blocks.map(block => renderBlock(block.start, block.end))
} else {
  // Tabela única (variant='app' ou ciclo <= 4 semanas)
  return renderBlock(0, totalSemanas)
}
```

### 18.3 ExportTimelineBarras — componente NOVO

Componente estático (sem interação) que renderiza barras Gantt pra print/export.

```typescript
interface ExportTimelineBarrasProps {
  alocacoes: Alocacao[]
  colaboradores: Colaborador[]
  setor: Setor
  funcoes?: Funcao[]
  datas: string[]               // lista de datas a renderizar (filtrada pelo período)
  regrasMap?: Map<number, RegraHorarioColaborador>
  horariosSemana?: SetorHorarioSemana[]
}
```

**Diferença do TimelineGrid.tsx (app):**
| Aspecto | TimelineGrid (app) | ExportTimelineBarras (export) |
|---------|-------------------|------------------------------|
| Interação | Hover, click, tooltips, popover de edição | Nenhuma — estático |
| Navegação | ◂/▸ por dia | Todos os dias empilhados |
| Scroll | Horizontal (CSS grid com slots) | Nenhum — cabe na largura |
| Cobertura | Contagem dinâmica | Barra de intensidade estática |
| Barras | `bg-primary/80` (CSS) | `bg-primary/80` (CSS — mesma cor) |
| Dimensão | Altura fixa por row (52px) | Altura compacta (26px) |
| Eixo horas | Slots 15min no grid | Marcadores proporcionais (07:00, 09:00, 11:00...) |

**Renderização por dia:**
```
Para cada data no array `datas`:
  1. Section title: "{diaSemana} {dd/mm/yyyy}"
  2. Eixo de horas (marcadores proporcionais: hora_abertura → hora_fechamento do setor)
  3. Para cada colaborador:
     a. Buscar alocação do dia
     b. Se TRABALHO: renderizar barra(s) + almoço hachurado + total à direita
     c. Se FOLGA: texto italic com tipo (FF/FV/DF) derivado da regra
     d. Se INDISPONÍVEL: barra hachurada vermelha
  4. Separador
  5. Barra de cobertura (contagem de TRABALHO por faixa horária)
```

### 18.4 ExportFolhaFuncionario — componente NOVO

Renderiza a folha individual pra entregar ao funcionário.

```typescript
interface ExportFolhaFuncionarioProps {
  colaborador: Colaborador
  setor: Setor
  escala: Escala
  alocacoes: Alocacao[]           // JÁ FILTRADAS pro colaborador
  violacoes?: Violacao[]          // JÁ FILTRADAS pro colaborador
  avisos?: Aviso[]                // JÁ FILTRADOS pro colaborador
  tipoContrato: TipoContrato
  regra?: RegraHorarioColaborador
  mostrarAvisos?: boolean
}
```

**Lógica de tipo de folga por dia:**
```typescript
function tipoFolga(data: string, colab: Colaborador, regra: RegraHorarioColaborador | undefined): string {
  const dow = new Date(data + 'T00:00:00').getDay()
  const dayLabel = DAY_NAMES_SHORT[dow]  // 'DOM','SEG',...

  // Feriado?
  // (checar tabela feriados se necessário — por enquanto, não entra)

  // Folga fixa?
  if (regra?.folga_fixa_dia_semana === dayLabel) return 'FF'

  // Folga variável? (ativa quando trabalhou domingo NA MESMA SEMANA)
  if (regra?.folga_variavel_dia_semana === dayLabel) {
    // Checar se trabalhou domingo nesta semana (mesma lógica de XOR same-week)
    const domData = encontrarDomingoDaSemana(data)
    const domAloc = alocacoes.find(a => a.data === domData)
    if (domAloc?.status === 'TRABALHO') return 'FV'
    return 'F'  // variável não ativou (não trabalhou domingo)
  }

  // Domingo folga (ciclo)?
  if (dow === 0) return 'DF'

  return 'F'  // folga genérica
}
```

**Cálculo do total semanal:**
```typescript
// Agrupar alocações por semana ISO
const semanas = agruparPorSemanaISO(alocacoes)
// Para cada semana: somar minutos_trabalho das alocações com status=TRABALHO
// Exibir: "36h40 / 44h" (real / contrato)
```

### 18.5 ExportModal — modes detalhados

```typescript
interface ExportModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void

  // Mode determina TUDO: layout, preview, opções, botões
  mode: 'setor' | 'funcionario' | 'massa'

  // ═══ Mode 'setor' ═══
  // Dados da escala (obrigatórios quando mode='setor')
  escalaData?: {
    escala: Escala
    alocacoes: Alocacao[]
    colaboradores: Colaborador[]
    setor: Setor
    violacoes: Violacao[]
    avisos: Aviso[]
    tiposContrato: TipoContrato[]
    funcoes: Funcao[]
    horariosSemana: SetorHorarioSemana[]
    regrasPadrao: RegraHorarioColaborador[]
  }

  // ═══ Mode 'funcionario' ═══
  // Dados do colaborador (obrigatórios quando mode='funcionario')
  funcionarioData?: {
    colaborador: Colaborador
    setor: Setor
    escala: Escala
    alocacoes: Alocacao[]       // já filtradas
    violacoes: Violacao[]       // já filtradas
    tipoContrato: TipoContrato
    regra?: RegraHorarioColaborador
  }

  // ═══ Mode 'massa' ═══
  // Lista de setores (obrigatórios quando mode='massa')
  massaData?: {
    setores: { id: number; nome: string; status: 'OFICIAL' | 'RASCUNHO' | null }[]
  }

  // Callbacks
  onExportHTML?: (html: string, filename: string) => void
  onPrint?: (html: string, landscape: boolean) => void
  onCSV?: (csv: string, filename: string) => void
  onExportMassa?: (setorIds: number[], incluirAvisos: boolean) => void
}
```

**Estado interno do modal por mode:**

```typescript
// Mode 'setor'
const [toggles, setToggles] = useState({
  ciclo: true,
  semanal: true,
  timeline: true,
  avisos: true,
})
const [timelineMode, setTimelineMode] = useState<'barras' | 'grid'>('barras')

// Mode 'funcionario'
const [mostrarAvisos, setMostrarAvisos] = useState(true)

// Mode 'massa'
const [selectedSetores, setSelectedSetores] = useState<Set<number>>(new Set())
const [incluirAvisos, setIncluirAvisos] = useState(true)
```

---

## 19. Views no App — Opções e Toggles

### 19.1 Onde ficam os toggles no app (fora do export)

Na página de escala (EscalaPagina / SetorDetalhe), o header da seção de escala terá toggles pra controlar quais views aparecem:

```
┌─────────────────────────────────────────────────────────────────────┐
│  Escala — Açougue                                                  │
│                                                                     │
│  [✓ Ciclo]  [✓ Semanal]  [✓ Timeline Diária  ⊞│≡]    [Exportar]   │
│                                                                     │
│  ─── Ciclo Rotativo ─────────────────────────────────────────────  │
│  (CicloGrid component)                                             │
│                                                                     │
│  ─── S10 — 01/03 a 07/03 ───────────────────────────────────────  │
│  (Escala Semanal component — EscalaGrid existente)                  │
│                                                                     │
│  ─── Timeline Diária ────────────────────────────────────────────  │
│  (TimelineGrid barras ou EscalaTimelineDiaria grid)                 │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 19.2 Comportamento dos toggles no app

| Toggle | ON | OFF |
|--------|-----|------|
| Ciclo | CicloGrid visível | CicloGrid oculto. Toggle dos outros mantém. |
| Semanal | EscalaGrid (tabela semanal) visível | Oculto |
| Timeline | TimelineGrid (barras) ou EscalaTimelineDiaria (grid) visível | Oculto |

**Sub-toggle da Timeline:** `⊞` (grid) e `≡` (barras). Dois ícones lado a lado (como o ViewToggle que já existe no app). Muda entre:
- `≡` Barras = TimelineGrid.tsx existente (barras interativas com drag, popover, etc)
- `⊞` Grid = EscalaTimelineDiaria.tsx existente (tabela slot 15min)

### 19.3 Persistência dos toggles

```typescript
// Zustand store ou localStorage
interface EscalaViewPrefs {
  showCiclo: boolean        // default true
  showSemanal: boolean      // default true
  showTimeline: boolean     // default true
  timelineView: 'barras' | 'grid'  // default 'barras'
}

// Persistir por setor? Ou global?
// → GLOBAL (mesmo pra todos os setores). Key: 'escala-view-prefs'
```

### 19.4 Sincronização app ↔ modal de export

Quando o usuário abre o modal de export, os toggles do modal INICIALIZAM com os mesmos valores dos toggles do app. Mas são independentes depois — mudar no modal não muda no app.

```typescript
// Ao abrir o modal:
const [toggles, setToggles] = useState({
  ciclo: viewPrefs.showCiclo,
  semanal: viewPrefs.showSemanal,
  timeline: viewPrefs.showTimeline,
  avisos: true,  // avisos sempre ON por default no export
})
const [timelineMode, setTimelineMode] = useState(viewPrefs.timelineView)
```

### 19.5 Navegação semanal no app

A Escala Semanal no app (EscalaGrid existente) já tem navegação por semana com ◂/▸. Ajustar:
- Label: `S{isoWeek}` ao invés de "Semana 1"
- Mostrar: `S10 — 01/03 a 07/03/2026`

A Timeline Diária no app (TimelineGrid existente) já tem navegação por dia com ◂/▸. Manter.

### 19.6 Relação componentes app vs componentes export

| No app (interativo) | No export (estático) | Mesma lógica? |
|---------------------|---------------------|---------------|
| `CicloGrid.tsx` mode='edit' | `CicloGrid.tsx` variant='export' | ✅ Mesmo componente, variant diferente |
| `EscalaGrid.tsx` (tabela semanal) | Seção Semanal em `ExportarEscala.tsx` | ⚠️ Mesmo dado, render diferente (export simplificado sem interação) |
| `TimelineGrid.tsx` (barras interativas) | `ExportTimelineBarras.tsx` (barras estáticas) | ❌ Componentes diferentes (interação vs print) |
| `EscalaTimelineDiaria.tsx` (grid 15min) | `EscalaTimelineDiaria.tsx` (mesmo!) | ✅ Mesmo componente (já é estático, sem interação) |
| `AvisosSection.tsx` (avisos com botões) | `ExportAvisos.tsx` (avisos sem botões) | ❌ Componentes diferentes (ações vs print) |

---

## 20. Protótipo Visual

O protótipo HTML interativo com TODOS os componentes renderizados está em:

```
.superpowers/brainstorm/96051-1773612355/export-inlined.html
```

Abrir no browser para referência visual durante implementação. Contém:
- A4 Export Setor (Tudo, Só Ciclo, Só Semanal, Só Timeline)
- A4 Folha Funcionário (Mateus, Pedro, Jessica)
- Modal Setor, Modal Funcionário, Modal Em Massa
