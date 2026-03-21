# Context Unificado + Reducao de Tools (Phase 0)

> **Status:** Design revisado apos review de arquitetura
> **Autor:** Marco + Codex
> **Data:** 2026-03-21
> **Referencia mae:** `docs/superpowers/specs/2026-03-21-observabilidade-sugestao-inteligente-design.md`
> **Referencias:** `docs/como-funciona.md`, `docs/ia-sistema.md`, `specs/gestao-specs.md`, `src/main/ia/discovery.ts`, `src/main/ia/tools.ts`, `src/shared/simula-ciclo.ts`, `tests/ia/live/ia-chat-cli.ts`

---

## 1. TL;DR

O problema nao e so "faltou preview no discovery". O problema real e de **granularidade errada**:

- o contexto ainda e pobre nos pontos que importam
- varias tools expostas ao LLM estao no nivel da storage, nao no nivel da tela ou do dominio
- a CLI atual de IA nao reproduz o contexto real do app e nem inicializa o banco

Esta revisao muda a direcao da spec:

1. **Phase 0 continua reduzindo o custo imediato do chat RH**:
   - adicionar preview ao context
   - mover dados pequenos e estaveis para o discovery
   - cortar listagens redundantes
   - manter o alvo de reducao interna de **33 -> 30 tools**
2. **Mas o North Star muda**:
   - o contrato publico futuro nao deve ser `33 tools atomicas`
   - o contrato publico deve convergir para poucas familias reutilizaveis:
     - `consultar_contexto`
     - `editar_ficha`
     - `executar_acao`
     - opcionalmente `buscar_rag`
     - opcionalmente `salvar_memoria`
3. **A base de contexto precisa virar asset reutilizavel**, nao string montada no improviso:
   - `buildContextBundle()` monta um objeto estruturado
   - `renderContextBriefing()` transforma esse bundle em markdown para o LLM
4. **A CLI de IA atual falha como harness de validacao**:
   - nao chama `initDb()`
   - importa `buildContextBriefing` e nao usa
   - portanto hoje ela nao testa o design context-first de verdade

Conclusao: o corte de tools desta fase continua valido como passo tatico, mas a arquitetura correta para outros projetos e **contexto agregador + formulario schema-driven + comandos de dominio**, nao um zoologico de tool por tabela.

---

## 2. Escopo

### Objetivos

- Fazer a IA enxergar o preview TS e a saude real de um setor.
- Mover para o context aquilo que hoje so existe em tools de listagem ou consulta repetitiva.
- Definir uma **base de contexto estruturada** que sirva ao EscalaFlow e a outros projetos.
- Definir um **contrato publico de tools** mais reutilizavel que o conjunto atual.
- Dar ao dev um jeito real de inspecionar o mesmo contexto usado pela IA.

### Nao objetivos

- Nao implementar a consolidacao completa da superficie publica nesta fase.
- Nao reescrever o system prompt inteiro.
- Nao refatorar todo o write path agora.
- Nao resolver overrides locais ainda nao persistidos no `SetorDetalhe`.
- Nao redesenhar RAG/knowledge graph inteiro.

### Assumptions

- O alvo principal de paridade continua sendo o **chat no detalhe do setor**.
- O preview em contexto, nesta fase, pode refletir o **estado persistido**.
- O corte para 30 tools e uma meta **interna/tatica**.
- O contrato reutilizavel futuro pode esconder ferramentas internas sem necessariamente apagar handlers internos no primeiro passo.

---

## 3. Reenquadramento da Arquitetura

### 3.1 O erro atual

Hoje o LLM ve tools demais no nivel errado:

- `listar_perfis_horario` quando o dominio certo e `contrato`
- `salvar_demanda_excecao_data` quando o dominio certo e `ficha do setor`
- `ajustar_horario` quando o dominio certo e `patch de celula da escala`
- `listar_conhecimento` quando o dominio certo e pipeline de RAG

Isso funciona localmente, mas nao escala bem para:

- outros projetos
- formularios schema-driven
- contextos agregados por tela
- contratos publicos mais estaveis

### 3.2 Contrato publico futuro recomendado

O LLM deveria convergir para poucas familias:

#### A. `consultar_contexto`

Tool de leitura agregada, orientada a dominio/tela.

Exemplo:

