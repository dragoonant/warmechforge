// Movement (10 §3, 00 §9.3): current MP, immobility, hex costs, move planning, the reachable search and move execution.
// Pure: state in, { state, events } out. Rolls only through psr.ts (resolvePsrs / fall); heat only through addHeat.
import type { MoveAction, StandUpAction } from './actions'
import type { GameEvent } from './events'
import { partialWingBonuses } from './crits'
import { addHeat, heatMpLoss, hitCount, movementHeat } from './heat'
import { directionTo, distance, edgeHexes, hexEq, hexKey, neighbor, neighbors, onBoard, opposite, turnLeft, turnRight } from './hex'
import type { PathStep, ReachEntry } from './index'
import { patchUnit } from './pilot'
import type { Stepped } from './pilot'
import { pAtLeast2d6 } from './prob'
import { persistentMods, queuePsr, resolvePsrs } from './psr'
import { floorLevel, hexAt } from './terrain'
import { attackerMoveMod, tmmForHexes } from './tohit'
import type {
  BoardHex, Edge, Facing, GameState, Hex, MoveMode, Rejection, RejectionCode, StepOp, UnitId, UnitState,
} from './types'
import { FACINGS } from './types'

// ---------- current MP (MOVE-006..008) ----------
export interface MpSet { walk: number; run: number; jump: number }

const LEG_TOKENS = ['hip', 'upperLeg', 'lowerLeg', 'foot']
const legsDestroyed = (u: UnitState): number => (u.locs.LL.destroyed ? 1 : 0) + (u.locs.RL.destroyed ? 1 : 0)
const legCrits = (u: UnitState, tokens: readonly string[] = LEG_TOKENS): number =>
  (['LL', 'RL'] as const).reduce((n, l) => n + u.slots[l].filter((s) => s.hit && tokens.includes(s.token)).length, 0)

/** Walk MP from damage alone (no heat), MOVE-006. */
export function damagedWalk(u: UnitState): number {
  const base = u.baseMp.walk
  const out = legsDestroyed(u)
  if (out >= 2) return 0
  if (out === 1) return Math.min(1, base)
  return Math.max(Math.min(1, base), base - legCrits(u))
}
const depthOf = (state: GameState, u: UnitState): number => (u.pos ? hexAt(state.board, u.pos)?.depth ?? 0 : 0)
const isJumpJet = (item: string): boolean => item.includes('jump-jet')

/** Jump MP: operable jets plus the partial-wing bonus; leg jets fail in depth 1, all jets when submerged (MOVE-007, MOVE-062). */
export function jumpMp(state: GameState, u: UnitState): number {
  if (u.baseMp.jump <= 0) return 0
  const depth = depthOf(state, u)
  if (depth >= (u.prone ? 1 : 2)) return 0
  let lost = 0
  for (const m of Object.values(u.mounts)) {
    if (!isJumpJet(m.item)) continue
    if (m.destroyed || u.locs[m.location].destroyed) lost++
    else if (depth >= 1 && (m.location === 'LL' || m.location === 'RL')) lost++
  }
  return Math.max(0, u.baseMp.jump - lost) + partialWingBonuses(u).jump
}
/** Current MP after damage and heat (MOVE-006). Walk floors at 0, run = ceil(1.5 walk), jump ignores heat. */
export function currentMp(state: GameState, unitId: UnitId): MpSet {
  const u = state.units[unitId]!
  const walk = Math.max(0, damagedWalk(u) - heatMpLoss(u.heat))
  return { walk, run: Math.ceil(1.5 * walk), jump: jumpMp(state, u) }
}
/** MOVE-008: shut down, unconscious pilot, or damage alone leaves 0 MP in every mode. */
export function isImmobile(state: GameState, u: UnitState): boolean {
  if (u.shutdown !== null || !u.pilot.conscious || u.pilot.dead) return true
  return damagedWalk(u) === 0 && jumpMp(state, u) === 0
}

// ---------- plan types ----------
export interface PsrTrigger { reason: 'runWater' | 'rubble' | 'backwardLevel' | 'landWater' | 'stand' | 'runDamaged' | 'jumpDamaged'; mod: number; levels?: number }
interface PlanStep {
  op: StepOp | 'jump'
  from: Hex
  to: Hex
  facing: Facing
  cost: PathStep['cost']
  mpLeft: number
  psrs: PsrTrigger[]
  prone: boolean // prone after this step
}
interface Sim {
  hex: Hex
  virtual: boolean // still on the virtual off-board hex (edge entry)
  facing: Facing
  prone: boolean
  mp: number
  hexes: number
  lastDir: 'f' | 'b' | null
  ran: number
  mode: MoveMode // effective mode (min move forces run)
  steps: PlanStep[]
  exited: boolean
  jumped: boolean
  origin?: { hex: Hex; facing: Facing } // edge entry: the virtual start
}
interface Ctx {
  state: GameState
  u: UnitState
  mp: MpSet
  cap: number // MP available to this action in the chosen mode
  mode: MoveMode
  hipCrits: number
  firstAction: boolean // nothing spent yet this turn
  entering: boolean
}
type Fail = { fail: Rejection }
const rej = (code: RejectionCode, message: string, detail?: Record<string, unknown>): Fail => ({ fail: { code, message, ...(detail ? { detail } : {}) } })
const isFail = <T>(x: T | Fail): x is Fail => typeof x === 'object' && x !== null && 'fail' in x

const liveOnBoard = (x: UnitState): boolean => x.pos !== null && (x.status === 'active' || x.status === 'withdrawing')
export function unitAt(state: GameState, h: Hex, except?: UnitId): UnitState | null {
  for (const id of state.unitOrder) {
    const x = state.units[id]!
    if (id !== except && liveOnBoard(x) && hexEq(x.pos!, h)) return x
  }
  return null
}
const hitSlots = (u: UnitState, token: string): number => hitCount(u, token)

// ---------- hex costs (MOVE-020..029) ----------
export interface HexCost { terrain: number; level: number; total: number; delta: number }
export function terrainCost(bh: BoardHex): number {
  return (bh.rough ? 1 : 0) + (bh.rubble ? 1 : 0) + (bh.woods === 'heavy' ? 2 : bh.woods === 'light' ? 1 : 0) + (bh.depth >= 2 ? 2 : bh.depth === 1 ? 1 : 0)
}
/** Cost of entering `to` from `from` (1 + terrain + level change), or null when a 3+ level change is prohibited. */
export function enterCost(from: BoardHex, to: BoardHex): HexCost | null {
  const delta = Math.abs(floorLevel(to) - floorLevel(from))
  if (delta > 2) return null
  const terrain = terrainCost(to)
  return { terrain, level: delta, total: 1 + terrain + delta, delta }
}

