# LÓGICA — Intermitente: Dias Disponíveis

## TL;DR EXECUTIVO

Intermitente é uma pessoa que cobre um espaço num horário específico em dias específicos. Toda a complexidade CLT (folga fixa, folga variável, ciclo domingo, preferência de turno) **NÃO se aplica**. A UI da aba Horários muda baseada no tipo de contrato — sem campo novo no banco, sem impacto nos CLT.

**Caso concreto:** João, intermitente do Açougue, trabalha SÓ domingo 07:00-13:00.

---

## VISÃO GERAL

```
INTERMITENTE — DISPONIBILIDADE POR DIA
├── Contrato
│   ├── Tipo: Intermitente
│   ├── horas_semanais: 0 (default) → colaborador override pra 6
│   └── regime_escala/dias_trabalho: irrelevante (solver cap automático)
├── Cadastro (Aba Horários)
│   ├── Seção CLT (folga fixa, variável, ciclo, turno) → ESCONDIDA
│   ├── Seção "Dias Disponíveis" → VISÍVEL
│   │   ├── SEG: OFF (não trabalha)
│   │   ├── TER: OFF
│   │   ├── QUA: OFF
│   │   ├── QUI: OFF
│   │   ├── SEX: OFF
│   │   ├── SAB: OFF
│   │   └── DOM: ON → Entrada fixa 07:00
│   └── Regra padrão implícita = "não trabalha"
└── Solver
    ├── Dias sem regra → folga_fixa = true (bloqueado)
    ├── Dias com regra → time window normal
    └── dias_trabalho cap: min(6, available) = 1 ✓
```

---

## DECISÃO ARQUITETURAL: POSTO vs FUNCIONÁRIO

**Pergunta:** A restrição de "só trabalha domingo" vive no POSTO (função) ou no FUNCIONÁRIO?

**Resposta: NO FUNCIONÁRIO.**

| Aspecto | No Posto | No Funcionário |
|---------|----------|----------------|
| Semântica | "O posto de Açougueiro só existe domingo" | "O João só trabalha domingo" |
| Realidade | FALSO — outros açougueiros trabalham seg-sab | VERDADEIRO — é regra DO JOÃO |
| Impacto | Quebraria todos os CLT do mesmo posto | Zero impacto nos CLT |
| Complexidade | Novo conceito: "disponibilidade de posto por dia" | Usa infra de regras por dia que JÁ EXISTE |

O solver já resolve naturalmente: se João está bloqueado seg-sab, ele nunca é escalado nesses dias. O posto "Açougueiro" continua preenchido por outros colaboradores nos demais dias.

---

## FLUXO: COMO O RH CADASTRA UM INTERMITENTE

### Passo 1 — Criar colaborador (Aba Geral)

```
[RH] Novo colaborador → Nome: "João Silva"
                       → Setor: Açougue
                       → Contrato: Intermitente    ← seleção
                       → Horas semanais: 6         ← override obrigatório
                       → Função: Açougueiro         ← posto normal
```

**Ao selecionar contrato "Intermitente":**
- `tipo_trabalhador` = INTERMITENTE (já derivado automaticamente)
- `horas_semanais` = 0 (do contrato) → RH deve alterar pra horas reais (ex: 6)

### Passo 2 — Configurar dias (Aba Horários)

**O que MUDA na UI quando tipo_trabalhador = INTERMITENTE:**

```
┌─────────────────────────────────────────────────────┐
│ ANTES (CLT — como é hoje)                           │
├─────────────────────────────────────────────────────┤
│ ┌── Regras de Horário ──────────────────────────┐   │
│ │ Restricao de horário (hard constraint)         │   │
│ │ ○ Sem restricao  ○ Entrada fixa  ○ Saida max  │   │
│ │                                                │   │
│ │ Ciclo domingo: [2] / [1]                       │   │
│ │ Folga fixa: [Sem folga fixa ▼]                 │   │
│ │ Folga variavel: [Sem folga var ▼]              │   │
│ │ Pref. turno: [Sem preferencia ▼]               │   │
│ │                                                │   │
│ │ Horários por dia da semana                     │   │
│ │ ○ SEG  Usando padrão                           │   │
│ │ ○ TER  Usando padrão                           │   │
│ │ ...                                            │   │
│ └────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│ DEPOIS (INTERMITENTE — UI simplificada)             │
├─────────────────────────────────────────────────────┤
│ ┌── Dias Disponíveis ───────────────────────────┐   │
│ │ Ative os dias em que este colaborador trabalha │   │
│ │                                                │   │
│ │ ○ SEG  Não trabalha                            │   │
│ │ ○ TER  Não trabalha                            │   │
│ │ ○ QUA  Não trabalha                            │   │
│ │ ○ QUI  Não trabalha                            │   │
│ │ ○ SEX  Não trabalha                            │   │
│ │ ○ SAB  Não trabalha                            │   │
│ │ ● DOM  Entrada fixa: [07:00]                   │   │
│ │        Saída máxima: [13:00]  ← NOVO           │   │
│ └────────────────────────────────────────────────┘   │
│                                                      │
│ ⓘ Intermitente: dias sem toggle = não escalado.      │
│   Horas semanais: 6h (ajuste na aba Geral).          │
└─────────────────────────────────────────────────────┘
```

