# PRD: Front + Blockers UX (Dark Mode, Violacoes Humanizadas, ContratoLista CRUD, Error Messages)

> **Workflow:** feature
> **Budget sugerido:** medium
> **Criado em:** 2026-02-14T22:00:00Z
> **Fonte:** gather (ITERACAO.md ORCHESTRATE 2, items 6-10)
> **Depende de:** specs/005-motor-fundacao/ (COMPLETO — motor com 10 regras nomeadas, R4/R4b merge, pinnedCells)

---

## Visao Geral

O motor esta 100% funcional (orchestrate 005). Agora o frontend precisa:

1. **Dark mode 100%** — 8 instancias de cores hardcoded em 4 arquivos. Pattern ja existe em `cores.ts`.
2. **3 BLOCKERS UX** que impedem entrega aos pais do Marco:
   - SetorDetalhe mostra 3 botoes pro mesmo destino (confuso)
   - Violacoes mostram codigos tecnicos (`MAX_DIAS_CONSECUTIVOS`) em vez de portugues
   - ContratoLista e read-only (nao pode criar/editar templates de contrato)
3. **Error messages humanizadas** — mapError incompleto, precisa dos 10 nomes de regra do motor

**Contexto critico:** Os usuarios sao os PAIS do Marco (RH de supermercado). NAO sao tecnicos. Se verem "R1: MAX_DIAS_CONSECUTIVOS" vao ligar pro filho. Se nao conseguirem editar um template de contrato, vao pedir pro filho. O objetivo e ZERO dependencia tecnica.

---

## Requisitos Funcionais

### RF1: Dark Mode — Cores Hardcoded (F1.1-F1.4)

Corrigir 8 instancias de cores sem `dark:` variant em 4 arquivos. O pattern ja existe em `cores.ts` — so migrar.

- [ ] **RF1.1:** `PontuacaoBadge.tsx` (28 linhas) — 3 variantes (emerald/amber/red) sem dark
  - Linhas 5, 9, 12: adicionar `dark:bg-X-950/30 dark:text-X-300 dark:border-X-800`
  - Seguir pattern identico ao `CORES_STATUS_ESCALA` de `cores.ts`

- [ ] **RF1.2:** `EscalaPagina.tsx` — 3 instancias de icones hardcoded
  - Linha 718: `text-amber-500` → adicionar `dark:text-amber-400`
  - Linha 739: `text-red-600 dark:text-red-400` → ja tem dark (verificar consistencia)
  - Linha 741: `text-amber-600 dark:text-amber-400` → ja tem dark (verificar consistencia)
  - Linhas 636-671: 5 cards de indicadores — circulos (`bg-emerald-100`, `bg-red-100`, `bg-amber-100`) precisam de `dark:bg-X-950/30`, icones (`text-X-600`) precisam de `dark:text-X-400`

- [ ] **RF1.3:** `ColaboradorLista.tsx` — 2 instancias
  - Linhas 196-200: avatar genero `bg-pink-100 text-pink-700` / `bg-sky-100 text-sky-700` → usar `CORES_GENERO[colab.sexo]` de `cores.ts` (ja existe com dark)
  - Linhas 226-229: badge preferencia `border-amber-200 bg-amber-50 text-amber-700` → adicionar dark variants

- [ ] **RF1.4:** `ColaboradorDetalhe.tsx` — 1 instancia
  - Linhas 66-70: `ExcecaoIcon` retorna `text-emerald-600` / `text-amber-600` / `text-red-600` → usar `CORES_EXCECAO[tipo]` de `cores.ts` (ja existe com dark)

- [ ] **RF1.5:** `Dashboard.tsx` — 1 instancia
  - Linha 104: badge alertas `border-amber-200 bg-amber-50 text-amber-700` → adicionar dark variants ou usar constante de `cores.ts`

### RF2: Deletar Dead Code (F1.5)

- [ ] **RF2.1:** Deletar `src/renderer/src/componentes/ThemeSwitcher.tsx` (51 linhas, nunca importado)
- [ ] **RF2.2:** Grep pra confirmar ZERO referencias restantes

