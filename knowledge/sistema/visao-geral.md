<!-- quando_usar: o que e EscalaFlow, como funciona, produto offline, grid 15min, ciclo vida escala, motor OR-Tools -->
# EscalaFlow - Visao Geral do Sistema

## O que e o EscalaFlow

O EscalaFlow e um aplicativo desktop offline para geracao automatica de escalas de trabalho em supermercados. O RH precisa gerar escalas mensais para os setores cadastrados pela empresa, respeitando todas as regras da CLT, CCT FecomercioSP e preferencias individuais dos colaboradores.

## Para quem e

O sistema e usado pela equipe de RH da empresa — pessoas nao tecnicas que precisam de uma ferramenta simples e eficiente. O principio fundamental e: **menor input possivel do usuario**. O sistema propoe, o RH ajusta. Nao e uma planilha onde o RH monta tudo na mao.

## Como funciona em alto nivel

1. O RH cadastra setores, colaboradores, demandas de cobertura e excecoes (ferias, atestados)
2. O usuario pede para gerar uma escala (via interface grafica ou chat com IA)
3. O motor Python (OR-Tools CP-SAT) gera automaticamente a melhor escala possivel
4. A escala sai como RASCUNHO — o RH pode ajustar manualmente
5. Quando satisfeito, o RH oficializa a escala (se nao houver violacoes CLT graves)

## Produto offline

O EscalaFlow e um produto 100% offline:
- Sem login, sem internet obrigatoria, sem servidor, sem SaaS
- Dados ficam no computador do usuario (banco de dados local)
- O motor de escalas roda localmente (binario Python compilado)
- A IA funciona via API (requer internet), mas o sistema funciona sem ela
- Atualizacoes sao distribuidas via GitHub Releases com auto-update

## Tecnologia

- **Desktop**: Electron 34 (funciona em Windows e Mac)
- **Motor de escalas**: Python OR-Tools CP-SAT (solver de otimizacao combinatoria)
- **Banco de dados**: PGlite (Postgres 17 rodando via WASM, local)
- **Interface**: React 19 + Tailwind CSS + shadcn/ui
- **IA integrada**: Chat com assistente de RH que tem acesso total ao sistema via tools

## Grid de 15 minutos

Todo o sistema e quantizado em blocos de 15 minutos. Horarios, demandas e alocacoes sempre se alinham a multiplos de 15 minutos. Ninguem comeca as 08:07 — e 08:00 ou 08:15.

## Ciclo de vida de uma escala

Uma escala passa por tres estados:
- **RASCUNHO**: Recem-gerada pelo motor. Pode ser ajustada livremente.
- **OFICIAL**: Travada para uso. So pode ser oficializada se nao houver violacoes CLT graves (violacoes_hard = 0).
- **ARQUIVADA**: Historico. Somente leitura.

## O que torna o EscalaFlow diferente

1. **Automatizacao inteligente**: O motor aplica 20 regras CLT automaticamente — o RH nao precisa decorar a legislacao
2. **Explicabilidade**: Cada decisao do motor vem com justificativa ("Por que Cleunice esta de folga no domingo?")
3. **Flexibilidade**: Regras configuráveis — a empresa pode relaxar regras SOFT sem violar a CLT
4. **IA assistente**: Chat integrado que entende o contexto do supermercado e executa acoes reais no sistema
5. **Diagnostico**: Quando a geracao falha (INFEASIBLE), o sistema explica por que e sugere solucoes
