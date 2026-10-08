import { describe, expect, it } from 'vitest'
import { adjustedBv, loadBundle } from '../../src/data/index'

const b = loadBundle()
const total = (id: string): number => b.forces[id]!.units.reduce((s, u) => s + adjustedBv(b.tables, b.mechs[u.mech]!.bv, u.skills?.gunnery ?? b.pilots[u.pilot ?? '']?.gunnery ?? 4, u.skills?.piloting ?? b.pilots[u.pilot ?? '']?.piloting ?? 5), 0)

describe('lance preset balance (M7)', () => {
  it('FORCES-001 each lance pair is within 5 percent adjusted BV', () => {
    for (const [x, y] of [['force.intro-a', 'force.intro-b'], ['force.regent-lance', 'force.mad-cat-lance']] as const) {
      const a = total(x), c = total(y)
      expect(Math.abs(a - c) / Math.min(a, c)).toBeLessThanOrEqual(0.05)
    }
  })
})
