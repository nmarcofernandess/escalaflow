# Context Unificado + Redução de Tools (Phase 0)

> **Status:** Design escrito, aguardando review humano
> **Autor:** Marco + Codex
> **Data:** 2026-03-21
> **Referências:** `docs/como-funciona.md`, `docs/superpowers/specs/2026-03-21-observabilidade-sugestao-inteligente-design.md`, `specs/gestao-specs.md`, `src/main/ia/discovery.ts`, `src/main/ia/tools.ts`, `src/shared/simula-ciclo.ts`

---

## 1. TL;DR

O Phase 0 existe para resolver um problema simples e feio: a IA do EscalaFlow faz round-trip demais porque o contexto ainda é pobre justamente nos pontos que mais importam para RH.

A proposta recomendada e a seguinte:

1. **Expandir o discovery** com 5 reforcos cirurgicos:
   - preview do ciclo
   - perfis de horario relevantes do setor
   - titulos da base de conhecimento
   - preflight rapido de setor
   - mapa compacto das regras editaveis com status efetivo
2. **Reduzir as tools de 33 para 30**:
   - `preflight_completo` vira flag de `preflight`
   - `listar_perfis_horario` sai
   - `listar_conhecimento` sai
3. **Adicionar `--context` ao futuro `preview:cli`** para imprimir exatamente o markdown gerado por `buildContextBriefing()` para um setor.

Decisoes importantes:

- **Nenhuma tool de acao sai nesta fase.**
- **`explicar_violacao` fica.** Ainda e barata, deterministica e nao depende de RAG perfeito.
- **`ajustar_alocacao` e `ajustar_horario` ficam separados.** Consolidar write path nao reduz round-trip e aumenta ambiguidade.
- **Fonte de verdade do numero de tools e o codigo atual:** `src/main/ia/tools.ts` tem **33** tools. Alguns docs ainda falam em 34 e precisam ser corrigidos na implementacao.

---

## 2. Escopo

### Objetivos

- Fazer a IA enxergar o preview TS em contexto de setor.
- Mover para o discovery dados pequenos, estaveis e muito consultados.
- Reduzir round-trips desnecessarios no chat RH.
- Dar ao dev uma forma de inspecionar o mesmo briefing que a IA recebe.

### Nao objetivos

- Nao implementar nada nesta fase de design.
- Nao reescrever system prompt inteiro.
- Nao mudar semantica das tools de acao.
- Nao resolver o caso de **overrides locais nao persistidos** do preview no `SetorDetalhe`.
- Nao refatorar RAG/knowledge graph profundamente.

### Assumptions

- O alvo principal de paridade do `--context` e o **chat dentro do detalhe do setor**, nao o MCP externo.
- O preview em contexto, nesta fase, pode refletir o **estado persistido do setor**. Espelhar alteracoes locais ainda nao salvas fica fora do escopo.

---

## 3. Brainstorming 360

## Abordagem A — Context-first com poda cirurgica de tools

**Ideia:** enriquecer o discovery com dados pequenos e frequentes, mantendo as tools de leitura que sao query-specific, custosas ou abertas demais.

**Pros:**
- Reduz latencia de conversa imediatamente.
- Nao mexe em write path.
- Ataca a causa real das chamadas redundantes.
- Cria base para a Fase 1 da spec mae sem acoplamento desnecessario.

**Cons:**
- Aumenta o briefing.
- Exige guardrails claros de budget de tokens.

## Abordagem B — So adicionar preview e manter 33 tools

**Ideia:** fazer apenas `buildPreviewBriefing()` e adiar o audit de tools.

**Pros:**
- Menor risco de regressao.
- Menor superficie de mudanca.

**Cons:**
- Resolve so metade do problema.
- Mantem round-trips redundantes.
- Nao entrega o objetivo explicito desta Phase 0.

## Abordagem C — Criar camada de cache/reference separada

**Ideia:** em vez de discovery maior, criar um mini cache de referencia para dados estaveis (perfis, knowledge titles, regras).

