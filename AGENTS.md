## Learned User Preferences

- Respostas do assistente em português.
- No tema shadcn do projeto, estados semânticos usam `success`, `warning` e `destructive`; não há token `danger` — para ações destrutivas ou erro usar `destructive`.
- Evitar tema de cor primária verde: o verde fica reservado a `--success`; primário verde colide com a semântica de sucesso.
- Preferir cores do tema (primary, secondary, muted, destructive, warning, success) em vez de paletas fixas por faixa, por índice ou por entidade na UI (demanda, escalas, contratos, gráficos), salvo quando o produto exigir contraste legítimo.

## Learned Workspace Facts

- Cada posto (função) tem `cor_hex` no modelo; tipos de contrato não têm cor. O fluxo principal de escala usa `CicloGrid`, que não pinta por `cor_hex`; a cor do posto só era relevante no `EscalaGrid` / legado ligado a `SetorEscalaSection`, fora do percurso atual das telas principais.
- A grelha do Ciclo Rotativo (`CicloGrid`) usa `<table>` HTML com Tailwind, não o componente `Table` do shadcn, porque o wrapper do Table (`overflow-auto`) interfere com o scroll próprio e com colunas `sticky`.
- O solver recebe demanda como padrão semanal (por dia da semana, mais exceções por data quando existem) fixa no input da corrida; não altera a demanda a meio. O que muda por dia são as alocações e horários escolhidos, não um “regime de demanda mensal” separado.
- Chunks de conhecimento para RAG no app vêm de `knowledge/**/*.md` no seed; `docs/` e `specs/` não são ingeridos automaticamente como conhecimento embutido.
- O chat embutido envia contexto via IPC a partir da rota e do snapshot da store; a CLI `ia:chat` não reproduz o mesmo `IaContexto` que o utilizador na página do setor.
- Os E2E com Playwright usam Electron real, PGlite e seed E2E quando `ESCALAFLOW_E2E=1`; não usam o base de dados de desenvolvimento pessoal.
