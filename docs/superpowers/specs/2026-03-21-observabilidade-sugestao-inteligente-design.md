# Observabilidade + Sugestão Inteligente

> **Status:** Design aprovado, aguardando implementation plan
> **Autor:** Marco + Monday (Claude Opus 4.6)
> **Data:** 2026-03-21
> **Referências:** `docs/como-funciona.md`, `specs/ANALYST_PIPELINE_SOLVER_COMPLETO.md`, memory `project_backlog_preview_solver.md`

---

## 1. O Problema

O EscalaFlow tem 3 engines que geram/validam escalas (Preview TS, Phase 1 Python, Solver Main), 33 tools de IA, e um discovery rico... mas eles **não se falam**. O resultado é uma cadeia de problemas que se retroalimentam:

### 1.1 A IA é cega pro preview

O preview TS (`gerarCicloFase1` em `simula-ciclo.ts`) roda 100% client-side como um `useMemo` no `SetorDetalhe.tsx`. Ele calcula ciclo de folgas, cobertura por dia, distribuição de FF/FV — informação CRÍTICA sobre a qualidade da escala. Mas o discovery (`discovery.ts`) não injeta NADA disso no contexto da IA.

**Consequência real:** O RH pergunta "a distribuição tá boa?" e a IA responde "tá ok" — porque ela literalmente não sabe que terça tem 2 de 4 pessoas. Ela só vê dados do banco (colaboradores, demanda, escalas geradas), não o que o preview está mostrando na tela.

### 1.2 O "Sugerir" é um rubber stamp

O botão "Sugerir" no SetorDetalhe roda o `advisory-controller.ts` que chama `solve_folga_pattern` com `advisory_only=true`. Na teoria, o Phase 1 deveria otimizar. Na prática, ele **valida** — recebe os pins do RH como constraints, verifica se cabem, e devolve "viável".

**Consequência real:** O RH vê cobertura 50% em uma quarta-feira (2 de 4 pessoas), clica "Sugerir", e o sistema diz "escala ok". Porque tecnicamente NÃO viola nenhuma regra HARD. Mas é uma distribuição RUIM que qualquer pessoa veria que precisa melhorar. O Phase 1 nunca pergunta: "e se eu MUDASSE a folga fixa da Roberta de terça pra quinta? A cobertura iria de 50% pra 100% nesse dia."

### 1.3 O dev não consegue debugar

O Marco (dev) não tem como rodar o preview TS via CLI com dados reais do banco. O `solver:cli` existe e funciona, mas o preview é uma ilha React. Pra testar se o Phase 1 tá fazendo o trabalho, ele precisa:
1. Abrir o app Electron
2. Navegar pro setor
3. Clicar "Sugerir"
4. Olhar o resultado na UI
5. Não saber o que o Phase 1 recebeu, o que validou, o que mudou

Isso é insustentável pra iterar. O dev precisa de um loop rápido: editar → rodar → ver resultado → ajustar.

### 1.4 Muitas tools, pouco context

Das 33 tools da IA, várias existem SÓ porque o context não tem a informação. A IA chama `preflight` pra saber se o setor tem gente suficiente — mas o discovery já poderia injetar isso. Ela chama `listar_perfis_horario` pra ver janelas de horário — mas isso raramente muda e poderia estar no context. Resultado: mais round-trips, mais latência, mais tokens, pior experiência pro RH.

---

## 2. O Objetivo

**Um objetivo com 3 fases sequenciais:**

| Fase | Nome | Entrega | Quem se beneficia |
|------|------|---------|-------------------|
| 1 | **Enxergar** | CLI preview, context unificado (IA vê preview), audit + consolidação de tools | Dev + IA do EscalaFlow |
| 2 | **Otimizar** | Phase 1 vira otimizador com 2 modos, métricas comparativas, thresholds | Motor (solver) |
| 3 | **Mostrar** | SugestaoSheet com 2 seções, diff visual com trade-offs, diagnóstico honesto | RH (pais do Marco) |

**Princípio:** Cada fase é testável pela anterior. O dev não constrói a Fase 2 sem debugar pela Fase 1. O RH não vê a Fase 3 sem a Fase 2 funcionar comprovadamente.

---

## 3. FASE 1 — Enxergar

