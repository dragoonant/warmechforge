// The ONE heat ledger and heat-scale effects (10 §13, 00 §8). Pure: state in, { state, events } out.
import type { GameEvent } from './events'
import type { HeatEffects, HeatPlan, HeatProjection } from './index'
import { addPilotHit, initiativeOrder, patchUnit } from './pilot'
import type { Stepped } from './pilot'
import { roll } from './rng'
import { bundleFor } from './bundles'
import type { BoardHex, GameState, HeatEntry, HeatSource, LocalId, MoveMode, UnitId, UnitState } from './types'
import { EngineInvariantError } from './types'

// ---------- heat scale (HEAT-020..025), thresholds high to low ----------
const MP_LOSS: readonly [number, number][] = [[25, 5], [20, 4], [15, 3], [10, 2], [5, 1]]
const TO_HIT: readonly [number, number][] = [[24, 4], [17, 3], [13, 2], [8, 1]]
const SHUTDOWN_TN: readonly [number, number][] = [[26, 10], [22, 8], [18, 6], [14, 4]]
const AMMO_TN: readonly [number, number][] = [[28, 8], [23, 6], [19, 4]]
const lookup = (t: readonly [number, number][], heat: number): number => t.find(([h]) => heat >= h)?.[1] ?? 0

/** Effects use min(heat, 30) (HEAT-013). */
export const effectiveHeat = (heat: number): number => Math.min(heat, 30)
export const heatMpLoss = (heat: number): number => lookup(MP_LOSS, effectiveHeat(heat))
export const heatToHitMod = (heat: number): number => lookup(TO_HIT, effectiveHeat(heat))
/** Highest shutdown avoid number reached, or null below 14. Heat 30 is automatic (see HeatEffects.autoShutdown). */
export const shutdownAvoidTn = (heat: number): number | null => { const v = lookup(SHUTDOWN_TN, effectiveHeat(heat)); return v || null }
export const ammoAvoidTn = (heat: number): number | null => { const v = lookup(AMMO_TN, effectiveHeat(heat)); return v || null }
export const lifeSupportHits = (heat: number): number => (heat >= 20 ? 2 : heat >= 10 ? 1 : 0)

/** Count of hit slots with a system token, over all locations. */
export function hitCount(u: UnitState, token: string): number {
  let n = 0
  for (const slots of Object.values(u.slots)) for (const s of slots) if (s.hit && s.token === token) n++
  return n
}

export function heatEffects(u: UnitState, heat = u.heat): HeatEffects {
  return {
    heat,
    mpLoss: heatMpLoss(heat),
    toHitMod: heatToHitMod(heat),
    shutdownTn: shutdownAvoidTn(heat),
    autoShutdown: heat >= 30,
    ammoTn: ammoAvoidTn(heat),
    lifeSupportPilotHits: hitCount(u, 'lifeSupport') > 0 ? lifeSupportHits(heat) : 0,
  }
}

// ---------- ledger ----------
/** The only writer of the turn's heat ledger (00 §8). */
export function addHeat(state: GameState, unitId: UnitId, e: { source: HeatSource; amount: number; ref?: string | null }): Stepped {
  if (e.amount <= 0) return { state, events: [] }
  const entry: HeatEntry = { source: e.source, amount: e.amount, ref: e.ref ?? null, phase: state.phase }
  const list = [...(state.heatLedger[unitId] ?? []), entry]
  const turnTotal = list.reduce((a, x) => a + x.amount, 0)
  return { state: { ...state, heatLedger: { ...state.heatLedger, [unitId]: list } }, events: [{ type: 'HeatAdded', unitId, entry, turnTotal }] }
}

/** Movement heat (MOVE-002..005); stand attempts and standing still add none. */
export function movementHeat(mode: MoveMode | null, hexesJumped = 0): number {
  switch (mode) {
    case 'walk': return 1
    case 'run': return 2
    case 'jump': return Math.max(3, hexesJumped)
    default: return 0
  }
}

/** Engine crits: 5 heat each (CRIT-031); none while shut down. A third crit destroys the unit (handled by crits.ts). */
export const engineHeat = (u: UnitState): number => (u.shutdown ? 0 : 5 * Math.min(2, hitCount(u, 'engine')))

