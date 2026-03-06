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
│  GitHub hospeda os arquivos (.dmg, .exe, .yml)      │
│        ↓                                            │
│  App abre no computador do usuário                  │
│        ↓                                            │
│  App checa GitHub (após 5 segundos)                 │
│        ↓                                            │
│  Lê latest-mac.yml / latest.yml do release          │
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
| Card "Atualizações" | `ConfiguracoesPagina.tsx` | UI que mostra status e botão de instalar |
| `publish` no builder | `electron-builder.yml` | Diz pra onde publicar (GitHub: nmarcofernandess/escalaflow) |
| **`latest-mac.yml`** | GitHub Release | **CRITICO** — arquivo que o app lê pra saber a versão mais recente (Mac) |
| **`latest.yml`** | GitHub Release | **CRITICO** — idem para Windows |

### O que quebra sem os YAMLs

Sem `latest-mac.yml` / `latest.yml` no release, o `electron-updater`:
- Retorna erro ao verificar atualizações
- Nunca detecta versão nova
- Mostra "Erro ao verificar atualizações" na UI

**Esses arquivos são gerados automaticamente pelo `electron-builder`** durante o build. Se fizer upload manual dos assets (.dmg/.exe), precisa gerar e subir os YAMLs também.

---

## Ritual de Release

### Passo 1 — Bump version no `package.json`

```bash
# Verificar versão atual
grep '"version"' package.json

# Editar para a nova versão
```

Regra de versionamento:
- `1.0.0 → 1.0.1` — bugfix
- `1.0.0 → 1.1.0` — feature nova
- `1.0.0 → 2.0.0` — breaking change / redesign grande

### Passo 2 — Commit, tag e push

```bash
git add package.json
git commit -m "chore: bump vX.Y.Z"
git tag vX.Y.Z
git push && git push --tags
```

**A versão no package.json DEVE ser identica a tag** (sem o `v` prefix).

### Passo 3 — Build e upload

**Opção A: CI automático (recomendado)**

O push da tag dispara `.github/workflows/release.yml` que builda Mac + Windows em paralelo e faz upload como draft.

```bash
# Acompanhar o CI
gh run watch --repo nmarcofernandess/escalaflow
```

**Opção B: Local (Mac only)**

```bash
GH_TOKEN=$(gh auth token) npm run release:mac
```

### Passo 4 — Verificação OBRIGATORIA antes de publicar

Antes de clicar "Publish release", verificar:

```bash
# Listar assets do release
gh release view vX.Y.Z --repo nmarcofernandess/escalaflow --json assets --jq '.assets[].name'
```

**Checklist de assets:**

| Asset | Mac | Windows | Obrigatorio |
|-------|-----|---------|-------------|
| `EscalaFlow-X.Y.Z-arm64.dmg` | Sim | -- | Sim (Mac) |
| `EscalaFlow-Setup-X.Y.Z.exe` | -- | Sim | Sim (Win) |
| **`latest-mac.yml`** | Sim | -- | **SIM — auto-updater Mac** |
| **`latest.yml`** | -- | Sim | **SIM — auto-updater Win** |
| `*.blockmap` | Sim | Sim | Opcional (delta updates) |

**Se `latest-mac.yml` ou `latest.yml` estiver faltando, o auto-update NÃO FUNCIONA.**

### Passo 5 — Publicar

```bash
# Via CLI
gh release edit vX.Y.Z --repo nmarcofernandess/escalaflow --draft=false

# Ou via browser
# https://github.com/nmarcofernandess/escalaflow/releases
```

### Passo 6 — Validar

```bash
# Confirmar que é o "Latest"
gh release list --repo nmarcofernandess/escalaflow --limit 3

# Baixar e verificar o YAML
gh release download vX.Y.Z --repo nmarcofernandess/escalaflow --pattern 'latest-mac.yml' --output -
```

---

## Recuperação: YAML faltando em release já publicado

Se publicou um release sem os YAMLs (como aconteceu com v1.2.0):

