// Equipment rules behind the code hooks (10 §18: EQUIP-011, EQUIP-013, EQUIP-016..022). Pure helpers: state in, state out.
// code-hooks.ts imports this file and hooks.ts imports code-hooks.ts, so this module must not import hooks.ts, damage.ts,
// crits.ts, movement.ts or heat.ts at runtime. The two collaborators it needs from the damage pipeline (a crit check and a
// component explosion) are late-bound through `equipDeps`, wired by crits.ts and damage.ts when they load.
import type { GameEvent } from './events'
import { roll } from './rng'
import { patchUnit } from './pilot'
import type { Stepped } from './pilot'
import type { DataBundle, EscalatingState, GameState, Loc, LocalId, MountState, UnitId, UnitState } from './types'

// ---------- late-bound collaborators ----------
export interface EquipDeps {
  /** One crit check on a location (crits.ts critCheck). */
  critCheck(state: GameState, p: { unitId: UnitId; location: Loc; why: 'masc' }, data: DataBundle): Stepped
  /** Destroys a mount (ComponentDestroyed) and explodes it for `raw` points under AMMO-010/011/012 (damage.ts). */
  explodeComponent(state: GameState, unitId: UnitId, mountId: LocalId, raw: number, data: DataBundle): Stepped
}
const unwired = (): never => { throw new Error('equipDeps used before crits.ts / damage.ts loaded') }
export const equipDeps: EquipDeps = { critCheck: unwired, explodeComponent: unwired }

// ---------- data helpers ----------
interface CodeCarrier { code?: string[]; flags?: string[] }
/** Hook names a data record carries (`code`). */
export const codesOf = (data: DataBundle, item: string): string[] => (data.byId[item] as CodeCarrier | undefined)?.code ?? []
const live = (u: UnitState, m: MountState): boolean => !m.destroyed && !u.locs[m.location].destroyed
/** Mounts whose item names this hook, in record order (destroyed ones included). */
export function mountsWithHook(data: DataBundle, u: UnitState, hook: string): MountState[] {
  return Object.values(u.mounts).filter((m) => codesOf(data, m.item).includes(hook))
}

// ---------- PPC capacitor (EQUIP-013, EQUIP-016) ----------
export const CAPACITOR_HEAT = 5
export const CAPACITOR_DAMAGE = 5
/** The working capacitor linked to a weapon mount (intact, in an intact location), or null. */
export function capacitorFor(data: DataBundle, u: UnitState, weaponMountId: LocalId): MountState | null {
  return mountsWithHook(data, u, 'ppcCapacitor').find((m) => m.linkedTo === weaponMountId && live(u, m)) ?? null
}
/** Charging this turn (declared in this turn's Ranged Attack Phase): the mount's firedTurn is the turn it charged. */
export const capacitorCharging = (state: GameState, cap: MountState): boolean => !cap.destroyed && cap.firedTurn === state.turn
/** Charged last turn and not yet spent: the linked PPC's shot this turn deals +5 (a charge not fired this turn is lost). */
export const capacitorReady = (state: GameState, cap: MountState): boolean => !cap.destroyed && cap.firedTurn !== null && cap.firedTurn === state.turn - 1

// ---------- coolant pod (EQUIP-017) ----------
export const COOLANT_POD_EXPLOSION = 10
const isSinkItem = (item: string): boolean => item.includes('heat-sink')
/** Operable heat sinks (engine-held always, mounted ones intact in an intact location), counted as sinks, not points. */
export function operableSinks(u: UnitState): number {
  const mounts = Object.values(u.mounts).filter((m) => isSinkItem(m.item))
  const engineHeld = Math.max(0, u.sinks.count - mounts.length)
  return engineHeld + mounts.filter((m) => live(u, m)).length
}
/** A pod is used once per game; the mount's firedTurn is the turn it was vented. */
export const podUsed = (m: MountState): boolean => m.firedTurn !== null
/** Vented this turn: adds one point of dissipation per operable heat sink in this turn's Heat Phase (RULING in 10 EQUIP-017). */
export const podActive = (state: GameState, u: UnitState, m: MountState): boolean => live(u, m) && m.firedTurn === state.turn
export const coolantBonus = (u: UnitState): number => operableSinks(u)

