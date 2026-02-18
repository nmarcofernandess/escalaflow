# Prompt de Patch — RFC v3.1 Pragmatico (Demanda Simplificada)

Quero que voce atualize **apenas** `docs/MOTOR_V3_RFC.md` com um patch cirurgico, sem reinventar o projeto.

## Contexto rapido

O RFC atual (v1.1) esta robusto, mas ainda carrega direcao de `perfil_intensidade` como recomendado no R1.  
Precisamos fechar v3.1 com **input simples para RH**: linha unica segmentada de demanda planejada.

## Gaps reais do RFC atual que precisam ser corrigidos

1. `TL;DR` e `D2` ainda tratam demanda como hibrida e empurram `perfil_intensidade`.
2. Cadeia de precedencia atual nao reflete a ordem final desejada (demanda planejada esta abaixo de APs e com override no meio).
3. Secoes de dados/UX ainda priorizam heatmap 2h + migracao para perfil.
4. Roadmap R1 inclui `perfil_intensidade` (schema/handlers/UI), o que conflita com v3.1 pragmatico.
5. Falta deixar explicito, em regra de solver e UX de saida, `Planejado x Executado x Delta` com justificativa obrigatoria.

## Decisao principal (nao negociar)

Para v3.1, **nao** vamos usar perfil termico completo (`BAIXO/NORMAL/ALTO/PICO`) como fluxo principal.  
Isso fica para v4+ opcional.

No v3.1:
- RH informa **demanda planejada** por dia, em uma **single-lane segmented timeline**.
- O motor usa isso como **target termico soft** (nao prescricao rigida).
- Output continua por posto/vaga com explicabilidade.

## O que alterar no RFC (in-place)

### 1) Secao de Decisoes Fechadas

- Reescrever D2 para:
  - `demandas` como base do v3.1.
  - `min_pessoas` com semantica de `pessoas_planejadas (target)`.
  - `perfil_intensidade` movido para roadmap v4+ opcional.
- Ajustar D5/D6 para remover dependencia de heatmap 2h e migracao obrigatoria no R1.

### 2) Cadeia de precedencia (solver)

Deixar explicito nesta ordem:
1. HARD legal (CLT/CCT/feriado/aprendiz etc)
2. Piso operacional minimo do setor (se existir)
3. Demanda planejada (target termico soft)
4. Antipatterns/qualidade
5. Preferencias soft

Observacao:
- Se mantiver `pinnedCells/override`, manter como ferramenta de ajuste manual, sem quebrar a hierarquia acima.

### 3) Contrato de demanda (secao de dados)

- Trocar semantica de `demandas`:
  - input RH = planejado
  - output motor = executado
- Remover `demandas` como "legado deprecado" no v3.1.
- Remover obrigatoriedade de `perfil_intensidade` no R1.
- Se quiser preservar `perfil_intensidade`, marcar como **evolucao v4+ opcional** (nao bloquear v3.1).

### 4) UI/UX de demanda (substituir heatmap principal)

Substituir a secao de heatmap de intensidade por:

**Single-Lane Segmented Timeline Editor** (uma trilha por dia)

- Sem sobreposicao por construcao.
- Sem empilhamento de barras.
- Sem DnD de blocos empilhados.
- Horarios definidos por divisores da linha unica.

Interacoes obrigatorias:
1. Dividir segmento (duplo clique ou botao de divisao no cursor)
2. Editar pessoas do segmento (popover com stepper `- / +`)
3. Mover divisor (arrasto compartilhado, snap 30min)
4. Remover segmento (delete + merge com vizinho)
5. Invariantes: sem gap, sem overlap, cobertura continua entre abertura/fechamento; dia inativo = timeline fechada

Modelo semanal/dia:
- `Padrao semanal` editavel
- Por dia: toggle `Ativo` e toggle `Usa padrao`
- `Usa padrao = off` => copy-on-write (clona padrao para edicao local)

### 5) Geração da escala (saida)

Manter visual por posto/vaga (ex: Acougue 1, 2, 3) com:
- TRABALHO / FOLGA / INDISPONIVEL
- retorno pos-almoco na mesma vaga quando aplicavel

Adicionar comparacao explicita:
- Planejado (demanda)
- Executado (alocacao)
- Delta (desvio)

Explicabilidade obrigatoria de delta:
- Ex.: "reduzido de 4 para 3 para evitar clopening e respeitar interjornada"
- Ex.: "abaixo do planejado por limitacao de capacidade do setor"

### 6) Roadmap

Separar com clareza:

- **v3.1 Pragmatico (agora):**
  - demanda simplificada em `demandas`
  - single-lane timeline
  - planejado vs executado + delta explicado

- **v4+ Opcional (futuro):**
  - perfil termico avancado (`BAIXO/NORMAL/ALTO/PICO`)
  - calibracao automatica e features avancadas relacionadas

## Integracao com calendario/ciclo/solicitacoes

Alinhar RFC com `docs/MOTOR_V3_CALENDARIO_CICLO_SOLICITACOES.md` (sem duplicar tudo):
- calendario operacional empresa + excecao por dia no setor
- ciclo rolling com congelamentos
- ajustes no meio do ciclo (passado trava, futuro reotimiza)
- fluxo de solicitacoes e cobertura urgente

## Regras de execucao deste patch

1. Nao criar RFC novo, editar o existente.
2. Nao remover os blocos legais/HARD ja consolidados.
3. Nao adicionar overengineering de modelagem termica no R1.
4. Eliminar contradicoes internas (buscar termos antigos e corrigir contexto).
5. Entregar texto final executavel, sem "TBD".

## Criterios de aceite (checklist)

- [ ] D2/D5/D6 coerentes com v3.1 simplificado
- [ ] Precedencia em 5 niveis (hard, piso, planejado, AP, soft)
- [ ] Contrato de demanda sem "legado deprecado" no v3.1
- [ ] Heatmap removido como fluxo principal do R1
- [ ] Single-lane segmented timeline detalhado no RFC
- [ ] Planejado x Executado x Delta com justificativa obrigatoria
- [ ] Roadmap separado: v3.1 pragmatico vs v4+ opcional
