// FROZEN after M0: every player input is an Action answering state.pending (00 §9). Additive changes only.
import type { ArmLoc, DecisionId, Facing, Hex, LegLoc, LocalId, Loc, MoveMode, PlayerId, StepOp, Twist, UnitId } from './types'

interface Base<T extends string> { type: T; decisionId: DecisionId; player: PlayerId }

// ---------- generic ----------
/** Legal iff pending.canPass. */
export interface PassAction extends Base<'pass'> {}
/** Answers initiativeAck and gameOver. */
export interface AckAction extends Base<'ack'> {}
/** Answers a `choice` decision (option id from pending.options). */
export interface ChoiceAction extends Base<'choice'> { optionId: string }

// ---------- setup ----------
/** Places one unit (edgePlace / hexes deployment, 11 §4.2-4.3). */
export interface DeployAction extends Base<'deploy'> { unitId: UnitId; hex: Hex; facing: Facing }

// ---------- alternation ----------
/** Picks the next unit to move / declare for (INIT-005). */
export interface SelectUnitAction extends Base<'selectUnit'> { unitId: UnitId }

// ---------- movement ----------
export interface MoveStep { op: StepOp }
export interface MoveAction extends Base<'move'> {
  unitId: UnitId
  mode: MoveMode
  /** Ground moves (standStill/walk/run): primitive steps in order. Jump: must be []. */
  steps: MoveStep[]
  /** Jump only: landing hex (for a DFA, the target's hex). */
  jumpTo?: Hex
  /** Final feet facing. Ground: the engine appends the cheapest turns after `steps` to reach it (ties: turnRight). Jump: free. */
  facing: Facing
  /** Off-board unit only: the virtual off-board start hex and facing (forward must enter a home-edge hex). */
  entry?: { hex: Hex; facing: Facing }
  /**
   * Charge (walk/run) or DFA (jump) declared with this move (PHYS-040, PHYS-060; 00 §9.6). Charge: steps end adjacent to the
   * target, facing it, never entering its hex; dfaFrom absent. DFA: jumpTo = the target's hex; dfaFrom = last path hex before
   * the target (needed only when two tie); facing = from dfaFrom toward the target.
   */
  attack?: { kind: 'charge' | 'dfa'; targetId: UnitId; dfaFrom?: Hex }
  /**
   * Run mode only (10 EQUIP-021): activate MASC before the unit spends any MP this turn (escalating-failure roll first). Run MP
   * becomes walk x 2; on a failed roll the move stops where normal Run MP runs out. Once active, later move actions this turn
   * keep the boost without a new roll.
   */
  masc?: boolean
}
/** Prone unit: attempt to stand (2 MP, PSR) or stay prone. `mode` is required on the turn's first stand decision. `facing` (MOVE-042): free facing taken on success, default current. */
export interface StandUpAction extends Base<'standUp'> { unitId: UnitId; attempt: boolean; mode?: 'walk' | 'run'; facing?: Facing }

// ---------- attacks ----------
/** Torso twist (-1/0/+1) or arm flip, once per turn (ARC-010..013). twist 0 + flip false = keep forward. */
export interface TorsoTwistAction extends Base<'torsoTwist'> { unitId: UnitId; twist: Twist; flip: boolean }
export interface FireShot {
  mountId: LocalId
  targetId: UnitId | null // null = empty hex in `hex`
  hex?: Hex
  binId?: LocalId // omitted: engine default (00 §9.4) or a chooseAmmo decision
  aimedAt?: Loc
  rapidShots?: number // rapid-fire weapons: one of the weapon's modes
}
/**
 * The unit's whole ranged declaration, validated as one composite action (00 §9.7): any bad shot rejects all of it.
 * shots [] = hold fire, always legal and always first in legalActions. The first shot's target is the primary target;
 * if any declared target is in the Forward arc and the first shot's is not → E_PRIMARY_TARGET (TOHIT-005). Never reordered.
 */
export interface DeclareFireAction extends Base<'declareFire'> {
  unitId: UnitId
  shots: FireShot[]
  propArm?: ArmLoc
  /** PPC mounts whose linked capacitor charges this turn (10 EQUIP-016): 5 heat now, +5 damage on that PPC's shot next turn. A charging PPC does not fire. */
  charge?: LocalId[]
  /** A coolant pod mount vented this turn (10 EQUIP-017): one use per game, extra dissipation in this turn's Heat Phase. */
  coolantPod?: LocalId
}
export interface ChooseAmmoAction extends Base<'chooseAmmo'> { mountId: LocalId; binId: LocalId }
export type PhysicalChoice =
  | { kind: 'none' }
  | { kind: 'punch'; arms: { arm: ArmLoc; targetId: UnitId }[] }
  | { kind: 'kick'; leg: LegLoc; targetId: UnitId }
  | { kind: 'push'; targetId: UnitId }
export interface DeclarePhysicalAction extends Base<'declarePhysical'> { unitId: UnitId; attack: PhysicalChoice }

// ---------- power ----------
/** End Phase voluntary shutdown / restart for this side's units; unlisted units keep their state. */
export interface PowerChoiceAction extends Base<'powerChoice'> { changes: { unitId: UnitId; to: 'shutdown' | 'restart' }[] }

export type Action =
  | PassAction | AckAction | ChoiceAction | DeployAction | SelectUnitAction | MoveAction | StandUpAction
  | TorsoTwistAction | DeclareFireAction | ChooseAmmoAction | DeclarePhysicalAction | PowerChoiceAction
export type ActionType = Action['type']
