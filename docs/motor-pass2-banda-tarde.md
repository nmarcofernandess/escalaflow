# Motor: pass 2 sistemático em setores com abertura tardia (banda TARDE × janela de almoço)

**Status:** diagnóstico confirmado empiricamente em 2026-06-10. Fix pendente (decisão pós-beta).

## Sintoma

Setor CLT 44h (5x2 **ou** 6x1) com `hora_abertura >= ~07:00` cai **sistematicamente** no
pass 2 do solver: pass 1 retorna INFEASIBLE em ~0.1s e o pass 2 relaxa `DIAS_TRABALHO` e
`MIN_DIARIO`. A escala sai com `violacoes_hard: 0` e o aviso "Escala gerada com ajustes:
dias de trabalho por semana, jornada mínima diária..." aparece em **toda geração** (toast
pós-geração + banner na EscalaPagina). As regras CLT duras continuam respeitadas, mas a
garantia de "exatamente 5/6 dias por semana" vira penalidade soft — e o RH vê aviso de
ajuste num setor perfeitamente normal.

Varejo 6x1 tipicamente abre 08:00 → **o caso comum do produto está caindo no pass 2.**

## Reprodução (confirmada)

Cenário: 4 colaboradores CLT 44h, demanda 10:00–16:00 min 1, período de 2 semanas
(2026-03-02 a 2026-03-15), `patience_s: 5`.

| Cenário | pass_usado | regras_relaxadas |
|---|---|---|
| 5x2, setor 08:00–20:00 | **2** | DIAS_TRABALHO, MIN_DIARIO |
| 6x1 (CLT 44h 6x1), setor 08:00–20:00 | **2** | DIAS_TRABALHO, MIN_DIARIO |
| 5x2, setor 06:00–20:00 (controle) | **1** | — |

(Reproduzível recriando o spec descrito em `tests/main/solver-recorrencia.spec.ts` com
`hora_abertura: '08:00'` — o spec de recorrência usa 06:00 exatamente por causa disso,
ver comentário no arquivo.)

## Causa-raiz (cadeia)

1. **Phase 1 fixa bandas MANHA/TARDE sem modelar horas** — decide a banda de cada
   pessoa/dia otimizando cobertura, penalizando INTEGRAL, sem saber se a banda comporta
   a jornada necessária.
2. **Banda TARDE = abertura + S/5 slots** (`solver_ortools.py`, slot constraints do pass 2:
   `tarde_cutoff = S // 5` — bloqueia os primeiros 20% do dia). Com abertura 08:00 e
   fechamento 20:00 (S=48), a banda TARDE começa ~10:24.
3. **Janela de almoço sempre-hard** (`add_lunch_window_always_hard`) exige ~2h de
   trabalho ANTES das 11:00 para o almoço existir. Banda TARDE iniciando > ~09:00 não
   consegue → dia sem almoço → cap de 6h/dia (360min, H6).
4. **Semana de 44h precisa de ~2610min+** — qualquer mix de bandas com dias TARDE trava
   abaixo da meta → H10 hard infeasible → pass 1 morre → pass 2 relaxa DIAS_TRABALHO.

Com abertura 06:00, a TARDE começa ~08:48 ≤ 09:00, o almoço cabe, e o pass 1 fecha.

## Impacto

- UX: aviso de "ajustes" permanente em setores normais — dessensibiliza o RH pro aviso
  que importa de verdade (pass 3 / EXPLORATORY).
- Produto: `DIAS_TRABALHO` vira soft — na prática o penalty ainda empurra pra 5/6 dias
  (o spec `solver-6x1.spec.ts` passa em 08:00 com 6 dias), mas sem garantia.
- Performance: pass 1 INFEASIBLE custa pouco (~0.1s), não é problema de tempo.

## Opções de fix (avaliar pós-beta)

1. **Cutoff da banda TARDE limitado ao almoço**: `tarde_cutoff = min(S // 5, slots_ate(09:00))`
   — garante que a banda TARDE sempre comporta almoço. Cirúrgico, mexe só na conversão
   banda→slots do pass 2.
2. **Janela de almoço relativa à banda** em vez de absoluta (2h após o INÍCIO da jornada,
   não antes das 11:00 fixas) — mais correto semanticamente, mexe em constraint hard.
3. **Phase 1 modelar horas por banda** (capacidade de minutos da banda ≥ meta diária
   proratada) — o mais robusto e o mais invasivo.

Qualquer opção exige re-validar paridade com o validador TS e rodar a suite de
consistência (`docs/solver-consistency.md`).
