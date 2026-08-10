# Task 5 Report — Rewrite the Release Runbook and Lock the Migration Message

## Status

- Status: concluída com escopo restrito à Task 5.
- Worktree: `/Users/marcoantonio/escalaflow-macos-developer-id-notarization`
- Branch: `codex/macos-developer-id-notarization`
- Boundary preservada: nenhum toque em tags, releases, Apple credentials ou superfícies das Tasks 1–4 como parte do commit.

## Files

Alterados nesta task:

- `README.md`
- `docs/release.md`
- `docs/certificados.md`
- `resources/LEIA ANTES DE INSTALAR.txt`
- `tests/main/release-docs-contract.spec.ts`
- removido: `scripts/Instalar-EscalaFlow.command`

Arquivo adicional solicitado pelo operador:

- `.superpowers/sdd/2026-08-09-escalaflow-macos-developer-id-notarization/task-5-report.md`

## TDD

### RED

Primeiro foi criado `tests/main/release-docs-contract.spec.ts` com dois contratos:

1. `docs/release.md` precisa documentar `Developer ID Application`, `v1.12.0`, `reinstalação`, `v1.12.1 → v1.12.2`, `signed-mac.yml` e `latest-mac.yml`.
2. superfícies de docs não podem prescrever bypass (`xattr`, `codesign --remove-signature`, `Open Anyway`, `Abrir Mesmo Assim`, `Control-click`) e o helper `scripts/Instalar-EscalaFlow.command` precisa estar ausente.

Falha confirmada antes de editar docs:

- `docs/release.md` não continha `Developer ID Application`
- `README.md`, `docs/release.md`, `docs/certificados.md` e `resources/LEIA ANTES DE INSTALAR.txt` ainda continham instruções explícitas de bypass

### GREEN

Depois do RED:

- reescrevi `docs/release.md` em torno do pipeline Developer ID/notarização
- reescrevi `docs/certificados.md` para remover guia executável de bypass e manter apenas o contexto de confiança
- reescrevi a superfície de instalação do `README.md`
- reescrevi `resources/LEIA ANTES DE INSTALAR.txt` para drag/open normal + stop/verify/contact
- removi `scripts/Instalar-EscalaFlow.command`

### REFACTOR

- consolidei a narrativa única de migração: `v1.12.0 -> DMG v1.12.1 -> updater v1.12.2`
- removi recovery normal baseado em apagar/reescrever release/tag
- alinhei a documentação ao contrato já implementado nas Tasks 1–4: `release:mac` com `--publish never`, `signed-mac.yml` obrigatório, `latest-mac.yml` proibido e `latest.yml` preservado para Windows

## Comandos e resultados

### Leitura obrigatória concluída

Lidos integralmente antes de editar:

- `task-5-brief.md`
- `specs/001-macos-developer-id-notarization/SPEC.md`
- `specs/001-macos-developer-id-notarization/OPERATOR-APPLE.md`
- `README.md`
- `docs/release.md`
- `docs/certificados.md`
- `resources/LEIA ANTES DE INSTALAR.txt`

### Execuções

#### 1. RED obrigatório

```bash
npm run test -- tests/main/release-docs-contract.spec.ts
```

Resultado: falhou como esperado, com ausência de `Developer ID Application` e presença de bypass legado.

#### 2. GREEN do contrato da task

```bash
npm run test -- tests/main/release-docs-contract.spec.ts
```

Resultado: passou.

#### 3. Scan literal da brief

```bash
if rg -n 'xattr\b|codesign --remove-signature|Abrir Mesmo Assim|Open Anyway|Control-click|publish always' README.md docs/release.md docs/certificados.md resources/'LEIA ANTES DE INSTALAR.txt' scripts; then
  echo 'FAIL: legacy Gatekeeper bypass guidance remains' >&2
  exit 1
fi
```

Resultado: falhou por hits fora do escopo da Task 5:

- `scripts/fetch-llama-server.mjs`
- `scripts/mac-distribution-audit.mjs`

Esses hits pertencem a superfícies internas das Tasks 1–4 e não foram alterados para preservar o pedido de implementar somente a Task 5.

#### 4. Scan das superfícies da Task 5

```bash
if rg -n 'xattr\b|codesign --remove-signature|Abrir Mesmo Assim|Open Anyway|Control-click|publish always' README.md docs/release.md docs/certificados.md resources/'LEIA ANTES DE INSTALAR.txt'; then
  echo 'FAIL: docs surfaces still contain legacy bypass guidance' >&2
  exit 1
fi
```

