// Random-tier bot (40-ai §12 "random", made watchable): it only ever answers with a member of legalActions (or a composite
// fire declaration that passes validate), but it leans toward sensible play so a human can finish a game against it:
// - movement: closes on the nearest enemy, ends facing it, avoids risky piloting rolls and big jump heat;
// - fire: picks the target with the best expected damage and adds weapons while the projected heat stays below shutdown;
// - physical: kicks (or punches) when adjacent; prone units try to stand.
// Reads only the engine's public API. Randomness: deriveSeed(seed, 'ai', side, decisionId) streams, never Math.random.
import type {
  Action, DeclareFireAction, Decider, FireShot, GameState, Hex, MoveAction, PendingDecision, PlayerView, ReachEntry, UnitId,
} from '../engine/index'
import { deriveSeed, nextFloat, query, validate } from '../engine/index'

export interface RandomBotOptions {
  /** 0 = always the best-scored answer, 1 = uniform among legal answers. Default 0.25. */
  noise?: number
  /** Heat the bot tries to stay below after the Heat Phase. Default 13 (first shutdown check is at 14). */
  heatCap?: number
}

type Rng = () => number
function stream(seed: string, side: string, id: string): Rng {
  let s = deriveSeed(seed, 'ai', side, id, 'random')
  return () => { const [f, n] = nextFloat(s); s = n; return f }
}

// ---------- geometry the bot needs (presentation math, not rules) ----------
const world = (h: Hex): { x: number; z: number } => ({ x: h.q * Math.sqrt(3) / 2, z: h.r + h.q / 2 })
/** Facing (0-5) that points most nearly from a to b. */
function facingToward(a: Hex, b: Hex): number {
  const pa = world(a), pb = world(b)
  const deg = ((Math.atan2(pb.x - pa.x, -(pb.z - pa.z)) * 180) / Math.PI + 360) % 360
  return Math.round(deg / 60) % 6
}
const turnGap = (f1: number, f2: number): number => { const d = Math.abs(f1 - f2) % 6; return Math.min(d, 6 - d) }

function enemiesOf(state: GameState, unitId: UnitId): { id: UnitId; hex: Hex }[] {
  const me = state.units[unitId]!
  const out: { id: UnitId; hex: Hex }[] = []
  for (const id of state.unitOrder) {
    const u = state.units[id]!
    if (u.owner === me.owner || !u.pos || u.doomed) continue
    if (u.status !== 'active' && u.status !== 'withdrawing') continue
    out.push({ id, hex: u.pos })
  }
  return out
}
function nearestEnemy(state: GameState, unitId: UnitId, from: Hex): { id: UnitId; hex: Hex; d: number } | null {
  let best: { id: UnitId; hex: Hex; d: number } | null = null
  for (const e of enemiesOf(state, unitId)) {
    const d = query.distance(from, e.hex)
    if (!best || d < best.d) best = { ...e, d }
  }
  return best
}
/** Enemies that will come onto the board: aim at the middle of the board when nobody is on it yet. */
function boardCentre(state: GameState): Hex {
  const hexes = Object.values(state.board.hexes)
  const mid = hexes[Math.floor(hexes.length / 2)]
  return mid ? mid.hex : { q: 0, r: 0 }
}

function pick<T>(items: T[], score: (x: T) => number, rng: Rng, noise: number): T {
  if (items.length === 1) return items[0]!
  if (rng() < noise) return items[Math.floor(rng() * items.length)]!
  let best: T = items[0] as T, bestScore = -Infinity
  for (const x of items) {
    const s = score(x) + rng() * 1e-3 // seeded tie-break
    if (s > bestScore) { best = x; bestScore = s }
  }
  return best
}

// ---------- per decision ----------
function chooseMove(state: GameState, legal: Action[], rng: Rng, noise: number, heatCap: number): Action {
  const p = state.pending
  const unitId = p.unitId!
  const u = state.units[unitId]!
  const entries = query.reachable(state, unitId)
  const key = (a: Action): string => JSON.stringify(a)
  const legalKeys = new Set(legal.map(key))
  const usable = entries.filter((e) => legalKeys.has(key(e.action)))
  if (usable.length === 0) return legal[0]!
  const ranged = Object.values(u.mounts).length > 0
  const score = (e: ReachEntry): number => {
    const goal = nearestEnemy(state, unitId, e.hex)
    const target = goal?.hex ?? boardCentre(state)
    const d = goal ? goal.d : query.distance(e.hex, target)
    let s = 0
    // close to a comfortable firing distance (2-4 hexes), adjacent is fine for kicks
    s -= Math.max(0, d - 3) * 2
    if (d === 0) s -= 20
    // face the enemy so the forward arc covers it
    s -= turnGap(e.facing, facingToward(e.hex, target)) * 1.5
    // moving makes the unit harder to hit
    s += e.tmm * 1.2
    // do not fall over
    for (const r of e.psrs) s -= (1 - r.p) * 12
    if (e.endsProne) s -= 10
    // heat: movement heat on top of current heat
    const over = u.heat + e.heat - heatCap
    if (over > 0) s -= over * 3
    if (!ranged) s -= d
    return s
  }
  return pick(usable, score, rng, noise).action
}

