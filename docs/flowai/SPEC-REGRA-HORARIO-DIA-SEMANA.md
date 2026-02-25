# SPEC — Regras de Horário por Dia da Semana (Colaborador)

> Status: RASCUNHO | Autor: Miss Monday | Data: 2026-02-24

---

## TL;DR EXECUTIVO

O sistema atual permite definir **uma única regra de horário** por colaborador, que se aplica a **todos os dias da semana**. Isso impossibilita expressar "Cleunice entra toda quarta às 09:00 (mas nos outros dias usa a janela padrão do setor)".

A solução é **adicionar `dia_semana_regra` à tabela `colaborador_regra_horario`** e ajustar o constraint de unicidade para suportar múltiplas regras por colaborador — uma por dia específico + uma "padrão" que age como fallback.

---

## PROBLEMA CENTRAL

```
Estado atual:
  colaborador_regra_horario
    UNIQUE(colaborador_id)  ← apenas 1 regra por pessoa

Quando o motor roda:
  bridge itera cada (colaborador, data) e aplica:
    regra? → mesma regra, todo dia da semana

Efeito colateral:
  "Cleunice entra às 09:00" → aplica QUA, SEG, SEX, etc.
  Não tem como dizer "só quarta".
```

---

## FUNCIONALIDADES

### F1 — Regra de horário por dia específico da semana