function entryPsrs(mode: MoveMode, to: BoardHex, backward: boolean, delta: number): PsrTrigger[] {
  const out: PsrTrigger[] = []
  if (mode === 'run' && to.depth >= 1) out.push({ reason: 'runWater', mod: to.depth === 1 ? -1 : to.depth === 2 ? 0 : 1 })
  if (to.rubble) out.push({ reason: 'rubble', mod: 0 })
  if (backward && delta > 0) out.push({ reason: 'backwardLevel', mod: 0 })
  return out
}

// ---------- edge entry helpers ----------
/** Start facings pointing into the map from a home edge (11 §4.1). */
export function entryFacings(edge: Edge): Facing[] {
  return edge === 'south' ? [0] : edge === 'north' ? [3] : edge === 'west' ? [1, 2] : [4, 5]
}
const homeEdgeOf = (state: GameState, u: UnitState): Edge => state.sides[u.owner].homeEdge

// ---------- one primitive op ----------
function applyOp(c: Ctx, s: Sim, op: StepOp): Sim | Fail {
  const { state, u } = c
  const board = state.board
  if (s.exited) return rej('E_BAD_PAYLOAD', 'no steps after exit')
  if (c.mode === 'standStill') return rej('E_BAD_MODE', 'stand still allows no steps')
  if (s.virtual && op !== 'forward') return rej('E_BAD_ENTRY', 'an entering unit must first step forward onto the board')

  if (op === 'turnLeft' || op === 'turnRight') {
    if (s.mp + 1 > c.cap) return rej('E_NOT_ENOUGH_MP', 'not enough MP to turn')
    const facing = op === 'turnLeft' ? turnLeft(s.facing) : turnRight(s.facing)
    const step: PlanStep = { op, from: s.hex, to: s.hex, facing, cost: { base: 0, terrain: 0, level: 0, turn: 1, total: 1 }, mpLeft: c.cap - s.mp - 1, psrs: [], prone: s.prone }
    return { ...s, facing, mp: s.mp + 1, steps: [...s.steps, step] }
  }
  if (op === 'dropProne') {
    if (s.prone) return rej('E_PRONE', 'already prone')
    if (s.mp + 1 > c.cap) return rej('E_NOT_ENOUGH_MP', 'not enough MP to drop prone')
    const step: PlanStep = { op, from: s.hex, to: s.hex, facing: s.facing, cost: { base: 1, terrain: 0, level: 0, turn: 0, total: 1 }, mpLeft: c.cap - s.mp - 1, psrs: [], prone: true }
    return { ...s, prone: true, mp: s.mp + 1, steps: [...s.steps, step] }
  }
  if (op === 'exit') {
    if (u.status !== 'withdrawing') return rej('E_WITHDRAWAL', 'only a withdrawing unit may leave the map')
    if (!edgeHexes(board, homeEdgeOf(state, u)).some((h) => hexEq(h, s.hex))) return rej('E_EXIT_EDGE', 'a unit may leave only by its home edge')
    if (s.prone) return rej('E_PRONE', 'a prone unit cannot leave')
    if (s.mp + 1 > c.cap) return rej('E_NOT_ENOUGH_MP', 'not enough MP to leave')
    const step: PlanStep = { op, from: s.hex, to: s.hex, facing: s.facing, cost: { base: 1, terrain: 0, level: 0, turn: 0, total: 1 }, mpLeft: c.cap - s.mp - 1, psrs: [], prone: false }
    return { ...s, mp: s.mp + 1, exited: true, steps: [...s.steps, step] }
  }
  // forward / backward
  if (s.prone) return rej('E_PRONE', 'a prone unit can only turn')
  if (op === 'backward' && s.mode === 'run') return rej('E_NO_BACKWARD', 'no backward moves while running')
  const dir = op === 'forward' ? s.facing : opposite(s.facing)
  const to = s.virtual ? neighbor(s.hex, s.facing) : neighbor(s.hex, dir)
  if (!onBoard(board, to)) return rej('E_OFF_BOARD', 'that hex is off the board')
  const toBh = hexAt(board, to)!
  const fromBh = s.virtual ? toBh : hexAt(board, s.hex)!
  if (s.virtual && !edgeHexes(board, homeEdgeOf(state, u)).some((h) => hexEq(h, to))) return rej('E_BAD_ENTRY', 'must enter on a home-edge hex')
  const occ = unitAt(state, to, u.id)
  if (occ && occ.owner !== u.owner && !isImmobile(state, occ)) return rej('E_PROHIBITED_HEX', 'a mobile enemy holds that hex', { hex: to })
  const cost = s.virtual ? { terrain: terrainCost(toBh), level: 0, total: 1 + terrainCost(toBh), delta: 0 } : enterCost(fromBh, toBh)
  if (!cost) return rej('E_LEVEL_CHANGE', 'a level change of 3 or more is prohibited')
  if (c.hipCrits > 0 && cost.delta > 1) return rej('E_LEVEL_CHANGE', 'a hip crit limits a hex to one level of change')
  let mode = s.mode
  if (s.mp + cost.total > c.cap) {
    // MOVE-014 minimum movement: first hex ahead, nothing else spent, counts as a run
    const minMove = op === 'forward' && s.steps.length === 0 && c.firstAction && c.cap >= 1 && (c.mode === 'walk' || c.mode === 'run')
    if (!minMove) return rej('E_NOT_ENOUGH_MP', 'not enough MP', { need: cost.total, have: c.cap - s.mp })
    mode = 'run'
  }
  const thisDir = op === 'forward' ? 'f' : 'b'
  const hexes = (s.lastDir && s.lastDir !== thisDir ? 0 : s.hexes) + 1
  const psrs = entryPsrs(mode, toBh, op === 'backward', cost.delta)
  const step: PlanStep = {
    op, from: s.virtual ? s.hex : s.hex, to, facing: s.facing,
    cost: { base: 1, terrain: cost.terrain, level: cost.level, turn: 0, total: cost.total }, mpLeft: c.cap - s.mp - cost.total, psrs, prone: false,
  }
  return { ...s, hex: to, virtual: false, mp: s.mp + cost.total, hexes, lastDir: thisDir, ran: s.ran + (mode === 'run' ? 1 : 0), mode, steps: [...s.steps, step] }
}

const turnsTo = (from: Facing, to: Facing): StepOp[] => {
  const d = (to - from + 6) % 6
  if (d === 0) return []
  return d <= 3 ? Array<StepOp>(d).fill('turnRight') : Array<StepOp>(6 - d).fill('turnLeft')
}

