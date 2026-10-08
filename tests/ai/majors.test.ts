// The two M7 playtest AI majors as constructed positions (M8): (1) no overkill on a helpless target (prone and leg gone, or
// crippled) while turning the back on a live threat; (2) no move into a hex with no shot at anything when a hex with a shot
// was reachable. Real intro states, flattened, units placed by hand; normal tier.
import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { Action, GameState, Hex, Loc, ReachEntry, Twist, UnitId } from '../../src/engine/index'
import { createGame, legalActions, query, step, validate, view } from '../../src/engine/index'
import { loadBundle } from '../../src/data/index'
import { decideAi } from '../../src/ai/decider'
import { flatten, hexOf, patchUnit, place, playUntil } from './helpers'

const LOCS: Loc[] = ['HD', 'CT', 'LT', 'RT', 'LA', 'RA', 'LL', 'RL']

const decide = (s: GameState) => decideAi(view(s, s.pending.player), s.pending, legalActions(s), { tier: 'normal' })

/** A movement decision for one of our units on a flat board, every unit fresh, the others placed by the caller. */
function moveState(seed: string): { s: GameState; me: UnitId; friend: UnitId | null; enemies: UnitId[] } | null {
  let s = flatten(playUntil(seed, (x) => x.pending.kind === 'move' && x.turn >= 2 && !!x.units[x.pending.unitId!]!.pos))
  if (s.pending.kind !== 'move') return null
  const me = s.pending.unitId!
  const side = s.units[me]!.owner
  const enemies = s.unitOrder.filter((id) => s.units[id]!.owner !== side)
  const friend = s.unitOrder.find((id) => id !== me && s.units[id]!.owner === side) ?? null
  for (const id of s.unitOrder) {
    s = patchUnit(s, id, (u) => ({
      locs: Object.fromEntries(LOCS.map((l) => [l, { ...u.locs[l], armor: u.locs[l].maxArmor, rear: u.locs[l].maxRear, structure: u.locs[l].maxStructure, destroyed: false, destroyedCause: null }])) as typeof u.locs,
      slots: Object.fromEntries(LOCS.map((l) => [l, u.slots[l].map((x) => ({ ...x, hit: false, hitPhase: null }))])) as typeof u.slots,
      mounts: Object.fromEntries(Object.entries(u.mounts).map(([k, m]) => [k, { ...m, destroyed: false, critHits: 0 }])),
      bins: Object.fromEntries(Object.entries(u.bins).map(([k, b]) => [k, { ...b, shots: Math.max(b.shots, 1) }])),
      crippled: false, doomed: null, heat: 0, pilot: { ...u.pilot, hits: 0, conscious: true },
    }))
  }
  if (friend) s = place(s, friend, hexOf(s, '0101'), 3)
  return { s, me, friend, enemies }
}

/** Mark units as having moved this turn (they stand where they are with a walk TMM). */
function moved(s: GameState, ids: UnitId[]): GameState {
  for (const id of ids) s = patchUnit(s, id, (u) => ({ move: { ...u.move, mode: 'walk', hexesMoved: 2, tmm: 0, jumped: false, done: true } }))
  return { ...s, selection: s.selection ? { ...s.selection, acted: [...s.selection.acted.filter((x) => !ids.includes(x)), ...ids] } : s.selection }
}

function readyToMove(s: GameState, me: UnitId): GameState {
  return patchUnit(s, me, (u) => ({ move: { ...u.move, mode: null, done: false, hexesMoved: 0, mpSpent: 0 } }))
}

function entryOf(s: GameState, me: UnitId, a: Action): ReachEntry {
  const e = query.reachable(s, me).find((x) => JSON.stringify(x.action) === JSON.stringify(a))
  if (!e) throw new Error('chosen move is not a reachable entry')
  return e
}

/** Does any weapon have a legal shot at any enemy from this end hex (best of the three torso twists)? */
function hasShot(s: GameState, me: UnitId, e: ReachEntry, enemies: UnitId[]): boolean {
  const u = s.units[me]!
  for (const tw of [0, -1, 1] as Twist[]) {
    for (const mountId of Object.keys(u.mounts)) {
      for (const t of enemies) {
        const pv = query.attackPreview(s, { attackerId: me, mountId, targetId: t, attackerAt: { hex: e.hex, facing: e.facing, mode: e.mode, hexesMoved: e.hexesMoved, jumped: e.mode === 'jump', twist: tw } })
        if (pv.legal && pv.pHit > 0) return true
      }
    }
  }
  return false
}

