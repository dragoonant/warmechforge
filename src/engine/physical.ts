// Physical attack rules (10 §16, PHYS-001..097): legality, target numbers, damage numbers, attack direction, and the
// Displacement Step with dominoes. Pure: state in, { state, events } out. Rolls only through rng.roll().
import type { PhysicalChoice } from './actions'
import type { GameEvent } from './events'
import type { PhysicalPreview, PhysicalPreviewRequest, UnitAt } from './index'
import {
  attackDirection, directionTo, distance, firingArc, hexEq, neighbor, onBoard, opposite, torsoFacing,
} from './hex'
import { HIT_TABLE, columnFor, isTorso } from './hitloc'
import { pAtLeast2d6 } from './prob'
import { persistentMods, queuePsr, resolvePsrs, psrTarget, fall } from './psr'
import { patchUnit } from './pilot'
import { roll } from './rng'
import { attackerMoveMod, tmmForHexes } from './tohit'
import { floorLevel, hexAt, isSubmerged } from './terrain'
import { beginWork, endWork } from './dice'
import { destroyUnitW } from './damage'
import type {
  ArmLoc, AttackDirection, DataBundle, Displacement, Facing, GameState, Hex, HitTable, LegLoc, Loc, Mod, PhysicalKind,
  RejectionCode, UnitId, UnitState,
} from './types'

export interface Stepped { state: GameState; events: GameEvent[] }

// ---------- positions ----------
/** Where a unit counts as standing for attacks: a DFA jumper waits in its last path hex (PHYS-061). */
export function effectivePos(u: UnitState): Hex | null {
  if (u.attacks.dfa) return u.attacks.dfa.fromHex
  if (u.attacks.charge) return u.attacks.charge.fromHex
  return u.pos
}
export const floorAt = (state: GameState, h: Hex): number => {
  const bh = hexAt(state.board, h)
  return bh ? floorLevel(bh) : 0
}
const woodsAt = (state: GameState, h: Hex): 'none' | 'light' | 'heavy' => hexAt(state.board, h)?.woods ?? 'none'
const isAlive = (u: UnitState): boolean => (u.status === 'active' || u.status === 'withdrawing') && u.doomed === null && u.pos !== null

// ---------- attack direction (ARC-020/021) ----------
const ZONE_ORDER: AttackDirection[] = ['front', 'left', 'right', 'rear']
/** ARC-021 default for corner hits: the zone whose roll-7 location keeps the most armor; ties Front > Left > Right > Rear. */
function defaultZone(target: UnitState, zones: [AttackDirection, AttackDirection]): AttackDirection {
  const score = (z: AttackDirection): number => {
    const loc = HIT_TABLE[columnFor(z)]![7]!
    const l = target.locs[loc]
    return z === 'rear' && isTorso(loc) ? (l.rear ?? 0) : l.armor
  }
  const [a, b] = zones
  const sa = score(a), sb = score(b)
  if (sa !== sb) return sa > sb ? a : b
  return ZONE_ORDER.indexOf(a) < ZONE_ORDER.indexOf(b) ? a : b
}
/** Hit-table column source for an attack from `from` against `targetId`; corner ties are stored per (attacker, target) per turn. */
export function directionFor(state: GameState, attackerId: UnitId, targetId: UnitId, from: Hex): { direction: AttackDirection; state: GameState } {
  const t = state.units[targetId]!
  const r = attackDirection(t.pos!, t.facing, from)
  if (typeof r === 'string') return { direction: r, state }
  const key = `${attackerId}>${targetId}`
  const kept = state.choices.direction[key]
  if (kept) return { direction: kept, state }
  const direction = defaultZone(t, r.tie)
  return { direction, state: { ...state, choices: { ...state.choices, direction: { ...state.choices.direction, [key]: direction } } } }
}

// ---------- actuators (counted from earlier phases only: INIT-012) ----------
const priorHit = (state: GameState, u: UnitState, loc: Loc, token: string): boolean =>
  u.slots[loc].some((s) => s.hit && s.token === token && s.hitPhase !== state.phaseSeq)
/** Critted in an earlier phase, or never built with it (PHYS-032/033). */
const badPart = (state: GameState, u: UnitState, loc: Loc, token: string): boolean =>
  priorHit(state, u, loc, token) || !u.slots[loc].some((s) => s.token === token)
const halve = (n: number): number => Math.max(1, Math.floor(n / 2))