// ---------- context ----------
function buildCtx(state: GameState, u: UnitState, mode: MoveMode): Ctx | Fail {
  if (u.shutdown) return rej('E_SHUTDOWN', 'the unit is shut down')
  if (!u.pilot.conscious || u.pilot.dead) return rej('E_UNCONSCIOUS', 'the pilot is unconscious')
  if (isImmobile(state, u)) return rej('E_NOT_ELIGIBLE', 'the unit is immobile')
  if (u.move.done) return rej('E_NOT_ELIGIBLE', 'the unit already moved this turn')
  if (u.move.mode !== null && u.move.mode !== mode && !(u.move.mode === 'walk' && mode === 'run')) {
    return rej('E_BAD_MODE', `mode is locked to ${u.move.mode}`)
  }
  const mp = currentMp(state, u.id)
  const total = mode === 'walk' ? mp.walk : mode === 'run' ? mp.run : mode === 'jump' ? mp.jump : 0
  if ((mode === 'walk' || mode === 'run') && total < 1) return rej('E_BAD_MODE', `no ${mode} MP`)
  return {
    state, u, mp, mode, cap: Math.max(0, total - u.move.mpSpent), hipCrits: hitSlots(u, 'hip'),
    firstAction: u.move.mpSpent === 0 && u.move.standAttempts === 0, entering: u.pos === null,
  }
}
const startSim = (u: UnitState, mode: MoveMode, c: Ctx, entry?: { hex: Hex; facing: Facing }): Sim =>
  entry
    ? { hex: entry.hex, virtual: true, facing: entry.facing, prone: false, mp: 0, hexes: 0, lastDir: null, ran: 0, mode, steps: [], exited: false, jumped: false, origin: entry }
    : { hex: u.pos!, virtual: false, facing: u.facing, prone: u.prone, mp: 0, hexes: c.u.move.hexesMoved, lastDir: null, ran: 0, mode, steps: [], exited: false, jumped: false }

// ---------- jump (MOVE-050..054) ----------
/** MOVE-051: some shortest path whose hexes (and the landing hex) stay at or below `limit`. */
function jumpPathOk(state: GameState, a: Hex, b: Hex, limit: number): boolean {
  let frontier: Hex[] = [a]
  for (let d = distance(a, b); d > 0; d--) {
    const next = new Map<string, Hex>()
    for (const h of frontier) {
      for (const n of neighbors(h)) {
        if (distance(n, b) !== d - 1 || !onBoard(state.board, n)) continue
        if (hexAt(state.board, n)!.level > limit) continue
        next.set(hexKey(n), n)
      }
    }
    if (next.size === 0) return false
    frontier = [...next.values()]
  }
  return true
}
function planJump(c: Ctx, jumpTo: Hex, facing: Facing): Sim | Fail {
  const { state, u } = c
  if (c.entering) return rej('E_BAD_MODE', 'an entering unit cannot jump')
  if (u.prone || u.move.mode !== null) return rej('E_BAD_MODE', 'only a unit standing at turn start may jump')
  if (c.mp.jump < 1) return rej('E_CANNOT_JUMP', 'no jump MP')
  if (!onBoard(state.board, jumpTo)) return rej('E_OFF_BOARD', 'the landing hex is off the board')
  const from = u.pos!
  const cost = Math.max(1, distance(from, jumpTo))
  if (cost > c.mp.jump) return rej('E_NOT_ENOUGH_MP', 'the landing hex is too far', { need: cost, have: c.mp.jump })
  const startBh = hexAt(state.board, from)!, toBh = hexAt(state.board, jumpTo)!
  if (!jumpPathOk(state, from, jumpTo, floorLevel(startBh) + c.mp.jump) && !hexEq(from, jumpTo)) return rej('E_JUMP_TOO_HIGH', 'terrain on every shortest path is too high')
  if (toBh.level > floorLevel(startBh) + c.mp.jump) return rej('E_JUMP_TOO_HIGH', 'the landing hex is too high')
  const occ = unitAt(state, jumpTo, u.id)
  if (occ) return rej(occ.owner !== u.owner && !isImmobile(state, occ) ? 'E_PROHIBITED_HEX' : 'E_OCCUPIED', 'the landing hex is occupied')
  const step: PlanStep = { op: 'jump', from, to: jumpTo, facing, cost: { base: cost, terrain: 0, level: 0, turn: 0, total: cost }, mpLeft: c.cap - cost, psrs: [], prone: false }
  if (toBh.depth >= 1) step.psrs = [{ reason: 'landWater', mod: 0, levels: toBh.depth }]
  return { hex: jumpTo, virtual: false, facing, prone: false, mp: cost, hexes: distance(from, jumpTo), lastDir: null, ran: 0, mode: 'jump', steps: [step], exited: false, jumped: true }
}

// ---------- end-of-move PSRs (PSR-031) ----------
function endPsrs(u: UnitState, s: Sim): PsrTrigger[] {
  const out: PsrTrigger[] = []
  const gyro = hitSlots(u, 'gyro') > 0, hip = hitSlots(u, 'hip') > 0, legOut = legsDestroyed(u) > 0
  if (s.mode === 'run' && s.ran > 0 && (gyro || hip || legOut)) out.push({ reason: 'runDamaged', mod: 0 })
  if (s.jumped && (gyro || hip || legOut || legCrits(u, ['upperLeg', 'lowerLeg']) > 0)) out.push({ reason: 'jumpDamaged', mod: 0 })
  return out
}

// ---------- the plan ----------
export interface MovePlan {
  sim: Sim
  mode: MoveMode // effective mode for the turn (stand still when nothing was spent)
  steps: PlanStep[]
  end: PsrTrigger[]
  mpUsed: number
  hexesMoved: number
  tmm: number
  attackerMod: number
  heat: number
}
function summarize(c: Ctx, s: Sim): MovePlan {
  const spent = c.u.move.mpSpent + s.mp
  const eff: MoveMode = spent === 0 && c.u.move.standAttempts === 0 ? 'standStill' : s.mode
  const hexesMoved = s.hexes
  const tmm = eff === 'standStill' ? 0 : tmmForHexes(hexesMoved) + (s.jumped ? 1 : 0)
  const moved = spent > 2 * c.u.move.standAttempts
  const heat = eff === 'walk' || eff === 'run' ? (moved ? movementHeat(eff, 0) : 0) : eff === 'jump' ? movementHeat('jump', hexesMoved) : 0
  return { sim: s, mode: eff, steps: s.steps, end: endPsrs(c.u, s), mpUsed: spent, hexesMoved, tmm, attackerMod: attackerMoveMod(eff), heat }
}

