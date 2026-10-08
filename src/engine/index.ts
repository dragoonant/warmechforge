// FROZEN after M0: public engine API (00 §2, §11, §12). M1/M2 wire the bodies to the rules modules.
// Stubs throw `not implemented (M<n>)`; signatures and result types are the contract.
import type { Action, MoveAction, PhysicalChoice } from './actions'
import type {
  ArmLoc, AttackDirection, DataBundle, Facing, GameSetup, GameState, HeatEntry, Hex, HexLabel, HitTable, LegLoc, Loc,
  LocalId, Mod, MoveMode, PendingDecision, PhysicalKind, PlayerId, PlayerView, PsrReason, RangeBand, Rejection,
  RejectionCode, SaveFile, SlotRef, StepOp, StepResult, Twist, UnitId, WorldXZ,
} from './types'
import type { GameEvent } from './events'
import { cyrb128 } from './rng'
import { bundleFor, registerBundle } from './bundles'
import { createGameImpl, legalActionsImpl, stepImpl, validateImpl } from './machine'
import {
  arcsQuery, attackPreviewQuery, explosionPreviewQuery, firePreviewQuery, heatEffectsQuery, heatScaleQuery, hexToWorldQuery,
  isKillLocationQuery, losQuery, mustWithdrawQuery, psrPreviewQuery, sheetQuery, terrainInfoQuery, threatQuery,
} from './queries'
import type { ThreatView } from './queries'
import { describeAction, describeDecision, describeEvent, describeUnit } from './describe'
import { distance as hexDistance } from './hex'
import { reachable as reachableImpl } from './movement'
import { physicalOptions as physicalOptionsImpl, physicalPreview as physicalPreviewImpl } from './physical'
import { hitLocationDistribution } from './hitloc'
import { clusterDistribution } from './cluster'
import { projectHeat } from './heat'
import { fallPreview as fallPreviewImpl } from './psr'

export type { ThreatView }

export * from './types'
export * from './actions'
export * from './events'
export * from './hooks'
export * from './rng'
export * from './decider'

export const ENGINE_VERSION = '0.1.0'


// ---------- data bundles ----------
// step(state, action) takes no bundle, so the engine keeps the bundles it has seen, keyed by version (00 §2). The registry
// lives in bundles.ts so rules modules can read it without importing this file.
export { registerBundle, bundleFor }

// ---------- reducer API (00 §2) ----------
/** Builds turn 0. Bad setup → StepResult.rejection E_BAD_SETUP (never throws). First pending: deploy or initiativeAck. */
export function createGame(setup: GameSetup, seed: string, bundle: DataBundle): StepResult {
  registerBundle(bundle)
  return createGameImpl(setup, seed, bundle)
}
/** Pure reducer. Illegal action → same state reference, events [ActionRejected], same pending, rejection. */
export function step(state: GameState, action: Action): StepResult { return stepImpl(state, action, bundleFor(state)) }
/** Answers to state.pending; never empty while a decision is open; every member passes validate. */
export function legalActions(state: GameState): Action[] { return legalActionsImpl(state, bundleFor(state)) }
/** Exactly the checks step runs, no mutation. */
export function validate(state: GameState, action: Action): Rejection | null { return validateImpl(state, action, bundleFor(state)) }

/** Folds step from createGame; stops at the first rejection and returns it. */
export function replay(setup: GameSetup, seed: string, bundle: DataBundle, actions: readonly Action[]): StepResult {
  let r = createGame(setup, seed, bundle)
  if (r.rejection) return r
  const events: GameEvent[] = [...r.events]
  for (const a of actions) {
    const next = step(r.state, a)
    if (next.rejection) return { ...next, events: [...events, ...next.events] }
    events.push(...next.events)
    r = next
  }
  return { state: r.state, events, pending: r.pending }
}

export function save(state: GameState, label = '', savedAt = ''): SaveFile {
  return {
    format: 1, engine: ENGINE_VERSION, dataVersion: state.dataVersion, setup: state.setup, seed: state.seed,
    actions: state.log, meta: { savedAt, label },
  }
}
/** Load = replay. A dataVersion mismatch → rejection E_DATA_VERSION (state of a fresh createGame). */
export function load(file: SaveFile, bundle: DataBundle): StepResult {
  if (file.dataVersion !== bundle.version) {
    const r = createGame(file.setup, file.seed, bundle)
    return { ...r, rejection: { code: 'E_DATA_VERSION', message: `save data ${file.dataVersion} ≠ bundle ${bundle.version}` } }
  }
  return replay(file.setup, file.seed, bundle, file.actions)
}

