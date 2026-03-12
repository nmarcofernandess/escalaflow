# Research: Auto-Update no macOS — Auto-Claude vs EscalaFlow

Research feita em 2026-03-12.

---

## TL;DR

O Auto-Claude **NAO dribla nada**. Ele faz o caminho completo:
Apple Developer cert ($99/ano) + Hardened Runtime + Notarization + Stapling.
O macOS confia porque a Apple mandou confiar.

Para o EscalaFlow funcionar igual, precisa do mesmo investimento.
A alternativa é o bypass manual do ShipIt (já implementado em v1.5.1).

---

## 1. Auto-Claude: Stack

| Componente | Versao |
|-----------|--------|
| Electron | 40 |
| electron-builder | 26.4.0 |
| electron-updater | 6.7.3 |
| Signing | Developer ID Application: Mikalsen AI AS (74WL62P295) |
| Notarization | Sim (Apple Notarized + Stapled) |

---

## 2. Config de Build do Auto-Claude

No `package.json` (inline, chave `"build"`):

```json
"mac": {
  "category": "public.app-category.developer-tools",
  "hardenedRuntime": true,
  "gatekeeperAssess": false,
  "entitlements": "resources/entitlements.mac.plist",
  "entitlementsInherit": "resources/entitlements.mac.plist",
  "target": ["dmg", "zip"]
}
```

**Pontos criticos:**
- `hardenedRuntime: true` — obrigatorio para notarization
- `target: ["dmg", "zip"]` — **ZIP obrigatorio** para auto-update no Mac
- **NAO tem `identity`** na config — signing via env vars no CI
- **NAO tem `notarize`** na config — notarization via custom GitHub Action

---

## 3. CI/CD do Auto-Claude

### Signing (no step de build)

```yaml
- name: Package macOS
  env:
    CSC_LINK: ${{ secrets.MAC_CERTIFICATE }}            # .p12 em base64
    CSC_KEY_PASSWORD: ${{ secrets.MAC_CERTIFICATE_PASSWORD }}
```

### Notarization (custom actions separadas)

```yaml
# Job 1: Submit async
- uses: ./.github/actions/submit-macos-notarization
  with:
    apple-id: ${{ secrets.APPLE_ID }}
    apple-app-specific-password: ${{ secrets.APPLE_APP_SPECIFIC_PASSWORD }}
    apple-team-id: ${{ secrets.APPLE_TEAM_ID }}

# Job 2: Wait + Staple
finalize-notarization:
  needs: [build-macos]
  # xcrun notarytool wait
  # xcrun stapler staple
```

### Secrets necessarios

| Secret | O que e |
|--------|---------|
| `MAC_CERTIFICATE` | Certificado Developer ID Application (.p12) exportado em base64 |
| `MAC_CERTIFICATE_PASSWORD` | Senha do .p12 |
| `APPLE_ID` | Email da conta Apple Developer |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password (gerada em appleid.apple.com) |
| `APPLE_TEAM_ID` | Team ID do programa Apple Developer |

---

## 4. Code Signing — A Diferenca Mortal

### Auto-Claude (codesign -dv)

```
Authority=Developer ID Application: Mikalsen AI AS (74WL62P295)
Authority=Developer ID Certification Authority
Authority=Apple Root CA
flags=0x10000(runtime)          ← hardened runtime
TeamIdentifier=74WL62P295
```

**Designated Requirement:**
```
identifier "com.autoclaude.ui" and anchor apple generic
  and certificate leaf[subject.OU] = "74WL62P295"
```

### EscalaFlow (codesign -dv)

```
flags=0x20002(adhoc,linker-signed)  ← NAO e code signed de verdade
Signature=adhoc
TeamIdentifier=not set
```

**Designated Requirement:**
```
cdhash H"385cb41285554dc46c72fb749b97e3848a2b0f9f"
```

### Por que isso mata o auto-update

O ShipIt (Squirrel.Mac) faz isso ao instalar update:
1. Pega assinatura do app ATUAL
2. Pega assinatura do app NOVO (baixado)
3. Verifica se ambos atendem ao mesmo **designated requirement**

Com **Developer ID**: o requirement e `TeamIdentifier = 74WL62P295`.
Constante entre builds. App atual e novo tem o mesmo Team ID. **PASSA.**

