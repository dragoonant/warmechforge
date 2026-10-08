// FROZEN after M0 (00-architecture §2-§13): additive changes only, each logged in 00-architecture §14.
// Shapes only: no rules logic lives here. Rules numbers live in 10-rules-core and the data bundle.
import type { Action } from './actions'
import type { GameEvent } from './events'

// ---------- primitives ----------
export type PlayerId = 'A' | 'B' // setup.sides[0] = 'A', setup.sides[1] = 'B'
export type Id = string // data id, e.g. 'mech.uziel.uzl-2s'
export type LocalId = string // id unique inside one record (mount, bin)
export type UnitId = string // `${PlayerId}${n}`, n = 1-based force slot: 'A1', 'B3'
export type DecisionId = string // 'd:<n>'
export type RollId = string // 'r:<n>'
export type AttackId = string // 'a:<n>'
export type PsrId = string // 'p:<n>'

// ---------- hex geometry (00 §3) ----------
/** Axial coordinates of a flat-topped hex. Off-board (virtual) hexes are legal values; `onBoard` decides. */
export interface Hex { q: number; r: number }
/** Printed mapsheet label 'XXYY' = (col + 1, row + 1), zero padded, e.g. '0101' top-left. */
export type HexLabel = string
export type Facing = 0 | 1 | 2 | 3 | 4 | 5 // 0 = north, clockwise
export const FACINGS: readonly Facing[] = [0, 1, 2, 3, 4, 5]
/** Axial neighbour offsets by facing (HEX-004). */
export const HEX_DIRS: Readonly<Record<Facing, Hex>> = {
  0: { q: 0, r: -1 }, 1: { q: 1, r: -1 }, 2: { q: 1, r: 0 }, 3: { q: 0, r: 1 }, 4: { q: -1, r: 1 }, 5: { q: -1, r: 0 },
}
export type Edge = 'north' | 'south' | 'east' | 'west'
/** Torso twist relative to the feet: -1 = one hexside counter-clockwise (left), +1 = clockwise (right). */
export type Twist = -1 | 0 | 1

// ---------- world units (00 §3.6): the only place these constants live ----------
/** World units per hex, flat side to flat side. */
export const HEX_FLAT = 1
/** World height of one elevation level. */
export const LEVEL_HEIGHT = 0.35
/** World x distance between neighbouring columns (= √3/2 × HEX_FLAT). */
export const COLUMN_STEP = Math.sqrt(3) / 2
export interface WorldXZ { x: number; z: number } // y is up; +z = south; board centred at the origin

// ---------- 'Mech anatomy ----------
export type Loc = 'HD' | 'CT' | 'LT' | 'RT' | 'LA' | 'RA' | 'LL' | 'RL'
export const LOCS: readonly Loc[] = ['HD', 'CT', 'LT', 'RT', 'LA', 'RA', 'LL', 'RL']
export type TorsoLoc = 'CT' | 'LT' | 'RT'
export type ArmLoc = 'LA' | 'RA'
export type LegLoc = 'LL' | 'RL'
export type ArmorSide = 'front' | 'rear'
/** Crit slot content: a system token from 20 §6.4 or '#<localId>' of a mount or ammo bin. */
export type SlotToken = string
export type SystemToken =
  | 'lifeSupport' | 'sensors' | 'cockpit' | 'engine' | 'gyro' | 'shoulder' | 'upperArm' | 'lowerArm' | 'hand'
  | 'hip' | 'upperLeg' | 'lowerLeg' | 'foot' | 'structure' | 'armor' | 'empty'
export interface SlotRef { location: Loc; index: number } // index 0-based (slot 1 = index 0)

// ---------- data bundle (built by src/data/index.ts; the engine never imports data JSON) ----------
/** Minimal record shape. Engine modules narrow to the concrete types of src/data/types.ts (type-only import). */
export interface DataRecord { id: Id }
export interface DataBundle {
  version: string // content hash; state.dataVersion
  byId: Record<Id, DataRecord>
  weapons: Record<Id, DataRecord>
  ammo: Record<Id, DataRecord>
  equipment: Record<Id, DataRecord>
  mechs: Record<Id, DataRecord>
  pilots: Record<Id, DataRecord>
  spas: Record<Id, DataRecord>
  maps: Record<Id, DataRecord>
  forces: Record<Id, DataRecord>
  missions: Record<Id, DataRecord>
  tables: Record<string, unknown>
}

