# PRD: Refatorar Onboarding — De Tooltip pra Pagina Completa

> **Workflow:** refactor
> **Budget sugerido:** medium
> **Criado em:** 2026-02-15T12:00:00Z
> **Fonte:** gather (prompt detalhado do operador)

---

## Visao Geral

O onboarding atual e um **driver.js tooltip tour** com 4 passos rasos que apenas highlightam links na sidebar. Nao explica o fluxo real do sistema, nao cobre o ciclo completo (setor → demandas → colaboradores → gerar escala → ajustar → oficializar), e insuficiente para usuarios nao-tecnicos (pais do Marco, RH do Supermercado Fernandes).

**Objetivo:** Substituir o tooltip tour por uma **pagina dedicada `/bem-vindo`** com experiencia completa e guiada, 6 passos, stepper visual, navegacao propria. Remover driver.js completamente.

**Principio:** O usuario deve sair do tour sabendo: "Eu cadastro, o SISTEMA gera a escala. Eu so ajusto."

---

## Requisitos Funcionais

### RF1: Pagina `/bem-vindo`
- [ ] Rota propria `/bem-vindo` no React Router (dentro do layout com sidebar)
- [ ] Aparece automaticamente se `localStorage.getItem('escalaflow-onboarding-v1')` nao existe (redirect na raiz)
- [ ] Acessivel depois via link "Como Funciona?" no menu da sidebar
- [ ] Pagina real com navegacao (nao modal/overlay)

### RF2: Conteudo — 6 Passos do Tour
- [ ] **Passo 1 — Boas-vindas:** O que e o EscalaFlow, proposta de valor ("Voce cadastra, o sistema gera"), publico-alvo (RH que faz escala na mao/Excel)
- [ ] **Passo 2 — Setores:** O que sao setores (departamentos), horario de funcionamento, exemplos (Caixa 08:00-22:00, Padaria 06:00-21:00)
- [ ] **Passo 3 — Demandas:** Dentro de cada setor, define quantas pessoas por horario. Exemplo visual: "Das 08h-12h preciso de 3 pessoas". Isso alimenta o motor
- [ ] **Passo 4 — Colaboradores:** Cadastrar funcionarios com nome, setor, tipo de contrato. Contrato define regras CLT. Excecoes: ferias, atestado, bloqueio
- [ ] **Passo 5 — Gerar Escala:** Ir na pagina do setor → "Gerar Escala" → motor cria automaticamente → ajustar manualmente se quiser → oficializar
- [ ] **Passo 6 — Pronto!:** CTA "Comecar" → navega pro Dashboard. Links rapidos: "Criar primeiro setor", "Ver setores de exemplo"

### RF3: Navegacao e UX
- [ ] Stepper visual (horizontal ou lateral) — custom, shadcn nao tem nativo
- [ ] Botoes "Anterior" / "Proximo" / "Pular tour"
- [ ] Progress indicator ("Passo 2 de 6...")
- [ ] Icones grandes por passo (lucide-react)
- [ ] Animacoes CSS sutis (transitions, fade-in por passo)

### RF4: Finalizacao
- [ ] Ao concluir (Passo 6 → "Comecar"), setar `localStorage.setItem('escalaflow-onboarding-v1', '1')` e navegar pro Dashboard (`/`)
- [ ] "Pular tour" tambem seta flag e navega pro Dashboard

### RF5: Remocao do driver.js
- [ ] Deletar `src/renderer/src/componentes/OnboardingTour.tsx`
- [ ] Remover import e `<OnboardingTour />` do `App.tsx`
- [ ] Remover CSS do driver.js no `index.css` (linhas 86-164, bloco `.driver-popover.escalaflow-tour-popover`)
- [ ] Remover atributos `tourId` dos itens do menu em `AppSidebar.tsx` e IDs `#tour-*` correspondentes
- [ ] Desinstalar pacote `driver.js` do `package.json`
- [ ] Atualizar link "Como Funciona?" na sidebar pra navegar pra `/bem-vindo` (em vez de disparar evento `escalaflow:open-onboarding`)

---

## Criterios de Aceitacao

- [ ] Rota `/bem-vindo` renderiza pagina com 6 passos navegaveis
- [ ] Primeira visita (sem flag no localStorage) redireciona automaticamente pra `/bem-vindo`
- [ ] Navegacao Anterior/Proximo funciona entre todos os passos
- [ ] "Pular tour" e "Comecar" (passo 6) setam flag e navegam pro Dashboard
- [ ] Link "Como Funciona?" na sidebar navega pra `/bem-vindo`
- [ ] driver.js completamente removido (sem imports, sem CSS, sem package)
- [ ] IDs `#tour-*` removidos da sidebar
- [ ] Dark mode funciona 100% na pagina de onboarding
- [ ] Layout responsivo (sidebar aberta/fechada)
- [ ] `npx tsc --noEmit` retorna 0 erros
- [ ] `npm run build` completa sem erros
- [ ] Linguagem simples, nao-tecnica, visual limpo (nao parecer manual)

