# Certificados, code signing e notarização

Este documento descreve a cadeia confiável de distribuição do EscalaFlow. Ele não é um manual de bypass.

O panorama completo da distribuição Apple, incluindo o updater e o caminho separado para a Mac App Store, está em [`DISTRIBUICAO-MACOS-APPLE.md`](DISTRIBUICAO-MACOS-APPLE.md). Aqui ficam os contratos de credenciais, entitlements e assinatura por plataforma.

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

Os certificados da Mac App Store são outra família. Uma futura variante `mas` precisará de Apple Distribution/Mac App Distribution, Mac Installer Distribution e provisioning profile; o `Developer ID Application` atual continua pertencendo à distribuição direta fora da loja.

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

### Estado atual do EscalaFlow

O canal Windows continua sendo o `latest.yml`, com instalador NSIS x64 no
GitHub Releases. A execução verde de `build-windows` prova somente que o
`.exe` foi compilado, empacotado e anexado ao draft; ela não prova assinatura
Authenticode nem reputação no SmartScreen.

No estado atual:

- `electron-builder.yml` declara o alvo `nsis`, mas não declara certificado
  Windows nem `forceCodeSigning` para a plataforma;
- `.github/workflows/release.yml` executa `electron-builder --win --publish
  never`, mas não injeta `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD` ou uma
  configuração de Azure Artifact Signing;
- a assinatura Apple (`Developer ID Application`) só é reconhecida pelo
  Gatekeeper do macOS; ela não assina nem torna confiável um `.exe` do
  Windows;
- `latest.yml` é um manifesto do `electron-updater`, não um certificado de
  confiança.

Conclusão: o instalador Windows atual é um artefato de release válido, mas a
cadeia de confiança Windows ainda não foi implementada. Não publicar um
release como “sem aviso do Windows” antes de concluir essa etapa.

### O que o Windows exige

O formato é o Authenticode. Um certificado emitido por uma autoridade
certificadora confiável assina o instalador e os executáveis Windows; a
assinatura deve ser feita com SHA-256 e timestamp RFC 3161. O timestamp mantém
a assinatura verificável depois que o certificado expirar, desde que ele
estivesse válido no momento da assinatura.

O SmartScreen usa dois sinais separados:

1. reputação do publicador/certificado;
2. reputação do hash daquele arquivo específico.

Uma assinatura válida identifica “Dietflow Intelligence LTDA” e protege a
integridade do arquivo, mas não garante que os primeiros downloads terão zero
aviso. A reputação é construída com downloads e instalações limpas. EV não é
mais um bypass automático do SmartScreen; não comprar EV apenas por essa
promessa.

### Opções e custo

Ao contrário do Apple Developer Program, o Windows não tem uma única
assinatura anual que automaticamente habilite a confiança do sistema. A
identidade Windows vem de um serviço de assinatura ou de um certificado
Authenticode separado.

> Preços e elegibilidade abaixo foram verificados em 2026-08-10. Reconfirmar no
> Azure Portal ou na CA antes de contratar.

| Opção | Custo indicativo | CI/CD | SmartScreen | Adequação ao EscalaFlow |
|---|---:|---|---|---|
| Microsoft Store com MSIX | gratuito; assinatura do pacote re-feita pela Microsoft | Sim | melhor experiência, sem aviso de download da Store | exige migrar de NSIS/GitHub Releases para MSIX/Store |
| Microsoft Artifact Signing — Public Trust | plano Basic de aproximadamente US$ 9,99/mês até 5.000 assinaturas; US$ 0,005 por assinatura adicional | Sim, serviço cloud | reputação ainda se acumula; avisos iniciais são possíveis | primeira opção a validar, se a identidade brasileira for elegível |
| Certificado Authenticode OV | aproximadamente US$ 150–300/ano, variando por CA e pacote | Sim, com HSM/cloud ou perfil permitido pela CA | equivalente ao Artifact Signing para reputação | fallback principal para a empresa brasileira |
| Certificado EV | normalmente US$ 400+/ano, além de fluxo com hardware/HSM | mais difícil em runner hospedado | não há mais bypass instantâneo confiável | não recomendado apenas para evitar SmartScreen |
| Self-signed | gratuito | Sim | não confiável para público geral | somente desenvolvimento ou máquinas gerenciadas |

Os valores são referência de documentação da Microsoft, não cotação. Confirmar
preço, elegibilidade, validação da identidade e requisitos de armazenamento da
chave antes de comprar.

#### Artifact Signing e Brasil

A documentação atual da Microsoft lista certificados Public Trust do Artifact
Signing para organizações nos EUA, Canadá, União Europeia e Reino Unido; o
Brasil não aparece nessa lista. A região Azure `Brazil South` existir para
recursos não significa que uma organização brasileira seja elegível para
Public Trust.

Portanto, a ordem correta é:

1. verificar no Azure Portal se `Dietflow Intelligence LTDA` consegue concluir
   a validação de identidade para Public Trust;
2. somente se a validação passar, criar o recurso e o perfil de certificado;
3. se a validação não estiver disponível, comprar um certificado OV
   Authenticode de uma CA confiável, sem tentar usar certificado self-signed.

### Recomendação para o EscalaFlow

Não precisamos publicar na Microsoft Store para assinar um instalador NSIS
distribuído pelo GitHub. O caminho mais simples compatível com a arquitetura
atual é:

1. tentar Microsoft Artifact Signing Public Trust, sem pagar certificado
   tradicional antes da validação da identidade;
2. se o Brasil estiver bloqueado para Public Trust, usar OV Authenticode;
3. preferir chave em HSM/cloud signing. Só usar `.pfx` exportável se a CA e o
   contrato permitirem e a chave ficar protegida em GitHub Secrets;
