# Prompt: Aparencia e Temas na Pagina de Configuracoes

## Contexto do Projeto

EscalaFlow e um app desktop Electron para gerar escalas de trabalho de supermercado. Stack: React 19 + Vite + Tailwind + shadcn/ui + Zustand + next-themes. Usuarios: pais do dono (RH, nao-tecnicos).

## Infraestrutura de Tema Atual

### Tailwind
- `darkMode: ['class']` no `tailwind.config.js`
- Todas as cores via CSS custom properties HSL (`--background`, `--primary`, `--card`, etc.)
- Dois blocos de variaveis definidos em `index.css`: `:root` (light) e `.dark` (dark)
- Formato atual: **HSL sem funcao** (ex: `222.2 84% 4.9%`), consumido via `hsl(var(--xxx))`

### next-themes (ja instalado e configurado)
```tsx
// main.tsx
<ThemeProvider attribute="class" defaultTheme="system" storageKey="escalaflow-theme">
```
- `attribute="class"` → toggle classe `dark` no `<html>`
- `defaultTheme="system"` → segue OS
- `storageKey="escalaflow-theme"` → persiste no localStorage

### Variaveis CSS atuais COMPLETAS (index.css)
```css
:root {
  --background: 0 0% 100%;
  --foreground: 222.2 84% 4.9%;
  --card: 0 0% 100%;
  --card-foreground: 222.2 84% 4.9%;
  --popover: 0 0% 100%;
  --popover-foreground: 222.2 84% 4.9%;
  --primary: 222.2 47.4% 11.2%;
  --primary-foreground: 210 40% 98%;
  --secondary: 210 40% 96.1%;
  --secondary-foreground: 222.2 47.4% 11.2%;
  --muted: 210 40% 96.1%;
  --muted-foreground: 215.4 16.3% 46.9%;
  --accent: 210 40% 96.1%;
  --accent-foreground: 222.2 47.4% 11.2%;
  --destructive: 0 84.2% 60.2%;
  --destructive-foreground: 210 40% 98%;
  --border: 214.3 31.8% 91.4%;
  --input: 214.3 31.8% 91.4%;
  --ring: 222.2 84% 4.9%;
  --radius: 0.5rem;
  --sidebar-background: 0 0% 98%;
  --sidebar-foreground: 240 5.3% 26.1%;
  --sidebar-primary: 240 5.9% 10%;
  --sidebar-primary-foreground: 0 0% 98%;
  --sidebar-accent: 240 4.8% 95.9%;
  --sidebar-accent-foreground: 240 5.9% 10%;
  --sidebar-border: 220 13% 91%;
  --sidebar-ring: 217.2 91.2% 59.8%;
}
.dark {
  --background: 222.2 84% 4.9%;
  --foreground: 210 40% 98%;
  --card: 222.2 84% 4.9%;
  --card-foreground: 210 40% 98%;
  --popover: 222.2 84% 4.9%;
  --popover-foreground: 210 40% 98%;
  --primary: 210 40% 98%;
  --primary-foreground: 222.2 47.4% 11.2%;
  --secondary: 217.2 32.6% 17.5%;
  --secondary-foreground: 210 40% 98%;
  --muted: 217.2 32.6% 17.5%;
  --muted-foreground: 215 20.2% 65.1%;
  --accent: 217.2 32.6% 17.5%;
  --accent-foreground: 210 40% 98%;
  --destructive: 0 62.8% 30.6%;
  --destructive-foreground: 210 40% 98%;
  --border: 217.2 32.6% 17.5%;
  --input: 217.2 32.6% 17.5%;
  --ring: 212.7 26.8% 83.9%;
  --sidebar-background: 240 5.9% 10%;
  --sidebar-foreground: 240 4.8% 95.9%;
  --sidebar-primary: 224.3 76.3% 48%;
  --sidebar-primary-foreground: 0 0% 100%;
  --sidebar-accent: 240 3.7% 15.9%;
  --sidebar-accent-foreground: 240 4.8% 95.9%;
  --sidebar-border: 240 3.7% 15.9%;
  --sidebar-ring: 217.2 91.2% 59.8%;
}
```

### tailwind.config.js — Como as cores sao consumidas
```js
colors: {
  background: 'hsl(var(--background))',
  foreground: 'hsl(var(--foreground))',
  primary: { DEFAULT: 'hsl(var(--primary))', foreground: 'hsl(var(--primary-foreground))' },
  // ... etc — TUDO via hsl(var(--xxx))
}
```