### 3.1 CLI de Preview (`npm run preview:cli`)

**Por que isso importa:** Hoje o dev testa o preview abrindo o app Electron, navegando pro setor, e olhando a UI. Pra iterar no algoritmo de `pickBestFolgaDay` ou validar que o ciclo tá correto pra um cenário específico, ele precisa de um loop mais curto. O `solver:cli` já faz isso pro solver Python — o preview precisa do equivalente.

**Uso:**

```bash
# Rodar preview pro setor Padaria com dados reais do banco
npm run preview:cli -- 4

# Output JSON (pra scripts, comparação automatizada)
npm run preview:cli -- 4 --json

# Comparar preview vs solver lado a lado
npm run preview:cli -- 4 --compare

# Listar setores disponíveis (igual ao solver:cli)
npm run preview:cli -- list
```

**O que faz internamente:**

1. Abre o DB PGlite (mesmo path que o app: `out/data/escalaflow-pg`)
2. Lê setor, colaboradores, demanda, regras de horário, exceções — mesmas queries do `SetorDetalhe.tsx`
3. Monta o input pra `gerarCicloFase1()` — mesma lógica que o `useMemo` do SetorDetalhe calcula (num_postos, trabalham_domingo, folgas_forcadas, demanda_por_dia)
4. Roda `gerarCicloFase1()` (que já é código shared em `src/shared/simula-ciclo.ts`)
5. Exibe rich output com ANSI colors: grid T/F por posto × semana, cobertura por dia, déficit, folgas por dia, stats do ciclo

**Exemplo de output (Padaria setor 4):**

```
╔══════════════════════════════════════════╗
║  EscalaFlow Preview CLI                  ║
╚══════════════════════════════════════════╝

  Setor:   Padaria Atendimento (#4)
  Equipe:  5 CLTs + 1 Intermitente Tipo B
  Ciclo:   2 semanas

  GRID T/F:
         SEG  TER  QUA  QUI  SEX  SAB  DOM │
  Milena  T    T    T    T    F    T    T   │ S1  FF=SEX
  Milena  T    T    T    T    F    T    F   │ S2  FF=SEX
  Roberta T    F    T    T    T    T    T   │ S1  FF=TER
  ...

  COBERTURA POR DIA:
         SEG  TER  QUA  QUI  SEX  SAB  DOM
  S1     4/4  4/4  4/4  4/4  4/4  4/4  3/3  ✅ 100%
  S2     4/4  4/4  4/4  4/4  4/4  4/4  3/3  ✅ 100%

  STATS:
  Cobertura média: 100%  |  Déficit max: 0  |  H1 violações: 0
```

**Flag `--compare`:** Roda o preview E o Phase 1 advisory (`solve_folga_pattern` com `advisory_only=true`) e mostra diff. Usa o Phase 1 (não o solver completo) porque ambos operam a nível de DIA — comparação é justa. O solver completo opera a nível de SLOT (15min) e inclui almoço/interjornada, então a diferença com o preview seria estrutural, não informativa.

```
  COMPARAÇÃO PREVIEW vs PHASE 1:
         Preview   Phase1    Diff
  S1 QUA  4/4       4/4       0 ✅
  S1 QUI  4/4       3/4      -1 ⚠️  Phase 1 redistribuiu folga
  ...
  Cobertura: Preview 100% vs Phase 1 96% (diff -4%)
```

Isso mostra se o Phase 1 tá respeitando e refinando o que o preview calcula, ou se tá divergindo.

**Flag `--context`:** Dumpa o briefing completo que a IA do EscalaFlow recebe (o output do `discovery.ts`). Isso permite que o dev veja EXATAMENTE a mesma informação que a IA tem — memórias do RH, alertas proativos, regras custom, feriados, colaboradores, demanda, preview. Essencial pra debugar por que a IA respondeu de um jeito ou de outro.

```
npm run preview:cli -- 4 --context
# Output: o Markdown completo do buildContextBriefing() pra setor 4
# Inclui: memórias, alertas, regras, colaboradores, demanda, preview
```

**Arquivo:** `scripts/preview-cli.ts` (análogo ao `scripts/solver-cli.ts` existente)

**Requer:** App ter rodado ao menos 1x (banco populado). Mesmo requisito do solver:cli.