Com **ad-hoc** (`identity: "-"`): o requirement e `cdhash H"..."`.
O hash muda A CADA BUILD. O app novo tem hash diferente do atual.
**FALHA SEMPRE.** E impossivel passar.

---

## 5. Gatekeeper

### Auto-Claude
```bash
$ spctl --assess --type execute --verbose /Applications/Auto-Claude.app
# accepted
# source=Notarized Developer ID
```

### EscalaFlow
```bash
$ spctl --assess --type execute --verbose /Applications/EscalaFlow.app
# accepted
# override=security disabled    ← so funciona com GateKeeper desabilitado
```

---

## 6. Fluxo Completo do Auto-Update (MacUpdater)

1. `electron-updater` checa GitHub Releases → acha versao nova
2. Baixa o **ZIP** (NAO o DMG) do release
3. Cria server HTTP local (localhost, porta aleatoria, auth Basic)
4. Configura `electron.autoUpdater` nativo (Squirrel.Mac) → aponta pro localhost
5. Squirrel.Mac baixa ZIP via HTTP local
6. **ShipIt** descompacta ZIP e valida code signature
7. ShipIt substitui o `.app` em /Applications/
8. App relanca

**Passo 6 e onde o EscalaFlow falha** — ShipIt rejeita a code signature.

---

## 7. Comparacao Final

| Aspecto | Auto-Claude | EscalaFlow |
|---------|-------------|------------|
| Code Signing | Developer ID (real) | ad-hoc / null |
| Notarization | Sim | Nao |
| Mac target | `["dmg", "zip"]` | `["dmg", "zip"]` (fix v1.4.9) |
| Designated Requirement | TeamIdentifier (constante) | cdhash (muda a cada build) |
| ShipIt verification | Passa | **Falha sempre** |
| Gatekeeper | "Notarized Developer ID" | "security disabled" |
| Custo | $99/ano Apple Developer | $0 |

---

## 8. Opcoes para o EscalaFlow

### OPCAO A: Apple Developer Certificate ($99/ano)

A solucao real. Exatamente o que o Auto-Claude faz.

**Setup unico (~1h):**
1. Conta Apple Developer ($99/ano) — developer.apple.com
2. Gerar certificado "Developer ID Application"
3. Exportar como .p12, converter pra base64
4. Adicionar secrets no GitHub:
   - `MAC_CERTIFICATE` (base64 do .p12)
   - `MAC_CERTIFICATE_PASSWORD`
   - `APPLE_ID`
   - `APPLE_APP_SPECIFIC_PASSWORD`
   - `APPLE_TEAM_ID`
5. Atualizar `electron-builder.yml`:
   ```yaml
   mac:
     hardenedRuntime: true
     gatekeeperAssess: false
     entitlements: resources/entitlements.mac.plist
     entitlementsInherit: resources/entitlements.mac.plist
     target:
       - dmg
       - zip
   ```
6. Atualizar CI pra passar `CSC_LINK` e `CSC_KEY_PASSWORD`
7. Adicionar notarization (pode ser inline ou custom action)

**Resultado:**
- Auto-update funciona nativamente (ShipIt aceita)
- Sem "arquivo corrompido" na primeira instalacao
- Sem xattr manual
- Profissional

### OPCAO B: Bypass ShipIt (ja implementado v1.5.1)

Nao usa ShipIt. Faz a substituicao manualmente:
1. electron-updater detecta + baixa ZIP normalmente
2. Na hora de instalar, encontra o .app no cache do ShipIt
3. Remove quarantine + code signatures
4. Substitui o app via mv atomico
5. Relanca

**Resultado:**
- Gratis
- Auto-update funciona (com bypass)
- Primeira instalacao ainda precisa de xattr manual
- Pode quebrar em updates futuros do macOS

### OPCAO C: Nenhum auto-update

DMG manual toda vez. Nao recomendado.

---

## 9. Entitlements (referencia do Auto-Claude)

Se for pra Opcao A, criar `resources/entitlements.mac.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.cs.allow-jit</key>
  <true/>
  <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
  <true/>
  <key>com.apple.security.cs.allow-dyld-environment-variables</key>
  <true/>
  <key>com.apple.security.network.client</key>
  <true/>
  <key>com.apple.security.files.user-selected.read-write</key>
  <true/>
</dict>
</plist>
```

---

*Conclusao: nao tem magica. Tem $99/ano e um CI bem configurado.*
