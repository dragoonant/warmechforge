// FROZEN after M0: named code-hook points for equipment and SPAs, and the hook interface (00 §11.4).
// Data names a hook with `code` / `hook` (20 §12.2, §7.2); implementations are registered in src/engine/code-hooks.ts.
import type { GameEvent } from './events'
import type { AttackId, DataBundle, GameState, HeatEntry, Id, LocalId, Loc, Mod, PsrReason, RollPurpose, UnitId } from './types'
import { EngineInvariantError } from './types'
import { CODE_HOOKS } from './code-hooks'
import { bundleFor } from './bundles'

// ---------- hook points ----------
// Superset of the SPA `windows` vocabulary in 20 §7.2 (plus 'attackRolled').
export const HOOK_POINTS = [
  'passive', 'setup', 'initiative', 'movement', 'attackDeclare', 'toHit', 'attackRolled', 'hitLocation', 'cluster',
  'damage', 'crit', 'psr', 'heat', 'consciousness', 'endPhase',
] as const
export type HookPoint = (typeof HOOK_POINTS)[number]

/** Where core code calls each point (60-testing §7 checks every registered hook is reachable from one of these). */
export const HOOK_WIRING: Readonly<Record<HookPoint, string>> = {
  passive: 'query.* and every point below read passive values through collectHooks(state, unitId, "passive")',
  setup: 'setup.ts createInitialState, once per unit after its record is built',
  initiative: 'phases/initiative.ts, the side modifier added to each initiative roll',
  movement: 'movement.ts jumpMp()/currentMp() MP bonuses (partial wing jump, MASC run) and executeMove (RAC unjam, MASC activation)',
  attackDeclare: 'phases/ranged.ts declareFire validation of each shot, items on or linked to the firing mount (may reject)',
  toHit: 'tohit.ts modifier list (extra Mod lines)',
  attackRolled: 'damage.ts resolveAttack right after the toHit roll, items on or linked to the firing mount (RAC jam, capacitor)',
  hitLocation: 'hitloc.ts after the location roll (location override)',
  cluster: 'cluster.ts ecmBlocksArtemis: hostile items that change the cluster roll of an attack (Guardian ECM vs Artemis IV)',
  damage: 'damage.ts weaponDamageBonus: per-hit damage of a ranged shot, items linked to the firing mount (PPC capacitor)',
  crit: 'crits.ts when a slot holding the item is hit (autocannon first crit, explosions, CASE)',
  psr: 'psr.ts TN modifier lines',
  heat: 'heat.ts dissipation(): dissipation adjustments (partial wing, coolant pod)',
  consciousness: 'pilot.ts consciousness and recovery TN modifier lines',
  endPhase: 'phases/end.ts runEndPhaseA once per unit on the map (escalating failure step down)',
}

/** Hook names fixed by 20 §12.2. 'ultraRapid' is a NO-OP that never rolls: 2026 W11, Ultra ACs do not jam (validate-data: Ultra weapons carry no jamHook). SPA hooks are 'spa.<name>'. */
export const EQUIPMENT_HOOKS = [
  'racJam', 'ultraRapid', 'xPulse', 'improvedHeavyGauss', 'ppcCapacitor', 'targetingComputer', 'supercharger',
  'caseProtect', 'caseIIProtect', 'ferroLamellor',
  // M6 (additive, 00 §14): equipment the stock roster carries
  'coolantPod', 'masc', 'partialWing', 'beagleProbe', 'guardianEcm',
] as const
export type EquipmentHookName = (typeof EQUIPMENT_HOOKS)[number]
export type HookName = EquipmentHookName | `spa.${string}`

// ---------- runtime context ----------
export interface HookContext {
  state: GameState
  point: HookPoint
  unitId: UnitId // the unit carrying the item / SPA
  sourceId: Id // item or SPA id
  mountId?: LocalId // the mount carrying the item, if any
  attackId?: AttackId
  targetId?: UnitId
  location?: Loc
  roll?: { purpose: RollPurpose; total: number; dice: number[] }
  params?: Record<string, unknown>
}
export interface HookResult { state: GameState; events: GameEvent[] }

