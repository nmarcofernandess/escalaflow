import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { resolveEmbeddingModelPath, resolveEmbeddingModelPathForRuntime } from '../../../src/main/knowledge/embeddings'

describe('knowledge embeddings model path', () => {
  it('uses the project-level models directory in dev/runtime scripts', () => {
    expect(resolveEmbeddingModelPathForRuntime()).toBe(path.join(process.cwd(), 'models', 'embeddings'))
  })

  it('keeps electron-vite out/main runtime pointed at the project model directory', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'escalaflow-embeddings-'))
    try {
      const projectModelDir = path.join(root, 'models', 'embeddings')
      fs.mkdirSync(projectModelDir, { recursive: true })
      const runtimeDir = path.join(root, 'out', 'main')

      expect(resolveEmbeddingModelPath({ cwd: root, runtimeDir })).toBe(projectModelDir)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
})