export function punchDamage(state: GameState, u: UnitState, arm: ArmLoc): number {
  let d = Math.ceil(u.tonnage / 10)
  for (const t of ['upperArm', 'lowerArm']) if (badPart(state, u, arm, t)) d = halve(d)
  return d
}
export function kickDamage(state: GameState, u: UnitState, leg: LegLoc): number {
  let d = Math.ceil(u.tonnage / 5)
  for (const t of ['upperLeg', 'lowerLeg']) if (priorHit(state, u, leg, t)) d = halve(d)
  return d
}
/** PHYS-043: L = N up to 2, else the lowest hex count of the TOHIT-014 bracket holding N (N = hexes moved + 1). */
export function chargeLength(hexesMoved: number): number {
  const n = hexesMoved + 1
  if (n <= 2) return n
  if (n <= 4) return 3
  if (n <= 6) return 5
  if (n <= 9) return 7
  if (n <= 17) return 10
  if (n <= 24) return 18
  return 25
}
export const chargeDamage = (tonnage: number, hexesMoved: number): number => Math.ceil((tonnage * chargeLength(hexesMoved)) / 10)
export const chargeSelfDamage = (targetTonnage: number): number => Math.ceil(targetTonnage / 10)
export const dfaDamage = (tonnage: number): number => Math.ceil((tonnage * 3) / 10)
export const dfaSelfDamage = (tonnage: number): number => Math.ceil(tonnage / 5)

const armFired = (u: UnitState, arm: ArmLoc): boolean =>
  u.attacks.firedMounts.some((id) => { const m = u.mounts[id]; return !!m && (m.location === arm || m.split === arm) })
const legFired = (u: UnitState, leg: LegLoc): boolean =>
  u.attacks.firedMounts.some((id) => { const m = u.mounts[id]; return !!m && m.location === leg })

// ---------- the preview / legality / numbers ----------
const base = (kind: PhysicalKind, limb: ArmLoc | LegLoc | null): PhysicalPreview => ({
  legal: false, kind, limb, tn: 0, mods: [], pHit: 0, damage: 0, table: 'punch', selfDamage: 0, attackerPsr: null, targetPsr: null,
  displacement: null, choice: null,
})
const psrOdds = (state: GameState, u: UnitState, mod: number): { tn: number; p: number } => {
  const tn = u.pilot.piloting + persistentMods(u).reduce((a, m) => a + m.value, 0) + mod
  void state
  return { tn, p: pAtLeast2d6(tn) }
}

interface Ctx { a: UnitState; t: UnitState; aPos: Hex; tPos: Hex; facing: Facing; twist: number }
function ctxFor(state: GameState, req: PhysicalPreviewRequest): Ctx | null {
  const a = state.units[req.attackerId], t = state.units[req.targetId]
  if (!a || !t) return null
  const aPos = req.attackerAt?.hex ?? effectivePos(a)
  const tPos = req.targetAt?.hex ?? t.pos
  if (!aPos || !tPos) return null
  return { a, t, aPos, tPos, facing: req.attackerAt?.facing ?? a.facing, twist: req.attackerAt?.twist ?? a.attacks.twist }
}

/**
 * Legality, target number and damage numbers for one physical attack (query.physicalPreview, PHYS-001..073).
 * `committed`: the attack was declared in Movement (charge/DFA); skips the once-per-turn and TN-13 refusals.
 */
