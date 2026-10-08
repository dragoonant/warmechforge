// Constructed positions (AI-011, AI-007, AI-008): a real intro state, flattened, with units placed by hand.
import { describe, expect, it } from 'vitest'
import type { Action, GameState, Loc, UnitId } from '../../src/engine/index'
import { legalActions, query, validate, view } from '../../src/engine/index'
import { decideAi, type FireTrace } from '../../src/ai/decider'
import { flatten, hexOf, patchUnit, place, playUntil } from './helpers'

const LOCS: Loc[] = ['HD', 'CT', 'LT', 'RT', 'LA', 'RA', 'LL', 'RL']

function fireState(seed: string): { s: GameState; me: UnitId; friend: UnitId | null; enemies: UnitId[] } {
  let s = flatten(playUntil(seed, (x) => x.pending.kind === 'declareFire' && x.turn >= 2))
  expect(s.pending.kind).toBe('declareFire')
  const me = s.pending.unitId!
  const side = s.units[me]!.owner
  const enemies = s.unitOrder.filter((id) => s.units[id]!.owner !== side)
  const friend = s.unitOrder.find((id) => id !== me && s.units[id]!.owner === side) ?? null
  // fresh 'Mechs, standard spots: attacker in the middle facing north, enemies three hexes ahead, the friend far away
  for (const id of s.unitOrder) s = patchUnit(s, id, (u) => ({ locs: Object.fromEntries(LOCS.map((l) => [l, { ...u.locs[l], armor: u.locs[l].maxArmor, rear: u.locs[l].maxRear, structure: u.locs[l].maxStructure, destroyed: false, destroyedCause: null }])) as typeof u.locs, slots: Object.fromEntries(LOCS.map((l) => [l, u.locs[l] ? u.slots[l].map((x) => ({ ...x, hit: false, hitPhase: null })) : []])) as typeof u.slots, mounts: Object.fromEntries(Object.entries(u.mounts).map(([k, m]) => [k, { ...m, destroyed: false, critHits: 0 }])), crippled: false, doomed: null }))
  const c = hexOf(s, '0810')
  s = place(s, me, c, 0)
  s = patchUnit(s, me, (u) => ({ move: { ...u.move, mode: 'standStill', attackerMod: 0, done: true } }))
  s = place(s, enemies[0]!, { q: c.q - 1, r: c.r - 2 }, 3)
  s = place(s, enemies[1]!, { q: c.q + 1, r: c.r - 3 }, 3)
  for (const e of enemies) s = patchUnit(s, e, (u) => ({ move: { ...u.move, mode: 'walk', hexesMoved: 3, tmm: 1, jumped: false, done: true } }))
  if (friend) s = place(s, friend, hexOf(s, '0117'), 0)
  s = { ...s, heatLedger: { ...s.heatLedger, [me]: [] }, declarations: [] }
  return { s, me, friend, enemies }
}

const decide = (s: GameState, trace = false) => decideAi(view(s, s.pending.player), s.pending, legalActions(s), { tier: 'normal', trace })

describe('utility AI, constructed positions', () => {
  it('AI-011 prefers the kill shot: fires at the enemy whose centre torso is nearly gone', () => {
    for (const seed of ['kill-1', 'kill-2']) {
      const base = fireState(seed)
      for (const victim of base.enemies) {
        // the victim's CT has no armor and 2 structure left, front and rear; the other enemy is untouched
        const s = patchUnit(base.s, victim, (u) => ({ locs: { ...u.locs, CT: { ...u.locs.CT, armor: 0, rear: 0, structure: 2 } } }))
        const d = decide(s, true)
        expect(validate(s, d.action)).toBeNull()
        const a = d.action as Extract<Action, { type: 'declareFire' }>
        expect(a.type).toBe('declareFire')
        expect(a.shots.length).toBeGreaterThan(0)
        expect(a.shots[0]!.targetId).toBe(victim)
        expect(((d.trace?.top?.[0]) as FireTrace).pKill).toBeGreaterThan(0.2)
      }
    }
  })

  it('AI-007 respects the heat cap: with no kill in sight the planned end-of-turn heat stays at 9 or less', () => {
    for (const seed of ['heat-1', 'heat-2', 'heat-3']) {
      const { s, me } = fireState(seed)
      const d = decide(s, true)
      const a = d.action as Extract<Action, { type: 'declareFire' }>
      const H = query.heatProjection(s, me, { mounts: a.shots.map((x) => x.mountId) }).end
      const info = d.trace?.top?.[0] as FireTrace
      expect(info.pKill).toBeLessThan(0.5)
      expect(H).toBeLessThanOrEqual(9)
      // a heat-free hold is always available, and the AI does fire something here
      expect(a.shots.length).toBeGreaterThan(0)
    }
  })

  it('AI-008 does not turn its rear to an adjacent enemy that has already moved', () => {
    let checked = 0
    for (const seed of ['rear-1', 'rear-2', 'rear-3', 'rear-4']) {
      let s = flatten(playUntil(seed, (x) => x.pending.kind === 'move' && x.turn >= 2 && !!x.units[x.pending.unitId!]!.pos))
      if (s.pending.kind !== 'move') continue
      const me = s.pending.unitId!
      const side = s.units[me]!.owner
      const enemies = s.unitOrder.filter((id) => s.units[id]!.owner !== side)
      const friend = s.unitOrder.find((id) => id !== me && s.units[id]!.owner === side)
      const c = hexOf(s, '0809')
      s = place(s, me, c, 0)
      // the enemy stands right behind us (south), facing us, and has finished its move
      s = place(s, enemies[0]!, { q: c.q, r: c.r + 1 }, 0)
      s = patchUnit(s, enemies[0]!, (u) => ({ move: { ...u.move, mode: 'walk', hexesMoved: 2, tmm: 0, done: true } }))
      s = place(s, enemies[1]!, hexOf(s, '1517'), 0)
      s = patchUnit(s, enemies[1]!, (u) => ({ move: { ...u.move, mode: 'walk', hexesMoved: 2, tmm: 0, done: true } }))
      if (friend) s = place(s, friend, hexOf(s, '0101'), 3)
      s = patchUnit(s, me, (u) => ({ move: { ...u.move, mode: null, done: false, hexesMoved: 0, mpSpent: 0 } }))
      s = { ...s, selection: s.selection ? { ...s.selection, acted: [...s.selection.acted.filter((x) => x !== me), ...enemies] } : s.selection }
      const d = decide(s)
      expect(validate(s, d.action)).toBeNull()
      const mv = d.action as Extract<Action, { type: 'move' }>
      const entry = query.reachable(s, me).find((e) => JSON.stringify(e.action) === JSON.stringify(mv))!
      expect(entry).toBeTruthy()
      const enemy = s.units[enemies[0]!]!
      const mount = Object.keys(enemy.mounts)[0]!
      const dir = query.attackPreview(s, { attackerId: enemies[0]!, mountId: mount, targetId: me, targetAt: { hex: entry.hex, facing: entry.facing } }).direction
      expect(dir).not.toBe('rear')
      checked++
    }
    expect(checked).toBeGreaterThanOrEqual(3)
  })
})
