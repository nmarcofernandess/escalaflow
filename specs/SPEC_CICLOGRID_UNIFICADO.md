# SPEC — CicloGrid Unificado (C2+C3+C4+C5+C6+C8)

> Aprovado: 2026-03-14
> Prototipo: `specs/prototipos/ciclo-grid-final.html`
> Decisoes: `memory/design_ciclogrid_unificado.md`

---

## TL;DR

Criar 1 componente `CicloGrid` que substitui `EscalaCicloResumo` + `SimuladorCicloGrid` + `CicloViewToggle`. View unica com scroll horizontal. Preflight na UI. Area de avisos. Sheet bottom pra sugestao. Migrar todos os consumidores.

---

## Escopo

| Task | O que | Tipo |
|------|-------|------|
| C2 | Preflight itens minimos visivel SEMPRE (nao so no empty state) | Feature |
| C3 | CicloGrid componente unico com view unificada | Feature |
| C4 | Siglas padrao T/FF/FV/DT/DF/I em todos os lugares | Fix |
| C5 | COBERTURA/DEMANDA como X/Y em 1 linha | Feature |
| C6 | Area de avisos separada com header + botao sugestao | Feature |
| C8 | Matar SimuladorCicloGrid.tsx e CicloViewToggle.tsx | Cleanup |

---

## CicloGrid — Componente

### Props

```typescript
interface CicloGridRow {
  id: number                       // colaborador_id ou row index
  nome: string                     // nome do colaborador
  posto: string                    // apelido do posto (ou "(sem titular)")
  variavel: DiaSemana | null       // folga variavel atual
  fixa: DiaSemana | null           // folga fixa atual
  blocked: boolean                 // dropdown F/V desabilitado
  semanas: Simbolo[][]             // [semana][dia] = 'T'|'FF'|'FV'|'DT'|'DF'|'I'|'.'|'-'
}

interface CicloGridData {
  rows: CicloGridRow[]
  cobertura: number[][]            // [semana][dia] = quantas pessoas trabalham
  demanda: number[]                // [dia_seg_a_dom] = min_pessoas por dia
  cicloSemanas: number             // periodo do ciclo (pra linha roxa)
}

interface CicloGridProps {
  data: CicloGridData
  mode: 'edit' | 'view'           // edit = dropdowns F/V, view = read-only
  onFolgaChange?: (colaboradorId: number, field: 'folga_fixa_dia_semana' | 'folga_variavel_dia_semana', value: DiaSemana | null) => void
  className?: string
}
```

### Layout (view unificada)

```
Sticky (222px):                    Scrollavel:
[Nome+Posto] [Var] [Fixo] |  [S1 STQQSSD] [S2 STQQSSD] [S3...]
                           |
Header linha 1: sem fundo, "Ciclo de N semanas" + S1 S2 S3...
Header linha 2: com fundo, Var Fixo S T Q Q S S D (repete)

Ultima linha: COBERTURA X/Y (cobertura/demanda) — verde se ok, vermelho se deficit
```

- Nome em cima, Posto embaixo (empilhados)
- Var/Fixo como dropdowns `<Select>` em mode='edit', texto em mode='view'
- Sticky cols: opaque background (bg-background)
- Divisorias entre semanas: `border-left` em toda a coluna (incluindo COBERTURA)
- Linha roxa: `border-right: 2px purple` na ultima coluna do ciclo
- Legenda embaixo: T FF FV DT DF I + fim do ciclo + deficit

### Siglas padrao (C4)

| Simbolo | Cor | Classe |
|---------|-----|--------|
| T | verde success/10 | Trabalho |
| FF | slate | Folga fixa |
| FV | warning/10 | Folga variavel |
| DT | warning/10 + ring | Dom trabalhado |
| DF | blue/10 + ring | Dom folga |
| I | rose/10 | Indisponivel |
| . | muted | Sem alocacao |
| - | muted | Sem titular |

### COBERTURA X/Y (C5)

```
COBERTURA  3/4  4/4  4/4  3/4  4/4  5/4  2/2
           def  ok   ok   def  ok   ok
```

- Formato: `{cobertura}/{demanda}`
- Verde (`text-success`) se cobertura >= demanda
- Vermelho (`text-destructive`) se deficit
- `/` em muted, font-size menor

---

## Preflight (C2)

`PrecondicaoItem` ja existe no SetorDetalhe mas so aparece no empty state. Mudanca:

- Preflight aparece SEMPRE que faltam dados, ACIMA do grid
- Mesmo que o preview esteja visivel, se falta 1 item, preflight aparece
- Condicionais: empresa, tiposContrato, colaboradores ativos, demandas
- Links clicaveis pra resolver cada item

---

## Area de Avisos (C6)

```
[Avisos (3)]                    [Pedir sugestao]  ← btn-outline btn-sm
  ⚠ Segunda: cobertura insuficiente
  ⚠ Quinta: cobertura insuficiente
  ℹ Robert sem folga variavel
```

- Header: "Avisos (N)" esquerda + botao sugestao direita
- Cada aviso: icone Lucide (AlertTriangle/Info) + titulo + descricao
- Botao "Pedir sugestao" abre Sheet bottom (C7 — implementacao futura, por enquanto so o layout)

---

## Conversores

Dois conversores transformam dados existentes em `CicloGridData`:

### 1. EscalaCompleta → CicloGridData

```typescript
function escalaParaCicloGrid(
  escala: Escala,
  alocacoes: Alocacao[],
  colaboradores: Colaborador[],
  funcoes: Funcao[],
  regrasPadrao: RegraHorarioColaborador[],
  demandas: Demanda[],
): CicloGridData
```

Usado em: SetorDetalhe (pos-solver), EscalaPagina, EscalasHub, ExportarEscala.

### 2. SimulaCicloOutput → CicloGridData

```typescript
function simulacaoParaCicloGrid(
  output: SimulaCicloOutput,
  labels?: string[],
  demandaPorDia?: number[],
): CicloGridData
```

Usado em: SimulaCicloPagina (brinquedo Dashboard).

### 3. PreviewNivel1 → CicloGridData

Mesma funcao do conversor 1 (previewNivel1 ja gera Escala + Alocacao[]).

---

## Migracoes

| Arquivo | Antes | Depois |
|---------|-------|--------|
| SetorDetalhe.tsx | EscalaCicloResumo + SimuladorCicloGrid + CicloViewToggle | CicloGrid |
| EscalaPagina.tsx | EscalaCicloResumo | CicloGrid mode='view' |
| EscalasHub.tsx | EscalaCicloResumo | CicloGrid mode='view' |
| ExportarEscala.tsx | EscalaCicloResumo mostrarTodasSemanas | CicloGrid mode='view' (print) |
| SimulaCicloPagina.tsx | SimuladorCicloGrid | CicloGrid mode='edit' |

---

## Componentes a matar (C8)

- `src/renderer/src/componentes/SimuladorCicloGrid.tsx` (373 linhas)
- `src/renderer/src/componentes/CicloViewToggle.tsx` (61 linhas)
- `src/renderer/src/componentes/EscalaCicloResumo.tsx` (747 linhas) — substituido por CicloGrid

---

## Fontes (shadcn hierarchy)

| Elemento | Tamanho |
|----------|---------|
| Table base | text-sm (14px) |
| Headers (dias) | text-xs (12px) |
| Nome colaborador | 13px |
| Posto subtitle | text-xs (12px) - muted |
| Siglas | text-xs (12px) |
| COBERTURA X/Y | text-xs (12px) bold |
| Botoes default | h-9 text-sm |
| Botoes sm | h-8 text-xs |

---

## Nao incluido nesta spec

- C7 (Sheet bottom de sugestao) — layout do Sheet pronto no prototipo, logica depende de decisao de backend
- C9 (Matar converterNivel1ParaEscala) — depende de A3 derivados
- gerarHTMLFuncionario — siglas [F]/(V) serao corrigidas mas o componente continua separado (export HTML)
- EscalaGrid — componente diferente, nao unifica

---

## Criterios de sucesso

- [ ] `npm run typecheck` passa com 0 erros
- [ ] CicloGrid renderiza em todas as 5 paginas consumidoras
- [ ] Siglas uniformes T/FF/FV/DT/DF/I em grid E legenda
- [ ] Scroll horizontal funciona com sticky cols opacos
- [ ] COBERTURA X/Y com deficit vermelho
- [ ] Preflight aparece SEMPRE que faltam dados (nao so no empty state)
- [ ] Area de avisos com header + botao sugestao (botao nao faz nada ainda)
- [ ] Legenda com "Fim do ciclo" (linha roxa)
- [ ] Dark mode funciona
- [ ] Print/export funciona (print-colors class)
- [ ] SimuladorCicloGrid.tsx deletado
- [ ] CicloViewToggle.tsx deletado
- [ ] EscalaCicloResumo.tsx deletado
- [ ] 0 imports residuais dos componentes mortos
