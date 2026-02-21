# Como Fazer um Release do EscalaFlow

> Guia completo: do zero ao `.dmg` nas mãos dos usuários com auto-update funcionando.

---

## Como funciona o sistema de atualização

```
┌─────────────────────────────────────────────────────┐
│                   FLUXO DE UPDATE                   │
│                                                     │
│  Marco faz release no GitHub                        │
│        ↓                                            │
│  GitHub hospeda os arquivos (.dmg, .zip, .yml)      │
│        ↓                                            │
│  App abre no computador do usuário                  │
│        ↓                                            │
│  App checa GitHub (após 5 segundos)                 │
│        ↓                                            │
│  "Tem versão nova?" ──────── Não → fica quieto      │
│        ↓ Sim                                        │
│  Baixa em background silenciosamente                │
│        ↓                                            │
│  Card "Atualizações" (em Configurações) acende      │
│        ↓                                            │
│  Usuário clica "Reiniciar e instalar"               │
│        ↓                                            │
│  App reinicia com a versão nova instalada           │
└─────────────────────────────────────────────────────┘
```

O usuário **não precisa fazer nada** — o sistema faz o download sozinho. Só clicar um botão no final.

---

## Peças que fazem isso funcionar

| Peça | Onde | O que faz |
|------|------|-----------|
| `electron-updater` | `package.json` (dep) | Biblioteca que gerencia o fluxo de update |
| `setupAutoUpdater()` | `src/main/index.ts` | Lógica do main process: checa, baixa, instala |
| Card "Atualizações" | `EmpresaConfig.tsx` | UI que mostra status e botão de instalar |
| `publish` no builder | `electron-builder.yml` | Diz pra onde publicar (GitHub: nmarcofernandess/escalaflow) |
| `latest-mac.yml` | GitHub Release | Arquivo que o app lê pra saber qual é a versão mais recente |
| `latest.yml` | GitHub Release | Idem para Windows |

---

## Como fazer um release (passo a passo)

### Pré-requisito: primeira vez

Certifique que você tem:
- `gh` CLI autenticado (`gh auth status`)
- `solver-bin/` compilado e atualizado (`npm run solver:build` se mudou o Python)

---

### Passo 1 — Suba a versão no `package.json`

```json
{
  "version": "1.1.0"
}
```

Regra de versionamento:
- `1.0.0 → 1.0.1` — bugfix
- `1.0.0 → 1.1.0` — feature nova
- `1.0.0 → 2.0.0` — breaking change / redesign grande

---

### Passo 2 — Commit e tag

```bash
git add package.json
git commit -m "chore: bump v1.1.0"
git tag v1.1.0
git push && git push --tags
```

A tag `v1.1.0` é o gatilho. O GitHub Release precisa ter exatamente o mesmo nome da tag.

---

### Passo 3 — Build e upload para o Mac

```bash
GH_TOKEN=$(gh auth token) npm run release:mac
```

Esse comando faz tudo de uma vez:
1. Compila o código (`electron-vite build`)
2. Empacota o app (`electron-builder --mac`)
3. Gera os arquivos em `dist/`:
   - `EscalaFlow-1.1.0-arm64.dmg` — instalador drag-and-drop
   - `EscalaFlow-1.1.0-arm64.zip` — alternativo
   - `latest-mac.yml` — **crítico** para o auto-updater saber da nova versão
4. Faz upload direto no GitHub Release

> Leva ~3-5 minutos. Não feche o terminal.

---

### Passo 4 — Revise e publique o release

O release é criado como **draft** automaticamente (seguro). Acesse:

```
https://github.com/nmarcofernandess/escalaflow/releases
```

Verifique:
- [ ] Versão correta no título
- [ ] Assets: `.dmg`, `.zip`, `latest-mac.yml`, `latest.yml`
- [ ] Escreva um changelog (o que mudou)
- [ ] Clique em **"Publish release"**

A partir desse momento, qualquer app aberto vai detectar a nova versão em até 5 segundos.

---

## Arquivos gerados em `dist/`

