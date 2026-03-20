import { describe, it, expect } from 'vitest'
import type { PinWithOrigin } from '../../src/shared/types'
import { PIN_WEIGHTS, pinWeight } from '../../src/shared/types'

describe('PinWithOrigin', () => {
  it('PIN_WEIGHTS has correct hierarchy', () => {
    expect(PIN_WEIGHTS.auto).toBeLessThan(PIN_WEIGHTS.accepted)
    expect(PIN_WEIGHTS.accepted).toBeLessThan(PIN_WEIGHTS.manual)
    expect(PIN_WEIGHTS.manual).toBeLessThan(PIN_WEIGHTS.saved)
  })

  it('pinWeight returns correct weight for origin', () => {
    expect(pinWeight('auto')).toBe(PIN_WEIGHTS.auto)
    expect(pinWeight('saved')).toBe(PIN_WEIGHTS.saved)
  })

  it('PinWithOrigin has all required fields', () => {
    const pin: PinWithOrigin = {
      c: 0,
      d: 1,
      band: 3,
      origin: 'manual',
      weight: PIN_WEIGHTS.manual,
    }
    expect(pin.origin).toBe('manual')
    expect(pin.weight).toBe(PIN_WEIGHTS.manual)
  })
})