---

### 3.2 Context Unificado — IA Vê o Preview

**Por que isso importa:** A IA do EscalaFlow tem 13 categorias de dados injetadas via `discovery.ts` — memórias, setores, colaboradores, escalas, alertas, feriados. Mas ZERO sobre o preview. Quando o RH pergunta "a distribuição tá boa?", a IA deveria poder dizer "a terça tem déficit de 2 pessoas no preview — isso vai impactar a escala gerada."

**Mudança no `discovery.ts`:**

Nova função `buildPreviewBriefing(setorId: number)` que:

1. Lê os mesmos dados que o `SetorDetalhe.tsx` usa pra montar o input do preview
2. Roda `gerarCicloFase1()` server-side (já é código shared, funciona no main process)
3. Retorna um bloco de texto Markdown injetado no briefing:

```markdown
## Preview de Ciclo (Setor: Padaria Atendimento)

Ciclo de 2 semanas com 5 CLTs + 1 Intermitente Tipo B.

Cobertura por dia do ciclo:
- SEG-SAB: 4/4 (100%) ✅
- DOM: 3/3 (100%) ✅

Folgas fixas distribuídas em: SEX(1), TER(1), QUA(1), QUI(1), SAB(1)
Déficit máximo: 0 pessoas

[Este preview é uma simulação rápida. A escala final do solver pode
diferir por causa de constraints de almoço, interjornada e jornada máxima.]
```

**Quando injeta:** Sempre que `contexto.setor_id` está definido (o RH tá olhando um setor). O cálculo é instantâneo (<5ms) e o texto tem ~200 tokens — impacto mínimo no context window.

**O que a IA passa a poder fazer:**

- "A distribuição de folgas está boa para a Padaria?" → "O preview mostra cobertura 100% com déficit zero. As folgas estão bem distribuídas: uma FF por dia da semana, sem concentração."
- "Por que a terça tá com pouca gente?" → "O preview mostra que terça tem 2 de 4 pessoas. A folga fixa da Roberta e da Célia caem ambas na terça — sugiro usar o botão Sugerir pra redistribuir."
- Ao rodar `gerar_escala`, a IA pode comparar o resultado com o preview: "O solver atingiu 95% vs 100% do preview — a diferença é normal e se deve ao almoço obrigatório e interjornada de 11h."

---

### 3.3 Audit e Consolidação de Tools

**Por que isso importa:** 33 tools é muito. Cada tool é um round-trip (IA decide chamar → envia → recebe → processa → responde). Muitas existem porque o context não tinha a info — agora que o context está expandido (3.2), algumas viram redundantes. Outras podem ser consolidadas. O objetivo não é matar tools por matar — é reduzir fricção sem perder funcionalidade.

**Critérios de decisão:**

| Critério | Ação |
|----------|------|
| A info muda raramente e é pequena | Mover pro context (discovery.ts) |
| A tool faz uma ação que modifica dados | Manter (context é read-only) |
| Duas tools fazem coisas parecidas | Consolidar em uma |
| A tool é pouco usada e a info pode vir do RAG | Avaliar caso a caso |

**Análise tool a tool:**

#### Tools que viram CONTEXT (candidatas a eliminação)

| Tool | Razão | Como mover |
|------|-------|-----------|
| `listar_perfis_horario` | Perfis raramente mudam. São 3-4 registros por tipo de contrato. | Injetar no briefing do setor quando `contexto.setor_id` presente |
| `listar_conhecimento` | A IA já vê stats da knowledge base no context. Listar títulos é info estática. | Injetar títulos no briefing `stats_knowledge` que já existe |
| `explicar_violacao` | As 35 regras são CLT estática. Explicação pode vir do RAG (já tem docs em `knowledge/clt/`). | Não eliminar tool, mas melhorar o RAG pra cobrir. Se score > 0.7 no knowledge, IA nem precisa chamar tool |

#### Tools que podem ser CONSOLIDADAS

| Hoje | Proposta | Razão |
|------|----------|-------|
| `preflight` + `preflight_completo` | Unificar em `preflight` com flag `detalhado?: boolean` | Duas tools pro mesmo propósito com nível de detalhe diferente |
| `salvar_memoria` + `remover_memoria` | Já são 2 tools pequenas — manter (ações distintas) | — |
| `ajustar_alocacao` + `ajustar_horario` | Unificar em `ajustar_escala` com campo `tipo: 'status' \| 'horario'` | Mesmo contexto (ajuste de alocação), 2 tools cria confusão |

