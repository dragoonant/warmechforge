// M6 equipment hooks in real games (10 §18, 20 §12.2): PPC capacitor, coolant pod, Clan MASC with escalating failure, Ultra AC
// rapid fire, rotary AC jam/unjam, partial wing, Beagle probe and Guardian ECM. Every test drives the phase machine with step()
// on real 'Mech data (the RAC uses a fixture weapon: no release-1 'Mech carries one) and checks the hook is called.
import { afterEach, describe, expect, it, vi } from 'vitest'

/** Forced dice by roll purpose: each roll of that purpose takes the next queued dice; anything else rolls for real. */
const FORCED = vi.hoisted(() => ({} as Record<string, number[][]>))
vi.mock('../../src/engine/rng', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/engine/rng')>()
  return {
    ...real,
    roll(state: import('../../src/engine/types').GameState, spec: import('../../src/engine/rng').RollSpec) {
      const f = FORCED[spec.purpose]?.shift()
      if (!f) return real.roll(state, spec)
      return { state: { ...state, rollSeq: state.rollSeq + 1 }, event: real.diceEvent(state, spec, f) }
    },
  }
})
afterEach(() => {
  const left = Object.entries(FORCED).filter(([, q]) => q.length > 0)
  for (const k of Object.keys(FORCED)) delete FORCED[k]
  vi.restoreAllMocks()
  expect(left, 'forced dice left unused').toEqual([])
})
const force = (purpose: string, ...dice: number[][]): void => { (FORCED[purpose] ??= []).push(...dice) }

import { loadBundle } from '../../src/data/index'
import type { Action, DeclareFireAction, MoveAction } from '../../src/engine/actions'
import { critCheck } from '../../src/engine/crits'
import type { GameEvent } from '../../src/engine/events'
import { createGame, legalActions, query, registeredHooks, step, validate } from '../../src/engine/index'
import type { DataBundle, GameSetup, GameState, Hex, UnitId } from '../../src/engine/types'

const bundle = loadBundle()
const ofType = <T extends GameEvent['type']>(evs: GameEvent[], t: T): Extract<GameEvent, { type: T }>[] =>
  evs.filter((e) => e.type === t) as Extract<GameEvent, { type: T }>[]

/** A real game (skirmish rules, flat clear test board) with the units placed and active; pending is the turn-1 initiativeAck. */
function arena(a: string[], b: string[], at: Record<UnitId, [number, number, number]>, data: DataBundle = bundle): GameState {
  const side = (id: string, mechs: string[]) => ({ sideId: id, control: 'ai' as const, force: { id: `force.t-${id}`, name: id, units: mechs.map((mech) => ({ mech })) } })
  const setup: GameSetup = { missionId: 'mission.skirmish', mapId: 'map.test-canyons', sides: [side('a', a), side('b', b)], forcedWithdrawal: false, turnLimit: null, bvBudget: null }
  const r = createGame(setup, 'm6-equipment', data)
  if (r.rejection) throw new Error(r.rejection.message)
  let s = r.state
  const hexes = Object.fromEntries(Object.entries(s.board.hexes).map(([k, h]) => [k, { ...h, level: 0, woods: 'none' as const, depth: 0, rough: false, rubble: false }]))
  s = { ...s, board: { ...s.board, hexes } }
  const units = { ...s.units }
  for (const [id, [q, r2, f]] of Object.entries(at)) {
    const u = units[id]!
    units[id] = { ...u, pos: { q, r: r2 } as Hex, facing: f as 0, status: 'active' }
  }
  expect(s.pending.kind).toBe('initiativeAck')
  return { ...s, units }
}