**Pros:**
- Contexto principal cresce menos.
- Pode reaproveitar em outras interfaces.

**Cons:**
- Complexidade extra agora.
- Mais arquitetura do que resultado.
- Nao ajuda o `--context`, que precisa mostrar o briefing real.

## Recomendacao

**Escolha: Abordagem A.**

Ela resolve exatamente o que esta doendo agora, reduz tool count de forma real, e nao inventa infraestrutura nova so para se sentir sofisticada. A regra aqui e: contexto maior, sim; contexto gordo e cego, nao.

---

## 4. Estado Atual

### 4.1 Discovery atual: as 13 categorias injetadas hoje

**Observacao:** o header `## CONTEXTO AUTOMATICO — PAGINA ATUAL DO USUARIO` + `Rota:` nao entra na contagem abaixo. As 13 categorias reais sao os blocos de dados adicionados depois.

| # | Categoria atual | O que injeta | Origem | Tokens estimados |
|---|-----------------|--------------|--------|------------------|
| 1 | Memorias do RH | Ate 50 memorias em bullets | Query DB `ia_memorias` | 0-350 tipico, 450+ pior caso |
| 2 | Auto-RAG | Ate 3 fontes relevantes com titulo + `context_hint` | `searchKnowledge()` + query em `knowledge_sources` | 0-120 tipico, 180 max |
| 3 | Resumo do sistema | Contagem de setores, colaboradores e escalas | 4 queries de count | 20-35 |
| 4 | Feriados proximos | Feriados nos proximos 30 dias | Query DB `feriados` | 15-80 |
| 5 | Regras com override da empresa | So regras cujo status diverge do default | Join `regra_empresa` + `regra_definicao` | 20-120 |
| 6 | Setores disponiveis | Todos os setores ativos com horario e numero de colaboradores | Query `setores` + count por setor ou snapshot do setor atual | 90-160 |
| 7 | Setor em foco | Setor, colaboradores, postos, excecoes, regras de horario, demanda, escala atual, stats de alocacao | Queries de setor ou snapshot + queries complementares | 350-800 |
| 8 | Snapshot visual da tela | Setor visivel, ausentes, proximos ausentes, avisos, escala atual | `store_snapshot` do React/Zustand | 20-120 |
| 9 | Colaborador em foco | Perfil, contrato, regras e excecoes do colaborador atual | Queries em `colaboradores`, `colaborador_regra_horario`, `excecoes` | 120-280 |
| 10 | Alertas ativos | Poucos colaboradores, sem escala, violacoes HARD, escala desatualizada, excecao expirando | `coreAlerts()` com queries + `buildSolverInput()` para hash drift | 20-180 |
| 11 | Alerta de backup | Nunca fez backup ou backup velho | Query `configuracao_backup` + calculo de datas | 10-40 |
| 12 | Base de conhecimento | So stats: total de fontes e chunks | Counts em `knowledge_sources` e `knowledge_chunks` | 15-45 |
| 13 | Dica da pagina | Hint estatico por pagina (`dashboard`, `setor_detalhe`, etc.) | Mapa estatico em `discovery.ts` | 10-35 |

### 4.2 Medicao real do briefing atual

Medicao feita no banco local para `setor_id = 4` (`Padaria Atendimento`), com mensagem `"a distribuicao de folgas da padaria esta boa?"`:

- **Tamanho total:** `3738` chars, cerca de **935 tokens**
- **Secao dominante:** `Setor em foco` com cerca de **657 tokens**
- **Secao secundaria relevante:** `Setores disponiveis` com cerca de **129 tokens**
- **Auto-RAG:** nao trouxe nada neste sample (modelo de embedding local indisponivel, fallback keyword-only)

Conclusao: o briefing atual ainda cabe com folga, mas qualquer expansao cega vai engordar justamente onde ja pesa. A implementacao precisa de **gating por pagina** e **formatos compactos**, nao de despejo textual.

### 4.3 Observacoes importantes do estado atual