const directionOn = (s: GameState, from: UnitId, me: UnitId, e: ReachEntry): string => {
  const mountId = Object.keys(s.units[from]!.mounts)[0]!
  return query.attackPreview(s, { attackerId: from, mountId, targetId: me, targetAt: { hex: e.hex, facing: e.facing } }).direction
}

describe('M7 AI majors, constructed positions', () => {
  it('AI-029 never ends its move with no shot at anything when a hex with a shot is reachable', () => {
    let checked = 0
    const layouts: { me: string; facing: 0 | 3; e: [string, string] }[] = [
      { me: '0805', facing: 0, e: ['0713', '0914'] }, // both enemies far behind us
      { me: '0809', facing: 0, e: ['0217', '1517'] }, // behind, spread wide
      { me: '0404', facing: 3, e: ['1201', '1302'] }, // off to the side and behind
    ]
    for (const seed of ['shot-1', 'shot-2', 'shot-3']) {
      for (const L of layouts) {
        const base = moveState(seed)
        if (!base) continue
        let { s } = base
        const { me, enemies } = base
        s = place(s, me, hexOf(s, L.me), L.facing)
        s = place(s, enemies[0]!, hexOf(s, L.e[0]), 0)
        s = place(s, enemies[1]!, hexOf(s, L.e[1]), 0)
        s = readyToMove(moved(s, enemies), me)
        const reach = query.reachable(s, me).filter((x) => !x.endsProne && !x.physical)
        if (!reach.some((x) => hasShot(s, me, x, enemies))) continue // nothing reachable shoots: not this test
        const d = decide(s)
        expect(validate(s, d.action)).toBeNull()
        const e = entryOf(s, me, d.action)
        if (e.physical) { checked++; continue } // a charge / DFA is an attack too
        expect(hasShot(s, me, e, enemies), `${seed} ${L.me}: ended at ${JSON.stringify(e.hex)} facing ${e.facing} with no shot`).toBe(true)
        checked++
      }
    }
    expect(checked).toBeGreaterThanOrEqual(6)
  })

  // The two playtest saves (adv8): the AI ran to a hiding hex and held fire although 83 of 145 / 231 of 445 reachable entries had
  // a shot. Replayed to the move decision; the saves live under tools/out (not committed), so a missing file skips the case.
  for (const c of [
    { save: 'skirm', turn: 3, name: 'Regent Prime 2' },
    { save: 'gear', turn: 6, name: 'Hollander BZK-F3' },
  ]) {
    const path = `tools/out/pw/adv8/${c.save}/save.json`
    it.skipIf(!fs.existsSync(path))(`AI-029 replay ${c.save} T${c.turn} ${c.name} ends its move with a shot`, () => {
      const raw = JSON.parse(fs.readFileSync(path, 'utf8'))
      const f = raw.file ?? raw
      let r = createGame(f.setup, f.seed, loadBundle())
      let found = false
      for (const a of f.actions as Action[]) {
        const st = r.state
        const pd = r.pending
        if (a.type === 'move' && st.turn === c.turn && pd.unitId && st.units[pd.unitId]!.name.startsWith(c.name)) {
          const me = pd.unitId
          const enemies = st.unitOrder.filter((id) => st.units[id]!.owner !== st.units[me]!.owner && st.units[id]!.pos && st.units[id]!.status !== 'destroyed')
          expect(query.reachable(st, me).some((x) => !x.endsProne && !x.physical && hasShot(st, me, x, enemies))).toBe(true)
          const d = decide(st)
          expect(validate(st, d.action)).toBeNull()
          const e = entryOf(st, me, d.action)
          expect(e.physical !== undefined && e.physical !== null || hasShot(st, me, e, enemies), 'ended with no shot').toBe(true)
          found = true
          break
        }
        const n = step(r.state, a)
        if (n.rejection) break
        r = n
      }
      expect(found).toBe(true)
    })
  }

  it('AI-030 does not turn its back on a live threat to finish a helpless target (prone with a leg gone, or crippled)', () => {
    let checked = 0
    for (const seed of ['helpless-1', 'helpless-2', 'helpless-3']) {
      for (const kind of ['prone', 'crippled'] as const) {
        const base = moveState(seed)
        if (!base) continue
        let { s } = base
        const { me, enemies } = base
        const [victim, threat] = enemies as [UnitId, UnitId]
        const c = hexOf(s, '0809')
        s = place(s, me, c, 0)
        // the helpless enemy lies two hexes south of us (behind), the live threat five hexes north (ahead), both moved
        s = place(s, victim, { q: c.q, r: c.r + 2 } as Hex, 0)
        if (kind === 'prone') {
          s = patchUnit(s, victim, (u) => ({ prone: true, locs: { ...u.locs, LL: { ...u.locs.LL, armor: 0, structure: 0, destroyed: true }, CT: { ...u.locs.CT, armor: 4 } } }))
        } else {
          s = patchUnit(s, victim, (u) => ({ crippled: true, locs: { ...u.locs, CT: { ...u.locs.CT, armor: 3 }, LT: { ...u.locs.LT, armor: 0, structure: 2 } } }))
        }
        s = place(s, threat, { q: c.q, r: c.r - 5 } as Hex, 3)
        s = readyToMove(moved(s, [victim, threat]), me)
        const d = decide(s)
        expect(validate(s, d.action)).toBeNull()
        const e = entryOf(s, me, d.action)
        expect(directionOn(s, threat, me, e), `${seed} ${kind}: rear to the live threat at ${JSON.stringify(e.hex)} facing ${e.facing}`).not.toBe('rear')
        checked++
      }
    }
    expect(checked).toBeGreaterThanOrEqual(4)
  })

  it('AI-031 in the Ranged Attack Phase a near-certain kill on a helpless target does not soak up the whole volley', () => {
    let checked = 0
    for (const seed of ['soak-1', 'soak-2', 'soak-3']) {
      let s = flatten(playUntil(seed, (x) => x.pending.kind === 'declareFire' && x.turn >= 2))
      if (s.pending.kind !== 'declareFire') continue
      const me = s.pending.unitId!
      const side = s.units[me]!.owner
      const [victim, threat] = s.unitOrder.filter((id) => s.units[id]!.owner !== side) as [UnitId, UnitId]
      const c = hexOf(s, '0810')
      s = place(s, me, c, 0)
      s = patchUnit(s, me, (u) => ({ move: { ...u.move, mode: 'standStill', attackerMod: 0, done: true } }))
      // both in the front arc, three hexes away. The victim is prone and a wreck: side torsos, arms and a leg gone, so nearly
      // every hit reaches its open centre torso (1 structure left): a kill is near certain after two hits.
      s = place(s, victim, { q: c.q - 1, r: c.r - 2 } as Hex, 3)
      const gone = { armor: 0, rear: 0, structure: 0, destroyed: true }
      s = patchUnit(s, victim, (u) => ({
        prone: true,
        locs: {
          ...u.locs, LL: { ...u.locs.LL, ...gone }, LT: { ...u.locs.LT, ...gone }, RT: { ...u.locs.RT, ...gone }, LA: { ...u.locs.LA, ...gone }, RA: { ...u.locs.RA, ...gone },
          CT: { ...u.locs.CT, armor: 0, rear: 0, structure: 1 }, HD: { ...u.locs.HD, armor: 0, structure: 1 }, RL: { ...u.locs.RL, armor: 0, structure: 1 },
        },
      }))
      s = place(s, threat, { q: c.q + 1, r: c.r - 3 } as Hex, 3)
      for (const e of [victim, threat]) s = patchUnit(s, e, (u) => ({ move: { ...u.move, mode: 'walk', hexesMoved: 3, tmm: 1, jumped: false, done: true } }))
      s = { ...s, heatLedger: { ...s.heatLedger, [me]: [] }, declarations: [] }
      const d = decide(s)
      expect(validate(s, d.action)).toBeNull()
      const a = d.action as Extract<Action, { type: 'declareFire' }>
      expect(a.type).toBe('declareFire')
      const onVictim = a.shots.filter((x) => x.targetId === victim).length
      const onThreat = a.shots.filter((x) => x.targetId === threat).length
      // a couple of guns finish the victim; once its kill is near certain the rest go to the live threat
      const threatShots = Object.keys(s.units[me]!.mounts).filter((mountId) => query.attackPreview(s, { attackerId: me, mountId, targetId: threat, primaryTargetId: victim }).legal)
      if (a.shots.length < 3 || threatShots.length === 0) continue
      expect(onThreat, `${seed}: ${onVictim} shots on the helpless target, ${onThreat} on the threat`).toBeGreaterThan(0)
      expect(onVictim).toBeLessThanOrEqual(3)
      checked++
    }
    expect(checked).toBeGreaterThanOrEqual(2)
  })
})
