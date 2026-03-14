# CLAUDE.md

Guia curto para qualquer sessao futura que mexa no motor de escalas e no banco de desenvolvimento.

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

## Banco de desenvolvimento — regra para dev & CLI

- **Banco de dev é fonte de verdade.** Trate o PGlite local como estado do usuário, não como fixture descartável.
- **Nao acople reset/seed a comandos de dev.**
  - `npm run dev` **nunca** deve chamar `db:reset` ou rodar seed automaticamente.
  - CLIs (`npm run solver:cli`, scripts em `scripts/*.ts`) devem usar **sempre o banco atual**, a menos que o usuario peça o contrario.
- **Reset/seed so com comando explicito:**
  - `npm run db:reset` (e futuros `db:seed*`) so podem ser usados quando o usuario pedir ou quando a spec disser explicitamente para criar um banco novo.
  - Se precisar de cenarios com seed especifico para testes, use combinacoes explicitas tipo `npm run db:reset && npm run db:seed2` em vez de embutir isso em `dev` ou em CLI.
- **Padrao desejado para a IA:**
  - Quando sugerir como rodar algo, prefira:
    - `npm run dev` (usa banco atual)
    - `npm run solver:cli -- …` (usa banco atual)
  - So sugira `db:reset`/`db:seed*` se o contexto falar em "recriar do zero", "limpar banco" ou se o humano pedir claramente.

## Quando isso e obrigatorio

- alterou `solver/solver_ortools.py` ou `solver/constraints.py`;
- alterou `src/main/motor/validacao-compartilhada.ts`;
- alterou `src/main/motor/validador.ts`;
- alterou `src/main/motor/rule-policy.ts`;
- alterou `src/main/motor/solver-bridge.ts`;
- alterou `src/main/tipc.ts` ou persistencia de resumo oficial;
- alterou UI/IA que envia `solve_mode`, `generation_mode` ou `rules_override`.

## Trabalho em andamento (Painel Unico)

Se voce foi lancado como CLAUDE A, B ou C:
- **LEIA `specs/STATUS.md` ANTES DE QUALQUER ACAO**
- **LEIA seu prompt em `specs/prompts/PROMPT_CLAUDE_{A,B,C}_*.md`**
- **LEIA `specs/WARLOG_PAINEL_UNICO.md`** pra saber todas as 30 tasks
- **LEIA `docs/ANALYST_PAINEL_UNICO_ESCALA.md`** (38 secoes) pra entender o contexto
- **NADA e implementado sem validar com o Marco (usuario)**

## Referencias

- `tests/main/solver-cli-parity.spec.ts`
- `tests/main/rule-policy.spec.ts`
- `docs/PROMPT_SOLVER_CONSISTENCY.md`
