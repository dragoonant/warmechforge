// The ONE PSR queue and falls (10 §14, 00 §7). Pure: state in, { state, events } out.
import type { DamageSourceKind, GameEvent } from './events'
import type { FallPreview } from './index'
import { hitCount } from './heat'
import { p2d6AtLeast } from './index'
import { addPilotHit, initiativeOrder, patchUnit } from './pilot'
import type { Stepped } from './pilot'
import { roll } from './rng'
import { HIT_TABLE, columnFor } from './hitloc'
import type { Column } from './hitloc'
import type {
  ArmorSide, AttackDirection, GameState, Loc, Mod, ModCode, PsrEntry, PsrReason, UnitId, UnitState,
} from './types'
import { EngineInvariantError } from './types'

// ---------- persistent modifiers (PSR-010..014) ----------
const LEG_TOKENS: readonly [string, number][] = [['hip', 1], ['upperLeg', 1], ['lowerLeg', 1], ['foot', 0]]

/** Persistent PSR modifier lines: gyro +2 each, hip/upper/lower leg +1 each, foot 0, destroyed leg +5 replacing that leg's mods. */
export function persistentMods(u: UnitState): Mod[] {
  const mods: Mod[] = []
  const gyro = hitCount(u, 'gyro')
  if (gyro > 0) mods.push({ code: 'gyro', value: 2 * gyro })
  for (const leg of ['LL', 'RL'] as const) {
    if (u.locs[leg].destroyed) { mods.push({ code: 'legDestroyed', value: 5, detail: leg }); continue }
    for (const [token, per] of LEG_TOKENS) {
      const n = u.slots[leg].filter((s) => s.hit && s.token === token).length
      if (n > 0 && per > 0) mods.push({ code: token as ModCode, value: per * n, detail: leg })
    }
  }
  return mods
}
const sum = (mods: readonly Mod[]): number => mods.reduce((a, m) => a + m.value, 0)

const REASON_CODE: Partial<Record<PsrReason, ModCode>> = {
  damage20: 'damage20', charged: 'charged', dfaTarget: 'dfa', chargeMade: 'chargeMade', dfaMade: 'dfaMade', stand: 'stand',
  runWater: 'water', landWater: 'water', fallFromAbove: 'fallFromAbove',
}
const eventMod = (e: PsrEntry): Mod => ({ code: REASON_CODE[e.reason] ?? 'other', value: e.mod, detail: e.reason })

// ---------- queue ----------
export interface PsrRequest { unitId: UnitId; reason: PsrReason; mod: number; auto: boolean; when: PsrEntry['when']; levels?: number }

/** The only way a PSR enters the queue (00 §7). */
export function queuePsr(state: GameState, req: PsrRequest): Stepped & { entry: PsrEntry } {
  const psrSeq = state.psrSeq + 1
  const entry: PsrEntry = { id: `p:${psrSeq}`, unitId: req.unitId, reason: req.reason, mod: req.mod, auto: req.auto, when: req.when, phase: state.phase }
  if (req.levels !== undefined) entry.levels = req.levels
  const s: GameState = {
    ...state,
    psrSeq,
    psr: { queue: [...state.psr.queue, entry], history: { ...state.psr.history, [req.unitId]: [...(state.psr.history[req.unitId] ?? []), entry] } },
  }
  return { state: s, events: [{ type: 'PsrQueued', psrId: entry.id, unitId: req.unitId, reason: req.reason, mod: req.mod, auto: req.auto }], entry }
}

/** TN breakdown for an entry (PSR-001): endOfPhase entries share the phase's summed event mods; Movement ones use their own. */
export function psrTarget(state: GameState, entry: PsrEntry): { tn: number; mods: Mod[] } {
  const u = state.units[entry.unitId]!
  const mods: Mod[] = [{ code: 'piloting', value: u.pilot.piloting }, ...persistentMods(u)]
  if (entry.when === 'endOfPhase') {
    for (const h of state.psr.history[entry.unitId] ?? []) if (h.when === 'endOfPhase' && h.mod !== 0) mods.push(eventMod(h))
  } else if (entry.mod !== 0) mods.push(eventMod(entry))
  if (entry.reason === 'sensorCheck') {
    const n = hitCount(u, 'sensors')
    if (n > 0) mods.push({ code: 'sensors', value: n })
  }
  return { tn: sum(mods), mods }
}

