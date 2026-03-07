# ANALYST — Avisos Pós-Geração: Oficializar, Regra Mulher/Domingo, Config Simplificada

> **Data:** 2026-03-06
> **Contexto:** Marco reportou 3 issues após gerar escala de 3 meses

---

## TL;DR EXECUTIVO

Três problemas interligados:
1. **Oficializar já funciona com avisos SOFT** — o bloqueio é só HARD. O bug real é H19 dando falso positivo no boundary do período.
2. **H3 (mulher/domingo)** já é SOFT, não bloqueia. Mas a mãe do Marco quer poder **desligar** — e a infra de regras (`regra_empresa`) já suporta isso.
3. **RegrasPagina existe e funciona**, mas é complexa demais para o caso de uso real. Precisa de uma versão simplificada no contexto da escala.

---

## ISSUE 1: Oficializar com Avisos

### Estado Atual

```
BACKEND (tipc.ts → escalasOficializar):
  1. Valida hash (escala desatualizada?)
  2. Roda validarEscalaV3()
  3. Se violacoes_hard > 0 → throw Error (BLOQUEIA)
  4. Se violacoes_hard = 0 → oficializa (SOFTs ignorados)

FRONTEND (SetorDetalhe.tsx):
  Botão "Oficializar" → chama backend → catch error → toast
  NÃO verifica violações antes. NÃO tem confirm dialog.
```

### Diagnóstico

**O oficializar já NÃO bloqueia por SOFT.** O fluxo é correto:
- `violacoes_hard > 0` → bloqueia (CLT mandatório)
- `violacoes_soft > 0` → ignora (são preferências)

**O problema real é o H19 (FOLGA_COMP_DOM) dando falso positivo:**

```
Domingo 2026-06-07 = último dia do período
checkH19 busca folga nos 7 dias SEGUINTES: dias.slice(i+1, i+8)
Mas não existem dias seguintes → diasSeguintes = []
→ temFolgaCompensatoria = false → VIOLAÇÃO HARD (falso positivo!)
```

### Solução

**Fix no checkH19:** Se o domingo trabalhado está nos últimos 7 dias do período, NÃO reportar violação — o validador não tem visibilidade do que vem depois.

```typescript
// Em checkH19, adicionar guard:
const diasRestantes = dias.length - i - 1
if (diasRestantes < CLT.FOLGA_COMPENSATORIA_DOM_DIAS) continue // boundary — sem visibilidade
```

### UX Adicional (Opcional)

Adicionar confirm dialog no frontend antes de oficializar se há avisos SOFT:

```
┌─────────────────────────────────────────┐
│  Oficializar Escala?                    │
│                                         │
│  ⚠ 2 avisos de otimização:             │
│  • Jéssica: 2 domingos consecutivos     │
│  • Cobertura abaixo do ideal seg 14h    │
│                                         │
│  Avisos não impedem oficialização.      │
│                                         │
│         [Cancelar]  [Oficializar]       │
└─────────────────────────────────────────┘
```

**Prioridade:** BAIXA — já funciona. O confirm é polish.

---

## ISSUE 2: H3 — Regra Mulher/Domingo (Art. 386 CLT)

### Estado Atual

```
checkH3 em validacao-compartilhada.ts:
  - Mulher (sexo='F'): max 1 domingo consecutivo (Art. 386 CLT)
  - Homem (sexo='M'): max 2 domingos consecutivos (Lei 10.101/2000)
  - Severidade: SOFT (desde v3.1)
  - Solver Python: add_domingo_ciclo_soft() com peso 3000
```

**H3 já é SOFT** — não bloqueia oficialização.

### O Pedido do Marco

> "A minha mãe não faz essa diferenciação de mulher"

A mãe quer tratar homens e mulheres igual — max 2 domingos consecutivos para todos.

### Opções

| Opção | O que muda | Impacto |
|-------|-----------|---------|
| **A) Desligar H3 via regra_empresa** | `INSERT INTO regra_empresa VALUES ('S_DOMINGO_CICLO', 'OFF')` | Remove penalidade de rodízio domingo do solver. Mulheres e homens tratados igual pelo motor. O checker H3 continua reportando SOFT mas sem peso. |
| **B) Igualar limites (sem diferenciar sexo)** | Mudar `MAX_DOMINGOS_CONSECUTIVOS.F` de 1 para 2 | Mantém a regra ativa mas trata todos como 2 domingos max. Mais correto semanticamente. |
| **C) Toggle na UI de regras** | User desliga/liga na RegrasPagina | Infra já existe! `regra_empresa` já suporta status OFF para `S_DOMINGO_CICLO`. |

### Recomendação

**Opção C** — a infra já existe. A RegrasPagina já tem toggle para `S_DOMINGO_CICLO`. O que falta é:
1. O nome da regra no seed ser mais claro ("Rodízio domingo — diferencia homem/mulher")
2. Tornar acessível sem ir na página de Regras (ver Issue 3)