type Chooser = (s: GameState) => Action | null | undefined
/** Default answers: stand still, hold fire, no physical attack, first option elsewhere. */
function fallback(s: GameState): Action {
  const legal = legalActions(s)
  if (s.pending.kind === 'move') return legal.find((a) => a.type === 'move' && a.mode === 'standStill') ?? legal[0]!
  return legal[0]!
}
const stamp = (s: GameState, a: Action): Action => ({ ...a, decisionId: s.pending.id, player: s.pending.player } as Action)
/** Steps the real machine until `until` holds; `choose` may answer any decision (null = default answer). */
function play(s0: GameState, choose: Chooser, until: (s: GameState) => boolean, max = 600): { state: GameState; events: GameEvent[] } {
  let s = s0
  const events: GameEvent[] = []
  for (let i = 0; i < max && !until(s); i++) {
    if (s.pending.kind === 'gameOver') throw new Error('game over before the condition')
    const a = stamp(s, choose(s) ?? fallback(s))
    const r = step(s, a)
    if (r.rejection) throw new Error(`${r.rejection.code} ${r.rejection.message}: ${JSON.stringify(a)}`)
    events.push(...r.events)
    s = r.state
  }
  if (!until(s)) throw new Error('condition never reached')
  return { state: s, events }
}
const at = (kind: string, unitId: UnitId, turn: number) => (s: GameState): boolean =>
  s.turn === turn && s.pending.kind === kind && s.pending.unitId === unitId
const endOfTurn = (turn: number) => (s: GameState): boolean => s.turn > turn
const fire = (s: GameState, unitId: UnitId, extra: Partial<DeclareFireAction>): DeclareFireAction =>
  ({ type: 'declareFire', decisionId: s.pending.id, player: s.pending.player, unitId, shots: [], ...extra })

// ---------------------------------------------------------------- PPC capacitor
describe('PPC capacitor (ppcCapacitor)', () => {
  const start = (): GameState => play(arena(['mech.regent.a'], ['mech.hollander.bzk-f3'], { A1: [5, 8, 0], B1: [5, 4, 3] }), () => null, at('declareFire', 'A1', 1)).state

  it('EQUIP-016 a charge costs 5 heat in its turn; the next turn the Clan ER PPC hits for +5 (15 -> 20), previews included', () => {
    let s = start()
    const declare = registeredHooks().ppcCapacitor!
    const spyDeclare = vi.spyOn(declare, 'attackDeclare')
    const t1 = play(s, (x) => (at('declareFire', 'A1', 1)(x) ? fire(x, 'A1', { charge: ['erppc-ra'] }) : null), endOfTurn(1))
    expect(ofType(t1.events, 'EquipmentUsed')).toEqual([{ type: 'EquipmentUsed', unitId: 'A1', mountId: 'cap-ra', use: 'capacitorCharged', amount: 5 }])
    expect(ofType(t1.events, 'HeatAdded').filter((e) => e.unitId === 'A1' && e.entry.source === 'equipment').map((e) => e.entry.amount)).toEqual([5])
    s = play(t1.state, () => null, at('declareFire', 'A1', 2)).state
    expect(query.sheet(s, 'A1').equipment?.find((e) => e.mountId === 'cap-ra')?.state).toBe('charged')
    expect(query.attackPreview(s, { attackerId: 'A1', mountId: 'erppc-ra', targetId: 'B1' }).damage).toBe(20)
    expect(query.attackPreview(s, { attackerId: 'A1', mountId: 'erppc-lt', targetId: 'B1' }).damage).toBe(15)
    const spyDamage = vi.spyOn(declare, 'damage')
    force('toHit', [6, 6])
    force('hitLocation', [3, 4]) // 7: centre torso
    const t2 = play(s, (x) => (at('declareFire', 'A1', 2)(x) ? fire(x, 'A1', { shots: [{ mountId: 'erppc-ra', targetId: 'B1' }] }) : null), endOfTurn(2))
    expect(spyDeclare).toHaveBeenCalled()
    expect(spyDamage.mock.calls.some(([ctx]) => ctx.mountId === 'cap-ra')).toBe(true)
    expect(ofType(t2.events, 'EquipmentUsed').map((e) => e.use)).toEqual(['capacitorDischarged'])
    expect(ofType(t2.events, 'HitLocated').filter((e) => e.unitId === 'B1').map((e) => e.damage)).toEqual([20])
    // the charge is spent: turn 3 previews 10 again
    const s3 = play(t2.state, () => null, at('declareFire', 'A1', 3)).state
    expect(query.attackPreview(s3, { attackerId: 'A1', mountId: 'erppc-ra', targetId: 'B1' }).damage).toBe(15)
  })

  it('EQUIP-016 a charging PPC cannot fire that turn; only a PPC with a working capacitor can charge', () => {
    const s = start()
    expect(validate(s, fire(s, 'A1', { charge: ['erppc-ra'], shots: [{ mountId: 'erppc-ra', targetId: 'B1' }] }))?.code).toBe('E_WEAPON_USED')
    expect(validate(s, fire(s, 'A1', { charge: ['erml-hd'] }))?.code).toBe('E_UNKNOWN_WEAPON')
    expect(validate(s, fire(s, 'A1', { charge: ['erppc-ra'], shots: [{ mountId: 'erppc-lt', targetId: 'B1' }] }))).toBeNull()
    const u = s.units.A1!
    const noCap = { ...s, units: { ...s.units, A1: { ...u, mounts: { ...u.mounts, 'cap-ra': { ...u.mounts['cap-ra']!, destroyed: true } } } } }
    expect(validate(noCap, fire(noCap, 'A1', { charge: ['erppc-ra'] }))?.code).toBe('E_BAD_PAYLOAD')
    expect(query.firePreview(s, 'A1', { shots: [], charge: ['erppc-ra'] }).heat.entries.filter((e) => e.source === 'equipment').map((e) => e.amount)).toEqual([5])
  })

  it('EQUIP-013 a natural 2 with a charged PPC does not burn the capacitor out (attackRolled is a no-op)', () => {
    const t1 = play(start(), (x) => (at('declareFire', 'A1', 1)(x) ? fire(x, 'A1', { charge: ['erppc-ra'] }) : null), at('declareFire', 'A1', 2))
    const spy = vi.spyOn(registeredHooks().ppcCapacitor!, 'attackRolled')
    force('toHit', [1, 1])
    const t2 = play(t1.state, (x) => (at('declareFire', 'A1', 2)(x) ? fire(x, 'A1', { shots: [{ mountId: 'erppc-ra', targetId: 'B1' }] }) : null), endOfTurn(2))
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy.mock.calls[0]![0]).toMatchObject({ mountId: 'cap-ra', roll: { total: 2 } })
    expect(t2.state.units.A1!.mounts['cap-ra']!.destroyed).toBe(false)
    expect(ofType(t2.events, 'ComponentDestroyed').filter((e) => e.unitId === 'A1')).toEqual([])
  })
})