### RF3: SetorDetalhe — Unificar Botoes (F6.1 — BLOCKER)

- [ ] **RF3.1:** Se TEM escala ativa (RASCUNHO ou OFICIAL): mostrar 1 botao "Abrir Escala" (`variant="default"`)
- [ ] **RF3.2:** Se NAO tem escala: mostrar 1 botao "Gerar Escala" (`variant="default"`)
- [ ] **RF3.3:** NUNCA 2+ botoes que levam pro mesmo destino
- [ ] **RF3.4:** Botao fica na posicao existente (card "Escala Atual" do SetorDetalhe)
- Arquivo: `SetorDetalhe.tsx:537-551` — remover redundancia, substituir por condicional unico

### RF4: Violacoes Humanizadas (F6.2 — BLOCKER)

**Contexto do 005:** Motor agora emite 10 nomes de regra exatos (nao "R1", "R2"). R4/R4b foram mergeados — uma violacao, uma mensagem, o limite mais restritivo.

- [ ] **RF4.1:** Criar mapa de regras → texto humano (em `formatadores.ts` ou `constants`):

  | Regra (backend) | Texto Humano (frontend) | Severidade |
  |-----------------|------------------------|------------|
  | `MAX_DIAS_CONSECUTIVOS` | "Trabalhou mais de 6 dias seguidos sem folga" | HARD |
  | `DESCANSO_ENTRE_JORNADAS` | "Intervalo entre jornadas menor que 11 horas" | HARD |
  | `RODIZIO_DOMINGO` | "Rodizio de domingo nao respeitado" | HARD |
  | `ESTAGIARIO_DOMINGO` | "Estagiario nao pode trabalhar no domingo" | HARD |
  | `CONTRATO_MAX_DIA` | "Jornada diaria excede o limite do contrato" | HARD |
  | `MAX_JORNADA_DIARIA` | "Jornada diaria excede o limite de 10 horas (CLT)" | HARD |
  | `META_SEMANAL` | "Horas semanais fora da meta do contrato" | SOFT |
  | `PREFERENCIA_DIA` | "Escalado no dia que pediu pra evitar" | SOFT |
  | `PREFERENCIA_TURNO` | "Escalado em turno diferente do preferido" | SOFT |
  | `COBERTURA` | "Faixa horaria com menos pessoas que o necessario" | SOFT |

- [ ] **RF4.2:** Agrupar violacoes por COLABORADOR (nao por regra):
  - Card HARD: avatar (iniciais) + nome + lista de problemas por dia
  - Card SOFT: avatar + nome + alertas (separado do HARD, visual mais leve)
  - Logica: "Quem ta com problema?" > "Qual lei violou?"
  - Usar `CORES_VIOLACAO.HARD` e `CORES_VIOLACAO.SOFT` de `cores.ts` (ja existem)
  - Componente atual em `EscalaPagina.tsx:710-756` — substituir lista flat por cards agrupados

- [ ] **RF4.3:** Dica de acao visivel:
  - HARD: "Clique em um dia de trabalho desse colaborador para trocar por folga"
  - SOFT: nenhuma dica (nao bloqueia oficializacao)

- [ ] **RF4.4:** Celulas que violam regra HARD recebem borda vermelha na grid:
  - Classe: `ring-2 ring-destructive` na celula
  - Precisa de mapa `violacoes[] → Set<"colaboradorId-data">` pra saber quais celulas marcar
  - Borda vermelha so em violacoes HARD (SOFT nao marca celula)

- [ ] **RF4.5:** Dark mode compativel (usar CSS variables do shadcn: `destructive`, `warning`)

### RF5: ContratoLista CRUD Completo (F6.3 — BLOCKER)

**Contexto do 005:** `max_minutos_dia` agora e USADO ATIVAMENTE pelo motor (R4 merge). Editar este campo afeta TODAS as escalas futuras daquele tipo de contrato. O disclaimer CLT e CRITICO.