export function physicalPreview(state: GameState, req: PhysicalPreviewRequest, opts: { committed?: boolean } = {}): PhysicalPreview {
  const kind = req.kind
  const out = base(kind, req.limb ?? null)
  const no = (reason: RejectionCode, why: string, extra: Partial<PhysicalPreview> = {}): PhysicalPreview => ({ ...out, ...extra, legal: false, reason, why })
  const c = ctxFor(state, req)
  if (!c) return no('E_UNKNOWN_UNIT', 'unknown unit or position')
  const { a, t, aPos, tPos } = c
  const A: UnitAt = req.attackerAt ?? {}
  const T: UnitAt = req.targetAt ?? {}

  // attacker
  if (!isAlive(a) && !(A.hex && (a.status === 'active' || a.status === 'withdrawing'))) return no('E_NOT_ELIGIBLE', 'attacker is not on the board')
  if (a.shutdown) return no('E_SHUTDOWN', 'a shut-down unit makes no physical attack')
  if (!a.pilot.conscious || a.pilot.dead) return no('E_UNCONSCIOUS', 'an unconscious pilot makes no physical attack')
  if (A.prone ?? a.prone) return no('E_NO_PHYSICAL', 'a prone unit makes no physical attack')
  if (!opts.committed) {
    if (a.attacks.physicalDeclared) return no('E_NO_PHYSICAL', 'already declared this phase')
    const ch = a.attacks.charge, df = a.attacks.dfa
    if ((ch || df) && !((kind === 'charge' && ch?.targetId === t.id) || (kind === 'dfa' && df?.targetId === t.id))) {
      return no('E_ATTACK_LIMIT', 'this unit already declared a charge or DFA')
    }
  }
  // target
  if (t.owner === a.owner) return no('E_FRIENDLY_TARGET', 'cannot attack a friendly unit')
  if (!isAlive(t) && !(T.hex && (t.status === 'active' || t.status === 'withdrawing'))) return no('E_BAD_TARGET', 'target is not on the board')
  if ((t.attacks.charge || t.attacks.dfa) && !opts.committed) return no('E_BAD_TARGET', 'a unit making a charge or DFA cannot be attacked')
  if (distance(aPos, tPos) !== 1) return no('E_NOT_ADJACENT', 'target is not adjacent')

  // levels (PHYS-020..026)
  const tProne = T.prone ?? t.prone
  const lvl = floorAt(state, tPos) - floorAt(state, aPos)
  let table: HitTable = 'punch'
  const levelOk = (): boolean => {
    if (kind === 'dfa') { table = tProne ? 'standard' : 'punch'; return true }
    if (Math.abs(lvl) >= 2) return false
    if (tProne) {
      if (kind === 'kick' && lvl === 0) { table = 'standard'; return true }
      if (kind === 'punch' && lvl === 1) { table = 'standard'; return true }
      return false
    }
    switch (kind) {
      case 'punch': if (lvl === 0) { table = 'punch'; return true } if (lvl === 1) { table = 'kick'; return true } return false
      case 'kick': if (lvl === 0) { table = 'kick'; return true } if (lvl === -1) { table = 'punch'; return true } return false
      case 'charge': table = 'standard'; return true
      case 'push': return lvl === 0
    }
    return false
  }
  if (kind === 'charge' && tProne) return no('E_BAD_TARGET', 'cannot charge a prone unit')
  if (!levelOk()) return no('E_LEVEL_DIFF', 'level difference does not allow this attack')

  // water (LOS-040/041)
  const bhA = hexAt(state.board, aPos), bhT = hexAt(state.board, tPos)
  const subA = !!bhA && isSubmerged(bhA, A.prone ?? a.prone), subT = !!bhT && isSubmerged(bhT, tProne)
  if (subA !== subT) return no('E_WATER_LINE', 'a submerged unit and a unit on land cannot attack each other')
  const halved = subA && subT

  // arcs and limbs
  let damage = 0
  let selfDamage = 0
  const extra: Mod[] = []
  const torso = torsoFacing(c.facing, c.twist)
  switch (kind) {
    case 'punch': {
      const arm = req.limb
      if (arm !== 'LA' && arm !== 'RA') return no('E_LIMB_UNAVAILABLE', 'punch needs an arm')
      if (a.locs[arm].destroyed) return no('E_LIMB_UNAVAILABLE', 'that arm is gone')
      if (priorHit(state, a, arm, 'shoulder')) return no('E_LIMB_UNAVAILABLE', 'shoulder damaged')
      if (armFired(a, arm)) return no('E_LIMB_UNAVAILABLE', 'that arm fired a weapon this turn')
      const arc = firingArc(aPos, torso, tPos)
      if (!(arc === 'forward' || arc === (arm === 'LA' ? 'left' : 'right'))) return no('E_OUT_OF_ARC', 'target is outside the punch arc')
      damage = punchDamage(state, a, arm)
      if (badPart(state, a, arm, 'hand')) extra.push({ code: 'hand', value: 1 })
      if (badPart(state, a, arm, 'upperArm')) extra.push({ code: 'upperArm', value: 2 })
      if (badPart(state, a, arm, 'lowerArm')) extra.push({ code: 'lowerArm', value: 2 })
      break
    }
    case 'kick': {
      const leg = req.limb
      if (leg !== 'LL' && leg !== 'RL') return no('E_LIMB_UNAVAILABLE', 'kick needs a leg')
      if (a.locs.LL.destroyed || a.locs.RL.destroyed) return no('E_LIMB_UNAVAILABLE', 'a leg is gone')
      if (priorHit(state, a, 'LL', 'hip') || priorHit(state, a, 'RL', 'hip')) return no('E_LIMB_UNAVAILABLE', 'a damaged hip forbids kicks')
      if (legFired(a, leg)) return no('E_LIMB_UNAVAILABLE', 'that leg fired a weapon this turn')
      if (firingArc(aPos, c.facing, tPos) !== 'forward') return no('E_OUT_OF_ARC', 'target is outside the forward arc of the feet')
      damage = kickDamage(state, a, leg)
      for (const tk of ['upperLeg', 'lowerLeg']) if (priorHit(state, a, leg, tk)) extra.push({ code: tk === 'upperLeg' ? 'upperLeg' : 'lowerLeg', value: 2, detail: leg })
      if (priorHit(state, a, leg, 'foot')) extra.push({ code: 'foot', value: 1, detail: leg })
      break
    }
    case 'push': {
      const ahead = neighbor(aPos, c.facing)
      if (!hexEq(ahead, tPos)) return no('E_OUT_OF_ARC', 'target must be directly ahead of the feet')
      if (armFired(a, 'LA') || armFired(a, 'RA')) return no('E_LIMB_UNAVAILABLE', 'an arm weapon fired this turn')
      if (a.locs.LA.destroyed && a.locs.RA.destroyed) return no('E_LIMB_UNAVAILABLE', 'a push needs an arm')
      for (const arm of ['LA', 'RA'] as const) if (priorHit(state, a, arm, 'shoulder')) extra.push({ code: 'shoulder', value: 2, detail: arm })
      break
    }
    case 'charge': {
      if (directionTo(aPos, tPos) !== c.facing) return no('E_OUT_OF_ARC', 'a charge must face its target')
      damage = chargeDamage(a.tonnage, A.hexesMoved ?? a.move.hexesMoved)
      selfDamage = chargeSelfDamage(t.tonnage)
      break
    }
    case 'dfa': {
      if (directionTo(aPos, tPos) !== c.facing) return no('E_OUT_OF_ARC', 'a DFA must face its target')
      damage = dfaDamage(a.tonnage)
      selfDamage = dfaSelfDamage(a.tonnage)
      break
    }
  }
  if (halved) { damage = Math.floor(damage / 2); selfDamage = Math.floor(selfDamage / 2) }

  // target number (PHYS-001): never heat, sensors, secondary target or attacker-prone
  const mods: Mod[] = [{ code: 'piloting', value: a.pilot.piloting }]
  const add = (m: Mod): void => { if (m.value !== 0) mods.push(m) }
  add({ code: 'physicalBase', value: kind === 'punch' || kind === 'kick' || kind === 'push' ? -1 : 0, detail: kind })
  const mode = A.mode ?? (kind === 'dfa' ? 'jump' : a.move.mode)
  add({ code: 'attackerMove', value: attackerMoveMod(mode), detail: mode ?? 'standStill' })
  const immobile = T.immobile ?? state.ledger.immobileAtStart.includes(t.id)
  if (kind === 'charge' || kind === 'dfa') {
    add({ code: 'comparative', value: a.pilot.piloting - (immobile ? 4 : t.pilot.piloting) })
  }
  if (immobile) add({ code: 'targetImmobile', value: -4 })
  else {
    const jumped = T.jumped ?? t.move.jumped
    const tmm = T.tmm ?? (T.hexesMoved !== undefined ? tmmForHexes(T.hexesMoved) : t.move.tmm - (t.move.jumped ? 1 : 0))
    add({ code: 'tmm', value: tmm })
    if (jumped) add({ code: 'targetJumped', value: 1 })
  }
  if (tProne) add({ code: 'targetProne', value: -2 })
  if (kind !== 'dfa') {
    const w = woodsAt(state, tPos)
    add({ code: 'woodsTarget', value: w === 'light' ? 1 : w === 'heavy' ? 2 : 0 })
  }
  for (const m of extra) add(m)
  const tn = mods.reduce((s, m) => s + m.value, 0)

  const dirTravel = directionTo(aPos, tPos)
  const res: PhysicalPreview = {
    ...out, kind, limb: req.limb ?? null, tn, mods, pHit: tn >= 13 ? 0 : pAtLeast2d6(tn), damage: kind === 'push' ? 0 : damage, table, selfDamage,
    attackerPsr: null, targetPsr: null, displacement: null, choice: null, legal: true,
  }
  const ao = (mod: number) => psrOdds(state, a, mod), to = (mod: number) => psrOdds(state, t, mod)
  if (kind === 'kick') {
    res.targetPsr = { reason: 'kicked', ...to(0) }
    res.attackerPsr = { reason: 'missedKick', ...ao(0), onHit: false }
  } else if (kind === 'push') {
    res.targetPsr = { reason: 'pushed', ...to(0) }
  } else if (kind === 'charge') {
    res.targetPsr = { reason: 'charged', ...to(2) }
    res.attackerPsr = { reason: 'chargeMade', ...ao(2), onHit: true }
  } else if (kind === 'dfa') {
    res.targetPsr = { reason: 'dfaTarget', ...to(2) }
    res.attackerPsr = { reason: 'dfaMade', ...ao(2), onHit: true }
  }
  if ((kind === 'charge' || kind === 'dfa' || kind === 'push') && dirTravel !== null) res.displacement = neighbor(tPos, dirTravel)
  if (kind === 'punch') res.choice = { kind: 'punch', arms: [{ arm: req.limb as ArmLoc, targetId: t.id }] }
  else if (kind === 'kick') res.choice = { kind: 'kick', leg: req.limb as LegLoc, targetId: t.id }
  else if (kind === 'push') res.choice = { kind: 'push', targetId: t.id }
  if (tn >= 13 && !opts.committed) return { ...res, legal: false, reason: 'E_TN_TOO_HIGH', why: 'target number is above 12' }
  return res
}

