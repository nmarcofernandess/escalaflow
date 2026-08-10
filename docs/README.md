# Documentação do EscalaFlow

Este índice separa fontes canônicas, runbooks operacionais, guias de arquitetura e registros históricos. Comece pelo panorama do tema; use o runbook somente quando for executar a operação.

## Produto e arquitetura

| Documento | Quando ler |
|---|---|
| [`como-funciona.md`](como-funciona.md) | visão geral do fluxo operacional do produto |
| [`motor-regras.md`](motor-regras.md) | fonte canônica das regras HARD/SOFT e comportamento do motor |
| [`motor-spec.md`](motor-spec.md) | contexto histórico e detalhes técnicos do motor; em conflito, prevalece `motor-regras.md` |
| [`solver-consistency.md`](solver-consistency.md) | paridade entre solver Python e validador TypeScript |
| [`backup-restore.md`](backup-restore.md) | arquitetura e operação de backup/restauração |

## Distribuição e segurança

| Documento | Papel |
|---|---|
| [`DISTRIBUICAO-MACOS-APPLE.md`](DISTRIBUICAO-MACOS-APPLE.md) | fonte canônica para entender Developer ID, notarização, updater, limitações e caminho até a Mac App Store |
| [`release.md`](release.md) | runbook para preparar, gerar, auditar e publicar cada release |
| [`certificados.md`](certificados.md) | credenciais Apple, entitlements e plano de assinatura Windows |
| [`prova-release-macos-v1.12.1-v1.12.2.md`](prova-release-macos-v1.12.1-v1.12.2.md) | recibo da publicação e da atualização assinada observada |

## IA, RAG e terminal

| Documento | Quando ler |
|---|---|
| [`ia-sistema.md`](ia-sistema.md) | arquitetura geral do Assistente IA |
| [`ia-resumo-aba.md`](ia-resumo-aba.md) | mapa entre a experiência do usuário e o comportamento interno |
| [`ia-rag-cli-terminal.md`](ia-rag-cli-terminal.md) | integração RAG, CLI e terminal |
| [`tool-calling.md`](tool-calling.md) | contratos das tools da IA |
| [`provas-terminal-ia.md`](provas-terminal-ia.md) | evidências e cenários de validação do terminal IA |
| [`spec-ia-rh-pos-merge-flowkit.md`](spec-ia-rh-pos-merge-flowkit.md) | especificação pós-merge da IA de RH |

## Análises e documentos históricos

Os arquivos abaixo ajudam a entender decisões passadas, mas não substituem o código ou as fontes canônicas acima:

- [`analyst-review-2026-06-11-5-questoes-motor-graficos-contrato.md`](analyst-review-2026-06-11-5-questoes-motor-graficos-contrato.md)
- [`motor-pass2-banda-tarde.md`](motor-pass2-banda-tarde.md)