```
dist/
├── EscalaFlow-1.1.0-arm64.dmg         ← Instalador Mac (envia pro usuário)
├── EscalaFlow-1.1.0-arm64.dmg.blockmap ← Metadado para download delta
├── EscalaFlow-1.1.0-arm64.zip         ← Alternativo zip
├── EscalaFlow-1.1.0-arm64.zip.blockmap
├── latest-mac.yml                     ← Auto-updater lê esse arquivo
└── latest.yml                         ← Auto-updater Windows lê esse
```

**O `latest-mac.yml` é a chave de tudo.** Ele contém:
```yaml
version: 1.1.0
files:
  - url: EscalaFlow-1.1.0-arm64.dmg
    sha512: abc123...
    size: 120000000
path: EscalaFlow-1.1.0-arm64.dmg
sha512: abc123...
releaseDate: '2026-02-21T00:00:00.000Z'
```

Quando o app instalado checa o GitHub, ele baixa esse `.yml`, compara a versão com a instalada, e decide se baixa ou não.

---

## Primeiro acesso (instalação do zero)

Para quem ainda não tem o app instalado, envie o link direto do `.dmg`:

```
https://github.com/nmarcofernandess/escalaflow/releases/latest/download/EscalaFlow-X.X.X-arm64.dmg
```

**Aviso do macOS** — Como o app não tem assinatura Apple Developer (certificado caro), o macOS vai reclamar na primeira abertura:

```
"EscalaFlow" não pode ser aberto porque é de um desenvolvedor não identificado.
```

**Solução para o usuário:**
1. Clica com botão direito no `.dmg` → "Abrir"
2. Aparece o aviso → clica em "Abrir" novamente
3. Pronto. Só na primeira vez.

**Alternativa via Terminal** (mais técnico):
```bash
xattr -d com.apple.quarantine /Applications/EscalaFlow.app
```

---

## Distribuição sem internet (offline total)

Se o usuário não tiver internet, simplesmente copie o `.dmg` num pendrive e instale manualmente. O app funciona 100% offline depois de instalado — o auto-update simplesmente não vai funcionar, mas tudo mais sim.

---

## Comandos rápidos de referência

```bash
# Conferir versão atual
cat package.json | grep '"version"'

# Build Mac + upload GitHub (COMANDO PRINCIPAL)
GH_TOKEN=$(gh auth token) npm run release:mac

# Ver releases publicados
gh release list --repo nmarcofernandess/escalaflow

# Verificar assets de um release específico
gh release view v1.0.0 --repo nmarcofernandess/escalaflow

# Upload manual de arquivo para um release existente
gh release upload v1.1.0 dist/arquivo.dmg --repo nmarcofernandess/escalaflow

# Deletar um release (se errou algo)
gh release delete v1.1.0 --repo nmarcofernandess/escalaflow

# Deletar a tag correspondente (git)
git tag -d v1.1.0
git push origin :refs/tags/v1.1.0
```

---

## Pendências futuras

### Workflow CI/CD (Windows automático)

O arquivo `.github/workflows/release.yml` foi implementado mas ainda não está no repositório porque o token de autenticação atual não tem o scope `workflow`.

**Para ativar:**
1. Vá em github.com/settings/tokens
2. Edite o token atual e marque o checkbox `workflow`
3. Crie o arquivo `.github/workflows/release.yml` com o conteúdo abaixo e faça push:

```yaml
name: Release
on:
  push:
    tags:
      - 'v*'

permissions:
  contents: write

jobs:
  release-win:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm install
      - env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: npm run dist:win -- --publish always
```

Quando isso estiver ativo, ao fazer `git push --tags`, o Windows é buildado automaticamente no CI e o Mac você continua fazendo localmente (porque precisa do `solver-bin/` compilado).

### Assinatura Apple Developer

Pagar USD 99/ano no Apple Developer Program e configurar `CSC_LINK` + `CSC_KEY_PASSWORD` no ambiente. Depois o macOS abre sem aviso nenhum. Não é urgente para uso familiar.
