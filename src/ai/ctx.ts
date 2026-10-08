// Per-decision context for the utility AI: the AI rng stream, unit and weapon facts read from the view and the data bundle,
// the value model (40-ai §3: firepower, KILL, focus multiplier, location destruction and crit slot values) and caches.
// Reads only the public engine API (view state, query.*, bundleFor) and data records; never mutates anything.
import type {
  GameState, Hex, Loc, LocalId, PlayerId, UnitId, UnitState,
} from '../engine/index'
import { bundleFor, deriveSeed, nextFloat, query, HEX_DIRS, FACINGS } from '../engine/index'
import type { Facing } from '../engine/index'
import type { Ammo, Weapon } from '../data/types'
import { clusterTable, meanOf, p2d6, LOC_LIST } from './prob'
import type { TierParams } from './tiers'
import { TUNE } from './tune'

export type Rng = () => number
/** AI rng: deriveSeed(gameSeed, 'ai', side, decisionSeq, tier) fed to an sfc32 stream private to the AI (40-ai intro). */
export function aiRng(gameSeed: string, side: PlayerId, decisionSeq: number, tier: string): Rng {
  let s = deriveSeed(gameSeed, 'ai', side, decisionSeq, tier)
  return () => { const [f, n] = nextFloat(s); s = n; return f }
}

// ---------- geometry helpers (presentation math, not rules) ----------
export const hexKey = (h: Hex): string => `${h.q},${h.r}`
const world = (h: Hex): { x: number; z: number } => ({ x: h.q * Math.sqrt(3) / 2, z: h.r + h.q / 2 })
/** Facing (0-5) that points most nearly from a to b. */
export function facingToward(a: Hex, b: Hex): Facing {
  const pa = world(a), pb = world(b)
  const deg = ((Math.atan2(pb.x - pa.x, -(pb.z - pa.z)) * 180) / Math.PI + 360) % 360
  return (Math.round(deg / 60) % 6) as Facing
}
export const turnGap = (f1: number, f2: number): number => { const d = Math.abs(f1 - f2) % 6; return Math.min(d, 6 - d) }
export const neighbour = (h: Hex, f: Facing): Hex => ({ q: h.q + HEX_DIRS[f].q, r: h.r + HEX_DIRS[f].r })

// ---------- transfer diagram used by the planning approximation (40-ai §4.4 step 4) ----------
export const INWARD: Partial<Record<Loc, Loc>> = { LA: 'LT', RA: 'RT', LL: 'LT', RL: 'RT', LT: 'CT', RT: 'CT' }

// ---------- weapons ----------
export interface AmmoChoice { ammoId: string; binId: LocalId; shots: number; location: Loc }
export interface WeaponInfo {
  mountId: LocalId
  location: Loc
  rear: boolean
  heat: number
  /** Largest per-hit damage over the range bands (per missile for cluster weapons). */
  damage: number
  cluster: { rackSize: number; groupSize: number } | null
  usesAmmo: boolean
  /** One bin per loaded ammo type with shots left (empty when the weapon needs ammo and has none). */
  ammo: AmmoChoice[]
  ranges: { min: number; short: number; medium: number; long: number }
  /** Damage per range band (energy weapons with variable damage). */
  bandDamage: { short: number; medium: number; long: number }
  toHitMod: number
}

export interface UnitFacts {
  id: UnitId
  weapons: WeaponInfo[]
  firepower: number
  kill: number
  prefRange: number
  maxRange: number
  liveAmmo: boolean
  locValue: Record<Loc, { ld: number; crit: number; kill: boolean }>
}

const isAlive = (u: UnitState): boolean => (u.status === 'active' || u.status === 'withdrawing') && !!u.pos && !u.doomed

export class AiCtx {
  readonly state: GameState
  readonly me: PlayerId
  readonly tier: TierParams
  readonly rng: Rng
  readonly t0: number
  readonly deadline: number
  private facts = new Map<UnitId, UnitFacts>()
  private boardKeys: Set<string> | null = null
  private sideMaxFp = new Map<PlayerId, number>()
  readonly memo = new Map<string, unknown>()
  /** The mission counts crippled units as eliminated (11-missions victory {type: eliminate, cripple: true}). */
  readonly crippleWins: boolean

  constructor(state: GameState, me: PlayerId, tier: TierParams, rng: Rng, budgetMs: number) {
    this.state = state
    this.me = me
    this.tier = tier
    this.rng = rng
    this.t0 = now()
    this.deadline = this.t0 + budgetMs
    const mission = bundleFor(state).missions[state.setup.missionId] as { victory?: { type: string; cripple?: boolean }[] } | undefined
    this.crippleWins = !!mission?.victory?.some((v) => v.type === 'eliminate' && v.cripple)
  }