#### Tools que FICAM como estão

Todas as tools de ação (criar, atualizar, deletar, gerar_escala, oficializar, etc.) ficam — são operações de escrita que NÃO podem virar context.

**Meta:** Reduzir de 33 → ~30 tools (eliminando ~2 por context, consolidando ~1 par — `preflight`/`preflight_completo`). A consolidação `ajustar_alocacao`/`ajustar_horario` será avaliada no audit mas pode ter razões técnicas pra manter separados. O audit final define os números exatos antes de implementar.

**Entrega:** Documento `docs/tools-audit.md` com decisão final tool-a-tool, antes de implementar. Serve como referência para qualquer Claude que for trabalhar nas tools.

**Referência de fluxo de dados:** O mapa completo de como os dados fluem entre as 3 engines (preview → solver → validador), o que cada um recebe e retorna, e como a IA se encaixa está documentado em `docs/como-funciona.md`. O tools audit DEVE ser lido em conjunto com esse doc pra entender POR QUE certas tools são redundantes — a informação já existe no fluxo, só não estava sendo exposta no context.

---

## 4. FASE 2 — Otimizar

### 4.1 O Problema Central

Hoje o Phase 1 (`solve_folga_pattern` com `advisory_only=true`) funciona como um **validador**: recebe pins, verifica se o modelo é viável, retorna "ok" ou "infeasible". Ele nunca pergunta: "e se eu mudasse algo, ficaria melhor?"

**Exemplo real — Padaria Atendimento (setor 4):**

O RH definiu folga fixa da Roberta na terça. O preview mostra:
```
         SEG  TER  QUA  QUI  SEX  SAB  DOM
Cobert.  4/4  2/4  4/4  4/4  4/4  4/4  3/3
```

Terça tem 2/4 — cobertura 50%. O RH clica "Sugerir". O Phase 1 recebe os pins (incluindo FF Roberta = TER), verifica que é viável (não viola CLT), e retorna "ok". O RH olha e pensa "bom, o sistema disse que tá ok..."

Mas se a FF da Roberta fosse na QUINTA (onde já tem folga de outra pessoa, e o impacto seria menor):
```
         SEG  TER  QUA  QUI  SEX  SAB  DOM
Cobert.  4/4  4/4  4/4  3/4  4/4  4/4  3/3
```

Terça subiria pra 4/4, quinta cairia pra 3/4 — cobertura geral muito melhor. Mas o Phase 1 nunca sugere isso.

### 4.2 Dois Modos de Otimização

O advisory passa a rodar o Phase 1 **duas vezes**, cada vez com pesos diferentes.

**Importante — compatibilidade com a arquitetura existente:** O advisory-controller já usa soft pins com `origin`/`weight` (hierarquia de pesos). Os 2 modos NÃO são um caminho paralelo — usam a MESMA infra de soft pins com pesos diferentes:

- **Modo "Respeita"**: pins do RH com peso altíssimo (ex: 100000) — efetivamente invioláveis
- **Modo "Libera"**: pins do RH com peso zero — solver é livre pra reorganizar

Isso é um ajuste de parâmetros, não uma reescrita da arquitetura.

#### Modo "Respeita" (pins com peso alto)

- As escolhas do RH (folgas fixas, variáveis, regras de horário) são pins com `weight: 100000` — o solver pode tecnicamente violá-los, mas o custo é tão alto que nunca vai
- O Phase 1 otimiza TUDO que o RH NÃO definiu manualmente:
  - Quem trabalha de manhã vs tarde (bandas MANHA/TARDE/INTEGRAL)
  - Dias sem folga definida pelo RH
  - Alocação de intermitentes nos dias disponíveis
- **O que muda vs hoje:** O Phase 1 já recebe pins e resolve. A diferença é que agora ele COMPARA o resultado com o estado atual e reporta as MELHORIAS encontradas, ao invés de só dizer "viável".

