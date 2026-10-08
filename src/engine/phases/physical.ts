// Physical Attack Phase (10 §16, INIT-011, 00 §5, §9.3): selection, declarations (punch/kick/push, plus the charge/DFA
// declared in Movement), resolution in a simultaneous window, the Displacement Step, end-of-phase.
import type { DeclarePhysicalAction } from '../actions'
import type { GameEvent } from '../events'
import { beginWork, endWork, roll2d6 } from '../dice'
import { queuePsrW, resolveGroupW } from '../damage'
import { splitGroups } from '../cluster'
import { directionTo, distance, neighbor } from '../hex'
import { beginPhase, finishPhase, initiativeOrder, startSelection } from '../initiative'
import type { Stepped } from '../initiative'
import {
  damageFor, directionFor, displacementStep, effectivePos, physicalPreview,
} from '../physical'
import type {
  ArmLoc, AttackDirection, DataBundle, GameState, HitTable, LegLoc, PhysicalDeclaration, PhysicalKind, Rejection, RejectionCode, UnitId,
} from '../types'

export type { Stepped }
export interface PhysOutcome extends Stepped { rejection?: Rejection }
const rej = (state: GameState, code: RejectionCode, message: string): PhysOutcome => ({ state, events: [], rejection: { code, message } })

/** PhaseStarted for the Physical Attack Phase and the first selection. */
export function startPhysicalPhase(state: GameState): Stepped {
  const b = beginPhase(state, 'physicalAttack', 'physical.select')
  const sel = startSelection(b.state, 'physicalAttack')
  return { state: sel.state, events: [...b.events, ...sel.events] }
}

/** The torsoTwist decision is raised in this phase only when no twist/flip was used this turn (ARC-011). */
export function physicalTwistAvailable(state: GameState, unitId: UnitId): boolean {
  const u = state.units[unitId]!
  return !u.prone && u.attacks.twistPhase === null
}

// ---------- booking ----------
function book(state: GameState, d: Omit<PhysicalDeclaration, 'attackId'>, limbLoc: ArmLoc | LegLoc | null): { state: GameState; event: GameEvent; decl: PhysicalDeclaration } {
  const seq = state.attackSeq + 1
  const decl: PhysicalDeclaration = { ...d, attackId: `a:${seq}` }
  return {
    state: { ...state, attackSeq: seq, declarations: [...state.declarations, decl] },
    event: { type: 'PhysicalDeclared', unitId: d.attackerId, attackId: decl.attackId, kind: d.kind, targetId: d.targetId, limb: limbLoc, tn: d.tn },
    decl,
  }
}
const setDeclared = (state: GameState, id: UnitId): GameState => {
  const u = state.units[id]!
  return { ...state, units: { ...state.units, [id]: { ...u, attacks: { ...u.attacks, physicalDeclared: true } } } }
}

/** True when the unit's Movement-phase charge/DFA still stands and needs no decision (booked by bookCommitted). */
export function hasCommitted(state: GameState, unitId: UnitId): boolean {
  const u = state.units[unitId]!
  return !!(u.attacks.charge || u.attacks.dfa)
}

/**
 * The unit was selected and holds a charge or DFA from Movement: books it as its declaration (no decision). A charge that can no
 * longer happen (charger fell, target gone or prone or displaced away) is voided and the unit may declare another attack
 * (PHYS-042): `voided` is true and the caller raises declarePhysical with `data.code 'chargeVoided'`. A DFA whose jumper fell in the
 * Ranged Attack Phase books as an automatic miss (PHYS-062).
 */
export function bookCommitted(state: GameState, unitId: UnitId): Stepped & { voided: boolean; committed: boolean } {
  const a = state.units[unitId]!
  const ch = a.attacks.charge, df = a.attacks.dfa
  if (!ch && !df) return { state, events: [], voided: false, committed: false }
  const kind: PhysicalKind = ch ? 'charge' : 'dfa'
  const targetId = (ch ?? df)!.targetId
  const void_ = (): Stepped & { voided: boolean; committed: boolean } => {
    const u = { ...a, attacks: { ...a.attacks, charge: null, dfa: null } }
    return { state: { ...state, units: { ...state.units, [unitId]: u } }, events: [], voided: true, committed: true }
  }
  const t = state.units[targetId]
  const fromHex = effectivePos(a)
  if (!t || !t.pos || !fromHex || a.status === 'destroyed' || a.shutdown || !a.pilot.conscious || t.status === 'destroyed' || t.doomed || t.status === 'withdrawn') return void_()
  if (distance(fromHex, t.pos) !== 1) return void_()
  if (kind === 'charge' && (a.prone || t.prone)) return void_()
  const pv = physicalPreview(state, { attackerId: unitId, kind, targetId, attackerAt: { facing: directionTo(fromHex, t.pos)!, prone: false } }, { committed: true })
  if (!pv.legal && pv.reason !== 'E_TN_TOO_HIGH') return void_()
  const dir = directionFor(state, unitId, targetId, fromHex)
  let tn = pv.tn
  const mods = [...pv.mods]
  if (kind === 'dfa' && a.prone) { tn = 13; mods.push({ code: 'other', value: 13 - pv.tn, detail: 'jumper fell: automatic miss' }) }
  let direction: AttackDirection = dir.direction
  let table: HitTable = pv.table
  if (kind === 'dfa' && t.prone) { direction = 'rear'; table = 'standard' }
  const b = book(dir.state, { kind, attackerId: unitId, targetId, limb: null, tn, mods, direction, table }, null)
  return { state: setDeclared(b.state, unitId), events: [b.event], voided: false, committed: true }
}

