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

import { applyDamage, explodeBin, resolveAttack } from '../../src/engine/damage'
import type { DamageInstance } from '../../src/engine/damage'
import type { GameEvent } from '../../src/engine/events'
import type { RangedDeclaration } from '../../src/engine/types'
import { BUNDLE, mkState, mkUnit } from './damage.fixture'

const dmg = (over: Partial<DamageInstance> & Pick<DamageInstance, 'location' | 'amount'>): DamageInstance => ({
  unitId: 'B1', side: 'front', source: 'weapon', ...over,
})
const of = <T extends GameEvent['type']>(evs: GameEvent[], t: T): Extract<GameEvent, { type: T }>[] =>
  evs.filter((e) => e.type === t) as Extract<GameEvent, { type: T }>[]

describe('damage pipeline (00 §6, 10 §10)', () => {
  it('DMG-001 a unit has 8 locations; torsos carry front and rear armor', () => {
    const u = mkUnit('B1', 'B')
    expect(Object.keys(u.locs)).toHaveLength(8)
    expect(u.locs.CT.rear).toBe(8)
    expect(u.locs.LA.rear).toBeNull()
  })

  it('DMG-002 armor absorbs first, the rest hits structure and triggers one crit check', () => {
    q.faces.push(3, 3) // crit check 6: nothing
    const s = mkState([mkUnit('B1', 'B', { armor: { LA: 4 }, structure: { LA: 11 } })])
    const r = applyDamage(s, dmg({ location: 'LA', amount: 5 }), BUNDLE)
    const la = r.state.units.B1!.locs.LA
    expect([la.armor, la.structure]).toEqual([0, 10])
    const d = of(r.events, 'DamageApplied')[0]!
    expect(d).toMatchObject({ armorBefore: 4, armorAfter: 0, structureBefore: 11, structureAfter: 10, location: 'LA', side: 'front' }) // DMG-022
    expect(of(r.events, 'CritCheckRolled')).toHaveLength(1)
    expect(s.units.B1!.locs.LA.armor).toBe(4) // input untouched
  })

  it('DMG-003 / DMG-005 excess transfers inward in the same hit; later hits on the destroyed arm transfer in full', () => {
    const s = mkState([mkUnit('B1', 'B', { armor: { LA: 0 }, structure: { LA: 5 } })])
    const r = applyDamage(s, dmg({ location: 'LA', amount: 10 }), BUNDLE)
    const u = r.state.units.B1!
    expect(u.locs.LA.destroyed).toBe(true)
    expect(u.locs.LT.armor).toBe(9)
    expect(of(r.events, 'DamageApplied')[0]).toMatchObject({ transferredTo: 'LT', transferred: 5 })
    expect(of(r.events, 'LocationDestroyed')[0]).toMatchObject({ location: 'LA', cause: 'damage' })
    const r2 = applyDamage(r.state, dmg({ location: 'LA', amount: 4 }), BUNDLE)
    expect(r2.state.units.B1!.locs.LT.armor).toBe(5)
    expect(of(r2.events, 'DamageApplied')[0]).toMatchObject({ location: 'LA', transferredTo: 'LT', transferred: 4 })
  })

  it('DMG-006 a rear hit transferring from a destroyed leg hits the torso rear armor', () => {
    const u = mkUnit('B1', 'B')
    u.locs.LL.destroyed = true; u.locs.LL.structure = 0; u.locs.LL.armor = 0
    const r = applyDamage(mkState([u]), dmg({ location: 'LL', amount: 4, side: 'rear' }), BUNDLE)
    expect(r.state.units.B1!.locs.LT.rear).toBe(2)
    expect(r.state.units.B1!.locs.LT.armor).toBe(14)
  })

  it('DMG-005 excess from the centre torso is lost and the unit is destroyed', () => {
    const s = mkState([mkUnit('B1', 'B', { armor: { CT: 2 }, structure: { CT: 3 } })])
    const r = applyDamage(s, dmg({ location: 'CT', amount: 9 }), BUNDLE)
    expect(of(r.events, 'DamageApplied')[0]).toMatchObject({ transferredTo: null, lost: 4 })
    const u = r.state.units.B1!
    expect(u.status).toBe('destroyed')
    expect(u.destroyedCause).toBe('ctDestroyed')
  })

  it('DMG-010 / DMG-011 a destroyed side torso loses its rear armor to the tally and takes the arm with it', () => {
    const s = mkState([mkUnit('B1', 'B', { armor: { RT: 0 }, structure: { RT: 3 } })])
    const r = applyDamage(s, dmg({ location: 'RT', amount: 5 }), BUNDLE)
    const u = r.state.units.B1!
    expect(u.locs.RT.destroyed && u.locs.RA.destroyed).toBe(true)
    expect(of(r.events, 'LocationDestroyed').map((e) => e.cause)).toEqual(['damage', 'sideTorso'])
    // 3 structure + 6 rear armor + 2 transferred to CT armor; the arm adds nothing
    expect(r.state.ledger.damage.B1).toBe(11)
    expect(u.locs.CT.armor).toBe(18)
  })

  it('DMG-012 a destroyed head kills the pilot and the unit; a destroyed leg queues an automatic fall', () => {
    const h = applyDamage(mkState([mkUnit('B1', 'B')]), dmg({ location: 'HD', amount: 12 }), BUNDLE)
    expect(h.state.units.B1!.pilot.dead).toBe(true)
    expect(h.state.units.B1!.destroyedCause).toBe('headDestroyed')
    expect(of(h.events, 'PilotHit')[0]).toMatchObject({ cause: 'head' })
    const leg = applyDamage(mkState([mkUnit('B1', 'B', { armor: { LL: 0 }, structure: { LL: 2 } })]), dmg({ location: 'LL', amount: 3 }), BUNDLE)
    expect(of(leg.events, 'PsrQueued')[0]).toMatchObject({ reason: 'legDestroyed', auto: true })
  })

  it('DMG-020 inside a simultaneous window destruction is booked, not applied', () => {
    const s = { ...mkState([mkUnit('B1', 'B')]), damageWindow: 'simultaneous' as const }
    const r = applyDamage(s, dmg({ location: 'CT', amount: 60 }), BUNDLE)
    const u = r.state.units.B1!
    expect(u.status).toBe('active')
    expect(u.doomed).toBe('ctDestroyed')
    expect(of(r.events, 'UnitDestroyed')[0]).toMatchObject({ effective: false })
  })

  it('PSR-015 crossing 20 points of damage in a phase queues one damage20 PSR', () => {
    q.faces.push(3, 3, 3, 3) // two LL crit checks (structure damaged both times)
    const s = mkState([mkUnit('B1', 'B', { armor: { LL: 14 } })])
    const r1 = applyDamage(s, dmg({ location: 'LL', amount: 16 }), BUNDLE)
    expect(of(r1.events, 'PsrQueued')).toHaveLength(0)
    const r2 = applyDamage(r1.state, dmg({ location: 'LL', amount: 5 }), BUNDLE)
    expect(of(r2.events, 'PsrQueued').map((e) => e.reason)).toEqual(['damage20'])
    const r3 = applyDamage(r2.state, dmg({ location: 'RL', amount: 2 }), BUNDLE)
    expect(of(r3.events, 'PsrQueued')).toHaveLength(0)
    expect(r3.state.psr.queue).toHaveLength(1)
  })
})

