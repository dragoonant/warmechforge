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

import type { PhysicalChoice } from '../../src/engine/actions'
import type { GameEvent } from '../../src/engine/events'
import { splitGroups } from '../../src/engine/cluster'
import {
  chargeDamage, chargeSelfDamage, dfaDamage, dfaSelfDamage, kickDamage, physicalPreview, punchDamage,
} from '../../src/engine/physical'
import { bookCommitted, declarePhysical, runPhysicalResolution } from '../../src/engine/phases/physical'
import type { GameState, UnitState } from '../../src/engine/types'
import { BUNDLE, at, mkBoard, withUnit, world } from './phys.fixture'

const ofType = <T extends GameEvent['type']>(evs: GameEvent[], t: T): Extract<GameEvent, { type: T }>[] =>
  evs.filter((e) => e.type === t) as Extract<GameEvent, { type: T }>[]

/** A1 (A) at col 3 row 5 facing north; B1 directly north facing south. Physical Attack Phase. */
function duel(over: { board?: ReturnType<typeof mkBoard>; a?: object; b?: object } = {}): GameState {
  const s = world([
    ['A1', 'A', 3, 5, 0, over.a],
    ['B1', 'B', 3, 4, 3, over.b],
  ], over.board)
  let t: GameState = { ...s, phase: 'physicalAttack', step: 'physical.declare', ledger: { ...s.ledger, phase: 'physicalAttack' } }
  t = withUnit(t, 'A1', { move: { ...t.units.A1!.move, mode: null } })
  return withUnit(t, 'B1', { move: { ...t.units.B1!.move, mode: null } })
}
const declare = (s: GameState, unitId: string, attack: PhysicalChoice) =>
  declarePhysical(s, BUNDLE, { type: 'declarePhysical', decisionId: 'd:1', player: s.units[unitId]!.owner, unitId, attack })
const prev = (s: GameState, kind: Parameters<typeof physicalPreview>[1]['kind'], limb?: 'LA' | 'RA' | 'LL' | 'RL') =>
  physicalPreview(s, { attackerId: 'A1', targetId: 'B1', kind, ...(limb ? { limb } : {}) })
const hit = (u: UnitState, loc: 'LA' | 'RA' | 'LL' | 'RL', token: string): UnitState => {
  const slots = { ...u.slots, [loc]: u.slots[loc].map((s) => (s.token === token ? { ...s, hit: true, hitPhase: 1 } : s)) }
  return { ...u, slots }
}
const gone = (u: UnitState, loc: 'LA' | 'RA', token: string): UnitState =>
  ({ ...u, slots: { ...u.slots, [loc]: u.slots[loc].map((s) => (s.token === token ? { ...s, token: 'empty' } : s)) } })

