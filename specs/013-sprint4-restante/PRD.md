# PRD: Sprint 4 Restante — Sidebar + Dirty State + ColaboradorDetalhe

> **Workflow:** refactor
> **Budget sugerido:** high
> **Criado em:** 2026-02-26T12:00:00-03:00
> **Fonte:** gather (interativo via /taskgen)

---

## Visao Geral

Sprint 4 tem 5 fases. As Fases 1 e 2 ja foram implementadas (EscalaPagina reescrita como visualizador puro, SetorDetalhe como hub de geracao, export via dropdown direto sem ExportModal).

Este PRD cobre as **3 fases restantes** (3, 4 e 5) que simplificam a sidebar, protegem forms com dirty state, e reorganizam ColaboradorDetalhe em tabs.

**Contexto:** Os pais do Marco (leigos) sao os usuarios. Se parecer planilha ou tiver botao perigoso visivel, FALHOU.

**Referencia tecnica completa:** `docs/refatoracao/sprint-4.md` (1137 linhas, com ASCIIs antes/depois e specs detalhadas por sub-fase)

---

## O que JA FOI FEITO (nao repetir)

- [x] Fase 1 completa: EscalaPagina reescrita como visualizador puro (~320 linhas)
- [x] Fase 1 completa: SetorDetalhe como hub (gerar, oficializar, descartar, exportar inline)
- [x] Fase 1 completa: EscalaResultBanner.tsx criado com tiers verde/amber/vermelho
- [x] Fase 2 completa: Export dropdown no EscalaPagina (HTML, Print, CSV, por funcionario)
- [x] Fase 2 completa: ExportModal removido da EscalaPagina (ainda usado no EscalasHub)
- [x] Fase 3.3: Botao "Gerar Escala" no SetorDetalhe (implementado na Fase 1)
- [x] Fase 3.4: Card "Excecoes de Demanda por Data" escondido do SetorDetalhe
- [x] SetorEscalaSection: Label "Editar" → "Ver"

---

## Requisitos Funcionais

### FASE 3: Sidebar + Navegacao (parcial — itens 3.1 e 3.2 pendentes)

- [ ] **3.1** Remover 3 itens da sidebar: "Tipos de Contrato" (`/tipos-contrato`), "Regras" (`/regras`), "Memoria" (`/memoria`). Manter apenas "Feriados" no grupo Configuracao.
  - Arquivo: `src/renderer/src/componentes/AppSidebar.tsx`
  - As rotas continuam existindo no React Router (acessiveis via URL direta)
  - NAO deletar as paginas — so remover os `SidebarMenuItem` do JSX

- [ ] **3.2** Adicionar secao "Configuracoes Avancadas" (Collapsible) na `ConfiguracoesPagina.tsx`, apos o card de Backup:
  - Collapsible fechado por default
  - Dentro: card de config IA (provider, api_key, modelo) — MOVER o card existente pra dentro
  - Dentro: card "Links Rapidos" com 3 links:
    - Tipos de Contrato → `/tipos-contrato` (icon FileText)
    - Regras do Motor → `/regras` (icon ShieldCheck/Shield)
    - Base de Conhecimento → `/memoria` (icon Brain)
  - Visual conforme ASCII em `docs/refatoracao/sprint-4.md` linhas 293-327

### FASE 4: Dirty State

- [ ] **4.1** Criar hook `useDirtyGuard` em `src/renderer/src/hooks/useDirtyGuard.ts` (~50 linhas):
  - Input: `{ isDirty: boolean, message?: string }`
  - Usa `useBlocker` do React Router v7 quando `isDirty === true`
  - Adiciona `beforeunload` listener como fallback (fechar aba/window)
  - Retorna o `blocker` object
  - **VERIFICAR** se `useBlocker` esta estavel na versao do react-router instalada. Se nao, usar `unstable_useBlocker` ou `useBeforeUnload` como fallback.

- [ ] **4.2** Criar componente `DirtyGuardDialog.tsx` em `src/renderer/src/componentes/DirtyGuardDialog.tsx` (~30 linhas):
  - Recebe `blocker: Blocker` como prop
  - Se `blocker.state !== 'blocked'`, retorna null
  - Renderiza AlertDialog com:
    - Titulo: "Alteracoes nao salvas"
    - Descricao: "Voce tem alteracoes que nao foram salvas. Deseja sair mesmo assim?"
    - Cancelar → `blocker.reset()` (label: "Continuar editando")
    - Confirmar → `blocker.proceed()` (label: "Sair sem salvar")

