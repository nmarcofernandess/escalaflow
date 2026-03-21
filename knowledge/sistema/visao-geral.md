<!-- quando_usar: o que e EscalaFlow, como funciona, produto offline, grid 15min, ciclo vida escala, motor OR-Tools, preview TS, pipeline geracao, 3 engines -->
# EscalaFlow - Visao Geral do Sistema

## O que e o EscalaFlow

O EscalaFlow e um aplicativo desktop offline para geracao automatica de escalas de trabalho em supermercados. O RH precisa gerar escalas mensais para os setores cadastrados pela empresa, respeitando todas as regras da CLT, CCT FecomercioSP e preferencias individuais dos colaboradores.

## Para quem e

O sistema e usado pela equipe de RH da empresa — pessoas nao tecnicas que precisam de uma ferramenta simples e eficiente. O principio fundamental e: **menor input possivel do usuario**. O sistema propoe, o RH ajusta. Nao e uma planilha onde o RH monta tudo na mao.

## Como funciona em alto nivel

1. O RH cadastra setores, colaboradores, demandas de cobertura e excecoes (ferias, atestados)
2. O usuario pede para gerar uma escala (via interface grafica ou chat com IA)
3. O sistema usa 3 engines complementares para gerar a escala:
   - **Preview TS**: simulacao rapida de ciclo de folgas (instantaneo, mostra na UI em tempo real)
   - **Solver Phase 1**: modelo CP-SAT leve que decide padrao de turnos (OFF/MANHA/TARDE/INTEGRAL)
   - **Solver Principal**: modelo CP-SAT completo que gera alocacoes em slots de 15 minutos
4. O validador TypeScript revalida a escala e calcula indicadores oficiais (cobertura, violacoes, equilibrio)
5. A escala sai como RASCUNHO — o RH pode ajustar manualmente
6. Quando satisfeito, o RH oficializa a escala (se nao houver violacoes CLT graves)

## Pipeline de geracao

```
UI click → Bridge TS (monta JSON) → Python OR-Tools (resolve) → Validador TS (revalida) → Banco → UI
```

- A **bridge** (solver-bridge.ts) consulta o banco, monta o input JSON, e spawna o Python
- O **solver** (solver_ortools.py) roda Phase 1 (padrao de folgas) + multi-pass (alocacoes 15-min)
- O **validador** (validador.ts) revalida e persiste indicadores autoritativos
- A **policy de regras** e compartilhada entre solver e validador (fonte unica)

## Produto offline

O EscalaFlow e um produto 100% offline:
- Sem login, sem internet obrigatoria, sem servidor, sem SaaS
- Dados ficam no computador do usuario (banco de dados local PGlite — Postgres 17 WASM)
- O motor de escalas roda localmente (Python OR-Tools via spawn)
- A IA funciona via API (requer internet) ou via IA Local (node-llama-cpp, totalmente offline)
- Atualizacoes sao distribuidas via GitHub Releases com auto-update

## Tecnologia

- **Desktop**: Electron 34 (funciona em Windows e Mac)
- **IPC**: @egoist/tipc — ~90+ handlers type-safe entre renderer e main
- **Motor de escalas**: Python OR-Tools CP-SAT (solver de otimizacao combinatoria)
- **Banco de dados**: PGlite (Postgres 17 WASM) com pgvector, FTS portugues, pg_trgm
- **Interface**: React 19 + Vite + Tailwind CSS 3 + shadcn/ui (25 componentes)
- **Estado**: Zustand 5
- **IA integrada**: Vercel AI SDK v6 + Gemini/OpenRouter (cloud) + node-llama-cpp (offline)
- **Knowledge**: RAG com embeddings locais (multilingual-e5-small ONNX) + knowledge graph

## Grid de 15 minutos

Todo o sistema e quantizado em blocos de 15 minutos. Horarios, demandas e alocacoes sempre se alinham a multiplos de 15 minutos. Ninguem comeca as 08:07 — e 08:00 ou 08:15.

## Ciclo de vida de uma escala

Uma escala passa por tres estados:
- **RASCUNHO**: Recem-gerada pelo motor. Pode ser ajustada livremente. Apos ajustes, o validador roda automaticamente.
- **OFICIAL**: Travada para uso. So pode ser oficializada se nao houver violacoes CLT graves (violacoes_hard = 0).
- **ARQUIVADA**: Historico. Somente leitura.

## Tipos de trabalhador

| Tipo | Contrato | Regime | Horas/sem | Restricoes |
|------|----------|--------|-----------|------------|
| CLT | CLT 44h ou 36h | 5X2 | 36-44h | Nenhuma — compensacao 9h45 permitida |
| ESTAGIARIO | Estagiario | 5X2 | 20-30h | NUNCA hora extra, max 6h/dia, PODE domingo |
| INTERMITENTE Tipo A | Intermitente | fixo | variavel | Trabalha dias fixos pela regra. Nao participa do ciclo domingo. |
| INTERMITENTE Tipo B | Intermitente | rotativo | variavel | XOR domingo/dia variavel. Participa do ciclo domingo. |

## O que torna o EscalaFlow diferente

1. **Automatizacao inteligente**: O motor aplica 35 regras (16 CLT + 7 SOFT + 12 ANTIPATTERN) automaticamente
2. **3 engines complementares**: Preview instantaneo + solver leve + solver completo
3. **Explicabilidade**: Cada decisao do motor vem com justificativa
4. **Flexibilidade**: Regras configuraveis — a empresa pode relaxar regras SOFT sem violar a CLT
5. **Multi-pass**: Se a geracao com regras estritas falha, relaxa automaticamente (graceful degradation)
6. **IA assistente**: Chat integrado com 34 tools que executa acoes reais no sistema
7. **Diagnostico**: Quando a geracao falha (INFEASIBLE), o sistema explica por que e sugere solucoes
8. **IA Local offline**: Funciona sem internet via node-llama-cpp com mesmas 34 tools
9. **Knowledge Layer**: RAG com embeddings locais + knowledge graph para perguntas sobre CLT/CCT
