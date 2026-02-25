# Status de Execucao das Fases (Tool Calling + Testes)

Data de referencia: `2026-02-24`

## Resumo

- Fase 1 (fundacao de testes): concluida
- Fase 2 (contrato das tools + `.describe()`): base concluida / consolidada
- Fase 3 (discovery + prompt + historico): muito avancada (core implementado)
- Fase 4 (tools semanticas): concluida (escopo revisado) + Onda 2 parcial adiantada
- Cleanup v2: concluido (33→30 tools, 7 burrices corrigidas, deduplicacao)
- Fase 5+ (runtime/evals/CI): iniciadas em infra, pendentes em comportamento
- Catalogo teorico target de tools (double-check com doc canonico): consolidado

## Fase 1 — Fundacao de testes

Status: `CONCLUIDA`

Entregas implementadas:

- `Vitest` + `RTL` + `jsdom`
- `Playwright` (placeholder E2E)
- scripts `test`, `test:e2e`, `test:ia:eval`, `test:ia:live`
- setup de testes (`tests/setup/*`)
- testes de:
  - tools
  - runtime mapper (`cliente.ts`)
  - UI de tool calls

Validacao:

- `npm test` OK
- `npm run typecheck` OK

## Fase 2 — Contrato das tools

Status: `MUITO AVANCADA (CORE CONCLUIDO)`

Entregas implementadas:

- helpers de contrato:
  - `toolOk`
  - `toolError`
  - `toolTruncated`
- normalizacao de erros (`status`, `code`, `message`, `correction`)
- `.describe()` em schemas Zod criticos
- fix da geracao de JSON Schema (`z.toJSONSchema()` / fallback)
- `consultar` refatorado para retorno rico + humanizacao de FKs
- padronizacao de todas as tools em `executeTool()`
- compat legado preservada (`sucesso`, `erro`, `mensagem`, `aviso`)

Observacao importante:

- `gerar_escala` agora usa `solver_status` para o status do solver.
- `status` (top-level) passou a representar o contrato da tool (`ok/error/truncated`).

Validacao:

- testes dedicados cobrindo tools principais e restantes
- `npm test` e `npm run typecheck` OK

## Fase 3 — Discovery + prompt + historico

Status: `MUITO AVANCADA (CORE IMPLEMENTADO) — AGUARDANDO REVIEW FUNCIONAL FINAL`

Estado atual:

- `SYSTEM_PROMPT` foi reescrito com base em spec e doc canonico (`COMO_O_SISTEMA_FUNCIONA.md`)
- prompt passou por reescrita estrutural (fase inicial) e foi posteriormente expandido para acomodar novas tools/fluxos semanticos
- redundancias de `get_context`, CSV e erros tecnicos foram removidas/comprimidas
- Cleanup v2 removeu `get_context` do registry; discovery auto + `consultar` + `buscar_colaborador` cobrem 100%
- overlay de runtime (band-aid de discovery) foi removido apos a reescrita
- historico do modelo manteve melhoria de continuidade via resumo compacto de tool calls

Entregas implementadas:

- historico do modelo passou a incluir:
  - resumo compacto de `tool_calls` em mensagens de assistente
  - `tool_result` legado compactado (quando existir)
- reescrita completa de `src/main/ia/system-prompt.ts` (estrutura 6 secoes)
- remocao do overlay de runtime em `cliente.ts`
- ajuste do dataset de eval para `resumo_sistema` deprecated (espera `get_context`)
- remocao de `resumo_sistema` do registry de tools e do `executeTool()` (mantido apenas como referencia em docs legados)
- teste de runtime cobrindo historico e montagem de prompt sem overlay
- eval batch local validando comportamento base: `5/5` (dataset atual)

Observacao:

- Ainda falta review funcional com cenarios reais do operador para considerar a Fase 3 \"fechada\" (principalmente intents de RH mais complexas e multi-turno).

## Fase 6/7 (infra de eval + debug)

Status: `INICIADA`

Entregas implementadas:

- `@ai-sdk/devtools` instalado
- scripts `test:ia:eval` e `test:ia:live`
- `run-evals.ts` (DIY batch com dataset + scorers + resumo)
- runner evoluido para cenarios reais com DB local + rollback de mutacoes (savepoint)
- `live-smoke.ts` (smoke de provider + tool calling)
- integracao do middleware DevTools no runtime (`cliente.ts`) em modo local/dev

Pendencias:

- ampliar dataset/evals por ambiente (IDs/cenarios reais adicionais da base)
- integrar eval no CI (fase futura)

## Fase 4 (tools semanticas)