  timeLeft(): number { return this.deadline - now() }

  unit(id: UnitId): UnitState { return this.state.units[id]! }
  alive(id: UnitId): boolean { const u = this.state.units[id]; return !!u && isAlive(u) }
  enemiesOf(side: PlayerId = this.me): UnitId[] {
    return this.state.unitOrder.filter((id) => { const u = this.state.units[id]!; return u.owner !== side && isAlive(u) })
  }
  friendsOf(side: PlayerId = this.me): UnitId[] {
    return this.state.unitOrder.filter((id) => { const u = this.state.units[id]!; return u.owner === side && isAlive(u) })
  }
  /** Enemy has finished its move this turn (its position is final for the coming attack phases). */
  hasMoved(id: UnitId): boolean {
    const u = this.unit(id)
    return this.state.phase !== 'movement' || u.move.done || (this.state.selection?.acted.includes(id) ?? false)
  }

  onBoard(h: Hex): boolean {
    if (!this.boardKeys) this.boardKeys = new Set(Object.values(this.state.board.hexes).map((b) => hexKey(b.hex)))
    return this.boardKeys.has(hexKey(h))
  }
  /** Number of on-board neighbours (6 inside the map, fewer at the edge). */
  boardNeighbours(h: Hex): number { let n = 0; for (const f of FACINGS) if (this.onBoard(neighbour(h, f))) n++; return n }
  private hexMap: Map<string, { woods: string; depth: number; level: number }> | null = null
  hexInfo(h: Hex): { woods: string; depth: number; level: number } | null {
    if (!this.hexMap) this.hexMap = new Map(Object.values(this.state.board.hexes).map((b) => [hexKey(b.hex), { woods: b.woods, depth: b.depth, level: b.level }]))
    return this.hexMap.get(hexKey(h)) ?? null
  }

  // ---------- unit facts (value model, 40-ai §3) ----------
  factsOf(id: UnitId): UnitFacts {
    let f = this.facts.get(id)
    if (!f) { f = buildFacts(this, id); this.facts.set(id, f) }
    return f
  }
  firepower(id: UnitId): number { return this.factsOf(id).firepower }
  kill(id: UnitId): number { return this.factsOf(id).kill }
  /** Focus multiplier m(x) = 0.5 + firepower(x) / max firepower on x's side, in [0.5, 1.5]. */
  focus(id: UnitId): number {
    const side = this.unit(id).owner
    let mx = this.sideMaxFp.get(side)
    if (mx === undefined) {
      mx = 0
      for (const x of this.state.unitOrder) { const u = this.state.units[x]!; if (u.owner === side && isAlive(u)) mx = Math.max(mx, this.firepower(x)) }
      this.sideMaxFp.set(side, mx)
    }
    if (mx <= 0) return 0.5
    return Math.min(1.5, Math.max(0.5, 0.5 + this.firepower(id) / mx))
  }
  /** FALL_COST(x) = 1.2 Ã— value of the fall damage on x + 10 (40-ai §3.7), from query.fallPreview. */
  fallCost(id: UnitId): number {
    const k = `fall:${id}`
    const hit = this.memo.get(k) as number | undefined
    if (hit !== undefined) return hit
    const fp = query.fallPreview(this.state, id)
    let v = 0
    const u = this.unit(id)
    const lv = this.factsOf(id).locValue
    for (const l of LOC_LIST) {
      const p = fp.locations[l] ?? 0
      if (!p) continue
      const L = u.locs[l]
      if (L.destroyed) continue
      const armor = L.armor
      const dmg = fp.damage
      const toArmor = Math.min(dmg, armor)
      const toStruct = Math.min(Math.max(0, dmg - armor), L.structure)
      const destroyed = dmg >= armor + L.structure ? 1 : 0
      v += p * (toArmor + 1.5 * toStruct + destroyed * lv[l].ld + (toStruct > 0 ? (22 / 36) * lv[l].crit : 0))
    }
    v = 1.2 * this.focus(id) * v + TUNE.fallTempo + fp.pPilotHit * 5
    this.memo.set(k, v)
    return v
  }
}

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now())

// ---------- data readers ----------
function weaponRec(state: GameState, item: string): Weapon | null {
  const r = bundleFor(state).weapons[item] as Weapon | undefined
  return r ?? null
}
function ammoRec(state: GameState, id: string): Ammo | null {
  return (bundleFor(state).ammo[id] as Ammo | undefined) ?? null
}
function dmgOf(d: Weapon['damage']): { short: number; medium: number; long: number } {
  if (typeof d === 'number') return { short: d, medium: d, long: d }
  const o = d as { short?: number; medium?: number; long?: number }
  const s = o.short ?? o.medium ?? o.long ?? 0
  return { short: s, medium: o.medium ?? s, long: o.long ?? o.medium ?? s }
}

