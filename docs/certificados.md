# Certificados, Code Signing e Notarização (Mac + Windows)

> Guia canônico para distribuir builds assinados do EscalaFlow (fork fiel do FlowKit). Foco em **produção** (GitHub Releases + auto-update) e **testes de builds ad-hoc**.

Status atual (2026-06): builds de release no CI usam GitHub Actions (mac + win). Builds locais/dev são **ad-hoc** (sem certificado de produção) — exigem bypass manual do Gatekeeper/SmartScreen. (FlowKit é a referência; este doc é o espelho fiel.)

---

## macOS — Apple Developer + Notarização

### Custo oficial
- **Apple Developer Program**: USD 99 por ano (ou equivalente em moeda local). 
- Apple Developer Enterprise Program: USD 299/ano (para distribuição interna grande, não necessário para apps públicos via GitHub).
- Isenções possíveis para nonprofits/educacionais/governo (fee waiver).

Fontes oficiais confirmadas em 2026: developer.apple.com/programs/enroll/ e compare-memberships.

### Requisitos para distribuição "sem aviso"
1. Membro do Apple Developer Program (pago).
2. Certificado **Developer ID Application** (Production) + Developer ID Installer (se .pkg).
3. Hardened Runtime habilitado.
4. Entitlements declarados (ver abaixo).
5. **Notarização** pela Apple (upload do binário assinado; Apple escaneia malware/assinatura). Requer app-specific password ou API key (App Store Connect).
6. Staple do ticket de notarização (electron-builder faz automaticamente quando `notarize: true`).

### Config no projeto (já existente)
- `build/entitlements.mac.plist` — contém os mínimos para Electron:
  - `com.apple.security.cs.allow-jit` (V8)
  - `com.apple.security.cs.allow-unsigned-executable-memory`
  - `com.apple.security.cs.disable-library-validation`
- `electron-builder.yml` (seção `mac`):
  ```yaml
  mac:
    hardenedRuntime: true
    entitlements: build/entitlements.mac.plist
    entitlementsInherit: build/entitlements.mac.plist
    # notarize: true   # + credenciais via env (GH secrets ou local)
  ```
- Release.yml (CI) pode acionar notarize quando secrets presentes (`APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` ou `APPLE_API_KEY` + `APPLE_API_ISSUER`).

### Testar build ad-hoc (sem Apple ID pago / certificado de produção)
Usuário final ou dev testando `.dmg`/`.app` baixado (builds locais ou de CI com `identity: "-"` e `notarize: false`):

```bash
# Remove a flag de quarentena (comum e efetivo; use -dr ou -cr)
xattr -dr com.apple.quarantine "/Applications/EscalaFlow.app"
# ou variante recursiva clara + abrir
xattr -cr "/Applications/EscalaFlow.app" && open "/Applications/EscalaFlow.app"
```

**Passos recomendados (UX oficial + bypass):**
1. Baixar e abrir o DMG.
2. Arraste o `.app` para `/Applications`.
3. **Primeira vez:**
   - Botão direito (ou Ctrl+click) no app no Finder → "Abrir" → confirmar no diálogo de segurança.
   - Ou no Terminal (como acima).
   - Alternativa: Ajustes do Sistema → Privacidade e Segurança → rolar até o aviso do app → "Abrir Mesmo Assim".

Depois disso o app roda normalmente (até próxima atualização não-assinada ou nova quarentena).

**Atenção:** Gatekeeper + File Quarantine marcam via o extended attribute `com.apple.quarantine`. Removê-lo (ou usar right-click/Open) é o bypass clássico e documentado pela Apple/electron-builder para builds ad-hoc. O app dentro do DMG herdará o flag ao ser copiado.

---

## Windows — Authenticode + SmartScreen

### Custos (aprox. 2026, variam por revendedor e região; valide no momento da compra)
- **OV / Authenticode padrão (Code Signing)**: USD 150–300/ano (DigiCert, Sectigo etc.). Validação de identidade da organização/individual; chaves em HSM (obrigatório desde 2023 para OV).
- **EV Code Signing (Extended Validation)**: USD 400+/ano. Validação mais rigorosa + frequentemente token/HSM. **Importante (Microsoft oficial, 2024+)**: EV **não oferece mais bypass instantâneo do SmartScreen**. OV e EV agora seguem o mesmo modelo de reputação (acumula com downloads + tempo). Não vale pagar o premium EV só para evitar avisos do SmartScreen.
- Alternativa recomendada pela Microsoft para distribuição fora da Store: **Azure Artifact Signing** (antigo Trusted Signing) — ~USD 9,99/mês, cloud (sem token físico), integra com CI (GitHub Actions etc.). Reputação também se constrói com o tempo. Disponível para organizações (US/CA/EU/UK) e indivíduos (US/CA).
- Open source: SignPath Foundation oferece assinatura gratuita (nível OV) para projetos qualificados.