```ts
consultar_contexto({
  entidade: 'setor',
  id: 4,
  visao: 'operacional',
  includes: [
    'colaboradores',
    'postos',
    'ausencias',
    'escala_atual',
    'preview_ciclo',
    'deficits_por_dia',
    'cobertura_por_faixa',
    'regras_efetivas',
  ],
})
```

#### B. `editar_ficha`

Tool schema-driven de formulario.

Exemplo:

```ts
editar_ficha({
  entidade: 'setor',
  id: 4,
  patch: {
    nome: 'Padaria Atendimento',
    horario_funcionamento: { sabado_fecha_as: '20:00' },
  },
})
```

#### C. `executar_acao`

Tool para comandos de dominio com semantica propria.

Exemplo:

```ts
executar_acao({
  entidade: 'escala',
  acao: 'gerar',
  args: { setor_id: 4, data_inicio: '2026-03-01', data_fim: '2026-03-31' },
})
```

#### D. `buscar_rag` (opcional)

So se o pipeline nao fizer retrieval antes do LLM. Se o app ja intercepta e injeta contexto semantico antes da pergunta, essa tool nem precisa ficar exposta no chat.

#### E. `salvar_memoria` (opcional)

Curta, operacional, explicita. Diferente de ingestao de conhecimento.

### 3.3 Regra pratica

- **Contexto agregado** substitui listagens pequenas e leituras repetitivas.
- **Formulario schema-driven** absorve varios `criar/atualizar/salvar_*`.
- **Comando de dominio** mantem coisas que realmente sao workflow, processamento pesado ou side effect importante.

---

## 4. Estado Atual

### 4.1 Discovery atual: 13 categorias

| # | Categoria atual | O que injeta | Origem | Tokens estimados |
|---|-----------------|--------------|--------|------------------|
| 1 | Memorias do RH | Ate 50 memorias em bullets | Query DB `ia_memorias` | 0-350 tipico |
| 2 | Auto-RAG | Ate 3 fontes relevantes com titulo + `context_hint` | `searchKnowledge()` + DB | 0-180 |
| 3 | Resumo do sistema | Contagem de setores, colaboradores e escalas | 4 queries de count | 20-35 |
| 4 | Feriados proximos | Feriados nos proximos 30 dias | Query DB `feriados` | 15-80 |
| 5 | Regras com override da empresa | So regras que divergem do default | Join `regra_empresa` + `regra_definicao` | 20-120 |
| 6 | Setores disponiveis | Todos os setores ativos com horario e numero de colaboradores | Query `setores` + counts/snapshot | 90-160 |
| 7 | Setor em foco | Setor, colaboradores, postos, excecoes, regras, demanda, escala atual | Snapshot + queries complementares | 350-800 |
| 8 | Snapshot visual da tela | Setor visivel, ausentes, avisos, escala atual | React/Zustand `store_snapshot` | 20-120 |
| 9 | Colaborador em foco | Perfil, contrato, regras e excecoes | Queries em `colaboradores` + regras + excecoes | 120-280 |
| 10 | Alertas ativos | Poucos colaboradores, sem escala, violacoes HARD, drift | Queries + hash drift | 20-180 |
| 11 | Alerta de backup | Nunca fez backup ou backup velho | Query `configuracao_backup` | 10-40 |
| 12 | Base de conhecimento | So stats agregadas | Counts em `knowledge_sources/chunks` | 15-45 |
| 13 | Dica da pagina | Hint estatico por pagina | Mapa estatico | 10-35 |

### 4.2 Medicao real do briefing atual

Medicao local para `setor_id = 4`:

- total: `3738` chars
- cerca de **935 tokens**
- secao dominante: `Setor em foco`

Conclusao: ainda ha espaco para crescer, mas nao para despejar tabela inteira do banco. O caminho e **pacote operacional enxuto**, nao dump bruto.

### 4.3 Problemas estruturais hoje

- O preview TS nao entra no discovery.
- O discovery ainda pensa em string, nao em bundle reutilizavel.
- O conjunto de tools exposto ainda esta muito perto da storage.
- A CLI `ia:chat` nao reproduz o contexto real do app.

---

## 5. Base de Contexto Necessaria

### 5.1 Mudanca estrutural recomendada

Em vez de `buildContextBriefing()` montar tudo direto em markdown, a base correta e:

1. `buildContextBundle(contexto, mensagem?)`
2. `renderContextBriefing(bundle)`

Isso permite:

- reuso em outros projetos
- CLI com dump real em markdown ou JSON
- testes por secao
- contratos mais claros para `consultar_contexto`

