# PROMPT — Team de Iteracao UX/UI/Padronizacao

> Cola este prompt inteiro num chat novo do Claude Code.
> Ele vai spawnar um team de 3 agentes pra iterar no ITERACAO.md.

---

## CONTEXTO

O EscalaFlow e um app desktop (Electron) de escalas de trabalho para o RH de um supermercado. Os usuarios sao os PAIS do operador — NAO sao tecnicos. Se parecer planilha manual ou app de dev, FALHOU.

O sistema gera escalas automaticamente (motor de 7 fases, regras CLT). O RH so precisa: cadastrar setor + colaboradores + demandas -> clicar "Gerar" -> ajustar se quiser -> oficializar.

**Estado atual:**
- 9 paginas React (Dashboard, SetorLista, SetorDetalhe, EscalaPagina, ColaboradorLista, ColaboradorDetalhe, ContratoLista, EmpresaConfig, 404)
- Sidebar com nav: Dashboard, Setores, Colaboradores, Config (Contratos, Empresa)
- Motor funcional (gera escalas), mas precisa de refinamento
- Dark mode parcialmente implementado (ThemeProvider ok, cores.ts ok, mas 5+ componentes com cores hardcoded sem dark variant)
- Stack: React 19 + Vite + Tailwind + shadcn/ui + Zustand + React Router 7

**Docs criticos:**
- `specs/004-finalize-v2/ITERACAO.md` — FONTE DA VERDADE. E o doc que voces vao ITERAR.
- `specs/004-finalize-v2/PRD.md` — Requisitos originais
- `specs/004-finalize-v2/discovery.json` — Mapa de arquivos e gaps

---

## MISSAO

Iterar no `ITERACAO.md` para:

1. **Auditar consistencia de UI/UX** entre TODAS as 9 paginas
2. **Padronizar componentes shadcn** — mesmos patterns em todo lugar
3. **Identificar hardcodes que precisam virar cadastro** (ex: tipos de contrato CLT estao hardcoded como seed, mas o usuario precisa poder criar/editar templates)
4. **Unificar layouts** — nao precisa de design diferente pra cada pagina. Cards, listas, formularios = mesmo componente, mesma estrutura
5. **Mapear o que NAO esta user-friendly** e propor solucoes simples

O OUTPUT e APENAS edicao do `ITERACAO.md`. NAO implementem nada. NAO editem codigo. So doc.

---

## TEAM — 3 ESPECIALISTAS

Use `/team` ou `TeamCreate` pra montar o time:

### 1. GUARDIAO DE SHADCN (`shadcn-reviewer`)
**Tipo:** `feature-dev:code-explorer`
**Missao:**
- Ler TODOS os componentes em `src/renderer/src/componentes/` e `src/renderer/src/paginas/`
- Ler TODOS os componentes shadcn em `src/renderer/src/components/ui/`
- Verificar: onde tem `<div className="...">` que deveria ser um componente shadcn?
- Verificar: onde tem shadcn usado com className custom desnecessario? (shadcn ja faz isso)
- Verificar: Cards, Dialogs, Tables, Badges, Buttons — estao consistentes entre paginas?
- Verificar: O mesmo tipo de lista (setores, colaboradores, contratos) usa o mesmo layout?
- Listar TODOS os componentes shadcn instalados vs usados vs faltando
- Mapear: onde falta shadcn component que simplificaria o codigo?

**Output:** Lista de inconsistencias + recomendacoes de padronizacao para as coisas que os outros agentes decidiram e vai precisar criar. Pois tudo que vai mudar, ele precisa palpitar e planejar. Adicionar como secao no ITERACAO.md.

### 2. GUARDIAO DE UX (`ux-guardian`)
**Tipo:** `feature-dev:code-explorer`
**Missao:**
- Mapear TODOS os fluxos do usuario (cadastro, geracao, ajuste, oficializacao, exportacao)
- Identificar: quantos cliques pra cada acao? Pode reduzir?
- Identificar: tem 2 caminhos pra mesma coisa? Unificar.
- Avaliar: a pagina de Tipos de Contrato — hoje e uma lista simples. Faz sentido como DASHBOARD com cards (igual o Dashboard de setores)? Ou faz mais sentido como tab/secao dentro de Config?
- Avaliar: os hardcodes — tipos de contrato CLT estao como seed. O usuario precisa poder:
  - Ver os templates existentes
  - Editar limites (ex: horas semanais, max minutos dia)
  - Criar novo template
  - NAO pode editar regras CLT fixas (max 6 dias consecutivos, 11h descanso — essas sao LEI, nao config)
  - Mas PODE configurar: horas semanais, dias de trabalho, trabalha domingo, max minutos dia