// ---------------------------------------------------------------- coolant pod
describe('coolant pod (coolantPod)', () => {
  const start = (): GameState => play(arena(['mech.regent.a'], ['mech.hollander.bzk-f3'], { A1: [5, 8, 0], B1: [5, 4, 3] }), () => null, at('declareFire', 'A1', 1)).state

  it('EQUIP-017 vented once: +1 dissipation per operable sink in that Heat Phase; a second use is refused', () => {
    const s = start()
    const spy = vi.spyOn(registeredHooks().coolantPod!, 'heat')
    const base = query.sheet(s, 'A1').sinks.dissipation // 26 double sinks = 52
    expect(base).toBe(52)
    expect(query.firePreview(s, 'A1', { shots: [], coolantPod: 'pod-ra' }).heat.dissipation).toBe(52 + 26)
    const t1 = play(s, (x) => (at('declareFire', 'A1', 1)(x) ? fire(x, 'A1', { coolantPod: 'pod-ra' }) : null), endOfTurn(1))
    expect(ofType(t1.events, 'EquipmentUsed')).toEqual([{ type: 'EquipmentUsed', unitId: 'A1', mountId: 'pod-ra', use: 'coolantPod', amount: 26 }])
    expect(ofType(t1.events, 'HeatApplied').find((e) => e.unitId === 'A1')!.dissipated).toBe(52 + 26)
    expect(spy).toHaveBeenCalled()
    const s2 = play(t1.state, () => null, at('declareFire', 'A1', 2)).state
    expect(validate(s2, fire(s2, 'A1', { coolantPod: 'pod-ra' }))?.code).toBe('E_WEAPON_USED')
    expect(query.sheet(s2, 'A1').equipment?.find((e) => e.mountId === 'pod-ra')?.state).toBe('used')
  })

  it('EQUIP-017 a crit on an unused pod bursts for 10 like an ammo explosion; a used pod is simply destroyed', () => {
    const s = start()
    expect(s.units.A1!.slots.RA.findIndex((x) => x.token === '#pod-ra')).toBe(11)
    expect(query.explosionPreview(s, 'A1', { location: 'RA', index: 11 }).damage).toBe(10)
    const spy = vi.spyOn(registeredHooks().coolantPod!, 'crit')
    force('critCheck', [5, 4]) // 9: one crit
    force('critSlot', [4, 6]) // lower block, slot 6 = index 11
    const r = critCheck(s, { unitId: 'A1', location: 'RA', why: 'structure' }, bundle)
    expect(spy).toHaveBeenCalledTimes(1)
    expect(ofType(r.events, 'ComponentExploded')).toMatchObject([{ unitId: 'A1', mountId: 'pod-ra', damage: 10 }])
    expect(r.state.units.A1!.mounts['pod-ra']!.destroyed).toBe(true)
    expect(r.state.units.A1!.pilot.hits).toBe(1)
    // used pod: no burst
    const u = s.units.A1!
    const used = { ...s, units: { ...s.units, A1: { ...u, mounts: { ...u.mounts, 'pod-ra': { ...u.mounts['pod-ra']!, firedTurn: 1 } } } } }
    expect(query.explosionPreview(used, 'A1', { location: 'RA', index: 11 }).damage).toBe(0)
    force('critCheck', [5, 4])
    force('critSlot', [4, 6])
    const r2 = critCheck(used, { unitId: 'A1', location: 'RA', why: 'structure' }, bundle)
    expect(ofType(r2.events, 'ComponentExploded')).toEqual([])
    expect(ofType(r2.events, 'ComponentDestroyed')).toMatchObject([{ mountId: 'pod-ra' }])
  })
})

