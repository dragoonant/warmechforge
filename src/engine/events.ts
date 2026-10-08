// FROZEN after M0: every rule effect emits an event (00 §2 rule 3, §10). Additive changes only.
// Events carry every number the UI shows (TN, roll, location, before/after values) so nothing is recomputed client side.
import type { Action } from './actions'
import type {
  AttackDirection, AttackId, AttackKind, ArmorSide, DecisionId, DecisionKind, DestroyCause, Edge, Facing, GameResult,
  HeatEntry, Hex, HitTable, Loc, LocalId, Mod, MoveMode, PhaseId, PhysicalKind, PlayerId, PsrId, PsrReason, RangeBand,
  Rejection, RollId, RollPurpose, SlotToken, StepOp, Twist, UnitId, UnitStatus,
} from './types'

interface Ev<T extends string> { type: T }

// ---------- dice ----------
/** Every roll (00 §12). total = Σ kept + flat. success is set iff target is set: total ≥ target. */
export interface DiceRolled extends Ev<'DiceRolled'> {
  rollId: RollId
  purpose: RollPurpose
  dice: number[]
  kept: number[]
  total: number
  target?: number
  success?: boolean
  unitId?: UnitId
  targetId?: UnitId
  attackId?: AttackId
  reason?: string // PsrReason for 'psr', 'floatingCrit' for a hitLocation re-roll, etc.
  mods?: Mod[]
}

// ---------- flow ----------
export interface ActionRejected extends Ev<'ActionRejected'> { action: Action; rejection: Rejection }
export interface DecisionAutoResolved extends Ev<'DecisionAutoResolved'> { decisionId: DecisionId; kind: DecisionKind; optionId: string }
export interface GameStarted extends Ev<'GameStarted'> { missionId: string; mapId: string; seed: string }
export interface UnitDeployed extends Ev<'UnitDeployed'> { unitId: UnitId; hex: Hex; facing: Facing }
export interface TurnStarted extends Ev<'TurnStarted'> { turn: number }
export interface PhaseStarted extends Ev<'PhaseStarted'> { phase: PhaseId; turn: number }
export interface PhaseEnded extends Ev<'PhaseEnded'> { phase: PhaseId; turn: number }
export interface InitiativeResolved extends Ev<'InitiativeResolved'> { totals: Record<PlayerId, number>; winner: PlayerId; loser: PlayerId; rerolls: number }
export interface PairStarted extends Ev<'PairStarted'> { phase: PhaseId; pair: number; counts: Record<PlayerId, number> }
export interface UnitSelected extends Ev<'UnitSelected'> { unitId: UnitId; phase: PhaseId }

// ---------- movement ----------
export interface MoveStarted extends Ev<'MoveStarted'> { unitId: UnitId; mode: MoveMode; hex: Hex | null; facing: Facing; mp: number }
export interface UnitEntered extends Ev<'UnitEntered'> { unitId: UnitId; hex: Hex; facing: Facing; edge: Edge }
/** One primitive ground step (forward/backward/turn/dropProne). cost = MP for this step. */
export interface UnitStepped extends Ev<'UnitStepped'> { unitId: UnitId; op: StepOp; from: Hex; to: Hex; facing: Facing; cost: number; mpLeft: number }
export interface UnitJumped extends Ev<'UnitJumped'> { unitId: UnitId; from: Hex; to: Hex; path: Hex[]; facing: Facing; cost: number }
export interface StandAttempted extends Ev<'StandAttempted'> { unitId: UnitId; success: boolean; facing: Facing; mpLeft: number }
/** Steps after a failed hex-entry PSR are discarded (PSR-030). */
export interface MoveTruncated extends Ev<'MoveTruncated'> { unitId: UnitId; at: Hex; stepsDiscarded: number }
export interface MoveEnded extends Ev<'MoveEnded'> { unitId: UnitId; mode: MoveMode; hexesMoved: number; jumped: boolean; mpSpent: number; tmm: number; attackerMod: number }
export interface PhysicalDeclaredInMove extends Ev<'PhysicalDeclaredInMove'> { unitId: UnitId; kind: 'charge' | 'dfa'; targetId: UnitId; fromHex: Hex }
export interface UnitExited extends Ev<'UnitExited'> { unitId: UnitId; edge: Edge; status: UnitStatus }

