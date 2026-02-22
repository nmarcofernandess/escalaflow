# 🐛 FIX: IA Tool Calls UI - Collapsible Quebrado

**Contexto:** Sou desenvolvedor do **EscalaFlow**, um app desktop Electron com chat IA integrado (Gemini via Vercel AI SDK). O componente de tool calls está **quebrado** — não mostra args/output corretamente e pode estar quebrando o layout.

---

## 📋 STACK TÉCNICA

- **Shell:** Electron 34
- **Frontend:** React 19 + Vite + Tailwind CSS
- **UI Library:** shadcn/ui (24 components instalados)
- **IA SDK:** Vercel AI SDK (`ai` package) com Gemini
- **State:** Zustand
- **Tipos:** TypeScript strict

---

## 🚨 PROBLEMAS IDENTIFICADOS

### 1. **Botão "Ver output" NÃO RENDERIZA** ❌
Criei um `<Button>` com ícone `<Eye>` para expandir o output de cada tool call, mas **não aparece na UI**.

Código do componente:
```tsx
// src/renderer/src/componentes/IaToolCallsCollapsible.tsx

{/* Botão Ver Output */}
{call.result && (
  <div className="pl-6">
    <Button
      variant="ghost"
      size="sm"
      onClick={() => toggleOutput(call.id)}
      className="h-7 text-xs gap-1.5 hover:bg-muted"
    >
      <Eye className="size-3" />
      {outputExpanded ? 'Ocultar output' : 'Ver output'}
    </Button>

    {outputExpanded && (
      <pre className={`mt-2 p-2 rounded text-[10px] overflow-x-auto max-h-96 overflow-y-auto ${
        hasError ? 'bg-destructive/10 text-destructive' : 'bg-muted/50'
      }`}>
        {JSON.stringify(call.result, null, 2)}
      </pre>
    )}
  </div>
)}
```

**Resultado:** Só aparece `🔍 get_context ✅ OK` sem o botão.

---

### 2. **Argumentos NÃO APARECEM** ❌
Mesmo quando `call.args` existe (ex: `{}`), a seção "Argumentos:" não renderiza.

Código:
```tsx
{/* Args (sempre visível se existir) */}
{call.args && Object.keys(call.args).length > 0 && (
  <div className="pl-6">
    <div className="text-[10px] text-muted-foreground font-medium mb-1">Argumentos:</div>
    <pre className="p-2 bg-muted/50 rounded text-[10px] overflow-x-auto">
      {JSON.stringify(call.args, null, 2)}
    </pre>
  </div>
)}
```

**Resultado:** Mesmo com `call.args = {}`, não mostra nada.

---

### 3. **Layout QUEBRA com JSONs Grandes** 💥
Quando `call.result` é um JSON gigante (ex: `get_context` retorna 100+ colaboradores), ele **quebra o layout da sidebar** ao invés de scroll.

**Comportamento esperado:** Sidebar fixa à direita, JSON com scroll interno.

**Comportamento atual:** Sidebar estoura/quebra o layout.

---

### 4. **"JSON Fantasma" Pode Estar Aparecendo** 👻
Suspeita de que algum JSON está sendo injetado na UI causando quebra visual.

---

### 5. **Múltiplas Tools Aparecem MAS Sem Detalhes** ⚠️
Consigo ver "6 ferramentas utilizadas" listadas, mas **nenhuma** mostra args ou botão de output.

Screenshot do problema:
- ✅ Collapsible abre/fecha
- ✅ Lista tools (get_context, consultar, consultar...)
- ✅ Badge OK/Erro aparece
- ❌ **Argumentos NÃO aparecem**
- ❌ **Botão "Ver output" NÃO aparece**

---

## 🎯 OBJETIVO

Consertar o `IaToolCallsCollapsible.tsx` para:

1. ✅ Mostrar **Argumentos** quando existirem (mesmo se `{}`)
2. ✅ Mostrar **Botão "Ver output"** clicável
3. ✅ Expandir/colapsar output ao clicar
4. ✅ **Scroll interno** no JSON (não quebrar layout)
5. ✅ **Max-height** no output (ex: 400px) com scroll-y
6. ✅ Sidebar **sempre fixa** (não quebra com conteúdo grande)

---

## 📚 REFERÊNCIAS EXTERNAS

### 1. **Auto-Claude do @marcofernandes**
O projeto `auto-claude` (pasta `~/.claude/` do Marco) tem um painel IA similar que **funciona perfeitamente**. Pode ter patterns úteis de:
- Como renderizar tool calls com collapsible
- Como lidar com JSONs grandes
- Scroll interno sem quebrar layout

### 2. **Vercel AI SDK Docs - Tool Calling UI**
Buscar na internet por:
- "Vercel AI SDK tool calling UI React"
- "shadcn/ui collapsible tool calls"
- "Next.js AI chatbot tool results component"

Deve ter exemplos de como renderizar `result.steps` com `toolCalls` e `toolResults`.

### 3. **Shadcn/ui Patterns**
Verificar se tem algum pattern oficial de:
- Collapsible com dados dinâmicos
- Code blocks com scroll
- Sidebar com overflow-y-auto

---

## 🔍 DEBUG CHECKLIST

Antes de corrigir, verificar:

1. **`call.result` está definido?** (console.log no componente)
2. **`call.args` está definido?** (mesmo vazio deveria ser `{}`)
3. **O state `expandedOutputs` está funcionando?**
4. **shadcn/ui Button está importado corretamente?**
5. **Há conflito de z-index ou overflow no pai?**

---

## 📁 ARQUIVOS RELEVANTES

```
src/renderer/src/componentes/
├── IaToolCallsCollapsible.tsx  ← COMPONENTE QUEBRADO
├── IaChatView.tsx              ← Usa o collapsible
└── IaMensagemBubble.tsx        ← Renderiza mensagens

src/renderer/src/components/ui/
├── collapsible.tsx             ← shadcn/ui Collapsible
├── button.tsx                  ← shadcn/ui Button
└── card.tsx                    ← shadcn/ui Card

src/shared/types.ts             ← Interface ToolCall
```

**Interface `ToolCall`:**
```typescript
export interface ToolCall {
  id: string
  name: string
  args: Record<string, any>
  result: any
}
```

---

## 🎨 UX DESEJADA

```
🔧 1 ferramenta utilizada  [↓]  ← Collapsible (expansível)

   (expandido)

   🔍 get_context ✅ OK

   Argumentos:
   {}

   [👁️ Ver output]  ← BOTÃO CLICÁVEL

   (clicado)

   {
     "setores": [...],      ← JSON com scroll
     "colaboradores": [...] ← max-height: 400px
   }
```

---

## 🚀 TAREFA

1. **Diagnosticar** por que args e botão não renderizam
2. **Corrigir** o componente `IaToolCallsCollapsible.tsx`
3. **Garantir** scroll interno (não quebrar sidebar)
4. **Testar** com JSON gigante (100+ linhas)
5. **Validar** UX final conforme mockup acima

---

## 📝 NOTAS IMPORTANTES

- **Não mudar** a lógica de salvamento no banco (já funciona)
- **Não mexer** no backend (cliente.ts, tools.ts) — problema é só UI
- **Manter** shadcn/ui components (Collapsible, Button, Card)
- **Preservar** dark mode e classes Tailwind
- **Garantir** TypeScript strict (0 erros)

---

**Boa sorte! 🔧**