/** Every punch / kick / push option of attacker vs target, legal or not (query.physicalOptions). */
export function physicalOptions(state: GameState, attackerId: UnitId, targetId: UnitId): PhysicalPreview[] {
  const mk = (kind: PhysicalKind, limb?: ArmLoc | LegLoc): PhysicalPreview =>
    physicalPreview(state, { attackerId, targetId, kind, ...(limb ? { limb } : {}) })
  return [mk('punch', 'LA'), mk('punch', 'RA'), mk('kick', 'LL'), mk('kick', 'RL'), mk('push')]
}

/** Units this unit could physically attack at all (for the declarePhysical context). */
export function physicalTargets(state: GameState, attackerId: UnitId): UnitId[] {
  const out: UnitId[] = []
  for (const id of state.unitOrder) {
    if (id === attackerId) continue
    if (physicalOptions(state, attackerId, id).some((p) => p.legal)) out.push(id)
  }
  return out
}

/** Legal declarePhysical answers: none first, then each legal option (punch arms combine per target). */
export function legalPhysicalChoices(state: GameState, attackerId: UnitId): PhysicalChoice[] {
  const out: PhysicalChoice[] = [{ kind: 'none' }]
  for (const tid of physicalTargets(state, attackerId)) {
    const opts = physicalOptions(state, attackerId, tid).filter((p) => p.legal)
    const arms = opts.filter((p) => p.kind === 'punch').map((p) => ({ arm: p.limb as ArmLoc, targetId: tid }))
    for (const p of opts) if (p.kind === 'punch' || p.kind === 'kick' || p.kind === 'push') out.push(p.choice!)
    if (arms.length === 2) out.push({ kind: 'punch', arms })
  }
  return out
}