// ---------- attack declarations ----------
export interface TorsoTwisted extends Ev<'TorsoTwisted'> { unitId: UnitId; twist: Twist; flipped: boolean; phase: PhaseId }
export interface FireDeclared extends Ev<'FireDeclared'> {
  unitId: UnitId
  primaryTargetId: UnitId | null
  shots: { attackId: AttackId; mountId: LocalId; targetId: UnitId | null; binId: LocalId | null; tn: number; band: RangeBand; aimedAt: Loc | null }[]
}
export interface PhysicalDeclared extends Ev<'PhysicalDeclared'> { unitId: UnitId; attackId: AttackId; kind: PhysicalKind; targetId: UnitId; limb: Loc | null; tn: number }
export interface AmmoSpent extends Ev<'AmmoSpent'> { unitId: UnitId; binId: LocalId; shots: number; left: number }
export interface HeatAdded extends Ev<'HeatAdded'> { unitId: UnitId; entry: HeatEntry; turnTotal: number }

// ---------- attack resolution (00 §6) ----------
export interface AttackRolled extends Ev<'AttackRolled'> { attackId: AttackId; attackerId: UnitId; targetId: UnitId | null; kind: AttackKind; mountId: LocalId | null; tn: number; roll: number | null; hit: boolean; auto: 'hit' | 'miss' | null }
export interface AimedShotResolved extends Ev<'AimedShotResolved'> { attackId: AttackId; aimedAt: Loc; onTarget: boolean }
export interface ClusterResolved extends Ev<'ClusterResolved'> { attackId: AttackId; rackSize: number; roll: number; modified: number; hits: number; groups: number[] }
export interface HitLocated extends Ev<'HitLocated'> { attackId: AttackId | null; unitId: UnitId; group: number; damage: number; table: HitTable; direction: AttackDirection; roll: number; location: Loc; side: ArmorSide; tac: boolean }
export interface HitAbsorbedByCover extends Ev<'HitAbsorbedByCover'> { attackId: AttackId | null; unitId: UnitId; location: Loc; damage: number }
/** One location step of the damage pipeline (DMG-022). lost = damage that vanished (HD/CT overflow, CASE). */
export interface DamageApplied extends Ev<'DamageApplied'> {
  unitId: UnitId
  source: DamageSourceKind
  sourceUnitId: UnitId | null
  attackId: AttackId | null
  location: Loc
  side: ArmorSide
  damage: number
  armorBefore: number
  armorAfter: number
  structureBefore: number
  structureAfter: number
  transferredTo: Loc | null
  transferred: number
  lost: number
  /** Points ferro-lamellor armor stopped before `damage` landed at this location (M5; absent when nothing was stopped). */
  reduced?: number
}
export type DamageSourceKind = 'weapon' | 'physical' | 'fall' | 'ammoExplosion' | 'componentExplosion' | 'fallFromAbove' | 'other'
export interface LocationDestroyed extends Ev<'LocationDestroyed'> { unitId: UnitId; location: Loc; cause: 'damage' | 'blownOff' | 'sideTorso' | 'explosion'; armorLost: number }
export interface CritCheckRolled extends Ev<'CritCheckRolled'> { unitId: UnitId; location: Loc; roll: number; crits: number; blownOff: boolean; appliesTo: Loc | null; why: 'structure' | 'tac' | 'explosive' | 'masc' }
/** Crits that found no slot to hit: CRIT-010 (location already emptied this phase) or CRIT-005 (non-explosive contents discarded). */
export interface CritLost extends Ev<'CritLost'> { unitId: UnitId; location: Loc; count: number; why: 'noSlotThisPhase' | 'notExplosive' }
export interface CritSlotHit extends Ev<'CritSlotHit'> { unitId: UnitId; location: Loc; index: number; token: SlotToken; itemName: string | null; effect: CritEffect }
export type CritEffect =
  | 'none' | 'componentDestroyed' | 'componentDamaged' | 'ammoExplosion' | 'componentExplosion' | 'cockpit' | 'engine'
  | 'gyro' | 'sensors' | 'lifeSupport' | 'actuator' | 'heatSink' | 'jumpJet' | 'emptyBin'