Resultado: passou.

#### 5. Whitespace / patch hygiene

```bash
git diff --check
```

Resultado: passou.

## Self-review

### Compliance review

Checklist validado manualmente:

- `v1.12.0` ficou explicitamente marcado como legado inseguro para updater
- a migração única por DMG `v1.12.1` ficou explícita
- a prova do updater ficou explícita como `v1.12.1 → v1.12.2`
- `signed-mac.yml` ficou obrigatório
- `latest-mac.yml` ficou proibido para macOS novo
- `latest.yml` ficou preservado para Windows
- não há instrução de limpar quarentena, remover assinatura, usar override do Gatekeeper ou reescrever release/tag como recovery normal

### Quality review

Validei a documentação contra as superfícies já implementadas na branch:

- `package.json` já define `release:mac` com `electron-builder --mac --arm64 --publish never`
- `.github/workflows/release.yml` já usa `signed-mac.yml`, rejeita `latest-mac.yml` no job Mac e mantém `latest.yml` no job Windows
- `electron-builder.yml` já está no contrato `signed`

## Concerns

1. O scan literal da brief continua acusando ocorrências em `scripts/fetch-llama-server.mjs` e `scripts/mac-distribution-audit.mjs`. Não corrigi isso porque:
   - não são superfícies listadas na Task 5;
   - mexer nelas tocaria artefatos das Tasks 1–4;
   - o pedido foi preservar Tasks 1–4 e commitar apenas arquivos da Task 5.
2. O teste de contrato e os docs da Task 5 estão verdes; o único desvio restante é essa varredura ampla sobre `scripts/`.

## Commit

- Commit message: `docs: define trusted macOS release runbook`

## Fix round 1 — Important/P2 compliance

### Objetivo

Endurecer o gate de prova de instalação fresca no `docs/release.md` para impedir leitura permissiva de "bytes do release" obtidos por CLI/API, que pode perder a quarentena de origem do navegador.

### TDD

#### RED

Primeiro ajustei `tests/main/release-docs-contract.spec.ts` com um contrato focado:

- `docs/release.md` deve exigir `browser UI`
- deve citar a `authenticated GitHub draft/public release page`
- deve dizer que `CLI/API downloads are not sufficient`
- deve exigir abertura `without any bypass`
- não pode manter a frase permissiva `bytes baixados do release ou um Mac/perfil fresco`

Comando:

```bash
npm run test -- tests/main/release-docs-contract.spec.ts
```

Resultado RED: 1 falha, exatamente porque o runbook ainda aceitava a formulação genérica anterior.

#### GREEN

Depois do RED, reescrevi apenas a seção `## Prova de Gatekeeper em download real` em `docs/release.md` para exigir:

- download do DMG pelo browser UI
- navegação pela página autenticada do draft/release no GitHub
- preservação da quarentena de origem do navegador
- rejeição explícita de `gh release download`, `curl`, API e bytes reaproveitados
- instalação e abertura sem bypass

### Evidência desta rodada

```bash
npm run test -- tests/main/release-docs-contract.spec.ts
```

Resultado: PASS (`3 tests`)

```bash
if rg -n 'xattr\b|codesign --remove-signature|Abrir Mesmo Assim|Open Anyway|Control-click|publish always' README.md docs/release.md docs/certificados.md resources/'LEIA ANTES DE INSTALAR.txt'; then
  echo 'FAIL: docs surfaces still contain legacy bypass guidance' >&2
  exit 1
fi
```

Resultado: PASS

```bash
git diff --check
```

Resultado: PASS

### Self-review

- o gate agora exige prova com bytes baixados pelo navegador, não por CLI/API
- a redação ficou explícita sobre draft/release page autenticada do GitHub
- a abertura continua proibindo bypass
- não toquei no README além do que já existia da rodada anterior
- não toquei no scan amplo de `scripts/`

### Deferred minors desta rodada

1. P3 do README support wording: não tratado nesta rodada por pedido explícito.
2. Broad internal scripts scan: não tratado nesta rodada por pedido explícito; continua fora do escopo desta correção focada.

## Fix round 2 — version pre-tag + broad scan allowlist

### Objetivo

Corrigir dois pontos do quality review sem tocar nos outros tasks:

1. explicitar no runbook o bump obrigatório de versão antes de PR/tag, com convergência entre `package.json`, `package-lock.json` e a tag;
2. endurecer `tests/main/release-docs-contract.spec.ts` para varrer também `scripts/`, com allowlist explícita somente para os dois usos internos já aprovados.

### TDD

#### RED

Ampliei o teste focado com dois contratos novos:

- `docs/release.md` deve exigir `package.json`, `package-lock.json`, `npm version <versao> --no-git-tag-version`, `npm pkg get version`, exemplos `v1.12.1`/`v1.12.2` e a regra “não se cria tag enquanto a versão não bater”;
- o scan de bypass passa a cobrir `scripts/`, permitindo somente:
  - `scripts/fetch-llama-server.mjs` no contexto interno de preparação do sidecar;
  - `scripts/mac-distribution-audit.mjs` no contexto interno de rejeição de DMG inseguro.

Primeira execução RED:

```bash
npm run test -- tests/main/release-docs-contract.spec.ts
```

Resultado:

- falha esperada por ausência de `package-lock.json`/convergência de versão no runbook;
- ruído inicial da allowlist foi corrigido no próprio teste até o RED ficar concentrado só na ausência de documentação.

#### GREEN

Depois do RED:

- atualizei `docs/release.md` na seção `## Sequência obrigatória antes da tag`;
- incluí o comando seguro `npm version <versao> --no-git-tag-version`;
- incluí a checagem `npm pkg get version`;
- explicitei que `package.json`, `package-lock.json` e a tag precisam convergir;
- deixei exemplos explícitos para `1.12.1` e `1.12.2`;
- mantive o scan amplo no teste com allowlist exata por caminho e contexto.

### Evidência desta rodada

```bash
npm run test -- tests/main/release-docs-contract.spec.ts
```

Resultado: PASS (`5 tests`)

```bash
node <<'NODE'
const fs = require('node:fs')
const path = require('node:path')
const forbidden = [
  /xattr\\b/i,
  /codesign --remove-signature/i,
  /Abrir Mesmo Assim/i,
  /Open Anyway/i,
  /Control-click/i,
  /bot[aã]o direito.*Abrir/i,
]
const publicPaths = [
  'README.md',
  'docs/release.md',
  'docs/certificados.md',
  'resources/LEIA ANTES DE INSTALAR.txt',
]
for (const file of publicPaths) {
  const text = fs.readFileSync(file, 'utf8')
  for (const pattern of forbidden) {
    if (pattern.test(text)) throw new Error(`forbidden token in public surface: ${file}`)
  }
}
const allow = new Map([
  ['scripts/fetch-llama-server.mjs', ["spawnSync('xattr'", 'remove quarantine', 'best-effort']],
  ['scripts/mac-distribution-audit.mjs', ['DMG_BYPASS_MARKERS', 'Instalar-EscalaFlow\\\\.command', 'verifyMountedReadme', 'for (const marker of DMG_BYPASS_MARKERS)']],
])
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return walk(full)
    if (entry.isFile()) return [full]
    return []
  })
}
for (const file of walk('scripts')) {
  const rel = file.split(path.sep).join(path.posix.sep)
  const text = fs.readFileSync(file, 'utf8')
  const hasForbidden = forbidden.some((pattern) => pattern.test(text))
  if (!hasForbidden) continue
  const markers = allow.get(rel)
  if (!markers) throw new Error(`unexpected bypass token in script: ${rel}`)
  for (const marker of markers) {
    if (!text.includes(marker)) throw new Error(`allowlist context mismatch in ${rel}; missing ${marker}`)
  }
}
NODE
```

Resultado: PASS

```bash
git diff --check
```

Resultado: PASS

### Self-review

- o runbook agora trava a convergência de versão antes do PR/tag;
- a sequência pré-tag ficou explícita sobre não criar tag enquanto a versão não bater;
- o teste deixou de ficar false-green para scripts inesperados com tokens de bypass;
- não alterei `scripts/fetch-llama-server.mjs` nem `scripts/mac-distribution-audit.mjs`;
- o P3 do README/checksum continua deferido nesta rodada, como solicitado.

## Fix round 3 — allowlist fail-closed por ocorrência e contexto

### Objetivo

Corrigir somente o P2 do quality review: a allowlist anterior verificava apenas se
marcadores existiam em algum lugar do arquivo permitido. A nova regra compara todas
as ocorrências proibidas encontradas, com token, match, linha, coluna e linha-fonte.

### TDD

#### RED

