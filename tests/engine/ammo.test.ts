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

import { caseAt, defaultBin, pickHeatExplosionBin, spendAmmo, weaponRec } from '../../src/engine/ammo'
import { beginWork, endWork } from '../../src/engine/dice'
import { explodeBin } from '../../src/engine/damage'
import { critCheck } from '../../src/engine/crits'
import type { GameEvent } from '../../src/engine/events'
import { BUNDLE, mkState, mkUnit } from './damage.fixture'
import type { UnitOpts } from './damage.fixture'

const of = <T extends GameEvent['type']>(evs: GameEvent[], t: T): Extract<GameEvent, { type: T }>[] =>
  evs.filter((e) => e.type === t) as Extract<GameEvent, { type: T }>[]
const boom = (opts: UnitOpts, binId = 'b1') => explodeBin(mkState([mkUnit('B1', 'B', opts)]), 'B1', binId, 'crit', BUNDLE)

describe('ammunition (10 §12)', () => {
  it('AMMO-001 a shot is drawn from the bin with the fewest shots; two ammo types need a choice', () => {
    const u = mkUnit('A1', 'A', {
      mounts: [{ id: 'm1', item: 'w.srm6', location: 'RA' }],
      bins: [{ id: 'b1', ammo: 'a.srm6', location: 'LT', shots: 15 }, { id: 'b2', ammo: 'a.srm6', location: 'RT', shots: 6 }],
    })
    const weapon = weaponRec(BUNDLE, 'w.srm6')!
    expect(defaultBin(u, weapon)).toEqual({ binId: 'b2', needsChoice: false })
    const w = beginWork(mkState([u]), BUNDLE)
    expect(spendAmmo(w, 'A1', 'b2')).toBe(true)
    const { state, events } = endWork(w)
    expect(state.units.A1!.bins.b2!.shots).toBe(5)
    expect(events[0]).toMatchObject({ type: 'AmmoSpent', binId: 'b2', left: 5 })
  })

  it('AMMO-010 a 10-shot SRM 6 bin explodes for 20 (capped), to structure only, transferring structure to structure, 1 pilot hit', () => {
    q.faces.push(3, 3) // CT structure damage: crit check 6
    const r = boom({ armor: { RT: 14 }, structure: { RT: 12 }, bins: [{ id: 'b1', ammo: 'a.srm6', location: 'RT', shots: 10 }] })
    const u = r.state.units.B1!
    expect(of(r.events, 'AmmoExploded')[0]).toMatchObject({ shots: 10, damage: 20, capped: true })
    expect(of(r.events, 'DamageApplied')[0]).toMatchObject({ armorBefore: 14, armorAfter: 14 }) // armor untouched by the blast
    expect(u.locs.RT.destroyed).toBe(true)
    expect(u.locs.CT.armor).toBe(20)
    expect(u.locs.CT.structure).toBe(8) // 20 - 12 structure in RT
    expect(u.pilot.hits).toBe(1)
  })

  it('AMMO-010 an AC/5 bin with 2 shots explodes for 10', () => {
    q.faces.push(3, 3)
    const r = boom({ bins: [{ id: 'b1', ammo: 'a.ac5', location: 'LT', shots: 2 }] })
    expect(of(r.events, 'AmmoExploded')[0]).toMatchObject({ damage: 10, capped: false })
  })

  it('AMMO-011 CASE caps at 10, confines the blast and strips the torso rear armor', () => {
    const opts: UnitOpts = {
      mounts: [{ id: 'c', item: 'e.case', location: 'LT' }], bins: [{ id: 'b1', ammo: 'a.srm6', location: 'LT', shots: 10 }],
    }
    q.faces.push(3, 3)
    const r = boom(opts)
    const lt = r.state.units.B1!.locs.LT
    expect([lt.structure, lt.rear]).toEqual([2, 0])
    expect(r.state.units.B1!.locs.CT.structure).toBe(16) // nothing transferred
    expect(of(r.events, 'AmmoExploded')[0]).toMatchObject({ damage: 10, capped: true })
    const r2 = boom({ ...opts, structure: { LT: 8 } })
    expect(r2.state.units.B1!.locs.LT.destroyed).toBe(true)
    expect(of(r2.events, 'DamageApplied')[0]).toMatchObject({ lost: 2, transferredTo: null })
    expect(r2.state.units.B1!.locs.CT.structure).toBe(16)
  })

  it('AMMO-012 CASE II: one point to structure, the rest to the rear armor, excess lost', () => {
    q.faces.push(3, 3)
    const r = boom({ mounts: [{ id: 'c', item: 'e.caseii', location: 'LT' }], bins: [{ id: 'b1', ammo: 'a.srm6', location: 'LT', shots: 10 }] })
    const lt = r.state.units.B1!.locs.LT
    expect([lt.structure, lt.rear]).toEqual([11, 0])
    expect(of(r.events, 'DamageApplied').at(-1)).toMatchObject({ side: 'rear', damage: 19, lost: 13 })
  })

  it('AMMO-013 CASE only exists where the unit data mounts it', () => {
    const u = mkUnit('B1', 'B', { mounts: [{ id: 'c', item: 'e.case', location: 'RT' }] })
    expect(caseAt(BUNDLE, u, 'RT')).toBe('case')
    expect(caseAt(BUNDLE, u, 'LT')).toBe('none')
  })

  it('AMMO-020 a Gauss rifle crit explodes for 2 per slot; Gauss ammo never explodes', () => {
    q.faces.push(4, 4, 1, 1, 3, 3) // crit; block 1 slot 1 = gauss; explosion hits RA structure: crit check 6
    const g = critCheck(
      mkState([mkUnit('B1', 'B', { armor: { RA: 0 }, structure: { RA: 30 }, mounts: [{ id: 'g', item: 'w.gauss', location: 'RA' }], slots: { RA: ['#g', '#g', '#g', '#g', '#g', '#g', '#g'] } })]),
      { unitId: 'B1', location: 'RA', why: 'structure' }, BUNDLE,
    )
    expect(of(g.events, 'ComponentExploded')[0]).toMatchObject({ damage: 14 })
    expect(g.state.units.B1!.pilot.hits).toBe(1)
    q.faces.push(4, 4, 1)
    const a = critCheck(
      mkState([mkUnit('B1', 'B', { bins: [{ id: 'b1', ammo: 'a.gauss', location: 'LT', shots: 8 }], slots: { LT: ['#b1'] } })]),
      { unitId: 'B1', location: 'LT', why: 'structure' }, BUNDLE,
    )
    expect(of(a.events, 'AmmoExploded')).toHaveLength(0)
  })

  it('AMMO-030 a heat explosion takes the bin with the most damage per shot, then the most shots', () => {
    const u = mkUnit('B1', 'B', {
      bins: [
        { id: 'mg', ammo: 'a.mg', location: 'LT', shots: 200 },
        { id: 'srm', ammo: 'a.srm6', location: 'RT', shots: 15 },
        { id: 'srm2', ammo: 'a.srm6', location: 'LA', shots: 5 },
      ],
    })
    expect(pickHeatExplosionBin(BUNDLE, u)).toBe('srm')
    u.bins.srm!.shots = 0
    expect(pickHeatExplosionBin(BUNDLE, u)).toBe('srm2')
  })
})