// ---------------------------------------------------------------- Clan MASC
describe('Clan MASC (masc)', () => {
  const start = (): GameState => play(arena(['mech.solitaire.2'], ['mech.hollander.bzk-f3'], { A1: [7, 12, 0], B1: [2, 2, 3] }), () => null, at('move', 'A1', 1)).state
  const longestMasc = (s: GameState): MoveAction => {
    const es = query.reachable(s, 'A1', { masc: true })
    expect(es.length).toBeGreaterThan(0)
    return [...es].sort((x, y) => y.mpUsed - x.mpUsed)[0]!.action
  }

  it('EQUIP-021 MASC is activated before moving: Run MP = walk x 2 (20); the action is a legal answer; walk or jump cannot use it', () => {
    const s = start()
    expect(query.sheet(s, 'A1').mp.run).toBe(15)
    const best = query.reachable(s, 'A1', { masc: true }).reduce((m, e) => Math.max(m, e.mpUsed), 0)
    expect(best).toBeGreaterThan(15)
    expect(best).toBeLessThanOrEqual(20)
    const legal = legalActions(s)
    expect(legal.some((a) => a.type === 'move' && a.masc)).toBe(true)
    const walk: MoveAction = { type: 'move', decisionId: s.pending.id, player: 'A', unitId: 'A1', mode: 'walk', steps: [], facing: 0, masc: true }
    expect(validate(s, walk)?.code).toBe('E_BAD_MODE')
    expect(query.sheet(s, 'A1').equipment?.find((e) => e.kind === 'masc')).toMatchObject({ state: 'ready', avoidTn: 3, mascRun: 20 })
  })

  it('EQUIP-020 avoid numbers 3, 5, 7 on three turns running; an unused turn steps it down one (7 again, not 10)', () => {
    const spy = vi.spyOn(registeredHooks().masc!, 'endPhase')
    let s = start()
    const tns: number[] = []
    const mascTurn = (turn: number): void => {
      force('escalatingFailure', [6, 6])
      const r = play(s, (x) => (at('move', 'A1', turn)(x) ? longestMasc(x) : null), endOfTurn(turn))
      const used = ofType(r.events, 'EquipmentUsed')
      expect(used.map((e) => e.use)).toEqual(['masc'])
      tns.push(used[0]!.amount)
      if (turn === 1) expect(ofType(r.events, 'MoveStarted').find((e) => e.unitId === 'A1')!.mp).toBe(20)
      s = r.state
    }
    mascTurn(1)
    for (const t of [2, 3]) {
      s = play(s, () => null, at('move', 'A1', t)).state
      mascTurn(t)
    }
    expect(s.units.A1!.escalating['masc-ct']).toEqual({ step: 3, usedThisTurn: false })
    s = play(s, () => null, endOfTurn(4)).state // turn 4: stands still, the End Phase steps the number down
    expect(s.units.A1!.escalating['masc-ct']).toEqual({ step: 2, usedThisTurn: false })
    s = play(s, () => null, at('move', 'A1', 5)).state
    mascTurn(5)
    expect(tns).toEqual([3, 5, 7, 7])
    expect(spy).toHaveBeenCalled()
  })

  it('EQUIP-021 a failed roll wrecks the MASC, makes one crit check on a random leg, and stops the move at normal Run MP', () => {
    const s = start()
    const best = [...query.reachable(s, 'A1', { masc: true })].sort((x, y) => y.mpUsed - x.mpUsed)[0]!
    const act = best.action
    const planned = best.mpUsed
    expect(planned).toBeGreaterThan(15)
    const spy = vi.spyOn(registeredHooks().masc!, 'movement')
    force('escalatingFailure', [1, 1]) // 2 < 3: fails
    force('tieBreak', [5]) // right leg
    force('critCheck', [2, 2]) // 4: no crit
    const r = step(s, stamp(s, act))
    expect(r.rejection).toBeUndefined()
    expect(spy.mock.calls.some(([ctx]) => ctx.params?.query === 'activate')).toBe(true)
    expect(ofType(r.events, 'EquipmentUsed')).toMatchObject([{ use: 'mascFailed', amount: 3 }])
    expect(ofType(r.events, 'CritCheckRolled')).toMatchObject([{ unitId: 'A1', location: 'RL', why: 'masc' }])
    expect(ofType(r.events, 'MoveTruncated').length).toBe(1)
    const u = r.state.units.A1!
    expect(u.mounts['masc-ct']!.destroyed).toBe(true)
    expect(u.move.mpSpent).toBeLessThanOrEqual(15)
    expect(query.reachable(r.state, 'A1', { masc: true })).toEqual([])
  })
})

