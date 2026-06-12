import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

describe('EscalaFlow MCP contract', () => {
  it('keeps MCP as a proxy to the local tool server', () => {
    const source = readFileSync(path.resolve(root, 'mcp-server/index.ts'), 'utf-8')
    expect(source).toContain("const TOOL_URL = process.env.ESCALAFLOW_URL || 'http://127.0.0.1:17380'")
    expect(source).toContain('fetch(`${TOOL_URL}/tools`)')
    expect(source).toContain('fetch(`${TOOL_URL}/tool`')
  })
})
