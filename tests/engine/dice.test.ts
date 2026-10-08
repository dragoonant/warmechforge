import { describe, expect, it } from 'vitest'
import { beginWork, endWork, roll2d6, unitOf } from '../../src/engine/dice'
import { BUNDLE, mkState } from './damage.fixture'

describe('dice helpers over rng.roll', () => {
  it('TOHIT-001 rolls go through roll(): rng and rollSeq advance in the work state and the input is untouched', () => {
    const s = mkState()
    const w = beginWork(s, BUNDLE)
    const a = roll2d6(w, { purpose: 'toHit', target: 8 })
    const b = roll2d6(w, { purpose: 'toHit', target: 8 })
    const out = endWork(w)
    expect(out.state.rollSeq).toBe(2)
    expect(s.rollSeq).toBe(0)
    expect(out.events.map((e) => (e as { rollId: string }).rollId)).toEqual(['r:1', 'r:2'])
    expect(a.dice).toHaveLength(2)
    expect(a.success).toBe(a.total >= 8)
    expect(b.total).toBeGreaterThanOrEqual(2)
  })

  it('DMG-001 unit working copies are clones; commit leaves the input state intact', () => {
    const s = mkState()
    const w = beginWork(s, BUNDLE)
    unitOf(w, 'B1').locs.CT.armor = 1
    expect(s.units.B1!.locs.CT.armor).toBe(20)
    expect(endWork(w).state.units.B1!.locs.CT.armor).toBe(1)
  })
})