// ---------- MASC and escalating failure (EQUIP-020, EQUIP-021) ----------
/** 2026 [CL W4]: avoid numbers follow the consciousness scale; the top one repeats and never fails automatically. */
export const ESCALATING_AVOID = [3, 5, 7, 10, 11] as const
export const escalatingOf = (u: UnitState, mountId: LocalId): EscalatingState => u.escalating[mountId] ?? { step: 0, usedThisTurn: false }
export const avoidNumber = (e: EscalatingState): number => ESCALATING_AVOID[Math.min(e.step, ESCALATING_AVOID.length - 1)]!
/** Run MP with MASC: walk x 2 (in place of ceil(1.5 x walk)). */
export const mascRun = (walk: number): number => 2 * walk
/** The intact MASC mount of a unit, or null. */
export function workingMasc(data: DataBundle, u: UnitState): MountState | null {
  return mountsWithHook(data, u, 'masc').find((m) => live(u, m)) ?? null
}
/** MASC already activated this turn (and still working). */
export function mascActive(data: DataBundle, u: UnitState): boolean {
  const m = workingMasc(data, u)
  return !!m && escalatingOf(u, m.id).usedThisTurn
}

/**
 * Activation (EQUIP-020/021): roll 2d6 against the current avoid number, then the number steps up. Failure: the MASC is destroyed
 * and one crit check is made on a random leg (2026 [CL W48]; 1d6 1-3 left leg, 4-6 right leg; a destroyed leg passes it to the
 * other). Returns ok = the boost applies this turn.
 */
export function activateMasc(state: GameState, unitId: UnitId, mountId: LocalId, data: DataBundle): Stepped & { ok: boolean } {
  const u = state.units[unitId]!
  const e = escalatingOf(u, mountId)
  const tn = avoidNumber(e)
  const r = roll(state, { count: 2, sides: 6, purpose: 'escalatingFailure', unitId, target: tn, reason: 'masc' })
  let s = r.state
  const events: GameEvent[] = [r.event]
  const next: EscalatingState = { step: Math.min(e.step + 1, ESCALATING_AVOID.length - 1), usedThisTurn: true }
  const u1 = s.units[unitId]!
  s = patchUnit(s, unitId, { escalating: { ...u1.escalating, [mountId]: next } })
  if (r.event.success) {
    events.push({ type: 'EquipmentUsed', unitId, mountId, use: 'masc', amount: tn })
    return { state: s, events, ok: true }
  }
  // failure: the system is wrecked, the legs take the strain
  const u2 = s.units[unitId]!
  const m = u2.mounts[mountId]!
  s = patchUnit(s, unitId, { mounts: { ...u2.mounts, [mountId]: { ...m, destroyed: true } } })
  const token = `#${mountId}`
  events.push({ type: 'EquipmentUsed', unitId, mountId, use: 'mascFailed', amount: tn })
  events.push({ type: 'ComponentDestroyed', unitId, mountId, token, location: m.location })
  const legs = (['LL', 'RL'] as const).filter((l) => !s.units[unitId]!.locs[l].destroyed)
  if (legs.length > 0) {
    const lr = roll(s, { count: 1, sides: 6, purpose: 'tieBreak', unitId, reason: 'mascLeg' })
    s = lr.state
    events.push(lr.event)
    const pick: Loc = legs.length === 1 ? legs[0]! : lr.event.total <= 3 ? 'LL' : 'RL'
    const c = equipDeps.critCheck(s, { unitId, location: pick, why: 'masc' }, data)
    s = c.state
    events.push(...c.events)
  }
  return { state: s, events, ok: false }
}

