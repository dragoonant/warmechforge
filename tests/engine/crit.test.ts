import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const q = vi.hoisted(() => ({ faces: [] as number[] }))
vi.mock('../../src/engine/rng', async (orig) => {
  const m = await orig<typeof import('../../src/engine/rng')>()
  return {
    ...m,
    roll: (state: { rollSeq: number }, spec: { count: number }) => {
      const n = Math.max(1, spec.count)
      const dice = q.faces.splice(0, n)
      if (dice.length < n) throw new Error('forced dice exhausted')
      return { state: { ...state, rollSeq: state.rollSeq + 1 }, event: m.diceEvent(state as never, spec as never, dice) }
    },
  }
})
beforeEach(() => { q.faces.length = 0 })
afterEach(() => { expect(q.faces).toEqual([]) })

import { critCheck } from '../../src/engine/crits'
import type { GameEvent } from '../../src/engine/events'
import type { Loc } from '../../src/engine/types'
import { BUNDLE, mkState, mkUnit } from './damage.fixture'
import type { UnitOpts } from './damage.fixture'

const of = <T extends GameEvent['type']>(evs: GameEvent[], t: T): Extract<GameEvent, { type: T }>[] =>
  evs.filter((e) => e.type === t) as Extract<GameEvent, { type: T }>[]
const check = (opts: UnitOpts, location: Loc, mut?: (u: ReturnType<typeof mkUnit>) => void) => {
  const u = mkUnit('B1', 'B', opts)
  mut?.(u)
  return critCheck(mkState([u]), { unitId: 'B1', location, why: 'structure' }, BUNDLE)
}
const LT_MOUNTS: UnitOpts = {
  mounts: [{ id: 'm1', item: 'w.mlaser', location: 'LT' }, { id: 'm2', item: 'w.mlaser', location: 'LT' }],
  slots: { LT: ['empty', '#m1', 'empty', 'empty', 'empty', 'empty', 'empty', '#m2'] },
}

