# Spec — Encaixe RH da Infra IA apos merge FlowKit

Status: proposta de revisao pos-merge.  
Escopo: documentar como as melhorias de IA/Terminal/RAG/Tool Server devem ser usadas para resolver problemas reais de escala no EscalaFlow, sem expor complexidade tecnica para o RH final.  
Nao escopo: implementar agora, alterar fluxo de solver, trocar ferramentas publicas da IA ou liberar Terminal IA para usuario final.

## Contexto

O lote vindo do FlowKit melhora a infraestrutura:

- Tool server local com endpoints de chat, tools, RAG, terminal e solver.
- CLI conectado ao app aberto.
- Terminal IA como launcher para o Terminal real do sistema.
- Readiness mais explicito para provider, modelo, CLI e tools.
- RAG bulk import e enrichment com validacao melhor.
- STT transcript-first, sem promessa falsa de pos-processamento contextual.

Isso e util, mas ainda e infraestrutura. O objetivo do EscalaFlow nao e ter uma IA tecnica bonita. O objetivo e a IA ajudar o gestor de RH a navegar, entender e resolver problemas de escala: 6x1, intermitente, cobertura, preflight, demanda, folgas, oficializacao e ajustes.

## Principio de produto

Separar duas personas:

| Persona | Superficie | Pode ver Terminal/exec? | Objetivo |
|---------|------------|--------------------------|----------|
| RH final | Chat lateral, paginas do app, fluxos guiados | Nao | Resolver escala sem jargao tecnico |
| Admin/dev/suporte | Terminal IA, CLI, tool server, RAG em massa | Sim | Diagnosticar, reparar e operar com mais poder |

Terminal IA e ferramenta tecnica. Para RH final, a IA deve agir pelo chat e pelas tools de dominio, usando linguagem de produto.

## Estado atual aceitavel

Os pontos abaixo estao alinhados com o objetivo:

1. Terminal IA e launcher, nao terminal fake dentro do app.
2. O launcher e oculto para persona RH final e liberado para admin/dev/suporte.
3. O CLI fala com o app aberto via tool server local.
4. O tool server expoe capacidades reais do EscalaFlow:
   - chat;
   - IA tools;
   - preflight de escala;
   - geracao tecnica do solver;
   - RAG import/enrichment;
   - terminal exec/read/write para suporte tecnico.
5. O RAG bulk import valida payload antes de criar job.
6. O enrichment descarta indices duplicados/fora de faixa e registra lote parcial como falha.
7. O STT declara honestamente que e transcript-first.

## Lacunas de encaixe RH

### 1. Contexto de pagina no CLI/Terminal IA

Hoje o chat CLI entra com contexto generico:

```ts
{ page: 'cli', route: '/cli' }
```

Isso permite conversar, mas nao significa que a IA entende automaticamente a tela atual do RH.

Decisao desejada pos-merge:

- Para RH final, preferir chat lateral com contexto automatico da pagina.
- Para Terminal IA tecnico, permitir passar contexto explicito:
  - setor atual;
  - escala atual;
  - colaborador selecionado;
  - periodo em analise;
  - snapshot resumido da tela.

DoD:

- Pergunta "por que a Padaria nao fecha 6x1?" no contexto de setor deve levar a IA a consultar setor, preflight, preview/advisory e solver antes de responder.
- Pergunta sem contexto deve pedir identificador minimo ou listar opcoes, nao inventar setor.

### 2. Usar tools de dominio, nao endpoint tecnico, no fluxo RH

O endpoint `/solver/generate` e util para suporte tecnico, smoke e automacao. Ele nao deve virar o caminho principal da IA RH para gerar escala persistida.

Regra:

- RH/chat deve usar `executar_acao({ acao: "gerar_escala" })`.
- Diagnostico deve usar `executar_acao({ acao: "preflight" })`, `diagnosticar`, `diagnosticar_infeasible`, `resumir_horas` e `explicar_violacao`.
- `/solver/generate` fica para CLI tecnico, testes e suporte.

DoD:

- System prompt deixa claro que geracao de escala para usuario usa tool de dominio.
- Tool server docs distinguem "solver tecnico" de "fluxo de produto".

### 3. Navegacao assistida

Melhorar IA nao e so responder texto. Ela deve ajudar o usuario a ir para a tela certa e executar o proximo passo.

Fluxos esperados:

- "Minha escala pode oficializar?" -> diagnosticar escala atual -> responder com veredito -> sugerir abrir Resumo/Apontamentos.
- "Hellen esta certa no domingo sim domingo nao?" -> consultar colaborador/regra/escala -> verificar alocacoes de domingo -> responder com datas.
- "Por que a Padaria nao cobre quarta 7h?" -> consultar demanda/comparacao/preflight -> apontar causa e acao.
- "Transforma esse setor para 6x1" -> explicar impacto -> revisar contratos/regime do setor -> propor mudancas antes de aplicar.

DoD:

- Cada resposta de acao traz `next_step` claro: abrir tela, executar ajuste, pedir confirmacao ou gerar diagnostico.
- Nenhuma resposta critica depende apenas de memoria textual se ha tool capaz de verificar o dado.

### 4. Readiness honesto para acao, nao so para chat

Readiness atual valida provider/modelo/CLI/tools. Isso e necessario, mas a IA RH tambem precisa saber se consegue executar a acao pretendida.

Estados adicionais desejaveis:

- `dbUnavailable`: banco local indisponivel.
- `toolServerUnavailable`: app fechado ou tool server inacessivel.
- `domainToolsUnavailable`: chat responde, mas actions de escala nao estao disponiveis.
- `solverUnavailable`: solver/binario Python indisponivel.
- `ragUnavailable`: busca de conhecimento indisponivel.

