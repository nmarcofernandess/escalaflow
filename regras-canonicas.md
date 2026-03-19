# Regras Canonicas — EscalaFlow

Fonte unica de verdade para comportamento do sistema. Se o codigo contradiz este arquivo, o codigo esta errado.

---

## 1. Drawer de Sugestao (SugestaoSheet)

**Regra:** O Sugerir DEVE abrir o drawer. O drawer existe para mostrar o diff e pedir aprovacao. Ninguem mexe nas folgas do RH sem ele ver e aceitar.

- Qualquer acao que MUDE folgas no grid precisa passar pelo drawer (diff → aceitar/rejeitar)
- A unica excecao e "Voltar ao automatico" (reset ↺) que restaura estado salvo (nao propoe, reverte)
- O drawer mostra: estado atual vs proposta, com destaque visual nas mudancas

---

## 2. Fluxo: Do colaborador ate o grid

```
BANCO (regra_horario_colaborador)
  → folga_fixa_dia_semana, folga_variavel_dia_semana
    ↓
previewSetorRows (useMemo)
  → merge: regrasMap (banco) + overridesLocaisSetor (sessao)
  → resolveOverrideField: se tem override → usa override; senao → usa banco
    ↓
folgaForcada (por pessoa)
  → folga_fixa_dia: idx ou null (null = TS decide)
  → folga_variavel_dia: idx ou null
  → folga_fixa_dom: boolean
    ↓
gerarCicloFase1 (simula-ciclo.ts)
  → se folga_forcada = null → pickBestFolgaDay (TS decide por demanda)
  → se folga_forcada = idx → TS respeita o pin
    ↓
simulacaoPreview.resultado (grid T/F + cobertura)
  → CicloGrid renderiza
  → buildPreviewDiagnostics gera avisos → AvisosSection
```

**Consequencia:** `null` no override faz o TS decidir. Limpar overrides faz voltar pro banco. Ambos sao validos para contextos diferentes.

---

## 3. Voltar ao automatico (reset ↺)

**O que faz:** Limpa overrides locais da sessao. O grid volta a usar as folgas salvas do colaborador (banco).

**Implementacao:** `overrides_locais = {}` (limpo, nao null explicito).

**O que NAO faz:** Nao muda o banco. Nao pede aprovacao. Nao abre drawer. E um "ctrl+Z" da sessao.

---

## 3.1. Preview = espelho fiel

O preview automatico (que roda toda vez que o RH muda um dropdown) mostra EXATAMENTE o que o RH configurou — inclusive os problemas.

- Deficit em vermelho, avisos embaixo. Sem resolver sozinho.
- O TS NAO tenta corrigir automaticamente enquanto o RH mexe.
- Se o TS resolvesse sozinho, o RH nao veria os erros nem aprenderia o que esta errado.
- O preview e um ESPELHO. O Sugerir e o botao de "me ajuda".

---

## 4. Hierarquia — O que e e por que importa

**Hierarquia = ordem dos postos no setor.** Definida pelo RH via drag-and-drop na secao Equipe. Posto #1 (topo) e o mais importante. Posto #N (fundo) e o menos.

O campo `rank` do colaborador reflete essa posicao. Rank alto = importante. Rank baixo = junior.

### Regra canonica: resolucao SEMPRE prioriza hierarquia

Quando o sistema precisa MUDAR folgas pra resolver um problema, quem PERDE a folga primeiro e quem tem rank mais BAIXO. Quem tem rank mais alto mantem a folga ate o ultimo momento.

Isso vale pra:
- **Sugerir TS**: step-by-step de baixo pra cima (libera rank baixo primeiro, tenta resolver, so libera rank alto se nao deu)
- **Sugerir Solver**: LIMITACAO ATUAL — o solver (CP-SAT) nao usa rank como peso. Trata todos como iguais. Pode mudar folga do chefe e manter do estagiario. TODO: adicionar penalidade por rank no objetivo do solver Python (mudar folga de rank alto = custo maior).
- **Gerar Escala**: mesma limitacao do solver. TODO futuro.

### Por que hierarquia importa

O RH pensa assim: "O chefe do acougue folga segunda. Isso e sagrado. Se alguem tem que mudar, que seja o mais novo." O sistema precisa respeitar isso. Se o solver muda a folga do chefe quando podia mudar a do junior, o RH perde confianca no sistema.

### Como a hierarquia chega no codigo

```
Postos (drag-and-drop na Equipe)
  → campo `ordem` de cada funcao/posto
    → colaboradores ordenados por ordem do posto (orderedColabs)
      → previewSetorRows na mesma ordem
        → gerarCicloFase1 processa na ordem (pessoa 0 = rank alto, pessoa N = rank baixo)
          → pickBestFolgaDay: pessoa 0 escolhe primeiro (melhor dia)
```

---

## 5. Sugerir TS — Por que existe