- Avaliar: cada pagina — o que o usuario SENTE ao entrar? Sabe o que fazer? Tem call to action claro?
- Propor: simplificacoes de navegacao (ex: Dashboard com tabs de setores pra ver escalas rapido)

**Output:** Mapa de fluxos + problemas de UX + propostas. Adicionar como secao no ITERACAO.md.

### 3. GUARDIAO DE FUNCIONALIDADE (`func-guardian`)
**Tipo:** `feature-dev:code-explorer`
**Missao:**
- Verificar: cada pagina tem CRUD completo? (Create, Read, Update, Delete)
- Verificar: validacoes de formulario existem? (Zod schemas?)
- Verificar: feedback de sucesso/erro em todas as acoes?
- Verificar: loading states em todas as operacoes async?
- Verificar: o IPC tem handlers pra tudo que o front precisa?
- Verificar: o que esta NO PRD mas NAO esta implementado (gap funcional)
- Verificar: o que esta implementado mas NAO funciona corretamente
- Mapear: campos que sao editaveis vs read-only vs calculados — faz sentido?
- Mapear: o que e hardcoded que deveria ser configuravel pelo usuario

**Output:** Lista de gaps funcionais + items faltantes. Adicionar como secao no ITERACAO.md.

---

## REGRAS DO TEAM

1. **NAO IMPLEMENTEM NADA.** Sem Edit(), sem Write() em codigo. So leitura + escrita no ITERACAO.md.
2. **Leiam o ITERACAO.md PRIMEIRO** antes de comecar a analise.
3. **Leiam o PRD.md** pra entender o que foi prometido.
4. **Cada agente adiciona sua secao** no ITERACAO.md com prefixo:
   - `## SHADCN: [titulo]` para o shadcn-reviewer
   - `## UX: [titulo]` para o ux-guardian
   - `## FUNC: [titulo]` para o func-guardian
5. **Conflitos entre agentes:** Se dois agentes discordam, ambos registram no doc. O operador decide.
6. **Formato dos items:** Cada achado deve ter:
   - **O que:** Descricao do problema/oportunidade
   - **Onde:** Arquivo(s) afetado(s)
   - **Proposta:** Solucao sugerida
   - **Impacto:** [ALTO/MEDIO/BAIXO]
   - **Esforco:** [ALTO/MEDIO/BAIXO]

---

## EXEMPLOS DO QUE PROCURAR

### shadcn-reviewer:
- SetorLista usa `<div className="grid gap-4">` com cards manuais. ColaboradorLista usa `<Table>`. ContratoLista usa outra coisa. PADRONIZAR.
- PontuacaoBadge.tsx inventa badge custom quando poderia usar shadcn Badge com variant.
- Formulario de criar setor usa inputs manuais quando poderia usar shadcn Form + FormField.

### ux-guardian:
- Tipos de Contrato: hoje e uma lista (ContratoLista.tsx). Mas os templates sao CRITICOS pro motor (definem regras por contrato). Deveria ter:
  - Cards com resumo visual (nome, horas, regras)
  - Click pra abrir Dialog com formulario de edicao
  - Destaque claro do que e EDITAVEL (horas, dias) vs FIXO (regras CLT)
  - Opcao de "Importar Template CLT" pra facilitar
- EmpresaConfig: e uma pagina separada. Faz sentido? Ou vira uma secao no sidebar de Config?
- Dashboard: mostra stats + setores. Se mostrasse as ESCALAS por tab de setor, o RH nao precisaria navegar.

### func-guardian:
- ColaboradorDetalhe: tem campo `evitar_dia_semana` mas sera que o IPC handler de update aceita esse campo?
- ExportarEscala: funciona? Gera PDF/HTML? Ou so imprime via window.print()?
- Oficializar: o que acontece com a escala anterior? Move pra ARQUIVADA? O handler faz isso?

---

## FLOW DO TEAM

```
1. Team Lead le ITERACAO.md + PRD.md
2. Spawna 3 agentes em PARALELO (leitura do codebase)
3. Cada agente faz sua analise e manda resultados pro Lead
4. Lead consolida no ITERACAO.md (novas secoes)
5. Lead apresenta resumo ao operador
```

---

## COMANDO INICIAL

```
Leia `specs/004-finalize-v2/ITERACAO.md` e `specs/004-finalize-v2/PRD.md`.
Depois, crie um team com 3 agentes especializados (shadcn-reviewer, ux-guardian, func-guardian).
Cada agente analisa o codebase da sua perspectiva e ADICIONA suas descobertas como novas secoes no ITERACAO.md.
NAO implemente nada. So analise e documentacao.
Budget: medium (sonnet pros agentes, opus pro lead se necessario).
```
