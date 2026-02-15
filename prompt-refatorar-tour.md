# Prompt: Refatorar Onboarding Tour — De Tooltip pra Pagina Completa

## Contexto do Projeto

EscalaFlow e um app desktop Electron para gerar escalas de trabalho de supermercado. Stack: React 19 + Vite + Tailwind + shadcn/ui + React Router v7. Os usuarios sao os pais do dono (RH do Supermercado Fernandes) — NAO sao tecnicos.

## Estado Atual do Tour

Hoje o onboarding e um **driver.js tooltip tour** minimalista com 4 passos que highlight itens na sidebar:

1. "Bem-vindo ao EscalaFlow" (overlay geral)
2. Highlight "Setores" na sidebar → "Cadastre seus setores"
3. Highlight "Colaboradores" → "Gerencie colaboradores"
4. Highlight "Tipos de Contrato" → "Configure e gere escalas"

### Problemas:
- **Raso demais** — 4 tooltips nao explicam o fluxo real do sistema
- **Preso a sidebar** — so mostra links, nao demonstra funcionalidades
- **Nao cobre o fluxo completo**: cadastrar setor → cadastrar demandas → cadastrar colaboradores → gerar escala → ajustar → oficializar
- **Nao mostra a proposta de valor**: "o SISTEMA propoe a escala, voce so ajusta"
- **Usuarios nao-tecnicos** precisam de mais guia, nao menos

## O Pedido

Refatorar o onboarding para ser uma **pagina dedicada** (`/bem-vindo` ou `/tour`) com experiencia completa e guiada. O driver.js pode ser removido.

## Requisitos

### 1. Pagina `/bem-vindo`
- Rota propria no React Router
- Aparece automaticamente na primeira vez (localStorage check)
- Pode ser acessada depois via menu "Como Funciona?" (ja existe no dropdown da sidebar)
- Nao e modal/overlay — e uma pagina real com navegacao

### 2. Conteudo Obrigatorio (passos do tour)
O tour deve explicar o fluxo completo de uso:

**Passo 1 — Boas-vindas**
- O que e o EscalaFlow
- Proposta: "Voce cadastra, o sistema gera a escala automaticamente"
- Publico: RH que hoje faz escala na mao/Excel

**Passo 2 — Setores**
- O que sao setores (departamentos do supermercado)
- Cada setor tem horario de funcionamento
- Exemplo: Caixa (08:00-22:00), Padaria (06:00-21:00)

**Passo 3 — Demandas**
- Dentro de cada setor, voce define quantas pessoas precisa por horario
- Exemplo visual: "Das 08h-12h preciso de 3 pessoas, das 12h-18h preciso de 5"
- Isso e o que o motor usa pra decidir quem trabalha quando

**Passo 4 — Colaboradores**
- Cadastre funcionarios com nome, setor, tipo de contrato
- O tipo de contrato define regras (CLT 44h = 6 dias, maximo 9h30/dia)
- Excecoes: ferias, atestado, bloqueio

**Passo 5 — Gerar Escala**
- Va na pagina do setor → clique "Gerar Escala"
- O motor cria a escala automaticamente respeitando CLT
- Voce pode ajustar manualmente se quiser
- Quando estiver satisfeito, oficialize

**Passo 6 — Pronto!**
- CTA: "Comecar" → navega pro Dashboard
- Links rapidos: "Criar primeiro setor", "Ver setores de exemplo"

### 3. UX/Visual
- Layout clean, nao parecer manual tecnico
- Ilustracoes/icones por passo (usar lucide-react icons grandes)
- Navegacao: stepper horizontal ou lateral (shadcn nao tem stepper nativo, pode ser custom)
- Botoes "Anterior" / "Proximo" / "Pular tour"
- Progress indicator (1 de 6, 2 de 6...)
- Dark mode completo
- Responsivo dentro do app (sidebar aberta ou fechada)

### 4. Tecnico
- Componente em `src/renderer/src/paginas/BemVindo.tsx`
- Rota `/bem-vindo` no App.tsx
- Redirecionar pra `/bem-vindo` se `localStorage.getItem('escalaflow-onboarding-v1')` nao existe
- Ao concluir, setar flag e navegar pro Dashboard
- Atualizar link "Como Funciona?" na sidebar pra navegar pra `/bem-vindo`
- Remover driver.js e OnboardingTour.tsx
- Remover CSS do driver.js no index.css (linhas 86-160)
- Remover IDs `#tour-*` dos itens da sidebar (AppSidebar.tsx)

## Arquivos Envolvidos

### Criar
- `src/renderer/src/paginas/BemVindo.tsx` — pagina nova

### Modificar
- `src/renderer/src/App.tsx` — adicionar rota `/bem-vindo`
- `src/renderer/src/componentes/AppSidebar.tsx` — atualizar "Como Funciona?" link, remover tourIds
- `src/renderer/src/index.css` — remover CSS do driver.js (linhas 86-160)

### Deletar
- `src/renderer/src/componentes/OnboardingTour.tsx`

### Desinstalar
- `driver.js` do package.json

## Componentes shadcn Disponiveis
Badge, Button, Card, CardContent, CardHeader, CardTitle, Dialog, Input, Label, Tabs, TabsList, TabsTrigger, TabsContent, Alert, Avatar, Separator, Form, Select, Popover, Table

NAO disponivel (pode instalar se necessario): Stepper (nao existe no shadcn — fazer custom)

## Restricoes
- shadcn/ui + Tailwind (sem outra lib de UI)
- Dark mode obrigatorio
- Usuarios NAO-TECNICOS — linguagem simples, visual limpo
- Nao e documentacao — e onboarding interativo
- Pode usar animacoes CSS sutis (transitions, fade-in por passo)

## Entregavel
Codigo completo: pagina BemVindo.tsx, alteracoes no App.tsx, AppSidebar.tsx, index.css, remocao do OnboardingTour.tsx e driver.js.
