# Backlog — Solver Cross-Platform e Exportação

Data: 2026-02-20

## Contexto

O app já gera e empacota no macOS, mas o pacote Windows atual está incluindo o binário do solver compilado para macOS (`Mach-O`). Isso permite gerar instalador, porém não garante execução do solver no Windows real.

## Prioridade Alta

1. Build de solver por plataforma
- Gerar `solver-bin/escalaflow-solver` para macOS/Linux e `solver-bin/escalaflow-solver.exe` para Windows.
- Definir pipeline CI para build nativo de cada OS (ou matriz com runners por sistema).

2. Empacotamento por target
- No `electron-builder`, incluir apenas o binário compatível com o target.
- Evitar distribuir binário macOS dentro de build Windows.

3. Smoke test pós-empacotamento
- Rodar teste automático no artefato final:
  - abrir app,
  - chamar `escalas.gerar`,
  - validar retorno JSON do solver.

## Prioridade Média

4. Fallback controlado
- Se não encontrar binário nativo no runtime:
  - exibir erro claro no app com instrução de correção,
  - não tentar executar binário incompatível.

5. Telemetria de falha do solver
- Registrar erro de spawn/parse por plataforma para diagnóstico rápido.

## Exportação (HTML/PDF/CSV)

6. QA de export por plataforma
- Validar fluxos `export.salvarHTML`, `export.imprimirPDF`, `export.salvarCSV` em:
  - macOS,
  - Windows,
  - Linux.

7. Consistência visual no PDF
- Garantir que impressão PDF mantém layout em WebContents de cada OS (margens, fontes e quebra de página).

## Critério de “Done”

- `dist:mac`, `dist:win`, `dist:linux` com solver executável nativo em cada pacote.
- `escalas.gerar` funcionando nos três targets.
- Exportação HTML/PDF/CSV validada manualmente nos três targets.