/** Validates a MoveAction against the state and builds its plan (no dice, no mutation). */
export function planMove(state: GameState, action: MoveAction): MovePlan | Fail {
  const u = state.units[action.unitId]
  if (!u) return rej('E_UNKNOWN_UNIT', 'unknown unit')
  if (u.owner !== action.player) return rej('E_NOT_YOUR_UNIT', 'not your unit')
  if (!(FACINGS as readonly number[]).includes(action.facing)) return rej('E_BAD_FACING', 'facing must be 0 to 5')
  if (u.status !== 'active' && u.status !== 'withdrawing' && u.status !== 'offBoard') return rej('E_NOT_ELIGIBLE', 'the unit cannot move')
  const c = buildCtx(state, u, action.mode)
  if (isFail(c)) return c
  if (action.attack) return planAttackMove(state, u, c, action)
  if (u.status === 'offBoard' && !action.entry) return rej('E_BAD_ENTRY', 'an off-board unit must give its entry')
  if (u.status !== 'offBoard' && action.entry) return rej('E_BAD_ENTRY', 'only an off-board unit has an entry')

  if (action.mode === 'jump') {
    if (action.steps.length > 0 || !action.jumpTo) return rej('E_BAD_PAYLOAD', 'a jump needs jumpTo and no steps')
    const j = planJump(c, action.jumpTo, action.facing)
    return isFail(j) ? j : summarize(c, j)
  }
  if (action.mode === 'standStill') {
    if (action.steps.length > 0) return rej('E_BAD_MODE', 'stand still allows no steps')
    if (c.entering) return rej('E_BAD_ENTRY', 'an entering unit must enter the board')
    if (action.facing !== u.facing) return rej('E_BAD_FACING', 'stand still allows no facing change')
    return summarize(c, startSim(u, 'standStill', c))
  }
  let entry: { hex: Hex; facing: Facing } | undefined
  if (action.entry) {
    const e = action.entry
    const edge = homeEdgeOf(state, u)
    if (!entryFacings(edge).includes(e.facing) || onBoard(state.board, e.hex)) return rej('E_BAD_ENTRY', 'bad entry hex or facing')
    const first = neighbor(e.hex, e.facing)
    if (!edgeHexes(state.board, edge).some((h) => hexEq(h, first))) return rej('E_BAD_ENTRY', 'the entry must lead onto a home-edge hex')
    entry = e
  }
  let s: Sim | Fail = startSim(u, action.mode, c, entry)
  for (const st of action.steps) {
    s = applyOp(c, s, st.op)
    if (isFail(s)) return s
  }
  if (s.virtual) return rej('E_BAD_ENTRY', 'a unit may not stop off the board')
  if (!s.exited) {
    if (s.prone && s.facing !== action.facing) { /* prone units still turn */ }
    for (const op of turnsTo(s.facing, action.facing)) {
      s = applyOp(c, s, op)
      if (isFail(s)) return s
    }
    const occ = unitAt(state, s.hex, u.id)
    if (occ) return rej('E_OCCUPIED', 'cannot end a move in an occupied hex', { hex: s.hex })
  }
  return summarize(c, s)
}

// ---------- charge and DFA declared with the move (PHYS-005, PHYS-040, PHYS-060; 00 §9.6) ----------
/** Common target checks for a charge or DFA, in 00 §9.6 order: an enemy on the board, then PHYS-005 limits. */
function attackTarget(state: GameState, u: UnitState, targetId: UnitId): UnitState | Fail {
  const t = state.units[targetId]
  if (!t || t.owner === u.owner || !t.pos || (t.status !== 'active' && t.status !== 'withdrawing') || t.doomed) {
    return rej('E_BAD_TARGET', 'the target must be an enemy on the board')
  }
  const taken = state.unitOrder.some((id) => {
    if (id === u.id) return false
    const x = state.units[id]!
    return x.attacks.charge?.targetId === targetId || x.attacks.dfa?.targetId === targetId
  })
  if (taken) return rej('E_ATTACK_LIMIT', 'that unit is already the target of a charge or DFA')
  if (t.attacks.charge || t.attacks.dfa) return rej('E_ATTACK_LIMIT', 'a unit making a charge or DFA cannot be attacked')
  return t
}
/** PHYS-061: the hexes a DFA can come from, the last hexes of shortest jump paths before the target. */
export function dfaFromCandidates(state: GameState, from: Hex, target: Hex): Hex[] {
  const d = distance(from, target)
  if (d <= 1) return d === 1 ? [from] : []
  return neighbors(target).filter((n) => onBoard(state.board, n) && distance(from, n) === d - 1)
}
function planAttackMove(state: GameState, u: UnitState, c: Ctx, action: MoveAction): MovePlan | Fail {
  const atk = action.attack!
  if (atk.kind !== 'charge' && atk.kind !== 'dfa') return rej('E_BAD_PAYLOAD', 'attack kind must be charge or dfa')
  if (u.status === 'offBoard' || action.entry) return rej('E_BAD_TARGET', 'an entering unit cannot charge or DFA')
  const t = attackTarget(state, u, atk.targetId)
  if (isFail(t)) return t
  const tHex = t.pos!
  if (atk.kind === 'charge') {
    if (action.mode !== 'walk' && action.mode !== 'run') return rej('E_BAD_TARGET', 'a charge is made walking or running')
    if (atk.dfaFrom) return rej('E_BAD_PAYLOAD', 'a charge has no dfaFrom')
    if (t.prone) return rej('E_BAD_TARGET', 'a prone unit cannot be charged')
    if (!t.move.done && !state.ledger.immobileAtStart.includes(t.id)) return rej('E_BAD_TARGET', 'the target has not moved yet')
    const { attack: _drop, ...rest } = action
    const plain = planMove(state, rest as MoveAction)
    if (isFail(plain)) return plain
    const end = plain.sim
    if (end.exited || end.prone || distance(end.hex, tHex) !== 1) return rej('E_BAD_TARGET', 'a charge must end adjacent to the target')
    if (action.facing !== directionTo(end.hex, tHex)) return rej('E_BAD_FACING', 'a charger must face its target')
    const cost = enterCost(hexAt(state.board, end.hex)!, hexAt(state.board, tHex)!)
    if (!cost || c.cap - end.mp < cost.total) return rej('E_NOT_ENOUGH_MP', 'not enough MP left to enter the target hex')
    return plain
  }
  // DFA
  if (action.mode !== 'jump') return rej('E_BAD_TARGET', 'a death from above is made jumping')
  if (!action.jumpTo || !hexEq(action.jumpTo, tHex)) return rej('E_BAD_TARGET', 'a death from above lands on the target hex')
  if (action.steps.length > 0) return rej('E_BAD_PAYLOAD', 'a jump needs jumpTo and no steps')
  if (c.entering || u.prone || u.move.mode !== null) return rej('E_BAD_MODE', 'only a unit standing at turn start may jump')
  if (c.mp.jump < 1) return rej('E_CANNOT_JUMP', 'no jump MP')
  const from = u.pos!
  const cands = dfaFromCandidates(state, from, tHex)
  let dfaFrom: Hex | undefined
  if (atk.dfaFrom) dfaFrom = cands.find((h) => hexEq(h, atk.dfaFrom!))
  else if (cands.length === 1) dfaFrom = cands[0]
  if (!dfaFrom) return rej('E_BAD_TARGET', cands.length > 1 ? 'choose the hex the jump comes from' : 'no jump path reaches the target')
  if (action.facing !== directionTo(dfaFrom, tHex)) return rej('E_BAD_FACING', 'a DFA faces its target')
  const occ = unitAt(state, dfaFrom, u.id)
  if (occ) return rej('E_OCCUPIED', 'the last hex before the target is taken')
  const hexes = distance(from, tHex)
  if (hexes > c.mp.jump) return rej('E_NOT_ENOUGH_MP', 'the target is out of jump range', { need: hexes, have: c.mp.jump })
  const startBh = hexAt(state.board, from)!, tBh = hexAt(state.board, tHex)!
  const limit = floorLevel(startBh) + c.mp.jump
  if (floorLevel(tBh) + (t.prone ? 1 : 2) > limit || !jumpPathOk(state, from, dfaFrom, limit)) return rej('E_JUMP_TOO_HIGH', 'the jump cannot clear the target')
  const step: PlanStep = { op: 'jump', from, to: dfaFrom, facing: action.facing, cost: { base: hexes, terrain: 0, level: 0, turn: 0, total: hexes }, mpLeft: c.cap - hexes, psrs: [], prone: false }
  const sim: Sim = { hex: dfaFrom, virtual: false, facing: action.facing, prone: false, mp: hexes, hexes, lastDir: null, ran: 0, mode: 'jump', steps: [step], exited: false, jumped: true }
  return summarize(c, sim)
}