**Exemplo (Padaria):**
```
Modo Respeita — mantendo FF Roberta = TER:
  Mudanças encontradas:
  • Érica: turno QUA manhã → tarde (+1 cobertura manhã em outro dia)
  Resultado: cobertura geral 78% → 85%
```

#### Modo "Libera" (pins com peso zero)

- Pins do RH entram com `weight: 0` — o solver é completamente livre pra reorganizar
- Retorna o que MUDARIA em relação ao estado atual
- Cada mudança vem com o GANHO estimado de cobertura
- Pins do Tipo B (intermitente) e CLT legal mantêm peso alto — só pins de escolha do RH são zerados

**Exemplo (Padaria):**
```
Modo Libera — sem restrições de folga do RH:
  Mudanças encontradas:
  • Roberta: FF TER → QUI (+2 cobertura na terça)
  • Célia: FV QUA → SEX (+1 cobertura na quarta)
  Resultado: cobertura geral 78% → 96%
```

#### Na prática:

O `advisory-controller.ts` constrói o `pinned_folga_externo` com pesos diferentes e chama o solver 2x:
1. `solve_folga_pattern(data_respeita)` — pins do RH com weight=100000 + Tipo B weight=100000
2. `solve_folga_pattern(data_libera)` — pins do RH com weight=0 + Tipo B weight=100000

Ambas usam `advisory_only=true`. A infra de `pin_violations` e `pin_cost` que já existe no retorno do Phase 1 diz QUAIS pins foram violados no modo Libera e QUANTO custou — isso alimenta o diff.

Compara os 2 resultados entre si E com o estado atual (preview). Tempo total: ~0.2s (2x ~0.1s).

### 4.3 Métricas de Cobertura Comparativa

Hoje o Phase 1 retorna um pattern `{(c,d): band}` mas NÃO calcula cobertura. A conta é trivial — ele já sabe `works_day[c,d]` (quem trabalha cada dia) e `peak_demand[d]` (quantas pessoas precisa). Só precisa retornar:

```python
# No retorno do solve_folga_pattern (advisory_only=true):
{
  "advisory_pattern": [...],
  "diagnostico": {
    "phase1_status": "OK",
    # NOVO: métricas de cobertura do padrão
    "cobertura_por_dia": [4, 4, 2, 4, 4, 4, 3],   # pessoas efetivas por dia
    "demanda_por_dia":   [4, 4, 4, 4, 4, 4, 3],    # demanda peak por dia
    "cobertura_percent": 89.3,
    "deficit_max": 2,
    "dias_problematicos": [2],  # índices dos dias com déficit > threshold
  }
}
```

**Onde computar:** DENTRO de `solve_folga_pattern`, APÓS o `solver.solve(model)` retornar OPTIMAL/FEASIBLE. Neste ponto, `solver.value(works_day[c,d])` retorna 0 ou 1 pra cada (c,d), e `peak_demand[d]` já foi computado. A soma é trivial:

```python
# Dentro do if status in (OPTIMAL, FEASIBLE): no solve_folga_pattern
cobertura_por_dia = []
for d in range(D):
    presentes = sum(solver.value(works_day[c, d]) for c in range(C) if d not in blocked_days.get(c, set()))
    cobertura_por_dia.append(min(presentes, peak_demand[d]))
```

Hoje o retorno do advisory (`advisory_only=true`) hardcoda `cobertura_percent: 0` nos indicadores (linhas ~2006-2018 de `solver_ortools.py`). A mudança é substituir esse hardcode pelo cálculo real usando os valores resolvidos da Phase 1.

**Nota:** O `peak_demand` já é computado dentro de `solve_folga_pattern` (via `_compute_peak_demand_per_day`), não precisa ser recalculado.

### 4.4 Thresholds de "Aceitável"

O que define se um dia precisa de atenção? Hoje não existe critério — qualquer coisa viável é "ok". Proposta de classificação por dia:

| Demanda | Cobertura | Déficit | Classificação |
|---------|-----------|---------|---------------|
| 4 | 4/4 (100%) | 0 | Verde — ok |
| 4 | 3/4 (75%) | 1 | Amarelo — aceitável, não ideal |
| 4 | 2/4 (50%) | 2 | Vermelho — precisa reorganizar |
| 3 | 2/3 (67%) | 1 | Amarelo |
| 5 | 4/5 (80%) | 1 | Verde — 80% com demanda 5 é ok |
| 5 | 3/5 (60%) | 2 | Vermelho |