describe('critical hits (10 §11)', () => {
  it('CRIT-001 crit counts: 7 none, 8-9 one, 10-11 two; a 12 on a limb blows it off', () => {
    const counts: number[] = []
    for (const [a, b] of [[3, 4], [4, 4], [4, 5], [5, 5], [5, 6]] as const) {
      q.faces.push(a, b)
      if (a + b >= 8) q.faces.push(1, 2, ...(a + b >= 10 ? [2] : [])) // slot 2 of the upper block (m1), then the lower block alone (m2)
      const r = check(LT_MOUNTS, 'LT')
      counts.push(of(r.events, 'CritCheckRolled')[0]!.crits)
    }
    expect(counts).toEqual([0, 1, 1, 2, 2])
    q.faces.push(6, 6)
    const off = check({}, 'LA')
    expect(of(off.events, 'CritCheckRolled')[0]).toMatchObject({ crits: 0, blownOff: true })
    expect(off.state.units.B1!.locs.LA.destroyed).toBe(true)
    expect(of(off.events, 'LocationDestroyed')[0]).toMatchObject({ cause: 'blownOff' })
    expect(off.state.ledger.damage.B1 ?? 0).toBe(0) // DMG-013: nothing added to the tally
  })

  it('CRIT-001 a 12 on a torso is three crits; three engine slots destroy the unit (CRIT-031)', () => {
    q.faces.push(6, 6, 1, 1, 1, 2, 1, 3)
    const r = check({}, 'CT')
    expect(of(r.events, 'CritSlotHit').map((e) => e.effect)).toEqual(['engine', 'engine', 'engine'])
    expect(r.state.units.B1!.destroyedCause).toBe('engine')
  })

  it('CRIT-001 CASE II location: -1 to the crit roll, so a 12 reads as an 11', () => {
    q.faces.push(6, 6, 1, 2, 2) // 12 - 1 = 11 -> two crits
    const r = check({ ...LT_MOUNTS, mounts: [...LT_MOUNTS.mounts!, { id: 'c2', item: 'e.caseii', location: 'LT' }] }, 'LT')
    expect(of(r.events, 'CritCheckRolled')[0]!.crits).toBe(2)
  })

  it('CRIT-002 block die then slot die on a 12-slot location; a closed block means only the slot die', () => {
    q.faces.push(4, 4, 2, 4) // 8: one crit; block 2 (upper) slot 4 -> index 3
    const a = check({ mounts: [{ id: 'm1', item: 'w.mlaser', location: 'LT' }, { id: 'm2', item: 'w.mlaser', location: 'LT' }], slots: { LT: ['empty', 'empty', 'empty', '#m1', 'empty', 'empty', 'empty', 'empty', '#m2'] } }, 'LT')
    expect(of(a.events, 'CritSlotHit')[0]).toMatchObject({ index: 3 })
    q.faces.push(4, 4, 5, 2) // block 5 (lower) slot 2 -> index 7
    const b = check(LT_MOUNTS, 'LT')
    expect(of(b.events, 'CritSlotHit')[0]).toMatchObject({ index: 7 })
    q.faces.push(4, 4, 2) // lower block closed: a single die in the upper block -> index 1
    const c = check({ mounts: [{ id: 'm1', item: 'w.mlaser', location: 'LT' }], slots: { LT: ['empty', '#m1'] } }, 'LT')
    expect(of(c.events, 'CritSlotHit')[0]).toMatchObject({ index: 1 })
    q.faces.push(4, 4, 3) // leg: one die, slot 3 = lowerLeg
    const d = check({}, 'LL')
    expect(of(d.events, 'CritSlotHit')[0]).toMatchObject({ index: 2, token: 'lowerLeg' })
  })

  it('CRIT-003 empty and already-hit slots re-roll, each re-roll its own critSlot roll', () => {
    q.faces.push(4, 4, 1, 1, 1, 2) // index 0 is empty -> re-roll -> index 1 (mount)
    const r = check(LT_MOUNTS, 'LT')
    expect(of(r.events, 'DiceRolled').filter((e) => e.purpose === 'critSlot')).toHaveLength(2)
    expect(of(r.events, 'CritSlotHit')[0]).toMatchObject({ index: 1, effect: 'componentDestroyed' })
    expect(r.state.units.B1!.mounts.m1!.destroyed).toBe(true)
  })

  it('CRIT-004 a blown-off head destroys the unit and kills the pilot', () => {
    q.faces.push(6, 6)
    const r = check({}, 'HD')
    expect(r.state.units.B1!.pilot.dead).toBe(true)
    expect(r.state.units.B1!.destroyedCause).toBe('headDestroyed')
  })

  it('CRIT-005 in a destroyed location only crits on explosive slots resolve; the rest are discarded', () => {
    q.faces.push(5, 5, 1, 5, 3, 3) // 10: two crits. slot idx0 (weapon): discarded; idx4 (bin): explodes. Explosion into the gone LT transfers to CT: crit check 6
    const r = check(
      { mounts: [{ id: 'm1', item: 'w.mlaser', location: 'LT' }], bins: [{ id: 'b1', ammo: 'a.ac5', location: 'LT', shots: 2 }], slots: { LT: ['#m1', 'empty', 'empty', 'empty', '#b1'] } },
      'LT', (u) => { u.locs.LT.destroyed = true; u.locs.LT.structure = 0; u.locs.LT.armor = 0 },
    )
    expect(of(r.events, 'CritLost')[0]).toMatchObject({ count: 1, why: 'notExplosive' })
    expect(of(r.events, 'AmmoExploded')).toHaveLength(1)
  })

  it('CRIT-010 crits move inward when nothing was crit-able before this phase; a spent location loses the rest', () => {
    q.faces.push(4, 4, 1, 1) // crit move to CT: appliesTo CT; slot dice: block 1 slot 1 -> engine
    const r = check({}, 'RT', (u) => { u.slots.RT.forEach((s) => { s.token = 'empty' }) })
    expect(of(r.events, 'CritCheckRolled')[0]).toMatchObject({ location: 'RT', appliesTo: 'CT' })
    expect(of(r.events, 'CritSlotHit')[0]).toMatchObject({ location: 'CT' })
    // three crits, one open slot (hit earlier in this phase would be lost): the other two are lost, no dice
    q.faces.push(6, 6, 4) // lower block closed (RT has one open slot in the upper block, index 3)
    const t = check({ mounts: [{ id: 'm1', item: 'w.mlaser', location: 'RT' }], slots: { RT: ['empty', 'empty', 'empty', '#m1'] } }, 'RT')
    expect(of(t.events, 'CritLost')[0]).toMatchObject({ location: 'RT', count: 2, why: 'noSlotThisPhase' })
    // HD / CT never transfer
    q.faces.push(5, 5)
    const ct = check({}, 'CT', (u) => { u.slots.CT.forEach((s) => { s.token = 'empty' }) })
    expect(of(ct.events, 'CritLost')[0]).toMatchObject({ location: 'CT', count: 2 })
  })

  it('CRIT-011 a multi-slot item is knocked out once; further crits on its other slots soak', () => {
    q.faces.push(5, 5, 1, 2)
    const r = check({ mounts: [{ id: 'p', item: 'w.ppc', location: 'LT' }], slots: { LT: ['#p', '#p', '#p'] } }, 'LT')
    expect(of(r.events, 'CritSlotHit').map((e) => e.effect)).toEqual(['componentDestroyed', 'none'])
    expect(of(r.events, 'ComponentDestroyed')).toHaveLength(1)
  })

  it('EQUIP-010 an autocannon survives its first crit and dies on the second', () => {
    q.faces.push(5, 5, 1, 2)
    const r = check({ mounts: [{ id: 'a', item: 'w.ac5', location: 'LT' }], slots: { LT: ['#a', '#a', '#a', '#a'] } }, 'LT')
    expect(of(r.events, 'CritSlotHit').map((e) => e.effect)).toEqual(['componentDamaged', 'componentDestroyed'])
    expect(r.state.units.B1!.mounts.a!.destroyed).toBe(true)
  })

  it('CRIT-020 a crit on an ammo bin with shots explodes it and costs a pilot hit; an empty bin does nothing', () => {
    q.faces.push(4, 4, 1, 3, 3) // crit; slot idx0 = bin; explosion hits LT structure: crit check 6
    const bins = [{ id: 'b1', ammo: 'a.ac5', location: 'LT' as const, shots: 2 }]
    const r = check({ bins, slots: { LT: ['#b1'] } }, 'LT')
    expect(of(r.events, 'AmmoExploded')[0]).toMatchObject({ damage: 10, cause: 'crit' })
    expect(of(r.events, 'PilotHit')[0]).toMatchObject({ cause: 'explosion' })
    expect(r.state.units.B1!.pilot.hits).toBe(1)
    q.faces.push(4, 4, 1)
    const e = check({ bins: [{ id: 'b1', ammo: 'a.ac5', location: 'LT', shots: 0 }], slots: { LT: ['#b1'] } }, 'LT')
    expect(of(e.events, 'CritSlotHit')[0]).toMatchObject({ effect: 'emptyBin' })
    expect(of(e.events, 'AmmoExploded')).toHaveLength(0)
  })

  it('CRIT-030 / CRIT-040 a cockpit crit kills the pilot; a first gyro crit queues a PSR, the second an automatic fall', () => {
    q.faces.push(4, 4, 3)
    const c = check({}, 'HD')
    expect(c.state.units.B1!.destroyedCause).toBe('cockpit')
    q.faces.push(4, 4, 1, 4) // CT index 3 = gyro
    const g1 = check({}, 'CT')
    expect(of(g1.events, 'PsrQueued')[0]).toMatchObject({ reason: 'gyroCrit', auto: false })
    q.faces.push(4, 4, 1, 5)
    const g2 = check({}, 'CT', (u) => { u.slots.CT[3]!.hit = true; u.slots.CT[3]!.hitPhase = 5 })
    expect(of(g2.events, 'PsrQueued')[0]).toMatchObject({ reason: 'gyroDestroyed', auto: true })
  })

  it('CRIT-095 hip and upper leg crits on the same leg cost one PSR in one damage instance', () => {
    q.faces.push(5, 5, 1, 2)
    const r = check({}, 'LL')
    expect(of(r.events, 'CritSlotHit').map((e) => e.token)).toEqual(['hip', 'upperLeg'])
    expect(of(r.events, 'PsrQueued')).toHaveLength(1)
    expect(of(r.events, 'PsrQueued')[0]).toMatchObject({ reason: 'hipCrit' })
  })

  it('CRIT-012 crit effects persist on the slots and stack', () => {
    q.faces.push(4, 4, 2)
    const a = check({}, 'HD') // sensors
    const u = a.state.units.B1!
    expect(u.slots.HD[1]!.hit).toBe(true)
    q.faces.push(4, 4, 5)
    const b = critCheck(a.state, { unitId: 'B1', location: 'HD', why: 'structure' }, BUNDLE)
    expect(b.state.units.B1!.slots.HD.filter((s) => s.hit && s.token === 'sensors')).toHaveLength(2)
  })
})