### 5.2 Bundle minimo global

```ts
{
  global: {
    empresa: { id, nome, timezone, grid_minutos },
    contratos: [
      {
        id,
        nome,
        jornada_padrao,
        perfis_horario: [{ id, nome, inicio, fim, ativo }],
      },
    ],
    regras_efetivas: {
      hard: string[],
      soft: string[],
      on: string[],
      off: string[],
    },
    knowledge_catalogo: {
      total_fontes: number,
      total_chunks: number,
      titulos_top: string[],
    },
    alertas_globais: Alert[],
  },
}
```

### 5.3 Bundle minimo de setor

```ts
{
  setor: {
    meta: {
      id,
      nome,
      horario_funcionamento,
      dirty,
    },
    equipe: {
      ativos: number,
      em_posto: PessoaResumo[],
      reserva_operacional: PessoaResumo[],
      ausentes: AusenciaResumo[],
      proximos_ausentes: AusenciaResumo[],
      usando_padrao: number,
      usando_especifico: number,
    },
    postos: {
      ocupados: PostoResumo[],
      em_espera: PostoResumo[],
    },
    demanda: {
      segmentos_semanais: number,
      por_dia: DiaResumo[],
      por_faixa_top: FaixaResumo[],
    },
    preview: {
      ciclo,
      cobertura_por_dia,
      deficit_por_dia,
      ff_fv,
      warnings,
    },
    escala_atual: {
      id,
      status,
      resumo_user,
      cobertura_percent,
      violacoes_hard,
      violacoes_soft,
      pode_oficializar,
      desatualizada,
    },
    historico_curto: {
      ultimas_escalas: EscalaResumo[],
      ultimas_falhas: FalhaGeracaoResumo[],
    },
  },
}
```

### 5.4 Bundle minimo de colaborador

```ts
{
  colaborador: {
    ficha,
    contrato,
    posto_atual,
    regras_recorrentes,
    excecoes_por_data,
    excecoes_ausencia,
  },
}
```

### 5.5 O que NAO entra no context por padrao

- grid completo de alocacoes
- chunks inteiros da knowledge base
- logs brutos de solver
- historico completo de escalas
- todas as relacoes do knowledge graph

Esses dados ficam para:

- `consultar` interno
- `consultar_contexto(..., visao='detalhada')`
- tool analitica especifica

### 5.6 Secoes obrigatorias para o detalhe do setor

| Secao | Conteudo minimo | Objetivo |
|------|------------------|----------|
| Resumo curto | contadores e alertas | orientacao rapida |
| Setor em foco | equipe, postos, ausencias, demanda | contexto operacional |
| Preview de ciclo | ciclo, cobertura, deficit, FF/FV, warnings | qualidade antes do solver |
| Escala atual | status, resumo_user, drift, pode_oficializar | conversa sobre escala |
| Regras efetivas | agrupadas por status | evitar tool de consulta de regra |
| Contratos relevantes | contratos presentes com perfis embutidos | matar listagem separada |
| Conhecimento | stats + top titulos | matar `listar_conhecimento` |

### 5.7 Budget alvo do contexto de setor

| Bloco | Alvo |
|------|------|
| Resumo curto | 40-80 tokens |
| Setor em foco | 350-600 |
| Preview | 140-220 |
| Escala atual | 80-140 |
| Regras efetivas | 90-140 |
| Contratos + perfis | 60-120 |
| Knowledge catalogo | 50-100 |

**Meta operacional:** contexto tipico de detalhe de setor em **<= 1500 tokens** sem Auto-RAG e **<= 1800 tokens** com Auto-RAG.

---

## 6. Audit das 33 Tools

### 6.1 Leitura, diagnostico e referencia