// ---------- falls (PSR-050..058) ----------
export interface FallDeps {
  /** The ONE damage pipeline (damage.ts). Wired by the engine; tests inject a stub. */
  applyDamage(state: GameState, i: { unitId: UnitId; amount: number; location: Loc; side: ArmorSide; source: DamageSourceKind }): Stepped
}
export const fallDeps: FallDeps = {
  applyDamage() { throw new EngineInvariantError('fallDeps.applyDamage not wired (damage.ts)') },
}

const isTorso = (l: Loc): boolean => l === 'CT' || l === 'LT' || l === 'RT'

/** Damage groups in fives, the leftover last (HITLOC-010). */
export function damageGroups(total: number): number[] {
  const g: number[] = []
  for (let left = total; left > 0; left -= 5) g.push(Math.min(5, left))
  return g
}
const waterDepthAt = (state: GameState, u: UnitState): number => {
  if (!u.pos) return 0
  for (const h of Object.values(state.board.hexes)) if (h.hex.q === u.pos.q && h.hex.r === u.pos.r) return h.depth
  return 0
}
/** PSR-052 + PSR-054: ceil(tonnage / 10) x (levels + 1), halved (round down) if the fall ends in water. */
export function fallDamage(tonnage: number, levels: number, inWater: boolean): number {
  const d = Math.ceil(tonnage / 10) * (levels + 1)
  return inWater ? Math.floor(d / 2) : d
}
/** Seatbelt TN: Piloting + persistent + levels fallen (PSR-056). */
export function seatbeltTn(u: UnitState, levels: number): number { return u.pilot.piloting + sum(persistentMods(u)) + levels }

export function fallPreview(state: GameState, unitId: UnitId, levels = 0): FallPreview {
  const u = state.units[unitId]!
  const damage = fallDamage(u.tonnage, levels, waterDepthAt(state, u) >= 1)
  const tn = seatbeltTn(u, levels)
  const ways = [0, 0, 1, 2, 3, 4, 5, 6, 5, 4, 3, 2, 1]
  const locations: Partial<Record<Loc, number>> = {}
  for (const c of ['front', 'right', 'left'] as Column[]) for (let t = 2; t <= 12; t++) locations[HIT_TABLE[c][t]!] = (locations[HIT_TABLE[c][t]!] ?? 0) + ways[t]! / 36 / 3
  return { damage, groups: damageGroups(damage), locations, seatbeltTn: tn, pPilotHit: u.shutdown || !u.pilot.conscious ? 1 : 1 - p2d6AtLeast(tn) }
}

/** Makes a unit fall where it stands. Only a failed stand attempt reaches here while prone (MOVE-042: a 0-level fall). */
export function fall(state: GameState, unitId: UnitId, levels = 0): Stepped {
  let s = state
  const u = s.units[unitId]!
  const staged: GameEvent[] = []
  const hex = u.pos!
  const inWater = waterDepthAt(s, u) >= 1
  const immobile = isImmobile(u)

  // seatbelt first (PSR-056 / PSR-057), then side, then one location per group
  let seatbeltHit: 'seatbelt' | 'fallImmobile' | null = null
  const sbTn = seatbeltTn(u, levels)
  if (immobile) seatbeltHit = 'fallImmobile'
  else if (sbTn > 12) seatbeltHit = 'seatbelt'
  else {
    const r = roll(s, { count: 2, sides: 6, purpose: 'seatbelt', unitId, target: sbTn, reason: 'seatbelt' })
    s = r.state
    staged.push(r.event)
    if (!r.event.success) seatbeltHit = 'seatbelt'
  }
  const side = roll(s, { count: 1, sides: 6, purpose: 'fallSide', unitId, reason: 'fall' })
  s = side.state
  // RULING: 2026 [CL O8] only moves the rear result from 4 to 1; side results stay (1 rear, 2-3 right, 4 front, 5-6 left)
  const sideRoll = side.event.total
  const rear = sideRoll === 1
  const direction: AttackDirection = rear ? 'rear' : sideRoll <= 3 ? 'right' : sideRoll === 4 ? 'front' : 'left'
  const column: Column = columnFor(direction)
  const damage = fallDamage(u.tonnage, levels, inWater)
  const hits: { amount: number; location: Loc; sideCol: ArmorSide; roll: number }[] = []
  const rolls: GameEvent[] = [side.event]
  for (const amount of damageGroups(damage)) {
    const r = roll(s, { count: 2, sides: 6, purpose: 'fallLocation', unitId, reason: 'fall' })
    s = r.state
    rolls.push(r.event)
    const location = HIT_TABLE[column][r.event.total]!
    hits.push({ amount, location, sideCol: rear && isTorso(location) ? 'rear' : 'front', roll: r.event.total })
  }

  const events: GameEvent[] = [{ type: 'UnitFell', unitId, hex, levels, facing: u.facing, damage, column: rear ? 'rear' : 'front', inWater }, ...staged]
  s = patchUnit(s, unitId, { prone: true, move: { ...u.move, fell: true } })
  if (seatbeltHit) {
    const p = addPilotHit(s, unitId, seatbeltHit)
    s = p.state
    events.push(...p.events)
  }
  events.push(rolls[0]!)
  hits.forEach((h, i) => {
    events.push(rolls[i + 1]!)
    events.push({ type: 'HitLocated', attackId: null, unitId, group: h.amount, damage: h.amount, table: 'standard', direction, roll: h.roll, location: h.location, side: h.sideCol, tac: false })
    const d = fallDeps.applyDamage(s, { unitId, amount: h.amount, location: h.location, side: h.sideCol, source: 'fall' })
    s = d.state
    events.push(...d.events)
  })
  return { state: s, events }
}

