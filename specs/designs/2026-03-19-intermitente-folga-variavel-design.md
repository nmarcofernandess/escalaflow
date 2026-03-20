# Design: Intermitente com Folga Variavel e Ciclo Domingo

**Data:** 2026-03-19
**Status:** Aprovado (brainstorming)

---

## TL;DR

Liberar `folga_variavel` para intermitentes, permitindo dois modos:
- **Tipo A (fixo):** dias ativos definidos por regra de horario. Sem rotacao. Funciona como hoje.
- **Tipo B (rotativo):** dias ativos + folga variavel + participa do ciclo de domingo. Mesma mecanica XOR dos CLTs.

A distincao e automatica: `folga_variavel != null` → tipo B. Sem campo novo no banco.

---

## Problema

Intermitentes no EscalaFlow sao modelados como "toggle por dia" — cada dia e ON ou OFF, fixo, sem variacao. Mas na realidade do supermercado existem dois perfis:

1. **Fixo:** trabalha dias especificos toda semana igual (ex: TER e QUI). Funciona hoje.
2. **Rotativo:** trabalha em dias que dependem do ciclo de domingo (ex: pode trabalhar SEG ou DOM, mas nao os dois na mesma semana). NAO funciona hoje — o guard forca `folga_variavel = NULL` pra todo intermitente.

O caso real: Maria Clara pode trabalhar SEG e DOM. Na segunda ela cobre a folga variavel da Rafaela (CLT). No domingo ela entra no rodizio. Quando trabalha DOM, nao trabalha SEG. Quando nao trabalha DOM, trabalha SEG. Mecanica XOR identica a dos CLTs.

---

## Modelo Semantico

### Invariante sagrada

**Dia sem regra de horario = NT (Nao Trabalha). HARD. Inviolavel.**

O solver, validador e preview NUNCA podem alocar trabalho num dia sem regra pra intermitente. A diferenca entre tipo A e B e apenas o que acontece nos dias COM regra.

### Dois modos, zero campos novos

| Aspecto | Tipo A (fixo) | Tipo B (rotativo) |
|---------|---------------|-------------------|
| Detectado por | `folga_variavel = NULL` | `folga_variavel != NULL` |
| Dias ativos | Regras por dia (ex: TER, QUI) | Regras por dia (ex: SEG, DOM) |
| Dias sem regra | NT fixo, sempre | NT fixo, sempre |
| Dias com regra | T sempre | T ou FV (condicional via XOR) |
| Ciclo domingo | Fora do pool. Cobertura garantida se tem DOM. | Dentro do pool. Rota com CLTs. |
| Folga fixa | NULL (dias sem regra ja sao NT) | NULL (idem) |
| XOR | Nao se aplica | Sim — mesma mecanica CLT |

### Exemplo visual no grid (tipo B, Maria Clara, variavel=SEG)

```
              S1                    S2                    S3
         S  T  Q  Q  S  S  D  S  T  Q  Q  S  S  D  S  T  Q  Q  S  S  D
Maria C  FV NT NT NT NT NT DT  T NT NT NT NT NT DF  FV NT NT NT NT NT DT
```

- S1: trabalha DOM (DT) → folga variavel SEG (FV)
- S2: nao trabalha DOM (DF) → trabalha SEG (T)
- S3: trabalha DOM (DT) → folga variavel SEG (FV)

---

## Mudancas por Camada

### 2A — Guard de persistencia (`src/main/tipc.ts`)

**Hoje:** `folga_variavel` e forcada a NULL pra todo intermitente (linhas ~2436-2442).

**Depois:** `folga_variavel` permitida na regra padrao (dia_semana_regra = NULL) do intermitente. Continua NULL em regras por dia especifico. `folga_fixa` continua NULL sempre pra intermitente.

**Guard novo T5:** se `folga_variavel` aponta pra um dia que o intermitente NAO tem regra ativa → rejeitar com erro. Nao faz sentido ter variavel num dia que ja e NT.