**O que faz:** Permite criar até 7 regras de horário por colaborador — uma para cada dia da semana — além de uma regra "padrão" (sem dia específico, aplicada como fallback.

**Quando ativa:** Ao gerar escala, o bridge resolve a regra efetiva para cada (colaborador, data) usando precedência adequada.

**Input → Output:**
- Input: `{ colaborador_id: 5, dia_semana_regra: 'QUA', inicio_min: '09:00', inicio_max: '09:00' }`
- Output: Toda quarta do período, Cleunice entra às 09:00. Outros dias usam o fallback (regra padrão ou setor).

---

### F2 — Regra padrão por colaborador (sem dia específico)

**O que faz:** A regra com `dia_semana_regra = NULL` continua funcionando como "aplica todos os dias" — é o fallback quando não existe uma regra para o dia específico.

**Quando ativa:** Sempre que não existe regra de dia específico para um colaborador em determinado dia.

**Retrocompatibilidade:** Todas as regras existentes (`dia_semana_regra = NULL`) continuam funcionando sem mudança.

---

## REGRAS DE NEGÓCIO

- ✅ **PODE:** Ter uma regra `dia_semana_regra = NULL` (padrão) + N regras de dias específicos por colaborador
- ✅ **PODE:** Ter apenas regra padrão (sem nenhum dia específico) — comportamento atual
- ✅ **PODE:** Ter apenas regras de dias específicos (sem padrão) — dias sem regra específica usam perfil do contrato/setor
- ❌ **NÃO PODE:** Ter duas regras padrão (NULL) para o mesmo colaborador
- ❌ **NÃO PODE:** Ter duas regras 'QUA' para o mesmo colaborador
- 🔄 **SEMPRE:** A precedência de resolução é: `excecao_data > regra_dia_especifico > regra_padrao > perfil_contrato > setor/empresa`
- 🔀 **SE** `dia_semana_regra = 'QUA'` **ENTÃO** só aplica às quartas-feiras
- 🔀 **SE** `dia_semana_regra = NULL` **ENTÃO** aplica a todos os dias que não têm regra específica

---

## JORNADA DO USUÁRIO

### Via IA (Chat RH)

1. **Usuário** diz: "Cleunice entra toda quarta às 09:00" → **IA** chama `salvar_regra_horario_colaborador` com `dia_semana_regra='QUA'`, `inicio_min='09:00'`, `inicio_max='09:00'`
2. **IA** confirma: "Configurado! Toda quarta Cleunice entra às 09:00 exatas."
3. **Usuário** gera escala → **Motor** aplica constraint de 09:00 para cada quarta

### Via UI (ColaboradorDetalhe)

1. **Usuário** abre detalhe do colaborador → **Vê** seção "Regras de Horário" com lista de regras (padrão + por dia)
2. **Usuário** clica "+" para adicionar → **Dialog** abre com campos dia_semana (dropdown) + janela horário
3. **Usuário** seleciona "Quarta" e preenche 09:00 → 09:00 → **Salva**
4. **Lista** atualiza mostrando a regra específica para Quarta

---

## CASOS PRÁTICOS

### Caso 1 — "Cleunice entra toda quarta às 09:00"
```
Antes: impossível (a regra se aplicaria a todos os dias)
Depois: salvar_regra_horario_colaborador { dia_semana_regra: 'QUA', inicio_min: '09:00', inicio_max: '09:00' }
Motor: quarta → 09:00 exato | outros dias → janela padrão do setor
```

### Caso 2 — "João tem horário diferente todo final de semana"
```
Regra padrão: { dia_semana_regra: NULL, inicio_min: '08:00', inicio_max: '10:00' }
Regra sábado: { dia_semana_regra: 'SAB', inicio_min: '09:00', inicio_max: '09:00' }
Regra domingo: { dia_semana_regra: 'DOM', inicio_min: '10:00', inicio_max: '10:00' }
Motor: SAB → 09:00 | DOM → 10:00 | outros dias → 08:00-10:00
```

### Caso 3 — Retrocompatibilidade (regras existentes)
```
Maria tem { dia_semana_regra: NULL, inicio_min: '08:00', inicio_max: '09:00' }
Sem mudança → continua aplicando a todos os dias (comportamento atual preservado)
```

---

## PLANO DE IMPLEMENTAÇÃO

### Fase 1 — Schema DB

**Arquivo:** `src/main/db/schema.ts`

```sql
-- Adicionar DDL_V8_REGRA_DIA_SEMANA ao final do schema

-- 1. Adicionar coluna
ALTER TABLE colaborador_regra_horario
  ADD COLUMN IF NOT EXISTS dia_semana_regra TEXT
  CHECK (dia_semana_regra IN ('SEG','TER','QUA','QUI','SEX','SAB','DOM') OR dia_semana_regra IS NULL)
  DEFAULT NULL;

-- 2. Remover UNIQUE(colaborador_id) antigo e criar dois novos:
--    a) Partial index para regra padrão (NULL): só pode ter 1 por colaborador
--    b) Unique composto para regras de dias específicos
ALTER TABLE colaborador_regra_horario DROP CONSTRAINT IF EXISTS colaborador_regra_horario_colaborador_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_crh_colab_padrao
  ON colaborador_regra_horario (colaborador_id) WHERE dia_semana_regra IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_crh_colab_dia
  ON colaborador_regra_horario (colaborador_id, dia_semana_regra) WHERE dia_semana_regra IS NOT NULL;
```

**Por que dois índices?** PostgreSQL trata NULL != NULL no UNIQUE normal, então sem partial index seria possível criar duas regras padrão para o mesmo colaborador. O partial index garante máximo 1 linha com `dia_semana_regra IS NULL` por colaborador.

---

### Fase 2 — TypeScript (types.ts)

**Arquivo:** `src/shared/types.ts`

```typescript
// Interface RegraHorarioColaborador: adicionar campo
export interface RegraHorarioColaborador {
  id: number
  colaborador_id: number
  ativo: boolean
  dia_semana_regra: DiaSemana | null   // ← NOVO: null = padrão (todos dias)
  perfil_horario_id: number | null
  inicio_min: string | null
  inicio_max: string | null
  fim_min: string | null
  fim_max: string | null
  preferencia_turno_soft: Turno | null
  domingo_ciclo_trabalho: number
  domingo_ciclo_folga: number
  folga_fixa_dia_semana: DiaSemana | null
}
```

---

### Fase 3 — Bridge (solver-bridge.ts)

**Arquivo:** `src/main/motor/solver-bridge.ts`

**3a. Query:** Buscar TODAS as regras do colaborador (não apenas 1):

```typescript
// ANTES (busca 1 regra por colaborador):
const regraRows = await queryAll<...>(`
  SELECT crh.*, cph.inicio_min as p_inicio_min, ...
  FROM colaborador_regra_horario crh
  LEFT JOIN contrato_perfis_horario cph ON crh.perfil_horario_id = cph.id
  WHERE crh.colaborador_id IN (...)
`)
const regraByColab = new Map(regraRows.map(r => [r.colaborador_id, r]))

// DEPOIS (busca todas as regras, agrupa por colaborador):
const regraRows = await queryAll<...>(`
  SELECT crh.*, cph.inicio_min as p_inicio_min, ...
  FROM colaborador_regra_horario crh
  LEFT JOIN contrato_perfis_horario cph ON crh.perfil_horario_id = cph.id
  WHERE crh.colaborador_id IN (...)
  ORDER BY crh.colaborador_id, crh.dia_semana_regra NULLS LAST
`)
// Map: colaborador_id → { padrao: regra|null, dias: Map<DiaSemana, regra> }
const regrasByColab = new Map<number, { padrao: RegraRow | null; dias: Map<string, RegraRow> }>()
for (const row of regraRows) {
  if (!regrasByColab.has(row.colaborador_id)) {
    regrasByColab.set(row.colaborador_id, { padrao: null, dias: new Map() })
  }
  const entry = regrasByColab.get(row.colaborador_id)!
  if (row.dia_semana_regra === null) {
    entry.padrao = row
  } else {
    entry.dias.set(row.dia_semana_regra, row)
  }
}
```

**3b. Resolução:** Aplicar precedência dia-específico > padrão:

```typescript
// No loop de dias (linha ~354):
const colabRegras = regrasByColab.get(colab.id)
const regra = colabRegras?.dias.get(diaSemana) ?? colabRegras?.padrao ?? null

// Resto do código permanece igual (regra já é a correta para este dia)
```

**3c. Enriquecimento colaboradores:** Usar apenas a regra padrão para campos de nível colaborador:

```typescript
// Linha ~390 — usar apenas regra padrão para metadados do colaborador
const regraEntry = regrasByColab.get(c.id)
const regra = regraEntry?.padrao ?? null
if (regra) {
  c.domingo_ciclo_trabalho = regra.domingo_ciclo_trabalho
  c.domingo_ciclo_folga = regra.domingo_ciclo_folga
  c.folga_fixa_dia_semana = (regra.folga_fixa_dia_semana as DiaSemana | null) ?? null
}
```

---

### Fase 4 — Tools IA (tools.ts)

**Arquivo:** `src/main/ia/tools.ts`

**4a. Schema Zod — adicionar campo:**

```typescript
const SalvarRegraHorarioColaboradorSchema = z.object({
  colaborador_id: z.number().int().positive().describe('ID do colaborador'),
  dia_semana_regra: z.enum(['SEG','TER','QUA','QUI','SEX','SAB','DOM'])
    .nullable().optional()
    .describe('Dia da semana específico (QUA = só quartas). NULL ou omitido = regra padrão que aplica todos os dias.'),
  ativo: z.boolean().optional(),
  // ... demais campos sem mudança
})
```

**4b. Handler — upsert com novo campo:**

```typescript
// Usar upsert com ON CONFLICT baseado nos partial indexes:
const sql = args.dia_semana_regra === null || args.dia_semana_regra === undefined
  ? `INSERT INTO colaborador_regra_horario
       (colaborador_id, dia_semana_regra, ativo, inicio_min, ...)
     VALUES (?, NULL, ?, ?, ...)
     ON CONFLICT (colaborador_id) WHERE dia_semana_regra IS NULL
     DO UPDATE SET ativo = EXCLUDED.ativo, inicio_min = EXCLUDED.inicio_min, ...`
  : `INSERT INTO colaborador_regra_horario
       (colaborador_id, dia_semana_regra, ativo, inicio_min, ...)
     VALUES (?, ?, ?, ?, ...)
     ON CONFLICT (colaborador_id, dia_semana_regra) WHERE dia_semana_regra IS NOT NULL
     DO UPDATE SET ativo = EXCLUDED.ativo, inicio_min = EXCLUDED.inicio_min, ...`
```

**4c. Tool `definir_janela_colaborador` — propagar `dia_semana_regra`:**

```typescript
// Wrapper deve passar o novo campo ao chamar salvar_regra_horario_colaborador
```

**4d. Description da tool — atualizar texto:**

```
'Cria/atualiza a regra individual de horário de um colaborador.
Pode ser uma regra PADRÃO (aplica todos os dias, dia_semana_regra omitido)
ou específica de um dia (ex: dia_semana_regra="QUA" para só quartas).
Um colaborador pode ter regra padrão + até 7 regras de dias específicos.'
```

---

### Fase 5 — UI (ColaboradorDetalhe.tsx)

**Objetivo:** Mostrar lista de regras (padrão + por dia) e permitir CRUD.

**5a. Layout atual:** Card único "Regra de Horário" com campos de janela.

**5b. Layout novo:**
```
Card "Regras de Horário" [+ Adicionar]
┌─────────────────────────────────────────────────────────────────┐
│ Padrão (todos os dias)     08:00 – 17:00    ✏️ 🗑️              │
│ Quarta                     09:00 – 09:00    ✏️ 🗑️              │
│ Sábado                     10:00 – 16:00    ✏️ 🗑️              │
└─────────────────────────────────────────────────────────────────┘
```

**5c. Dialog de criação/edição:**
- Dropdown "Aplicar em": [ Todos os dias | Segunda | Terça | Quarta | Quinta | Sexta | Sábado | Domingo ]
- Campo Entrada Mín / Entrada Máx
- Campo Saída Mín / Saída Máx
- Toggle Preferência de turno
- Validação: não pode duplicar dia existente

**5d. IPC:** Adaptar `servicoColaborador.salvarRegra()` para incluir `dia_semana_regra` e criar novo método `listarRegras(colaborador_id)` para buscar todas as regras.

---

## DISCLAIMERS CRÍTICOS

- 🚨 **Migração destrutiva:** O UNIQUE constraint original `(colaborador_id)` deve ser dropado. Em PGlite, isso requer DDL_V8 no init do schema (CREATE + ALTER + CREATE INDEX). Verificar se o padrão de migração do projeto suporta ALTER TABLE ou se precisa recriar a tabela.
- 🚨 **`domingo_ciclo_trabalho`, `domingo_ciclo_folga`, `folga_fixa_dia_semana`:** São campos "por colaborador", não "por dia". Devem continuar vivendo apenas na regra padrão (`dia_semana_regra = NULL`). A UI deve mostrar esses campos apenas no card "Padrão", nunca em regras de dias específicos.
- 🚨 **Tool `consultar`:** A whitelist de `colaborador_regra_horario` provavelmente busca a primeira linha. Com múltiplas linhas, a IA precisa de um hint para saber que pode ter N linhas por colaborador.
- ⚠️ **IPC `tipc.ts`:** O handler `colaboradores.salvarRegra` atual usa o `UNIQUE(colaborador_id)` para saber se é INSERT ou UPDATE. Precisará ser ajustado para o novo constraint composto.

---

## RESUMO DE ARQUIVOS A MODIFICAR

| Arquivo | O que muda | Impacto |
|---------|-----------|---------|
| `src/main/db/schema.ts` | DDL_V8: ADD COLUMN + DROP+CREATE UNIQUE indexes | Schema migration |
| `src/shared/types.ts` | `RegraHorarioColaborador.dia_semana_regra` | Tipos TS |
| `src/main/motor/solver-bridge.ts` | Query multi-row + resolução por dia | Motor |
| `src/main/ia/tools.ts` | Schema Zod + handler upsert + description | IA Tools |
| `src/main/tipc.ts` | Handler `colaboradores.salvarRegra` + novo `colaboradores.listarRegras` | IPC |
| `src/renderer/src/paginas/ColaboradorDetalhe.tsx` | Lista multi-regra + dialog dia | UI |
| `src/renderer/src/servicos/servicoColaborador.ts` | `salvarRegra()` + `listarRegras()` | Serviço |
| `src/main/ia/system-prompt.ts` | Atualizar doc das tools | System Prompt |

---

*Spec gerado via protocolo ANALYST — Miss Monday 2026-02-24*