// ---------- setup (11-missions §1.1) ----------
export type Control = 'human' | 'ai'
export interface ForceUnitSetup {
  slot?: string
  mech: Id
  pilot?: Id
  skills?: { gunnery: number; piloting: number } // overrides the pilot card; default 4/5
  name?: string
  ammo?: Record<LocalId, Id> // bin id -> ammo id from that bin's options
  halfLoad?: LocalId[] // bins that start with floor(shotsPerTon / 2)
}
export interface ForceSetup { id: Id; name: string; color?: string; units: ForceUnitSetup[] }
export interface SideSetup { sideId: Id; label?: string; control: Control; force: ForceSetup }
export interface GameOptions {
  askDefender?: boolean // default false: LOS-005 / ARC-021 choices use the default rule, no decision
  floatingCrits?: boolean // HITLOC-005, default false
  manualPower?: boolean // default false: End Phase powerChoice only offered when §9 says so
}
export interface GameSetup {
  missionId: Id
  mapId: Id
  sides: [SideSetup, SideSetup]
  forcedWithdrawal: boolean
  turnLimit: number | null
  bvBudget: number | null
  options?: GameOptions
}

// ---------- board (normalised from map data at createGame; 00 §4.2) ----------
export type Woods = 'none' | 'light' | 'heavy'
export interface BoardHex {
  label: HexLabel
  hex: Hex
  level: number // ground level; water: the surface
  woods: Woods
  depth: number // water depth, 0 = no water; floor = level - depth
  rough: boolean
  rubble: boolean
  pavement: boolean
  road: Facing[] // road exits; [] = no road
}
export interface BoardState {
  mapId: Id
  cols: number
  rows: number
  hexes: Record<HexLabel, BoardHex> // every on-board hex, dense
  centre: WorldXZ // bbox midpoint of all hex centres before centring (00 §3.6)
}

// ---------- phases and steps (00 §5) ----------
export type PhaseId = 'deployment' | 'initiative' | 'movement' | 'rangedAttack' | 'physicalAttack' | 'heat' | 'end' | 'ended'
export const PHASE_STEPS = [
  'deployment.place',
  'initiative.roll', 'initiative.ack',
  'movement.select', 'movement.move', 'movement.end',
  'ranged.select', 'ranged.twist', 'ranged.declare', 'ranged.resolve', 'ranged.endOfPhase',
  'physical.select', 'physical.twist', 'physical.declare', 'physical.resolve', 'physical.displace', 'physical.endOfPhase',
  'heat.apply', 'heat.endOfPhase',
  'end.recovery', 'end.lifeSupport', 'end.consciousness', 'end.reset', 'end.power', 'end.surrender', 'end.cleanup', 'end.victory',
  'game.over',
] as const
export type PhaseStep = (typeof PHASE_STEPS)[number]
/** 'simultaneous' while declared Ranged/Physical attacks resolve (INIT-012); 'immediate' everywhere else. */
export type DamageWindow = 'immediate' | 'simultaneous'

// ---------- movement ----------
export type MoveMode = 'standStill' | 'walk' | 'run' | 'jump'
export type StepOp = 'forward' | 'backward' | 'turnLeft' | 'turnRight' | 'dropProne' | 'exit'
export interface MoveRecord {
  mode: MoveMode | null // null = not moved yet this turn
  startHex: Hex | null
  startFacing: Facing
  hexesMoved: number // MOVE-013 count used for TMM
  jumped: boolean
  mpSpent: number
  tmm: number // TOHIT-014 (+ TOHIT-015 jump extra already included)
  attackerMod: number // TOHIT-012
  done: boolean
  entered: boolean // came on board this turn (edge entry)
  standAttempts: number
  fell: boolean // fell this turn
  ranHexes: number // hexes entered while running (2026 D6: ≥1 needed for the run PSR)
}

