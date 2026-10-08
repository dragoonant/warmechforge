// Preview expectations vs the real damage pipeline (M8): query.attackPreview / firePreview / physicalPreview must expect what
// resolveAttack / resolvePhysical land, ferro-lamellor (EQUIP-014) included. Monte Carlo over 2000 forced seeds per case.
import { describe, expect, it } from 'vitest'
import { loadBundle } from '../../src/data/index'
import { resolveAttack } from '../../src/engine/damage'
import type { GameEvent } from '../../src/engine/events'
import { createGame, query } from '../../src/engine/index'
import { declareFire } from '../../src/engine/phases/ranged'
import { resolvePhysical } from '../../src/engine/phases/physical'
import { directionFor } from '../../src/engine/physical'
import { seedRng } from '../../src/engine/rng'
import type { FireShot } from '../../src/engine/actions'
import type { GameSetup, GameState, Hex, Loc, PhysicalDeclaration, RangedDeclaration, UnitId } from '../../src/engine/types'

const bundle = loadBundle()
const TRIALS = 2000

function arena(a: string, b: string, at: Record<UnitId, [number, number, number]>, immobile = true): GameState {
  const side = (id: string, mech: string) => ({ sideId: id, control: 'ai' as const, force: { id: `force.t-${id}`, name: id, units: [{ mech }] } })
  const setup: GameSetup = { missionId: 'mission.skirmish', mapId: 'map.test-canyons', sides: [side('a', a), side('b', b)], forcedWithdrawal: false, turnLimit: null, bvBudget: null }
  const r = createGame(setup, 'm8-expect', bundle)
  if (r.rejection) throw new Error(r.rejection.message)
  let s = r.state
  const hexes = Object.fromEntries(Object.entries(s.board.hexes).map(([k, h]) => [k, { ...h, level: 0, woods: 'none' as const, depth: 0, rough: false, rubble: false }]))
  s = { ...s, board: { ...s.board, hexes } }
  const units = { ...s.units }
  for (const [id, [q, r2, f]] of Object.entries(at)) {
    const u = units[id]!
    units[id] = { ...u, pos: { q, r: r2 } as Hex, facing: f as 0, status: 'active', move: { ...u.move, mode: null, tmm: 0, jumped: false } }
  }
  // an immobile target is hit on a TN of 2 or less, so the trials measure locations and clusters, not to-hit luck
  return { ...s, units, ledger: { ...s.ledger, immobileAtStart: immobile ? ['B1'] : [] } }
}

/** Damage the pipeline landed on `unit` from weapons / physical attacks: sum of DamageApplied (damage - transferred). */
function landed(evs: GameEvent[], unit: UnitId): number {
  let n = 0
  for (const e of evs) if (e.type === 'DamageApplied' && e.unitId === unit && (e.source === 'weapon' || e.source === 'physical')) n += e.damage - e.transferred
  return n
}

function strip(s: GameState, id: UnitId, patch: Partial<Record<Loc, { armor?: number; rear?: number; structure?: number; destroyed?: boolean }>>): GameState {
  const u = s.units[id]!
  const locs = { ...u.locs }
  for (const [l, p] of Object.entries(patch) as [Loc, NonNullable<(typeof patch)[Loc]>][]) locs[l] = { ...locs[l], ...p }
  return { ...s, units: { ...s.units, [id]: { ...u, locs } } }
}