export function validateMove(state: GameState, action: MoveAction): Rejection | null {
  const p = planMove(state, action)
  if (isFail(p)) return p.fail
  const u = state.units[action.unitId]!
  if (u.status === 'withdrawing' && !withdrawOk(state, u, p)) return { code: 'E_WITHDRAWAL', message: 'a withdrawing unit must end closer to its home edge' }
  return null
}

// ---------- withdrawal (11 §3.3) ----------
const edgeDistance = (state: GameState, edge: Edge, h: Hex): number => Math.min(...edgeHexes(state.board, edge).map((e) => distance(e, h)))
function withdrawOk(state: GameState, u: UnitState, p: MovePlan): boolean {
  if (p.sim.exited) return true
  const edge = homeEdgeOf(state, u)
  const closer = edgeDistance(state, edge, p.sim.hex) < edgeDistance(state, edge, u.pos!)
  if (closer) return true
  return !hasCloserMove(state, u)
}
let withdrawProbe = false
function hasCloserMove(state: GameState, u: UnitState): boolean {
  if (withdrawProbe) return false
  withdrawProbe = true
  try {
    const edge = homeEdgeOf(state, u)
    const d0 = edgeDistance(state, edge, u.pos!)
    return reachable(state, u.id).some((e) => e.mode !== 'standStill' && edgeDistance(state, edge, e.hex) < d0)
  } finally { withdrawProbe = false }
}

// ---------- reachable (00 §11) ----------
function psrOdds(u: UnitState, list: PsrTrigger[]): ReachEntry['psrs'] {
  return list.map((t) => {
    const tn = u.pilot.piloting + persistentMods(u).reduce((a, m) => a + m.value, 0) + t.mod
    return { reason: t.reason, tn, p: pAtLeast2d6(tn) }
  })
}
const toPathSteps = (steps: PlanStep[]): PathStep[] =>
  steps.map((st) => ({
    op: st.op, hex: st.to, facing: st.facing, cost: st.cost, psr: st.psrs[0]?.reason ?? null,
  }))
const opsOf = (steps: PlanStep[]): { op: StepOp }[] => steps.map((st) => ({ op: st.op as StepOp }))

function entryFrom(state: GameState, u: UnitState, mode: MoveMode, p: MovePlan, extra: { entry?: { hex: Hex; facing: Facing }; jumpTo?: Hex }): ReachEntry {
  const sim = p.sim
  const action: MoveAction = {
    type: 'move', decisionId: state.pending?.id ?? '', player: u.owner, unitId: u.id, mode: p.mode === 'standStill' ? 'standStill' : mode,
    steps: mode === 'jump' ? [] : opsOf(p.steps), facing: sim.facing,
  }
  if (extra.jumpTo) action.jumpTo = extra.jumpTo
  if (extra.entry) action.entry = extra.entry
  return {
    hex: sim.hex, label: null, facing: sim.facing, mode: p.mode, path: toPathSteps(p.steps), mpUsed: p.mpUsed, hexesMoved: p.hexesMoved,
    tmm: p.tmm, attackerMod: p.attackerMod, heat: p.heat,
    psrs: psrOdds(u, [...p.steps.flatMap((s) => s.psrs), ...p.end]), endsProne: sim.prone, physical: null, action,
  }
}

function labelOf(state: GameState, h: Hex): string | null { return hexAt(state.board, h)?.label ?? null }

const nodeKey = (s: Sim): string => `${s.hex.q},${s.hex.r},${s.facing},${s.prone ? 1 : 0}`
const better = (a: Sim, b: Sim): boolean => a.mp < b.mp || (a.mp === b.mp && (a.hexes > b.hexes || (a.hexes === b.hexes && a.steps.length < b.steps.length)))

/** Ground search (Dijkstra over hex, facing, prone) for one mode. Returns the cheapest node per state. */
function groundSearch(c: Ctx, starts: Sim[]): Sim[] {
  const best = new Map<string, Sim>()
  const buckets: Sim[][] = []
  const forced: Sim[] = []
  const push = (s: Sim): void => {
    const k = nodeKey(s)
    const old = best.get(k)
    if (old && !better(s, old)) return
    best.set(k, s)
    if (s.mp > c.cap) { forced.push(s); return }
    ;(buckets[s.mp] ??= []).push(s)
  }
  starts.forEach(push)
  const ops: StepOp[] = ['forward', 'backward', 'turnLeft', 'turnRight', 'dropProne']
  for (let m = 0; m <= c.cap; m++) {
    for (const s of buckets[m] ?? []) {
      if (best.get(nodeKey(s)) !== s || s.virtual || s.exited) continue
      for (const op of ops) {
        const n = applyOp(c, s, op)
        if (!isFail(n)) push(n)
      }
    }
  }
  const out = [...best.values()]
  for (const f of forced) if (best.get(nodeKey(f)) === f && !out.includes(f)) out.push(f)
  return out
}

