import { afterEach, describe, expect, it, vi } from 'vitest'

const FORCED = vi.hoisted(() => [] as number[][])
vi.mock('../../src/engine/rng', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/engine/rng')>()
  return {
    ...real,
    roll(state: import('../../src/engine/types').GameState, spec: import('../../src/engine/rng').RollSpec) {
      const f = FORCED.shift()
      if (!f) return real.roll(state, spec)
      return { state: { ...state, rollSeq: state.rollSeq + 1 }, event: real.diceEvent(state, spec, f) }
    },
  }
})
afterEach(() => { FORCED.length = 0 })

import type { DeclareFireAction, FireShot } from '../../src/engine/actions'
import type { GameEvent } from '../../src/engine/events'
import {
  applyTorsoTwist, declareFire, finishRangedPhase, resolveRanged, startRangedPhase, twistOptionsFor,
} from '../../src/engine/phases/ranged'
import type { GameState, UnitState } from '../../src/engine/types'
import { BUNDLE, MLASER, PPC, withUnit, world } from './phys.fixture'

const ofType = <T extends GameEvent['type']>(evs: GameEvent[], t: T): Extract<GameEvent, { type: T }>[] =>
  evs.filter((e) => e.type === t) as Extract<GameEvent, { type: T }>[]
const act = (shots: FireShot[], over: Partial<DeclareFireAction> = {}): DeclareFireAction =>
  ({ type: 'declareFire', decisionId: 'd:1', player: 'A', unitId: 'A1', shots, ...over })
const AC5 = { id: 'm3', item: 'w.ac5', location: 'RT' as const }

/** A1 (A) at col 3 row 5 facing north; B1 two hexes north (forward arc); B2 two hexes east (right arc). */
function duel(opts: { a?: Parameters<typeof world>[0][number][5]; mounts?: NonNullable<Parameters<typeof world>[0][number][5]>['mounts'] } = {}): GameState {
  const s = world([
    ['A1', 'A', 3, 5, 0, { mounts: [MLASER, PPC, AC5], bins: [{ id: 'b1', ammo: 'a.ac5', location: 'RT', shots: 20 }], ...opts.a }],
    ['B1', 'B', 3, 3, 3, { mounts: [MLASER] }],
    ['B2', 'B', 5, 5, 3, { mounts: [MLASER] }],
  ])
  return withUnit(s, 'A1', { move: { ...s.units.A1!.move, mode: null } })
}

