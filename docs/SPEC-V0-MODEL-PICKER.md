# V0 Prompt — Model Catalog Picker

Crie um componente React `IaModelCatalogPicker` usando **shadcn/ui** (Tailwind + Radix). Dark mode. O componente é um picker de modelos de IA dentro de uma página de configurações.

---

## Stack obrigatória

- React 19 + TypeScript
- shadcn/ui: `Table`, `TableHeader`, `TableBody`, `TableRow`, `TableHead`, `TableCell`, `ScrollArea`, `Input`, `Button`, `Badge`, `Popover`, `PopoverTrigger`, `PopoverContent`, `Checkbox`, `Label`
- Lucide icons: `Search`, `Star`, `Filter`, `X`
- Utilitário `cn` do shadcn

---

## Layout

```
┌──────────────────────────────────────────────────────────────┐
│  [🔍 Filtrar modelos...        ]   [⚙ Filtros]  [Limpar]    │  ← toolbar
├──────────────────────────────────────────────────────────────┤
│  ★  │  Modelo              │  Tags         │ Contexto│ Preço │  ← table header
│─────┼──────────────────────┼───────────────┼─────────┼───────│
│  ☆  │  Claude Sonnet 4     │ Tools  Agent  │   200K  │ $3/$15│  ← row normal
│  ★  │  GPT-4o Mini         │ Tools         │   128K  │ $0.15 │  ← row favorito (star amarela)
│  ☆  │  Gemini 2.0 Flash    │ Free Tools Ag │   1M    │ Grátis│  ← row selecionada (bg-muted)
│  ★  │  Llama 3.3 70B       │ Free Tools Ag │   128K  │ Grátis│
│  ...│  ...                 │  ...          │   ...   │  ...  │
├──────────────────────────────────────────────────────────────┤
│  12 de 337 modelos                                           │  ← footer count
└──────────────────────────────────────────────────────────────┘
```

---

## Toolbar

Uma linha horizontal com:

1. **Input de busca** — `max-w-sm flex-1`, `h-8`, ícone `Search` dentro, placeholder `"Filtrar modelos..."`. Filtra por nome do modelo (case-insensitive).

2. **Botão "Filtros"** — abre um `Popover` com checkboxes. Quando tem filtros ativos, usa `variant="secondary"` e mostra Badge com contagem.

3. **Botão "Limpar"** — aparece só quando existem filtros ativos. Reseta todos os filtros. `variant="ghost"`, texto `"Limpar"` com ícone `X`.

---

## Popover de Filtros

Padrão do projeto (copiar de ColaboradorLista):

```tsx
<Popover>
  <PopoverTrigger asChild>
    <Button variant={hasFilters ? 'secondary' : 'outline'} size="sm">
      <Filter className="mr-1.5 size-3.5" />
      Filtros
      {hasFilters && (
        <Badge variant="secondary" className="ml-1.5 h-5 min-w-5 px-1.5 text-[10px] font-semibold">
          {filterCount}
        </Badge>
      )}
    </Button>
  </PopoverTrigger>
  <PopoverContent className="w-56" align="start">
    <div className="space-y-3">
      <p className="text-xs font-medium text-muted-foreground">Filtrar por</p>
      {/* Cada filtro é um Checkbox + Label */}
    </div>
  </PopoverContent>
</Popover>
```

**Checkboxes (cumulativos — AND):**

| Checkbox | O que filtra |
|----------|--------------|
| Tool Calling | `model.supports_tools === true` |
| Grátis | `model.is_free === true` |
| Agêntico | `model.is_agentic === true` |
| Favoritos | `favorites.has(model.id)` |

Cada checkbox com `<Checkbox>` + `<Label>` do shadcn. Marcar "Tool Calling" + "Grátis" = mostra só modelos que são grátis **E** têm tool calling. Filtros são cumulativos (AND), não exclusivos.

---

## Tabela

Usar shadcn `Table` real (não divs). Envolvida em `ScrollArea` com `max-h-[400px]`.

### Colunas

| Coluna | Width | Alinhamento | Conteúdo |
|--------|-------|-------------|----------|
| ★ | `w-10` | center | Botão com ícone `Star`. Favorito = `fill-yellow-400 text-yellow-400`. Não-favorito = `text-muted-foreground/30`. Click = toggle favorito (com `stopPropagation`) |
| Modelo | flex (ocupa o resto) | left | `text-sm font-medium` — apenas o nome/label do modelo |
| Tags | `w-[160px]` | left | Badges `variant="outline"` com `text-[10px] whitespace-nowrap`: `Free`, `Tools`, `Agent`. Inline, `flex gap-1 flex-wrap` |
| Contexto | `w-[80px]` | right | `text-xs text-muted-foreground`. Formato: `128K`, `1M`, `200K` |
| Preço | `w-[90px]` | right | `text-xs text-muted-foreground`. Formato: `$3/$15` ou `Grátis` |