describe('physical attack numbers (10 §16)', () => {
  it('PHYS-010 / PHYS-011 / PHYS-012 punch, kick and push each start at -1: Piloting 5 gives TN 4', () => {
    const s = duel()
    expect(prev(s, 'punch', 'LA').tn).toBe(4)
    expect(prev(s, 'kick', 'RL').tn).toBe(4)
    expect(prev(s, 'push').tn).toBe(4)
    expect(prev(s, 'punch', 'LA').mods.map((m) => m.code)).toEqual(['piloting', 'physicalBase'])
  })

  it('PHYS-001 / PHYS-002 TN counts movement and target mods but never heat; TN 13 is not legal', () => {
    let s = duel()
    s = withUnit(s, 'A1', { heat: 20, move: { ...s.units.A1!.move, mode: 'walk' } })
    s = withUnit(s, 'B1', { move: { ...s.units.B1!.move, tmm: 2 } })
    expect(prev(s, 'punch', 'LA').tn).toBe(5 - 1 + 1 + 2) // piloting, base, walked, TMM
    const hard = withUnit(s, 'A1', { pilot: { ...s.units.A1!.pilot, piloting: 14 } })
    expect(prev(hard, 'punch', 'LA')).toMatchObject({ legal: false, reason: 'E_TN_TOO_HIGH' })
  })

  it('PHYS-003 / PHYS-004 prone, shut down, not adjacent or outside the arc: nothing is legal', () => {
    const s = duel()
    expect(prev(withUnit(s, 'A1', { prone: true }), 'punch', 'LA').legal).toBe(false)
    expect(prev(withUnit(s, 'A1', { shutdown: { cause: 'heat', turn: 1 } }), 'kick', 'LL').reason).toBe('E_SHUTDOWN')
    expect(prev(withUnit(s, 'B1', { pos: at(3, 2) }), 'punch', 'LA').reason).toBe('E_NOT_ADJACENT')
    expect(prev(withUnit(s, 'B1', { pos: at(3, 6) }), 'kick', 'LL').reason).toBe('E_OUT_OF_ARC')
    expect(prev(withUnit(s, 'A1', { facing: 3 }), 'push').reason).toBe('E_OUT_OF_ARC')
  })

  it('PHYS-021 / PHYS-022 / PHYS-023 / PHYS-026 level differences pick the table or forbid the attack', () => {
    const up = duel({ board: mkBoard(8, 8, { '0405': { level: 1 } }) }) // B1 one level higher
    expect(prev(up, 'punch', 'LA')).toMatchObject({ legal: true, table: 'kick' })
    expect(prev(up, 'kick', 'LL').reason).toBe('E_LEVEL_DIFF')
    const down = duel({ board: mkBoard(8, 8, { '0406': { level: 1 } }) }) // B1 one level lower
    expect(prev(down, 'kick', 'LL')).toMatchObject({ legal: true, table: 'punch' })
    expect(prev(down, 'punch', 'LA').reason).toBe('E_LEVEL_DIFF')
    const prone = withUnit(duel(), 'B1', { prone: true })
    expect(prev(prone, 'kick', 'LL')).toMatchObject({ legal: true, table: 'standard' })
    expect(prev(prone, 'punch', 'LA').legal).toBe(false)
    const far = duel({ board: mkBoard(8, 8, { '0405': { level: 2 } }) })
    expect(prev(far, 'punch', 'LA').reason).toBe('E_LEVEL_DIFF')
  })

  it('PHYS-032 / PHYS-033 punch damage halves per missing or critted arm actuator and the TN climbs', () => {
    const base = duel({ a: { tonnage: 65 } })
    const noLower = withUnit(base, 'A1', gone(base.units.A1!, 'LA', 'lowerArm'))
    expect(punchDamage(noLower, noLower.units.A1!, 'LA')).toBe(3) // 7 -> 3
    expect(prev(noLower, 'punch', 'LA').mods.find((m) => m.code === 'lowerArm')?.value).toBe(2)
    const t55 = duel({ a: { tonnage: 55 } })
    let u = t55.units.A1!
    expect(punchDamage(t55, u, 'LA')).toBe(6)
    u = hit(hit(u, 'LA', 'upperArm'), 'LA', 'lowerArm')
    const crit = withUnit(t55, 'A1', u)
    expect(punchDamage(crit, crit.units.A1!, 'LA')).toBe(1) // 6 -> 3 -> 1
    expect(prev(crit, 'punch', 'LA').tn).toBe(5 - 1 + 4)
    expect(prev(withUnit(t55, 'A1', hit(t55.units.A1!, 'LA', 'shoulder')), 'punch', 'LA').reason).toBe('E_LIMB_UNAVAILABLE')
  })

  it('PHYS-034 / PHYS-035 / PHYS-036 kick: 55 t does 11, lower leg crit halves, upper leg plus foot add +3, hip forbids', () => {
    const s = duel({ a: { tonnage: 55 } })
    expect(kickDamage(s, s.units.A1!, 'LL')).toBe(11)
    const lower = withUnit(s, 'A1', hit(s.units.A1!, 'LL', 'lowerLeg'))
    expect(kickDamage(lower, lower.units.A1!, 'LL')).toBe(5)
    const mix = withUnit(s, 'A1', hit(hit(s.units.A1!, 'LL', 'upperLeg'), 'LL', 'foot'))
    expect(prev(mix, 'kick', 'LL').mods.filter((m) => m.code === 'upperLeg' || m.code === 'foot').reduce((a, m) => a + m.value, 0)).toBe(3)
    expect(prev(withUnit(s, 'A1', hit(s.units.A1!, 'RL', 'hip')), 'kick', 'LL').reason).toBe('E_LIMB_UNAVAILABLE')
  })

  it('PHYS-043 / PHYS-064 charge and DFA damage numbers and groups', () => {
    expect(chargeDamage(65, 5)).toBe(33)
    expect(chargeSelfDamage(45)).toBe(5)
    expect(chargeDamage(50, 2)).toBe(15)
    expect(chargeDamage(50, 12)).toBe(50)
    expect(chargeDamage(50, 0)).toBe(5)
    expect(splitGroups(dfaDamage(55), 5)).toEqual([5, 5, 5, 2])
    expect(splitGroups(dfaSelfDamage(55), 5)).toEqual([5, 5, 1])
  })

  it('PHYS-008 comparative modifier: Piloting 4 vs 5 is -1; against an immobile target the target counts as 4', () => {
    const s = duel()
    const a = withUnit(s, 'A1', { pilot: { ...s.units.A1!.pilot, piloting: 4 } })
    const c = physicalPreview(a, { attackerId: 'A1', targetId: 'B1', kind: 'charge' })
    expect(c.mods.find((m) => m.code === 'comparative')?.value).toBe(-1)
    const imm = { ...a, ledger: { ...a.ledger, immobileAtStart: ['B1'] } }
    const ci = physicalPreview(imm, { attackerId: 'A1', targetId: 'B1', kind: 'charge' })
    expect(ci.mods.some((m) => m.code === 'comparative')).toBe(false) // 4 - 4 = 0
    expect(ci.mods.find((m) => m.code === 'targetImmobile')?.value).toBe(-4)
  })

  it('PHYS-005 a second push on one target is not legal', () => {
    const s = world([['A1', 'A', 3, 5, 0], ['A2', 'A', 2, 4, 1], ['B1', 'B', 3, 4, 3]])
    const p = { ...s, phase: 'physicalAttack' as const }
    const one = declare(p, 'A1', { kind: 'push', targetId: 'B1' })
    expect(one.rejection).toBeUndefined()
    expect(declare(one.state, 'A2', { kind: 'push', targetId: 'B1' }).rejection?.code).toBe('E_ATTACK_LIMIT')
  })
})