- `store_snapshot` ja expõe `demanda.porDia`, `cobertura.porDia`, `deficitDias`, `dirty` e `ciclo`, mas o discovery hoje usa so uma parte pequena disso.
- O preview TS real do `SetorDetalhe` nao esta no discovery.
- A secao `Setores disponiveis` aparece mesmo quando o usuario ja esta dentro de um setor e ela vira custo de contexto com baixo valor marginal.
- O tool server ja tem `GET /discovery?setor=...`, mas ele usa contexto sintetico `pagina: "externo"`, o que nao serve como paridade fiel do chat na pagina do setor.

---

## 5. Audit das 33 Tools

### 5.1 Leitura, diagnostico e referencia

Frequencia inferida a partir de:

- enfase no `system-prompt.ts`
- workflows em `docs/como-funciona.md`
- papel da tool no fluxo RH normal

| Tool | O que faz | Classe | Context poderia substituir? | Frequencia | Decisao | Justificativa |
|------|-----------|--------|-----------------------------|------------|---------|---------------|
| `buscar_colaborador` | Resolve colaborador por nome/ID e retorna retrato enriquecido | CONSULTA | **Nao** | Alta | MANTER | Busca fuzzy cross-app e retrato detalhado continuam query-specific. |
| `consultar` | Fallback generico para leitura estruturada no banco | CONSULTA | **Nao** | Alta | MANTER | E a valvula de escape do sistema. Contexto nunca cobre toda a entropia do banco. |
| `preflight` | Checa blockers e warnings basicos antes da geracao | CONSULTA | **Parcialmente** | Alta | MANTER como alvo da consolidacao | Um resumo basico cabe no context, mas a validacao por periodo continua sendo on-demand. |
| `preflight_completo` | Faz preflight ampliado com checks de capacidade | CONSULTA | **Parcialmente** | Media | CONSOLIDAR em `preflight(detalhado?: boolean)` | Mesmo dominio, mesma intencao, muda so profundidade. Contexto cobre o basico; tool unica cobre validacao exata por periodo. |
| `diagnosticar_escala` | Revalida uma escala e retorna diagnostico + proximas acoes | CONSULTA | **Nao** | Alta | MANTER | Recalcula estado real apos ajustes; contexto so mostra resumo estatico da ultima escala. |
| `explicar_violacao` | Explica codigo de regra/violacao | REFERENCIA | **Nao** | Baixa | MANTER | Injetar 35 explicacoes no context seria desperdicio. Tool e barata, deterministica e boa como fallback offline. |
| `diagnosticar_infeasible` | Multi-solve exploratorio para achar regras culpadas | DIAGNOSTICO | **Nao** | Media | MANTER | E caro, period-specific e nao faz sentido no context. |
| `resumir_horas_setor` | Agrega horas e dias por colaborador em um periodo | CONSULTA | **Nao** | Media | MANTER | Pedido claramente periodico e analitico. Contexto fixo nao substitui. |
| `listar_perfis_horario` | Lista perfis por tipo de contrato | CONSULTA | **Sim** | Baixa | ELIMINAR apos mover para context | Dados pequenos, raramente mudam e `consultar("contrato_perfis_horario")` ja existe como fallback generico. |
| `buscar_conhecimento` | Busca semantica na base de conhecimento | CONSULTA | **Nao** | Media | MANTER | Busca depende da pergunta; contexto so deve carregar catalogo leve, nao chunks. |
| `listar_conhecimento` | Lista fontes salvas com stats | CONSULTA | **Sim** | Baixa | ELIMINAR apos mover titulos para context | O caso comum e “o que temos salvo?”. Stats + top titulos no context resolvem isso sem round-trip. Se um dia precisar catalogo admin completo, o caminho certo e abrir `knowledge_sources` no `consultar`, nao ressuscitar listagem dedicada. |
| `explorar_relacoes` | Explora o knowledge graph por entidade | CONSULTA | **Nao** | Rara | MANTER | Traversal e investigacao especializada; contexto nao substitui. |

### 5.2 Acoes