- [ ] **RF5.1:** Card por template com resumo visual:
  - Nome em destaque
  - 4 metricas: `horas_semanais` (ex: "44h/sem"), `dias_trabalho` (ex: "6 dias"), `max_minutos_dia` formatado (ex: "max 9h30/dia"), `trabalha_domingo` (badge sim/nao)
  - Manter layout existente de cards (2 colunas) mas adicionar acoes

- [ ] **RF5.2:** Botao "Editar" em cada card → abre Dialog com 5 campos:
  - `nome` (text input, required)
  - `horas_semanais` (number, min 1, max 44)
  - `dias_trabalho` (number, min 1, max 6)
  - `max_minutos_dia` (number, min 60, max 600) — com helper: "9h30 = 570 minutos"
  - `trabalha_domingo` (switch/checkbox)

- [ ] **RF5.3:** Disclaimer CLT no dialog de edicao (OBRIGATORIO):
  - Texto: "Regras como max 6 dias consecutivos e 11h de descanso entre jornadas sao leis trabalhistas (CLT) e nao podem ser alteradas. Os campos abaixo configuram limites do CONTRATO, que podem ser mais restritivos que a lei."
  - Visual: Alert component do shadcn com icone de info, acima dos campos
  - Sempre visivel (nao colapsavel)

- [ ] **RF5.4:** Botao "Novo Tipo de Contrato" no header da pagina → mesmo dialog, campos vazios

- [ ] **RF5.5:** Botao "Excluir" com confirmacao:
  - Se template NAO tem colabs vinculados → AlertDialog → confirma → deleta
  - Se template TEM colabs vinculados → erro humanizado: "Este tipo de contrato tem N colaboradores vinculados. Remova os vinculos antes de excluir."
  - IPC `tiposContrato.deletar` ja tem safety check (confirmado pela auditoria)

- [ ] **RF5.6:** Empty state: "Nenhum tipo de contrato cadastrado. Crie um template para comecar."
  - Substituir mensagem tecnica "Rode o seed" (UX-A2)

- [ ] **RF5.7:** Dark mode compativel

### RF6: Error Messages Humanizadas (F4.1)

- [ ] **RF6.1:** Expandir `mapError()` em `formatadores.ts` com os cenarios faltantes:
  - "Setor nao tem colaboradores ativos" → "Cadastre ao menos 1 colaborador ativo neste setor antes de gerar a escala."
  - "Setor nao tem faixas de demanda" → "Defina as faixas de demanda do setor antes de gerar."
  - "Escala tem N violacoes criticas" → "A escala tem N problemas que violam a legislacao trabalhista. Corrija antes de oficializar."
  - Timeout → "A geracao demorou mais que o esperado. Tente novamente com menos colaboradores ou um periodo menor."
  - Generico → "Erro inesperado. Tente novamente ou reinicie o aplicativo."

- [ ] **RF6.2:** `mapError()` reutilizavel — importavel de qualquer pagina (ja e, mas verificar cobertura de uso)

- [ ] **RF6.3:** O mapa de regra→texto de RF4.1 pode ser reutilizado pelo mapError pra mensagens de violacao

---

## Criterios de Aceitacao

### CA1: Dark Mode 100%
- [ ] Navegar por TODAS as 9 paginas em dark mode — ZERO elementos invisiveis ou ilegiveis
- [ ] PontuacaoBadge visivel em todas as 3 variantes (green/amber/red) em dark
- [ ] 5 cards de indicadores na EscalaPagina legiveis em dark
- [ ] Avatares de genero em ColaboradorLista legiveis em dark
- [ ] Badges de alerta em Dashboard legiveis em dark
- [ ] Icones de excecao em ColaboradorDetalhe legiveis em dark
- [ ] ThemeSwitcher.tsx deletado, grep retorna 0 resultados

### CA2: SetorDetalhe — 1 botao unico
- [ ] Setor COM escala ativa: mostra "Abrir Escala" e SO ele
- [ ] Setor SEM escala: mostra "Gerar Escala" e SO ele
- [ ] NUNCA 2+ botoes que levam pro mesmo destino