// ---------- the Displacement Step (PHYS-090..094) ----------
const occupantAt = (s: GameState, hex: Hex, except: UnitId): UnitState | null => {
  for (const id of s.unitOrder) {
    if (id === except) continue
    const u = s.units[id]!
    if (u.pos && (u.status === 'active' || u.status === 'withdrawing') && hexEq(u.pos, hex)) return u
  }
  return null
}

class Ctl {
  s: GameState
  ev: GameEvent[] = []
  constructor(s: GameState, readonly data: DataBundle) { this.s = s }
  apply(r: Stepped): void { this.s = r.state; this.ev.push(...r.events) }
  patch(id: UnitId, p: Partial<UnitState>): void { this.s = patchUnit(this.s, id, p) }
  destroy(id: UnitId, cause: 'displacedOff' | 'noLegalHex'): void {
    const w = beginWork({ ...this.s, damageWindow: 'immediate' }, this.data)
    destroyUnitW(w, id, cause)
    const r = endWork(w)
    this.s = r.state
    this.ev.push(...r.events)
  }
}

type Cause = Displacement['cause']
const psrReasonFor = (cause: Cause): 'charged' | 'dfaTarget' | 'pushed' | 'domino' =>
  cause === 'charge' ? 'charged' : cause === 'push' ? 'pushed' : cause === 'domino' ? 'domino' : 'dfaTarget'

