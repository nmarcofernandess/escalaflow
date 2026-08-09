# Como fazer um release confiável do EscalaFlow

Este runbook cobre apenas a cadeia oficial de distribuição direta do EscalaFlow no GitHub.

- macOS: `Developer ID Application` + Hardened Runtime + notarização + ticket stapled
- Windows: release atual continua no canal padrão `latest.yml`
- publicação: um único draft por tag, validado antes de ficar público

## Fronteira de migração que não pode ser quebrada

O `v1.12.0` público ainda usa um updater antigo que baixa ZIP, limpa quarentena e remove assinatura antes do relaunch. Por isso:

- `v1.12.0 -> v1.12.1` não é uma migração confiável por auto-update
- todo usuário já instalado no `v1.12.0` precisa fazer uma reinstalação única via DMG assinado `v1.12.1`
- releases macOS `v1.12.1+` publicam `signed-mac.yml`
- releases macOS `v1.12.1+` não podem publicar `latest-mac.yml`
- o updater padrão só é aceito depois da prova assinada `v1.12.1 → v1.12.2`

Resumo operacional:

| Etapa | Caminho aceito |
|---|---|
| legado | `v1.12.0` fica congelado e nunca vira prova verde |
| bootstrap confiável | usuário baixa DMG `v1.12.1`, arrasta para Applications e abre normalmente |
| updater confiável | app instalado por DMG `v1.12.1` recebe `v1.12.2` pelo canal `signed-mac.yml` |

## Pré-requisitos de assinatura e notarização

Antes de iniciar tag ou release:

1. certificado `Developer ID Application` disponível
2. chave `.p12` guardada fora do repositório
3. chave `.p8` do notary guardada fora do repositório
4. operador marcou `precondicoes Apple prontas`
5. a branch já passou por PR/merge antes da tag

### Segredos e variável obrigatórios

| Nome | Tipo | Uso |
|---|---|---|
| `MAC_CSC_LINK` | secret | base64 do `.p12` |
| `MAC_CSC_KEY_PASSWORD` | secret | senha do `.p12` |
| `APPLE_API_KEY_BASE64` | secret | base64 do conteúdo `.p8` |
| `APPLE_API_KEY_ID` | secret | Key ID do App Store Connect |
| `APPLE_API_ISSUER` | secret | Issuer UUID |
| `APPLE_TEAM_ID` | variable | Team ID esperado pelo auditor |

Aviso crítico: em `electron-builder 25.1.8`, `APPLE_API_KEY` não recebe base64. Ele precisa apontar para o caminho local do `.p8` já decodificado no runner. O workflow decodifica `APPLE_API_KEY_BASE64`, grava um arquivo temporário com `0600` e exporta `APPLE_API_KEY` como path.

## Build local seguro

O build local aceito para validação do pipeline é:

```bash
npm run release:mac
```

Esse script precisa permanecer no modo seguro:

- compila solver, STT, MCP e `llama:bin`
- roda `npm run build`
- executa `electron-builder --mac --arm64 --publish never`

`--publish never` é obrigatório. Publicação local direta não faz parte do fluxo aprovado.

Depois do build, valide o artefato:

```bash
node scripts/verify-mac-distribution.mjs \
  --app dist/mac-arm64/EscalaFlow.app \
  --dist dist \
  --team-id "$APPLE_TEAM_ID" \
  --version "$(node -p "require('./package.json').version")" \
  --arch arm64
```

Esse verificador é recursivo: checa assinatura, Team ID, timestamp, entitlements, stapling, `spctl`, cópia do ZIP, cópia montada do DMG, manifesto `signed-mac.yml` e ausência de `latest-mac.yml`.

## Sequência obrigatória antes da tag

1. implemente e valide na branch da tarefa
2. abra PR e faça review
3. faça merge no `main`
4. confirme que o SHA mergeado é o SHA revisado
5. só então crie a tag do release

Não use tag para testar código que ainda não passou pela revisão final.

## Pipeline oficial de release

O workflow `.github/workflows/release.yml` executa três estágios:

```text
verify
  ├─ build-mac (macos-15, arm64, assinatura + notarização + auditoria)
  ├─ build-windows (build Windows isolado, sem material Apple)
  └─ release-draft (baixa artefatos internos e cria um único draft)
```

Contratos importantes:

- `build-mac` usa `--mac --arm64 --publish never`
- `build-mac` decodifica `APPLE_API_KEY_BASE64` para um `.p8` temporário
- `build-mac` falha se `latest-mac.yml` aparecer
- `build-windows` continua produzindo `latest.yml`
- `release-draft` roda uma única vez e publica um draft com inventário exato

## Inventário público exato

Todo release público aprovado deve conter exatamente estes oito assets:

| Asset | Obrigatório |
|---|---|
| `EscalaFlow-<versão>-arm64.dmg` | sim |
| `EscalaFlow-<versão>-arm64.dmg.blockmap` | sim |
| `EscalaFlow-<versão>-arm64.zip` | sim |
| `EscalaFlow-<versão>-arm64.zip.blockmap` | sim |
| `signed-mac.yml` | sim |
| `EscalaFlow-Setup-<versão>.exe` | sim |
| `EscalaFlow-Setup-<versão>.exe.blockmap` | sim |
| `latest.yml` | sim |

E estes itens são proibidos no release macOS confiável:

- `latest-mac.yml`
- logs de CI
- credenciais
- artefatos provisórios

## Gate humano antes de publicar

Antes de clicar em Publish:

1. confira o draft
2. confira o inventário de assets
3. confirme que `signed-mac.yml` existe
4. confirme que `latest-mac.yml` não existe
5. confirme que o release Windows manteve `latest.yml`
6. confirme que o verificador macOS passou no SHA da tag

Use uma checagem simples de assets:

```bash
gh release view vX.Y.Z --repo nmarcofernandess/escalaflow --json assets --jq '.assets[].name'
```

## Prova de Gatekeeper em download real

Build local em `dist/` não basta. A prova de confiança precisa começar com o download do DMG pelo browser UI na authenticated GitHub draft/public release page, preservando a quarentena de origem do navegador.

Para este gate de UX:

- baixe o DMG clicando no asset na página do draft/release do GitHub
- mantenha o fluxo no navegador, sem intermediários
- CLI/API downloads are not sufficient
- `gh release download`, `curl`, automações da API ou cópias locais pré-baixadas não valem como prova dessa etapa
- instale e abra normally, without any bypass

Registre:

- URL do release
- SHA256 do asset baixado
- modelo do Mac e versão do macOS
- resultado da primeira abertura normal
- saída de `spctl`, `codesign` e `stapler` para `/Applications/EscalaFlow.app`

Se Gatekeeper acusar corrupção, app não identificado ou falha de confiança em um release oficial, pare. Verifique URL oficial, checksum e assinatura, preserve a evidência e trate como incidente de distribuição. A recuperação normal não é mandar usuário limpar quarentena, reescrever bytes nem substituir assets públicos.

## Migração única do legado

### Usuário saindo de `v1.12.0`

A mensagem obrigatória é:

1. fechar o EscalaFlow antigo
2. baixar o DMG oficial `v1.12.1`
3. arrastar o app para Applications e substituir o anterior
4. abrir normalmente
5. confirmar `1.12.1` em Configurações

Essa reinstalação única existe porque o updater legado não é confiável para preservar assinatura.

### Prova do updater novo

A aceitação do updater só acontece com:

```text
DMG instalado v1.12.1 -> auto-update assinado -> v1.12.2
```

`v1.12.2` deve ser um release mínimo, preferencialmente só de versão/notas, para provar a cadeia sem misturar defeitos novos.

## Regras de canal de atualização

O contrato macOS agora é isolado:

- Mac usa `signed-mac.yml`
- Windows usa `latest.yml`
- `latest-mac.yml` fica proibido em `v1.12.1+`

Consequência esperada: `v1.12.0` pode mostrar erro ao checar update, mas não deve descobrir um release novo e entrar no fluxo destrutivo antigo.

## Falha e recuperação

Se algo der errado:

| Situação | Ação correta |
|---|---|
| falha de assinatura/notarização antes da publicação | corrigir, rebuildar e refazer o draft |
| asset incorreto ainda em draft | corrigir antes de publicar |
| bytes públicos já consumidos | preservar evidência e lançar nova patch version |
| falha em `v1.12.1 → v1.12.2` após publicar | preservar `v1.12.2` e corrigir em `v1.12.3` |
| suspeita de vazamento de segredo | revogar, rotacionar e rebuildar |

Não trate apagar tag, sobrescrever asset ou reescrever release público como recovery normal.

## Rotação de credenciais

Rotacione quando:

- o certificado expirar
- a API key for recriada
- houver suspeita de vazamento
- um operador perder controle do cofre

Fluxo:

1. revogar no portal correto
2. atualizar secrets/variables no GitHub
3. validar `notarytool history`
4. gerar novo candidate build
5. repetir auditoria e prova humana

## Comandos rápidos permitidos

```bash
# validar inventário do draft
gh release view vX.Y.Z --repo nmarcofernandess/escalaflow --json assets --jq '.assets[].name'

# acompanhar o workflow
gh run watch --repo nmarcofernandess/escalaflow

# build local seguro
npm run release:mac
```

Qualquer correção depois de bytes públicos consumidos deve sair como nova versão patch.
