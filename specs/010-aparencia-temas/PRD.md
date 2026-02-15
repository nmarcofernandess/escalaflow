# PRD: Aparencia e Temas na Pagina de Configuracoes

> **Workflow:** feature
> **Budget sugerido:** low
> **Criado em:** 2026-02-15T12:00:00Z
> **Fonte:** gather (prompt detalhado)

---

## Visao Geral

Adicionar um card **"Aparencia"** na pagina de Configuracoes (`EmpresaConfig.tsx`) que permite ao usuario:

1. **Alternar modo de aparencia** entre Claro, Escuro e Automatico (via next-themes, ja instalado)
2. **Escolher paleta de cores** entre 4 temas oficiais do shadcn/ui: Zinc (padrao), Blue, Green, Violet

O mecanismo de troca de paleta usa `data-color-theme` attribute no `<html>`, persistido via localStorage. As paletas sobrescrevem APENAS as variaveis `--primary`, `--primary-foreground`, `--ring`, `--sidebar-primary`, `--sidebar-primary-foreground` — o resto (background, card, border, muted, secondary, accent) permanece identico.

Preview em tempo real: ao clicar numa opcao, a mudanca e instantanea (sem reload). Labels em portugues.

---

## Infraestrutura Existente

### next-themes (ja configurado)
```tsx
// main.tsx
<ThemeProvider attribute="class" defaultTheme="system" storageKey="escalaflow-theme">
```
- `useTheme()` → `{ theme, setTheme }` para light/dark/system
- Classe `.dark` no `<html>` para dark mode

### CSS Custom Properties (index.css)
- Formato: **HSL sem funcao** (ex: `222.2 84% 4.9%`)
- Consumido via `hsl(var(--xxx))` no tailwind.config.js
- Dois blocos: `:root` (light) e `.dark` (dark)
- **NAO usa oklch** — projeto mais antigo, manter HSL

### Componentes shadcn disponiveis
Button, Card, CardContent, CardHeader, CardTitle, CardDescription, Badge, Separator, Select, Input, Label, Form, Dialog, Alert, Tabs, Popover, Table

---

## Requisitos Funcionais

### Card de Aparencia

- [ ] Card posicionado **entre** os 2 cards existentes (Dados da Empresa e Regras Trabalhistas)
- [ ] Usar `CardHeader` + `CardTitle` + `CardDescription` + `CardContent` seguindo padrao existente
- [ ] `Separator` entre secao Modo e secao Cor do Tema

### Secao 1: Modo de Aparencia

- [ ] 3 opcoes clicaveis estilo tile/card: Automatico, Claro, Escuro
- [ ] Icones: `Monitor` (system), `Sun` (light), `Moon` (dark) — do lucide-react
- [ ] Labels em portugues: "Automatico", "Claro", "Escuro"
- [ ] Usa `useTheme()` do next-themes → `setTheme('system' | 'light' | 'dark')`
- [ ] Tile selecionado: `border-primary` + `bg-accent`
- [ ] Tile hover: `bg-accent` sutil
- [ ] Layout: 3 colunas lado a lado

### Secao 2: Paleta de Cores

- [ ] 4 opcoes de paleta: Zinc, Blue, Green, Violet
- [ ] Cada card mostra 2 circulos sobrepostos: cor de background + cor primary (mini-preview)
- [ ] Label abaixo de cada preview: "Zinc", "Azul", "Verde", "Violeta"
- [ ] Card selecionado: borda `ring` + checkmark no canto (icone `Check`)
- [ ] Card hover: `bg-accent` sutil
- [ ] Layout: 4 colunas (ou 2x2 responsivo)
- [ ] Troca instantanea ao clicar (preview ao vivo)

### Hook useColorTheme