// ---------- attacks ----------
export type PhysicalKind = 'punch' | 'kick' | 'push' | 'charge' | 'dfa'
export type AttackKind = 'ranged' | PhysicalKind
export type AttackDirection = 'front' | 'left' | 'right' | 'rear'
export type HitTable = 'standard' | 'punch' | 'kick'
export type RangeBand = 'short' | 'medium' | 'long' | 'out'
export interface AttackRecord {
  twist: Twist
  flipped: boolean
  twistPhase: PhaseId | null // phase the twist/flip was declared in (ARC-010)
  rangedDeclared: boolean
  physicalDeclared: boolean
  primaryTargetId: UnitId | null
  propArm: ArmLoc | null // TOHIT-008
  firedMounts: LocalId[] // mounts that fired this turn (punch/kick/push limits)
  charge: { targetId: UnitId; fromHex: Hex } | null // declared in the Movement Phase
  dfa: { targetId: UnitId; fromHex: Hex } | null
}

/** A modifier line. `code` drives client labels (labels.ts); `value` is signed. */
export type ModCode =
  | 'gunnery' | 'piloting' | 'range' | 'minRange' | 'attackerMove' | 'attackerProne' | 'tmm' | 'targetJumped'
  | 'targetProne' | 'targetImmobile' | 'woodsTarget' | 'woodsIntervening' | 'partialCover' | 'heat' | 'secondaryTarget'
  | 'sensors' | 'shoulder' | 'upperArm' | 'lowerArm' | 'hand' | 'weapon' | 'targetingComputer' | 'aimedShot'
  | 'physicalBase' | 'comparative' | 'upperLeg' | 'lowerLeg' | 'foot' | 'hip' | 'gyro' | 'legDestroyed'
  | 'damage20' | 'charged' | 'dfa' | 'chargeMade' | 'dfaMade' | 'stand' | 'water' | 'levelsFallen' | 'clusterMod'
  | 'caseII' | 'consciousness' | 'avoid' | 'fallFromAbove' | 'terrain' | 'spa' | 'other'
export interface Mod { code: ModCode; value: number; detail?: string }

export interface RangedDeclaration {
  kind: 'ranged'
  attackId: AttackId
  attackerId: UnitId
  mountId: LocalId
  targetId: UnitId | null // null = empty-hex target (TOHIT-004)
  targetHex: Hex
  binId: LocalId | null
  ammoId: Id | null
  rapidShots: number | null
  aimedAt: Loc | null
  primary: boolean
  // frozen at declaration (INIT-012: mid-phase damage never changes them)
  tn: number
  mods: Mod[]
  distance: number
  band: RangeBand
  direction: AttackDirection
  table: HitTable
  partialCover: boolean
}
export interface PhysicalDeclaration {
  kind: PhysicalKind
  attackId: AttackId
  attackerId: UnitId
  targetId: UnitId
  limb: ArmLoc | LegLoc | null // punch arm or kicking leg
  tn: number
  mods: Mod[]
  direction: AttackDirection
  table: HitTable
}
export type Declaration = RangedDeclaration | PhysicalDeclaration

/** The attack being resolved now; the UI reads TN and odds here before any dice event (00 §2 rule 4). */
export interface AttackContext {
  attackId: AttackId
  attackerId: UnitId
  targetId: UnitId | null
  kind: AttackKind
  mountId: LocalId | null
  tn: number
  mods: Mod[]
  pHit: number
  direction: AttackDirection
  table: HitTable
  stage: 'toHit' | 'aimed' | 'cluster' | 'location' | 'damage' | 'done'
  hit: boolean | null
  groups: number[] // damage groups in resolution order (HITLOC-010), filled after cluster
  groupIndex: number
}

// ---------- unit state (00 §4.1) ----------
export type UnitStatus = 'offBoard' | 'active' | 'withdrawing' | 'withdrawn' | 'surrendered' | 'destroyed'
export type DestroyCause =
  | 'headDestroyed' | 'ctDestroyed' | 'cockpit' | 'pilotKilled' | 'engine' | 'displacedOff' | 'noLegalHex' | 'surrendered'
