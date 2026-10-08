// FROZEN after M0: named code-hook points for equipment and SPAs, and the hook interface (00 §11.4).
// Data names a hook with `code` / `hook` (20 §12.2, §7.2); implementations are registered in src/engine/code-hooks.ts.
import type { GameEvent } from './events'
import type { AttackId, GameState, HeatEntry, Id, LocalId, Loc, Mod, PsrReason, RollPurpose, UnitId } from './types'

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
  movement: 'movement.ts currentMp() and the Movement Phase move handler (sprint MP, escalating failure, RAC unjam)',
  attackDeclare: 'phases/ranged.ts and phases/physical.ts validation of each shot (may reject or add constraints)',
  toHit: 'tohit.ts modifier list (extra Mod lines)',
  attackRolled: 'phases/ranged.ts right after the toHit DiceRolled (RAC jam, capacitor)',
  hitLocation: 'hitloc.ts after the location roll (location override)',
  cluster: 'cluster.ts cluster roll modifier',
  damage: 'damage.ts per hit before armor (damage adjustment, e.g. ferro-lamellor)',
  crit: 'crits.ts when a slot holding the item is hit (autocannon first crit, explosions, CASE)',
  psr: 'psr.ts TN modifier lines',
  heat: 'heat.ts Heat Phase ledger entries and dissipation adjustments',
  consciousness: 'pilot.ts consciousness and recovery TN modifier lines',
  endPhase: 'phases/end.ts once per unit per End Phase (escalating failure step down, jam clearing)',
}

/** Hook names fixed by 20 §12.2. 'ultraRapid' is a NO-OP that never rolls: 2026 W11, Ultra ACs do not jam (validate-data: Ultra weapons carry no jamHook). SPA hooks are 'spa.<name>'. */
export const EQUIPMENT_HOOKS = [
  'racJam', 'ultraRapid', 'xPulse', 'improvedHeavyGauss', 'ppcCapacitor', 'targetingComputer', 'supercharger',
  'caseProtect', 'caseIIProtect', 'ferroLamellor',
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

// ---------- signatures (bodies land in M2, code-hooks.ts) ----------
export function collectHooks(_state: GameState, _unitId: UnitId, _point: HookPoint): BoundHook[] {
  throw new Error('hooks.collectHooks: not implemented (M2)')
}
