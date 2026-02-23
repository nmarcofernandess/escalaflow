# SPEC: Revisao Pos-Geracao pela IA

## Problema

A tool `gerar_escala` retorna `indicadores` + `diagnostico`, mas descarta `comparacao_demanda` e `decisoes` que o solver Python ja calcula. Sem esses dados, a IA nao consegue dizer "onde" esta o problema, so que "existe" problema.

## Solucao

Enriquecer o retorno de `gerar_escala` com um campo `revisao` que agrega os dados ja disponíveis no `solverResult`.

## Mudanca unica: `tools.ts` — handler `gerar_escala`

Apos `persistirSolverResult`, ANTES do `toolOk`, montar:

```typescript
// Agregar top deficits (slots com pior cobertura)
const deficits = (solverResult.comparacao_demanda ?? [])
    .filter(s => s.delta < 0)
    .sort((a, b) => a.delta - b.delta)
    .slice(0, 10)
    .map(s => ({
        data: s.data,
        faixa: `${s.hora_inicio}-${s.hora_fim}`,
        faltam: Math.abs(s.delta),
        tem: s.executado,
        precisa: s.planejado,
    }))

// Agregar carga por colaborador (horas e dias trabalhados)
const alocacoes = solverResult.alocacoes ?? []
const cargaPorColab: Record<number, { nome: string; dias: number; minutos: number }> = {}
for (const a of alocacoes) {
    if (a.status !== 'TRABALHO') continue
    if (!cargaPorColab[a.colaborador_id]) {
        // nome vem das decisoes
        const dec = (solverResult.decisoes ?? []).find(d => d.colaborador_id === a.colaborador_id)
        cargaPorColab[a.colaborador_id] = {
            nome: dec?.colaborador_nome ?? `#${a.colaborador_id}`,
            dias: 0,
            minutos: 0,
        }
    }
    cargaPorColab[a.colaborador_id].dias++
    cargaPorColab[a.colaborador_id].minutos += a.minutos_trabalho
}
const carga = Object.values(cargaPorColab).map(c => ({
    ...c,
    horas: +(c.minutos / 60).toFixed(1),
}))

const revisao = {
    piores_deficits: deficits,
    carga_colaboradores: carga,
    total_alocacoes: alocacoes.length,
    dias_periodo: new Set(alocacoes.map(a => a.data)).size,
}
```

Depois, incluir `revisao` no `toolOk`:

```typescript
return toolOk(
  {
    sucesso: true,
    escala_id: escalaId,
    solver_status: solverResult.status,
    indicadores: solverResult.indicadores,
    violacoes_hard: solverResult.indicadores.violacoes_hard,
    violacoes_soft: solverResult.indicadores.violacoes_soft,
    cobertura_percent: solverResult.indicadores.cobertura_percent,
    pontuacao: solverResult.indicadores.pontuacao,
    diagnostico: solverResult.diagnostico,
    revisao, // <-- NOVO
  },
  { summary: `...`, meta: { ... } }
)
```

## O que a IA ganha

Com `revisao`, a IA pode:

1. **Identificar gargalos**: "Terca 10h-14h faltam 2 pessoas"
2. **Detectar desequilibrio**: "Joao trabalha 28h, Maria trabalha 18h"
3. **Sugerir ajustes concretos**: "Trocar folga do Joao de quinta pra terca resolve o deficit"
4. **Executar se aprovado**: `ajustar_alocacao` x2 (quinta→TRABALHO, terca→FOLGA)

## O que NAO muda

- Motor Python (solver_ortools.py) — ja retorna tudo
- Frontend — IA opera pelo chat, zero mudanca
- Outras tools — nenhuma afetada
- Schema Zod da tool — sem parametros novos (dados vem do resultado)

## System prompt: adicionar instrucao

Adicionar ao system prompt, na secao de workflow:

```
## Apos gerar escala
Quando `gerar_escala` retornar, analise o campo `revisao`:
- Se `piores_deficits` nao esta vazio: informe quais faixas tem falta de cobertura
- Se `carga_colaboradores` mostra desequilibrio: aponte quem esta sobrecarregado
- Sugira ajustes concretos e peca confirmacao antes de executar
- Use `ajustar_alocacao` para aplicar trocas aprovadas pelo usuario
```

## Estimativa

- **Mudanca de codigo**: ~30 linhas em `tools.ts`
- **Mudanca de prompt**: ~5 linhas
- **Risco**: Zero (dados ja existem, so nao eram repassados)