export interface LocState {
  armor: number
  rear: number | null // torsos only
  structure: number
  maxArmor: number
  maxRear: number | null
  maxStructure: number
  destroyed: boolean // ⇔ structure 0 (INV-07)
  destroyedCause: 'damage' | 'blownOff' | 'sideTorso' | 'explosion' | null
}
export interface SlotState {
  token: SlotToken
  hit: boolean
  hitPhase: number | null // state.phaseSeq when hit (CRIT-010)
}
export interface MountState {
  id: LocalId
  item: Id
  location: Loc
  split: Loc | null
  rear: boolean
  linkedTo: LocalId | null
  critHits: number
  destroyed: boolean
  jammed: boolean
  firedTurn: number | null
}
export interface BinState {
  id: LocalId
  ammo: Id // loaded type
  location: Loc
  shots: number
  capacity: number
  exploded: boolean
}
export interface PilotState {
  pilotId: Id | null
  name: string
  gunnery: number
  piloting: number
  hits: number // 0..6
  conscious: boolean
  dead: boolean
  koTurn: number | null // turn knocked out (PILOT-020: recovery from the next End Phase)
  spas: Id[]
}
export interface ShutdownState { cause: 'heat' | 'voluntary'; turn: number }
export interface EscalatingState { step: number; usedThisTurn: boolean } // EQUIP-020
export interface UnitState {
  id: UnitId
  owner: PlayerId
  mechId: Id
  name: string
  tonnage: number // snapshot of data at createGame
  baseMp: { walk: number; run: number; jump: number } // data movement; current MP is derived (query/movement)
  sinks: { count: number; type: 'single' | 'double' } // data heat sinks; operable count is derived from slots
  status: UnitStatus
  crippled: boolean
  pos: Hex | null // null while off board
  facing: Facing // feet facing
  prone: boolean
  shutdown: ShutdownState | null
  heat: number // may exceed 30 (HEAT-013)
  pilot: PilotState
  locs: Record<Loc, LocState>
  slots: Record<Loc, SlotState[]>
  mounts: Record<LocalId, MountState>
  bins: Record<LocalId, BinState>
  move: MoveRecord
  attacks: AttackRecord
  doomed: DestroyCause | null // destruction booked during a simultaneous window, applied at end of phase
  destroyedCause: DestroyCause | null
  escalating: Record<LocalId, EscalatingState>
}

// ---------- sides ----------
export interface SideState {
  id: PlayerId
  sideId: Id
  label: string
  control: Control
  homeEdge: Edge
  deployment: 'edgeEntry' | 'edgePlace' | 'hexes'
}
export interface InitiativeState {
  winner: PlayerId
  loser: PlayerId
  totals: Record<PlayerId, number> // the deciding roll
  rerolls: number
}
/** INIT-005 selection bookkeeping for the current alternating phase. */
export interface SelectionState {
  phase: 'movement' | 'rangedAttack' | 'physicalAttack'
  pair: number // 1-based
  turnOf: PlayerId // side selecting now
  leftInGroup: number // units this side still selects in the current half-pair
  pairCounts: Record<PlayerId, number> // n_L / n_W fixed at the start of the pair
  acted: UnitId[] // units already selected this phase
  activeUnit: UnitId | null // unit whose move/declaration is open
}

// ---------- the ONE PSR queue (00 §7) ----------
export type PsrReason =
  | 'damage20' | 'gyroCrit' | 'hipCrit' | 'upperLegCrit' | 'lowerLegCrit' | 'legDestroyed' | 'bothLegs' | 'gyroDestroyed'
  | 'kicked' | 'pushed' | 'charged' | 'dfaTarget' | 'missedKick' | 'chargeMade' | 'dfaMade' | 'dfaMissed' | 'stand'
  | 'runWater' | 'rubble' | 'backwardLevel' | 'landWater' | 'runDamaged' | 'jumpDamaged' | 'domino' | 'fallFromAbove'
  | 'seatbelt' | 'sensorCheck' | 'masc'
export interface PsrEntry {
  id: PsrId
  unitId: UnitId
  reason: PsrReason
  mod: number // event modifier (PSR-015..029)
  auto: boolean // automatic fall, no roll
  when: 'now' | 'endOfMove' | 'endOfPhase'
  phase: PhaseId
  levels?: number // seatbelt / fall: levels fallen
}
export interface PsrState {
  queue: PsrEntry[] // unresolved, in trigger order
  history: Record<UnitId, PsrEntry[]> // every trigger this phase (PSR-001 sums their mods); cleared at phase start
}

