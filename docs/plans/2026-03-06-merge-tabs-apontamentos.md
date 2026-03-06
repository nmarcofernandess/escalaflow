# Merge Tabs: Escala + Apontamentos — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reduzir EscalaPagina de 3 tabs para 2 (Escala + Apontamentos), eliminando duplicacao de violacoes.

**Architecture:** Refactor puro de UI em um unico arquivo (EscalaPagina.tsx). Reordena tabs, renomeia, move ViolacoesAgrupadas pro Apontamentos, simplifica coluna Avisos na tabela para contagem com icones.

**Tech Stack:** React, shadcn/ui Tabs, Lucide icons

**Design doc:** `docs/plans/2026-03-06-merge-tabs-apontamentos-design.md`

---

### Task 1: ResumoTable — coluna Avisos de texto para contagem

**Files:**
- Modify: `src/renderer/src/paginas/EscalaPagina.tsx:62-170` (ResumoTable component)

**Step 1: Trocar a coluna Avisos de texto completo para contagem com icones**

Na ResumoTable, linhas 141-163, substituir o bloco que renderiza texto completo das violacoes por contagem:

```tsx
<TableCell className="py-2">
  {(() => {
    const hardCount = colabV.filter(v => v.severidade === 'HARD').length
    const softCount = colabV.filter(v => v.severidade !== 'HARD').length
    const abaixoMeta = !ok

    if (hardCount === 0 && softCount === 0 && !abaixoMeta) {
      return <span className="text-[11px] text-muted-foreground">—</span>
    }

    return (
      <div className="flex items-center gap-2">
        {hardCount > 0 && (
          <span className="flex items-center gap-0.5 text-[11px] font-medium text-destructive">
            <XCircle className="size-3" />
            {hardCount}
          </span>
        )}
        {softCount > 0 && (
          <span className="flex items-center gap-0.5 text-[11px] font-medium text-amber-600 dark:text-amber-400">
            <AlertTriangle className="size-3" />
            {softCount}
          </span>
        )}
        {abaixoMeta && hardCount === 0 && softCount === 0 && (
          <span className="text-[11px] text-amber-600 dark:text-amber-400">Abaixo da meta</span>
        )}
      </div>
    )
  })()}
</TableCell>
```

Adicionar imports de `XCircle` e `AlertTriangle` do lucide-react (linha 4).

**Step 2: Verificar typecheck**

Run: `npm run typecheck`
Expected: 0 errors

**Step 3: Commit**

```bash
git add src/renderer/src/paginas/EscalaPagina.tsx
git commit -m "refactor: ResumoTable avisos column — text to count icons"
```

---

### Task 2: Reordenar e renomear tabs (3 -> 2)

**Files:**
- Modify: `src/renderer/src/paginas/EscalaPagina.tsx:604-844`

**Step 1: Mudar defaultValue e reordenar TabsList**

Linha 604 — mudar `defaultValue="resumo"` para `defaultValue="escala"`:

```tsx
<Tabs defaultValue="escala" className="space-y-4">
  <TabsList>
    <TabsTrigger value="escala">Escala</TabsTrigger>
    <TabsTrigger value="apontamentos" className="gap-1.5">
      Apontamentos
      {violacoesCount > 0 && (
        <Badge variant="secondary" className="ml-1 size-5 justify-center rounded-full p-0 text-[10px]">
          {violacoesCount}
        </Badge>
      )}
    </TabsTrigger>
  </TabsList>
```

**Step 2: Renomear TabsContent "resumo" para "apontamentos" e adicionar ViolacoesAgrupadas**

O bloco `<TabsContent value="resumo">` (linhas 618-671) vira:

```tsx
<TabsContent value="apontamentos" className="space-y-4">
  {/* Card KPIs — identico */}
  <Card>
    <CardHeader className="pb-2">
      <CardTitle className="text-base font-semibold">Resumo da escala</CardTitle>
      <p className="text-xs text-muted-foreground">
        Visao geral dos indicadores desta escala.
      </p>
    </CardHeader>
    <CardContent className="space-y-3">
      {/* ... KPIs identicos ... */}
    </CardContent>
  </Card>

  <div>
    <h3 className="text-sm font-semibold text-foreground mb-2">Por colaborador</h3>
    <ResumoTable ... />
  </div>

  {/* ViolacoesAgrupadas — movido da aba Avisos */}
  {escalaCompleta.violacoes.length > 0 && (
    <ViolacoesAgrupadas violacoes={escalaCompleta.violacoes} />
  )}
</TabsContent>
```

**Step 3: Deletar TabsContent "avisos" inteiro (linhas 833-843)**

Remover o bloco:
```tsx
<TabsContent value="avisos" className="space-y-4">
  ...
</TabsContent>
```

**Step 4: Remover toggle "Avisos" da aba Escala**

Na aba Escala (CardContent com grid de toggles, linhas 681-710), deletar o 4to toggle (linhas 701-709):
```tsx
// DELETAR este bloco:
<div className="flex items-start justify-between rounded-md border p-3">
  <div>
    <p className="text-sm font-medium">Avisos</p>
    ...
  </div>
  <Switch checked={conteudoView.avisos} ... />
</div>
```

Mudar o grid de `sm:grid-cols-2` para `sm:grid-cols-3` (3 toggles restantes cabem melhor).

**Step 5: Remover bloco condicional ViolacoesAgrupadas da aba Escala**

Deletar o bloco condicional `{conteudoView.avisos && !conteudoView.timeline && (` (linhas 812-830).

**Step 6: Verificar typecheck**

Run: `npm run typecheck`
Expected: 0 errors

**Step 7: Commit**

```bash
git add src/renderer/src/paginas/EscalaPagina.tsx
git commit -m "refactor: merge 3 tabs into 2 (Escala + Apontamentos)"
```

---

### Task 3: Limpeza de estado morto

**Files:**
- Modify: `src/renderer/src/paginas/EscalaPagina.tsx`

**Step 1: Limpar conteudoView.avisos**

O campo `avisos` em `conteudoView` e `conteudoExport` nao e mais toggleavel pela UI da aba Escala. Verificar se o ExportModal ainda usa — se sim, manter no state mas nao no grid de toggles. Se nao, remover do state.

Checando: `ExportModal` recebe `conteudoExport` e tem toggle proprio de avisos no modal de export. Logo **manter no state** (export ainda usa), so removeu do grid de visualizacao.

Resultado: nenhuma mudanca de codigo neste step — so confirmar que `conteudoExport.avisos` continua funcional no ExportModal.

**Step 2: Verificar typecheck final**

Run: `npm run typecheck`
Expected: 0 errors

**Step 3: Teste visual**

Run: `npm run dev`
Verificar:
- Tab Escala aparece primeiro e esta selecionada por default
- Tab Apontamentos aparece com badge de contagem
- Apontamentos mostra: Card KPIs + Tabela (com contagem) + ViolacoesAgrupadas
- Aba Escala tem 3 toggles (Ciclo, Timeline, Funcionarios) — sem Avisos
- ExportModal ainda funciona com toggle de Avisos

**Step 4: Commit final**

```bash
git add -A
git commit -m "refactor: cleanup after tab merge — verify export still works"
```