### CA3: Violacoes humanizadas
- [ ] Gerar escala com HARD violation (ex: pinar 7 TRABALHO consecutivos)
- [ ] Lista de violacoes mostra cards agrupados por COLABORADOR (nao lista flat de regras)
- [ ] Texto das violacoes em portugues simples (nao codigos tecnicos)
- [ ] Celulas violadas na grid tem borda vermelha (`ring-2 ring-destructive`)
- [ ] Dica de acao visivel: "Clique em um dia de trabalho para trocar por folga"
- [ ] Botao Oficializar continua disabled ate 0 HARD violations
- [ ] SOFT violations aparecem separadas (visual mais leve, sem borda na grid)
- [ ] Tudo funciona em dark mode

### CA4: ContratoLista CRUD
- [ ] Listar templates existentes (seed tem 4: CLT 44h, CLT 36h, Estagiario 20h, Menor Aprendiz 20h)
- [ ] Editar "CLT 44h" → mudar horas_semanais → salvar → lista atualiza
- [ ] Criar "PJ 30h" → preencher 5 campos → salvar → aparece na lista
- [ ] Excluir template sem colabs → confirma → some da lista
- [ ] Tentar excluir template COM colabs → erro humanizado (nao crash)
- [ ] Disclaimer CLT visivel em TODOS os dialogs de edicao/criacao
- [ ] Empty state sem texto tecnico ("seed")
- [ ] Dark mode compativel

### CA5: Error messages
- [ ] Gerar escala em setor sem colaboradores → mensagem humanizada (nao stack trace)
- [ ] Gerar escala em setor sem demandas → mensagem humanizada
- [ ] Timeout → mensagem humanizada
- [ ] Oficializar com HARD violations → mensagem humanizada
- [ ] NENHUM stack trace visivel pro usuario em nenhum cenario

### CA6: Build limpo
- [ ] `npx tsc --noEmit` retorna 0 erros
- [ ] `npm run build` completa sem erros
- [ ] App Electron abre sem console errors

---

## Constraints

- **C1:** snake_case ponta a ponta. Sem camelCase nos campos do IPC/DB.
- **C2:** CORES de `cores.ts` sao a unica fonte de verdade pra dark mode. Nao inventar cores novas inline.
- **C3:** IPC handlers de tiposContrato JA EXISTEM (listar, buscar, criar, atualizar, deletar). NAO criar novos handlers.
- **C4:** `CORES_VIOLACAO` de `cores.ts` JA EXISTE. Usar pra cards de violacao.
- **C5:** Motor emite regras com nomes exatos (string). Frontend so mapeia string→texto. Sem logica de negocio no front.
- **C6:** Regras CLT sao HARDCODED no motor (correto). Frontend mostra disclaimer mas NAO permite editar regras CLT.
- **C7:** Usar componentes shadcn existentes (Dialog, AlertDialog, Switch, Alert, Badge, Card). NAO instalar novos.
- **C8:** Seguir patterns existentes: `useApiData` pra fetch, `toast` (sonner) pra feedback, `PageHeader` pra headers.

---

## Fora do Escopo

- **NAO** mudar logica do motor (motor e read-only neste orchestrate)
- **NAO** adicionar validacao Zod (fica pro orchestrate 007)
- **NAO** mexer em UX do Dashboard (tabs, acoes rapidas — fica pro 007)
- **NAO** criar pagina de perfil (/perfil — fica pro 007)
- **NAO** padronizar Badge entre paginas (SHADCN-8 — fica pro 007)
- **NAO** criar componente EmptyState padronizado (SHADCN-11 — fica pro 007)
- **NAO** adicionar Skeleton loading states (SHADCN-7 — fica pro 007)
- **NAO** mudar estrutura da sidebar
- **NAO** adicionar react-hook-form ou Form pattern do shadcn (fica pro 007 com Zod)
- **NAO** implementar edicao de Demandas/Excecoes (FUNC-6 — backlog)