4. manter a mesma identidade de publicador em todas as versões;
5. não modificar o `.exe` depois da assinatura;
6. adicionar verificação obrigatória no CI para impedir qualquer release
   Windows unsigned.

### Runbook — certificado OV Authenticode

#### Parte do proprietário da empresa

1. Escolher uma CA que emita certificado de assinatura de código Microsoft
   Authenticode para pessoa jurídica brasileira, por exemplo DigiCert,
   Sectigo ou GlobalSign.
2. Iniciar a validação com a razão social, endereço, telefone e domínio
   corporativo exatamente como constam nos documentos da empresa.
3. Preferir uma solução de chave protegida por token, HSM ou cloud signing.
   Não enviar a chave privada por e-mail nem guardar o `.pfx` no Git.
4. Exportar o certificado somente se a CA fornecer um fluxo compatível com
   CI; proteger o arquivo com senha forte.
5. Guardar o `.pfx` codificado em base64 e a senha em secrets separados do
   repositório:

   - `WIN_CSC_LINK` — conteúdo base64 do `.pfx`;
   - `WIN_CSC_KEY_PASSWORD` — senha do `.pfx`.

   O limite de ambiente do Windows pode truncar um base64 muito grande. Se
   ocorrer, exportar o `.pfx` sem incluir certificados intermediários extras
   ou abandonar o PFX em favor de cloud/HSM signing.

#### Parte do Codex no repositório

Depois que o certificado/serviço estiver disponível, a implementação deve:

1. configurar `win.forceCodeSigning: true`;
2. injetar `WIN_CSC_LINK` e `WIN_CSC_KEY_PASSWORD` somente no job
   `build-windows`, ou configurar `win.azureSignOptions` e as credenciais de
   Azure quando o Artifact Signing for aprovado;
3. assinar o instalador NSIS, o executável principal e os sidecars PE que
   forem distribuídos;
4. usar timestamp RFC 3161 e SHA-256;
5. validar o editor esperado, a cadeia e a assinatura com `signtool` ou
   `Get-AuthenticodeSignature`;
6. falhar o pipeline se não houver identidade de assinatura válida;
7. atualizar os testes de contrato do workflow para provar que os secrets
   estão isolados no job Windows e que a assinatura não é opcional.

Para certificado PFX, o contrato de CI esperado será equivalente a:

```yaml
win:
  forceCodeSigning: true

# no job build-windows, não no repositório:
env:
  WIN_CSC_LINK: ${{ secrets.WIN_CSC_LINK }}
  WIN_CSC_KEY_PASSWORD: ${{ secrets.WIN_CSC_KEY_PASSWORD }}
```

Para Artifact Signing, o `win.azureSignOptions` deverá conter o publisher
name exato, endpoint, nome da conta e nome do certificate profile; os
segredos de Azure (`AZURE_TENANT_ID`, `AZURE_CLIENT_ID` e
`AZURE_CLIENT_SECRET`) ficam somente no job Windows.

### Verificação obrigatória antes de publicar

O draft só pode ser publicado quando todos os itens forem comprovados:

- [ ] `signtool verify /pa /all` passa no instalador e nos PE distribuídos;
- [ ] o editor exibido pelo Windows é `Dietflow Intelligence LTDA`;
- [ ] a assinatura usa SHA-256 e possui timestamp válido;
- [ ] `win.forceCodeSigning` impede build silenciosamente unsigned;
- [ ] `latest.yml` aponta para o mesmo instalador assinado e checksum correto;
- [ ] instalação em uma VM Windows limpa conclui sem arquivo alterado;
- [ ] o teste registra honestamente se o SmartScreen ainda exibe aviso de
      reputação inicial;
- [ ] o updater baixa somente o artefato assinado da versão seguinte.

O aceite de SmartScreen não é um estado binário controlado pelo projeto. A
assinatura reduz o alerta e identifica o publicador; a reputação do hash pode
demorar para amadurecer. Para garantia máxima de instalação sem aviso, a rota
é Microsoft Store com MSIX, o que exigiria uma mudança de distribuição.

## Nota histórica

Builds antigos sem assinatura ou notarização podiam disparar bloqueios do Gatekeeper ou do SmartScreen. Esse histórico explica a migração, mas não constitui mais caminho suportado de instalação para o produto.

## Referências

- Apple Developer Program: <https://developer.apple.com/programs/enroll/>
- Developer ID certificates: <https://developer.apple.com/help/account/certificates/create-developer-id-certificates/>
- Notarizing macOS software: <https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution>
- Hardened Runtime: <https://developer.apple.com/documentation/security/hardened-runtime>
- electron-builder notarization: <https://www.electron.build/docs/notarization/>
- Microsoft — opções de assinatura Windows: <https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options>
- Microsoft — reputação do SmartScreen: <https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation>
- Microsoft — quickstart do Artifact Signing: <https://learn.microsoft.com/en-us/azure/artifact-signing/quickstart>
- Microsoft Azure — preço do Artifact Signing: <https://azure.microsoft.com/en-us/products/artifact-signing>
- Microsoft — SignTool e verificação Authenticode: <https://learn.microsoft.com/en-us/windows/win32/seccrypto/signtool>
- Microsoft — timestamp Authenticode: <https://learn.microsoft.com/en-us/windows/win32/seccrypto/time-stamping-authenticode-signatures>
- electron-builder — assinatura Windows: <https://www.electron.build/docs/features/code-signing/code-signing-win/>
- electron-builder — secrets e GitHub Actions: <https://www.electron.build/docs/features/github-actions/>