/** Directions tried for a displacement: only the intended one, except DFA (PHYS-067): ±1, ±2, opposite. */
function tryOrder(dir: Facing, cause: Cause): Facing[] {
  if (cause !== 'dfa' && cause !== 'dfaMiss') return [dir]
  const r = (k: number): Facing => (((dir + k) % 6) + 6) % 6 as Facing
  return [dir, r(1), r(-1), r(2), r(-2), r(3)]
}

/**
 * Moves `id` one hex (directly away, `dir`) and returns true if it left its hex. Handles level limits, off-board, falls from
 * 2+ levels and dominoes. Prohibited destination: nobody moves (false). `forced`: no legal hex destroys the unit.
 */
function displaceUnit(c: Ctl, id: UnitId, dir: Facing, cause: Cause, forced: boolean): boolean {
  const u = c.s.units[id]!
  const from = u.pos!
  const options = tryOrder(dir, cause)
  let chosen: { to: Hex; d: Facing; delta: number; occupied: boolean } | null = null
  let offBoardOnly = false
  for (const group of cause === 'dfa' || cause === 'dfaMiss' ? [[0], [1, 2], [3, 4], [5]] : [[0]]) {
    const cand: { to: Hex; d: Facing; delta: number; occupied: boolean }[] = []
    for (const k of group) {
      const d = options[k]!
      const to = neighbor(from, d)
      if (!onBoard(c.s.board, to)) { if (k === 0) offBoardOnly = true; continue }
      const delta = floorAt(c.s, to) - floorAt(c.s, from)
      if (delta >= 3) continue
      cand.push({ to, d, delta, occupied: !!occupantAt(c.s, to, id) })
    }
    if (cand.length) { chosen = cand.find((x) => !x.occupied) ?? cand[0]!; break }
  }
  if (!chosen) {
    if (cause === 'dfaMiss') return false
    if (offBoardOnly && cause !== 'dfa') { c.destroy(id, 'displacedOff'); return true }
    if (forced || cause === 'dfa') { c.destroy(id, 'noLegalHex'); return true }
    return false
  }
  const occ = occupantAt(c.s, chosen.to, id)
  if (occ) domino(c, occ.id, chosen.d)
  const still = occupantAt(c.s, chosen.to, id)
  if (still) return false // the occupant could not be moved away (it was destroyed or stayed): keep the hex closed
  c.ev.push({ type: 'UnitDisplaced', unitId: id, from, to: chosen.to, cause: cause === 'domino' ? 'domino' : cause })
  c.patch(id, { pos: chosen.to })
  if (chosen.delta <= -2) {
    const reason = psrReasonFor(cause)
    const q = queuePsr(c.s, { unitId: id, reason, mod: 0, auto: true, when: 'now', levels: -chosen.delta })
    c.apply(q)
    c.apply(resolvePsrs(c.s, { when: ['now'], unitIds: [id] }))
  }
  return true
}

/** PHYS-094: the occupant of a hex an intruder is entering from the `dir` side. */
function domino(c: Ctl, occId: UnitId, dir: Facing): void {
  const q = queuePsr(c.s, { unitId: occId, reason: 'domino', mod: 0, auto: false, when: 'now' })
  c.apply({ state: q.state, events: q.events })
  const entry = q.entry
  const occ = c.s.units[occId]!
  const { tn, mods } = psrTarget(c.s, entry)
  c.s = { ...c.s, psr: { ...c.s.psr, queue: c.s.psr.queue.filter((e) => e.id !== entry.id) } }
  let success: boolean
  let rolled: number | null = null
  let auto = false
  if (occ.shutdown || !occ.pilot.conscious || occ.pilot.dead || tn > 12) { success = false; auto = true }
  else {
    const r = roll(c.s, { count: 2, sides: 6, purpose: 'psr', unitId: occId, target: tn, reason: 'domino', mods })
    c.s = r.state; c.ev.push(r.event)
    success = r.event.success === true
    rolled = r.event.total
  }
  c.ev.push({ type: 'PsrResolved', psrId: entry.id, unitId: occId, reason: 'domino', tn, mods, roll: rolled, success, auto })
  if (!success) {
    const moved = displaceUnit(c, occId, dir, 'domino', true)
    if (moved && c.s.units[occId]!.status !== 'destroyed' && !c.s.units[occId]!.prone) c.apply(fall(c.s, occId, 0))
    return
  }
  // passed: dodge one hex forward or backward if standing, mobile and not jumped (PHYS-094), else displaced without falling
  const standing = !occ.prone && !occ.move.jumped
  if (standing) {
    for (const d of [occ.facing, opposite(occ.facing)] as Facing[]) {
      const to = neighbor(occ.pos!, d)
      if (!onBoard(c.s.board, to) || occupantAt(c.s, to, occId)) continue
      if (Math.abs(floorAt(c.s, to) - floorAt(c.s, occ.pos!)) > 1) continue
      c.ev.push({ type: 'UnitDisplaced', unitId: occId, from: occ.pos!, to, cause: 'dodge' })
      c.patch(occId, { pos: to })
      return
    }
  }
  displaceUnit(c, occId, dir, 'domino', true)
}