| Tool | O que faz | Classe | Frequencia | Decisao | Justificativa |
|------|-----------|--------|------------|---------|---------------|
| `criar` | Cria registros genericos | ACAO | Media | MANTER | Write path. Context e read-only. |
| `atualizar` | Atualiza registros genericos | ACAO | Media | MANTER | Write path. |
| `deletar` | Remove registros permitidos | ACAO | Baixa | MANTER | Write path. |
| `salvar_posto_setor` | CRUD semantico de posto/titular | ACAO | Media | MANTER | Tool especializada e segura para posto. |
| `editar_regra` | Altera status de regra editavel | ACAO | Alta | MANTER | Acao central do dominio; nao pode virar context. |
| `gerar_escala` | Roda solver e persiste RASCUNHO | ACAO | Alta | MANTER | Core do produto. |
| `ajustar_alocacao` | Ajusta status da celula (TRABALHO/FOLGA/INDISPONIVEL) | ACAO | Media | MANTER SEPARADA | Altera semantica de status; merge com horario traria input ambiguidade sem reduzir round-trip. |
| `ajustar_horario` | Ajusta hora_inicio/hora_fim de uma alocacao | ACAO | Media | MANTER SEPARADA | Path de validacao e payload diferentes de `ajustar_alocacao`. |
| `oficializar_escala` | Oficializa escala sem violacao HARD | ACAO | Media | MANTER | Acao de lifecycle. |
| `cadastrar_lote` | Insercao em lote | ACAO | Media | MANTER | Write path com semantica propria. |
| `salvar_regra_horario_colaborador` | Cria/edita regra recorrente por colaborador | ACAO | Alta | MANTER | Acao muito frequente em RH. |
| `salvar_demanda_excecao_data` | Cria demanda excepcional por data | ACAO | Media | MANTER | Write path. |
| `upsert_regra_excecao_data` | Override pontual por colaborador/data | ACAO | Media | MANTER | Write path. |
| `resetar_regras_empresa` | Remove overrides e volta ao padrao | ACAO | Baixa | MANTER | Acao perigosa; contexto nao substitui. |
| `salvar_perfil_horario` | Cria/edita perfil de horario | ACAO | Baixa | MANTER | Mesmo com listagem indo para context, editar perfil continua sendo write. |
| `deletar_perfil_horario` | Remove perfil de horario | ACAO | Rara | MANTER | Write path. |
| `configurar_horario_funcionamento` | Ajusta horario da empresa ou setor | ACAO | Baixa | MANTER | Write path. |
| `salvar_conhecimento` | Ingesta texto na knowledge base | ACAO | Baixa | MANTER | Write path e nao substituivel. |
| `salvar_memoria` | Cria/atualiza memoria do RH | ACAO | Baixa | MANTER | Write path. |
| `remover_memoria` | Remove memoria do RH | ACAO | Baixa | MANTER | Write path. |
| `fazer_backup` | Cria snapshot operacional | ACAO | Rara | MANTER | Write path e operacao explicita. |

### 5.3 Resultado do audit

**Estado atual:** 33 tools

**Mudancas propostas nesta fase:**

1. `preflight_completo` absorvida por `preflight`
2. `listar_perfis_horario` removida
3. `listar_conhecimento` removida

**Estado alvo:** **30 tools**

### 5.4 Decisoes explicitamente rejeitadas nesta fase

| Candidata | Decisao | Motivo |
|-----------|---------|--------|
| `ajustar_alocacao` + `ajustar_horario` | Nao consolidar agora | Sao duas mutacoes diferentes. Consolidar nao reduz ida/volta e piora clareza do schema. |
| `explicar_violacao` | Nao matar agora | O ganho de contagem e pequeno e o fallback via RAG ainda nao e confiavel o suficiente para virar contrato. |

---

## 6. Expansao Proposta do Discovery

### 6.1 Principio

O discovery deve ganhar **dados pequenos, altamente recorrentes e baratos**, nao relatorios enormes. A pergunta certa nao e “isso cabe no context?” e sim:

> “isso evita uma tool call frequente sem empurrar ruido para todo turno?”

### 6.2 Propostas