```
// Pseudo
if (isIntermitente && folgaVariavel != null) {
  const regrasDoColab = await db.query(
    'SELECT dia_semana_regra FROM colaborador_regra_horario WHERE colaborador_id=$1 AND dia_semana_regra=$2 AND ativo=true',
    [colaboradorId, folgaVariavel]
  )
  if (regrasDoColab.length === 0) {
    throw new Error(`Folga variavel ${folgaVariavel} aponta pra dia sem regra ativa`)
  }
}
```

**Nota sobre `persistFolgaPatterns` (oficializar):** quando uma escala e oficializada, `persistFolgaPatterns` infere folga_fixa e folga_variavel do padrao de alocacoes. Para intermitentes tipo B, essa inferencia NAO deve rodar — o tipo B sempre tem `folga_variavel` explicita, definida pelo RH. O guard existente que pula intermitentes na inferencia deve ser mantido.

### 2B — Solver Bridge (`src/main/motor/solver-bridge.ts`)

**Hoje:** intermitente e sempre excluido do pool rotativo (ciclo domingo) com `continue` na linha ~594.

**Depois:**
- Se `folga_variavel == null` → tipo A: `continue` (excluido do pool, cobertura garantida se tem DOM)
- Se `folga_variavel != null` → tipo B: entra no pool rotativo, calcula ciclo normal

Os dias sem regra continuam com `folga_fixa = true` na bridge — guard existente que bloqueia o solver de alocar nesses dias.

**`dias_trabalho` para tipo B:** hoje a bridge faz `dias_trabalho = group?.dias.size` (count de regras ativas). Para tipo B com XOR, isso pode conflitar com a constraint `add_dias_trabalho` — se `dias_trabalho=2` (SEG+DOM) mas XOR forca um deles OFF, a constraint de dias minimos pode exigir 2 quando so 1 e possivel. **Solucao:** para tipo B, `dias_trabalho` deve ser `dias.size - 1` (desconta o dia variavel). Alternativamente, a constraint `add_dias_trabalho` (DIAS_TRABALHO) ja e soft/relaxavel no multi-pass — verificar se o conflito e auto-resolvido. Testar no cenario T2.

**Guard D14 (folga_fixa=DOM):** a bridge converte `folga_fixa=DOM` fazendo a variavel virar segunda folga fixa. Esse guard ja tem `!isIntermitente`, entao intermitentes nao sao afetados. Confirmar que continua safe apos as mudancas.

### 2C — Solver Python (`solver/constraints.py`)

**Hoje:** constraints pulam intermitentes com `continue`.

**Depois:**

| Constraint | Funcao | Hoje | Depois |
|------------|--------|------|--------|
| XOR folga variavel | `add_folga_variavel_condicional` | `continue` pra todo intermitente | `continue` so se `folga_variavel == null` (tipo A) |
| Dom max consecutivo | `add_dom_max_consecutivo` | `continue` pra todo intermitente | `continue` so se `folga_variavel == null` (tipo A) |
| Ciclo domingo HARD | `add_domingo_ciclo_hard` | `continue` pra todo intermitente | `continue` so se `folga_variavel == null` (tipo A) |
| Ciclo domingo SOFT | `add_domingo_ciclo_exato` | `continue` pra todo intermitente | `continue` so se `folga_variavel == null` (tipo A) |
| Folga fixa | `add_folga_fixa_5x2` | `continue` pra todo intermitente | Continua `continue` (intermitente nao tem folga fixa) |

**Guard condicional proposto:**
```python
# ANTES (em cada constraint acima):
if colabs[c].get("tipo_trabalhador", "CLT") == "INTERMITENTE":
    continue

# DEPOIS:
if colabs[c].get("tipo_trabalhador", "CLT") == "INTERMITENTE" \
   and not colabs[c].get("folga_variavel_dia_semana"):
    continue
```

**Guard belt-and-suspenders:** nos dias sem regra (folga_fixa=true no input), forcar `work[c][d] = 0` explicitamente. Isso e ADICIONAL ao mecanismo existente em `add_folga_fixa_5x2` que ja forca 0 quando `folga_fixa=true` no `regras_colaborador_dia`. O belt-and-suspenders garante que mesmo se a constraint de folga_fixa for relaxada num pass, o intermitente nunca trabalha num dia sem regra.