// ---------- dissipation (HEAT-010..012) ----------
const isSinkItem = (item: string): boolean => item.includes('heat-sink')
function boardHexAt(state: GameState, u: UnitState): BoardHex | null {
  if (!u.pos) return null
  for (const h of Object.values(state.board.hexes)) if (h.hex.q === u.pos.q && h.hex.r === u.pos.r) return h
  return null
}
const sinkMounts = (u: UnitState) => Object.values(u.mounts).filter((m) => isSinkItem(m.item))
const engineHeldSinks = (u: UnitState): number => Math.max(0, u.sinks.count - sinkMounts(u).length)

/** Operable sink dissipation: engine-held sinks always count, mounted ones need an intact mount in an intact location. */
export function baseDissipation(u: UnitState): number {
  const per = (item: string): number => (item.includes('double') ? 2 : 1)
  const mounted = sinkMounts(u).filter((m) => !m.destroyed && !u.locs[m.location].destroyed).reduce((a, m) => a + per(m.item), 0)
  return engineHeldSinks(u) * (u.sinks.type === 'double' ? 2 : 1) + mounted
}

/** Water bonus: standing in depth 1 = submerged leg sinks; depth 2+ (or prone in depth 1) = every sink; max +6 (HEAT-012). */
export function waterBonus(state: GameState, u: UnitState): number {
  const depth = boardHexAt(state, u)?.depth ?? 0
  if (depth <= 0) return 0
  const ok = sinkMounts(u).filter((m) => !m.destroyed && !u.locs[m.location].destroyed)
  if (depth >= 2 || u.prone) return Math.min(6, ok.length + engineHeldSinks(u))
  return Math.min(6, ok.filter((m) => m.location === 'LL' || m.location === 'RL').length)
}

/** Partial wing: +3 in all (Lostech/TO, unconfirmed: our BMM extract lacks the p.116 body), scaled down by lost wing mounts. */
export function wingBonus(u: UnitState): number {
  const wings = Object.values(u.mounts).filter((m) => m.item === 'is.eq.partial-wing')
  if (wings.length === 0) return 0
  const ok = wings.filter((m) => !m.destroyed && !u.locs[m.location].destroyed).length
  return Math.floor((3 * ok) / wings.length)
}

export const dissipation = (state: GameState, u: UnitState): number => baseDissipation(u) + waterBonus(state, u) + wingBonus(u)

/** HEAT-013. */
export const nextHeat = (before: number, generated: number, dissipated: number): number => Math.max(0, before + generated - dissipated)

// ---------- projection for the UI (query.heatProjection) ----------
export function projectHeat(state: GameState, unitId: UnitId, plan: HeatPlan = {}): HeatProjection {
  const u = state.units[unitId]!
  const entries: HeatEntry[] = [...(state.heatLedger[unitId] ?? [])]
  const add = (source: HeatSource, amount: number, ref: string | null): void => { if (amount > 0) entries.push({ source, amount, ref, phase: state.phase }) }
  if (plan.mode && u.move.mode === null) add('movement', movementHeat(plan.mode, plan.hexesJumped ?? 0), null)
  const weapons = (bundleFor(state).weapons ?? {}) as Record<string, { heat?: number }>
  for (const id of plan.mounts ?? ([] as LocalId[])) {
    const m = u.mounts[id]
    if (m) add('weapon', (weapons[m.item]?.heat ?? 0) * (plan.rapidShots?.[id] ?? 1), id)
  }
  add('engine', engineHeat(u), null)
  const generated = entries.reduce((a, x) => a + x.amount, 0)
  const diss = dissipation(state, u)
  const end = nextHeat(u.heat, generated, diss)
  return { now: u.heat, entries, generated, dissipation: diss, end, effects: heatEffects(u, end) }
}

// ---------- late-bound collaborators (damage.ts / ammo.ts are other work packages) ----------
export interface HeatDeps {
  /** Picks the bin that explodes (AMMO-030). Default: non-empty bin with the most shots (RULING in issues). */
  pickBin(state: GameState, unitId: UnitId): LocalId | null
  /** Explodes a bin because of heat (AMMO-010: AmmoExploded, internal damage, pilot hit). */
  explodeAmmo(state: GameState, unitId: UnitId, binId: LocalId): Stepped
}
export const heatDeps: HeatDeps = {
  pickBin(state, unitId) {
    const bins = Object.values(state.units[unitId]!.bins).filter((b) => b.shots > 0 && !b.exploded)
    bins.sort((a, b) => b.shots - a.shots)
    return bins[0]?.id ?? null
  },
  explodeAmmo() { throw new EngineInvariantError('heatDeps.explodeAmmo not wired (ammo.ts)') },
}