---

## Servicos Envolvidos

- [x] Frontend (principal — 90% do trabalho)
- [ ] Backend (ZERO mudancas — IPC handlers ja existem)
- [ ] Database (ZERO mudancas — schema ja suporta tudo)
- [x] Shared (possivel: adicionar mapa de regras em constants.ts ou types.ts)

---

## Mapa de Arquivos

| Arquivo | Linhas | O que mexer | RF |
|---------|--------|-------------|-----|
| `src/renderer/src/componentes/PontuacaoBadge.tsx` | 28 | Adicionar dark variants nas 3 cores | RF1.1 |
| `src/renderer/src/paginas/EscalaPagina.tsx` | ~814 | Dark indicadores + violacoes agrupadas + borda vermelha | RF1.2, RF4.2-RF4.5 |
| `src/renderer/src/paginas/ColaboradorLista.tsx` | ~280 | Avatar genero → CORES_GENERO, badge preferencia dark | RF1.3 |
| `src/renderer/src/paginas/ColaboradorDetalhe.tsx` | ~480 | ExcecaoIcon → CORES_EXCECAO | RF1.4 |
| `src/renderer/src/paginas/Dashboard.tsx` | ~180 | Badge alertas dark | RF1.5 |
| `src/renderer/src/componentes/ThemeSwitcher.tsx` | 51 | DELETAR | RF2.1 |
| `src/renderer/src/paginas/SetorDetalhe.tsx` | ~625 | 3 botoes → 1 condicional | RF3 |
| `src/renderer/src/paginas/ContratoLista.tsx` | 108 | CRUD completo (expandir pra ~300 linhas) | RF5 |
| `src/renderer/src/lib/formatadores.ts` | 72 | Expandir mapError + mapa regra→texto | RF4.1, RF6 |
| `src/renderer/src/lib/cores.ts` | 47 | REFERENCIA (nao editar, so usar) | — |
| `src/shared/types.ts` | ref | Possivel: tipo `RegraViolacao` com os 10 nomes | RF4.1 |

---

## Ordem de Execucao Sugerida

A ordem importa pra evitar conflitos e maximizar reuso:

### Fase 1: Infraestrutura de Texto (RF4.1, RF6)
1. Criar mapa de regras → texto humano (10 entradas)
2. Expandir `mapError()` com cenarios faltantes
3. Exportar mapa como constante reutilizavel

> Justificativa: RF4.2 (violacoes agrupadas) e RF5.3 (disclaimer) dependem dos textos.

### Fase 2: Dark Mode (RF1, RF2)
4. PontuacaoBadge dark variants
5. EscalaPagina indicadores dark
6. ColaboradorLista → CORES_GENERO + badge dark
7. ColaboradorDetalhe → CORES_EXCECAO
8. Dashboard badge dark
9. Deletar ThemeSwitcher.tsx

> Justificativa: Dark mode e rapido (pattern ja existe) e desbloqueia CA1.

### Fase 3: Blockers UX (RF3, RF4, RF5)
10. SetorDetalhe: 3 botoes → 1 condicional
11. EscalaPagina: violacoes agrupadas por colaborador + borda vermelha
12. ContratoLista: CRUD completo (dialog criar/editar/excluir)

> Justificativa: Blockers sao o core deste orchestrate. F6.2 (violacoes) e o mais complexo.

### Fase 4: Verificacao
13. Typecheck (`npx tsc --noEmit`)
14. Build (`npm run build`)
15. Varredura dark mode (grep por cores sem `dark:`)

---

## Dados de Referencia (pro coder)

### Constantes ja existentes em cores.ts

```typescript
// CORES_VIOLACAO (usar pra cards de violacao)
HARD: { bg, text, border, icon }  // vermelho
SOFT: { bg, text, border, icon }  // amarelo

// CORES_GENERO (usar pra avatares)
F: 'bg-pink-100 dark:bg-pink-950/30 text-pink-700 dark:text-pink-300'
M: 'bg-sky-100 dark:bg-sky-950/30 text-sky-700 dark:text-sky-300'

// CORES_EXCECAO (usar pra icones)
FERIAS: '...'
ATESTADO: '...'
BLOQUEIO: '...'
```