const decl = (over: Partial<RangedDeclaration> = {}): RangedDeclaration => ({
  kind: 'ranged', attackId: 'a:1', attackerId: 'A1', mountId: 'm1', targetId: 'B1', targetHex: { q: 1, r: 0 }, binId: null, ammoId: null,
  rapidShots: null, aimedAt: null, primary: true, tn: 4, mods: [{ code: 'gunnery', value: 4 }], distance: 3, band: 'short', direction: 'front',
  table: 'standard', partialCover: false, ...over,
})
const duel = (mount: string, extra = {}) => mkState([
  mkUnit('A1', 'A', { mounts: [{ id: 'm1', item: mount, location: 'RA' }], ...extra }),
  mkUnit('B1', 'B'),
])

describe('attack resolution', () => {
  it('TOHIT-001 / HITLOC-004 a to-hit roll, a location roll and a TAC crit check on a natural 2', () => {
    q.faces.push(3, 3, 1, 1, 3, 3) // hit (6 vs 4), location 2 = CT TAC, crit check 6
    const r = resolveAttack(duel('w.mlaser'), decl(), { data: BUNDLE })
    expect(r.hit).toBe(true)
    expect(r.damageDealt).toBe(5)
    expect(r.state.units.B1!.locs.CT.armor).toBe(15)
    expect(of(r.events, 'HitLocated')[0]).toMatchObject({ location: 'CT', tac: true })
    expect(of(r.events, 'CritCheckRolled')[0]).toMatchObject({ location: 'CT', why: 'tac' })
    expect(r.state.current).toBeNull()
  })

  it('TOHIT-002 TN 2 hits automatically with no dice; TN 13 cannot hit', () => {
    q.faces.push(3, 4) // only the location roll: CT
    const hit = resolveAttack(duel('w.mlaser'), decl({ tn: 2 }), { data: BUNDLE })
    expect(of(hit.events, 'AttackRolled')[0]).toMatchObject({ auto: 'hit', roll: null, hit: true })
    const miss = resolveAttack(duel('w.mlaser'), decl({ tn: 13 }), { data: BUNDLE })
    expect(of(miss.events, 'AttackRolled')[0]).toMatchObject({ auto: 'miss', hit: false })
  })

  it('CLUS-003 an LRM 20 with 12 hits resolves groups of 5, 5 and 2, each at its own location', () => {
    q.faces.push(4, 4, 4, 4, 3, 4, 4, 3, 5, 3) // to-hit 8; cluster 8 -> 12; locations 7 (CT), 7, 8 (LT)
    const s = duel('w.lrm20')
    const r = resolveAttack(s, decl({ tn: 6, band: 'medium' }), { data: BUNDLE })
    expect(of(r.events, 'ClusterResolved')[0]).toMatchObject({ rackSize: 20, hits: 12, groups: [5, 5, 2] })
    const locs = of(r.events, 'HitLocated').map((e) => [e.location, e.damage])
    expect(locs).toEqual([['CT', 5], ['CT', 5], ['LT', 2]])
    expect(r.state.units.B1!.locs.CT.armor).toBe(10)
    expect(r.state.units.B1!.locs.LT.armor).toBe(12)
  })

  it('CLUS-005 Streak SRM: a miss spends no ammo, a hit spends one and rolls no cluster', () => {
    const s = mkState([
      mkUnit('A1', 'A', { mounts: [{ id: 'm1', item: 'w.streak2', location: 'RA' }], bins: [{ id: 'b1', ammo: 'a.srm6', location: 'RT', shots: 10 }] }),
      mkUnit('B1', 'B'),
    ])
    q.faces.push(1, 1)
    const miss = resolveAttack(s, decl({ binId: 'b1' }), { data: BUNDLE })
    expect(miss.hit).toBe(false)
    expect(miss.state.units.A1!.bins.b1!.shots).toBe(10)
    q.faces.push(6, 6, 3, 4, 3, 4) // hit; two locations (CT, CT)
    const hit = resolveAttack(s, decl({ binId: 'b1' }), { data: BUNDLE })
    expect(hit.streakHit).toBe(true)
    expect(hit.state.units.A1!.bins.b1!.shots).toBe(9)
    expect(of(hit.events, 'DiceRolled').some((e) => e.purpose === 'cluster')).toBe(false)
    expect(of(hit.events, 'ClusterResolved')[0]).toMatchObject({ hits: 2, groups: [2, 2] })
  })

  it('HITLOC-008 an attack on a prone unit uses the standard table even for a punch table', () => {
    q.faces.push(3, 3, 3, 4) // hit; 2d6 = 7 -> CT (a punch d6 would have taken one die)
    const s = mkState([mkUnit('A1', 'A', { mounts: [{ id: 'm1', item: 'w.mlaser', location: 'RA' }] }), mkUnit('B1', 'B', { prone: true })])
    const r = resolveAttack(s, decl({ table: 'punch' }), { data: BUNDLE })
    expect(of(r.events, 'HitLocated')[0]).toMatchObject({ table: 'standard', location: 'CT' })
  })
})