/** Books a declarePhysical answer (punch/kick/push/none). Charge and DFA are never declared here. */
export function declarePhysical(state: GameState, _data: DataBundle, action: DeclarePhysicalAction): PhysOutcome {
  const a = state.units[action.unitId]
  if (!a) return rej(state, 'E_UNKNOWN_UNIT', 'unknown unit')
  if (a.owner !== action.player) return rej(state, 'E_NOT_YOUR_UNIT', 'not your unit')
  if (a.attacks.physicalDeclared) return rej(state, 'E_NO_PHYSICAL', 'already declared this phase')
  const ch = action.attack
  if (ch.kind === 'none') return { state: setDeclared(state, a.id), events: [] }
  if (a.status !== 'active' && a.status !== 'withdrawing') return rej(state, 'E_NOT_ELIGIBLE', 'unit is not on the board')
  if (a.attacks.charge || a.attacks.dfa) return rej(state, 'E_ATTACK_LIMIT', 'this unit already holds a charge or DFA')
  const wanted: { kind: PhysicalKind; limb?: ArmLoc | LegLoc; targetId: UnitId }[] = []
  if (ch.kind === 'punch') {
    if (ch.arms.length === 0 || ch.arms.length > 2 || (ch.arms.length === 2 && ch.arms[0]!.arm === ch.arms[1]!.arm)) return rej(state, 'E_BAD_PAYLOAD', 'punch needs one or two different arms')
    for (const x of ch.arms) wanted.push({ kind: 'punch', limb: x.arm, targetId: x.targetId })
  } else if (ch.kind === 'kick') wanted.push({ kind: 'kick', limb: ch.leg, targetId: ch.targetId })
  else wanted.push({ kind: 'push', targetId: ch.targetId })
  // PHYS-005: one push (or charge/DFA) per target
  if (ch.kind === 'push') {
    const t = ch.targetId
    const taken = state.declarations.some((d) => d.kind !== 'ranged' && d.targetId === t && (d.kind === 'push' || d.kind === 'charge' || d.kind === 'dfa'))
      || state.unitOrder.some((id) => { const u = state.units[id]!; return u.attacks.charge?.targetId === t || u.attacks.dfa?.targetId === t })
    if (taken) return rej(state, 'E_ATTACK_LIMIT', 'that unit is already the target of a charge, DFA or push')
  }
  let s = state
  const events: GameEvent[] = []
  const pre = wanted.map((w) => physicalPreview(s, { attackerId: a.id, kind: w.kind, ...(w.limb ? { limb: w.limb } : {}), targetId: w.targetId }))
  for (const p of pre) if (!p.legal) return rej(s, p.reason ?? 'E_NO_PHYSICAL', p.why ?? 'illegal physical attack')
  for (let i = 0; i < wanted.length; i++) {
    const w = wanted[i]!, p = pre[i]!
    const dir = directionFor(s, a.id, w.targetId, effectivePos(a)!)
    s = dir.state
    const b = book(s, { kind: w.kind, attackerId: a.id, targetId: w.targetId, limb: w.limb ?? null, tn: p.tn, mods: p.mods, direction: dir.direction, table: p.table }, w.limb ?? null)
    s = b.state
    events.push(b.event)
  }
  return { state: setDeclared(s, a.id), events }
}