**Regra simples:** `cobertura < 66%` de um dia = vermelho. `66-90%` = amarelo. `>90%` = verde.

Se o modo "Respeita" tem dias vermelhos e o modo "Libera" não tem → a sugestão de reorganizar tem peso forte ("trocar a FF da Roberta resolveria o problema"). Se ambos têm vermelho → é falta de gente (matematicamente impossível com a equipe atual), não má distribuição.

### 4.5 Diff Inteligente Entre Modos

O advisory precisa produzir um diff **semântico** — não "mudou (3,2) de 0 pra 3", mas "Roberta: folga fixa terça → quinta, ganha 2 pessoas na terça":

**Nota sobre tipos existentes:** Já existem `AdvisoryDiffItem` e `EscalaAdvisoryOutputV2` em `src/shared/advisory-types.ts`. O design ESTENDE esses tipos com campos novos ao invés de criar tipos paralelos. Campos novos propostos:

```typescript
// EXTENSÃO de AdvisoryDiffItem existente (campos novos, não substitui os atuais)
interface AdvisoryDiffItemExtended extends AdvisoryDiffItem {
  ganho_cobertura: number      // +2 pessoas naquele dia
  impacto_descritivo: string   // "terça ficaria com 4/4 ao invés de 2/4"
}

// NOVO tipo — resultado comparativo dos 2 modos
interface AdvisoryComparativo {
  respeita: {
    cobertura_proposta: number
    dias_vermelhos: number
    mudancas: AdvisoryDiffItemExtended[]
  }
  libera: {
    cobertura_proposta: number
    dias_vermelhos: number
    mudancas: AdvisoryDiffItemExtended[]
  }
  cobertura_atual: number        // do preview/estado atual
  limitado_por_equipe: boolean   // ambos os modos têm vermelhos
}
```

A `EscalaAdvisoryOutputV2` existente ganha um campo `comparativo?: AdvisoryComparativo` — backward compatible.

---

## 5. FASE 3 — Mostrar

### 5.1 Layout do SugestaoSheet

O `SugestaoSheet.tsx` hoje é um drawer simples com status verde/âmbar/vermelho e diff genérico. Vira um **painel de oportunidade** com até 3 blocos:

#### Bloco Topo: Resumo Comparativo (sempre visível)

```
┌──────────────────────────────────────────────────────┐
│  Situação Atual           →    Melhor Possível       │
│  Cobertura: 78%           →    96%                   │
│  Dias com falta: 3        →    0                     │
│  Déficit máximo: 2 pessoas→    0                     │
└──────────────────────────────────────────────────────┘
```

"Situação Atual" = preview/estado atual. "Melhor Possível" = o melhor dos 2 modos (Respeita ou Libera). O RH vê de cara o potencial de melhoria.

#### Bloco 1: "Melhorias mantendo suas escolhas" (modo Respeita)

Aparece SEMPRE. Se não tem melhoria, mostra "Suas escolhas já estão otimizadas" (verde). Se tem:

```
┌──────────────────────────────────────────────────────┐
│  ✅ Sem mexer nas folgas definidas       78% → 85%   │
│                                                      │
│  • Érica: turno QUA manhã → tarde        +1 pessoa  │
│  • Rafaela: turno SEX manhã → integral   +1 pessoa  │
│                                                      │
│  [Aplicar estas melhorias]                           │
└──────────────────────────────────────────────────────┘
```

Botão "Aplicar" aceita SÓ essas mudanças. Folgas do RH ficam intocadas.

**Mecanismo de persistência do "Aplicar":**
- Mudanças de **turno** (MANHA→TARDE): Não persiste no banco — atualiza estado React local. O solver recebe como hint quando "Gerar Escala" roda.
- Mudanças de **folga fixa/variável**: Persiste via `salvar_regra_horario_colaborador` (IPC handler existente). Grava em `colaborador_regra_horario`.
- Após "Aplicar", o preview re-executa `gerarCicloFase1()` automaticamente (já é reativo via useMemo). O RH vê o impacto imediatamente.
- Se o RH clica "Gerar Escala" em seguida, a bridge lê as regras atualizadas do banco e o solver recebe o estado novo.

