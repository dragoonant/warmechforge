// The AI damage model reads ferro-lamellor (EQUIP-014) from the corrected previews (M8): its expected damage per volley
// matches the engine preview's expectation, and is well below the uncut figure.
import { describe, expect, it } from 'vitest'
import type { GameSetup, GameState, Hex, Loc, UnitId } from '../../src/engine/index'
import { createGame, query } from '../../src/engine/index'
import { attackFromPreview, volleyValue, type TargetModel } from '../../src/ai/damage'
import { BUNDLE } from './helpers'

const LOCS: Loc[] = ['HD', 'CT', 'LT', 'RT', 'LA', 'RA', 'LL', 'RL']

function arena(a: string, b: string, at: Record<UnitId, [number, number, number]>): GameState {
  const side = (id: string, mech: string) => ({ sideId: id, control: 'ai' as const, force: { id: `force.t-${id}`, name: id, units: [{ mech }] } })
  const setup: GameSetup = { missionId: 'mission.skirmish', mapId: 'map.test-canyons', sides: [side('a', a), side('b', b)], forcedWithdrawal: false, turnLimit: null, bvBudget: null }
  let s = createGame(setup, 'm8-ai-lam', BUNDLE).state
  const hexes = Object.fromEntries(Object.entries(s.board.hexes).map(([k, h]) => [k, { ...h, level: 0, woods: 'none' as const, depth: 0, rough: false, rubble: false }]))
  s = { ...s, board: { ...s.board, hexes } }
  const units = { ...s.units }
  for (const [id, [q, r, f]] of Object.entries(at)) {
    const u = units[id]!
    units[id] = { ...u, pos: { q, r } as Hex, facing: f as 0, status: 'active', move: { ...u.move, mode: null, tmm: 0, jumped: false } }
  }
  return { ...s, units }
}

/** A plain target model of the unit's current armor and structure (no location values: only the damage matters here). */
function model(s: GameState, id: UnitId): TargetModel {
  const u = s.units[id]!
  const locs = Object.fromEntries(LOCS.map((l) => [l, { armorF: u.locs[l].armor, armorR: u.locs[l].rear ?? u.locs[l].armor, structure: u.locs[l].structure, destroyed: u.locs[l].destroyed, ld: 0, crit: 0, kill: l === 'CT' || l === 'HD' }]))
  return { id, m: 1, killValue: 0, prone: u.prone, locs: locs as TargetModel['locs'] }
}

describe('AI damage model with ferro-lamellor', () => {
  it('AI-032 expected volley damage on a Vulture Mk IV matches the preview and is cut by ferro-lamellor', () => {
    const s = arena('mech.uziel.uzl-2s', 'mech.vulture-mk-iv.prime', { A1: [5, 8, 0], B1: [5, 5, 3] })
    // strip one leg's armor so cut and uncut groups mix
    const B = s.units.B1!
    const st = { ...s, units: { ...s.units, B1: { ...B, locs: { ...B.locs, LL: { ...B.locs.LL, armor: 1 } } } } }
    const t = model(st, 'B1')
    for (const [mountId, perGroup] of [['ppc-la', 1], ['srm6', 1], ['mg-lt', 1]] as const) {
      const pv = query.attackPreview(st, { attackerId: 'A1', mountId, targetId: 'B1' })
      expect(pv.legal).toBe(true)
      expect(pv.armorReduction).toBe('ferroLamellor')
      const a = attackFromPreview(pv, perGroup)
      expect(a.lamellor).toBe(true)
      const v = volleyValue(t, pv.direction, [a])
      expect(Math.abs(v.expectedTotal - pv.expectedDamage)).toBeLessThanOrEqual(0.02 * pv.expectedDamage + 1e-9)
      const uncut = volleyValue(t, pv.direction, [{ ...a, lamellor: false }])
      expect(v.expectedTotal).toBeLessThan(0.85 * uncut.expectedTotal)
    }
  })
})
