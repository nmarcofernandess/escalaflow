#!/usr/bin/env node
// Baixa o binario `llama-server` (llama.cpp) por plataforma/arch e o coloca em
// `llama.cpp/<platform>-<arch>/` — exatamente o diretorio que o resolver de
// runtime (src/main/ia/llama-server-runtime.ts -> findLlamaServerBinary) ja
// procura dentro de `resourcesPath`. Sem isso, electron-builder nao tem o que
// empacotar via extraResources.
//
// Robusto a mudanca de layout do release: extrai num tmp, LOCALIZA o binario
// onde quer que ele esteja, e copia o diretorio inteiro que o contem (binario
// + dylibs/DLLs irmaos), preservando symlinks.
//
// Offline-friendly: se o download falhar e existir um build local de
// referencia (~/.local/share/llama-cpp-bin/llama-<TAG>/), usa ele.

import fs from 'node:fs'
import https from 'node:https'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { spawnSync } from 'node:child_process'

const LOG = '[llama:bin]'
const log = (...args) => console.log(LOG, ...args)
const warn = (...args) => console.warn(LOG, ...args)
const fail = (...args) => {
  console.error(LOG, ...args)
  process.exit(1)
}

// --- args -------------------------------------------------------------------
function parseTag() {
  const idx = process.argv.indexOf('--tag')
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1]
  return DEFAULT_TAG
}

// Pin consciente: b9660 carrega arquitetura `gemma4`. Atualizar de proposito.
const DEFAULT_TAG = 'b9660'
const TAG = parseTag()
const ROOT = process.cwd()
const PLATFORM = process.platform
const ARCH = process.arch

function binaryName() {
  return PLATFORM === 'win32' ? 'llama-server.exe' : 'llama-server'
}

// Asset do release por plataforma/arch.
function assetName() {
  if (PLATFORM === 'darwin' && ARCH === 'arm64') return `llama-${TAG}-bin-macos-arm64.tar.gz`
  if (PLATFORM === 'darwin' && ARCH === 'x64') return `llama-${TAG}-bin-macos-x64.tar.gz`
  if (PLATFORM === 'win32' && ARCH === 'x64') return `llama-${TAG}-bin-win-cpu-x64.zip`
  if (PLATFORM === 'win32' && ARCH === 'arm64') return `llama-${TAG}-bin-win-cpu-arm64.zip`
  return null
}

const BIN = binaryName()
const DEST_DIR = path.join(ROOT, 'llama.cpp', `${PLATFORM}-${ARCH}`)
const DEST_BIN = path.join(DEST_DIR, BIN)

// --- helpers ----------------------------------------------------------------
function download(url, destination, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 10) {
      reject(new Error('Excesso de redirects'))
      return
    }
    const request = https.get(url, { headers: { 'User-Agent': 'escalaflow-fetch-llama' } }, (response) => {
      const status = response.statusCode ?? 0
      if (status >= 300 && status < 400 && response.headers.location) {
        response.resume()
        download(new URL(response.headers.location, url).toString(), destination, redirects + 1).then(resolve, reject)
        return
      }
      if (status !== 200) {
        response.resume()
        reject(new Error(`Download falhou: HTTP ${status} (${url})`))
        return
      }
      const file = fs.createWriteStream(destination)
      response.pipe(file)
      file.on('finish', () => file.close((err) => (err ? reject(err) : resolve())))
      file.on('error', reject)
    })
    request.on('error', reject)
  })
}

function extractArchive(archivePath, outDir) {
  const isZip = archivePath.endsWith('.zip')
  if (isZip) {
    // Mac/Linux: unzip; Windows: tar moderno faz .zip, mas usamos unzip onde houver.
    const result = spawnSync('unzip', ['-q', '-o', archivePath, '-d', outDir], { stdio: 'inherit' })
    if (result.status === 0) return
    // fallback para `tar` (Windows 10+ / bsdtar entende zip)
    const tarZip = spawnSync('tar', ['-xf', archivePath, '-C', outDir], { stdio: 'inherit' })
    if (tarZip.status !== 0) throw new Error(`Falha ao extrair zip (unzip + tar): ${archivePath}`)
    return
  }
  const result = spawnSync('tar', ['-xzf', archivePath, '-C', outDir], { stdio: 'inherit' })
  if (result.status !== 0) throw new Error(`tar saiu com status ${result.status}: ${archivePath}`)
}