describe('physical resolution and the Displacement Step', () => {
  it('PHYS-045 / PHYS-090 charge hit: both take damage, both PSR +2 at end of phase, target pushed back, charger enters', () => {
    let s = duel()
    s = withUnit(s, 'A1', { move: { ...s.units.A1!.move, mode: 'walk', hexesMoved: 3 }, attacks: { ...s.units.A1!.attacks, charge: { targetId: 'B1', fromHex: s.units.A1!.pos! } } })
    const booked = bookCommitted(s, 'A1')
    expect(booked.voided).toBe(false)
    expect(ofType(booked.events, 'PhysicalDeclared')[0]).toMatchObject({ kind: 'charge', targetId: 'B1', tn: 6 })
    // hit [6,6]; target 15 damage = 3 groups of 5 (each location 7: centre torso); charger 5 damage = 1 group
    // end of phase: B1 and A1 PSRs (TN 7) pass
    FORCED.push([6, 6], [3, 4], [3, 4], [3, 4], [3, 4], [6, 6], [6, 6])
    const r = runPhysicalResolution(booked.state, BUNDLE)
    expect(FORCED).toEqual([])
    expect(r.state.units.B1!.locs.CT.armor).toBe(20 - 15)
    expect(r.state.units.A1!.locs.CT.armor).toBe(20 - 5)
    expect(r.state.units.B1!.pos).toEqual(at(3, 3))
    expect(r.state.units.A1!.pos).toEqual(at(3, 4))
    const psrs = ofType(r.events, 'PsrResolved')
    expect(psrs.map((p) => [p.unitId, p.reason, p.tn]).sort()).toEqual([['A1', 'chargeMade', 7], ['B1', 'charged', 7]])
    expect(r.state.damageWindow).toBe('immediate')
    expect(ofType(r.events, 'UnitDisplaced')[0]).toMatchObject({ unitId: 'B1', cause: 'charge' })
  })

  it('PHYS-071 push hit: no damage, target moved away, attacker enters the vacated hex, target PSR 0', () => {
    let s = duel()
    s = declare(s, 'A1', { kind: 'push', targetId: 'B1' }).state
    FORCED.push([6, 6], [6, 6]) // hit; target PSR (TN 5) passes
    const r = runPhysicalResolution(s, BUNDLE)
    expect(r.state.units.B1!.locs.CT.armor).toBe(20)
    expect(r.state.units.B1!.pos).toEqual(at(3, 3))
    expect(r.state.units.A1!.pos).toEqual(at(3, 4))
    expect(ofType(r.events, 'PsrResolved')).toMatchObject([{ unitId: 'B1', reason: 'pushed', tn: 5 }])
  })

  it('PHYS-072 two units pushing each other, both hit: neither moves, both make a PSR', () => {
    let s = duel()
    s = declare(s, 'A1', { kind: 'push', targetId: 'B1' }).state
    s = declare(s, 'B1', { kind: 'push', targetId: 'A1' }).state
    FORCED.push([6, 6], [6, 6], [6, 6], [6, 6])
    const r = runPhysicalResolution(s, BUNDLE)
    expect(r.state.units.A1!.pos).toEqual(at(3, 5))
    expect(r.state.units.B1!.pos).toEqual(at(3, 4))
    expect(ofType(r.events, 'PsrResolved').map((p) => p.unitId).sort()).toEqual(['A1', 'B1'])
  })

  it('PHYS-073 a push off the board destroys the target (displacedOff)', () => {
    const s0 = world([['A1', 'A', 3, 1, 0], ['B1', 'B', 3, 0, 3]])
    let s: GameState = { ...s0, phase: 'physicalAttack' }
    s = withUnit(s, 'A1', { move: { ...s.units.A1!.move, mode: null } })
    s = declare(s, 'A1', { kind: 'push', targetId: 'B1' }).state
    FORCED.push([6, 6])
    const r = runPhysicalResolution(s, BUNDLE)
    expect(r.state.units.B1!.status).toBe('destroyed')
    expect(r.state.units.B1!.destroyedCause).toBe('displacedOff')
    expect(ofType(r.events, 'PsrDiscarded').some((p) => p.unitId === 'B1' && p.why === 'destroyed')).toBe(true)
  })

  it('PHYS-094 domino: the unit behind a displaced one makes a PSR; failing it, it is pushed on and falls', () => {
    const s0 = world([['A1', 'A', 3, 5, 0], ['B1', 'B', 3, 4, 3], ['B2', 'B', 3, 3, 3]])
    let s: GameState = { ...s0, phase: 'physicalAttack' }
    s = withUnit(s, 'A1', { move: { ...s.units.A1!.move, mode: null } })
    s = declare(s, 'A1', { kind: 'push', targetId: 'B1' }).state
    FORCED.push([6, 6], [1, 1]) // hit; B2's domino PSR (TN 5) fails; the fall then uses the seeded dice
    const r = runPhysicalResolution(s, BUNDLE)
    expect(r.state.units.B2!.pos).toEqual(at(3, 2))
    expect(r.state.units.B2!.prone).toBe(true)
    expect(r.state.units.B1!.pos).toEqual(at(3, 3))
    expect(r.state.units.B1!.prone).toBe(false)
    expect(r.state.units.A1!.pos).toEqual(at(3, 4))
    expect(ofType(r.events, 'PsrResolved').find((p) => p.reason === 'domino')).toMatchObject({ unitId: 'B2', success: false })
  })

  it('PHYS-042 a charger that fell, or whose target is prone, has its charge voided and may choose another attack', () => {
    let s = duel()
    s = withUnit(s, 'A1', { attacks: { ...s.units.A1!.attacks, charge: { targetId: 'B1', fromHex: s.units.A1!.pos! } } })
    const fell = bookCommitted(withUnit(s, 'A1', { prone: true }), 'A1')
    expect(fell.voided).toBe(true)
    expect(fell.state.units.A1!.attacks.charge).toBeNull()
    const proneTarget = bookCommitted(withUnit(s, 'B1', { prone: true }), 'A1')
    expect(proneTarget.voided).toBe(true)
  })

  it('PHYS-062 / PHYS-066 a DFA whose jumper fell in the Ranged Phase misses: target moves, jumper lands in its hex and falls 2 levels', () => {
    let s = duel()
    s = withUnit(s, 'A1', {
      prone: true, move: { ...s.units.A1!.move, mode: 'jump', jumped: true, hexesMoved: 4 },
      attacks: { ...s.units.A1!.attacks, dfa: { targetId: 'B1', fromHex: s.units.A1!.pos! } },
    })
    const booked = bookCommitted(s, 'A1')
    expect(booked.voided).toBe(false)
    expect(booked.state.declarations[0]!.tn).toBeGreaterThanOrEqual(13)
    const r = runPhysicalResolution(booked.state, BUNDLE)
    expect(ofType(r.events, 'AttackRolled')[0]).toMatchObject({ hit: false, auto: 'miss', roll: null })
    expect(r.state.units.B1!.pos).toEqual(at(3, 3))
    expect(r.state.units.A1!.pos).toEqual(at(3, 4))
    // the jumper already lies prone from its Ranged-phase fall: the landing fall is discarded (PSR-004)
    expect(ofType(r.events, 'PsrDiscarded').some((p) => p.unitId === 'A1' && p.why === 'prone')).toBe(true)
  })

  it('PHYS-066 a DFA that rolls a miss: the jumper lands in the target hex and takes a 2-level fall', () => {
    let s = duel()
    s = withUnit(s, 'A1', {
      move: { ...s.units.A1!.move, mode: 'jump', jumped: true, hexesMoved: 4 },
      attacks: { ...s.units.A1!.attacks, dfa: { targetId: 'B1', fromHex: s.units.A1!.pos! } },
    })
    const booked = bookCommitted(s, 'A1')
    expect(booked.state.declarations[0]!.tn).toBe(8) // piloting 5, jumped +3, comparative 0
    FORCED.push([1, 1])
    const r = runPhysicalResolution(booked.state, BUNDLE)
    expect(r.state.units.B1!.pos).toEqual(at(3, 3))
    expect(r.state.units.A1!.pos).toEqual(at(3, 4))
    expect(ofType(r.events, 'UnitFell').find((f) => f.unitId === 'A1')).toMatchObject({ levels: 2 })
  })
})
