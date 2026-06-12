import { describe, expect, it } from 'vitest'
import { buildEscalaPreflight } from '../../src/main/motor/preflight-service'

describe('preflight service', () => {
  it('exports the shared UI/CLI preflight function', () => {
    expect(typeof buildEscalaPreflight).toBe('function')
  })
})