/** Operational ranged weapons of a unit with their ammo choices (data + unit state only). */
export function weaponsOf(state: GameState, id: UnitId): WeaponInfo[] {
  const u = state.units[id]!
  const out: WeaponInfo[] = []
  for (const m of Object.values(u.mounts)) {
    const w = weaponRec(state, m.item)
    if (!w || m.destroyed || u.locs[m.location].destroyed) continue
    const usesAmmo = !!w.ammo && w.ammo.length > 0
    const byType = new Map<string, AmmoChoice>()
    if (usesAmmo) {
      for (const b of Object.values(u.bins)) {
        if (b.exploded || b.shots <= 0 || u.locs[b.location].destroyed || !w.ammo!.includes(b.ammo)) continue
        const cur = byType.get(b.ammo)
        // §8.5: draw from the bin in the most exposed location (least armor + structure left), then the emptier bin
        const left = (l: Loc): number => u.locs[l].armor + (u.locs[l].rear ?? 0) + u.locs[l].structure
        const better = !cur || left(b.location) < left(cur.location) || (left(b.location) === left(cur.location) && b.shots < cur.shots)
        if (better) byType.set(b.ammo, { ammoId: b.ammo, binId: b.id, shots: b.shots, location: b.location })
      }
      if (byType.size === 0) continue
    }
    const bd = dmgOf(w.damage)
    let cluster = w.cluster ? { rackSize: w.cluster.rackSize, groupSize: w.cluster.groupSize ?? 1 } : null
    let ranges = w.ranges as WeaponInfo['ranges']
    let damage = Math.max(bd.short, bd.medium, bd.long)
    // ammo that changes the profile (e.g. MML LRM / SRM loads): use the longest-ranged load for planning numbers
    for (const a of byType.values()) {
      const rec = ammoRec(state, a.ammoId)
      const ov = rec?.override
      if (!ov) continue
      if (ov.cluster) cluster = { rackSize: ov.cluster.rackSize, groupSize: ov.cluster.groupSize ?? 1 }
      if (ov.damage !== undefined) { const d2 = dmgOf(ov.damage); damage = Math.max(damage, d2.short, d2.medium, d2.long) }
      if (ov.ranges && (ov.ranges as WeaponInfo['ranges']).long > (ranges?.long ?? 0)) ranges = ov.ranges as WeaponInfo['ranges']
    }
    out.push({
      mountId: m.id, location: m.location, rear: m.rear, heat: w.heat ?? 0, damage, cluster, usesAmmo,
      ammo: [...byType.values()].sort((a, b) => (a.ammoId < b.ammoId ? -1 : 1)),
      ranges: { min: ranges?.min ?? 0, short: ranges?.short ?? 0, medium: ranges?.medium ?? 0, long: ranges?.long ?? 0 },
      bandDamage: bd, toHitMod: w.toHitMod ?? 0,
    })
  }
  return out
}

/** Expected hits of a cluster weapon at modifier 0 (engine cluster table). */
const expHits = (rack: number): number => meanOf(clusterTable(rack, 0))
const pAt = (t: number): number => p2d6(t)

function slotValue(ctx: AiCtx, u: UnitState, token: string, killV: number, weapons: Map<string, WeaponInfo>): number {
  const cw = ctx.crippleWins && !u.crippled // a 2nd engine or gyro hit cripples, which counts as eliminated (11-missions)
  const hits = (t: string): number => { let n = 0; for (const sl of Object.values(u.slots)) for (const s of sl) if (s.hit && s.token === t) n++; return n }
  switch (token) {
    case 'engine': { const h = hits('engine'); return h === 0 ? (cw ? 0.6 * killV : 15) : h === 1 ? (cw ? killV : 25) : killV }
    case 'gyro': return hits('gyro') === 0 ? (cw ? 0.5 * killV : 12) : (cw ? killV : 30)
    case 'cockpit': return killV
    case 'sensors': return hits('sensors') === 0 ? 6 : 15
    case 'lifeSupport': return 3
    case 'shoulder': return 5
    case 'upperArm': case 'lowerArm': return 3
    case 'hand': return 2
    case 'hip': return 6
    case 'upperLeg': case 'lowerLeg': return 4
    case 'foot': return 2
    default: break
  }
  if (token.startsWith('#')) {
    const id = token.slice(1)
    const w = weapons.get(id)
    if (w) return 2 * w.damage * (w.cluster ? expHits(w.cluster.rackSize) : 1)
    const b = u.bins[id]
    if (b) return b.shots > 0 && !b.exploded ? explosionValue(ctx, u, b.location, id, killV) : 0
    const m = u.mounts[id]
    if (m) return m.item.includes('heat-sink') ? (u.sinks.type === 'double' ? 4 : 2) : 2
  }
  return 2
}

