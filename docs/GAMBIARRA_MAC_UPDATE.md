# GAMBIARRA: Auto-Update no Mac sem Apple Developer Certificate

> **Status:** Plano B enquanto nao temos o Apple Developer Program ($99/ano).
> Quando tivermos o cert, isso tudo vira lixo — o electron-updater funciona nativo.

## Problema

macOS Tahoe + Apple Silicon exige assinatura em todo binario. Sem Apple Developer cert:
- O app abre com ad-hoc sign (`identity: "-"` no electron-builder.yml)
- Mas o auto-updater (`electron-updater`) baixa e substitui o .app automaticamente
- O binario substituido pode perder a assinatura ad-hoc → erro 163, app nao abre
- O usuario (RH nao-tecnico) fica travado

## Solucao: Update Manual via DMG

Em vez de auto-update silencioso, o app detecta que tem versao nova e guia o usuario a baixar o DMG manualmente.

### Fluxo do usuario

```
1. App abre normalmente (ja instalado e assinado)
2. App detecta versao nova disponivel
3. Card/modal aparece:
   "Nova versao X.Y.Z disponivel!"
   [Baixar Atualizacao]  ← abre o .dmg no browser
4. Usuario baixa o .dmg
5. Abre o .dmg
6. Arrasta EscalaFlow para /Aplicativos (substituindo o antigo)
7. macOS pergunta "Substituir?" → Sim
8. Se o app nao abrir: roda o script do Terminal
   (instrucao no arquivo "LEIA ANTES DE INSTALAR.txt" dentro do .dmg)
```

### Implementacao tecnica

#### 1. Detectar SO no main process

```typescript
// src/main/index.ts — dentro de setupAutoUpdater()
const isMacUnsigned = process.platform === 'darwin' && !process.env.CSC_LINK
```

#### 2. No Mac sem cert: check versao via GitHub API, nao via electron-updater

```typescript
// Ao inves de autoUpdater.checkForUpdates(), fazer:
import { net } from 'electron'

async function checkGitHubRelease(): Promise<{ hasUpdate: boolean; version: string; dmgUrl: string } | null> {
  const url = 'https://api.github.com/repos/nmarcofernandess/escalaflow/releases/latest'
  try {
    const resp = await net.fetch(url)
    const data = await resp.json()
    const latestVersion = data.tag_name?.replace('v', '')
    const currentVersion = app.getVersion()

    if (!latestVersion || latestVersion === currentVersion) {
      return { hasUpdate: false, version: currentVersion, dmgUrl: '' }
    }

    // Achar o .dmg nos assets
    const dmgAsset = data.assets?.find((a: any) => a.name.endsWith('.dmg'))
    return {
      hasUpdate: true,
      version: latestVersion,
      dmgUrl: dmgAsset?.browser_download_url ?? data.html_url,
    }
  } catch {
    return null
  }
}
```

#### 3. IPC handlers novos

```typescript
// Reaproveitar os channels existentes ou criar:
ipcMain.handle('update:check-manual', async () => {
  return await checkGitHubRelease()
})

ipcMain.handle('update:download-dmg', async (_e, url: string) => {
  shell.openExternal(url)  // abre no browser padrao
})
```

#### 4. UI no renderer (ConfiguracoesPagina.tsx — card "Atualizacoes")

```
Se Mac sem cert:
  - Mostrar versao atual
  - Botao "Verificar Atualizacoes"
  - Se tem update:
    - "EscalaFlow vX.Y.Z disponivel!"
    - Botao "Baixar DMG" → abre link no browser
    - Instrucao inline:
      "Apos baixar:
       1. Abra o arquivo .dmg
       2. Arraste o EscalaFlow para Aplicativos
       3. Confirme a substituicao
       4. Se nao abrir, abra o Terminal e cole:
          xattr -cr "/Applications/EscalaFlow.app" && open "/Applications/EscalaFlow.app""

Se Mac COM cert (ou Windows):
  - Fluxo normal do electron-updater (automatico)
```

#### 5. Decisao de qual fluxo usar

```typescript
// Flag simples: se o app esta assinado com Developer ID, o electron-updater funciona.
// Se nao, usa o fluxo manual.
//
// Como detectar:
//   - Se existir CSC_LINK no build, o app foi assinado com cert real
//   - Se identity === "-", foi ad-hoc (updater pode falhar)
//
// Jeito pragmatico: tentar electron-updater primeiro.
//   Se der erro no Mac → fallback pro fluxo manual.
//   No Windows, sempre usa electron-updater (funciona sem cert).
```

## Arquivos a modificar

| Arquivo | O que fazer |
|---------|-------------|
| `src/main/index.ts` | `setupAutoUpdater()` — adicionar branch Mac manual |
| `src/main/tipc.ts` | Handlers `update:check-manual` e `update:download-dmg` |
| `ConfiguracoesPagina.tsx` | Card Atualizacoes — branch visual Mac manual |
| `electron-builder.yml` | Ja feito: `identity: "-"` (ad-hoc sign) |

## Quando isso morre

Quando comprar o Apple Developer Program ($99/ano):

1. Gerar Developer ID Application certificate
2. Exportar como .p12
3. Adicionar como secret no GitHub Actions:
   - `CSC_LINK` = base64 do .p12
   - `CSC_KEY_PASSWORD` = senha do .p12
   - `APPLE_ID` = email Apple
   - `APPLE_APP_SPECIFIC_PASSWORD` = app-specific password
   - `APPLE_TEAM_ID` = Team ID
4. Mudar `electron-builder.yml`:
   ```yaml
   mac:
     identity: "Developer ID Application: Marco Fernandes (TEAMID)"
     notarize: true
   ```
5. Deletar todo o codigo de gambiarra
6. electron-updater volta a funcionar automaticamente
7. Celebrar

## Referencia

- Erro 163: macOS Tahoe recusa spawn de binario sem assinatura (kernel-level, Apple Silicon)
- `xattr -cr` remove quarentena mas NAO assina
- `codesign --force --deep --sign -` = ad-hoc sign (resolve o open, incerto pro updater)
- `identity: "-"` no electron-builder = ad-hoc sign no build time
- electron-updater no Mac precisa de cert real pra code sign apos download+replace