| Tool | Classe | Phase 0 | North Star | Justificativa |
|------|--------|---------|------------|---------------|
| `buscar_colaborador` | CONSULTA | MANTER | ABSORVER em `consultar_contexto(colaborador)` | Hoje ainda resolve fuzzy + ficha rica; no futuro isso e visao de contexto. |
| `consultar` | CONSULTA | MANTER | MANTER interno como fallback | Continua sendo valvula de escape tecnica. |
| `preflight` | VALIDACAO | MANTER | VIRAR `executar_acao('preflight')` ou visao especifica | Continua necessario por periodo. |
| `preflight_completo` | VALIDACAO | CONSOLIDAR em `preflight(detalhado?: boolean)` | ABSORVER na mesma acao | Mesmo dominio, profundidade diferente. |
| `diagnosticar_escala` | DIAGNOSTICO | MANTER TEMPORARIAMENTE | ABSORVER em `consultar_contexto(escala)` | So deixa de existir quando toda mutacao recalcular e persistir o resumo canonico automaticamente. |
| `explicar_violacao` | REFERENCIA | MANTER TEMPORARIAMENTE | ABSORVER em dicionario/contexto | Boa enquanto o dicionario ainda nao estiver bem ancorado no context. |
| `diagnosticar_infeasible` | DIAGNOSTICO | MANTER TEMPORARIAMENTE | ABSORVER em historico de falhas persistido | Se a geracao falha e a causa fica salva no historico, a tool separada perde sentido. |
| `resumir_horas_setor` | ANALITICA | MANTER | PODE VIRAR visao de `consultar_contexto` | Continua sendo pergunta periodica util. |
| `listar_perfis_horario` | CONSULTA | REMOVER | ABSORVIDA pelo contexto de contrato | Perfil de horario e dado de contrato, nao tool publica. |
| `buscar_conhecimento` | RAG | MANTER | OPCIONAL | So fica exposta se o retrieval nao acontecer antes do LLM. |
| `listar_conhecimento` | CONSULTA | REMOVER | NAO EXISTE no contrato publico | Catalogo pequeno deve estar no contexto. |
| `explorar_relacoes` | KNOWLEDGE | MANTER FORA DO CHAT RH | ADMIN/DEBUG APENAS | Muito especializada para ficar no surface padrao. |

### 6.2 Acoes de cadastro, ficha e escala

| Tool | Classe | Phase 0 | North Star | Justificativa |
|------|--------|---------|------------|---------------|
| `criar` | ACAO | MANTER | ABSORVER em `editar_ficha` | Form schema-driven cobre bem criacao generica. |
| `atualizar` | ACAO | MANTER | ABSORVER em `editar_ficha` | Mesmo motivo. |
| `deletar` | ACAO | MANTER | `executar_acao('remover')` ou fluxo admin | Remocao continua acao explicita. |
| `salvar_posto_setor` | ACAO | MANTER | ABSORVER em `editar_ficha(setor/postos)` | Posto e subdominio da ficha de setor. |
| `editar_regra` | ACAO | MANTER | `editar_ficha(regras)` | Continua write path. |
| `gerar_escala` | ACAO | MANTER | `executar_acao('gerar_escala')` | Core do produto. |
| `ajustar_alocacao` | ACAO | MANTER | `executar_acao('patch_celula')` | Hoje e patch de status numa celula. |
| `ajustar_horario` | ACAO | MANTER | `executar_acao('patch_celula')` | Hoje e patch de horario numa celula. Nome atual vaza implementacao. |
| `oficializar_escala` | ACAO | MANTER | `executar_acao('oficializar_escala')` | Lifecycle de dominio. |
| `cadastrar_lote` | ACAO | MANTER | `editar_ficha(..., modo='lote')` ou acao separada | Batch continua util. |
| `salvar_regra_horario_colaborador` | ACAO | MANTER | ABSORVER em `editar_ficha(colaborador)` | Regra recorrente faz parte da ficha do colaborador. |
| `salvar_demanda_excecao_data` | ACAO | MANTER | ABSORVER em `editar_ficha(setor.demanda)` | Faz parte da ficha operacional do setor. |
| `upsert_regra_excecao_data` | ACAO | MANTER | ABSORVER em `editar_ficha(colaborador.excecoes)` | Tambem ficha, nao tool publica isolada. |
| `resetar_regras_empresa` | ACAO | MANTER so como admin | VIRAR fluxo manual/admin | Nao e tool central do chat RH. |
| `salvar_perfil_horario` | ACAO | MANTER | ABSORVER em `editar_ficha(contrato)` | Perfil pertence ao contrato. |
| `deletar_perfil_horario` | ACAO | MANTER | ABSORVER em `editar_ficha(contrato)` ou admin | Mesmo motivo. |
| `configurar_horario_funcionamento` | ACAO | MANTER | ABSORVER em `editar_ficha(empresa/setor)` | E formulario, nao comando especial. |

### 6.3 Knowledge, memoria e operacao