O RH pode cometer erros humanos ao configurar folgas manualmente (colocar 3 pessoas folgando no mesmo dia, etc). O Sugerir TS responde: **"Se o sistema pudesse escolher, como ficaria?"**

Nao precisa do solver pra isso. O TS (gerarCicloFase1 + pickBestFolgaDay) e rapido, demand-aware, e suficiente pra ciclo de folgas.

### Comportamento do Sugerir TS

1. Tenta resolver MANTENDO as folgas atuais (manuais + banco)
2. Se nao resolveu → libera progressivamente, de BAIXO pra CIMA na hierarquia dos postos
3. Se nao resolveu mesmo liberando tudo → mostra no drawer o que conseguiu + avisos

**E hierarquico (step-by-step), NAO tudo-ou-nada.**

```
Tentativa 1: Arranjo atual (todos os pins mantidos)
  → gerarCicloFase1 com folgas_forcadas do grid
  → Se sem deficit → "Tudo certo!" (sem mudanca necessaria)

Tentativa 2: Libera rank mais BAIXO (posto #N)
  → folgas_forcadas[N-1] = null, resto mantém
  → Se resolveu → diff mostra apenas quem mudou

Tentativa 3: Libera rank N e N-1
  → ...

Tentativa final: Tudo livre (null pra todos)
  → pickBestFolgaDay decide tudo
  → Se resolveu → diff mostra todas as mudancas

Se NENHUMA tentativa resolveu → avisos do TS (CAPACIDADE_DIARIA_INSUFICIENTE, etc)
```

**Por que hierarquico:**
- Mostra o MINIMO de mudancas necessarias
- Respeita hierarquia (rank alto mantem folga, rank baixo cede)
- Diff e menor e mais facil de aceitar
- Sub-segundo (N chamadas ao TS, cada <100ms)

### O que o Sugerir TS pode liberar

- Folgas manuais do grid (overrides da sessao) → libera primeiro
- Folgas salvas do colaborador (banco) → libera se manual nao resolveu
- folga_fixa_dom → NUNCA libera (respeita sempre — e regra do colaborador tipo restricao medica)

---

## 6. Sugerir Solver — Por que existe

O solver (solve_folga_pattern) tem visao GLOBAL (CP-SAT). Pode encontrar solucoes que o TS greedy nao encontra. Usa-se quando o TS nao resolve.

### Pipeline (3 fases, todas advisory_only=true)

```
Fase A: solve_folga_pattern COM pins → valida arranjo atual
Fase B: solve_folga_pattern SEM pins, COM folga_fixa/variavel → propoe respeitando preferencias
Fase C: solve_folga_pattern SEM pins, SEM folga_fixa/variavel → destrutivo
```

### Diferenca TS vs Solver

| | TS (gerarCicloFase1) | Solver (solve_folga_pattern) |
|---|---|---|
| Velocidade | <100ms | 2-5s por fase |
| Visao | Greedy sequencial (local) | CP-SAT (global) |
| Mensagens | Detalhadas (qual dia, qual pessoa) | Generico (viavel/inviavel) |
| Uso | Preview instantaneo + Sugerir TS | Validar + Sugerir Solver |

---

## 7. Validar — Por que existe

Responde UMA pergunta: **"O arranjo que eu montei FUNCIONA no mundo real?"**

- Roda solver Phase 1 COM pins (arranjo exato do grid)
- Se viavel → "Tudo certo!"
- Se inviavel → mostra o erro do solver
- NAO propoe alternativa. NAO roda free solve. So confere.

---

## 8. Separacao de fontes (AvisosSection vs SugestaoSheet)

```
AvisosSection (embaixo do grid):
  → TS diagnostics (previewDiagnostics)
  → Store avisos (derivados)
  → Avisos de operacao (preflight, etc)
  → Solver diagnostics (advisoryDiagnostics, se disponivel)

SugestaoSheet (drawer):
  → APENAS resultado do solver/TS que chamou (diagnostics + proposal)
  → SEM repetir TS diagnostics que ja estao na AvisosSection
```

---

## 9. 4 Botoes (debug — temporario)

```
Header:  [Sugerir TS] [Sugerir Motor] [Validar] [⚙] [Gerar]
Grid:    [Sugerir] [↺]
```

| Botao | O que faz | Abre drawer? |
|-------|-----------|-------------|
| Sugerir TS (header) | TS hierarquico step-by-step | Sim |
| Sugerir Motor (header) | Solver Fases A→B→C | Sim |
| Validar (header) | Solver com pins, so confere | Sim |
| ↺ Reset (grid) | Limpa overrides, volta pro banco | Nao |
| Sugerir (grid) | POR ENQUANTO = Sugerir TS. FUTURO = TS + Motor integrado | Sim |
| Gerar Escala | Gera escala real completa | Nao (vai pra aba Oficial) |

**Futuro (pos-debug):** Remover botoes de debug do header. Sugerir do grid faz: TS hierarquico primeiro → se nao resolveu → solver. Tudo no mesmo drawer.