**IMPORTANTE:** O projeto usa formato HSL (H S% L%), NAO oklch. As novas versoes do shadcn usam oklch mas este projeto e mais antigo. As paletas devem ser definidas em HSL para compatibilidade.

## O Pedido

Adicionar um card **"Aparencia"** na pagina de Configuracoes (`EmpresaConfig.tsx`) com:

### 1. Modo de Aparencia (light/dark/system)
- 3 opcoes clicaveis estilo card/tile (igual screenshot de referencia abaixo)
- Icones: Monitor (system), Sun (light), Moon (dark)
- Usa `useTheme()` do next-themes pra toggle (`setTheme('light' | 'dark' | 'system')`)
- Selecionado = borda primary + fundo accent

### 2. Paleta de Cores — Temas OFICIAIS do shadcn/ui

Usar **4 temas** do catalogo oficial do shadcn (https://ui.shadcn.com/themes). Os CSS values abaixo ja estao convertidos pra HSL pra manter compatibilidade com o projeto.

**TEMA 1: Zinc (Padrao)** — O tema atual, neutro e limpo
- Ja e o default. Nenhuma mudanca necessaria.
- Preview circles: background cinza + foreground quase preto

**TEMA 2: Blue** — Profissional, confiavel
```css
/* Light */
--primary: 221.2 83.2% 53.3%;
--primary-foreground: 210 40% 98%;
--ring: 221.2 83.2% 53.3%;
--sidebar-primary: 221.2 83.2% 53.3%;
--sidebar-primary-foreground: 210 40% 98%;

/* Dark */
--primary: 217.2 91.2% 59.8%;
--primary-foreground: 222.2 47.4% 11.2%;
--ring: 217.2 91.2% 59.8%;
--sidebar-primary: 217.2 91.2% 59.8%;
--sidebar-primary-foreground: 222.2 47.4% 11.2%;
```

**TEMA 3: Green** — Fresco, natural (combina com supermercado)
```css
/* Light */
--primary: 142.1 76.2% 36.3%;
--primary-foreground: 355.7 100% 97.3%;
--ring: 142.1 76.2% 36.3%;
--sidebar-primary: 142.1 76.2% 36.3%;
--sidebar-primary-foreground: 355.7 100% 97.3%;

/* Dark */
--primary: 142.1 70.6% 45.3%;
--primary-foreground: 144.9 80.4% 10%;
--ring: 142.1 70.6% 45.3%;
--sidebar-primary: 142.1 70.6% 45.3%;
--sidebar-primary-foreground: 144.9 80.4% 10%;
```

**TEMA 4: Violet** — Elegante, moderno
```css
/* Light */
--primary: 262.1 83.3% 57.8%;
--primary-foreground: 210 40% 98%;
--ring: 262.1 83.3% 57.8%;
--sidebar-primary: 262.1 83.3% 57.8%;
--sidebar-primary-foreground: 210 40% 98%;

/* Dark */
--primary: 263.4 70% 50.4%;
--primary-foreground: 210 40% 98%;
--ring: 263.4 70% 50.4%;
--sidebar-primary: 263.4 70% 50.4%;
--sidebar-primary-foreground: 210 40% 98%;
```

**Cada tema sobrescreve APENAS:** `--primary`, `--primary-foreground`, `--ring`, `--sidebar-primary`, `--sidebar-primary-foreground`. O resto (background, card, border, muted, secondary, accent, etc.) fica IDENTICO — so muda a cor de destaque.

### 3. Mecanismo de Troca de Paleta

**Abordagem recomendada: data-attribute no CSS**

```css
/* index.css */
[data-color-theme="blue"] {
  --primary: 221.2 83.2% 53.3%;
  --primary-foreground: 210 40% 98%;
  --ring: 221.2 83.2% 53.3%;
  --sidebar-primary: 221.2 83.2% 53.3%;
  --sidebar-primary-foreground: 210 40% 98%;
}
[data-color-theme="blue"].dark {
  --primary: 217.2 91.2% 59.8%;
  /* etc */
}
/* Repetir pra green, violet */
```

- Aplicar via `document.documentElement.setAttribute('data-color-theme', 'blue')`
- Persistir no `localStorage` (key: `escalaflow-color-theme`)
- Na inicializacao do app, carregar e aplicar o data-attribute
- "Zinc" (padrao) = sem data-attribute (usa os defaults do `:root` / `.dark`)

**Ponto de atencao:** O seletor `.dark` e uma classe e o `data-color-theme` e um atributo. Precisa combinar os dois corretamente:
- Light + Blue: `[data-color-theme="blue"]`
- Dark + Blue: `.dark[data-color-theme="blue"]`

### 4. Preview em Tempo Real
- Ao clicar numa paleta, a mudanca deve ser INSTANTANEA (preview ao vivo, sem reload)
- Cada card de paleta mostra 2 circulos sobrepostos: cor de background + cor primary

## UX/Visual

Referencia visual (estilo Auto Claude Appearance settings):
```
┌─────────────────────────────────────────────────┐
│ Aparencia                                        │
│ Personalize a aparencia do sistema               │
│─────────────────────────────────────────────────│
│                                                  │
│ Modo                                             │
│ Escolha entre claro, escuro ou automatico        │
│                                                  │
│ ┌──────┐ ┌──────┐ ┌──────┐                      │
│ │  🖥   │ │  ☀   │ │  🌙  │                      │
│ │System│ │Claro │ │Escuro│                      │
│ └──────┘ └──────┘ └──────┘                      │
│                                                  │
│ Cor do tema                                      │
│ Escolha a paleta de cores da interface           │
│                                                  │
│ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐
│ │ ⬤⬤  ✓   │ │ ⬤⬤      │ │ ⬤⬤      │ │ ⬤⬤      │
│ │ Zinc     │ │ Blue     │ │ Green    │ │ Violet   │
│ │ Neutro   │ │Profiss.  │ │ Fresco   │ │ Elegante │
│ └──────────┘ └──────────┘ └──────────┘ └──────────┘
└─────────────────────────────────────────────────┘
```

- Cards de paleta: 2 circulos sobrepostos (background + primary da paleta) como mini-preview
- Selecionado: borda ring + checkmark no canto
- Hover: `bg-accent` sutil
- Grid: 4 colunas (ou 2x2 se espaço nao permitir)
- Labels em portugues: "Automatico", "Claro", "Escuro"

## Pagina de Configuracoes Atual (EmpresaConfig.tsx)

Atualmente a pagina tem 2 cards:
1. **Dados da Empresa** (nome, CNPJ, telefone, corte semanal, tolerancia)
2. **Regras Trabalhistas** (lista read-only de regras CLT)

O novo card **Aparencia** deve ficar **entre** os dois cards existentes. Usar `CardHeader` + `CardTitle` + `CardDescription` + `Separator` entre secoes de Modo e Cor, seguindo o padrao dos outros cards.

## Arquivos Envolvidos

### Modificar
- `src/renderer/src/paginas/EmpresaConfig.tsx` — adicionar card de Aparencia entre os 2 existentes
- `src/renderer/src/index.css` — adicionar blocos CSS das paletas com `[data-color-theme="xxx"]`

### Criar
- `src/renderer/src/hooks/useColorTheme.ts` — hook pra gerenciar paleta:
  - `colorTheme`: string atual ('zinc' | 'blue' | 'green' | 'violet')
  - `setColorTheme(theme)`: aplica no DOM + salva localStorage
  - Inicializacao: le localStorage e aplica data-attribute

### NAO modificar
- `tailwind.config.js` — nao precisa mudar (ja consome via hsl(var(--xxx)))
- `main.tsx` — ThemeProvider ja ta configurado pra light/dark

## Componentes shadcn Disponiveis
Button, Card, CardContent, CardHeader, CardTitle, CardDescription, Badge, Separator, Select, Input, Label, Form, Dialog, Alert, Tabs, Popover, Table

## Restricoes
- shadcn/ui + Tailwind (sem Material UI, Chakra, etc)
- next-themes ja instalado — usar `useTheme()` pro modo light/dark/system
- **Formato HSL** — o projeto inteiro usa `hsl(var(--xxx))`, NAO oklch
- As paletas sao do catalogo oficial shadcn/ui, so que em HSL
- Dark mode obrigatorio (as paletas precisam funcionar em AMBOS os modos)
- Persistencia via localStorage
- Aplicacao instantanea (sem reload)
- Usuarios nao-tecnicos — labels em portugues, zero jargao

## Entregavel
Codigo completo:
1. Card de Aparencia no EmpresaConfig.tsx (modo + paleta)
2. CSS das 3 paletas extras no index.css (blue, green, violet)
3. Hook useColorTheme.ts
4. Inicializacao no app (carregar paleta salva on mount)

Tudo funcionando com preview ao vivo, dark mode, e persistencia.
