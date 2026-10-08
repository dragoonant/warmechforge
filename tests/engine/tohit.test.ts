import { describe, expect, it } from 'vitest'
import { aimedShotLegal, computeRangedTn, heatToHit, minRangeMod, rangeBand, rangedToHit, tmmForHexes } from '../../src/engine/tohit'
import type { RangedTnInput } from '../../src/engine/tohit'
import { mkState, mkUnit } from './damage.fixture'

const base: RangedTnInput = { gunnery: 4, distance: 3, band: 'short', attackerMode: 'standStill', target: null }
const tgt = (o: Partial<NonNullable<RangedTnInput['target']>> = {}) => ({ tmm: 0, jumped: false, prone: false, adjacent: false, immobile: false, woods: 'none' as const, ...o })
const tn = (o: Partial<RangedTnInput>): number => computeRangedTn({ ...base, ...o }).tn

describe('to-hit (10 §6-§7)', () => {
  it('TOHIT-001 gunnery 4 with no modifiers is TN 4 and the gunnery line comes first', () => {
    const r = computeRangedTn({ ...base, target: tgt() })
    expect(r.tn).toBe(4)
    expect(r.mods[0]).toMatchObject({ code: 'gunnery', value: 4 })
    expect(r.mods.reduce((a, m) => a + m.value, 0)).toBe(r.tn)
    expect(r.pHit).toBeCloseTo(33 / 36)
  })

  it('TOHIT-002 TN 13 is not legal; TN 2 or less is an automatic hit', () => {
    expect(computeRangedTn({ ...base, gunnery: 13 }).legal).toBe(false)
    expect(computeRangedTn({ ...base, gunnery: 12 }).legal).toBe(true)
    const auto = computeRangedTn({ ...base, gunnery: 2 })
    expect(auto.autoHit).toBe(true)
    expect(auto.pHit).toBe(1)
  })

  it('TOHIT-010 / TOHIT-011 range brackets and minimum range', () => {
    const r = { short: 3, medium: 6, long: 9 }
    expect([3, 4, 7, 10].map((d) => rangeBand(d, r))).toEqual(['short', 'medium', 'long', 'out'])
    expect([3, 4, 7].map((d) => tn({ distance: d, band: rangeBand(d, r) }) - 4)).toEqual([0, 2, 4])
    expect([3, 2, 1, 4].map((d) => minRangeMod(d, 3))).toEqual([1, 2, 3, 0])
    expect(minRangeMod(4, 6)).toBe(3)
  })

  it('TOHIT-012 / TOHIT-013 attacker movement and prone', () => {
    expect((['standStill', 'walk', 'run', 'jump'] as const).map((m) => tn({ attackerMode: m }) - 4)).toEqual([0, 1, 2, 3])
    expect(tn({ attackerMode: 'walk', attackerProne: true })).toBe(4 + 1 + 2)
  })

  it('TOHIT-014 / TOHIT-015 target movement brackets and the jump point', () => {
    expect([0, 2, 3, 4, 5, 7, 10, 17, 18, 25].map(tmmForHexes)).toEqual([0, 0, 1, 1, 2, 3, 4, 4, 5, 6])
    expect(tn({ target: tgt({ tmm: 0, jumped: true }) })).toBe(5)
    expect(tn({ target: tgt({ tmm: 2, jumped: true }) })).toBe(7)
  })

  it('TOHIT-016 prone target: adjacent -2, farther +1, stacked with TMM', () => {
    expect(tn({ target: tgt({ prone: true, adjacent: true, tmm: 1 }) })).toBe(4 + 1 - 2)
    expect(tn({ target: tgt({ prone: true, tmm: 1 }) })).toBe(4 + 1 + 1)
  })

  it('TOHIT-017 immobile target: -4 and no TMM or jump point', () => {
    expect(tn({ target: tgt({ immobile: true, tmm: 4, jumped: true }) })).toBe(0)
  })

  it('TOHIT-020 / TOHIT-021 / TOHIT-022 woods and partial cover', () => {
    expect(tn({ target: tgt({ woods: 'light' }) })).toBe(5)
    expect(tn({ target: tgt({ woods: 'heavy' }) })).toBe(6)
    expect(tn({ interveningWoods: 1 })).toBe(5)
    expect(tn({ partialCover: true })).toBe(5)
  })

  it('TOHIT-023 attacker heat brackets', () => {
    expect([0, 7, 8, 12, 13, 16, 17, 23, 24, 30].map(heatToHit)).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 4, 4])
  })

  it('TOHIT-024 a secondary target adds exactly +1', () => {
    expect(tn({ secondary: true })).toBe(5)
  })

  it('TOHIT-025..028 sensor and arm actuator damage', () => {
    expect(tn({ sensorCrits: 1 })).toBe(6)
    expect(computeRangedTn({ ...base, sensorCrits: 2 }).legal).toBe(false)
    expect(tn({ armCrits: { shoulder: true, upperArm: true } })).toBe(8) // shoulder +4 replaces the upper-arm +1
    expect(tn({ armCrits: { shoulder: false, upperArm: true } })).toBe(5)
    expect(tn({ armCrits: { shoulder: false, upperArm: false } })).toBe(4) // lower arm / hand: 0 (2026)
  })

  it('TOHIT-029 / TOHIT-031 weapon modifier and targeting computer', () => {
    expect(tn({ weaponMod: -2 })).toBe(2)
    expect(tn({ targetingComputer: true })).toBe(3)
  })

  it('TOHIT-032 water adds nothing but partial cover', () => {
    expect(tn({ target: tgt({ woods: 'none' }), partialCover: true })).toBe(5)
  })

  it('TOHIT-034 aimed shots: immobile non-head -4 (TC -1 more), head +3, TC vs mobile +3', () => {
    const imm = tgt({ immobile: true })
    expect(tn({ target: imm, aimed: { at: 'CT', targetImmobile: true, tc: false } })).toBe(0)
    expect(tn({ target: imm, aimed: { at: 'CT', targetImmobile: true, tc: true } })).toBe(-1)
    expect(tn({ target: imm, aimed: { at: 'HD', targetImmobile: true, tc: true } })).toBe(7)
    expect(tn({ target: tgt(), aimed: { at: 'CT', targetImmobile: false, tc: true } })).toBe(7)
    expect(aimedShotLegal({ at: 'HD', targetImmobile: false, tc: true, weaponAllowsAim: true })).toBe(false)
    expect(aimedShotLegal({ at: 'CT', targetImmobile: false, tc: false, weaponAllowsAim: true })).toBe(false)
    expect(aimedShotLegal({ at: 'CT', targetImmobile: true, tc: false, weaponAllowsAim: false })).toBe(false)
  })

  it('TOHIT-018 / TOHIT-019 rangedToHit reads TMM from the movement record and immobility from the phase snapshot', () => {
    const a = mkUnit('A1', 'A', { mounts: [{ id: 'm1', item: 'w.mlaser', location: 'RA' }] })
    const t = mkUnit('B1', 'B')
    t.move.tmm = 2; t.move.hexesMoved = 5
    const s = mkState([a, t])
    const run = rangedToHit(s, { attackerId: 'A1', mountId: 'm1', targetId: 'B1', distance: 4, band: 'medium' })
    expect(run.tn).toBe(4 + 1 + 2 + 2) // gunnery, attacker walked, medium range, TMM 2
    const snap = { ...s, ledger: { ...s.ledger, immobileAtStart: ['B1'] } }
    expect(rangedToHit(snap, { attackerId: 'A1', mountId: 'm1', targetId: 'B1', distance: 4, band: 'medium' }).tn).toBe(4 + 1 + 2 - 4)
  })
})

describe('TOHIT-036 partial cover aimed legality', () => {
  it('TOHIT-036 a leg cannot be named under partial cover', () => {
    expect(aimedShotLegal({ at: 'LL', targetImmobile: true, tc: false, weaponAllowsAim: true, partialCover: true })).toBe(false)
    expect(aimedShotLegal({ at: 'RL', targetImmobile: true, tc: false, weaponAllowsAim: true, partialCover: true })).toBe(false)
    expect(aimedShotLegal({ at: 'LL', targetImmobile: true, tc: false, weaponAllowsAim: true })).toBe(true)
    expect(aimedShotLegal({ at: 'CT', targetImmobile: true, tc: false, weaponAllowsAim: true, partialCover: true })).toBe(true)
  })
})
