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
