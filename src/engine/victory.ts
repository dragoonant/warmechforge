// Crippled flag, forced withdrawal trigger, victory and game over (11 sections 2, 3, 5; 10 SCN-020..031).
// Pure: state in, { state, events } out. Mission data arrives through the registered bundle (the engine never imports src/data).
import type { Mission } from '../data/types'
import type { GameEvent } from './events'
import { bundleFor } from './bundles'
import { hitCount } from './heat'
import type { Stepped } from './pilot'
import { patchUnit } from './pilot'
import type {
  DataBundle, GameResult, GameState, PendingDecision, PlayerId, UnitId, UnitState,
} from './types'

type WeaponLite = { ammo?: string[] }

/** A mount that is a weapon in the data and can still fire this turn (not destroyed, not jammed, location intact, ammo left). */
function canFire(data: DataBundle, u: UnitState, mountId: string): boolean {
  const m = u.mounts[mountId]!
  const w = data.weapons[m.item] as WeaponLite | undefined
  if (!w) return false
  if (m.destroyed || m.jammed || u.locs[m.location].destroyed) return false
  if (w.ammo && w.ammo.length > 0) {
    const ok = new Set(w.ammo)
    return Object.values(u.bins).some((b) => ok.has(b.ammo) && b.shots > 0 && !b.exploded && !u.locs[b.location].destroyed)
  }
  return true
}

/** SCN-021 / 11 section 2.2: leg destroyed, no weapon able to fire, gyro destroyed, or 2+ engine crits. */
export function computeCrippled(u: UnitState, data: DataBundle): boolean {
  if (u.locs.LL.destroyed || u.locs.RL.destroyed) return true
  if (hitCount(u, 'gyro') >= 2) return true
  if (hitCount(u, 'engine') >= 2) return true
  const weaponMounts = Object.values(u.mounts).filter((m) => data.weapons[m.item])
  if (weaponMounts.length > 0 && !weaponMounts.some((m) => canFire(data, u, m.id))) return true
  return false
}

/** 11 section 3.2: the forced-withdrawal trigger list (crippled is checked by the caller's flag). */
export function withdrawalTrigger(u: UnitState): boolean {
  return u.crippled || u.locs.LT.destroyed || u.locs.RT.destroyed || u.pilot.hits >= 4 || hitCount(u, 'sensors') >= 2
}

const live = (u: UnitState): boolean => (u.status === 'active' || u.status === 'withdrawing') && !u.doomed

/**
 * Re-checks `crippled` and, when forced withdrawal is on, the withdrawal trigger for every unit (00 5.4 e, 11 2.2 and 3.2).
 * Emits StatusChanged on any change. A withdrawing unit stays withdrawing.
 */
export function refreshStatus(state: GameState, data?: DataBundle): Stepped {
  const d = data ?? bundleFor(state)
  let s = state
  const events: GameEvent[] = []
  for (const id of s.unitOrder) {
    let u = s.units[id]!
    if (!live(u)) continue
    const crippled = computeCrippled(u, d)
    const was = u.status
    let changed = false
    if (crippled !== u.crippled) { s = patchUnit(s, id, { crippled }); u = s.units[id]!; changed = true }
    if (s.setup.forcedWithdrawal && u.status === 'active' && withdrawalTrigger(u)) {
      s = patchUnit(s, id, { status: 'withdrawing' }); u = s.units[id]!; changed = true
    }
    if (changed) events.push({ type: 'StatusChanged', unitId: id, status: u.status, crippled: u.crippled, was })
  }
  return { state: s, events }
}

/** Booked destruction becomes real at end of phase (00 5.4 a). */
export function applyDoomed(state: GameState): Stepped {
  let s = state
  const events: GameEvent[] = []
  for (const id of s.unitOrder) {
    const u = s.units[id]!
    if (!u.doomed || u.status === 'destroyed') continue
    s = patchUnit(s, id, { status: 'destroyed', destroyedCause: u.doomed, doomed: null })
    events.push({ type: 'UnitDestroyed', unitId: id, cause: u.doomed, effective: true })
    events.push({ type: 'StatusChanged', unitId: id, status: 'destroyed', crippled: u.crippled, was: u.status })
  }
  return { state: s, events }
}