/** End Phase (EQUIP-020): an item not used this turn steps its avoid number down one step. */
export function escalatingStepDown(state: GameState, unitId: UnitId, mountId: LocalId): Stepped {
  const u = state.units[unitId]!
  const e = u.escalating[mountId]
  if (!e || e.usedThisTurn || e.step === 0) return { state, events: [] }
  return { state: patchUnit(state, unitId, { escalating: { ...u.escalating, [mountId]: { ...e, step: e.step - 1 } } }), events: [] }
}

// ---------- rotary AC (EQUIP-011, EQUIP-022) ----------
/**
 * Jam threshold for a rapid-fire attack (RULING: TW numbers as MegaMek applies them): the weapon jams when the natural to-hit
 * roll is at or below this. 2-3 shots: 2; 4-5 shots: 3; 6 shots: 4; one shot never jams.
 */
export function racJamThreshold(shots: number): number {
  if (shots >= 6) return 4
  if (shots >= 4) return 3
  if (shots >= 2) return 2
  return 0
}
/** Unjam roll target (RULING): 2d6 >= gunnery + 3, rolled in the Movement Phase (2026 [CL W10]); the unit still acts normally. */
export const unjamTn = (u: UnitState): number => u.pilot.gunnery + 3

export function setJam(state: GameState, unitId: UnitId, mountId: LocalId, jammed: boolean): Stepped {
  const u = state.units[unitId]!
  const m = u.mounts[mountId]!
  if (m.jammed === jammed) return { state, events: [] }
  return {
    state: patchUnit(state, unitId, { mounts: { ...u.mounts, [mountId]: { ...m, jammed } } }),
    events: [{ type: 'WeaponJamChanged', unitId, mountId, jammed }],
  }
}
export function unjamRoll(state: GameState, unitId: UnitId, mountId: LocalId): Stepped {
  const u = state.units[unitId]!
  if (!u.mounts[mountId]?.jammed) return { state, events: [] }
  const r = roll(state, { count: 2, sides: 6, purpose: 'jam', unitId, target: unjamTn(u), reason: 'unjam' })
  if (!r.event.success) return { state: r.state, events: [r.event] }
  const c = setJam(r.state, unitId, mountId, false)
  return { state: c.state, events: [r.event, ...c.events] }
}

// ---------- partial wing (EQUIP-018) ----------
/** Partial wing items (data id ends with eq.partial-wing). */
export const isPartialWing = (item: string): boolean => item.endsWith('eq.partial-wing')
const slotsOf = (u: UnitState, mountId: LocalId): number => {
  let n = 0
  for (const sl of Object.values(u.slots)) for (const s of sl) if (s.token === `#${mountId}`) n++
  return n
}
/**
 * Partial wing bonuses after damage (BattleMech Manual errata v7.01): jump +2 (up to 55 t) or +1 (heavier), heat dissipation +3;
 * each wing crit cuts both by 1, minimum 0. A wing in a destroyed torso counts as fully critted (RULING). The jump bonus needs
 * some jump MP from jets (the caller checks that).
 */
export function partialWingBonuses(u: UnitState): { jump: number; heat: number } {
  const wings = Object.values(u.mounts).filter((m) => isPartialWing(m.item))
  if (wings.length === 0) return { jump: 0, heat: 0 }
  const crits = wings.reduce((n, m) => n + (u.locs[m.location].destroyed ? Math.max(m.critHits, slotsOf(u, m.id) || 1) : m.critHits), 0)
  const baseJump = u.baseMp.jump > 0 ? (u.tonnage <= 55 ? 2 : 1) : 0
  return { jump: Math.max(0, baseJump - crits), heat: Math.max(0, 3 - crits) }
}
/** The wing mount that reports the unit-level bonus (the first wing in record order still in a live location). */
export function leadWing(u: UnitState): MountState | null {
  return Object.values(u.mounts).find((m) => isPartialWing(m.item) && !u.locs[m.location].destroyed) ?? null
}