### Row behavior

- Click na row inteira = seleciona o modelo (`onChange`)
- Row selecionada: `data-state="selected"` no `TableRow` (shadcn já aplica `bg-muted`)
- Hover: padrão do shadcn (`hover:bg-muted/50`)
- Click na estrela: toggle favorito (não seleciona o modelo)

### Footer

Abaixo da tabela, uma `<p>` com:
```
{filtered.length} de {total.length} modelos
```
`text-[10px] text-muted-foreground`

---

## Dados mock

```tsx
const MOCK_MODELS = [
  { id: 'anthropic/claude-sonnet-4', label: 'Anthropic: Claude Sonnet 4', supports_tools: true, is_free: false, is_agentic: true, context_length: 200000, pricing: { prompt: '3', completion: '15' } },
  { id: 'openai/gpt-4o-mini', label: 'OpenAI: GPT-4o Mini', supports_tools: true, is_free: false, is_agentic: false, context_length: 128000, pricing: { prompt: '0.15', completion: '0.6' } },
  { id: 'google/gemini-2.0-flash-exp:free', label: 'Google: Gemini 2.0 Flash Exp (free)', supports_tools: true, is_free: true, is_agentic: true, context_length: 1048576, pricing: null },
  { id: 'meta-llama/llama-3.3-70b-instruct:free', label: 'Meta: Llama 3.3 70B Instruct (free)', supports_tools: true, is_free: true, is_agentic: true, context_length: 131072, pricing: null },
  { id: 'mistralai/mistral-small-3.1-24b-instruct:free', label: 'Mistral: Small 3.1 24B (free)', supports_tools: true, is_free: true, is_agentic: true, context_length: 131072, pricing: null },
  { id: 'nvidia/nemotron-3-nano-30b-a3b:free', label: 'NVIDIA: Nemotron 3 Nano 30B (free)', supports_tools: true, is_free: true, is_agentic: true, context_length: 262144, pricing: null },
  { id: 'deepseek/deepseek-chat-v3-0324:free', label: 'DeepSeek: V3 0324 (free)', supports_tools: false, is_free: true, is_agentic: false, context_length: 131072, pricing: null },
  { id: 'anthropic/claude-opus-4', label: 'Anthropic: Claude Opus 4', supports_tools: true, is_free: false, is_agentic: true, context_length: 200000, pricing: { prompt: '15', completion: '75' } },
  { id: 'openai/gpt-4.1', label: 'OpenAI: GPT-4.1', supports_tools: true, is_free: false, is_agentic: true, context_length: 1047576, pricing: { prompt: '2', completion: '8' } },
  { id: 'google/gemini-2.5-pro-preview', label: 'Google: Gemini 2.5 Pro Preview', supports_tools: true, is_free: false, is_agentic: true, context_length: 1048576, pricing: { prompt: '1.25', completion: '10' } },
  { id: 'qwen/qwen3-235b-a22b:free', label: 'Qwen: Qwen3 235B (free)', supports_tools: true, is_free: true, is_agentic: false, context_length: 40960, pricing: null },
  { id: 'cohere/command-r-plus', label: 'Cohere: Command R+', supports_tools: true, is_free: false, is_agentic: false, context_length: 128000, pricing: { prompt: '2.5', completion: '10' } },
]

const MOCK_FAVORITES = ['anthropic/claude-sonnet-4', 'meta-llama/llama-3.3-70b-instruct:free']
const MOCK_SELECTED = 'anthropic/claude-sonnet-4'
```

---

## Props (interface)

```tsx
interface IaModelCatalogPickerProps {
  models: IaModelCatalogItem[]
  value: string                          // model id selecionado
  favorites: string[]                    // array de model ids favoritados
  onChange: (modelId: string) => void     // selecionar modelo
  onToggleFavorite: (modelId: string) => void  // toggle favorito
}
```

---

## Regras visuais

- Dark mode (`bg-background`, `text-foreground` — padrão shadcn)
- Sem botão "Refresh" — o catálogo carrega automaticamente
- Sem footer "Modelo selecionado: ..." — ruído visual
- Badges `variant="outline"` (não `secondary` — mais leve visualmente)
- Rows compactas — padding padrão do shadcn Table, nada extra
- ScrollArea com `max-h-[400px]` — tem que rolar quando passa de ~10 modelos
- Input de busca `max-w-sm` (não full-width — alinha com o pattern do projeto)