// ---------------------------------------------------------------- Ultra AC
describe('Ultra AC rapid fire (ultraRapid)', () => {
  const start = (): GameState => play(arena(['mech.vulture-mk-iv.a'], ['mech.hollander.bzk-f3'], { A1: [5, 8, 0], B1: [5, 4, 3] }), () => null, at('declareFire', 'A1', 1)).state

  it('EQUIP-011 two shots: double heat and ammo, a 2-shot cluster roll; a natural 2 never jams it', () => {
    const spy = vi.spyOn(registeredHooks().ultraRapid!, 'attackRolled')
    force('toHit', [1, 1])
    const t1 = play(start(), (x) => (at('declareFire', 'A1', 1)(x) ? fire(x, 'A1', { shots: [{ mountId: 'uac10-la', targetId: 'B1', rapidShots: 2 }] }) : null), endOfTurn(1))
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy.mock.calls[0]![0]).toMatchObject({ roll: { total: 2 }, params: { rapidShots: 2 } })
    expect(t1.state.units.A1!.mounts['uac10-la']!.jammed).toBe(false)
    expect(ofType(t1.events, 'WeaponJamChanged')).toEqual([])
    expect(ofType(t1.events, 'AmmoSpent').find((e) => e.unitId === 'A1')!.shots).toBe(2)
    expect(ofType(t1.events, 'HeatAdded').find((e) => e.unitId === 'A1' && e.entry.source === 'weapon')!.entry.amount).toBe(6)
    force('toHit', [6, 6])
    force('cluster', [6, 6])
    const t2 = play(t1.state, (x) => (at('declareFire', 'A1', 2)(x) ? fire(x, 'A1', { shots: [{ mountId: 'uac10-la', targetId: 'B1', rapidShots: 2 }] }) : null), endOfTurn(2))
    expect(ofType(t2.events, 'ClusterResolved')).toMatchObject([{ rackSize: 2, hits: 2 }])
  })
})

