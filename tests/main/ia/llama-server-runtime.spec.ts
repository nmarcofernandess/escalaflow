import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

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