| Tool | Classe | Phase 0 | North Star | Justificativa |
|------|--------|---------|------------|---------------|
| `salvar_conhecimento` | ACAO | RETIRAR DO CHAT RH | BACKOFFICE APENAS | Ingestao de conhecimento e tarefa admin, nao conversa comum com a IA. |
| `salvar_memoria` | ACAO | MANTER | MANTER opcional | Memoria curta continua valida no chat. |
| `remover_memoria` | ACAO | MANTER | `editar_ficha(memoria)` ou acao leve | Continua util se o chat pode esquecer algo. |
| `fazer_backup` | ACAO | MANTER FORA DO USO COMUM | `executar_acao('backup')` admin | Operacao explicita, rara e administrativa. |

### 6.4 Contagem e leitura correta da meta

**Meta tatico-interna do Phase 0:**

```text
33 atual
- 1  (merge preflight_completo -> preflight)
- 1  (remove listar_perfis_horario)
- 1  (remove listar_conhecimento)
= 30 tools internas expostas
```

**North Star publico:**

- 3 tools nucleares
- 2 tools opcionais
- fallback tecnico interno nao precisa desaparecer do codigo no primeiro passo

---

## 7. Reducao de Tools: decisao final desta fase

### 7.1 Remocoes e consolidacao obrigatorias

| Tool atual | Destino | Motivo |
|------------|---------|--------|
| `preflight_completo` | `preflight(detalhado?: boolean)` | Mesma intencao, profundidade diferente |
| `listar_perfis_horario` | sai da superficie | Dado pequeno e estavel, deve vir via contrato/contexto |
| `listar_conhecimento` | sai da superficie | Catalogo pequeno e estavel, deve vir via contexto |

### 7.2 Reclassificacoes importantes

Mesmo que continuem existindo por enquanto:

- `diagnosticar_escala` deixa de ser pilar arquitetural; passa a ser compensacao temporaria por falta de persistencia canonica apos ajuste manual
- `diagnosticar_infeasible` deixa de ser pilar arquitetural; passa a ser compensacao temporaria por falta de historico de falha rico
- `salvar_conhecimento`, `explorar_relacoes`, `resetar_regras_empresa`, `fazer_backup` saem do centro do chat RH e viram superficie admin/opcional

### 7.3 O que nao deve ser colapsado cedo demais

- `gerar_escala`
- `oficializar_escala`
- `patch de celula da escala`
- `backup`

Essas continuam sendo comandos de dominio, nao formularios.

---

## 8. CLI, Harness e Teste Real

### 8.1 `preview:cli --context`

Continua obrigatorio.

Contrato proposto:

```bash
npm run preview:cli -- <setor_id> --context
```

Comportamento:

1. inicializa DB
2. resolve setor
3. monta `IaContexto` sintetico realista:
   - `pagina: 'setor_detalhe'`
   - `rota: '/setores/<id>'`
   - `setor_id: <id>`
4. chama `buildContextBundle()`
5. renderiza com `renderContextBriefing()`
6. imprime markdown bruto

### 8.2 `ia:chat` precisa virar harness de verdade

Hoje a CLI de chat deveria servir para validar o design context-first. Nao serve.

Ela precisa ganhar no minimo:

- `initDb()` antes de tool calls
- `--setor <id>`
- `--pagina <pagina>`
- injecao real de `buildContextBriefing()` no system/context da conversa

Sem isso, o teste da IA ao vivo mede outra coisa.

### 8.3 Teste executado nesta revisao

Comando rodado em `2026-03-21`:

```bash
printf 'a distribuicao de folgas da padaria esta boa?\nsair\n' | npm run ia:chat -- --provider gemini
```

Resultado observado:

1. a CLI sobe e carrega `33 tools`
2. o modelo chama `consultar({ entidade: 'setores', filtros: { nome: 'Padaria' } })`
3. a tool falha com:

```text
DB not initialized. Call initDb() first.
```

4. a resposta final ao usuario vira erro generico

### 8.4 Onde a CLI atual "toma no cu"

Finding 1:

- `tests/ia/live/ia-chat-cli.ts` nao inicializa o banco antes de usar as tools

Finding 2:

- o arquivo importa `buildContextBriefing`
- mas nao concatena esse briefing na conversa
- portanto a CLI atual nao testa discovery/contexto de verdade

Finding 3:

- mesmo se o DB estivesse inicializado, o prompt de teste ainda estaria cego para preview, alertas e pacote real de setor