export function view(state: GameState, player: PlayerId): PlayerView { return { player, state } }

/** Stable JSON (sorted object keys) for hashing. */
export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null'
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`
  const o = v as Record<string, unknown>
  return `{${Object.keys(o).sort().filter((k) => o[k] !== undefined).map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`).join(',')}}`
}
/** INV-20 state hash: stable JSON → cyrb128, 32 hex chars. */
export function hashState(state: GameState): string {
  return cyrb128(stableStringify(state)).map((n) => n.toString(16).padStart(8, '0')).join('')
}

// ---------- query result types (00 §11) ----------
export interface PathStep {
  op: StepOp | 'enter' | 'jump' | 'stand'
  hex: Hex
  facing: Facing
  cost: { base: number; terrain: number; level: number; turn: number; total: number }
  psr: PsrReason | null
}
export interface ReachEntry {
  hex: Hex
  label: HexLabel | null
  facing: Facing
  mode: MoveMode
  path: PathStep[]
  mpUsed: number
  hexesMoved: number
  tmm: number
  attackerMod: number
  heat: number
  psrs: { reason: PsrReason; tn: number; p: number }[]
  endsProne: boolean
  /**
   * Non-null exactly when `action.attack` is set (00 §9.6). `fromHex` (always set by the engine) is the hex the unit waits in
   * until resolution: the charge's end hex, or the DFA's `dfaFrom`. Feed it to physicalPreview as `attackerAt.hex`.
   */
  physical: { kind: 'charge' | 'dfa'; targetId: UnitId; fromHex?: Hex } | null
  action: MoveAction
}
export interface LosReason {
  code: 'clear' | 'adjacent' | 'hill' | 'woods' | 'woodsBlock' | 'waterLine' | 'partialCoverHill' | 'partialCoverWater'
    | 'divided' | 'offBoard' | 'sameHex'
  hex?: Hex
  value?: number
}
/** query.los hypothetical endpoints (00 §11.5): override a unit endpoint, or put a 'Mech on a hex endpoint (default standing). */
export interface LosOptions { fromAt?: UnitAt; toAt?: UnitAt }
export interface LosVerdict {
  visible: boolean
  attackAllowed: boolean // false also for the water line (LOS-040)
  divided: boolean
  chosen: '+' | '-' | null // divided LOS: the sequence in force
  hexes: Hex[] // the sequence in force, endpoints included
  alt: Hex[] | null // the other sequence when divided
  blockers: { hex: Hex; reason: 'hill' | 'woods' }[]
  woodsPoints: number
  partialCover: boolean
  reasons: LosReason[]
}
/**
 * Hypothetical position for previews (00 §11.5). Omitted fields keep the unit's current value. `mode` drives the attacker
 * movement modifier; `hexesMoved` + `jumped` drive the target's TMM unless `tmm` is given; `immobile` forces TOHIT-017.
 */
export interface UnitAt { hex?: Hex; facing?: Facing; twist?: Twist; mode?: MoveMode; hexesMoved?: number; prone?: boolean; tmm?: number; jumped?: boolean; immobile?: boolean }
export interface AttackPreviewRequest {
  attackerId: UnitId
  mountId: LocalId
  targetId: UnitId
  binId?: LocalId
  attackerAt?: UnitAt
  targetAt?: UnitAt
  /** Omitted or null: the request's target is primary. Another unit id: this target is secondary (+1, TOHIT-024/005). */
  primaryTargetId?: UnitId | null
  aimedAt?: Loc
  propArm?: ArmLoc
  rapidShots?: number
}
export interface AttackPreview {
  legal: boolean
  reason?: RejectionCode
  why?: string // our words, for the prompt
  mountId: LocalId
  targetId: UnitId
  distance: number
  band: RangeBand
  tn: number
  mods: Mod[]
  pHit: number
  direction: AttackDirection
  table: HitTable
  partialCover: boolean
  los: LosVerdict
  heat: number
  damage: number // per hit (per missile/pellet for cluster weapons)
  cluster: { rackSize: number; expectedHits: number } | null
  expectedDamage: number
}
export interface HeatEffects {
  heat: number
  mpLoss: number
  toHitMod: number
  shutdownTn: number | null // null = no check
  autoShutdown: boolean
  ammoTn: number | null
  lifeSupportPilotHits: number
}
export interface HeatScaleRow { level: number; effects: { code: 'mp' | 'toHit' | 'shutdown' | 'autoShutdown' | 'ammo' | 'lifeSupport'; value: number }[] }
export interface HeatPlan { mode?: MoveMode; hexesJumped?: number; mounts?: LocalId[]; rapidShots?: Record<LocalId, number> }
export interface HeatProjection {
  now: number
  entries: HeatEntry[] // this turn's ledger so far plus the plan
  generated: number
  dissipation: number
  end: number
  effects: HeatEffects
}
export interface FirePlan { twist?: Twist; flip?: boolean; shots: { mountId: LocalId; targetId: UnitId; binId?: LocalId; aimedAt?: Loc; rapidShots?: number }[]; propArm?: ArmLoc }
export interface FirePreview { weapons: AttackPreview[]; primaryTargetId: UnitId | null; heat: HeatProjection & { move: number; weapons: number } }
export interface PhysicalPreviewRequest { attackerId: UnitId; kind: PhysicalKind; limb?: ArmLoc | LegLoc; targetId: UnitId; attackerAt?: UnitAt; targetAt?: UnitAt }
export interface PhysicalPreview {
  legal: boolean
  reason?: RejectionCode
  why?: string
  kind: PhysicalKind
  limb: ArmLoc | LegLoc | null
  tn: number
  mods: Mod[]
  pHit: number
  damage: number
  table: HitTable
  selfDamage: number
  attackerPsr: { reason: PsrReason; tn: number; p: number; onHit: boolean } | null
  targetPsr: { reason: PsrReason; tn: number; p: number } | null
  displacement: Hex | null
  choice: PhysicalChoice | null // ready answer for declarePhysical, when legal and declarable now
}
export interface HitTableView { probs: Partial<Record<Loc, number>>; tac: Loc | null; pTac: number }
export interface FallPreview { damage: number; groups: number[]; locations: Partial<Record<Loc, number>>; seatbeltTn: number; pPilotHit: number }
export interface ExplosionPreview { damage: number; location: Loc; transfersTo: Loc[]; pilotHits: number; destroysUnit: boolean }
export interface ArcsView { front: Hex[]; left: Hex[]; right: Hex[]; rear: Hex[]; mountArcs: Record<LocalId, ('front' | 'left' | 'right' | 'rear')[]> }
export interface SheetView {
  unitId: UnitId
  name: string
  tonnage: number
  bv: number
  adjustedBv: number // BV after pilot skills
  locations: Record<Loc, { armor: number; maxArmor: number; rear: number | null; maxRear: number | null; structure: number; maxStructure: number; destroyed: boolean }>
  slots: Record<Loc, { label: string; token: string; hit: boolean; destroyed: boolean }[]>
  weapons: { mountId: LocalId; name: string; location: Loc; rear: boolean; heat: number; damage: string; ranges: string; destroyed: boolean; firedThisTurn: boolean }[]
  ammo: { binId: LocalId; name: string; location: Loc; shots: number; capacity: number }[]
  mp: { baseWalk: number; baseRun: number; baseJump: number; walk: number; run: number; jump: number; walkMods: Mod[] }
  sinks: { count: number; type: 'single' | 'double'; operable: number; dissipation: number }
  status: { prone: boolean; shutdown: boolean; immobile: boolean; jumped: boolean; twist: Twist | null; flipped: boolean }
  heat: number
  pilot: { name: string; gunnery: number; piloting: number; hits: number; conscious: boolean; consciousnessTn: number | null; consciousnessTns: number[] /* TN for hits 1..5 */ }
}
export interface TerrainInfo { label: HexLabel; level: number; terrain: string[]; depth: number | null; moveCost: { walk: number | null; run: number | null; jump: number | null }; losEffect: string }

// ---------- query.* : the ONLY source of numbers the UI and AI show (00 §11) ----------
export const query = {
  /** Hex distance (HEX-005). */
  distance: (a: Hex, b: Hex): number => hexDistance(a, b),
  /** Every (hex, facing, mode) the unit can end its move in, cheapest path each, with a ready MoveAction; plus one entry per legal charge/DFA (00 §9.6). */
  reachable: (state: GameState, unitId: UnitId): ReachEntry[] => reachableImpl(state, unitId),
  /** LOS between two units (or a unit and a hex) with reasons and blockers (LOS-020). */
  los: (state: GameState, from: UnitId | Hex, to: UnitId | Hex, opts?: LosOptions): LosVerdict => losQuery(state, from, to, opts),
  arcs: (state: GameState, unitId: UnitId, twist?: Twist): ArcsView => arcsQuery(state, unitId, twist),
  attackPreview: (state: GameState, req: AttackPreviewRequest): AttackPreview => attackPreviewQuery(state, req),
  firePreview: (state: GameState, unitId: UnitId, plan: FirePlan): FirePreview => firePreviewQuery(state, unitId, plan),
  physicalPreview: (state: GameState, req: PhysicalPreviewRequest): PhysicalPreview => physicalPreviewImpl(state, req),
  /** Every physical option of attacker vs target (punch per arm, both arms, kick per leg, push), legal or not. */
  physicalOptions: (state: GameState, attackerId: UnitId, targetId: UnitId): PhysicalPreview[] => physicalOptionsImpl(state, attackerId, targetId),
  hitTable: (direction: AttackDirection, table: HitTable, opts?: { prone?: boolean; partialCover?: boolean }): HitTableView => hitLocationDistribution(direction, table, opts ?? {}),
  /** P(hits = k) for k = 0..rackSize (index = hits). */
  clusterTable: (rackSize: number, modifier: number): number[] => clusterDistribution(rackSize, modifier),
  heatProjection: (state: GameState, unitId: UnitId, plan: HeatPlan): HeatProjection => projectHeat(state, unitId, plan),
  heatEffects: (heat: number): HeatEffects => heatEffectsQuery(heat),
  heatScale: (): HeatScaleRow[] => heatScaleQuery(),
  psrPreview: (state: GameState, unitId: UnitId, reason: PsrReason): { tn: number; mods: Mod[]; p: number; auto: boolean } => psrPreviewQuery(state, unitId, reason),
  fallPreview: (state: GameState, unitId: UnitId, levels?: number): FallPreview => fallPreviewImpl(state, unitId, levels ?? 0),
  explosionPreview: (state: GameState, unitId: UnitId, slot: SlotRef): ExplosionPreview => explosionPreviewQuery(state, unitId, slot),
  isKillLocation: (state: GameState, unitId: UnitId, loc: Loc): boolean => isKillLocationQuery(state, unitId, loc),
  mustWithdraw: (state: GameState, unitId: UnitId): boolean => mustWithdrawQuery(state, unitId),
  sheet: (state: GameState, unitId: UnitId): SheetView => sheetQuery(state, unitId),
  terrainInfo: (state: GameState, hex: Hex): TerrainInfo => terrainInfoQuery(state, hex),
  /** Hex centre in world units, board centred (00 §3.6). */
  hexToWorld: (state: GameState, hex: Hex): WorldXZ => hexToWorldQuery(state, hex),
  /** P(2d6 ≥ tn): tn ≤ 2 → 1, tn ≥ 13 → 0. */
  p2d6: (tn: number): number => p2d6AtLeast(tn),
  /** Release-1 threat view: expected damage to a standing 'Mech at the hex from each side's units where they stand (00 §14). */
  threat: (state: GameState, hex: Hex): ThreatView => threatQuery(state, hex),
}

const WAYS_2D6 = [0, 0, 1, 2, 3, 4, 5, 6, 5, 4, 3, 2, 1] // index = total
/** P(2d6 ≥ tn) as a fraction of 36. */
export function p2d6AtLeast(tn: number): number {
  if (tn <= 2) return 1
  if (tn > 12) return 0
  let w = 0
  for (let t = tn; t <= 12; t++) w += WAYS_2D6[t]!
  return w / 36
}

// ---------- describe.* : our words for the UI (00 §11.3) ----------
export interface DecisionText { title: string; prompt: string; lines: string[] }
export const describe = {
  decision: (state: GameState, pending: PendingDecision): DecisionText => describeDecision(state, pending),
  event: (state: GameState, event: GameEvent): string => describeEvent(state, event),
  action: (state: GameState, action: Action): string => describeAction(state, action),
  unit: (state: GameState, unitId: UnitId): string => describeUnit(state, unitId),
  location: (loc: Loc): string => LOC_NAMES[loc],
}
const LOC_NAMES: Record<Loc, string> = {
  HD: 'head', CT: 'centre torso', LT: 'left torso', RT: 'right torso', LA: 'left arm', RA: 'right arm', LL: 'left leg', RL: 'right leg',
}