- [ ] **4.3** Aplicar `useDirtyGuard` em 4 paginas:

  | Pagina | Form hook | isDirty source | Complexidade |
  |--------|-----------|----------------|--------------|
  | `ColaboradorDetalhe.tsx` | `colabForm` | `colabForm.formState.isDirty` | MEDIA — cobre Cards A-C, cards E-G salvam individualmente |
  | `SetorDetalhe.tsx` | `setorForm` | `setorForm.formState.isDirty` | MEDIA — cobre card principal |
  | `EmpresaConfig.tsx` | `form` | `form.formState.isDirty` | FACIL |
  | `ConfiguracoesPagina.tsx` | IA form | `iaForm.formState.isDirty` | FACIL |

  - Em cada pagina: `import { useDirtyGuard }` + `import { DirtyGuardDialog }`
  - Chamar hook: `const blocker = useDirtyGuard({ isDirty: form.formState.isDirty })`
  - Renderizar: `<DirtyGuardDialog blocker={blocker} />`
  - **Nota:** ColaboradorDetalhe cards E-G usam useState puro. Cobertura PARCIAL aceita (risco baixo, salvam individualmente). Expandir depois se necessario.

### FASE 5: ColaboradorDetalhe Tabs

- [ ] **5.1** Reorganizar `ColaboradorDetalhe.tsx` com 3 tabs (shadcn Tabs):

  | Tab | Conteudo | Cards incluidos |
  |-----|----------|-----------------|
  | **Geral** | Dados pessoais + contrato + preferencias | Cards A + B + C (unificados em 1 card) |
  | **Horarios** | Regras de horario | Cards E + F + G |
  | **Ausencias** | Ferias, atestados, bloqueios | Card D, com badge contagem de excecoes ativas |

- [ ] **5.2** Unificar Cards A + B + C em 1 card "Dados do Colaborador":
  - Grid 2 colunas: nome, sexo, setor, funcao, contrato, horas, tipo_trabalhador
  - Separador visual "Preferencias": prefere_turno, evitar_dia_semana
  - Layout conforme ASCII em `docs/refatoracao/sprint-4.md` linhas 970-981

- [ ] **5.3** Fix default `sexo: 'M'`:
  - `ColaboradorDetalhe.tsx`: defaultValues `sexo: ''` + validacao Zod `z.enum(['M', 'F'])` sem `.default()`
  - `src/main/ia/tools.ts` linha ~1097: REMOVER `if (!dados.sexo) dados.sexo = 'M'`
  - IA tool `criar`: se sexo nao informado, retornar toolError com correction pedindo pra perguntar

---

## Criterios de Aceitacao

- [ ] `npm run typecheck` retorna 0 erros apos CADA fase
- [ ] Sidebar mostra apenas: Dashboard, Setores, Colaboradores, Escalas, Assistente IA, Feriados (grupo Config), footer inalterado
- [ ] ConfiguracoesPagina tem Collapsible "Avancado" com card IA + links rapidos
- [ ] Links rapidos navegam corretamente para /tipos-contrato, /regras, /memoria
- [ ] URLs diretas (/tipos-contrato, /regras, /memoria) continuam funcionando
- [ ] Dirty state: editar campo em ColaboradorDetalhe → navegar → dialog aparece
- [ ] Dirty state: salvar form → navegar → dialog NAO aparece
- [ ] Dirty state: funciona em todas 4 paginas (ColaboradorDetalhe, SetorDetalhe, EmpresaConfig, ConfiguracoesPagina)
- [ ] beforeunload: fechar aba com form dirty → browser mostra aviso nativo
- [ ] ColaboradorDetalhe: 3 tabs renderizam sem crash
- [ ] Tab Geral: 1 card unificado com todos campos + preferencias
- [ ] Tab Horarios: 3 cards (regra padrao, por dia, excecoes data)
- [ ] Tab Ausencias: card excecoes com badge contagem
- [ ] Criar colaborador sem sexo → validacao impede (nao assume 'M')
- [ ] IA tool `criar` sem sexo → toolError com correction
- [ ] Layout chain intacto (sem scroll duplo, sem gap preto)
- [ ] Dark mode nao quebrou

---

## Constraints

