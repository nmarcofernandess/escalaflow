import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

describe('local LLM download artifact validation', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'escalaflow-model-artifact-'))
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  it('rejects files that are too small or not GGUF before marking model downloaded', async () => {
    const filePath = path.join(tmpDir, 'model.gguf.part')
    await writeFile(filePath, '<html>not a model</html>')

    const { validateDownloadedModelArtifact } = await import('../../../src/main/ia/local-llm')

    expect(() => validateDownloadedModelArtifact('gemma-4-e2b-it-q4', filePath)).toThrow('Download incompleto')
  })
})