**Nota:** O H3 no validador TS diferencia sexo, mas o solver Python (penalidade SOFT) usa `domingo_ciclo_trabalho` que é por colaborador, não por sexo. O efeito prático de desligar `S_DOMINGO_CICLO` é remover a penalidade do solver — o validador ainda mostra o aviso.

---

## ISSUE 3: Config Simplificada de Regras

### Estado Atual da RegrasPagina

```
RegrasPagina.tsx — COMPLETA mas COMPLEXA:
├── Card "Período Semanal" (corte, tolerância, CCT intervalo)
├── Card "CLT" — 16 regras com Select toggle cada
├── Card "Preferências" — 7 regras SOFT
├── Card "Antipadrões" — 12 regras
├── Card "Customizações" — lista de overrides ativos
└── Botão "Restaurar Padrões"

Total: 35 regras individuais
```

**Problema:** RH de supermercado não vai entender "H10_META_SEMANAL" ou "S_CONSISTENCIA". É demais.

### O que FAZ SENTIDO expor ao RH

Das 35 regras, apenas ~5 fazem sentido como toggle para usuário não técnico:

| Regra | Nome amigável | Impacto real | Editável? |
|-------|--------------|-------------|-----------|
| **S_DOMINGO_CICLO** | "Rodízio justo de domingos" | Tenta distribuir domingos igualmente | Sim |
| **S_TURNO_PREF** | "Respeitar preferência de turno" | Prioriza manhã/tarde do colaborador | Sim |
| **S_CONSISTENCIA** | "Manter horário consistente" | Evita pular de manhã pra tarde | Sim |
| **S_SPREAD** | "Distribuir carga uniforme" | Evita sobrecarga em poucos | Sim |
| **tolerancia_semanal_min** | "Tolerância semanal (minutos)" | Margem de +/- nas horas | Campo numérico |

### Proposta: Drawer de Preferências no SetorDetalhe

Em vez de mandar o RH para RegrasPagina, criar um mini-drawer acessível direto da tela de escala:

```
┌─────────────────────────────────────────┐
│  ⚙ Preferências de Geração              │
│                                         │
│  Estas opções afetam como o motor       │
│  distribui turnos e folgas.             │
│                                         │
│  ┌─────────────────────────────┐        │
│  │ 🔄 Rodízio justo domingo   [ON] │   │
│  │    Distribui domingos       │        │
│  │    igualmente na equipe     │        │
│  ├─────────────────────────────┤        │
│  │ 🕐 Manter horário estável  [ON] │   │
│  │    Evita trocar turno       │        │
│  │    todo dia                 │        │
│  ├─────────────────────────────┤        │
│  │ ⚖ Distribuir carga         [ON] │   │
│  │    uniforme na equipe       │        │
│  ├─────────────────────────────┤        │
│  │ 🌅 Respeitar preferência   [ON] │   │
│  │    de turno                 │        │
│  └─────────────────────────────┘        │
│                                         │
│  Mudanças aplicam na próxima geração.   │
│                                         │
│         [Restaurar Padrões]             │
└─────────────────────────────────────────┘
```

**Regras CLT e ANTIPATTERN ficam na RegrasPagina** (para power users / IA).
**SOFTs práticas ficam no drawer** (para o RH do dia a dia).

---

## PLANO DE AÇÃO (Priorizado)

### P0 — Fix H19 Falso Positivo (5 min)
- **Arquivo:** `src/main/motor/validacao-compartilhada.ts:1032`
- **Mudança:** Skip domingos nos últimos 7 dias do período
- **Impacto:** Remove blocker fantasma de oficialização

### P1 — (Opcional) Confirm Dialog ao Oficializar com SOFTs (15 min)
- **Arquivo:** `src/renderer/src/paginas/SetorDetalhe.tsx`
- **Mudança:** Se `violacoes_soft > 0`, mostrar AlertDialog antes de oficializar
- **Impacto:** UX mais clara — user sabe que tem avisos mas pode prosseguir

### P2 — (Backlog) Drawer de Preferências Simplificado
- **Arquivos:** Novo componente + `SetorDetalhe.tsx`
- **Mudança:** Sheet com ~4 toggles SOFT + save em `regra_empresa`
- **Impacto:** RH consegue desligar rodízio domingo sem ir em Regras

### NÃO FAZER
- Não mudar a severidade de H3 (já é SOFT, correto)
- Não desabilitar H3 por default (Art. 386 CLT existe, é proteção)
- Não simplificar RegrasPagina (ela serve para IA e power users)

---

## DISCLAIMERS CRÍTICOS

- H19 falso positivo só acontece quando o último dia do período é domingo trabalhado — edge case real mas raro
- Desligar S_DOMINGO_CICLO remove a penalidade do solver MAS o validador ainda reporta o aviso (cosmético)
- O drawer de preferências é UX sugar — funcionalidade já existe na RegrasPagina
- Regras CLT (HARD) nunca devem ser toggle no drawer simplificado — risco legal