// ---------- the ONE heat ledger (00 §8) ----------
export type HeatSource = 'movement' | 'weapon' | 'engine' | 'equipment' | 'environment' | 'other'
export interface HeatEntry { source: HeatSource; amount: number; ref: string | null; phase: PhaseId }

// ---------- per-phase bookkeeping (00 §5.3) ----------
export interface Displacement {
  unitId: UnitId
  from: Hex
  to: Hex
  dir: Facing // direction of travel
  cause: 'charge' | 'dfa' | 'dfaMiss' | 'push' | 'domino' | 'fallFromAbove'
  byId: UnitId | null
  order: number // initiative order key (PHYS-090)
}
export interface PhaseLedger {
  phase: PhaseId
  damage: Record<UnitId, number> // 20-point tally (PSR-015)
  damage20: UnitId[] // units already given the damage20 PSR this phase
  pilotHit: UnitId[] // consciousness check owed at end of phase (PILOT-010)
  immobileAtStart: UnitId[] // TOHIT-018 snapshot
  displacements: Displacement[] // Physical Attack Phase only
}

export interface GameResult {
  winner: PlayerId | null // null = draw
  reason: 'eliminate' | 'turnLimitBV' | 'objective' | 'draw'
  turn: number
}

/** Continuation for a decision raised in the middle of a procedure (chooseAmmo, choice). Engine-internal payload. */
export interface ResumePoint { code: string; data: Record<string, unknown> }

// ---------- game state (00 §4) ----------
export interface GameState {
  format: 1
  seed: string
  rng: RngState
  rollSeq: number
  decisionSeq: number
  attackSeq: number
  psrSeq: number
  phaseSeq: number // +1 at every PhaseStarted
  dataVersion: string
  setup: GameSetup
  board: BoardState
  sides: Record<PlayerId, SideState>
  turn: number // 0 during deployment, then 1..
  phase: PhaseId
  step: PhaseStep
  damageWindow: DamageWindow
  initiative: InitiativeState | null
  selection: SelectionState | null
  units: Record<UnitId, UnitState>
  unitOrder: UnitId[] // A units then B units, in force order
  declarations: Declaration[] // this phase, in declaration order
  resolveIndex: number // next declaration to resolve
  current: AttackContext | null
  ledger: PhaseLedger
  psr: PsrState
  heatLedger: Record<UnitId, HeatEntry[]> // this turn; applied and cleared in the Heat Phase
  choices: { los: Record<string, '+' | '-'>; direction: Record<string, AttackDirection> } // key `${attacker}>${target}`, per turn
  resume: ResumePoint | null
  result: GameResult | null
  pending: PendingDecision
  log: Action[]
}

// ---------- decisions (00 §9) ----------
export type DecisionKind =
  | 'deploy' | 'initiativeAck' | 'selectUnit' | 'move' | 'standUp' | 'torsoTwist' | 'declareFire' | 'chooseAmmo'
  | 'declarePhysical' | 'powerChoice' | 'choice' | 'gameOver'
export type ChoiceCode = 'dividedLos' | 'attackDirection' | 'dominoDodge' | 'dfaMissMove' | 'displaceSide' | 'spa'
export interface PsrOdds { tn: number; mods: Mod[]; p: number; auto: boolean }
export interface DecisionContext {
  phase?: PhaseId
  eligible?: UnitId[] // selectUnit, deploy
  count?: number // selectUnit: units this side still selects in the current half-pair
  zone?: Hex[] // deploy: legal hexes
  mpLeft?: number // move after a stand or a fall
  lockedMode?: MoveMode // move: mode already fixed this turn
  entry?: { edge: Edge; hexes: Hex[]; facings: Facing[] } // move: edge entry for an off-board unit
  twistOptions?: Twist[] // torsoTwist
  canFlip?: boolean // torsoTwist
  targets?: UnitId[] // declareFire / declarePhysical: units that some option can attack
  mountId?: LocalId // chooseAmmo
  bins?: { binId: LocalId; ammo: Id; shots: number }[] // chooseAmmo
  psr?: PsrOdds // standUp
  power?: { unitId: UnitId; options: ('stay' | 'shutdown' | 'restart')[]; avoidTn?: number }[] // powerChoice
  code?: ChoiceCode // choice
  data?: Record<string, unknown>
  result?: GameResult // gameOver
}
export interface DecisionOption { id: string; label: string; action: Action; p?: number }
export interface PendingDecision {
  id: DecisionId
  player: PlayerId
  kind: DecisionKind
  phase: PhaseId
  step: PhaseStep
  unitId: UnitId | null // the unit the decision is about, when there is one
  context: DecisionContext
  options?: DecisionOption[] // finite decisions; continuous ones (move, declareFire, deploy) use legalActions
  canPass: boolean
}