DoD:

- Antes de abrir Terminal IA: validar CLI + tool server + chat.
- Antes de acao RH critica: validar tool de dominio e, se necessario, solver.
- Mensagem de erro diz o que falta e qual proximo passo.

### 5. RAG como apoio de dominio, nao deposito generico

Bulk RAG e enrichment sao bons para operar documentos, mas o RH precisa de respostas aterradas em regras do EscalaFlow.

Regra:

- Docs de sistema, regras CLT/CCT, manuais e historico de decisoes devem entrar com origem e tags claras.
- Conteudo importado pelo usuario deve ficar separado do conteudo de sistema.
- Resposta sobre regra deve citar se veio de regra do app, documento do usuario ou memoria.

DoD:

- Busca por "6x1 domingo", "intermitente domingo sim domingo nao", "piso operacional" retorna docs do sistema relevantes.
- A IA nao usa RAG para substituir validacao de escala quando existe solver/validador.

### 6. STT dentro do fluxo RH

O microfone deve ser entrada de texto, nao promessa de inteligencia de voz.

Regra:

- STT local transcreve.
- Reescrita contextual, se existir depois, e passo separado via IA.
- Termos como 6x1, CLT, folga, Hellen, Padaria podem ser normalizados depois da transcricao, mas isso precisa ser explicito.

DoD:

- O usuario dita "Hellen trabalha domingo sim domingo nao" e o texto chega ao chat.
- Se houver pos-processamento futuro, ele deve indicar que alterou texto e permitir revisar antes de enviar.

## Contratos que nao podem quebrar

1. RH final nao ve Terminal IA por padrao.
2. Terminal IA abre Terminal real do sistema; nao vira chat fake embutido.
3. `terminal exec/read/write` nunca entra como ferramenta visivel para RH final.
4. Geracao persistida de escala usa fluxo de produto, nao endpoint tecnico cru.
5. Solver continua fonte tecnica de viabilidade; validador continua fonte autoritativa de compliance pos-geracao.
6. Mensagens para RH nao usam jargao: INFEASIBLE, solver, pass, H1, preflight tecnico, pin.
7. 6x1/intermitente/cobertura nao podem ser inferidos por texto livre quando ha dado estruturado.

## Backlog pos-merge

### M1 — Contexto de pagina para IA

- Revisar `IaContexto` e snapshots enviados ao chat.
- Garantir contexto de setor, escala e colaborador nas paginas principais.
- Criar teste: pergunta contextual em Setor/Escala usa IDs corretos.

### M2 — Roteador de intencao RH

- Mapear intencoes frequentes para tools:
  - gerar escala;
  - diagnosticar escala;
  - explicar problema;
  - ajustar colaborador/dia;
  - revisar 6x1/intermitente;
  - resumir cobertura.
- Criar specs de tool calling por intencao.

### M3 — Readiness por capacidade

- Separar readiness de chat, RAG, solver, tools de dominio e Terminal.
- UI deve mostrar bloqueio especifico por capacidade.

### M4 — Provas de resolucao real

Cenarios obrigatorios:

1. Padaria Atendimento 6x1 com Hellen intermitente quinzenal.
2. Setor 6x1 dificil do seed CI.
3. Setor 5x2 baseline.
4. Escala com piso operacional impossivel.
5. Escala valida com avisos de preferencia.

Cada cenario precisa provar:

- IA entende o contexto.
- IA escolhe a tool certa.
- IA explica em linguagem RH.
- IA sugere ou executa proximo passo correto.
- Solver/validador continuam coerentes.

### M5 — Guardrails do Terminal IA

- Confirmar que o launcher segue oculto para RH final.
- Confirmar que comando manual nao aparece para RH final.
- Confirmar que token local nao vaza em screenshot/toast/log de UI.
- Confirmar que terminal exec/write continua restrito ao ambiente tecnico.

## Perguntas para a revisao pos-merge

1. O FlowKit trouxe infraestrutura que substitui algum helper existente do EscalaFlow? Se sim, qual fonte fica canonica?
2. Alguma melhoria de RAG duplica descoberta automatica de contexto da IA?
3. O Terminal IA consegue resolver um problema real de escala sem pedir ao usuario dados que a tela ja tinha?
4. O chat RH consegue resolver o mesmo problema sem expor Terminal/CLI?
5. O system prompt ainda manda usar nomes publicos de tools, nao nomes internos?
6. O fluxo 6x1/intermitente usa dados estruturados ou heuristica textual?
7. O endpoint tecnico `/solver/generate` esta documentado como suporte, nao fluxo de produto?

## Criterio de aceite da integracao RH

A integracao so deve ser considerada pronta quando estes comandos/testes passarem:

```bash
npm run typecheck
npm run test
npm run build
```

E quando houver pelo menos uma prova manual ou automatizada para:

- chat RH diagnosticando uma escala real;
- Terminal IA tecnico abrindo com readiness correto;
- RAG encontrando doc de regra do motor;
- IA ajustando ou sugerindo ajuste de escala via tool de dominio;
- 6x1/intermitente preservados no solver e na resposta da IA.

## Veredito atual

As melhorias de IA/Terminal/RAG sao uma boa base operacional. Ainda falta o encaixe de produto: transformar essa infraestrutura em fluxos RH guiados, contextuais e seguros.

Depois do merge FlowKit, esta spec deve ser usada como checklist antes de declarar que "a IA resolve problemas do EscalaFlow".