/** Mean landed damage of one declared ranged shot over TRIALS seeds, and the preview's expectation for it. */
function rangedCase(s: GameState, shot: FireShot): { mc: number; pv: number; pvMeta: ReturnType<typeof query.attackPreview> } {
  const r = declareFire(s, bundle, { type: 'declareFire', decisionId: 'd', player: 'A', unitId: 'A1', shots: [shot] })
  if (r.rejection) throw new Error(r.rejection.message)
  const d = r.state.declarations[0] as RangedDeclaration
  let sum = 0
  for (let i = 0; i < TRIALS; i++) sum += landed(resolveAttack({ ...r.state, rng: seedRng(`mc-${i}`) }, d, { data: bundle }).events, 'B1')
  const fp = query.firePreview(s, 'A1', { shots: [{ ...shot, targetId: 'B1' }] })
  const pv = query.attackPreview(s, { attackerId: 'A1', mountId: shot.mountId, targetId: 'B1', ...(shot.binId ? { binId: shot.binId } : {}), ...(shot.aimedAt ? { aimedAt: shot.aimedAt } : {}), ...(shot.rapidShots ? { rapidShots: shot.rapidShots } : {}) })
  expect(fp.weapons[0]!.expectedDamage).toBeCloseTo(pv.expectedDamage, 9) // firePreview is attackPreview per shot
  return { mc: sum / TRIALS, pv: pv.expectedDamage, pvMeta: pv }
}

const within3 = (mc: number, pv: number): void => { expect(Math.abs(mc - pv)).toBeLessThanOrEqual(0.03 * pv + 1e-9) }