// ---------- rejection (00 §13) ----------
export const REJECTION_CODES = [
  'E_WRONG_DECISION', 'E_NOT_YOUR_DECISION', 'E_NOT_AN_OPTION', 'E_BAD_PAYLOAD', 'E_BAD_SETUP', 'E_DATA_VERSION', 'E_GAME_OVER',
  'E_UNKNOWN_UNIT', 'E_NOT_YOUR_UNIT', 'E_NOT_ELIGIBLE', 'E_SHUTDOWN', 'E_UNCONSCIOUS',
  'E_OFF_BOARD', 'E_BAD_FACING', 'E_PROHIBITED_HEX', 'E_OCCUPIED', 'E_NOT_ENOUGH_MP', 'E_BAD_MODE', 'E_NO_BACKWARD',
  'E_LEVEL_CHANGE', 'E_PRONE', 'E_CANNOT_STAND', 'E_CANNOT_JUMP', 'E_JUMP_TOO_HIGH', 'E_BAD_ENTRY', 'E_EXIT_EDGE',
  'E_WITHDRAWAL', 'E_NO_TWIST',
  'E_UNKNOWN_WEAPON', 'E_WEAPON_DESTROYED', 'E_WEAPON_USED', 'E_DUPLICATE', 'E_OUT_OF_ARC', 'E_OUT_OF_RANGE', 'E_NO_LOS',
  'E_WATER_LINE', 'E_FRIENDLY_TARGET', 'E_TN_TOO_HIGH', 'E_NO_AMMO', 'E_WRONG_AMMO', 'E_PRIMARY_TARGET', 'E_AIMED_SHOT',
  'E_NO_RANGED', 'E_PROP_ARM', 'E_RAPID_MODE',
  'E_NOT_ADJACENT', 'E_LEVEL_DIFF', 'E_LIMB_UNAVAILABLE', 'E_ATTACK_LIMIT', 'E_NO_PHYSICAL', 'E_BAD_TARGET',
] as const
export type RejectionCode = (typeof REJECTION_CODES)[number]
export interface Rejection { code: RejectionCode; message: string; detail?: Record<string, unknown> }
/** Thrown only for corrupt state (programmer error). Illegal input is a Rejection, never a throw. */
export class EngineInvariantError extends Error { override name = 'EngineInvariantError' }

// ---------- rng (00 §12) ----------
export type RngState = [number, number, number, number] // sfc32 state, u32 each
export const ROLL_PURPOSES = [
  'initiative', 'toHit', 'physicalToHit', 'aimedShot', 'cluster', 'hitLocation', 'punchLocation', 'kickLocation',
  'fallSide', 'fallLocation', 'critCheck', 'critSlot', 'psr', 'seatbelt', 'consciousness', 'recovery', 'shutdownAvoid',
  'startup', 'ammoExplosionAvoid', 'fallFromAbove', 'escalatingFailure', 'jam', 'sensorCheck', 'tieBreak',
] as const
export type RollPurpose = (typeof ROLL_PURPOSES)[number]

// ---------- engine API results (00 §2, §12) ----------
export interface StepResult {
  state: GameState // SAME reference when rejected
  events: GameEvent[]
  pending: PendingDecision // exactly one; kind 'gameOver' once the game has ended
  rejection?: Rejection
}
export interface PlayerView { player: PlayerId; state: GameState } // no hidden information in release 1
export interface SaveFile {
  format: 1
  engine: string // ENGINE_VERSION (semver)
  dataVersion: string
  setup: GameSetup
  seed: string
  actions: Action[]
  meta: { savedAt: string; label: string }
}