### 2D — Validador TS (`src/main/motor/validador.ts`)

**ATENCAO — Gap existente:** o validador TS NAO tem check XOR hoje. Nem pra CLTs, nem pra ninguem. O XOR e enforced APENAS pelo solver Python. Isso significa:
- Apos ajuste manual (`ajustar_alocacao`), se o usuario quebrar o padrao XOR, o validador NAO flagga.
- Isso e um gap pre-existente, nao introduzido por este design.

**Decisao:** NAO adicionar validacao XOR ao validador como parte deste trabalho. O risco e baixo (ajuste manual e raro e o RH sabe o que esta fazendo). Documentar como gap conhecido. Se quiser fechar depois, e trabalho separado.

**O que o validador DEVE fazer neste trabalho:**
- Intermitente tipo B: pular checks de ciclo/folga que nao se aplicam (como ja faz)
- Dia sem regra: se uma alocacao TRABALHO existe num dia que o intermitente nao tem regra → violacao HARD

**Tipo `ColabMotor`:** a interface em `validacao-compartilhada.ts` NAO tem `folga_variavel_dia_semana` hoje. Precisa adicionar o campo ao tipo para que o validador possa distinguir tipo A de tipo B. Mesmo que o validador nao cheque XOR, ele precisa saber se deve pular ou nao as validacoes de ciclo.

### 2E — Preview (`SetorDetalhe.tsx` + `simula-ciclo.ts`)

**ATENCAO — Limitacao arquitetural:** `simula-ciclo.ts` trabalha com `num_postos` e `trabalham_domingo` como counts agregados. Nao tem conceito de "worker X so pode trabalhar SEG e DOM". Nao existe per-worker day mask.

**Abordagem pragmatica:** NAO modificar `simula-ciclo.ts` pra aceitar masks por worker. Em vez disso:
1. O simula-ciclo continua gerando grid so com CLTs (como hoje)
2. Intermitente tipo B gera sua row SEPARADAMENTE no SetorDetalhe, usando a logica de XOR pra decidir T/FV/DT/DF/NT
3. A row e injetada no grid DEPOIS do simula-ciclo
4. A cobertura e recalculada somando CLT + intermitentes

Pra gerar a row do tipo B sem o simula-ciclo:
- Pegar o ciclo de semanas do simula-ciclo (quantas semanas, qual padrao DT/DF por semana)
- Distribuir DT/DF pro intermitente seguindo o mesmo rodizio
- Nos domingos DT → FV no dia variavel. Nos domingos DF → T no dia variavel.
- Todos os outros dias → NT

**Intermitente tipo A (sem folga_variavel):**
- Continua como implementado: row fixa com T/NT, fora do simulador

### 2F — Sunday cycle (`src/shared/sunday-cycle.ts`)

**`contarIntermitentesGarantidosNoDomingo`:**
- Tipo A com DOM → continua contando como cobertura garantida
- Tipo B com DOM → NAO conta como garantida (entra no pool rotativo)

**Filtro `nDom`:**
- Tipo A: continua excluido do pool (filtered out)
- Tipo B: incluido no pool rotativo

**Impacto no ciclo:** um tipo B com 2 dias ativos (SEG+DOM) conta igual a um CLT com 5+ dias ativos no pool rotativo. Isso e aceitavel — o ciclo de domingo so depende de N (pool) e K (quantos trabalham domingo), nao de quantos dias cada pessoa trabalha no total. O intermitente tipo B trabalha ou nao no domingo, e isso e tudo que importa pro ciclo.

---

## Plano de Paridade e Testes

**DISCLAIMER:** A paridade solver (Python) vs validador (TypeScript) precisa ser verificada exaustivamente. O solver NAO pode inventar folgas ou alocar trabalho em dias que o intermitente nao tem regra. O validador NAO pode discordar do solver em nenhuma circunstancia valida.

### Cenarios obrigatorios