// ---------- resolution ----------
function resolveOne(state: GameState, data: DataBundle, d: PhysicalDeclaration, index: number): Stepped {
  const a0 = state.units[d.attackerId]!, t0 = state.units[d.targetId]!
  const w = beginWork(state, data)
  const done = (hit: boolean, dealt: number): Stepped => {
    w.ev.push({ type: 'AttackEnded', attackId: d.attackId, hit, damageDealt: dealt })
    return endWork(w)
  }
  if (a0.status === 'destroyed' || t0.status === 'destroyed') return done(false, 0)
  // 1. to-hit
  let hit: boolean
  let auto: 'hit' | 'miss' | null = null
  let rolled: number | null = null
  if (d.tn <= 2) { hit = true; auto = 'hit' }
  else if (d.tn >= 13) { hit = false; auto = 'miss' }
  else {
    const r = roll2d6(w, { purpose: 'physicalToHit', unitId: d.attackerId, targetId: d.targetId, attackId: d.attackId, target: d.tn, mods: d.mods })
    hit = !!r.success
    rolled = r.total
  }
  w.ev.push({ type: 'AttackRolled', attackId: d.attackId, attackerId: d.attackerId, targetId: d.targetId, kind: d.kind, mountId: null, tn: d.tn, roll: rolled, hit, auto })
  const { damage, selfDamage } = damageFor(w.s, d)
  const aPos = effectivePos(a0)!, tPos = t0.pos!
  const dirTravel = directionTo(aPos, tPos)
  const order = Math.max(0, initiativeOrder(state).indexOf(d.attackerId)) * 1000 + index

  const hitGroups = (targetId: UnitId, attackerId: UnitId, amount: number, table: HitTable, direction: AttackDirection, group0: number): number => {
    let dealt = 0
    // punches and kicks land as one hit; charge and DFA damage comes in groups of 5 (00 §6 step 4, PHYS-043/064)
    const groups = d.kind === 'punch' || d.kind === 'kick' ? (amount > 0 ? [amount] : []) : splitGroups(amount, 5)
    groups.forEach((g, i) => {
      dealt += resolveGroupW(w, { attackId: d.attackId, attackerId, targetId, damage: g, group: group0 + i, table, direction, source: 'physical' }).dealt
    })
    return dealt
  }
  const psr = (unitId: UnitId, reason: 'kicked' | 'pushed' | 'charged' | 'dfaTarget' | 'missedKick' | 'chargeMade' | 'dfaMade', mod: number): void =>
    queuePsrW(w, { unitId, reason, mod, auto: false, when: 'endOfPhase' })
  const displace = (cause: 'charge' | 'dfa' | 'dfaMiss' | 'push'): void => {
    if (dirTravel === null) return
    w.ledger.displacements.push({ unitId: d.targetId, from: tPos, to: neighbor(tPos, dirTravel), dir: dirTravel, cause, byId: d.attackerId, order })
  }

  if (!hit) {
    if (d.kind === 'kick') psr(d.attackerId, 'missedKick', 0)
    if (d.kind === 'dfa') displace('dfaMiss')
    return done(false, 0)
  }
  let dealt = 0
  switch (d.kind) {
    case 'punch':
    case 'kick':
      dealt = hitGroups(d.targetId, d.attackerId, damage, d.table, d.direction, 1)
      if (d.kind === 'kick') psr(d.targetId, 'kicked', 0)
      break
    case 'push': {
      psr(d.targetId, 'pushed', 0)
      const mutual = w.ledger.displacements.findIndex((e) => e.cause === 'push' && e.unitId === d.attackerId && e.byId === d.targetId)
      if (mutual >= 0) w.ledger.displacements.splice(mutual, 1) // PHYS-072: both hit, neither moves
      else displace('push')
      break
    }
    case 'charge':
      dealt = hitGroups(d.targetId, d.attackerId, damage, 'standard', d.direction, 1)
      hitGroups(d.attackerId, d.targetId, selfDamage, 'standard', 'front', 1)
      psr(d.targetId, 'charged', 2)
      psr(d.attackerId, 'chargeMade', 2)
      displace('charge')
      break
    case 'dfa':
      dealt = hitGroups(d.targetId, d.attackerId, damage, d.table, d.direction, 1)
      hitGroups(d.attackerId, d.targetId, selfDamage, 'kick', 'front', 1)
      psr(d.targetId, 'dfaTarget', 2)
      psr(d.attackerId, 'dfaMade', 2)
      displace('dfa')
      break
  }
  return done(true, dealt)
}

/** Resolves every physical declaration in order inside a simultaneous window (PHYS-006/007). */
export function resolvePhysical(state: GameState, data: DataBundle): Stepped {
  let s: GameState = { ...state, step: 'physical.resolve', damageWindow: 'simultaneous', resolveIndex: 0 }
  const events: GameEvent[] = []
  const decls = state.declarations
  for (let i = 0; i < decls.length; i++) {
    const d = decls[i]!
    if (d.kind === 'ranged') continue
    s = { ...s, resolveIndex: i }
    const r = resolveOne(s, data, d, i)
    s = r.state; events.push(...r.events)
  }
  s = { ...s, resolveIndex: decls.length, damageWindow: 'immediate', step: 'physical.displace' }
  return { state: s, events }
}

/** Displacement Step then 00 §5.4 (a)-(e) for the Physical Attack Phase. */
export function finishPhysicalPhase(state: GameState, data: DataBundle): Stepped {
  const d = displacementStep(state, data)
  const f = finishPhase({ ...d.state, step: 'physical.endOfPhase' })
  return { state: f.state, events: [...d.events, ...f.events] }
}

/** Resolution, Displacement Step and end-of-phase in one call. */
export function runPhysicalResolution(state: GameState, data: DataBundle): Stepped {
  const a = resolvePhysical(state, data)
  const b = finishPhysicalPhase(a.state, data)
  return { state: b.state, events: [...a.events, ...b.events] }
}