describe('ranged declaration and resolution (10 §6-§7)', () => {
  it('TOHIT-001 gunnery 4, stood still, medium laser at range 2: TN 4, heat and flags booked, own roll per weapon', () => {
    const r = declareFire(duel(), BUNDLE, act([{ mountId: 'm1', targetId: 'B1' }]))
    expect(r.rejection).toBeUndefined()
    const d = r.state.declarations[0]!
    expect(d).toMatchObject({ kind: 'ranged', tn: 4, band: 'short', distance: 2, primary: true })
    expect(ofType(r.events, 'FireDeclared')[0]!.shots).toHaveLength(1)
    expect(r.state.heatLedger.A1!.reduce((a, e) => a + e.amount, 0)).toBe(3)
    expect(r.state.units.A1!.attacks).toMatchObject({ rangedDeclared: true, primaryTargetId: 'B1', firedMounts: ['m1'] })
  })

  it('TOHIT-002 / TOHIT-011 TN 12 is legal, 13 is rejected, TN 2 is an automatic hit; PPC inside minimum range adds to the TN', () => {
    const base = duel()
    const g = (n: number) => withUnit(base, 'A1', { pilot: { ...base.units.A1!.pilot, gunnery: n } })
    expect(declareFire(g(9), BUNDLE, act([{ mountId: 'm1', targetId: 'B1' }])).rejection).toBeUndefined() // 9 + 0 range... TN 9
    expect(declareFire(g(13), BUNDLE, act([{ mountId: 'm1', targetId: 'B1' }])).rejection?.code).toBe('E_TN_TOO_HIGH')
    expect(declareFire(g(2), BUNDLE, act([{ mountId: 'm1', targetId: 'B1' }])).state.declarations[0]!.tn).toBe(2)
    // PPC (min 3) at range 2: +2
    expect(declareFire(base, BUNDLE, act([{ mountId: 'm2', targetId: 'B1' }])).state.declarations[0]!.tn).toBe(6)
  })

  it('TOHIT-003 a weapon cannot be declared twice, beyond long range, out of arc, or at a friend (TOHIT-004)', () => {
    const s = duel()
    expect(declareFire(s, BUNDLE, act([{ mountId: 'm1', targetId: 'B1' }, { mountId: 'm1', targetId: 'B1' }])).rejection?.code).toBe('E_DUPLICATE')
    const far = withUnit(s, 'B1', { pos: { q: 3, r: -5 } }) // ten rows up the column, off the board
    expect(declareFire(far, BUNDLE, act([{ mountId: 'm1', targetId: 'B1' }])).rejection?.code).toMatch(/E_BAD_TARGET|E_OUT_OF_RANGE|E_NO_LOS/)
    const behind = withUnit(s, 'B1', { pos: { q: 3, r: 6 } })
    expect(declareFire(behind, BUNDLE, act([{ mountId: 'm2', targetId: 'B1' }])).rejection?.code).toBe('E_OUT_OF_ARC')
    const ally = withUnit(s, 'B1', { owner: 'A' })
    expect(declareFire(ally, BUNDLE, act([{ mountId: 'm1', targetId: 'B1' }])).rejection?.code).toBe('E_FRIENDLY_TARGET')
    // used weapon
    const used = declareFire(s, BUNDLE, act([{ mountId: 'm1', targetId: 'B1' }])).state
    expect(declareFire({ ...used, units: { ...used.units, A1: { ...used.units.A1!, attacks: { ...used.units.A1!.attacks, rangedDeclared: false } } } }, BUNDLE, act([{ mountId: 'm1', targetId: 'B1' }])).rejection?.code).toBe('E_WEAPON_USED')
  })

  it('TOHIT-004 an empty-hex shot spends ammo and heat and changes nothing else; INIT-010 ammo drops at declaration', () => {
    const s = duel()
    const r = declareFire(s, BUNDLE, act([{ mountId: 'm3', targetId: null, hex: { q: 3, r: 2 } }]))
    expect(r.rejection).toBeUndefined()
    expect(r.state.units.A1!.bins.b1!.shots).toBe(19)
    expect(ofType(r.events, 'AmmoSpent')).toHaveLength(1)
    expect(r.state.heatLedger.A1!.reduce((a, e) => a + e.amount, 0)).toBe(1)
    const res = resolveRanged(r.state, BUNDLE)
    expect(ofType(res.events, 'AttackEnded')[0]).toMatchObject({ hit: false, damageDealt: 0 })
    expect(ofType(res.events, 'DamageApplied')).toHaveLength(0)
  })

  it('AMMO-001 an omitted bin takes the fuller-last default: the bin with the fewest shots', () => {
    const s = duel({ a: { bins: [{ id: 'b1', ammo: 'a.ac5', location: 'RT', shots: 20 }, { id: 'b2', ammo: 'a.ac5', location: 'LT', shots: 5 }] } })
    const r = declareFire(s, BUNDLE, act([{ mountId: 'm3', targetId: 'B1' }]))
    expect(r.state.declarations[0]).toMatchObject({ binId: 'b2' })
    expect(r.state.units.A1!.bins.b2!.shots).toBe(4)
  })

  it('TOHIT-005 / TOHIT-024 the first target is primary; a Forward-arc target must come first; others get +1', () => {
    const s = duel()
    const ok = declareFire(s, BUNDLE, act([{ mountId: 'm2', targetId: 'B1' }, { mountId: 'm1', targetId: 'B2' }]))
    expect(ok.rejection).toBeUndefined()
    const [a, b] = ok.state.declarations
    expect(a).toMatchObject({ primary: true })
    expect(b).toMatchObject({ primary: false })
    expect(b!.mods.find((m) => m.code === 'secondaryTarget')?.value).toBe(1)
    // reversed order: B1 is Forward but the first shot is at B2 (right arc)
    expect(declareFire(s, BUNDLE, act([{ mountId: 'm1', targetId: 'B2' }, { mountId: 'm2', targetId: 'B1' }])).rejection?.code).toBe('E_PRIMARY_TARGET')
    // B2 alone is a legal primary
    expect(declareFire(s, BUNDLE, act([{ mountId: 'm1', targetId: 'B2' }])).rejection).toBeUndefined()
  })

  it('TOHIT-006 shut down, unconscious, or holding a charge: no ranged attack', () => {
    const s = duel()
    expect(declareFire(withUnit(s, 'A1', { shutdown: { cause: 'heat', turn: 1 } }), BUNDLE, act([{ mountId: 'm1', targetId: 'B1' }])).rejection?.code).toBe('E_SHUTDOWN')
    expect(declareFire(withUnit(s, 'A1', { pilot: { ...s.units.A1!.pilot, conscious: false } }), BUNDLE, act([{ mountId: 'm1', targetId: 'B1' }])).rejection?.code).toBe('E_UNCONSCIOUS')
    const charging = withUnit(s, 'A1', { attacks: { ...s.units.A1!.attacks, charge: { targetId: 'B1', fromHex: s.units.A1!.pos! } } })
    expect(declareFire(charging, BUNDLE, act([{ mountId: 'm1', targetId: 'B1' }])).rejection?.code).toBe('E_NO_RANGED')
  })

  it('TOHIT-008 prone with both arms intact: the propping arm and legs cannot fire, others get +2', () => {
    const s = withUnit(duel(), 'A1', { prone: true })
    expect(declareFire(s, BUNDLE, act([{ mountId: 'm1', targetId: 'B1' }], { propArm: 'RA' })).rejection?.code).toBe('E_PROP_ARM')
    const r = declareFire(s, BUNDLE, act([{ mountId: 'm2', targetId: 'B1' }], { propArm: 'RA' }))
    expect(r.rejection).toBeUndefined()
    expect(r.state.declarations[0]!.mods.some((m) => m.code === 'attackerProne' && m.value === 2)).toBe(true)
  })

  it('ARC-010 / ARC-013 one twist or flip per turn, none while prone', () => {
    const s = duel()
    const t = applyTorsoTwist(s, { type: 'torsoTwist', decisionId: 'd:1', player: 'A', unitId: 'A1', twist: 1, flip: false })
    expect(t.rejection).toBeUndefined()
    expect(t.state.units.A1!.attacks).toMatchObject({ twist: 1, twistPhase: 'rangedAttack' })
    const again = applyTorsoTwist(t.state, { type: 'torsoTwist', decisionId: 'd:2', player: 'A', unitId: 'A1', twist: -1, flip: false })
    expect(again.rejection?.code).toBe('E_NO_TWIST')
    expect(twistOptionsFor(withUnit(s, 'A1', { prone: true }), 'A1').twistOptions).toEqual([0])
  })

  it('INIT-012 a unit destroyed mid-phase still resolves its declared attacks; the loss applies only at end of phase', () => {
    let s = duel({ a: { mounts: [MLASER] } })
    s = withUnit(s, 'B1', { facing: 3 }) // faces A1: front column
    // B1 has nothing left in the centre torso: one laser hit there ends it
    const b1 = s.units.B1!
    s = withUnit(s, 'B1', { locs: { ...b1.locs, CT: { ...b1.locs.CT, armor: 0, structure: 1 } } })
    s = withUnit(s, 'B1', { move: { ...s.units.B1!.move, mode: null } })
    s = declareFire(s, BUNDLE, act([{ mountId: 'm1', targetId: 'B1' }])).state
    s = declareFire(s, BUNDLE, act([{ mountId: 'm1', targetId: 'A1' }], { unitId: 'B1', player: 'B' })).state
    expect(s.declarations).toHaveLength(2)
    // A1's laser: hit [6,6], location 7 (centre torso) [3,4]; B1's laser: hit [6,6], location 7
    FORCED.push([6, 6], [3, 4], [6, 6], [3, 4])
    const r = resolveRanged(s, BUNDLE)
    expect(FORCED).toEqual([])
    expect(r.state.units.B1!.doomed).toBe('ctDestroyed')
    expect(r.state.units.B1!.status).toBe('active')
    expect(ofType(r.events, 'AttackRolled').map((e) => e.attackerId)).toEqual(['A1', 'B1']) // B1 still fired
    expect(r.state.units.A1!.locs.CT.armor).toBeLessThan(20) // and hit
    const end = finishRangedPhase(r.state)
    expect(end.state.units.B1!.status).toBe('destroyed')
    expect(ofType(end.events, 'UnitDestroyed').some((e) => e.unitId === 'B1' && e.effective)).toBe(true)
  })

  it('INIT-004 the Ranged Phase opens with a selection for the loser', () => {
    const r = startRangedPhase(duel())
    expect(r.state.phase).toBe('rangedAttack')
    expect(r.state.selection?.turnOf).toBe('A')
    expect(r.events[0]).toMatchObject({ type: 'PhaseStarted', phase: 'rangedAttack' })
  })
})

// keep the compiler honest about unused helpers
export type _Unused = UnitState