| # | Cenario | O que valida |
|---|---------|--------------|
| T1 | Tipo A, 3 dias ativos (TER/QUI/SAB) | NT nos outros dias. Solver nao aloca fora dos 3 dias. Validador concorda. |
| T2 | Tipo B (variavel=SEG), dias ativos SEG+DOM, ciclo 3 semanas | XOR funciona: trabalha DOM → folga SEG. `dias_trabalho` nao conflita com XOR. |
| T3 | Tipo B + tipo A no mesmo setor | Tipo B no pool rotativo, tipo A como cobertura fixa. Cobertura soma correta. |
| T4 | Tipo B com DOM ativo e variavel=QUA | XOR funciona em qualquer combinacao dia variavel + domingo. |
| T5 | Tipo B onde variavel aponta pra dia SEM regra | Bloqueado na persistencia (guard tipc.ts). Erro claro. |
| T6 | Tipo B num setor sem demanda de domingo | XOR dispara mas DOM resolve naturalmente a 0 (sem demanda). Sem crash. |
| T7 | Tipo B com excecao (ferias) cobrindo parte do periodo | Dias de excecao = INDISPONIVEL. Solver nao aloca. Validador concorda. |
| T8 | Multi-pass com tipo B — pass 1 falha, relaxa pra pass 2 | Tipo B continua respeitando NT nos dias sem regra mesmo em passes relaxados. |
| T9 | Validador recebe escala do solver com tipo B | Checks H1, H2, H4 rodam. Dia sem regra alocado = violacao HARD. |
| T10 | Preview TS vs solver Python pra mesmo input com tipo B | Mesma distribuicao DT/DF. |
| T11 | Tipo B com todos os 7 dias ativos + variavel | Comporta como CLT. `dias_trabalho=7` nao conflita. |

### Guard no tipc.ts (T5)

```
Se folga_variavel aponta pra um dia que o intermitente NAO tem regra ativa → rejeitar
```

### Guard no solver Python (belt and suspenders)

```
Se tipo_trabalhador == INTERMITENTE e dia nao tem regra (folga_fixa=true):
  forcar work[c][d] = 0 (adicional ao existente, nao substituto)
```

### Teste de paridade solver <-> validador

Rodar cenario T2 pelo solver CLI, capturar output, passar pro validador TS, comparar:
- Mesmas violacoes (0 hard, mesmas soft)
- Mesmos dias de trabalho/folga
- Dia sem regra nunca alocado

---

## Gaps conhecidos (pre-existentes, nao introduzidos)

1. **Validador TS nao checa XOR** — nem pra CLTs. Apos ajuste manual, XOR pode ser quebrado sem violacao. Aceitar por agora. Fechar em trabalho separado se necessario.
2. **Escala oficial (escalaParaCicloGrid)** mostra FF pra dias que intermitente nao trabalha, em vez de NT. Refinamento visual futuro.

---

## Fora de escopo

- UI do ColaboradorDetalhe pra configurar folga_variavel do intermitente (separar em task propria)
- Intermitente na escala oficial (escalaParaCicloGrid mostrando NT em vez de FF)
- Modo "budget mensal" (trabalha X dias no mes, posicionar livremente)
- Folga fixa pra intermitente (nao faz sentido — dias sem regra ja sao NT)
- Validacao XOR no validador TS (gap pre-existente)

---

## Arquivos impactados

| Arquivo | Mudanca |
|---------|---------|
| `src/main/tipc.ts` | Remover guard folga_variavel=NULL pra intermitente padrao. Adicionar guard T5. |
| `src/main/motor/solver-bridge.ts` | Tipo B entra no pool rotativo. `dias_trabalho` ajustado. Guard D14 confirmado safe. |
| `solver/constraints.py` | Guards condicionais por folga_variavel em 4 constraints. Belt-and-suspenders. |
| `src/main/motor/validador.ts` | Guard dia sem regra = violacao HARD. |
| `src/shared/types.ts` | `ColabMotor` ganha `folga_variavel_dia_semana`. |
| `src/shared/sunday-cycle.ts` | Tipo B no nDom, nao mais como garantido. |
| `src/renderer/src/paginas/SetorDetalhe.tsx` | Tipo B gera row com XOR no grid. |
| `src/renderer/src/lib/ciclo-grid-converters.ts` | Converter F→NT pra dias sem regra de intermitente. |
| Testes novos | 11 cenarios de paridade. |
