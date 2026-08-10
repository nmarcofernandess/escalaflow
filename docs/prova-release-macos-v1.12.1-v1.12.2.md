# Recibo da migração macOS assinada — `v1.12.1 → v1.12.2`

> Executado em 10 de agosto de 2026 · evidência de release, Gatekeeper e updater

Este recibo registra a prova que encerrou a migração do canal macOS. Ele complementa o panorama em [`DISTRIBUICAO-MACOS-APPLE.md`](DISTRIBUICAO-MACOS-APPLE.md) e o procedimento em [`release.md`](release.md).

## Escopo

Foram validados dois contratos diferentes:

1. os artefatos públicos são assinados, notarizados e coerentes com seus manifestos;
2. um `v1.12.1` instalado consegue receber `v1.12.2` sem perder assinatura, ticket ou aceite do Gatekeeper.

O teste de updater usou uma cópia isolada em diretório temporário. Ele não substituiu o EscalaFlow antigo em `/Applications`; por isso a versão encontrada posteriormente naquele caminho não representa o app usado na prova.

## Release público

- release: <https://github.com/nmarcofernandess/escalaflow/releases/tag/v1.12.2>
- SHA da tag: merge `020b65da2a975374f950e5c76ac2aeeffd7f1a77`
- workflow: <https://github.com/nmarcofernandess/escalaflow/actions/runs/31365394184>
- resultado: quatro jobs verdes e release público com inventário exato

Assets confirmados:

1. `EscalaFlow-1.12.2-arm64.dmg`
2. `EscalaFlow-1.12.2-arm64.dmg.blockmap`
3. `EscalaFlow-1.12.2-arm64.zip`
4. `EscalaFlow-1.12.2-arm64.zip.blockmap`
5. `signed-mac.yml`
6. `EscalaFlow-Setup-1.12.2.exe`
7. `EscalaFlow-Setup-1.12.2.exe.blockmap`
8. `latest.yml`

`latest-mac.yml` não foi publicado.

## Cadeia Apple observada

O workflow registrou notarização concluída e auditou o app original, a cópia extraída do ZIP e a cópia montada do DMG. Em cada superfície relevante:

- `codesign --deep --strict` passou;
- a identidade foi `Developer ID Application: Dietflow Intelligence LTDA (8D7X23H58U)`;
- o ticket anexado foi validado;
- o Gatekeeper aceitou a execução com fonte `Notarized Developer ID`;
- os 74 Mach-O auditados eram arm64 e estavam dentro da cadeia esperada;
- `signed-mac.yml` apontou para os mesmos ZIP/DMG e checksums do release.

## Prova funcional do updater

Sequência executada:

1. uma cópia isolada do release público `v1.12.1` foi iniciada;
2. o app consultou o canal `signed`;
3. o evento `update-downloaded` confirmou o download de `v1.12.2`;
4. o mecanismo ShipIt/Squirrel iniciou a instalação;
5. o log persistente registrou `Installation completed successfully` em `2026-08-10 05:50:42`;
6. o mesmo caminho temporário foi reaberto;
7. o endpoint local de saúde informou versão `1.12.2`;
8. assinatura estrita, ticket e Gatekeeper foram verificados novamente e continuaram válidos.

Evidência local persistente da instalação:

- `~/Library/Caches/com.escalaflow.desktop.ShipIt/ShipIt_stdout.log`;
- `~/Library/Caches/com.escalaflow.desktop.ShipIt/ShipItState.plist`;
- target registrado: cópia isolada sob `/tmp/escalaflow-public-verify.../unpacked/EscalaFlow.app`.

O diretório temporário e os downloads de teste foram limpos depois da validação. O log ShipIt permaneceu no cache da conta que executou a prova.

## Veredito

`v1.12.1 → v1.12.2` está aceito como prova funcional do updater macOS assinado. A partir desse ponto, cada nova versão continua obrigada a passar pela mesma assinatura, notarização, auditoria e validação de inventário no CI.

Essa prova não é uma aprovação da Mac App Store. Ela cobre exclusivamente a distribuição direta pelo GitHub e o updater desse canal.