#### Bloco 2: "Se reorganizar as folgas" (modo Libera)

Aparece SÓ SE o modo Libera produz resultado melhor que o Respeita. Se ambos dão o mesmo, não mostra — não faz sentido sugerir reorganização que não melhora nada.

```
┌──────────────────────────────────────────────────────┐
│  🔄 Reorganizando folgas                 85% → 96%   │
│                                                      │
│  • Roberta: folga fixa TER → QUI         +2 pessoas │
│    (terça ficaria com 4/4 ao invés de 2/4)           │
│  • Célia: folga variável QUA → SEX       +1 pessoa  │
│    (quarta ficaria com 4/4 ao invés de 3/4)          │
│                                                      │
│  [Aplicar tudo]  [Aplicar só as de cima]             │
└──────────────────────────────────────────────────────┘
```

Cada mudança mostra o IMPACTO concreto ("terça ficaria com 4/4 ao invés de 2/4"). O RH pensa em DIAS e PESSOAS, não em porcentagens abstratas.

"Aplicar tudo" = aceita mudanças do Bloco 1 + Bloco 2.
"Aplicar só as de cima" = aceita só o Bloco 1 (respeitando as escolhas do RH).

#### Bloco Especial: Limitação de Equipe

Aparece quando AMBOS os modos têm dias vermelhos (cobertura < 66%). Isso significa que o problema é matemático — não tem como cobrir com a equipe atual:

```
┌──────────────────────────────────────────────────────┐
│  ⚠️ Cobertura limitada por tamanho da equipe         │
│                                                      │
│  Mesmo reorganizando tudo, quarta e quinta ficam     │
│  com 2 de 4 pessoas. Com 5 CLTs trabalhando 5 dias  │
│  por semana, não é possível ter 4 pessoas em todos   │
│  os dias úteis.                                      │
│                                                      │
│  Sugestões:                                          │
│  • Avaliar contratação de 1 CLT adicional            │
│  • Reduzir demanda nos dias de menor movimento       │
│  • Considerar intermitente para cobrir picos          │
└──────────────────────────────────────────────────────┘
```

Isso evita o "tá ok" mentiroso de hoje. Se é impossível, o sistema DIGA que é impossível, explique POR QUÊ (aritmética), e sugira ações concretas.

### 5.2 Os 4 Cenários Possíveis

| Respeita | Libera | O que mostra |
|----------|--------|-------------|
| Sem melhorias | Sem melhorias | Topo verde: "Escala otimizada!" — nada a fazer |
| Com melhorias | Igual ao Respeita | Bloco 1 só — reorganizar não ajuda mais |
| Com melhorias | Melhor que Respeita | Bloco 1 + Bloco 2 — as duas camadas |
| Sem melhorias | Com melhorias | Bloco 2 só — dentro das escolhas tá ok, mas reorganizar melhora |

Em qualquer cenário com dias vermelhos em ambos os modos → Bloco Especial (limitação de equipe).

### 5.3 Integração com "Gerar Escala"

Depois de aceitar sugestões, o botão "Gerar Escala" usa as folgas otimizadas como input do solver principal. O fluxo:

```
Preview (TS) → Sugerir (Phase 1 otimizador) → RH aceita → Gerar (solver completo)
                                                              ↓
                                                   A escala JÁ reflete
                                                   as melhorias aceitas
```

Se o solver principal divergir do Phase 1 (ex: "Phase 1 disse 96% mas solver deu 93%"), o diagnóstico explica na UI: "Cobertura do solver ficou 3% abaixo do previsto — isso é normal por causa do almoço obrigatório e interjornada de 11h que o preview não considera."

Essa transparência é ESSENCIAL. Hoje o RH vê "o sugerir disse 100% mas a escala ficou 93%?!" e perde confiança. Com o diagnóstico, ele entende que a diferença é estrutural, não bug.

**Por que "sempre muda algo" vai diminuir com essas mudanças:**

Hoje o solver "sempre muda algo" pós-geração porque:
1. O Phase 1 é rubber stamp → não otimiza → pattern de folgas é subótimo
2. O solver recebe esse pattern subótimo como constraints HARD no Pass 1
3. Pass 1 fica INFEASIBLE (constraints muito apertadas) → cai pro Pass 2
4. Pass 2 relaxa DIAS_TRABALHO → redistribui folgas → "mudou algo"