// ---------------------------------------------------------------- rotary AC (fixture weapon)
describe('rotary AC (racJam)', () => {
  const RAC = 'test.w.rotary-ac-10'
  /** The real bundle with the Vulture A's Ultra AC/10 swapped for a fixture rotary AC (modes 1/2/4/6, jamHook racJam). */
  function racBundle(): DataBundle {
    const b = structuredClone(bundle) as DataBundle
    const uac = b.weapons['cl.w.ultra-ac-10'] as unknown as Record<string, unknown>
    const rac = { ...uac, id: RAC, name: 'Rotary AC/10 (test)', rapidFire: { modes: [1, 2, 4, 6], jamHook: 'racJam' } }
    delete (rac as { code?: unknown }).code
    b.weapons[RAC] = rac as never
    b.byId[RAC] = rac as never
    const mech = structuredClone(b.mechs['mech.vulture-mk-iv.a']) as unknown as { mounts: { id: string; item: string }[] }
    mech.mounts = mech.mounts.map((m) => (m.id === 'uac10-la' ? { ...m, item: RAC } : m))
    b.mechs['mech.vulture-mk-iv.a'] = mech as never
    b.byId['mech.vulture-mk-iv.a'] = mech as never
    return { ...b, version: `${bundle.version}+rac` }
  }

  it('EQUIP-022 a low natural roll at 2+ shots jams it (6 shots: 4 or less); the Movement Phase unjam roll clears it and the unit still fires', () => {
    const s = play(arena(['mech.vulture-mk-iv.a'], ['mech.hollander.bzk-f3'], { A1: [5, 8, 0], B1: [5, 4, 3] }, racBundle()), () => null, at('declareFire', 'A1', 1)).state
    const spy = vi.spyOn(registeredHooks().racJam!, 'attackRolled')
    force('toHit', [2, 2])
    force('cluster', [3, 3])
    const t1 = play(s, (x) => (at('declareFire', 'A1', 1)(x) ? fire(x, 'A1', { shots: [{ mountId: 'uac10-la', targetId: 'B1', rapidShots: 6 }] }) : null), endOfTurn(1))
    expect(spy).toHaveBeenCalledTimes(1)
    expect(ofType(t1.events, 'WeaponJamChanged')).toEqual([{ type: 'WeaponJamChanged', unitId: 'A1', mountId: 'uac10-la', jammed: true }])
    expect(t1.state.units.A1!.mounts['uac10-la']!.jammed).toBe(true)
    expect(query.sheet(t1.state, 'A1').equipment?.find((e) => e.mountId === 'uac10-la')?.state).toBe('jammed')
    // turn 2: the unjam roll (gunnery 4 + 3 = 7) comes as the move starts; the unit moves and fires normally
    force('jam', [4, 3])
    const t2 = play(t1.state, () => null, at('declareFire', 'A1', 2))
    expect(ofType(t2.events, 'DiceRolled').filter((e) => e.purpose === 'jam')).toMatchObject([{ target: 7, success: true }])
    expect(ofType(t2.events, 'WeaponJamChanged')).toMatchObject([{ mountId: 'uac10-la', jammed: false }])
    const s2 = t2.state
    expect(validate(s2, fire(s2, 'A1', { shots: [{ mountId: 'uac10-la', targetId: 'B1', rapidShots: 2 }] }))).toBeNull()
    // 2 shots jam only on a 2: a 3 does not
    force('toHit', [1, 2])
    const t3 = play(s2, (x) => (at('declareFire', 'A1', 2)(x) ? fire(x, 'A1', { shots: [{ mountId: 'uac10-la', targetId: 'B1', rapidShots: 2 }] }) : null), endOfTurn(2))
    expect(t3.state.units.A1!.mounts['uac10-la']!.jammed).toBe(false)
  })
})