| Nova informacao | Onde entra | Trigger | Conteudo | Impacto estimado | Decisao |
|-----------------|-----------|---------|----------|------------------|---------|
| Preview do ciclo | Nova secao `### Preview de ciclo` | `contexto.setor_id` | ciclo, N/K, cobertura por dia, deficit maximo, distribuicao de FF/FV, warnings top 3, disclaimer | +140 a +220 tokens | ENTRAR |
| Perfis de horario do setor | Subsecao dentro do setor em foco | `contexto.setor_id` + contratos presentes no setor | perfis ativos por contrato presente no setor, em formato compacto | +40 a +120 tokens | ENTRAR |
| Titulos da knowledge base | Expandir secao `Base de conhecimento` | sempre que houver fontes | stats atuais + top 10 titulos agrupados por tipo | +60 a +120 tokens | ENTRAR |
| Preflight rapido do setor | Nova secao `### Saude para geracao` | `contexto.setor_id` | blockers basicos e warnings basicos sem depender de periodo arbitrario | +40 a +90 tokens | ENTRAR |
| Regras editaveis com status atual | Expandir secao de regras | sempre | mapa compacto de status efetivo (`HARD`, `SOFT`, `OFF`, `ON`) sem descricao longa | +90 a +160 tokens | ENTRAR |

### 6.3 Preview de ciclo: formato recomendado

Exemplo de secao:

```md
### Preview de ciclo
- Ciclo: 2 semanas | N=5 | K=3
- Cobertura: SEG 4/4, TER 2/4, QUA 4/4, QUI 4/4, SEX 4/4, SAB 4/4, DOM 3/3
- Deficit maximo: 2 pessoa(s) na TER
- Folgas fixas: TER(2), SEX(1), SAB(1), DOM fixa(1)
- Folgas variaveis: SEG(1), QUA(1)
- Avisos: conflito de folga fixa na TER; cobertura insuficiente na TER
- Nota: preview e heuristico e pode divergir do solver final por almoco, interjornada e jornada maxima
```

### 6.4 Como obter o preview

`buildPreviewBriefing(setor_id)` deve:

1. montar o mesmo insumo estrutural do `SetorDetalhe`
2. rodar `gerarCicloFase1()` no main process
3. devolver um resumo curto, focado em cobertura e distribuicao

**Guardrail importante:** nesta fase o briefing pode refletir **dados persistidos** do setor. Nao e requisito espelhar overrides locais ainda nao salvos do componente React.

### 6.5 Perfis de horario do setor

Em vez de despejar todos os perfis do sistema, injetar so os perfis dos contratos presentes entre os colaboradores ativos do setor.

Formato recomendado:

```md
### Perfis de horario relevantes
- CLT 44h: sem perfis ativos
- Estagiario: MANHA_08_12 (08:00-12:00), TARDE_1330_PLUS (13:30-20:00), ESTUDA_NOITE_08_14 (08:00-14:00)
```

### 6.6 Titulos da knowledge base

Hoje o discovery so diz “9 fontes / 50 chunks”. Isso ajuda pouco.

Formato recomendado:

```md
### Base de conhecimento
- 9 fontes | 50 chunks indexados
- Titulos: clt - contratos; clt - feriados-cct; clt - intervalos-descanso; clt - jornada-regras; sistema - entidades; sistema - fluxos-trabalho; +3
```

### 6.7 Preflight rapido do setor

Isso **nao** substitui o preflight por periodo. Ele responde perguntas como:

- “esse setor esta minimamente pronto para gerar?”
- “tem algum blocker obvio antes de eu chamar o motor?”

Formato recomendado:

```md
### Saude para geracao
- Colaboradores ativos: 6
- Demandas cadastradas: 43 segmentos
- Blockers basicos: nenhum
- Warnings basicos: setor com capacidade apertada para a demanda media
```

### 6.8 Regras editaveis com status atual

Injetar **status**, nao descricoes longas. O discovery ja mostra overrides; falta a fotografia completa do estado efetivo.

Formato recomendado:

```md
### Regras editaveis (status efetivo)
- HARD: DIAS_TRABALHO, H1, H6, H10, MIN_DIARIO, H3_DOM_MAX_CONSEC_F, H3_DOM_MAX_CONSEC_M
- SOFT: H3_DOM_CICLO_EXATO
- ON: AP1, AP2, AP3, AP4, AP5, AP6, AP7, AP8, AP9, AP10, AP15, AP16, S_DEFICIT, S_SURPLUS, S_TURNO_PREF, S_CONSISTENCIA, S_SPREAD, S_AP1_EXCESS
- OFF: nenhuma
```

### 6.9 Guardrails de budget

Para o context nao virar um peru de Natal recheado de log inutil:

1. **Setores disponiveis completos** so em `dashboard`, `setor_lista` e `externo`.
2. Em `setor_detalhe`, manter apenas:
   - resumo global curto
   - setor em foco detalhado
   - preview
   - saude para geracao
3. **Titulos da knowledge base** cap em 10.
4. **Preview** cap em:
   - 1 linha de ciclo
   - 1 linha de cobertura
   - 1 linha de deficit
   - 1 linha de FF/FV
   - max 3 warnings
5. **Regras editaveis** em formato agrupado por status, nunca 28 linhas com descricao.

### 6.10 Budget alvo

Tomando o sample atual de ~935 tokens como base:

- preview: +180
- perfis: +80
- knowledge titles: +90
- preflight rapido: +60
- regras compactas: +120

**Delta bruto esperado:** +530 tokens

Com gating da secao `Setores disponiveis` fora de paginas de setor, o delta liquido deve cair para algo perto de **+350 a +430 tokens**.

**Meta operacional:** briefing tipico de detalhe de setor ficar em **<= 1500 tokens** sem Auto-RAG e **<= 1800 tokens** com Auto-RAG.

---

## 7. Reducao de Tools

### 7.1 Matriz final

| Tool atual | Destino | Justificativa |
|------------|---------|---------------|
| `preflight` | Mantida como `preflight` | Continua sendo a tool unica de validacao pre-geracao. |
| `preflight_completo` | Absorvida por `preflight(detalhado?: boolean)` | Mesma intencao, profundidade diferente. |
| `listar_perfis_horario` | Removida | Contexto cobre o caso comum; `consultar("contrato_perfis_horario")` cobre fallback. |
| `listar_conhecimento` | Removida | Contexto passa a carregar stats + titulos. Se surgir demanda real de catalogo completo, expor `knowledge_sources` via `consultar` e melhor que manter tool dedicada. |

### 7.2 Contagem

```text
33 atual
- 1  (merge preflight_completo -> preflight)
- 1  (remove listar_perfis_horario)
- 1  (remove listar_conhecimento)
= 30 tools
```

### 7.3 Contrato recomendado para `preflight`

Schema alvo:

```ts
preflight({
  setor_id: number,
  data_inicio: string,
  data_fim: string,
  detalhado?: boolean,
  regimes_override?: Array<{ colaborador_id: number; regime_escala: '5X2' | '6X1' }>
})
```

Sem `detalhado`, roda o caminho leve.
Com `detalhado: true`, incorpora os checks hoje feitos por `preflight_completo`.

### 7.4 O que nao deve ser removido

Mesmo sendo read-only:

- `consultar`
- `buscar_colaborador`
- `diagnosticar_escala`
- `diagnosticar_infeasible`
- `explicar_violacao`
- `buscar_conhecimento`
- `explorar_relacoes`
- `resumir_horas_setor`

Essas tools continuam necessarias porque o contexto nao consegue, nem deve, antecipar todas as perguntas detalhadas ou caras.

---

## 8. CLI `--context`

### 8.1 Objetivo

Dar ao dev uma forma de ver **o mesmo markdown** que o modelo recebe, sem abrir a UI e sem depender do tool server HTTP.

### 8.2 Contrato proposto

```bash
npm run preview:cli -- <setor_id> --context
```

### 8.3 Comportamento

Quando `--context` estiver presente, `scripts/preview-cli.ts` deve:

1. inicializar o DB igual ao `solver-cli`
2. validar se o setor existe
3. montar um `IaContexto` sintetico com:
   - `rota: /setores/<id>`
   - `pagina: setor_detalhe`
   - `setor_id: <id>`
4. chamar `buildContextBriefing()`
5. imprimir **somente** o markdown bruto no stdout

### 8.4 Decisao de design

`--context` deve ser **modo exclusivo**, nao “append” no output visual do preview.

Motivo: o objetivo e debugar contexto, nao misturar preview ANSI com briefing markdown e produzir uma sopa radioativa ilegivel.

### 8.5 O que esta fora desta fase

- `--message "..."` para simular Auto-RAG
- diffs entre contextos
- dump em JSON estruturado por secao
- paridade com `pagina: externo` do tool server

### 8.6 Relacao com o tool server atual

O `src/main/tool-server.ts` ja expõe `GET /discovery?setor=...`, mas:

- usa `pagina: "externo"`
- nao e a interface dev principal desejada
- nao substitui um CLI local de loop rapido

Logo, o `preview-cli --context` deve chamar `buildContextBriefing()` **direto**, nao via HTTP.

---

## 9. Riscos e Mitigacoes

| # | Risco | Impacto | Mitigacao |
|---|-------|---------|-----------|
| 1 | Contexto crescer demais | Latencia e custo sobem | Gating por pagina + formatos compactos + metas de budget |
| 2 | Preview em contexto divergir do que o usuario editou localmente | IA ainda nao ver “exatamente” a tela em casos de override local nao salvo | Assumir persistido nesta fase e documentar limite |
| 3 | Remover tool de listagem sem fallback claro | Regressao em perguntas de catalogo | Remover apenas listagens pequenas; para knowledge, contexto cobre o caso RH e um eventual fallback admin deve entrar via `consultar("knowledge_sources")` |
| 4 | Consolidar `preflight` quebrar callers existentes | Regressao silenciosa | Fazer consolidacao com compat shim durante implementacao |
| 5 | Docs continuarem falando em 34 tools | Confusao em chats futuros | Atualizar docs que citam 34 durante a implementacao do plan |

---

## 10. Critérios de Sucesso

1. **Mapeamento fechado:** as 13 categorias atuais do discovery e as 33 tools atuais estao documentadas nesta spec.
2. **Reducao objetiva:** `IA_TOOLS.length` cai de **33 para 30** sem remover nenhuma tool de acao.
3. **Discovery expandido:** briefing de setor inclui preview, perfis relevantes, knowledge titles, preflight rapido e status compacto de regras.
4. **Budget controlado:** briefing tipico de detalhe de setor fica em **<= 1500 tokens** sem Auto-RAG.
5. **CLI de debug:** `npm run preview:cli -- <setor_id> --context` imprime o markdown bruto do `buildContextBriefing()`.
6. **Fonte de verdade corrigida:** implementacao atualiza docs que ainda falam em 34 tools.

---

## 11. Checklist para o futuro plan

- [ ] Extrair builder compartilhado do preview para uso no main process
- [ ] Adicionar secao `Preview de ciclo` ao discovery
- [ ] Adicionar perfis relevantes por contrato do setor
- [ ] Expandir `Base de conhecimento` com top titulos
- [ ] Adicionar `Saude para geracao`
- [ ] Adicionar status compacto das regras editaveis
- [ ] Aplicar gating da secao `Setores disponiveis`
- [ ] Consolidar `preflight_completo` em `preflight`
- [ ] Remover `listar_perfis_horario`
- [ ] Remover `listar_conhecimento`
- [ ] Criar `scripts/preview-cli.ts` com `--context`
- [ ] Atualizar docs que citam 34 tools

---

## 12. Decisao Final

**Phase 0 deve ser implementada como um ajuste context-first, nao como refactor de acoes.**

Se o objetivo e fazer a IA parecer mais inteligente, o caminho nao e ensinar ela a chamar mais tool. E parar de esconder dela o que o proprio sistema ja sabe.