```bash
# 1. Baixar os assets
mkdir /tmp/fix-release && cd /tmp/fix-release
gh release download vX.Y.Z --repo nmarcofernandess/escalaflow

# 2. Calcular SHA512
SHA=$(shasum -a 512 EscalaFlow-X.Y.Z-arm64.dmg | awk '{print $1}' | xxd -r -p | base64)
SIZE=$(stat -f%z EscalaFlow-X.Y.Z-arm64.dmg)  # macOS
# SIZE=$(stat --printf="%s" arquivo)            # Linux

# 3. Criar latest-mac.yml
cat > latest-mac.yml << YAML
version: X.Y.Z
files:
  - url: EscalaFlow-X.Y.Z-arm64.dmg
    sha512: $SHA
    size: $SIZE
path: EscalaFlow-X.Y.Z-arm64.dmg
sha512: $SHA
releaseDate: '2026-01-01T00:00:00.000Z'
YAML

# 4. Upload
gh release upload vX.Y.Z latest-mac.yml --repo nmarcofernandess/escalaflow --clobber

# 5. Limpar
rm -rf /tmp/fix-release
```

---

## CI/CD (GitHub Actions)

O workflow `.github/workflows/release.yml` builda Mac + Windows automaticamente ao pushar uma tag `v*`.

**Trigger:** `git push --tags` com tag `v*`
**Output:** Draft release com todos os assets (DMG, EXE, YAMLs, blockmaps)

### Se o CI falhar

Problemas comuns:
- **rollup-win32-x64-msvc**: `npm ci` no Windows as vezes falha com deps nativas. Fix: adicionar `npm install @rollup/rollup-win32-x64-msvc` como step separado
- **solver build**: Python/PyInstaller precisa estar configurado corretamente no runner
- **timeout**: build leva ~10-15min, timeout padrão do Actions é 6h (OK)

Se o CI falhar, o release fica como draft incompleto. Opcoes:
1. Corrigir o CI e re-triggerar com nova tag
2. Build local e upload manual (nao esquecer os YAMLs!)

---

## Arquivos gerados em `dist/`

```
dist/
├── EscalaFlow-X.Y.Z-arm64.dmg         <- Instalador Mac
├── EscalaFlow-X.Y.Z-arm64.dmg.blockmap
├── EscalaFlow-Setup-X.Y.Z.exe         <- Instalador Windows
├── EscalaFlow-Setup-X.Y.Z.exe.blockmap
├── latest-mac.yml                      <- AUTO-UPDATER MAC (obrigatorio)
└── latest.yml                          <- AUTO-UPDATER WIN (obrigatorio)
```

---

## Primeiro acesso (instalação do zero)

Para quem ainda não tem o app instalado, envie o link direto:

```
https://github.com/nmarcofernandess/escalaflow/releases/latest/download/EscalaFlow-X.Y.Z-arm64.dmg
```

**Aviso do macOS** — Como o app não tem assinatura Apple Developer:

```
"EscalaFlow" não pode ser aberto porque é de um desenvolvedor não identificado.
```

**Solução para o usuário:**
1. Clica com botão direito no `.dmg` > "Abrir"
2. Aparece o aviso > clica em "Abrir" novamente
3. Pronto. Só na primeira vez.

**Alternativa via Terminal:**
```bash
xattr -d com.apple.quarantine /Applications/EscalaFlow.app
```

---

## Distribuição sem internet (offline total)

Copie o `.dmg` num pendrive e instale manualmente. O app funciona 100% offline — o auto-update simplesmente não vai funcionar, mas tudo mais sim.

---

## Comandos rápidos de referência

```bash
# Conferir versão atual
grep '"version"' package.json

# Build Mac + upload GitHub
GH_TOKEN=$(gh auth token) npm run release:mac

# Ver releases publicados
gh release list --repo nmarcofernandess/escalaflow

# Verificar assets de um release
gh release view vX.Y.Z --repo nmarcofernandess/escalaflow --json assets --jq '.assets[].name'

# Upload manual de arquivo para release existente
gh release upload vX.Y.Z dist/arquivo.dmg --repo nmarcofernandess/escalaflow --clobber

# Publicar draft
gh release edit vX.Y.Z --repo nmarcofernandess/escalaflow --draft=false

# Deletar release (se errou)
gh release delete vX.Y.Z --repo nmarcofernandess/escalaflow

# Deletar tag
git tag -d vX.Y.Z && git push origin :refs/tags/vX.Y.Z

# Acompanhar CI
gh run watch --repo nmarcofernandess/escalaflow
```

---

## Pendências futuras

### Assinatura Apple Developer

Pagar USD 99/ano no Apple Developer Program e configurar `CSC_LINK` + `CSC_KEY_PASSWORD` no ambiente. Depois o macOS abre sem aviso nenhum. Não é urgente para uso familiar.

### Code signing Windows

Certificado EV para Windows remove o aviso do SmartScreen. Custo variável. Também não urgente.
