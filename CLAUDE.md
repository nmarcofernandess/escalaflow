# CLAUDE.md

Guia curto para qualquer sessao futura que mexa no motor de escalas.

## Regra de ouro

Se tocar em qualquer parte da consistencia entre solver Python, validador TypeScript, policy de regras, persistencia de indicadores ou configuracao de geracao, rode o teste de paridade antes de encerrar:

```bash
npm run solver:test:parity
```

## O que esse teste cobre

- roda o `solver:cli` real em modo `OFFICIAL`;
- usa cenarios reais de **Acougue** e **Rotisseria**;
- persiste o resultado em banco isolado;
- revalida com `validarEscalaV3()`;
- falha se houver drift entre solver e validador ou relaxamento ilegal de regra.

## Complementos uteis

```bash
npx vitest run tests/main/rule-policy.spec.ts
npm run solver:test
```

## Quando isso e obrigatorio

- alterou `solver/solver_ortools.py` ou `solver/constraints.py`;
- alterou `src/main/motor/validacao-compartilhada.ts`;
- alterou `src/main/motor/validador.ts`;
- alterou `src/main/motor/rule-policy.ts`;
- alterou `src/main/motor/solver-bridge.ts`;
- alterou `src/main/tipc.ts` ou persistencia de resumo oficial;
- alterou UI/IA que envia `solve_mode`, `generation_mode` ou `rules_override`.

## Referencias

- `tests/main/solver-cli-parity.spec.ts`
- `tests/main/rule-policy.spec.ts`
- `docs/PROMPT_SOLVER_CONSISTENCY.md`
