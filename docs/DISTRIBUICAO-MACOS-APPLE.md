# Distribuição do EscalaFlow no ecossistema Apple

> Estado confirmado em `v1.12.2` · leitura de aproximadamente 12 minutos

O EscalaFlow já pode ser instalado diretamente no macOS por um caminho reconhecido pelo Gatekeeper: o aplicativo é assinado pela Dietflow Intelligence LTDA, enviado ao serviço de notarização da Apple e distribuído com o ticket de notarização anexado. A atualização automática entre releases igualmente assinados também foi provada em uma instalação real.

Isso resolve a distribuição direta pelo GitHub. Não significa que o produto foi avaliado pelo App Review, publicado ou aprovado para venda na Mac App Store. A loja é uma segunda modalidade de distribuição, com certificados, build, sandbox, atualização e revisão próprios.

## Mapa de leitura

1. [O que já funciona](#o-que-já-funciona)
2. [Quem faz o quê: GitHub e Apple](#quem-faz-o-quê-github-e-apple)
3. [O caminho completo de um release](#o-caminho-completo-de-um-release)
4. [O que evoluiu neste sprint](#o-que-evoluiu-neste-sprint)
5. [O que a assinatura entrega — e o que não entrega](#o-que-a-assinatura-entrega--e-o-que-não-entrega)
6. [Electron, aplicativo nativo e Mac App Store](#electron-aplicativo-nativo-e-mac-app-store)
7. [O que falta para vender na Mac App Store](#o-que-falta-para-vender-na-mac-app-store)
8. [Riscos técnicos que precisam de prova no sandbox](#riscos-técnicos-que-precisam-de-prova-no-sandbox)
9. [Fontes de verdade e referências](#fontes-de-verdade-e-referências)

## O que já funciona

O canal atual é **distribuição direta fora da Mac App Store**.

| Capacidade | Estado em `v1.12.2` | Evidência principal |
|---|---|---|
| identidade do publicador | confirmado | certificado `Developer ID Application: Dietflow Intelligence LTDA (8D7X23H58U)` |
| assinatura do app e dos binários internos | confirmado | `electron-builder.yml:40-51` e auditor recursivo |
| Hardened Runtime | confirmado | `electron-builder.yml:41-44` |
| notarização Apple | confirmada | `electron-builder.yml:60` e job macOS do workflow |
| ticket anexado ao app | confirmado | auditor executa validação de stapling |
| aceite do Gatekeeper | confirmado no release testado | `spctl` retornou fonte `Notarized Developer ID` |
| instalação normal pelo DMG | confirmada | prova humana com download real do GitHub |
| atualização automática assinada | confirmada | instalação `v1.12.1` atualizada para `v1.12.2` |
| Mac App Store | não implementada | não há target `mas`, sandbox ou provisioning profile |
| Macs Intel | não produzidos neste canal | target macOS atual é somente `arm64` |

O resultado prático é simples: quem baixa o DMG oficial, arrasta o app para `Applications` e abre normalmente recebe um aplicativo cuja origem e integridade podem ser verificadas pelo macOS. Builds locais continuam sendo artefatos de desenvolvimento, não instaladores oficiais.

## Quem faz o quê: GitHub e Apple

O GitHub não “dá o certificado da Apple”. Ele apenas executa, de forma automatizada, as mesmas etapas que poderiam ser feitas em um Mac de release.

```text
tag vX.Y.Z
  ↓
GitHub Actions compila o EscalaFlow e seus sidecars
  ↓
certificado Developer ID assina os bytes
  ↓
serviço da Apple analisa aquele build e devolve o ticket
  ↓
o ticket é anexado; codesign, stapler e Gatekeeper são auditados
  ↓
GitHub cria um draft com os artefatos Mac e Windows
  ↓
uma pessoa confere e publica o release
```

### Todo release novo precisa passar pela Apple?

**Sim, todo novo build macOS distribuído por este canal precisa ser assinado e notarizado.** Uma aprovação anterior não se transfere para bytes novos.

O trabalho, porém, já está automatizado. Ao criar uma tag `v*`, o job `build-mac` usa as credenciais guardadas no GitHub, assina o novo app e o submete ao serviço de notarização. Se assinatura, comunicação com a Apple, notarização, ticket ou auditoria falharem, o draft final não é criado.

Portanto:

- não é necessário entrar manualmente no portal da Apple a cada versão;
- não é o GitHub que aprova o software;
- é o workflow que conversa com a Apple em cada release;
- credenciais expiradas, revogadas ou uma rejeição da notarização interrompem o pipeline;
- mudar um asset depois de assinado invalida a cadeia; a correção sai em uma nova versão.

Notarização é uma análise automatizada de segurança e assinatura. Ela não é o App Review e não aprova modelo de negócio, UX, metadados ou regras da loja.

## O caminho completo de um release

### 1. Preparação feita uma única vez

Nesta sprint foram preparados no ecossistema Apple:

1. associação ativa da organização Dietflow Intelligence LTDA ao Apple Developer Program;
2. identidade de assinatura `Developer ID Application`;
3. exportação protegida do certificado e da chave para uso no CI;
4. chave da App Store Connect API para autenticar o `notarytool`;
5. identificação do Team ID esperado pela auditoria;
6. secrets e variable correspondentes no repositório GitHub.

Nenhum certificado, chave privada ou senha foi commitido. O runner recebe o `.p12` pelo secret de assinatura e materializa o `.p8` da API em um arquivo temporário com permissão restrita, removido ao final do job (`.github/workflows/release.yml:123-141`).

### 2. Trabalho repetido automaticamente por versão

Para cada tag:

1. `verify` roda typecheck, testes, seed, build e E2E (`.github/workflows/release.yml:12-40`);
2. o runner Apple Silicon recompila solver Python, STT Rust, MCP Bun e `llama-server` nativos (`.github/workflows/release.yml:42-121`);
3. o Electron é empacotado como DMG e ZIP arm64;
4. o `electron-builder` assina o app, helpers e sidecars com Hardened Runtime;
5. o build é enviado à notarização da Apple;
6. o ticket é anexado ao aplicativo;
7. `scripts/verify-mac-distribution.mjs` audita assinatura, Team ID, timestamp, entitlements, ticket, Gatekeeper, DMG, ZIP e manifesto;
8. o canal macOS publica `signed-mac.yml`, enquanto o Windows mantém `latest.yml`;
9. somente depois dos builds Mac e Windows o workflow monta um único draft com inventário exato.

O runbook operacional, incluindo bump, tag, inventário e recuperação, está em [`release.md`](release.md).

### 3. Atualização automática

O app instalado consulta atualizações cinco segundos depois de iniciar, baixa automaticamente um release disponível e o instala quando o usuário confirma ou quando o app encerra (`src/main/auto-updater.ts:49-83`).

No macOS, o updater usa exclusivamente `signed-mac.yml`. Esse isolamento impediu que a versão legada `v1.12.0` entrasse no fluxo antigo que alterava a assinatura. A migração segura foi:

```text
v1.12.0 legado
  ↓ reinstalação única pelo DMG oficial
v1.12.1 assinado e notarizado
  ↓ atualização automática com bytes assinados
v1.12.2 assinado e notarizado
```

A prova real encontrou e baixou `v1.12.2`, concluiu a instalação pelo mecanismo nativo do Electron, reabriu a mesma cópia isolada e confirmou a nova versão. Depois da atualização, assinatura, ticket e Gatekeeper continuaram válidos. O recibo está em [`prova-release-macos-v1.12.1-v1.12.2.md`](prova-release-macos-v1.12.1-v1.12.2.md).

## O que evoluiu neste sprint

O trabalho não foi apenas “subir um certificado”. A distribuição passou a ter contratos verificáveis.

| Antes | Agora | Benefício |
|---|---|---|
| build macOS sem cadeia pública comprovada | Developer ID + Hardened Runtime + notarização + ticket | origem identificada e Gatekeeper reconhece o release oficial |
| risco de sidecar interno ficar sem assinatura | solver, STT, MCP e `llama-server` entram na assinatura e na auditoria recursiva | o pacote inteiro participa da confiança, não só o executável externo |
| updater legado podia destruir a assinatura | updater padrão isolado no canal `signed-mac.yml` | atualização preserva a cadeia de confiança |
| `latest-mac.yml` podia reconectar versões antigas ao fluxo inseguro | manifesto legado é proibido pelo build e pelos testes | migração não reabre silenciosamente a vulnerabilidade antiga |
| release podia ser montado com assets faltando ou extras | verificador exige exatamente oito assets | DMG, ZIP, instalador Windows e manifestos permanecem coerentes |
| build local podia publicar por acidente | release local usa `--publish never` | publicação fica concentrada no workflow revisado |
| “compilou” podia ser confundido com “confiável” | auditor prova assinatura, timestamp, Team ID, ticket, Gatekeeper, ZIP e DMG | verde passa a significar uma cadeia de distribuição concreta |
| processo dependia de instruções de contorno | instalação oficial é normal; falha vira incidente de distribuição | usuário não precisa enfraquecer a segurança do Mac |
| não havia separação clara entre Apple e Windows | dossiê Windows documenta Authenticode e SmartScreen separadamente | certificado Apple não é vendido como solução para `.exe` |

Também foram adicionados testes de contrato para packaging, workflow, updater, inventário e documentação. O núcleo entrou em `v1.12.1`; `v1.12.2` foi deliberadamente mínimo para provar a atualização assinada sem misturar outra mudança funcional.

## O que a assinatura entrega — e o que não entrega

### Benefícios já obtidos

- o usuário instala o release oficial sem instrução de contorno de segurança;
- o macOS exibe a identidade da empresa, não um desenvolvedor desconhecido;
- alteração posterior dos bytes quebra a assinatura e é detectável;
- a Apple analisou aquele build específico no serviço de notarização;
- o ticket anexado permite a validação mesmo quando a consulta online não está disponível;
- o updater entrega a versão seguinte já assinada e notarizada;
- uma falha de confiança bloqueia o release antes da publicação, em vez de virar surpresa no computador do cliente.

### Limites honestos

- notarização reduz o atrito do Gatekeeper, mas não é garantia eterna de “zero alerta” em qualquer contexto; certificado revogado, arquivo corrompido, malware detectado ou política corporativa podem bloquear o app;
- a Apple não revisou a qualidade, a legislação trabalhista, a IA ou o modelo de negócio do EscalaFlow;
- o release atual não aparece na Mac App Store e não pode ser vendido por ela;
- o pacote atual é arm64; não atende Macs Intel;
- Windows continua sem Authenticode e pode mostrar SmartScreen, conforme [`certificados.md`](certificados.md);
- o usuário ainda precisa baixar o DMG no GitHub; não há descoberta, compra, licença ou atualização pela loja.

## Electron, aplicativo nativo e Mac App Store

O EscalaFlow é um aplicativo desktop Electron: interface React, processo principal Node.js e vários binários nativos auxiliares. Ele não é um app escrito integralmente em Swift/AppKit/SwiftUI.

Isso não o torna inelegível por definição. O Electron mantém uma distribuição própria para a Mac App Store e o `electron-builder` possui target `mas`. O problema real é que uma aplicação de loja precisa operar dentro do App Sandbox e seguir as regras de empacotamento e atualização da Apple.

Hoje o build é o Electron padrão para distribuição direta:

- certificado `Developer ID Application`;
- target DMG/ZIP;
- notarização separada;
- `electron-updater` consultando GitHub Releases;
- entitlements de Hardened Runtime em `build/entitlements.mac.plist`;
- sidecars que criam processos, portas locais e arquivos fora do bundle.

O build de loja será diferente:

- certificado de distribuição da Mac App Store e certificado de instalador;
- target Electron `mas` e pacote `.pkg`;
- provisioning profile ligado ao App ID explícito;
- App Sandbox obrigatório e entitlements específicos para app e helpers;
- atualização somente pela Mac App Store;
- submissão no App Store Connect e revisão humana.

Não devemos substituir o canal atual. A arquitetura correta é manter duas variantes: **direct**, para GitHub + Developer ID + updater próprio, e **mas**, para App Store + sandbox + updater da Apple.

## O que falta para vender na Mac App Store

### O que já pode ser reaproveitado

- Apple Developer Program ativo e organização validada;
- Team ID e uma identidade jurídica já usadas em produção;
- bundle ID candidato `com.escalaflow.desktop` (`electron-builder.yml:1`);
- app empacotável, versionado e reproduzido no CI;
- inventário conhecido de helpers e sidecars;
- disciplina de assinatura, secrets, auditoria e release;
- ícone, categoria e uma base funcional já instalável em Macs Apple Silicon.

Esses itens diminuem o trabalho de infraestrutura, mas o certificado `Developer ID Application` não substitui os certificados da loja.

### Trilha técnica

1. registrar ou confirmar um App ID explícito para `com.escalaflow.desktop`;
2. criar certificados Apple Development, Apple Distribution/Mac App Distribution e Mac Installer Distribution conforme a conta exibir;
3. criar o provisioning profile de distribuição da Mac App Store;
4. adicionar uma configuração `mas` separada no `electron-builder`, sem alterar o canal `direct`;
5. criar entitlements de sandbox para o app e seus helpers;
6. adicionar um build `mas-dev` para testes locais realistas;
7. detectar `process.mas` e remover da variante de loja o `electron-updater` e sua UI;
8. adaptar microfone, rede, arquivos, backups, subprocessos e modelos aos direitos mínimos do sandbox;
9. assinar recursivamente e testar todos os executáveis auxiliares dentro do container;
10. gerar o `.pkg` com `electron-builder --mac mas`;
11. validar instalação, primeiro boot, solver, IA local/cloud, STT, importação, exportação, backup e restauração no build sandboxed;
12. subir o build por Xcode ou Transporter e corrigir qualquer rejeição de processamento.

### Trilha App Store Connect

1. criar o registro do app macOS com nome, idioma, bundle ID e SKU;
2. preencher descrição, palavras-chave, categoria, suporte, política de privacidade e classificação etária;
3. produzir screenshots nas dimensões exigidas;
4. declarar as práticas de dados próprias e de terceiros, incluindo provedores de IA;
5. escolher territórios e preço;
6. assinar o Paid Apps Agreement e concluir dados bancários e fiscais para receber vendas;
7. associar o build processado à versão;
8. fornecer notas e instruções de revisão que permitam testar recursos offline, IA, microfone e importação/exportação;
9. adicionar para revisão, submeter e responder às solicitações do App Review;
10. publicar manualmente ou programar a liberação depois da aprovação.

Não há hoje prova suficiente para prometer aprovação de primeira. O próximo marco honesto é um **build `mas-dev` funcional com matriz de recursos**, não uma data de loja.

## Riscos técnicos que precisam de prova no sandbox

| Superfície | O que o código faz hoje | Trabalho provável para a loja |
|---|---|---|
| atualização | `electron-updater` consulta GitHub e instala (`src/main/auto-updater.ts:49-83`) | desabilitar na variante MAS; atualizações vêm exclusivamente da Store |
| microfone/STT | renderer solicita áudio com `getUserMedia` (`src/renderer/src/hooks/useAudioRecorder.ts:32-37`) | uso de microfone no Info.plist + entitlement de entrada de áudio + teste do sidecar STT |
| backup/exportação | escolhe diretórios e arquivos e reutiliza caminhos persistidos (`src/main/tipc.ts:4180-4202`, `src/main/backup.ts:77-113`) | acesso user-selected read/write e persistência segura da permissão entre sessões |
| IA local | baixa modelos GGUF e grava no diretório do usuário (`src/main/ia/local-llm.ts:188-294`) | rede cliente, armazenamento no container e análise da política para recursos grandes baixados após a instalação |
| STT local | baixa e extrai um modelo em runtime (`src/main/stt/download.ts:114-203`) | mesma validação de rede, armazenamento, integridade e política |
| `llama-server` | inicia um processo auxiliar e escuta em loopback (`src/main/ia/llama-server-runtime.ts:181-211`) | assinatura/herança de sandbox, rede local e lifecycle do child process |
| servidor de tools | expõe API autenticada apenas em loopback (`src/main/tool-server.ts:170-188`, `531-535`) | entitlement de servidor de rede ou feature-gate específico para MAS |
| solver/MCP/STT | quatro binários são empacotados em `Contents/Resources` (`electron-builder.yml:47-51`) | assinatura, sandbox e execução de cada sidecar no build MAS |
| entitlements atuais | JIT, memória executável e library validation desabilitada (`build/entitlements.mac.plist:5-10`) | criar conjunto MAS mínimo e provar que Electron e módulos nativos funcionam sem direitos desnecessários |
| arquitetura | release macOS é apenas arm64 (`electron-builder.yml:52-58`) | decidir entre manter Apple Silicon ou produzir universal para ampliar o mercado |

Essa tabela identifica investigação e implementação. Ela não declara que a Apple rejeitará automaticamente cada recurso. A decisão vem de um build sandboxed executável e, por fim, do App Review.

## Fontes de verdade e referências

### No repositório

- [`release.md`](release.md) — ritual operacional de release, inventário e recuperação;
- [`certificados.md`](certificados.md) — credenciais, entitlements e dossiê Windows;
- [`prova-release-macos-v1.12.1-v1.12.2.md`](prova-release-macos-v1.12.1-v1.12.2.md) — recibo do release público e do updater observado;
- `.github/workflows/release.yml` — automação real por tag;
- `electron-builder.yml` — targets, assinatura, notarização e assets;
- `scripts/verify-mac-distribution.mjs` — entrada do auditor recursivo;
- `src/main/auto-updater.ts` — comportamento da atualização;
- `tests/main/*release*.spec.ts` e `tests/main/mac-packaging-config.spec.ts` — contratos que impedem regressão.

### Apple e Electron

- Apple — Notarizing macOS software: <https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution>
- Apple — Developer ID: <https://developer.apple.com/support/developer-id/>
- Apple — App Sandbox: <https://developer.apple.com/documentation/xcode/configuring-the-macos-app-sandbox>
- Apple — App Review Guidelines: <https://developer.apple.com/app-store/review/guidelines/>
- Apple — criar o registro do app: <https://developer.apple.com/help/app-store-connect/create-an-app-record/add-a-new-app/>
- Apple — upload de builds: <https://developer.apple.com/help/app-store-connect/manage-builds/upload-builds/>
- Apple — submissão ao App Review: <https://developer.apple.com/help/app-store-connect/manage-submissions-to-app-review/submit-an-app>
- Apple — privacidade do app: <https://developer.apple.com/help/app-store-connect/manage-app-information/manage-app-privacy>
- Apple — contratos pagos: <https://developer.apple.com/help/app-store-connect/manage-agreements/sign-and-update-agreements/>
- Electron — Mac App Store Submission Guide: <https://www.electronjs.org/docs/latest/tutorial/mac-app-store-submission-guide/>
- electron-builder — Mac App Store: <https://www.electron.build/docs/mas/>