---

## Constraints

- shadcn/ui + Tailwind (sem outra lib de UI)
- Dark mode obrigatorio (variaveis CSS do tema existente)
- Linguagem simples para usuarios nao-tecnicos
- Nao e documentacao tecnica — e onboarding interativo e visual
- Stepper e custom (shadcn nao tem componente Stepper)
- Usar lucide-react para icones (ja instalado)
- Manter a mesma chave localStorage `escalaflow-onboarding-v1`

---

## Fora do Escopo

- Tour interativo que mostra paginas reais (nao e walkthrough do app, e explicacao)
- Video/GIF embutido
- Analytics de onboarding
- Traducao/i18n
- Novo componente shadcn de Stepper como lib separada
- Alteracoes no motor, backend, ou IPC

---

## Servicos Envolvidos

- [x] Frontend (pagina nova + alteracoes em 3 arquivos existentes)
- [ ] Backend
- [ ] Database
- [ ] IPC/Main Process

---

## Arquivos Envolvidos

### Criar
| Arquivo | Descricao |
|---------|-----------|
| `src/renderer/src/paginas/BemVindo.tsx` | Pagina completa do onboarding com 6 passos, stepper, navegacao |

### Modificar
| Arquivo | O que mudar |
|---------|-------------|
| `src/renderer/src/App.tsx` | Adicionar rota `/bem-vindo`, redirect condicional, remover import OnboardingTour |
| `src/renderer/src/componentes/AppSidebar.tsx` | Remover tourIds dos itens, atualizar "Como Funciona?" pra navegar pra `/bem-vindo` |
| `src/renderer/src/index.css` | Remover bloco CSS do driver.js (linhas 86-164) |
| `package.json` | Remover `driver.js` das dependencies |

### Deletar
| Arquivo | Motivo |
|---------|--------|
| `src/renderer/src/componentes/OnboardingTour.tsx` | Substituido pela pagina BemVindo.tsx |

---

## Componentes shadcn Disponiveis

Badge, Button, Card, CardContent, CardHeader, CardTitle, Dialog, Input, Label, Tabs, TabsList, TabsTrigger, TabsContent, Alert, Avatar, Separator, Form, Select, Popover, Table

**Recomendacao de uso:**
- Card/CardContent/CardHeader → container de cada passo
- Button → navegacao (Anterior, Proximo, Pular, Comecar)
- Badge → indicador de passo atual
- Separator → divisor visual entre secoes

---

## Estrutura Sugerida do BemVindo.tsx

```
BemVindo (pagina)
├── StepIndicator (custom) — stepper visual com numeros/icones
├── StepContent (condicional por passo)
│   ├── Passo1Boas vindas — hero com icone + texto
│   ├── Passo2Setores — icone Building2 + explicacao + exemplo
│   ├── Passo3Demandas — icone Clock + explicacao + exemplo visual
│   ├── Passo4Colaboradores — icone Users + explicacao + contrato
│   ├── Passo5GerarEscala — icone Calendar + fluxo gerar→ajustar→oficializar
│   └── Passo6Pronto — icone CheckCircle + CTA + links rapidos
├── NavigationButtons — Anterior | Proximo | Pular
└── ProgressText — "Passo X de 6"
```

---

## Budget Sugerido

**Recomendacao:** `medium`

**Justificativa:** Feature puramente frontend, 1 arquivo novo + 4 modificacoes + 1 delecao + 1 uninstall. Logica simples (useState pra passo atual, localStorage, navigate). A complexidade esta no design visual do stepper e conteudo dos passos, nao na logica. Sonnet para coder e suficiente.

---

## Notas Adicionais

- O evento `escalaflow:open-onboarding` (window.addEventListener) deve ser removido junto com o OnboardingTour
- A sidebar ja tem um item "Como Funciona?" que dispara esse evento — precisa virar `<Link to="/bem-vindo">`
- O redirect condicional pode ser feito com um wrapper component ou useEffect no App.tsx com `useNavigate`
- Considerar: pagina `/bem-vindo` fica DENTRO do layout com sidebar (SidebarProvider) ou e full-screen? **Recomendacao: dentro do layout** pra manter consistencia e o usuario ja ver a sidebar que sera mencionada nos passos