/**
 * Applies the phase's recorded displacements in order (PHYS-090): loser's attacks first. A unit destroyed by the attacks is not
 * displaced. Charge, DFA and push hits move the attacker into the vacated hex; a DFA miss moves the target away and drops the
 * attacker into its hex with a 2-level fall (PHYS-066).
 */
export function displacementStep(state: GameState, data: DataBundle): Stepped {
  const c = new Ctl({ ...state, step: 'physical.displace', damageWindow: 'immediate' }, data)
  const list = [...state.ledger.displacements].sort((a, b) => a.order - b.order)
  const gone = (id: UnitId): boolean => { const u = c.s.units[id]!; return u.status === 'destroyed' || u.doomed !== null || !u.pos }
  for (const e of list) {
    const target = c.s.units[e.unitId]!
    const att = e.byId ? c.s.units[e.byId] : null
    if (gone(e.unitId)) continue
    const from = target.pos!
    if (e.cause === 'dfaMiss') {
      if (!att || gone(att.id)) continue
      const moved = displaceUnit(c, e.unitId, e.dir, 'dfaMiss', false)
      if (!moved) { c.destroy(att.id, 'noLegalHex'); continue } // PHYS-067: no legal hex, a miss destroys the attacker
      c.patch(att.id, { pos: from })
      c.apply(queuePsr(c.s, { unitId: att.id, reason: 'dfaMissed', mod: 0, auto: true, when: 'now', levels: 2 }))
      c.apply(resolvePsrs(c.s, { when: ['now'], unitIds: [att.id] }))
      continue
    }
    const moved = displaceUnit(c, e.unitId, e.dir, e.cause, false)
    if (moved && att && !gone(att.id)) c.patch(att.id, { pos: from }) // the attacker enters the vacated hex (no MP)
  }
  return { state: { ...c.s, ledger: { ...c.s.ledger, displacements: [] } }, events: c.ev }
}

// ---------- damage numbers at resolution ----------
/**
 * Damage dealt and taken by a declared physical attack, read at resolution. Actuator damage from the same phase is ignored
 * (INIT-012: effects apply after the phase), a limb destroyed this phase still hits at full strength.
 */
export function damageFor(state: GameState, d: { kind: PhysicalKind; attackerId: UnitId; targetId: UnitId; limb: ArmLoc | LegLoc | null }): { damage: number; selfDamage: number } {
  const a = state.units[d.attackerId]!, t = state.units[d.targetId]!
  let damage = 0, selfDamage = 0
  switch (d.kind) {
    case 'punch': damage = punchDamage(state, a, d.limb as ArmLoc); break
    case 'kick': damage = kickDamage(state, a, d.limb as LegLoc); break
    case 'charge': damage = chargeDamage(a.tonnage, a.move.hexesMoved); selfDamage = chargeSelfDamage(t.tonnage); break
    case 'dfa': damage = dfaDamage(a.tonnage); selfDamage = dfaSelfDamage(a.tonnage); break
    case 'push': break
  }
  const ap = effectivePos(a), tp = t.pos
  const bhA = ap ? hexAt(state.board, ap) : null, bhT = tp ? hexAt(state.board, tp) : null
  if (bhA && bhT && isSubmerged(bhA, a.prone) && isSubmerged(bhT, t.prone)) { damage = Math.floor(damage / 2); selfDamage = Math.floor(selfDamage / 2) }
  return { damage, selfDamage }
}