### IPC Handlers ja existentes (NAO criar novos)

```typescript
'tiposContrato.listar'    // → TipoContrato[]
'tiposContrato.buscar'    // (id) → TipoContrato
'tiposContrato.criar'     // (data) → TipoContrato
'tiposContrato.atualizar' // (id, data) → TipoContrato
'tiposContrato.deletar'   // (id) → void (safety check: colabs vinculados)
```

### Servico frontend ja existente

```typescript
// src/renderer/src/servicos/tiposContrato.ts
tiposContratoService.listar()
tiposContratoService.buscar(id)
tiposContratoService.criar(data)
tiposContratoService.atualizar(id, data)
tiposContratoService.deletar(id)
```

### Nomes de regra do motor (pos-005)

```
HARD: MAX_DIAS_CONSECUTIVOS, DESCANSO_ENTRE_JORNADAS, RODIZIO_DOMINGO,
      ESTAGIARIO_DOMINGO, CONTRATO_MAX_DIA, MAX_JORNADA_DIARIA
SOFT: META_SEMANAL, PREFERENCIA_DIA, PREFERENCIA_TURNO, COBERTURA
```

### Violacao (interface do shared/types.ts)

```typescript
interface Violacao {
  severidade: 'HARD' | 'SOFT'
  regra: string           // ex: 'MAX_DIAS_CONSECUTIVOS'
  colaborador_id: number
  colaborador_nome: string
  mensagem: string        // mensagem tecnica do motor
  data?: string           // dia especifico (ISO)
}
```

---

## Budget Sugerido

Baseado na complexidade da task, o budget recomendado para `/orchestrate`:

- **low** → Tasks simples, poucas files, logica direta. Coder usa haiku.
- **medium** → Features medias, multiplas files. Coder usa sonnet, critic usa opus.
- **high** → Tasks complexas, muitas dependencias, risco alto. Tudo opus.

**Recomendacao:** **medium** — 10 arquivos, mas logica direta (dark mode = copiar pattern, CRUD = copiar pattern existente, violacoes = mapa de strings + agrupamento). Nenhuma logica de negocio complexa. O risco maior e em F6.2 (violacoes agrupadas) que precisa de mais cuidado visual, mas o sonnet da conta com as specs detalhadas acima.

---

## Notas Adicionais

### Decisoes de design ja tomadas (orchestrate 005)

1. **R4/R4b merge:** Backend emite UMA violacao por celula. Frontend so mapeia nomes. Sem duplicacao.
2. **Agrupar por COLABORADOR:** Cards por pessoa, nao por regra. "Quem ta com problema?" > "Qual lei violou?"
3. **max_minutos_dia ativo:** Editar no ContratoLista afeta escalas futuras. Disclaimer obrigatorio.

### O que NAO quebrar

- Grid interativa (F2) — JA IMPLEMENTADA, nao mexer no handler de click
- Smart Recalc — JA FUNCIONA via pinnedCells
- OnboardingTour — JA IMPLEMENTADO
- ExportarEscala — JA FUNCIONA (HTML self-contained)
- Oficializar — JA FUNCIONA (valida HARD, arquiva anterior)
- Motor — ZERO mudancas (motor e read-only neste orchestrate)

### Riscos

- **MEDIO:** F6.2 (violacoes agrupadas) e a mudanca visual mais significativa. Se o agrupamento ficar confuso, a mae do Marco nao vai entender. Manter SIMPLES: card com nome + lista. Sem overengineering.
- **BAIXO:** ContratoLista CRUD pode ter edge case no delete (colabs vinculados). IPC ja trata isso, mas o frontend precisa exibir o erro corretamente.
- **BAIXO:** Varredura dark mode pode revelar cores hardcoded que nao foram mapeadas aqui. Grep final obrigatorio.