- [ ] Criar `src/renderer/src/hooks/useColorTheme.ts`
- [ ] Estado: `colorTheme` com valores `'zinc' | 'blue' | 'green' | 'violet'`
- [ ] `setColorTheme(theme)`: aplica `data-color-theme` no `document.documentElement` + salva no localStorage
- [ ] Para 'zinc' (padrao): **remove** o `data-color-theme` attribute (usa defaults `:root` / `.dark`)
- [ ] Para outros: `document.documentElement.setAttribute('data-color-theme', theme)`
- [ ] Persistencia: localStorage key `escalaflow-color-theme`
- [ ] Inicializacao: le do localStorage e aplica o attribute no mount

### CSS das Paletas (index.css)

- [ ] Adicionar blocos `[data-color-theme="blue"]` e `.dark[data-color-theme="blue"]`
- [ ] Adicionar blocos `[data-color-theme="green"]` e `.dark[data-color-theme="green"]`
- [ ] Adicionar blocos `[data-color-theme="violet"]` e `.dark[data-color-theme="violet"]`
- [ ] Cada bloco sobrescreve APENAS: `--primary`, `--primary-foreground`, `--ring`, `--sidebar-primary`, `--sidebar-primary-foreground`

### Inicializacao do App

- [ ] Na inicializacao (antes do render ou em App.tsx/main.tsx), carregar valor do localStorage e aplicar `data-color-theme` no DOM
- [ ] Evitar flash de tema errado (aplicar cedo, idealmente inline script ou useEffect no mount)

---

## Valores CSS das Paletas

### Blue
```css
/* Light */
[data-color-theme="blue"] {
  --primary: 221.2 83.2% 53.3%;
  --primary-foreground: 210 40% 98%;
  --ring: 221.2 83.2% 53.3%;
  --sidebar-primary: 221.2 83.2% 53.3%;
  --sidebar-primary-foreground: 210 40% 98%;
}
/* Dark */
.dark[data-color-theme="blue"] {
  --primary: 217.2 91.2% 59.8%;
  --primary-foreground: 222.2 47.4% 11.2%;
  --ring: 217.2 91.2% 59.8%;
  --sidebar-primary: 217.2 91.2% 59.8%;
  --sidebar-primary-foreground: 222.2 47.4% 11.2%;
}
```

### Green
```css
/* Light */
[data-color-theme="green"] {
  --primary: 142.1 76.2% 36.3%;
  --primary-foreground: 355.7 100% 97.3%;
  --ring: 142.1 76.2% 36.3%;
  --sidebar-primary: 142.1 76.2% 36.3%;
  --sidebar-primary-foreground: 355.7 100% 97.3%;
}
/* Dark */
.dark[data-color-theme="green"] {
  --primary: 142.1 70.6% 45.3%;
  --primary-foreground: 144.9 80.4% 10%;
  --ring: 142.1 70.6% 45.3%;
  --sidebar-primary: 142.1 70.6% 45.3%;
  --sidebar-primary-foreground: 144.9 80.4% 10%;
}
```

### Violet
```css
/* Light */
[data-color-theme="violet"] {
  --primary: 262.1 83.3% 57.8%;
  --primary-foreground: 210 40% 98%;
  --ring: 262.1 83.3% 57.8%;
  --sidebar-primary: 262.1 83.3% 57.8%;
  --sidebar-primary-foreground: 210 40% 98%;
}
/* Dark */
.dark[data-color-theme="violet"] {
  --primary: 263.4 70% 50.4%;
  --primary-foreground: 210 40% 98%;
  --ring: 263.4 70% 50.4%;
  --sidebar-primary: 263.4 70% 50.4%;
  --sidebar-primary-foreground: 210 40% 98%;
}
```

---

## Criterios de Aceitacao

- [ ] Card "Aparencia" visivel na pagina de Configuracoes, entre os 2 cards existentes
- [ ] Toggle light/dark/system funciona corretamente (next-themes)
- [ ] Troca de paleta muda cores instantaneamente (sem reload)
- [ ] Paleta persiste entre sessoes (localStorage)
- [ ] Dark mode + cada paleta funciona corretamente (6 combinacoes: 3 modos x nao precisa testar zinc separado)
- [ ] `tsc --noEmit` passa sem erros
- [ ] Build completa sem erros
- [ ] Labels em portugues, zero jargao tecnico