describe('review fixes', () => {
  it('TOHIT-036 aimed shot under partial cover: a missed aim re-rolls a leg result, no cover absorption', () => {
    // hit, aim 2 (miss), location 9 = LL (reroll), location 7 = CT
    q.faces.push(4, 4, 2, 4, 5, 3, 4)
    const r = resolveAttack(duel('w.mlaser'), decl({ aimedAt: 'LA', partialCover: true }), { data: BUNDLE })
    expect(of(r.events, 'HitAbsorbedByCover')).toHaveLength(0)
    expect(of(r.events, 'HitLocated').at(-1)).toMatchObject({ location: 'CT' })
    expect(r.damageDealt).toBe(5)
  })

  it('AMMO-011 / AMMO-012 explosion in an arm bin stops in a CASE torso; CASE II applies to entered location', () => {
    const base = { armor: { LA: 0 }, structure: { LA: 2 }, bins: [{ id: 'b1', ammo: 'a.srm6', location: 'LA' as const, shots: 1 }] }
    q.faces.push(3, 3)
    const a = explodeBin(mkState([mkUnit('B1', 'B', { ...base, mounts: [{ id: 'c', item: 'e.case', location: 'LT' }] })]), 'B1', 'b1', 'heat', BUNDLE)
    expect(a.state.units.B1!.locs.CT.structure).toBe(16)
    expect(a.state.units.B1!.locs.LT.structure).toBe(12 - 10)
    q.faces.push(3, 3)
    const b = explodeBin(mkState([mkUnit('B1', 'B', { ...base, mounts: [{ id: 'c', item: 'e.caseii', location: 'LT' }] })]), 'B1', 'b1', 'heat', BUNDLE)
    expect(b.state.units.B1!.locs.LT.structure).toBe(11)
    expect(b.state.units.B1!.locs.CT.structure).toBe(16)
  })

  it('CRIT-095 two cluster groups on one leg each cost their own PSR', () => {
    q.faces.push(4, 4, 1, 2, 4, 5, 4, 4, 1, 4, 5, 4, 4, 2) // hit; cluster 3 -> 6 hits (5+1); LL crit hip; LL crit upper leg
    const st = mkState([mkUnit('A1', 'A', { mounts: [{ id: 'm1', item: 'w.lrm20', location: 'RA' }] }), mkUnit('B1', 'B', { armor: { LL: 0 } })])
    const r = resolveAttack(st, decl({ tn: 6, band: 'medium' }), { data: BUNDLE })
    expect(of(r.events, 'CritSlotHit').map((e) => e.token)).toEqual(['hip', 'upperLeg'])
    expect(of(r.events, 'PsrQueued')).toHaveLength(2)
  })
})