// ---------------------------------------------------------------- partial wing, Beagle, Guardian ECM
describe('partial wing, Beagle probe, Guardian ECM', () => {
  it('EQUIP-018 the Eris partial wing adds +2 jump MP (5 jets -> 7) and +3 dissipation in the Heat Phase; wing crits trim both', () => {
    const spy = vi.spyOn(registeredHooks().partialWing!, 'heat')
    const s = play(arena(['mech.eris.ers-2n'], ['mech.hollander.bzk-f3'], { A1: [5, 12, 0], B1: [5, 2, 3] }), () => null, at('move', 'A1', 1)).state
    expect(query.sheet(s, 'A1').mp.jump).toBe(7)
    const far = query.reachable(s, 'A1').filter((e) => e.mode === 'jump').reduce((m, e) => Math.max(m, e.hexesMoved), 0)
    expect(far).toBe(7)
    const t1 = play(s, () => null, endOfTurn(1))
    expect(ofType(t1.events, 'HeatApplied').find((e) => e.unitId === 'A1')!.dissipated).toBe(query.sheet(s, 'A1').sinks.dissipation)
    expect(query.sheet(s, 'A1').sinks.dissipationParts).toMatchObject({ hooks: 3 })
    expect(spy).toHaveBeenCalled()
    const u = t1.state.units.A1!
    const hurt = { ...t1.state, units: { ...t1.state.units, A1: { ...u, mounts: { ...u.mounts, 'wing-lt': { ...u.mounts['wing-lt']!, critHits: 1 } } } } }
    expect(query.sheet(hurt, 'A1').mp.jump).toBe(6)
  })

  it('EQUIP-023 Beagle active probe: its setup hook runs at game start and changes nothing (no release-1 probe rules)', () => {
    const spy = vi.spyOn(registeredHooks().beagleProbe!, 'setup')
    const s = arena(['mech.uziel.uzl-2s'], ['mech.hollander.bzk-f3'], { A1: [5, 8, 0], B1: [5, 4, 3] })
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy.mock.results[0]!.value).toMatchObject({ events: [] })
    expect(s.units.A1!.mounts.probe).toBeDefined()
  })

  it('EQUIP-015 guardianEcm: an Artemis LRM fired at an ECM carrier rolls its cluster without the +2', () => {
    const spy = vi.spyOn(registeredHooks().guardianEcm!, 'cluster')
    const s = play(arena(['mech.rakshasa.mdg-1b'], ['mech.uziel.uzl-8s'], { A1: [5, 9, 0], B1: [5, 2, 3] }), () => null, at('declareFire', 'A1', 1)).state
    force('toHit', [6, 6])
    force('cluster', [4, 4])
    const t1 = play(s, (x) => (at('declareFire', 'A1', 1)(x) ? fire(x, 'A1', { shots: [{ mountId: 'lrm-lt', targetId: 'B1' }] }) : null), endOfTurn(1))
    expect(spy).toHaveBeenCalled()
    expect(spy.mock.results.some((r) => r.value === -2)).toBe(true)
    expect(ofType(t1.events, 'ClusterResolved')).toMatchObject([{ rackSize: 10, roll: 8, modified: 8 }])
  })
})

describe('every equipment hook named in data is registered, wired and reached', () => {
  it('HOOK-003 each hook named by data has only points the core calls (HOOK_WIRING)', async () => {
    const { HOOK_WIRING } = await import('../../src/engine/hooks')
    const named = new Set<string>()
    for (const group of [bundle.weapons, bundle.ammo, bundle.equipment] as Record<string, { code?: string[]; rapidFire?: { jamHook?: string } }>[]) {
      for (const r of Object.values(group)) for (const c of [...(r.code ?? []), ...(r.rapidFire?.jamHook ? [r.rapidFire.jamHook] : [])]) named.add(c)
    }
    for (const n of ['ppcCapacitor', 'coolantPod', 'masc', 'partialWing', 'beagleProbe', 'guardianEcm', 'ultraRapid', 'caseIIProtect']) expect(named.has(n), n).toBe(true)
    for (const n of named) for (const p of registeredHooks()[n]!.points) expect(HOOK_WIRING[p], `${n}.${p}`).toBeTruthy()
  })
})