---

## Constraints

- Formato HSL obrigatorio (NAO oklch) — manter compatibilidade com projeto existente
- shadcn/ui + Tailwind — sem libs externas de UI
- next-themes ja instalado — NAO instalar outro sistema de temas
- Paletas sobrescrevem APENAS 5 variaveis (primary, primary-foreground, ring, sidebar-primary, sidebar-primary-foreground)
- tailwind.config.js NAO deve ser modificado
- main.tsx NAO deve ser modificado (ThemeProvider ja esta configurado)

---

## Fora do Escopo

- Paletas customizaveis pelo usuario (color picker) — so as 4 pre-definidas
- Fontes customizaveis
- Layout/spacing customizavel
- Exportar/importar tema
- Tema por setor ou por pagina

---

## Servicos Envolvidos

- [x] Frontend (React components, CSS, hook)
- [ ] Backend — NAO envolvido
- [ ] Database — NAO envolvido
- [ ] IPC — NAO envolvido

---

## Arquivos

### Criar
| Arquivo | Funcao |
|---------|--------|
| `src/renderer/src/hooks/useColorTheme.ts` | Hook para gerenciar paleta de cores (get/set/persist) |

### Modificar
| Arquivo | O que muda |
|---------|------------|
| `src/renderer/src/paginas/EmpresaConfig.tsx` | Adicionar card de Aparencia entre os 2 cards existentes |
| `src/renderer/src/index.css` | Adicionar blocos CSS das 3 paletas extras (blue, green, violet) com seletores `[data-color-theme]` |

### NAO modificar
| Arquivo | Motivo |
|---------|--------|
| `tailwind.config.js` | Ja consome cores via `hsl(var(--xxx))`, nenhuma mudanca necessaria |
| `src/renderer/src/main.tsx` | ThemeProvider ja configurado para light/dark/system |

---

## UX/Visual Reference

```
┌─────────────────────────────────────────────────┐
│ Aparencia                                        │
│ Personalize o visual do sistema                  │
│─────────────────────────────────────────────────│
│                                                  │
│ Modo                                             │
│ Escolha entre claro, escuro ou automatico        │
│                                                  │
│ ┌──────────┐ ┌──────────┐ ┌──────────┐          │
│ │    🖥     │ │    ☀     │ │    🌙    │          │
│ │Automatico│ │  Claro   │ │  Escuro  │          │
│ └──────────┘ └──────────┘ └──────────┘          │
│                                                  │
│ ──────────────────────────────────────           │
│                                                  │
│ Cor do tema                                      │
│ Escolha a paleta de cores da interface           │
│                                                  │
│ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐    │
│ │ ⚫⚪   │ │ 🔵⚪  │ │ 🟢⚪  │ │ 🟣⚪  │    │
│ │  Zinc  │ │  Azul  │ │ Verde  │ │Violeta │    │
│ └────────┘ └────────┘ └────────┘ └────────┘    │
│                                                  │
└─────────────────────────────────────────────────┘
```

Cada card de paleta: 2 circulos sobrepostos (background + primary), label abaixo.
Selecionado: borda ring + checkmark. Hover: bg-accent sutil.

---

## Budget Sugerido

**Recomendacao:** `low` — Feature 100% frontend, 3 arquivos (1 novo, 2 modificados), logica simples (CSS vars + localStorage + useState), sem backend/DB/IPC. Paletas ja definidas, componentes shadcn disponiveis.

---

## Notas Adicionais

- Os valores CSS das paletas foram pre-convertidos de oklch para HSL para manter compatibilidade
- O tema "Zinc" e o default — nao precisa de data-attribute, usa os valores ja existentes em `:root`/`.dark`
- O seletor CSS precisa combinar classe `.dark` com atributo `[data-color-theme]` corretamente
- Circulos de preview no card de paleta podem usar cores hardcoded (ja que sao para preview visual)
- Considerar usar `useEffect` com `[]` para aplicar tema salvo no mount, ou um script inline no `index.html` para evitar flash