/** Every (hex, facing, mode) the unit can end its move in, cheapest path each (00 §11). */
export function reachable(state: GameState, unitId: UnitId): ReachEntry[] {
  const u = state.units[unitId]
  if (!u || (u.status !== 'active' && u.status !== 'withdrawing' && u.status !== 'offBoard')) return []
  if (u.move.done || isImmobile(state, u)) return []
  const out: ReachEntry[] = []
  const mp = currentMp(state, unitId)
  const locked = u.move.mode
  const entering = u.status === 'offBoard'

  if (!entering && locked === null) {
    const c = buildCtx(state, u, 'standStill')
    if (!isFail(c)) out.push(entryFrom(state, u, 'standStill', summarize(c, startSim(u, 'standStill', c)), {}))
  }
  const groundModes: MoveMode[] = locked ? (locked === 'standStill' ? [] : [locked]) : ['walk', 'run']
  for (const mode of groundModes) {
    const c = buildCtx(state, u, mode)
    if (isFail(c)) continue
    let starts: Sim[]
    if (entering) {
      starts = []
      for (const eh of edgeHexes(state.board, homeEdgeOf(state, u))) {
        for (const f of entryFacings(homeEdgeOf(state, u))) {
          const virt = neighbor(eh, opposite(f))
          if (onBoard(state.board, virt)) continue
          const n = applyOp(c, startSim(u, mode, c, { hex: virt, facing: f }), 'forward')
          if (!isFail(n)) starts.push(n)
        }
      }
    } else starts = [startSim(u, mode, c)]
    for (const s of groundSearch(c, starts)) {
      if (!entering && s.steps.length === 0 && locked === null) continue
      out.push(entryFrom(state, u, mode, summarize(c, s), s.origin ? { entry: s.origin } : {}))
    }
    // exit step for withdrawing units standing on their home edge
    if (!entering && u.status === 'withdrawing' && !u.prone) {
      const n = applyOp(c, startSim(u, mode, c), 'exit')
      if (!isFail(n)) out.push(entryFrom(state, u, mode, summarize(c, n), {}))
    }
  }
  if (!entering && locked === null && !u.prone && mp.jump >= 1) {
    const c = buildCtx(state, u, 'jump')
    if (!isFail(c)) {
      for (const hx of hexesInRange(state, u.pos!, mp.jump)) {
        for (const f of FACINGS) {
          const j = planJump(c, hx, f)
          if (!isFail(j)) out.push(entryFrom(state, u, 'jump', summarize(c, j), { jumpTo: hx }))
        }
      }
    }
  }
  if (!entering && u.status === 'active' && !u.prone) out.push(...attackEntries(state, u, out, mp))
  for (const e of out) e.label = labelOf(state, e.hex)
  if (u.status === 'withdrawing' && !entering) {
    const edge = homeEdgeOf(state, u), d0 = edgeDistance(state, edge, u.pos!)
    const good = out.filter((e) => e.action.steps.some((s) => s.op === 'exit') || (e.mode !== 'standStill' && edgeDistance(state, edge, e.hex) < d0))
    if (good.length > 0) return good
  }
  return out
}
/** Charge entries for plain ground entries that end adjacent to and facing an enemy; DFA entries per enemy in jump range (00 §9.6). */
function attackEntries(state: GameState, u: UnitState, plain: ReachEntry[], mp: MpSet): ReachEntry[] {
  const out: ReachEntry[] = []
  const enemies = state.unitOrder.map((id) => state.units[id]!).filter((t) => t.owner !== u.owner && t.pos && (t.status === 'active' || t.status === 'withdrawing') && !t.doomed)
  if (enemies.length === 0) return out
  for (const e of plain) {
    if ((e.mode !== 'walk' && e.mode !== 'run') || e.endsProne || e.action.entry || e.action.steps.some((s) => s.op === 'exit')) continue
    for (const t of enemies) {
      if (distance(e.hex, t.pos!) !== 1 || directionTo(e.hex, t.pos!) !== e.facing) continue
      const a: MoveAction = { ...e.action, attack: { kind: 'charge', targetId: t.id } }
      if (isFail(planMove(state, a))) continue
      out.push({ ...e, physical: { kind: 'charge', targetId: t.id, fromHex: e.hex }, action: a })
    }
  }
  if (u.move.mode === null && mp.jump >= 1 && u.pos) {
    for (const t of enemies) {
      if (distance(u.pos, t.pos!) > mp.jump) continue
      const cands = dfaFromCandidates(state, u.pos, t.pos!)
      for (const from of cands) {
        const facing = directionTo(from, t.pos!)!
        const a: MoveAction = {
          type: 'move', decisionId: state.pending?.id ?? '', player: u.owner, unitId: u.id, mode: 'jump', steps: [], jumpTo: t.pos!, facing,
          attack: cands.length > 1 ? { kind: 'dfa', targetId: t.id, dfaFrom: from } : { kind: 'dfa', targetId: t.id },
        }
        const p = planMove(state, a)
        if (isFail(p)) continue
        const base = entryFrom(state, u, 'jump', p, { jumpTo: t.pos! })
        out.push({ ...base, hex: t.pos!, physical: { kind: 'dfa', targetId: t.id, fromHex: from }, action: a })
      }
    }
  }
  return out
}
function hexesInRange(state: GameState, c: Hex, n: number): Hex[] {
  const out: Hex[] = []
  for (let dq = -n; dq <= n; dq++) {
    for (let dr = Math.max(-n, -dq - n); dr <= Math.min(n, -dq + n); dr++) {
      const h = { q: c.q + dq, r: c.r + dr }
      if (onBoard(state.board, h)) out.push(h)
    }
  }
  return out
}

// ---------- execution ----------
export type MoveNext = 'move' | 'standUp' | 'done'
export interface MoveOutcome extends Stepped { next: MoveNext }

function setRecord(s: GameState, id: UnitId, patch: Partial<UnitState['move']>): GameState {
  const u = s.units[id]!
  return patchUnit(s, id, { move: { ...u.move, ...patch } })
}

/** Can the prone unit try to stand now (MOVE-042..044, MOVE-014)? */
export function standCheck(state: GameState, u: UnitState, mode: 'walk' | 'run' | null): { ok: boolean; code?: RejectionCode; why?: string; forcedRun?: boolean } {
  if (!u.prone) return { ok: false, code: 'E_PRONE', why: 'the unit is standing' }
  const out = legsDestroyed(u)
  const armsOut = (u.locs.LA.destroyed ? 1 : 0) + (u.locs.RA.destroyed ? 1 : 0)
  if (out >= 2 || (out === 1 && armsOut === 2) || gyroDestroyed(u) || u.locs.CT.destroyed) return { ok: false, code: 'E_CANNOT_STAND', why: 'the unit cannot stand' }
  if (out === 1 && u.move.standAttempts >= 1) return { ok: false, code: 'E_CANNOT_STAND', why: 'one attempt per turn with a missing leg' }
  const m = currentMp(state, u.id)
  const eff = u.move.mode ?? mode
  if (eff !== 'walk' && eff !== 'run') return { ok: false, code: 'E_BAD_MODE', why: 'choose walk or run' }
  const total = eff === 'walk' ? m.walk : m.run
  const left = total - u.move.mpSpent
  if (left >= 2) return { ok: true, forcedRun: out === 1 && eff === 'walk' }
  if (left >= 1 && u.move.mpSpent === 0) return { ok: true, forcedRun: true }
  return { ok: false, code: 'E_NOT_ENOUGH_MP', why: 'not enough MP to stand' }
}
/** Gyro destroyed: two gyro crits (CRIT 2026: second crit destroys it). */
const gyroDestroyed = (u: UnitState): boolean => hitSlots(u, 'gyro') >= 2