const isImmobile = (u: UnitState): boolean => u.shutdown !== null || !u.pilot.conscious || u.pilot.dead

// ---------- resolution (00 §7) ----------
export interface PsrScope { when: PsrEntry['when'][]; unitIds?: UnitId[] }

/** Resolves queued PSRs in scope, unit by unit in initiative order, one entry at a time (PSR-002). */
export function resolvePsrs(state: GameState, scope: PsrScope): Stepped {
  let s = state
  const events: GameEvent[] = []
  for (const unitId of initiativeOrder(s)) {
    if (scope.unitIds && !scope.unitIds.includes(unitId)) continue
    const mine = s.psr.queue.filter((e) => e.unitId === unitId && scope.when.includes(e.when))
    if (mine.length === 0) continue
    s = { ...s, psr: { ...s.psr, queue: s.psr.queue.filter((e) => !mine.includes(e)) } }
    const discard = (e: PsrEntry, why: 'alreadyFell' | 'prone' | 'destroyed'): void => {
      events.push({ type: 'PsrDiscarded', psrId: e.id, unitId, reason: e.reason, why })
    }
    const u0 = s.units[unitId]!
    if (u0.status === 'destroyed' || u0.doomed) { mine.forEach((e) => discard(e, 'destroyed')); continue }

    let entries = mine
    if (u0.prone) {
      entries = []
      for (const e of mine) (e.reason === 'stand' || e.reason === 'seatbelt' ? entries.push(e) : discard(e, 'prone'))
    }
    const fallsOn = (e: PsrEntry, rest: PsrEntry[]): void => {
      const f = fall(s, unitId, e.levels ?? 0)
      s = f.state
      events.push(...f.events)
      rest.forEach((r) => discard(r, 'alreadyFell'))
    }
    // automatic falls first (PSR-020)
    const autoE = entries.find((e) => e.auto && !s.units[unitId]!.prone)
    if (autoE) {
      events.push({ type: 'PsrResolved', psrId: autoE.id, unitId, reason: autoE.reason, tn: 0, mods: [], roll: null, success: false, auto: true })
      fallsOn(autoE, entries.filter((e) => e !== autoE))
      continue
    }
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i]!
      const rest = entries.slice(i + 1)
      const cur = s.units[unitId]!
      const { tn, mods } = psrTarget(s, e)
      const sensor = e.reason === 'sensorCheck'
      const standing = !cur.prone
      let success: boolean
      let rollTotal: number | null = null
      let auto = false
      if (standing && isImmobile(cur) && !sensor) { success = false; auto = true } // PSR-005
      else if (tn > 12) { success = false; auto = true } // PSR-003
      else {
        const r = roll(s, { count: 2, sides: 6, purpose: sensor ? 'sensorCheck' : 'psr', unitId, target: tn, reason: e.reason, mods })
        s = r.state
        events.push(r.event)
        success = r.event.success === true
        rollTotal = r.event.total
      }
      events.push({ type: 'PsrResolved', psrId: e.id, unitId, reason: e.reason, tn, mods, roll: rollTotal, success, auto })
      if (!success && !sensor && (standing || e.reason === 'stand')) { fallsOn(e, rest); break }
    }
  }
  return { state: s, events }
}