/** One registered hook. Each method is optional and only called at its point. Pure: never mutates ctx.state. */
export interface CodeHook {
  name: HookName
  points: readonly HookPoint[]
  setup?(ctx: HookContext): HookResult
  initiative?(ctx: HookContext): number
  movement?(ctx: HookContext): { mpBonus?: number; result?: HookResult }
  attackDeclare?(ctx: HookContext): { reject?: string } | null
  toHit?(ctx: HookContext): Mod[]
  attackRolled?(ctx: HookContext): HookResult
  hitLocation?(ctx: HookContext, location: Loc): Loc
  cluster?(ctx: HookContext): number
  damage?(ctx: HookContext, amount: number): number
  crit?(ctx: HookContext): { handled: boolean; result?: HookResult }
  psr?(ctx: HookContext, reason: PsrReason): Mod[]
  heat?(ctx: HookContext): { entries?: HeatEntry[]; dissipationDelta?: number }
  consciousness?(ctx: HookContext): Mod[]
  endPhase?(ctx: HookContext): HookResult
}
export type CodeHookRegistry = Record<string, CodeHook>

export interface BoundHook { hook: CodeHook; unitId: UnitId; sourceId: Id; mountId?: LocalId }

// ---------- registry and lookup (M2) ----------
// code-hooks.ts holds the implementations as plain data (no runtime import of this module), so the registry is complete as soon
// as any engine module loads hooks.ts, whichever entry point a caller or a test uses.
const REGISTRY: CodeHookRegistry = Object.fromEntries(CODE_HOOKS.map((h) => [h.name, h]))
/** Every registered hook by name (read-only view; tests and validate-data read it). */
export function registeredHooks(): Readonly<CodeHookRegistry> { return REGISTRY }

interface CodeCarrier { code?: string[]; rapidFire?: { jamHook?: string } }
/** Hook names a record carries: its `code` list, then a rapid-fire weapon's `rapidFire.jamHook` (20 §3.1) when not already listed. */
const namesOf = (r: CodeCarrier | undefined): string[] => {
  const code = r?.code ?? []
  const jam = r?.rapidFire?.jamHook
  return jam && !code.includes(jam) ? [...code, jam] : code
}
interface SpaCarrier { hook?: string }
function lookup(name: string): CodeHook {
  const h = REGISTRY[name]
  if (!h) throw new EngineInvariantError(`code hook ${name} is named in data but not registered in code-hooks.ts`)
  return h
}

/**
 * The hooks a unit carries at one point, in a fixed order: intact mounts (record order, each item's data `code` list plus a
 * rapid-fire weapon's `rapidFire.jamHook`), then
 * ammo bins (loaded ammo's `code`), then pilot SPAs ('spa.<hook>'). A destroyed mount or a mount in a destroyed location
 * carries no hook. Unknown names throw EngineInvariantError (validate-data refuses them first).
 */
export function collectHooks(state: GameState, unitId: UnitId, point: HookPoint): BoundHook[] {
  if (!state.units[unitId]) return []
  return collectHooksWith(bundleFor(state), state, unitId, point)
}
/** collectHooks with the bundle given (damage-pipeline Work contexts carry their own bundle). */
export function collectHooksWith(data: DataBundle, state: GameState, unitId: UnitId, point: HookPoint): BoundHook[] {
  const u = state.units[unitId]
  if (!u) return []
  const out: BoundHook[] = []
  for (const m of Object.values(u.mounts)) {
    if (m.destroyed || u.locs[m.location].destroyed) continue
    for (const name of namesOf(data.byId[m.item] as CodeCarrier | undefined)) {
      const hook = lookup(name)
      if (hook.points.includes(point)) out.push({ hook, unitId, sourceId: m.item, mountId: m.id })
    }
  }
  for (const b of Object.values(u.bins)) {
    if (b.exploded || u.locs[b.location].destroyed) continue
    for (const name of (data.byId[b.ammo] as CodeCarrier | undefined)?.code ?? []) {
      const hook = lookup(name)
      if (hook.points.includes(point)) out.push({ hook, unitId, sourceId: b.ammo, mountId: b.id })
    }
  }
  for (const spa of u.pilot.spas) {
    const name = (data.spas[spa] as SpaCarrier | undefined)?.hook
    if (!name) continue
    const hook = lookup(name.startsWith('spa.') ? name : `spa.${name}`)
    if (hook.points.includes(point)) out.push({ hook, unitId, sourceId: spa })
  }
  return out
}