Conclusao:

**A CLI atual nao pode ser acceptance harness do Phase 0 sem antes corrigir inicializacao de DB e injecao de contexto.**

---

## 9. Definition of Done

O Phase 0 so esta pronto quando TODOS os itens abaixo forem verdade ao mesmo tempo:

### 9.1 Contexto

- existe um `buildContextBundle()` estruturado
- existe um `renderContextBriefing()` que usa esse bundle
- o detalhe de setor injeta:
  - preview de ciclo
  - contratos relevantes com perfis embutidos
  - escala atual resumida
  - deficits por dia
  - cobertura por faixa resumida
  - regras efetivas agrupadas
  - knowledge catalogo resumido

### 9.2 Tools

- `IA_TOOLS.length` cai de `33` para `30`
- `preflight_completo` deixa de existir como tool separada
- `listar_perfis_horario` deixa de existir
- `listar_conhecimento` deixa de existir
- `salvar_conhecimento` deixa de sair no surface principal do chat RH, mesmo que o handler ainda exista para backoffice

### 9.3 CLI e validacao

- `npm run preview:cli -- 4 --context` imprime o markdown bruto do contexto
- `npm run ia:chat -- --provider gemini --setor 4 --pagina setor_detalhe` ou equivalente:
  - inicializa DB corretamente
  - injeta contexto real
  - permite testar prompts de setor sem tool call de listagem basica

### 9.4 Comportamento esperado em prompts-chave

Para prompts como:

- "a distribuicao de folgas da padaria esta boa?"
- "quais contratos do setor usam perfil especifico?"
- "tem deficit em algum dia?"
- "quais pessoas estao fora do posto?"

o modelo deve responder a partir do contexto sem precisar chamar:

- `listar_perfis_horario`
- `listar_conhecimento`
- `preflight_completo`

### 9.5 Limites aceitos

- grid completo da escala continua fora do context padrao
- override local nao salvo continua fora do escopo
- diagnosticos ricos ainda podem sobreviver temporariamente enquanto o resumo canonico nao for persistido apos toda mutacao

---

## 10. Riscos e Mitigacoes

| # | Risco | Impacto | Mitigacao |
|---|-------|---------|-----------|
| 1 | Contexto virar dump cru de banco | Token explode e IA piora | Bundle estruturado + render compacto + caps por secao |
| 2 | Consolidar tool demais cedo demais | Perda de semantica de dominio | Separar `editar_ficha` de `executar_acao` |
| 3 | Diagnosticos deixarem de existir antes do resumo canonico | Respostas stale apos ajuste manual | Manter tools temporarias ate o write path persistir resumo atualizado |
| 4 | CLI continuar fake | Testes enganosos | Corrigir `ia:chat` para init DB + context injection |
| 5 | RAG continuar exposto no lugar errado | Tool desnecessaria no chat | Tratar retrieval como etapa anterior ao LLM quando possivel |

---

## 11. Checklist para o futuro plan

- [ ] Extrair `buildContextBundle()` do discovery atual
- [ ] Criar `renderContextBriefing(bundle)`
- [ ] Adicionar preview ao bundle de setor
- [ ] Embutir perfis de horario dentro de contratos relevantes
- [ ] Embutir knowledge catalogo resumido no contexto
- [ ] Embutir escala atual resumida + drift + ultimas falhas
- [ ] Consolidar `preflight_completo` em `preflight`
- [ ] Remover `listar_perfis_horario`
- [ ] Remover `listar_conhecimento`
- [ ] Rebaixar `salvar_conhecimento` para backoffice/admin
- [ ] Criar `scripts/preview-cli.ts` com `--context`
- [ ] Corrigir `tests/ia/live/ia-chat-cli.ts` para inicializar DB
- [ ] Corrigir `tests/ia/live/ia-chat-cli.ts` para injetar contexto real
- [ ] Atualizar docs que ainda falam em 34 tools

---

## 12. Decisao Final

**Phase 0 continua sendo context-first, mas agora com uma leitura mais correta:**

- reduzir round-trip e a meta imediata
- toolkit reutilizavel e a meta arquitetural

Se a IA vai servir de base para outros projetos com RAG e formularios, o desenho certo nao e "uma tool por tabela". O desenho certo e:

- **contexto agregado por tela/domino**
- **edicao schema-driven de ficha**
- **comandos de dominio para workflow**

O resto e barulho travestido de flexibilidade.