function firstAction(state: GameState, u: UnitState, mode: MoveMode, startMp: number): { state: GameState; events: GameEvent[] } {
  if (u.move.mode !== null) return { state, events: [] }
  const s = setRecord(state, u.id, { mode, startHex: u.pos, startFacing: u.facing, entered: u.status === 'offBoard' })
  return { state: s, events: [{ type: 'MoveStarted', unitId: u.id, mode, hex: u.pos, facing: u.facing, mp: startMp }] }
}

/** Finishes a unit's move: end-of-move PSRs, MoveEnded, movement heat (00 §9.3). */
export function endMove(state: GameState, unitId: UnitId, hexesJumped = 0): Stepped {
  let s = state
  const events: GameEvent[] = []
  const u0 = s.units[unitId]!
  const m = u0.move
  const eff: MoveMode = m.mode ?? 'standStill'
  const mode: MoveMode = m.mpSpent === 0 && m.standAttempts === 0 ? 'standStill' : eff
  const tmm = mode === 'standStill' ? 0 : tmmForHexes(m.hexesMoved) + (m.jumped ? 1 : 0)
  s = setRecord(s, unitId, { mode, tmm, attackerMod: attackerMoveMod(mode), done: true })
  events.push({ type: 'MoveEnded', unitId, mode, hexesMoved: m.hexesMoved, jumped: m.jumped, mpSpent: m.mpSpent, tmm, attackerMod: attackerMoveMod(mode) })
  const moved = m.mpSpent > 2 * m.standAttempts
  const amount = mode === 'walk' || mode === 'run' ? (moved ? movementHeat(mode, 0) : 0) : mode === 'jump' ? movementHeat('jump', hexesJumped || m.hexesMoved) : 0
  const h = addHeat(s, unitId, { source: 'movement', amount, ref: mode })
  s = h.state
  events.push(...h.events)
  return { state: s, events }
}

function standPossibleAfterFall(state: GameState, id: UnitId): boolean {
  const u = state.units[id]!
  if (!u.prone || u.status === 'destroyed' || u.move.jumped) return false
  return standCheck(state, u, null).ok
}

/** Executes a validated MoveAction. */
export function executeMove(state: GameState, action: MoveAction): MoveOutcome | { rejection: Rejection } {
  const rejection = validateMove(state, action)
  if (rejection) return { rejection }
  const plan = planMove(state, action) as MovePlan
  const id = action.unitId
  const events: GameEvent[] = []
  const u0 = state.units[id]!
  const mpAll = currentMp(state, id)
  const cap = action.mode === 'jump' ? mpAll.jump : action.mode === 'run' ? mpAll.run : action.mode === 'walk' ? mpAll.walk : 0
  let s = state
  const fa = firstAction(s, u0, action.mode, cap)
  s = fa.state
  events.push(...fa.events)
  const startMpSpent = u0.move.mpSpent
  let spent = startMpSpent
  let truncated = false
  const sim = plan.sim
  let hexesMoved = u0.move.hexesMoved

  // walk the plan
  if (plan.mode === 'standStill') {
    // nothing
  } else {
    let counted = u0.move.hexesMoved
    let lastDir: 'f' | 'b' | null = null
    for (let i = 0; i < plan.steps.length; i++) {
      const st = plan.steps[i]!
      const cur = s.units[id]!
      spent += st.cost.total
      if (st.op === 'jump') {
        s = patchUnit(s, id, { pos: st.to, facing: st.facing })
        events.push({ type: 'UnitJumped', unitId: id, from: st.from, to: st.to, path: [st.to], facing: st.facing, cost: st.cost.total })
        s = setRecord(s, id, { jumped: true })
        counted = distance(st.from, st.to)
      } else if (st.op === 'forward' || st.op === 'backward') {
        const dir = st.op === 'forward' ? 'f' : 'b'
        counted = (lastDir && lastDir !== dir ? 0 : counted) + 1
        lastDir = dir
        const entering = cur.pos === null
        if (entering) {
          const homeEdge = s.sides[cur.owner].homeEdge
          s = patchUnit(s, id, { pos: st.to, facing: st.facing, status: 'active' })
          events.push({ type: 'UnitEntered', unitId: id, hex: st.to, facing: st.facing, edge: homeEdge })
        } else s = patchUnit(s, id, { pos: st.to, facing: st.facing })
        events.push({ type: 'UnitStepped', unitId: id, op: st.op, from: st.from, to: st.to, facing: st.facing, cost: st.cost.total, mpLeft: st.mpLeft })
      } else if (st.op === 'exit') {
        events.push({ type: 'UnitStepped', unitId: id, op: 'exit', from: st.from, to: st.to, facing: st.facing, cost: st.cost.total, mpLeft: st.mpLeft })
        events.push({ type: 'UnitExited', unitId: id, edge: s.sides[cur.owner].homeEdge, status: 'withdrawn' })
        s = patchUnit(s, id, { status: 'withdrawn', pos: null })
      } else {
        s = patchUnit(s, id, { facing: st.facing, prone: st.prone })
        events.push({ type: 'UnitStepped', unitId: id, op: st.op, from: st.from, to: st.to, facing: st.facing, cost: st.cost.total, mpLeft: st.mpLeft })
      }
      // hex-entry PSRs resolve at once (PSR-030)
      if (st.psrs.length > 0) {
        for (const t of st.psrs) {
          const q = queuePsr(s, { unitId: id, reason: t.reason, mod: t.mod, auto: false, when: 'now', ...(t.levels !== undefined ? { levels: t.levels } : {}) })
          s = q.state
          events.push(...q.events)
        }
        const r = resolvePsrs(s, { when: ['now'], unitIds: [id] })
        s = r.state
        events.push(...r.events)
        if (s.units[id]!.prone && st.op !== 'dropProne') {
          truncated = true
          events.push({ type: 'MoveTruncated', unitId: id, at: st.to, stepsDiscarded: plan.steps.length - i - 1 })
          break
        }
      }
    }
    hexesMoved = plan.mode === 'jump' ? plan.hexesMoved : counted
    s = setRecord(s, id, { mode: plan.mode, mpSpent: spent, hexesMoved, ranHexes: s.units[id]!.move.ranHexes + sim.ran })
  }

  if (truncated) {
    return { state: s, events, next: standPossibleAfterFall(s, id) ? 'standUp' : finishNow() }
  }
  // end-of-move PSRs (PSR-031)
  for (const t of plan.end) {
    const q = queuePsr(s, { unitId: id, reason: t.reason, mod: t.mod, auto: false, when: 'endOfMove' })
    s = q.state
    events.push(...q.events)
  }
  if (plan.end.length > 0) {
    const r = resolvePsrs(s, { when: ['endOfMove'], unitIds: [id] })
    s = r.state
    events.push(...r.events)
  }
  const wasWithdrawn = s.units[id]!.status === 'withdrawn'
  if (!wasWithdrawn) {
    const e = endMove(s, id, plan.mode === 'jump' ? hexesMoved : 0)
    s = e.state
    events.push(...e.events)
    // a charge or DFA declared with the move (00 §9.3); a fall at the end of the move drops it
    const atk = action.attack
    const mover = s.units[id]!
    if (atk && !mover.prone && mover.pos && mover.status !== 'destroyed') {
      const fromHex = mover.pos
      const rec = { targetId: atk.targetId, fromHex }
      s = patchUnit(s, id, { attacks: { ...mover.attacks, ...(atk.kind === 'charge' ? { charge: rec } : { dfa: rec }) } })
      events.push({ type: 'PhysicalDeclaredInMove', unitId: id, kind: atk.kind, targetId: atk.targetId, fromHex })
    }
  } else {
    s = setRecord(s, id, { done: true })
  }
  return { state: s, events, next: 'done' }

  function finishNow(): MoveNext {
    const e = endMove(s, id)
    s = e.state
    events.push(...e.events)
    return 'done'
  }
}