Com as mudanças da Fase 2:
1. O Phase 1 vira otimizador → gera o MELHOR pattern possível
2. O solver recebe esse pattern otimizado como warm-start
3. O solver TEM MENOS motivo pra divergir → "mudou algo" vira raro
4. Quando diverge, é por constraints de slot (almoço, interjornada) — diferença pequena e explicada

Isso é a raiz do problema que motivou esta spec: o Phase 1 fazendo trabalho ruim → solver compensando → RH confuso.

---

## 6. Arquivos Impactados

### Fase 1 — Enxergar

| Arquivo | Ação | Descrição |
|---------|------|-----------|
| `scripts/preview-cli.ts` | CRIAR | CLI de preview com output rich, --json, --compare |
| `src/main/ia/discovery.ts` | EDITAR | Adicionar `buildPreviewBriefing()` no context |
| `src/shared/simula-ciclo.ts` | MANTER | Já funciona server-side, sem mudanças |
| `docs/tools-audit.md` | CRIAR | Documento de decisão tool-a-tool |
| `src/main/ia/tools.ts` | EDITAR | Consolidar/remover tools conforme audit |

### Fase 2 — Otimizar

| Arquivo | Ação | Descrição |
|---------|------|-----------|
| `solver/solver_ortools.py` | EDITAR | Phase 1 retorna métricas de cobertura |
| `src/main/motor/advisory-controller.ts` | EDITAR | 2 chamadas (Respeita + Libera), diff semântico |
| `src/shared/types.ts` | EDITAR | Tipos AdvisoryDiffItem, AdvisoryResult |

### Fase 3 — Mostrar

| Arquivo | Ação | Descrição |
|---------|------|-----------|
| `src/renderer/src/componentes/SugestaoSheet.tsx` | REESCREVER | Painel com 3 blocos, 4 cenários |
| `src/renderer/src/paginas/SetorDetalhe.tsx` | EDITAR | Integrar novo advisory result |

---

## 7. Critérios de Sucesso

### Fase 1
- [ ] `npm run preview:cli -- 4` exibe grid, cobertura, stats da Padaria com dados reais
- [ ] `npm run preview:cli -- 4 --compare` mostra diff preview vs Phase 1
- [ ] `npm run preview:cli -- 4 --context` dumpa o briefing completo que a IA recebe (discovery)
- [ ] IA do EscalaFlow responde "a distribuição tá boa?" com dados do preview (não mais "tá ok" cego)
- [ ] Tools audit completo (`docs/tools-audit.md`) com decisão por tool: manter/context/consolidar/matar
- [ ] Redução implementada conforme audit (meta ~30, número exato definido pelo audit)

### Fase 2
- [ ] Phase 1 retorna `cobertura_por_dia` e `deficit_max` no advisory
- [ ] Modo Respeita encontra melhorias de turno sem mexer em folgas do RH
- [ ] Modo Libera identifica que trocar FF da Roberta de TER→QUI melhora cobertura
- [ ] Se ambos os modos têm dias vermelhos, flag `limitado_por_equipe = true`
- [ ] Tempo total dos 2 modos: < 1s

### Fase 3
- [ ] SugestaoSheet mostra Bloco 1 + Bloco 2 quando há oportunidade nas duas camadas
- [ ] Cada mudança sugerida mostra impacto concreto ("terça: 2/4 → 4/4")
- [ ] Bloco Especial aparece quando o problema é falta de gente
- [ ] "Aplicar" persiste as mudanças e o preview atualiza refletindo
- [ ] "Gerar Escala" após aceitar sugestões produz escala alinhada com o advisory

---

## 8. O Que Essa Spec NÃO Cobre

- Redesign do grid visual do preview (CicloGrid unificado — spec separada)
- IA do EscalaFlow editando o preview via tool (pode vir depois como extensão da Fase 1)
- Solver principal (multi-pass) — já funciona, já foi otimizado nesta sessão
- Painel Único de Escala — spec separada em `docs/ANALYST_PAINEL_UNICO_ESCALA.md`