// Localiza recursivamente o diretorio que contem o binario procurado.
function findBinaryDir(rootDir) {
  const stack = [rootDir]
  while (stack.length > 0) {
    const dir = stack.pop()
    let entries
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        stack.push(full)
      } else if (entry.isFile() && entry.name === BIN) {
        return dir
      }
    }
  }
  return null
}

// Copia TODO o conteudo de srcDir para DEST_DIR, preservando symlinks.
function copyDirContents(srcDir) {
  fs.mkdirSync(DEST_DIR, { recursive: true })
  for (const entry of fs.readdirSync(srcDir)) {
    const from = path.join(srcDir, entry)
    const to = path.join(DEST_DIR, entry)
    fs.cpSync(from, to, { recursive: true, force: true, verbatimSymlinks: true })
  }
}

function postCopyMac() {
  if (PLATFORM !== 'darwin') return
  // best-effort: remove quarantine e garante +x no binario.
  spawnSync('xattr', ['-dr', 'com.apple.quarantine', DEST_DIR], { stdio: 'ignore' })
  try {
    fs.chmodSync(DEST_BIN, 0o755)
  } catch {
    // ignore
  }
}

function localFallbackDir() {
  const home = process.env.HOME || os.homedir()
  if (!home) return null
  const dir = path.join(home, '.local', 'share', 'llama-cpp-bin', `llama-${TAG}`)
  if (fs.existsSync(path.join(dir, BIN))) return dir
  return null
}

// --- main -------------------------------------------------------------------
async function main() {
  // Idempotente: ja existe o binario no destino?
  if (fs.existsSync(DEST_BIN)) {
    log(`ja existe: ${DEST_BIN} (nada a fazer)`)
    return
  }

  const asset = assetName()
  if (!asset) {
    fail(`Plataforma/arch sem asset conhecido: ${PLATFORM}-${ARCH}. Suportado: darwin-arm64, darwin-x64, win32-x64, win32-arm64.`)
  }

  const url = `https://github.com/ggml-org/llama.cpp/releases/download/${TAG}/${asset}`
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'escalaflow-llama-bin-'))
  const archivePath = path.join(tmpDir, asset)

  try {
    let sourceDir = null

    try {
      log(`baixando ${url}`)
      await download(url, archivePath)
      const extractDir = path.join(tmpDir, 'extract')
      fs.mkdirSync(extractDir, { recursive: true })
      log(`extraindo para tmp`)
      extractArchive(archivePath, extractDir)
      sourceDir = findBinaryDir(extractDir)
      if (!sourceDir) throw new Error(`Binario ${BIN} nao encontrado no arquivo extraido`)
      log(`binario localizado em: ${sourceDir}`)
    } catch (err) {
      warn(`download/extracao falhou: ${err instanceof Error ? err.message : String(err)}`)
      const fallback = localFallbackDir()
      if (!fallback) throw err
      warn(`usando fallback offline: ${fallback}`)
      sourceDir = fallback
    }

    copyDirContents(sourceDir)
    postCopyMac()

    if (!fs.existsSync(DEST_BIN)) {
      throw new Error(`Copia terminou sem ${DEST_BIN}`)
    }
    const dylibCount = fs.readdirSync(DEST_DIR).filter((f) => f.endsWith('.dylib') || f.endsWith('.dll') || f.endsWith('.so')).length
    log(`pronto: ${DEST_BIN}`)
    log(`libs co-localizadas: ${dylibCount}`)
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)))
