# AGENTS.md

## Learned User Preferences

- Use "EscalaFlow" as the product name in user-facing contexts; "horario" is only the repository/folder name.
- Máquina do Tempo must not appear inside the Backup dropdown; keep it as a separate button.
- Restore preview in sidebar: show only the restore icon; clicking it opens a popover (opaque background, not transparent) with Aplicar / Sair da visualização.

## Learned Workspace Facts

- Solver: the bridge (solver-bridge.ts) only orchestrates; the Python CP-SAT process does the actual solving. One process is spawned per "Gerar" (no persistent daemon).
- Warm-start hints reuse a previous scale's allocations as a starting point for the solver (performance); they do not define folga fixa/variavel (those come from constraints and cadastro).
- validarEscalaV3 computes indicators and comparacao_demanda in memory; persistirResumoAutoritativoEscala is the single place that writes to escala_comparacao_demanda (sync sequence after DELETE when needed, e.g. after backup restore).
- Setor "usar padrão" per day lives in setor_horario_semana; demand by time band in demandas. Export/import must restore both (UPSERT for setor_horario_semana, normalize booleans).
- Estagiário 30h is defined in seed and migration in contrato_perfis_horario (TARDE_1330_PLUS, ESTUDA_NOITE_08_14).
- Caixa has per-day demand in seed-local (caixaDemandas); Açougue uses a single pattern in seed-local.