Sem alterar os scripts internos, troquei primeiro os marcadores permissivos do teste
por registros de ocorrência exatos. A implementação antiga ainda chamava
`content.toContain(marker)`, portanto não conseguia satisfazer a nova expectativa.

```bash
npm run test -- tests/main/release-docs-contract.spec.ts
```

Resultado RED: 1 falha e 4 testes passando; a falha ocorreu no scanner antigo ao
tentar comparar o registro exato da ocorrência de `xattr`.

#### GREEN

Depois do RED, mantive a allowlist limitada aos dois caminhos internos e implementei
no próprio teste:

- extração global de cada token proibido com `matchAll`, linha, coluna e linha completa;
- comparação fechada (`toEqual`) entre as ocorrências reais e o conjunto esperado;
- zero ocorrências permitido em cada README/docs/DMG readme público;
- conjunto vazio obrigatório para qualquer script novo ou não allowlisted;
- seis marcadores literais exatos do `mac-distribution-audit.mjs`;
- uma única ocorrência exata do comando interno `xattr` do `fetch-llama-server.mjs`.

A razão das exceções ficou documentada no teste: o primeiro uso prepara sidecar
internamente antes da assinatura; o segundo são regexes internas para rejeitar DMG
inseguro. Nenhum deles é instrução para usuário.

### Evidência desta rodada

```bash
npm run test -- tests/main/release-docs-contract.spec.ts
```

Resultado: PASS (`5 tests`).

Scan amplo independente, usando os mesmos padrões e o mesmo conjunto exato de
ocorrências esperadas:

```bash
node <inline broad release-docs scan with exact occurrence allowlist>
```

Resultado: PASS (`14 scripts`, `4 public surfaces`).

```bash
git diff --check
```

Resultado: PASS.

### Self-review

- qualquer ocorrência extra, mesmo dentro dos dois arquivos allowlisted, agora falha;
- qualquer token proibido em script novo ou em outro script agora falha;
- qualquer ocorrência nas quatro superfícies públicas agora falha;
- a allowlist não confia mais na presença de marcadores espalhados pelo arquivo;
- não alterei `scripts/fetch-llama-server.mjs` nem `scripts/mac-distribution-audit.mjs`;
- os P3 de README/checksum continuam explicitamente adiados.

### Concerns

Os registros incluem linha e contexto literal de propósito: uma mudança interna nesses
dois scripts deve exigir revisão explícita da allowlist. Isso mantém o gate fail-closed.
Nenhum segredo, credential Apple, tag, release ou arquivo das Tasks 1–4 foi tocado.

### Commit

- Commit: incluído no commit final desta rodada; SHA reportado no handoff.

## Fix round 4 — validação final do P2 e commit

### Causa raiz reproduzida

No `HEAD 436c2d4`, a implementação anterior aceitava qualquer ocorrência
adicional dentro dos dois caminhos allowlisted porque apenas verificava
`content.toContain(marker)`. Uma reprodução em memória confirmou que inserir
`// Open Anyway` em `fetch-llama-server.mjs` ou `// xattr` em
`mac-distribution-audit.mjs` permanecia verde.

A implementação atual compara o conjunto completo de ocorrências, incluindo
token, match literal, linha, coluna e texto integral da linha. A mesma
reprodução confirmou que ambas as injeções são rejeitadas.

### Evidência final

```bash
npm run test -- tests/main/release-docs-contract.spec.ts
```

Resultado: PASS (`5 tests`).

Scan amplo independente, com os mesmos padrões e a mesma allowlist de
ocorrências exatas:

```bash
node --input-type=module - <<'NODE'
# scanner inline: quatro superfícies públicas sem ocorrências; 14 scripts
# comparados contra o conjunto exato esperado; demais scripts exigem conjunto vazio
NODE
```

Resultado: PASS (`14 scripts` e `4 public surfaces checked`). O conjunto
permitido permaneceu restrito a uma chamada `xattr` em
`fetch-llama-server.mjs` e aos seis marcadores literais de
`mac-distribution-audit.mjs`; qualquer ocorrência extra ou em outro script
falhou no scanner.

```bash
git diff --check
```

Resultado: PASS.

O diff de implementação permanece restrito a
`tests/main/release-docs-contract.spec.ts`; o único arquivo adicional alterado
é este relatório solicitado. README, checksum e os scripts das Tasks 1–4 não
foram modificados nesta rodada.

### Commit

- Commit: incluído no commit final desta rodada; SHA reportado no handoff.
