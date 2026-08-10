# Certificados, code signing e notarização

Este documento descreve a cadeia confiável de distribuição do EscalaFlow. Ele não é um manual de bypass.

## Estado atual do produto

Para macOS, a superfície oficial de distribuição direta passa a ser:

- certificado `Developer ID Application`
- Hardened Runtime
- notarização aceita pela Apple
- ticket stapled no `.app`
- DMG/ZIP arm64 verificados
- canal de update macOS em `signed-mac.yml`

O release legado `v1.12.0` fica fora dessa cadeia porque o updater antigo remove assinatura durante a migração. A saída segura do legado é uma reinstalação única pelo DMG assinado `v1.12.1`, seguida da prova `v1.12.1 → v1.12.2` via updater novo.

## Apple Developer e identidade correta

Para distribuir sem alertas de confiança em releases oficiais:

1. conta ativa no Apple Developer Program
2. certificado `Developer ID Application`
3. Hardened Runtime habilitado
4. notarização aprovada
5. artefato auditado com o Team ID esperado

`Developer ID Installer` só entra se existir PKG. Não é o caso atual.

## Entitlements desta fase

O EscalaFlow mantém, nesta migração de confiança, o conjunto já validado para Electron:

- `com.apple.security.cs.allow-jit`
- `com.apple.security.cs.allow-unsigned-executable-memory`
- `com.apple.security.cs.disable-library-validation`

O contrato adicional desta fase é:

- `get-task-allow` ausente
- nenhum sidecar Mach-O fora do Team ID esperado
- nenhuma correção por alargamento arbitrário de entitlement

## Credenciais usadas no CI

| Nome | Tipo | Papel |
|---|---|---|
| `MAC_CSC_LINK` | secret | `.p12` em base64 |
| `MAC_CSC_KEY_PASSWORD` | secret | senha do `.p12` |
| `APPLE_API_KEY_BASE64` | secret | conteúdo `.p8` em base64 |
| `APPLE_API_KEY_ID` | secret | key ID da App Store Connect API |
| `APPLE_API_ISSUER` | secret | issuer UUID |
| `APPLE_TEAM_ID` | variable | Team ID esperado |

Aviso importante: `APPLE_API_KEY` continua reservado para o caminho do `.p8` temporário no runner. Não use esse nome para armazenar base64 em GitHub Actions.

## Build local versus release oficial

Build local serve para validação interna. Release oficial serve para distribuição.

- local: `npm run release:mac` com `--publish never`
- oficial: tag revisada, workflow verde, auditoria verde e draft humano aprovado

Se um build local ou candidate build não abrir com a cadeia de confiança esperada, trate isso como falha de distribuição e corrija a assinatura/notarização. Não converta o problema em instrução de bypass para usuário.

## Windows

O Windows continua no canal `latest.yml`. A assinatura Windows permanece um tópico separado da cadeia Apple, mas o princípio é o mesmo: release oficial precisa de confiança nativa do sistema operacional, não de override manual.

## Nota histórica

Builds antigos sem assinatura ou notarização podiam disparar bloqueios do Gatekeeper ou do SmartScreen. Esse histórico explica a migração, mas não constitui mais caminho suportado de instalação para o produto.

## Referências

- Apple Developer Program: <https://developer.apple.com/programs/enroll/>
- Developer ID certificates: <https://developer.apple.com/help/account/certificates/create-developer-id-certificates/>
- Notarizing macOS software: <https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution>
- Hardened Runtime: <https://developer.apple.com/documentation/security/hardened-runtime>
- electron-builder notarization: <https://www.electron.build/docs/notarization/>