export interface ComponentDestroyed extends Ev<'ComponentDestroyed'> { unitId: UnitId; mountId: LocalId | null; token: SlotToken; location: Loc }
export interface AmmoExploded extends Ev<'AmmoExploded'> { unitId: UnitId; binId: LocalId; location: Loc; shots: number; damage: number; capped: boolean; cause: 'crit' | 'heat' }
export interface ComponentExploded extends Ev<'ComponentExploded'> { unitId: UnitId; mountId: LocalId; location: Loc; damage: number; capped: boolean }
export interface PilotHit extends Ev<'PilotHit'> { unitId: UnitId; hits: number; total: number; cause: 'head' | 'seatbelt' | 'explosion' | 'lifeSupportHeat' | 'lifeSupportWater' | 'fallImmobile' }
/** Destruction booked (simultaneous window) or applied (immediate). `effective` false = takes effect at end of phase. */
export interface UnitDestroyed extends Ev<'UnitDestroyed'> { unitId: UnitId; cause: DestroyCause; effective: boolean }
export interface AttackEnded extends Ev<'AttackEnded'> { attackId: AttackId; hit: boolean; damageDealt: number }

// ---------- PSRs and falls (00 §7) ----------
export interface PsrQueued extends Ev<'PsrQueued'> { psrId: PsrId; unitId: UnitId; reason: PsrReason; mod: number; auto: boolean }
export interface PsrResolved extends Ev<'PsrResolved'> { psrId: PsrId; unitId: UnitId; reason: PsrReason; tn: number; mods: Mod[]; roll: number | null; success: boolean; auto: boolean }
export interface PsrDiscarded extends Ev<'PsrDiscarded'> { psrId: PsrId; unitId: UnitId; reason: PsrReason; why: 'alreadyFell' | 'prone' | 'destroyed' }
export interface UnitFell extends Ev<'UnitFell'> { unitId: UnitId; hex: Hex; levels: number; facing: Facing; damage: number; column: 'front' | 'rear'; inWater: boolean }
export interface UnitDisplaced extends Ev<'UnitDisplaced'> { unitId: UnitId; from: Hex; to: Hex; cause: 'charge' | 'dfa' | 'dfaMiss' | 'push' | 'domino' | 'fallFromAbove' | 'dodge' }

// ---------- heat ----------
export interface HeatApplied extends Ev<'HeatApplied'> { unitId: UnitId; before: number; generated: number; dissipated: number; after: number; entries: HeatEntry[] }
export interface UnitShutdown extends Ev<'UnitShutdown'> { unitId: UnitId; cause: 'heat' | 'voluntary'; heat: number }
export interface UnitRestarted extends Ev<'UnitRestarted'> { unitId: UnitId; heat: number; auto: boolean }

// ---------- pilot ----------
export interface ConsciousnessChecked extends Ev<'ConsciousnessChecked'> { unitId: UnitId; hits: number; tn: number; roll: number; conscious: boolean }
export interface PilotRecovered extends Ev<'PilotRecovered'> { unitId: UnitId; tn: number; roll: number; recovered: boolean }
export interface PilotKilled extends Ev<'PilotKilled'> { unitId: UnitId }

// ---------- end phase / status ----------
export interface TwistReset extends Ev<'TwistReset'> { unitId: UnitId }
export interface StatusChanged extends Ev<'StatusChanged'> { unitId: UnitId; status: UnitStatus; crippled: boolean; was: UnitStatus }
export interface UnitRemoved extends Ev<'UnitRemoved'> { unitId: UnitId; status: UnitStatus }
export interface GameEnded extends Ev<'GameEnded'> { result: GameResult }

export type GameEvent =
  | DiceRolled | ActionRejected | DecisionAutoResolved | GameStarted | UnitDeployed | TurnStarted | PhaseStarted
  | PhaseEnded | InitiativeResolved | PairStarted | UnitSelected
  | MoveStarted | UnitEntered | UnitStepped | UnitJumped | StandAttempted | MoveTruncated | MoveEnded
  | PhysicalDeclaredInMove | UnitExited
  | TorsoTwisted | FireDeclared | PhysicalDeclared | AmmoSpent | HeatAdded
  | AttackRolled | AimedShotResolved | ClusterResolved | HitLocated | HitAbsorbedByCover | DamageApplied
  | LocationDestroyed | CritCheckRolled | CritLost | CritSlotHit | ComponentDestroyed | AmmoExploded | ComponentExploded | PilotHit
  | UnitDestroyed | AttackEnded
  | PsrQueued | PsrResolved | PsrDiscarded | UnitFell | UnitDisplaced
  | HeatApplied | UnitShutdown | UnitRestarted
  | ConsciousnessChecked | PilotRecovered | PilotKilled
  | TwistReset | StatusChanged | UnitRemoved | GameEnded
export type GameEventType = GameEvent['type']
