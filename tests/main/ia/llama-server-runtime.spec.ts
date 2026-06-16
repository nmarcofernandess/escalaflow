import fs from 'node:fs'
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('llama-server runtime discovery', () => {
  let tmpDir: string
  const originalBin = process.env.ESCALAFLOW_LLAMA_SERVER_BIN

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'escalaflow-llama-bin-'))
  })

  afterEach(async () => {
    if (originalBin === undefined) delete process.env.ESCALAFLOW_LLAMA_SERVER_BIN
    else process.env.ESCALAFLOW_LLAMA_SERVER_BIN = originalBin
    await rm(tmpDir, { recursive: true, force: true })
  })

  it('ignores a configured non-executable llama-server candidate', async () => {
    if (process.platform === 'win32') return
    const fakeBin = path.join(tmpDir, 'llama-server')
    await writeFile(fakeBin, '#!/bin/sh\necho nope\n')
    await chmod(fakeBin, 0o600)
    process.env.ESCALAFLOW_LLAMA_SERVER_BIN = fakeBin

    const { findLlamaServerBinary } = await import('../../../src/main/ia/llama-server-runtime')

    expect(findLlamaServerBinary()).not.toBe(fakeBin)
  })
})

// Lock de contrato/regressao: o binario empacotado via electron-builder vive em
// `resourcesPath/llama.cpp/<plat>-<arch>/<bin>`. O resolver JA tem esse
// candidato (llama-server-runtime.ts -> findLlamaServerBinary). Este teste
// garante que ninguem o remova no futuro — se quebrar, o app empacotado para
// de achar o llama-server. NAO e TDD-red: passa sem mudar o codigo.
describe('llama-server resolver — bundled candidate (contract lock)', () => {
  const originalEnvBin = process.env.ESCALAFLOW_LLAMA_SERVER_BIN
  const originalUserDataDir = process.env.ESCALAFLOW_USER_DATA_DIR
  const originalResourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath

  afterEach(() => {
    vi.restoreAllMocks()
    if (originalEnvBin === undefined) delete process.env.ESCALAFLOW_LLAMA_SERVER_BIN
    else process.env.ESCALAFLOW_LLAMA_SERVER_BIN = originalEnvBin
    if (originalUserDataDir === undefined) delete process.env.ESCALAFLOW_USER_DATA_DIR
    else process.env.ESCALAFLOW_USER_DATA_DIR = originalUserDataDir
    ;(process as NodeJS.Process & { resourcesPath?: string }).resourcesPath = originalResourcesPath
  })

  it('resolves to resourcesPath/llama.cpp/<plat>-<arch>/<bin> when only that path exists', async () => {
    if (process.platform === 'win32') return

    const resourcesPath = '/fake/resources'
    const bin = process.platform === 'win32' ? 'llama-server.exe' : 'llama-server'
    const expected = path.join(resourcesPath, 'llama.cpp', `${process.platform}-${process.arch}`, bin)

    // Garante que NENHUM outro candidato (env var, userData, cwd/runtimes,
    // cwd/tmp, resourcesPath/llama.cpp/<bin>) vença: so o bundled existe.
    delete process.env.ESCALAFLOW_LLAMA_SERVER_BIN
    delete process.env.ESCALAFLOW_USER_DATA_DIR
    ;(process as NodeJS.Process & { resourcesPath?: string }).resourcesPath = resourcesPath

    // spyOn pontual (nao vi.mock) para coexistir com o teste de FS real acima.
    // O resolver usa fs.accessSync(candidate, X_OK) no caminho nao-win32.
    vi.spyOn(fs, 'accessSync').mockImplementation(((p: fs.PathLike) => {
      if (String(p) === expected) return undefined
      const err = new Error(`ENOENT: no such file, access '${String(p)}'`) as NodeJS.ErrnoException
      err.code = 'ENOENT'
      throw err
    }) as typeof fs.accessSync)

    const { findLlamaServerBinary } = await import('../../../src/main/ia/llama-server-runtime')

    expect(findLlamaServerBinary()).toBe(expected)
  })
})
