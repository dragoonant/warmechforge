import { describe, expect, it } from 'vitest'
import { critCountDistribution, expectedShotDamage, pAtLeast2d6, pBlowOff, pLocation } from '../../src/engine/prob'
import { p2d6AtLeast } from '../../src/engine/index'

describe('closed-form probabilities', () => {
  it('TOHIT-001 P(2d6 >= TN) matches the engine query and the 36-way table', () => {
    for (let t = 0; t <= 14; t++) expect(pAtLeast2d6(t)).toBeCloseTo(p2d6AtLeast(t))
    expect(pAtLeast2d6(7)).toBeCloseTo(21 / 36)
    expect(pAtLeast2d6(13)).toBe(0)
  })

  it('CRIT-001 crit count distribution: 8-9 one, 10-11 two, 12 three; CASE II shifts it', () => {
    const d = critCountDistribution()
    expect(d.none).toBeCloseTo(21 / 36)
    expect(d.one).toBeCloseTo(9 / 36)
    expect(d.two).toBeCloseTo(5 / 36)
    expect(d.three).toBeCloseTo(1 / 36)
    expect(pBlowOff(-1)).toBe(0)
  })

  it('HITLOC-003 / CLUS-001 expected damage composes hit chance, rack size and damage', () => {
    expect(pLocation('front', 'standard', 'CT')).toBeCloseTo(7 / 36)
    expect(expectedShotDamage(7, { damage: 5 })).toBeCloseTo((21 / 36) * 5)
    expect(expectedShotDamage(2, { damage: 2, cluster: { rackSize: 2 } })).toBeGreaterThan(2)
  })
})