// ---------- elimination and victory ----------
/** 11 section 2.1: destroyed, withdrawn and surrendered always count; crippled only where the mission says so. */
export function isEliminated(u: UnitState, cripple: boolean): boolean {
  if (u.status === 'destroyed' || u.status === 'withdrawn' || u.status === 'surrendered') return true
  return cripple && u.crippled && (u.status === 'active' || u.status === 'withdrawing')
}
const sideUnits = (s: GameState, p: PlayerId): UnitState[] => s.unitOrder.map((id) => s.units[id]!).filter((u) => u.owner === p)
const sideGone = (s: GameState, p: PlayerId, cripple: boolean): boolean => {
  const us = sideUnits(s, p)
  return us.length > 0 && us.every((u) => isEliminated(u, cripple))
}
const baseBv = (data: DataBundle, u: UnitState): number => (data.mechs[u.mechId] as { bv?: number } | undefined)?.bv ?? 0

/**
 * First mission victory entry that resolves (11 section 5), or null. Never resolves inside a simultaneous window (a draw by
 * mutual destruction needs the whole phase). `atEndPhase` enables the turn limit. `objective` entries have no hook registry yet (RULING).
 */
export function checkVictory(state: GameState, opts: { atEndPhase?: boolean } = {}, data?: DataBundle): GameResult | null {
  if (state.damageWindow === 'simultaneous') return null
  const d = data ?? bundleFor(state)
  const mission = d.missions[state.setup.missionId] as Mission | undefined
  const entries = mission?.victory ?? [{ type: 'eliminate' as const, cripple: false }]
  const cripple = entries.some((e) => e.type === 'eliminate' && e.cripple === true)
  for (const e of entries) {
    if (e.type === 'eliminate') {
      const c = e.cripple === true
      const a = sideGone(state, 'A', c), b = sideGone(state, 'B', c)
      if (a && b) return { winner: null, reason: 'draw', turn: state.turn }
      if (a || b) return { winner: a ? 'B' : 'A', reason: 'eliminate', turn: state.turn }
    } else if (e.type === 'turnLimitBV') {
      const limit = state.setup.turnLimit
      if (!opts.atEndPhase || limit === null || limit === undefined || state.turn < limit) continue
      const score = (p: PlayerId): number => sideUnits(state, p === 'A' ? 'B' : 'A').filter((u) => isEliminated(u, cripple)).reduce((n, u) => n + baseBv(d, u), 0)
      const sa = score('A'), sb = score('B')
      return { winner: sa === sb ? null : sa > sb ? 'A' : 'B', reason: sa === sb ? 'draw' : 'turnLimitBV', turn: state.turn }
    }
  }
  return null
}

/** Ends the game: result, phase 'ended', GameEnded, and the gameOver decision (the answer is an ack). */
export function endGame(state: GameState, result: GameResult): Stepped {
  const id = `d:${state.decisionSeq + 1}`
  const pending: PendingDecision = {
    id, player: 'A', kind: 'gameOver', phase: 'ended', step: 'game.over', unitId: null, context: { phase: 'ended', result },
    options: [{ id: 'ack', label: 'Close the battle report', action: { type: 'ack', decisionId: id, player: 'A' } }],
    canPass: false,
  }
  const s: GameState = { ...state, result, phase: 'ended', step: 'game.over', decisionSeq: state.decisionSeq + 1, pending, selection: null }
  return { state: s, events: [{ type: 'GameEnded', result }] }
}

/** Convenience: unit ids of a side that are still in play. */
export const unitsInPlay = (s: GameState, p: PlayerId): UnitId[] => sideUnits(s, p).filter(live).map((u) => u.id)