Vendedores comuns: DigiCert, Sectigo, GlobalSign, SSL.com. Revendedores e CodeSigningStore costumam ter descontos para devs Electron.

### Requisitos
- Certificado + private key (pfx/HSM ou via Azure Artifact Signing).
- electron-builder config `win` (exemplos):
  ```yaml
  win:
    sign: true
    # certificateSubjectName: "..."   # ou
    # certificateFile: ... + certificatePassword (via env/secret seguro)
    # ou azureTrustedSigning: { ... } para o cloud (recomendado MS)
  ```
- Builds assinados (qualquer OV/EV) passam melhor no SmartScreen com o tempo (reputação); sem assinatura: bloqueio forte + "More info > Run anyway".

### Testar build não assinado (ad-hoc / dev)
- Ao executar/instalar o .exe (ou installer NSIS): aparece "Windows protected your PC" / "publisher could not be verified".
- **Bypass principal para teste:** Clique **"More info"** → **"Run anyway"**.
- **Também comum:** Executar o instalador "como administrador" (botão direito → Executar como administrador) — ajuda com políticas UAC/empresa.
- SmartScreen pode continuar reclamando em cada máquina nova até o binário ganhar "reputação" (downloads repetidos + tempo + assinatura válida). Qualquer certificado assinado (OV ou EV) segue o mesmo caminho de reputação (desde 2024). Não existe vantagem de EV para SmartScreen.

Não existe "xattr" equivalente simples e confiável; assinatura real (OV + Azure/HSM recomendado) é o caminho para UX limpa em produção.

---

## Estado atual dos repositórios (EscalaFlow + FlowKit)

- `build/entitlements.mac.plist`: presente e correto para Electron (JIT + memória).
- `electron-builder.yml`: publica para GitHub Releases (nmarcofernandess owner para pessoais). Mac + Win runners no `.github/workflows/release.yml` (EscalaFlow); FlowKit usa `.github/workflows/dist.yml` (dispatch manual + artifacts, ainda ad-hoc).
- CI release (tag `v*`): EscalaFlow gera DMG + exe + latest-*.yml via release.yml (crítico para electron-updater). FlowKit ainda não tem fluxo de tag automatizado para releases (dist manual).
- **Falta em produção hoje**: secrets de Apple (notarize) e certificado Windows (OV/EV pfx ou Azure Artifact Signing) nos workflows de release público. Builds oficiais ainda são efetivamente ad-hoc/notarized apenas se o mantenedor roda local com credenciais. (Veja `electron-builder.yml`: `notarize: false`, `identity: "-"` para ad-hoc.)

Recomendação: 
- Adicione os secrets no repo GitHub (Settings → Secrets and variables → Actions): ex. `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` (ou `APPLE_API_KEY` + issuer para CI), `CSC_LINK`/`CSC_KEY_PASSWORD` para Mac code-sign, e equivalentes Windows (certificateFile base64 + password ou config Azure).
- Habilite `notarize: true` + `hardenedRuntime: true` no `mac` do builder quando os secrets estiverem presentes (gate condicional por env).
- Para Windows, prefira Azure Artifact Signing (integra CI sem token físico) ou armazene pfx + senha em secrets (cuidado com exfiltração; use variáveis de ambiente seguras).

---

## Links úteis

- Apple Developer enrollment: https://developer.apple.com/programs/enroll/
- Electron code signing (oficial): https://www.electronjs.org/docs/latest/tutorial/code-signing
- electron-builder notarization + entitlements: https://www.electron.build/docs/features/code-signing/notarization/
- Windows code signing options (Microsoft oficial, com tabela de custos/reputação 2026): https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options
- Azure Artifact Signing (Microsoft): https://learn.microsoft.com/en-us/azure/trusted-signing/
- Bypass rápido Mac (Gatekeeper): `xattr -dr com.apple.quarantine <app>` + right-click Open (ver também troubleshooting do electron-builder).

---

**Pacto P2**: custos e passos conferidos via fontes oficiais (Apple, Microsoft Learn, electron.build) + docs Electron em junho 2026. Preços variam por região/câmbio/revendedor; sempre valide no portal do fornecedor no momento da compra.

Mantido em sync com release.md e electron-builder.yml. (Entitlements atuais em `build/entitlements.mac.plist` + `identity: "-" + notarize: false` no yml para builds ad-hoc.)