/** Validates a StandUpAction (MOVE-040..044). */
export function validateStandUp(state: GameState, action: StandUpAction): Rejection | null {
  const u = state.units[action.unitId]
  if (!u) return { code: 'E_UNKNOWN_UNIT', message: 'unknown unit' }
  if (u.owner !== action.player) return { code: 'E_NOT_YOUR_UNIT', message: 'not your unit' }
  if (u.shutdown) return { code: 'E_SHUTDOWN', message: 'the unit is shut down' }
  if (!u.pilot.conscious || u.pilot.dead) return { code: 'E_UNCONSCIOUS', message: 'the pilot is unconscious' }
  if (!u.prone) return { code: 'E_PRONE', message: 'the unit is not prone' }
  if (u.move.done) return { code: 'E_NOT_ELIGIBLE', message: 'the unit already moved' }
  if (action.mode !== undefined && action.mode !== 'walk' && action.mode !== 'run') return { code: 'E_BAD_MODE', message: 'a prone unit may walk or run' }
  if (action.facing !== undefined && !(FACINGS as readonly number[]).includes(action.facing)) return { code: 'E_BAD_FACING', message: 'facing must be 0 to 5' }
  if (u.move.mode !== null && action.mode !== undefined && action.mode !== u.move.mode && !(u.move.mode === 'walk' && action.mode === 'run')) {
    return { code: 'E_BAD_MODE', message: `mode is locked to ${u.move.mode}` }
  }
  if (!action.attempt) return null
  if (action.mode === undefined && u.move.mode === null) return { code: 'E_BAD_MODE', message: 'choose walk or run for the stand attempt' }
  const c = standCheck(state, u, (action.mode ?? null) as 'walk' | 'run' | null)
  return c.ok ? null : { code: c.code ?? 'E_CANNOT_STAND', message: c.why ?? 'cannot stand' }
}

/** Executes a stand-up decision: an attempt (2 MP, PSR -1) or staying prone. */
export function executeStandUp(state: GameState, action: StandUpAction): MoveOutcome | { rejection: Rejection } {
  const rejection = validateStandUp(state, action)
  if (rejection) return { rejection }
  const id = action.unitId
  const events: GameEvent[] = []
  let s = state
  const u0 = s.units[id]!
  const mp0 = currentMp(s, id)
  if (!action.attempt) {
    if (action.mode === undefined) {
      // stays prone and does nothing else: stand still
      const e = endMove(firstAction(s, u0, 'standStill', 0).state, id)
      return { state: e.state, events: e.events, next: 'done' }
    }
    const total = action.mode === 'walk' ? mp0.walk : mp0.run
    const fa = firstAction(s, u0, action.mode, total)
    s = fa.state
    events.push(...fa.events)
    const left = (s.units[id]!.move.mode === 'run' ? mp0.run : total) - s.units[id]!.move.mpSpent
    if (left <= 0) {
      const e = endMove(s, id)
      return { state: e.state, events: [...events, ...e.events], next: 'done' }
    }
    return { state: s, events, next: 'move' }
  }
  const chk = standCheck(s, u0, (action.mode ?? null) as 'walk' | 'run' | null)
  const mode: MoveMode = chk.forcedRun ? 'run' : (u0.move.mode ?? action.mode!)
  const total = mode === 'walk' ? mp0.walk : mp0.run
  const fa = firstAction(s, u0, mode, total)
  s = fa.state
  events.push(...fa.events)
  const minMove = total - s.units[id]!.move.mpSpent < 2
  const cost = minMove ? 1 : 2
  const mpSpent = s.units[id]!.move.mpSpent + cost
  s = setRecord(s, id, { mode, mpSpent, standAttempts: s.units[id]!.move.standAttempts + 1 })
  const q = queuePsr(s, { unitId: id, reason: 'stand', mod: -1, auto: false, when: 'now' })
  s = q.state
  events.push(...q.events)
  const r = resolvePsrs(s, { when: ['now'], unitIds: [id] })
  s = r.state
  const resolved = r.events.find((e) => e.type === 'PsrResolved' && e.psrId === q.entry.id)
  const success = resolved?.type === 'PsrResolved' ? resolved.success : false
  const mpLeft = Math.max(0, total - mpSpent)
  const facing = success ? (action.facing ?? u0.facing) : s.units[id]!.facing
  if (success) s = patchUnit(s, id, { prone: false, facing })
  events.push(...r.events)
  events.push({ type: 'StandAttempted', unitId: id, success, facing, mpLeft })
  if (success) {
    if (mpLeft > 0) return { state: s, events, next: 'move' }
    const e = endMove(s, id)
    return { state: e.state, events: [...events, ...e.events], next: 'done' }
  }
  if (s.units[id]!.status === 'destroyed') return { state: setRecord(s, id, { done: true }), events, next: 'done' }
  if (standCheck(s, s.units[id]!, null).ok) return { state: s, events, next: 'standUp' }
  const e = endMove(s, id)
  return { state: e.state, events: [...events, ...e.events], next: 'done' }
}

/** Convenience for tests and the UI: the PSR a stand attempt would make. */
export function standPsrOdds(state: GameState, unitId: UnitId): { tn: number; p: number } {
  const u = state.units[unitId]!
  const tn = u.pilot.piloting + persistentMods(u).reduce((a, m) => a + m.value, 0) - 1
  return { tn, p: pAtLeast2d6(tn) }
}

export { directionTo }