describe('partial wing and Artemis', () => {
  it('CRIT-wing each partial wing crit cuts jump and heat bonuses by 1, floor 0', async () => {
    const { partialWingBonuses } = await import('../../src/engine/crits')
    const { mkUnit } = await import('./damage.fixture')
    const u = mkUnit('B1', 'B', { tonnage: 50, mounts: [{ id: 'w1', item: 'is.eq.partial-wing', location: 'LT' }] })
    u.baseMp.jump = 5
    expect(partialWingBonuses(u)).toEqual({ jump: 2, heat: 3 })
    u.mounts.w1!.critHits = 2
    expect(partialWingBonuses(u)).toEqual({ jump: 0, heat: 1 })
    u.mounts.w1!.critHits = 5
    expect(partialWingBonuses(u)).toEqual({ jump: 0, heat: 0 })
  })
  it('CLUS-004 Artemis +2 needs a linked intact mount and Artemis ammo', async () => {
    const { artemisClusterMod } = await import('../../src/engine/cluster')
    const { mkUnit, BUNDLE } = await import('./damage.fixture')
    const data = { ...BUNDLE, equipment: { ...BUNDLE.equipment, 'e.art': { id: 'e.art', kind: 'artemis' } } } as typeof BUNDLE
    const u = mkUnit('A1', 'A', { mounts: [{ id: 'm1', item: 'w.lrm20', location: 'LT' }, { id: 'a1', item: 'e.art', location: 'LT' }] })
    u.mounts.a1!.linkedTo = 'm1'
    expect(artemisClusterMod(data, u, 'm1', 'is.ammo.lrm-10-artemis')).toBe(2)
    expect(artemisClusterMod(data, u, 'm1', 'is.ammo.lrm-10')).toBe(0)
    u.mounts.a1!.destroyed = true
    expect(artemisClusterMod(data, u, 'm1', 'is.ammo.lrm-10-artemis')).toBe(0)
  })
})
