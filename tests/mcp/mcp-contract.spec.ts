import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TOOL_SERVER_URL,
  parseMcpToolCatalogResponse,
  resolveMcpToolServerUrl,
} from '../../mcp-server/tool-server-client'

describe('EscalaFlow MCP contract', () => {
  it('resolves the local tool server URL with the new env taking precedence over the legacy one', () => {
    expect(resolveMcpToolServerUrl({})).toBe(DEFAULT_TOOL_SERVER_URL)
    expect(resolveMcpToolServerUrl({
      ESCALAFLOW_URL: 'http://127.0.0.1:1111',
    })).toBe('http://127.0.0.1:1111')
    expect(resolveMcpToolServerUrl({
      ESCALAFLOW_URL: 'http://127.0.0.1:1111',
      ESCALAFLOW_TOOL_SERVER: 'http://127.0.0.1:2222',
    })).toBe('http://127.0.0.1:2222')
  })

  it('accepts only a successful array catalog for /tools', () => {
    const catalog = [{ name: 'consultar', description: 'Consulta', parameters: {} }]

    expect(parseMcpToolCatalogResponse(catalog, 200)).toBe(catalog)
    expect(() => parseMcpToolCatalogResponse({ status: 'error', message: 'token invalido' }, 401))
      .toThrow('Falha ao carregar tools (HTTP 401): token invalido')
    expect(() => parseMcpToolCatalogResponse({ tools: catalog }, 200))
      .toThrow('Catalogo de tools invalido recebido do EscalaFlow.')
  })
})