// ---------- Heat Phase, one unit (HEAT-030) ----------
export function heatPhaseUnit(state: GameState, unitId: UnitId): Stepped {
  let s = state
  const events: GameEvent[] = []
  const push = (r: Stepped): void => { s = r.state; events.push(...r.events) }
  let u = s.units[unitId]!
  if (u.status === 'destroyed' || u.doomed) return { state: s, events }

  // (1) engine heat joins the ledger before dissipation (CRIT-031), then HEAT-013
  push(addHeat(s, unitId, { source: 'engine', amount: engineHeat(u) }))
  u = s.units[unitId]!
  const entries = s.heatLedger[unitId] ?? []
  const generated = entries.reduce((a, x) => a + x.amount, 0)
  const dissipated = dissipation(s, u)
  const before = u.heat
  const after = nextHeat(before, generated, dissipated)
  events.push({ type: 'HeatApplied', unitId, before, generated, dissipated, after, entries })
  s = patchUnit({ ...s, heatLedger: { ...s.heatLedger, [unitId]: [] } }, unitId, { heat: after })
  u = s.units[unitId]!

  // (2) restart attempt, else (3) shutdown check
  if (u.shutdown) {
    if (u.shutdown.cause === 'heat' && u.shutdown.turn < s.turn) {
      if (after < 14) {
        s = patchUnit(s, unitId, { shutdown: null })
        events.push({ type: 'UnitRestarted', unitId, heat: after, auto: true })
      } else if (after < 30 && u.pilot.conscious) { // HEAT-040/031: an unconscious pilot restarts only below 14
        const tn = shutdownAvoidTn(after)!
        const r = roll(s, { count: 2, sides: 6, purpose: 'startup', unitId, target: tn, reason: 'startup' })
        s = r.state
        events.push(r.event)
        if (r.event.success) {
          s = patchUnit(s, unitId, { shutdown: null })
          events.push({ type: 'UnitRestarted', unitId, heat: after, auto: false })
        }
      }
    }
  } else if (after >= 14) {
    let down: boolean
    if (after >= 30 || !u.pilot.conscious) down = true
    else {
      const tn = shutdownAvoidTn(after)!
      const r = roll(s, { count: 2, sides: 6, purpose: 'shutdownAvoid', unitId, target: tn, reason: 'shutdown' })
      s = r.state
      events.push(r.event)
      down = !r.event.success
    }
    if (down) {
      s = patchUnit(s, unitId, { shutdown: { cause: 'heat', turn: s.turn } })
      events.push({ type: 'UnitShutdown', unitId, cause: 'heat', heat: after })
    }
  }

  // (4) ammo explosion check, even while shut down
  const tnAmmo = ammoAvoidTn(after)
  if (tnAmmo !== null && heatDeps.pickBin(s, unitId) !== null) {
    const r = roll(s, { count: 2, sides: 6, purpose: 'ammoExplosionAvoid', unitId, target: tnAmmo, reason: 'ammo' })
    s = r.state
    events.push(r.event)
    if (!r.event.success) {
      const bin = heatDeps.pickBin(s, unitId)
      if (bin) push(heatDeps.explodeAmmo(s, unitId, bin))
    }
  }

  // (5) life support pilot hits (CRIT-060)
  const ls = heatEffects(s.units[unitId]!, after).lifeSupportPilotHits
  if (ls > 0 && s.units[unitId]!.status !== 'destroyed') push(addPilotHit(s, unitId, 'lifeSupportHeat', ls))
  return { state: s, events }
}

/** Whole Heat Phase: every unit in initiative order (HEAT-030). The end-of-phase steps (INIT-013) run afterwards. */
export function heatPhase(state: GameState): Stepped {
  let s = state
  const events: GameEvent[] = []
  for (const id of initiativeOrder(s)) {
    const r = heatPhaseUnit(s, id)
    s = r.state
    events.push(...r.events)
  }
  return { state: s, events }
}