**Diferenças da versão CLT:**

| Elemento | CLT | Intermitente |
|----------|-----|-------------|
| Restricao padrão (radio) | Visível | **Escondido** — padrão implícito = não trabalha |
| Ciclo domingo | Visível | **Escondido** — não se aplica |
| Folga fixa | Visível | **Escondido** — não se aplica |
| Folga variável | Visível | **Escondido** — não se aplica |
| Pref. turno (regra) | Visível | **Escondido** — não se aplica |
| Toggles por dia | "Usando padrão" quando OFF | **"Não trabalha"** quando OFF |
| Toggle ON | Só entrada OU saída (2 campos) | **Entrada E saída** (ambos obrigatórios) |
| Título do card | "Regras de Horário" | **"Dias Disponíveis"** |

### Passo 3 — Gerar escala (usa o setor normalmente)

```
[RH] Gerar escala Açougue → Motor inclui João
                           → João só aparece nos domingos
                           → Outros CLT preenchem seg-sab
                           → KPIs contam João separado
```

---

## REGRAS DE NEGÓCIO

### PODE / NÃO PODE
- ✅ **PODE:** Intermitente ter mais de 1 dia ativo (ex: DOM + feriados)
- ✅ **PODE:** Intermitente ter horários diferentes por dia (DOM 07-13, SAB 08-14)
- ❌ **NÃO PODE:** Intermitente ter folga fixa/variável/ciclo domingo (conceitos CLT)
- ❌ **NÃO PODE:** Dia ativo sem horário definido (entrada E saída obrigatórias)

### SEMPRE / NUNCA
- 🔄 **SEMPRE:** Dia OFF = bloqueado no solver (folga_fixa = true)
- 🔄 **SEMPRE:** `horas_semanais` deve ser > 0 no colaborador (validação na UI)
- 🚫 **NUNCA:** Solver decide livremente para intermitente — ele SÓ trabalha nos dias configurados

### CONDICIONAIS
- 🔀 **SE** tipo_trabalhador = INTERMITENTE **ENTÃO** UI simplificada + padrão = bloqueado
- 🔀 **SE** tipo_trabalhador ≠ INTERMITENTE **ENTÃO** UI atual (zero mudança pros CLT)

---

## IMPLEMENTAÇÃO MÍNIMA

### Mudança 1 — solver-bridge.ts (~10 linhas)

**Onde:** Loop de `regrasColaboradorDia` (linha ~369-428)

**Lógica:** Quando `tipo_trabalhador === 'INTERMITENTE'` e não há regra para o dia → emitir `folga_fixa = true`.

```
// Pseudocódigo — dentro do while (d <= end)
const isIntermitente = colab.tipo_trabalhador === 'INTERMITENTE'

if (excecaoData) {
  // ... (igual hoje)
} else if (regra) {
  // ... (igual hoje — dia com toggle ON)
} else if (isIntermitente) {
  // NOVO: intermitente sem regra pro dia = bloqueado
  folga_fixa = true
}

// Emissão: folga_fixa já é tratada pelo solver (constraints.py:747)
```

**Por que funciona sem mudar o Python:**
- `add_colaborador_time_window_hard` (constraints.py:746-748) já trata `folga_fixa`:
  ```python
  if regra.get("folga_fixa", False):
      model.add(works_day[c, d] == 0)  # bloqueia o dia
      continue
  ```
- `add_dias_trabalho` (constraints.py:462) já faz cap: `target = min(target, available)`
- Com 6 dias bloqueados → `available = 1` → `target = 1` → solver escala 1 dia ✓

### Mudança 2 — ColaboradorDetalhe.tsx (UI condicional)

**Onde:** Aba Horários, card "Regras de Horário" (linha ~930)

**Lógica:** Derivar `isIntermitente` do contrato selecionado.

```
Seção A (restricao padrão, ciclo, folgas, turno):
  → if !isIntermitente: renderiza normal (como hoje)
  → if isIntermitente:  ESCONDE toda seção A

Seção B (toggles por dia):
  → Título muda: "Dias Disponíveis" (intermitente) vs "Horários por dia" (CLT)
  → Label OFF muda: "Não trabalha" (intermitente) vs "Usando padrão" (CLT)
  → Toggle ON (intermitente):
    - Entrada fixa OBRIGATÓRIA (não tem "sem restricao")
    - Saída máxima OBRIGATÓRIA (campo novo visível)
    - Ambos salvam no mesmo banco (inicio + fim na regra por dia)
```

**Impacto nos CLT:** ZERO. O `isIntermitente` é um condicional puro no render.

### Mudança 3 — RestricaoRadio (variante intermitente)

**Quando `isIntermitente` e toggle ON:**
- NÃO mostra radio (entrada/saída/sem restricao)
- Mostra DOIS campos de time: `Entrada: [__:__]` e `Saída: [__:__]`
- Ambos obrigatórios
- Salva: `inicio = entrada`, `fim = saída` na regra por dia

### Mudança 4 — horas_semanais (validação UX)