function chooseFire(state: GameState, legal: Action[], rng: Rng, noise: number, heatCap: number): Action {
  const p = state.pending
  const unitId = p.unitId!
  const hold = legal[0]!
  if (rng() < noise * 0.2) return legal[Math.floor(rng() * legal.length)]!
  const singles = legal.filter((a): a is DeclareFireAction => a.type === 'declareFire' && a.shots.length === 1)
  if (singles.length === 0) return hold
  // expected damage and heat per legal single shot
  const scored = singles.map((a) => {
    const sh = a.shots[0]!
    const pv = query.attackPreview(state, { attackerId: unitId, mountId: sh.mountId, targetId: sh.targetId! })
    return { shot: sh, target: sh.targetId!, ev: pv.legal ? pv.expectedDamage : 0, heat: pv.heat }
  })
  const targets = [...new Set(scored.map((x) => x.target))]
  const total = (t: UnitId): number => scored.filter((x) => x.target === t).reduce((n, x) => n + x.ev, 0)
  const target = targets.reduce((b, t) => (total(t) > total(b) ? t : b), targets[0]!)
  // add the best damage-per-heat weapons first while the projected end heat stays under the cap
  const mine = scored.filter((x) => x.target === target && x.ev > 0).sort((x, y) => y.ev / (y.heat + 1) - x.ev / (x.heat + 1))
  const shots: FireShot[] = []
  for (const x of mine) {
    const trial = [...shots, x.shot]
    const proj = query.heatProjection(state, unitId, { mounts: trial.map((s) => s.mountId) })
    if (proj.end > heatCap && shots.length > 0) continue
    if (proj.end > heatCap + 4) continue
    shots.push(x.shot)
  }
  if (shots.length === 0) return hold
  const action: DeclareFireAction = { type: 'declareFire', decisionId: p.id, player: p.player, unitId, shots: shots.map((s) => ({ ...s })) }
  if (validate(state, action) === null) return action
  // fall back to the best single legal shot
  const best = mine[0]
  return best ? singles.find((a) => a.shots[0]!.mountId === best.shot.mountId && a.shots[0]!.targetId === best.target) ?? hold : hold
}

function choosePhysical(state: GameState, legal: Action[], rng: Rng, noise: number): Action {
  const p = state.pending
  const unitId = p.unitId!
  const value = (a: Action): number => {
    if (a.type !== 'declarePhysical') return 0
    const k = a.attack
    if (k.kind === 'none') return 0
    if (k.kind === 'punch') {
      return k.arms.reduce((n, arm) => {
        const pv = query.physicalPreview(state, { attackerId: unitId, kind: 'punch', limb: arm.arm, targetId: arm.targetId })
        return n + pv.pHit * pv.damage
      }, 0)
    }
    if (k.kind === 'kick') {
      const pv = query.physicalPreview(state, { attackerId: unitId, kind: 'kick', limb: k.leg, targetId: k.targetId })
      return pv.pHit * pv.damage - (1 - pv.pHit) * 1.5 // a miss risks a fall
    }
    return -1 // pushes rarely pay off for the bot
  }
  return pick(legal, value, rng, noise * 0.5)
}

function chooseTwist(state: GameState, legal: Action[], rng: Rng): Action {
  const p = state.pending
  const unitId = p.unitId!
  const u = state.units[unitId]!
  const from = u.pos
  if (!from) return legal[0]!
  const enemy = nearestEnemy(state, unitId, from)
  if (!enemy) return legal[0]!
  const want = facingToward(from, enemy.hex)
  return pick(legal, (a) => (a.type === 'torsoTwist' && !a.flip ? -turnGap((u.facing + a.twist + 6) % 6, want) : -5), rng, 0)
}

function chooseStand(state: GameState, legal: Action[], rng: Rng): Action {
  const p = state.pending
  const u = state.units[p.unitId!]!
  const enemy = u.pos ? nearestEnemy(state, u.id, u.pos) : null
  const want = enemy && u.pos ? facingToward(u.pos, enemy.hex) : u.facing
  return pick(legal, (a) => (a.type === 'standUp' ? (a.attempt ? 10 - turnGap(a.facing ?? u.facing, want) : a.mode ? 1 : 0) : 0), rng, 0)
}

function chooseDeploy(state: GameState, legal: Action[], rng: Rng): Action {
  const centre = boardCentre(state)
  return pick(legal, (a) => (a.type === 'deploy' ? -query.distance(a.hex, centre) : 0), rng, 0.5)
}

/** The decision logic, synchronous (sim and tests call it directly). */
export function decideRandom(view: PlayerView, pending: PendingDecision, legal: Action[], seed: string, opts: RandomBotOptions = {}): Action {
  if (legal.length === 0) throw new Error(`random bot: no legal actions for ${pending.id}`)
  const noise = opts.noise ?? 0.25
  const heatCap = opts.heatCap ?? 13
  const rng = stream(seed, pending.player, pending.id)
  const state = view.state
  switch (pending.kind) {
    case 'move': return chooseMove(state, legal, rng, noise, heatCap)
    case 'standUp': return chooseStand(state, legal, rng)
    case 'declareFire': return chooseFire(state, legal, rng, noise, heatCap)
    case 'declarePhysical': return choosePhysical(state, legal, rng, noise)
    case 'torsoTwist': return chooseTwist(state, legal, rng)
    case 'deploy': return chooseDeploy(state, legal, rng)
    case 'powerChoice': return legal.find((a) => a.type === 'powerChoice' && a.changes.some((c) => c.to === 'restart')) ?? legal[0]!
    default: return legal[Math.floor(rng() * legal.length)]!
  }
}

/** Random-tier Decider for the game runner and the sim. */
export function createRandomBot(seed: string, opts: RandomBotOptions = {}): Decider {
  return {
    async decide(view, pending, legal) {
      return decideRandom(view, pending, legal, seed, opts)
    },
  }
}

export type { MoveAction }