Status: `CONCLUIDA (ESCOPO REVISADO) + ONDA 2 PARCIAL ADIANTADA`

Entregas implementadas (documentacao/arquitetura):

- catalogo teorico completo de tools target em `docs/flowai/CATALOGO_TARGET_TOOLS_IA.md`
- consolidacao de propostas antigas + gaps do doc canonico `COMO_O_SISTEMA_FUNCIONA.md`
- priorizacao por ondas (P0/P1/P2/P3) para evitar over-engineering

Entregas implementadas (codigo/runtime):

- novas tools semanticas no registry/runtime:
  - `buscar_colaborador`
  - `preflight_completo`
  - `salvar_regra_horario_colaborador`
  - `definir_janela_colaborador`
  - `ajustar_horario`
  - `diagnosticar_escala`
- semanticas/operacionais adicionais (Onda 2 parcial) ja implementadas:
  - `salvar_demanda_excecao_data`
  - `upsert_regra_excecao_data`
  - `resumir_horas_setor`
  - `resetar_regras_empresa`
  - `listar_perfis_horario`
  - `salvar_perfil_horario`
  - `deletar_perfil_horario`
  - `configurar_horario_funcionamento`
  - `obter_alertas`
- poda estrategica aplicada (wrappers que duplicavam genericas foram removidos do registry/runtime):
  - `listar_setores`
  - `listar_colaboradores_do_setor`
  - `obter_escala_atual`
  - `criar_excecao`
- prompt sincronizado com o registry real (28 tools):
  - estrategia "genericas primeiro / semanticas quando ha logica propria"
  - guia de `preflight` vs `preflight_completo`
  - cobertura de demanda excepcional, perfis de horario, horario de funcionamento e alertas
- testes unitarios dedicados para tools semanticas
- `run-evals.ts` ajustado com `temperature: 0` para reduzir flakiness do batch gate
- batch eval atual (DB real + rollback em mutacoes): `20/20`

Observacao:

- A Fase 4 foi considerada **concluida no escopo revisado**:
  - sem wrappers CRUD/read redundantes
  - com fallback generico preservado
  - com semanticas de logica propria da Onda 1 / P0 implementadas
- Parte da Onda 2 foi adiantada (demanda por data, perfis, alertas, KPI, reset), mantendo a mesma regra de justificativa.
- Onda 2+ restante continua backlog futuro (nao bloqueia fechamento da Fase 4) e deve seguir a mesma regra: so tools com logica propria.

### Cleanup v2 (2026-02-24)

Audit cross-reference com TOOL_CALLING_PLAYBOOK.md resultou em:

Removidas (3 tools redundantes — 33→30):
- `get_context` (discovery auto ja injeta contexto a cada request)
- `obter_regra_horario_colaborador` (buscar_colaborador single-match enriquecido cobre)
- `obter_regras_horario_setor` (discovery do setor agora inclui regras + conflitos de folga)

Burrices corrigidas:
- BURRICE-1: Discovery duplicado corrigido (descriptions nao mandam mais "chame get_context primeiro")
- BURRICE-2: TOOL_RESULT_MAX_CHARS 400→1500 + smart truncation preservando summary/_meta
- BURRICE-4: Summary automatico em `consultar` (buildConsultarSummary por entidade)
- BURRICE-6: Follow-up com tools habilitado (ambos paths streaming/non-streaming)
- GAP-5: `atualizar` agora aceita `excecoes`

Deduplicacoes:
- TOSCO-1: `coreAlerts()` extraido — `obter_alertas` e `_alertasProativos()` compartilham logica
- TOSCO-2: `applyColaboradorDefaults()` extraido — `criar` e `cadastrar_lote` compartilham defaults

Enriquecimentos:
- Discovery do setor enriquecido com regras de horario individuais + deteccao de conflitos de folga fixa
- `colaborador_regra_horario` adicionada aos whitelists de `consultar`
- `excecoes` adicionada aos whitelists de `atualizar`

Validacao: tsc 0 erros, 30/30 IA_TOOLS = TOOL_SCHEMAS, 0 refs fantasma a tools removidas.

## Proximos passos recomendados (ordem)

1. Rodar `DevTools` local e validar traces reais de 3 cenarios.
2. Rodar review funcional real da Fase 3 (cenarios do operador / multi-turno).
3. Expandir `test:ia:eval` com cenarios reais da base local (RH multi-turno / ajustes).
4. Subir CI com gates (`typecheck`, `test`, `test:ia:eval`).
5. Implementar SPEC-REGRA-HORARIO-DIA-SEMANA.md (regra por dia da semana).