**Na aba Geral**, quando contrato = Intermitente:
- Se `horas_semanais = 0`: mostrar alerta inline
  - "Ajuste as horas semanais para o total que este colaborador trabalha (ex: 6h para 1 turno de 6h)"
- Não bloquear (pode ser 0 temporariamente), mas destacar visualmente

### O que NÃO muda

| Componente | Muda? | Por quê |
|------------|-------|---------|
| Banco (schema) | **Não** | Usa campos existentes (inicio, fim, dia_semana_regra) |
| Solver Python | **Não** | `folga_fixa` já é tratado, `dias_trabalho` cap já existe |
| Contrato Intermitente | **Não** | horas_semanais=0 é ok (RH override no colaborador) |
| IPC / tipc.ts | **Não** | Mesmo endpoints de salvarRegraHorario |
| Outros tipos contrato | **Não** | Condicional puro no render, zero side-effect |

---

## CASO PRÁTICO

### Cenário: João, intermitente do Açougue, domingo 07:00-13:00

**Antes (impossível):**
1. RH cria João com contrato Intermitente
2. Aba Horários mostra mesma UI que CLT
3. Não tem como dizer "só trabalha domingo"
4. Solver escala João 6 dias/semana → errado

**Depois:**
1. RH cria João com contrato Intermitente, horas_semanais = 6
2. Aba Horários mostra "Dias Disponíveis" (UI simplificada)
3. Liga toggle DOM → Entrada: 07:00, Saída: 13:00
4. SEG-SAB ficam "Não trabalha"
5. Solver recebe: DOM = time window 07:00-13:00, demais = folga_fixa
6. João aparece SÓ no domingo na escala ✓

### Cenário: Maria, intermitente do Caixa, sábado + domingo 08:00-14:00

1. RH cria Maria, horas_semanais = 12
2. Liga toggle SAB → Entrada: 08:00, Saída: 14:00
3. Liga toggle DOM → Entrada: 08:00, Saída: 14:00
4. SEG-SEX ficam "Não trabalha"
5. Solver escala Maria só sab+dom ✓

---

## EDGE CASES E DISCLAIMERS

- 🚨 **horas_semanais = 0:** Se RH esquecer de ajustar, o solver terá target 0 minutos semanais. A elastic weekly hours penaliza qualquer trabalho. Mitigação: alerta visual na UI.
- 🚨 **Nenhum dia ativo:** Se intermitente tem todos os toggles OFF, solver bloqueia todos os dias → colaborador é inútil. Mitigação: alerta "Nenhum dia configurado".
- 🚨 **Feriado em dia ativo:** Se DOM é feriado proibido (25/12, 01/01), intermitente fica bloqueado nesse dia (H17/H18 tem precedência). Comportamento correto — CCT vale pra todos.
- 🚨 **Excecao BLOQUEIO em dia ativo:** Excecão (férias, atestado) tem precedência sobre regra de dia. Se João tem atestado cobrindo um domingo, o solver bloqueia. Comportamento correto.

---

## RESUMO DE ARQUIVOS A TOCAR

| Arquivo | O que muda | Esforço |
|---------|-----------|---------|
| `src/main/motor/solver-bridge.ts` | +10 linhas: if intermitente + sem regra → folga_fixa | Baixo |
| `src/renderer/src/paginas/ColaboradorDetalhe.tsx` | Condicional no card Horários: esconde seção CLT, muda labels | Médio |
| Nenhum outro | — | — |

**Total estimado: 2 arquivos, ~50-80 linhas de mudança.**

---

## DECISAO: TIPOS TRABALHADOR (2026-03-13)

### Tipos validos no Supermercado Fernandes

| Tipo | Existe? | Domingo | Ciclo | Restricoes |
|------|---------|---------|-------|------------|
| CLT | Sim | Sim (ciclo rotativo) | Conta no N | 44h ou 36h, compensacao 9h45 |
| ESTAGIARIO | Sim | **Sim** (ciclo rotativo) | **Conta no N** | Max 6h/dia, 30h/sem, NUNCA hora extra (H15/H16). Horarios via perfis: MANHA_08_12, TARDE_1330_PLUS, ESTUDA_NOITE_08_14 |
| INTERMITENTE | Sim | Conforme toggle | **NAO conta** | Convocado sob demanda, dias por toggle ON/OFF |
| APRENDIZ | **NAO** | — | — | Tipo removido. Codigo morto (H11-H14) permanece inerte no validador |

### Por que APRENDIZ nao existe

O Fernandes so tem CLT, estagiarios (estudantes com horario reduzido) e intermitentes (cobertura pontual). "Menor aprendiz" (CLT Art. 432) nao se aplica ao quadro atual. APRENDIZ foi modelado como tipo generico na v3 mas nunca teve contrato seed nem colaborador real.

### Estagiario trabalha domingo

Decisao do Marco: estagiarios participam do ciclo domingo normalmente (2 trabalho / 1 folga). Restricoes do estagiario sao apenas de HORAS (max 6h/dia, 30h/sem) e hora extra (NUNCA). Horarios controlados pelos 3 perfis existentes no contrato.