function explosionValue(ctx: AiCtx, u: UnitState, loc: Loc, binId: string, killV: number): number {
  const idx = u.slots[loc].findIndex((s) => s.token === `#${binId}`)
  if (idx < 0) return 0
  const pv = query.explosionPreview(ctx.state, u.id, { location: loc, index: idx })
  if (pv.destroysUnit) return killV
  return 1.5 * pv.damage + 5 + 6 * pv.transfersTo.length
}

function buildFacts(ctx: AiCtx, id: UnitId): UnitFacts {
  const state = ctx.state
  const u = state.units[id]!
  const weapons = weaponsOf(state, id)
  let fp = 0
  for (const w of weapons) fp += w.damage * (w.cluster ? expHits(w.cluster.rackSize) : 1) * (15 / 36)
  // KILL(x) = 20 + 3 × firepower; a unit already crippled under a cripple-counts victory is worth only its guns
  const kill = (ctx.crippleWins && u.crippled ? 5 : 20) + 3 * fp
  const wmap = new Map(weapons.map((w) => [w.mountId, w]))
  const dmgIn = (l: Loc): number => weapons.filter((w) => w.location === l).reduce((s, w) => s + w.damage * (w.cluster ? expHits(w.cluster.rackSize) : 1), 0)
  const locValue = {} as UnitFacts['locValue']
  for (const l of LOC_LIST) {
    const L = u.locs[l]
    const isKill = !L.destroyed && query.isKillLocation(state, id, l)
    let ld = 0
    if (!L.destroyed) {
      if (l === 'HD' || l === 'CT') ld = kill
      else if (l === 'LT' || l === 'RT') ld = 5 + 2 * (dmgIn(l) + dmgIn(l === 'LT' ? 'LA' : 'RA')) + (isKill ? kill : 0)
      else if (l === 'LA' || l === 'RA') ld = 3 + 2 * dmgIn(l)
      else ld = ctx.crippleWins && !u.crippled ? kill : 0.4 * kill // a destroyed leg cripples (eliminated for victory)
    }
    // mean value over critable, undestroyed slots (empty / structure / armor slots are re-rolled by the rules)
    let sum = 0, n = 0
    for (const s of u.slots[l]) {
      if (s.hit || s.token === 'empty' || s.token === 'structure' || s.token === 'armor') continue
      sum += slotValue(ctx, u, s.token, kill, wmap); n++
    }
    locValue[l] = { ld, crit: n ? sum / n : 0, kill: isKill }
  }
  // preferred range (40-ai §6.4): argmax_r Î£ damage Ã— P(2d6 â‰¥ 4 + band mod) / max(1, heat); ties to the longer range
  let maxRange = 0
  for (const w of weapons) maxRange = Math.max(maxRange, w.ranges.long)
  let prefRange = 1, best = -1
  for (let r = 1; r <= Math.max(1, maxRange); r++) {
    let v = 0
    for (const w of weapons) {
      const R = w.ranges
      if (r > R.long) continue
      const band = r <= R.short ? 0 : r <= R.medium ? 2 : 4
      const dmg = r <= R.short ? w.bandDamage.short : r <= R.medium ? w.bandDamage.medium : w.bandDamage.long
      const minPen = R.min && r <= R.min ? R.min - r + 1 : 0
      v += dmg * (w.cluster ? expHits(w.cluster.rackSize) : 1) * pAt(4 + band + minPen + w.toHitMod) / Math.max(1, w.heat)
    }
    if (v >= best - 1e-9) { best = v; prefRange = r }
  }
  // prefer the range band where the unit does real damage; the per-heat ratio alone favours long-range trickles
  let bestDmg = -1, dmgRange = prefRange
  for (let r = 1; r <= Math.max(1, maxRange); r++) {
    let v = 0
    for (const w of weapons) {
      const R = w.ranges
      if (r > R.long) continue
      const band = r <= R.short ? 0 : r <= R.medium ? 2 : 4
      const dmg = r <= R.short ? w.bandDamage.short : r <= R.medium ? w.bandDamage.medium : w.bandDamage.long
      const minPen = R.min && r <= R.min ? R.min - r + 1 : 0
      v += dmg * (w.cluster ? expHits(w.cluster.rackSize) : 1) * pAt(4 + band + minPen + w.toHitMod)
    }
    if (v > bestDmg + 1e-9) { bestDmg = v; dmgRange = r }
  }
  prefRange = Math.round((prefRange + dmgRange) / 2)
  const liveAmmo = Object.values(u.bins).some((b) => b.shots > 0 && !b.exploded && !u.locs[b.location].destroyed)
  return { id, weapons, firepower: fp, kill, prefRange, maxRange, liveAmmo, locValue }
}