- **Layout Contract**: Manter cadeia de altura fixa (html → body → #root → SidebarProvider → main). Nenhuma pagina pode adicionar `overflow-y-auto` no wrapper interno.
- **snake_case end-to-end**: Todos os campos banco/IPC/TS/React em snake_case.
- **ExportModal.tsx NAO deletar**: Continua sendo usado no EscalasHub (batch export).
- **Rotas NAO remover**: /tipos-contrato, /regras, /memoria continuam existindo no router.
- **ColaboradorDetalhe dirty state parcial**: Cobrir apenas formState.isDirty do react-hook-form (Cards A-C). Cards E-G salvam individualmente — risco aceito.
- **useBlocker React Router v7**: Verificar estabilidade. Se instavel, usar `useBeforeUnload` como fallback.
- **shadcn/ui**: Usar componentes existentes (Tabs, Collapsible, AlertDialog, Badge). NAO criar div soup.

---

## Fora do Escopo

- Reescrever EscalaPagina (ja feito na Fase 1)
- Reescrever SetorDetalhe geracao (ja feito na Fase 1)
- Export direto (ja feito na Fase 2)
- Botao "Gerar Escala" no SetorDetalhe (ja feito)
- Esconder demandas excecao card (ja feito)
- Melhorias no Dashboard (#21 — ja resolvido Sprint 3)
- Rewrite do grid/export por postos (#12 — muito complexo, backlog futuro)
- Melhorias UX em Tipos Contrato (#2 — backlog menor)

---

## Servicos Envolvidos

- [x] Frontend (React 19 + Vite + shadcn/ui)
- [ ] Backend (apenas 1 edit menor: tools.ts remover sexo default)
- [ ] Database (nenhuma mudanca de schema)

---

## Dependencias entre Fases

```
FASE 3 (Sidebar + Config Avancado)
  └── independente — pode comecar imediatamente

FASE 4 (Dirty State)
  └── independente — pode rodar em paralelo com Fase 3

FASE 5 (ColaboradorDetalhe)
  └── melhor APOS Fase 4 (dirty guard ja existe pra reusar)
  └── independente da Fase 3
```

**Ordem recomendada:** 3 → 4 → 5
**Podem rodar em paralelo:** (3, 4)

---

## Arquivos Tocados

### Fase 3

| Arquivo | Acao |
|---------|------|
| `src/renderer/src/componentes/AppSidebar.tsx` | EDITAR — remover 3 SidebarMenuItem |
| `src/renderer/src/paginas/ConfiguracoesPagina.tsx` | EDITAR — +Collapsible Avancado + card links rapidos + mover card IA |

### Fase 4

| Arquivo | Acao |
|---------|------|
| `src/renderer/src/hooks/useDirtyGuard.ts` | CRIAR (~50 linhas) |
| `src/renderer/src/componentes/DirtyGuardDialog.tsx` | CRIAR (~30 linhas) |
| `src/renderer/src/paginas/ColaboradorDetalhe.tsx` | EDITAR — +hook +dialog |
| `src/renderer/src/paginas/SetorDetalhe.tsx` | EDITAR — +hook +dialog |
| `src/renderer/src/paginas/EmpresaConfig.tsx` | EDITAR — +hook +dialog |
| `src/renderer/src/paginas/ConfiguracoesPagina.tsx` | EDITAR — +hook +dialog |

### Fase 5

| Arquivo | Acao |
|---------|------|
| `src/renderer/src/paginas/ColaboradorDetalhe.tsx` | REFATORAR — tabs wrapper + unificar Cards A-C + fix sexo |
| `src/main/ia/tools.ts` | EDITAR — remover sexo default + add toolError correction |

---

## Budget Sugerido

**Recomendacao:** high — Toca 8+ arquivos, refatora ColaboradorDetalhe (arquivo gigante ~1000+ linhas), cria 2 componentes novos, aplica dirty state em 4 paginas. Risco de quebrar layout chain. Precisa de QA rigoroso com tsc + teste manual.

---

## Notas Adicionais

- **Referencia completa**: `docs/refatoracao/sprint-4.md` tem ASCIIs antes/depois, specs detalhadas, e Hall da Vergonha com 24 items (16 resolvidos neste sprint).
- **ColaboradorDetalhe e o arquivo mais complexo do frontend** (~1000+ linhas). A refatoracao em tabs (Fase 5) precisa cuidado com os 7 cards, forms react-hook-form, e estados useState independentes.
- **React Router v7 useBlocker**: Pode ter breaking changes entre minor versions. Testar antes de committar.
- **Fase 1 mudou a arquitetura**: SetorDetalhe agora e o hub de geracao. EscalaPagina e visualizador puro. O plano original do sprint-4.md previa geracao na EscalaPagina, mas a implementacao moveu tudo pro SetorDetalhe — isso e o estado CORRETO atual.