describe('preview expectations match the damage pipeline (Monte Carlo, 2000 seeds)', () => {
  const VULTURE = 'mech.vulture-mk-iv.prime'

  it('EQUIP-014 ferro-lamellor: single hits, SRM 2-point missiles, MG and LRM 5-point groups expect what lands', () => {
    // Uziel 2S: PPC (10 -> 8), MG (2 -> 1), SRM-6 (2-point missiles -> 1 each while the armor stands)
    const s = arena('mech.uziel.uzl-2s', VULTURE, { A1: [5, 8, 0], B1: [5, 5, 3] })
    for (const shot of [{ mountId: 'ppc-la', targetId: 'B1' }, { mountId: 'mg-lt', targetId: 'B1' }, { mountId: 'srm6', targetId: 'B1' }]) {
      const c = rangedCase(s, shot)
      expect(c.pvMeta.armorReduction).toBe('ferroLamellor')
      expect(c.pvMeta.pHit).toBeGreaterThan(0.9)
      within3(c.mc, c.pv)
    }
    const ppc = query.attackPreview(s, { attackerId: 'A1', mountId: 'ppc-la', targetId: 'B1' })
    expect(ppc.expectedDamage).toBeCloseTo(8, 9) // every location still has armor: floor(4/5 x 10)
    expect(ppc.expectedStopped).toBeCloseTo(2, 9)
    const srm = query.attackPreview(s, { attackerId: 'A1', mountId: 'srm6', targetId: 'B1' })
    expect(srm.expectedDamage).toBeCloseTo(srm.cluster!.expectedHits * 1, 9) // each 2-point missile lands as 1
    // Rakshasa 1A LRM-10 + Artemis at 7 hexes: 5-point groups land as 4
    const l = arena('mech.rakshasa.mdg-1a', VULTURE, { A1: [5, 12, 0], B1: [5, 5, 3] })
    const lrm = rangedCase(l, { mountId: 'lrm-lt', targetId: 'B1' })
    within3(lrm.mc, lrm.pv)
  })

  it('EQUIP-014 ferro-lamellor: LB-X pellets, Streak, Ultra double tap, rear arc, aimed shot and stripped / destroyed locations', () => {
    // Regent Prime: LB 20-X cluster (1-point pellets, all stopped while armor stands) and slug, Streak SRM-4
    let s = arena('mech.regent.prime', VULTURE, { A1: [5, 8, 0], B1: [5, 5, 3] })
    // strip some armor: LL bare, LT nearly bare, RA gone (its hits move to RT), CT rear bare. (Not LA: its LB-5X ammo can
    // explode on a pellet's crit mid-volley, a crit chain the single-state preview does not model.)
    s = strip(s, 'B1', { LL: { armor: 0 }, LT: { armor: 2 }, RA: { armor: 0, structure: 0, destroyed: true }, CT: { rear: 0 } })
    for (const shot of [
      { mountId: 'lb20-rt', targetId: 'B1', binId: 'ammo-lb20-clu-lt' }, { mountId: 'lb20-rt', targetId: 'B1', binId: 'ammo-lb20-slug-lt' },
      { mountId: 'ssrm4-lt', targetId: 'B1' }, { mountId: 'erll-ra', targetId: 'B1', aimedAt: 'LT' as Loc },
    ]) {
      const c = rangedCase(s, shot)
      within3(c.mc, c.pv)
    }
    // from behind: torso hits strike the rear armor (CT rear is bare, so those land in full)
    const rear = strip(arena('mech.regent.prime', VULTURE, { A1: [5, 8, 0], B1: [5, 5, 0] }), 'B1', { CT: { rear: 0 }, LA: { armor: 0 } })
    const r = rangedCase(rear, { mountId: 'erll-ra', targetId: 'B1' })
    expect(r.pvMeta.direction).toBe('rear')
    within3(r.mc, r.pv)
    // Vulture A's Ultra AC/10 double tap into another Vulture: 10-point hits land as 8
    const u = arena('mech.vulture-mk-iv.a', VULTURE, { A1: [5, 8, 0], B1: [5, 5, 3] })
    const uac = rangedCase(u, { mountId: 'uac10-la', targetId: 'B1', rapidShots: 2 })
    within3(uac.mc, uac.pv)
  })

  it('plain armor: the preview is unchanged (no reduction) and still matches the pipeline', () => {
    const s = arena('mech.rakshasa.mdg-1a', 'mech.regent.prime', { A1: [5, 12, 0], B1: [5, 5, 3] })
    const c = rangedCase(s, { mountId: 'lrm-lt', targetId: 'B1' })
    expect(c.pvMeta.armorReduction).toBeUndefined()
    expect(c.pv).toBeCloseTo(c.pvMeta.pHit * c.pvMeta.cluster!.expectedHits * c.pvMeta.damage, 9)
    within3(c.mc, c.pv)
  })

  it('EQUIP-014 physicalPreview expects ferro-lamellor on kicks, punches and charges (groups of 5)', () => {
    const run = (s: GameState, kind: 'kick' | 'punch' | 'charge', limb: 'LL' | 'RA' | null): void => {
      const pv = query.physicalPreview(s, { attackerId: 'A1', kind, targetId: 'B1', ...(limb ? { limb } : {}) })
      expect(pv.legal).toBe(true)
      expect(pv.armorReduction).toBe('ferroLamellor')
      const direction = directionFor(s, 'A1', 'B1', s.units.A1!.pos!).direction
      const decl: PhysicalDeclaration = { kind, attackId: 'a:1', attackerId: 'A1', targetId: 'B1', limb, tn: pv.tn, mods: pv.mods, direction, table: pv.table }
      const base: GameState = { ...s, declarations: [decl] }
      let sum = 0
      for (let i = 0; i < TRIALS; i++) sum += landed(resolvePhysical({ ...base, rng: seedRng(`mc-${i}`) }, bundle).events, 'B1')
      within3(sum / TRIALS, pv.expectedDamage!)
      expect(pv.expectedDamage!).toBeLessThan(pv.pHit * pv.damage)
    }
    // adjacent, B1 to the north facing south (front); some armor stripped so the kick table mixes reduced and full hits
    const s = strip(arena('mech.uziel.uzl-2s', VULTURE, { A1: [5, 6, 0], B1: [5, 5, 3] }), 'B1', { LL: { armor: 1 } })
    run(s, 'kick', 'LL')
    run(s, 'punch', 'RA')
    const c0 = arena('mech.uziel.uzl-2s', VULTURE, { A1: [5, 6, 0], B1: [5, 5, 3] })
    const c = { ...c0, units: { ...c0.units, A1: { ...c0.units.A1!, move: { ...c0.units.A1!.move, mode: 'run' as const, hexesMoved: 5 } } } }
    run(c, 'charge', null)
  })
})
