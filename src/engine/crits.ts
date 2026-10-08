// Critical hits: check, slot placement, transfer rules and slot effects (10 §11, CRIT-001..012, CRIT-020..101).
// Explosions, PSR queueing, pilot hits and destruction are the damage pipeline's (damage.ts); this module decides what is hit.
import type { CritEffect, CritSlotHit } from './events'
import type { DataBundle, GameState, Loc, LocalId, PsrReason, UnitId, UnitState } from './types'
import { beginWork, endWork, roll1d6, roll2d6, snapshot, unitOf, viaState } from './dice'
import { collectHooksWith } from './hooks'
import type { Work } from './dice'
import { caseAt, equipRec, hasExplosive, isExplosiveSlot, hasFlag, recName, weaponRec } from './ammo'
import {
  TRANSFER, destroyLocationW, destroyUnitW, explodeBinW, explodeComponentW, killPilotW, queuePsrW,
} from './damage'
import type { Stepped } from './damage'
import { bundleFor } from './bundles'
import type { ComponentDestroyed } from './events'
import { codesOf, equipDeps, isPartialWing, partialWingBonuses, podUsed } from './equipment'

export type CritWhy = 'structure' | 'tac' | 'explosive' | 'masc'
export interface CritCheckInput { unitId: UnitId; location: Loc; why: CritWhy }

const FILLER = new Set(['empty', 'structure', 'armor'])
/** CRIT-003: a slot that can take a crit is not filler and not already hit. */
const open = (s: { token: string; hit: boolean }): boolean => !FILLER.has(s.token) && !s.hit
const BLOWN_OFF: ReadonlySet<Loc> = new Set<Loc>(['HD', 'LA', 'RA', 'LL', 'RL'])

/** CRIT-001: number of crits for a (modified) 2d6. 12+ is 3 on a torso, and a blow-off elsewhere (reported by the caller). */
export function critsFor(total: number): number {
  return total >= 12 ? 3 : total >= 10 ? 2 : total >= 8 ? 1 : 0
}

/** CRIT-010: did the location have any slot able to take a crit at the start of this phase (hit slots count only if hit this phase)? */
function critableAtPhaseStart(u: UnitState, loc: Loc, phaseSeq: number): boolean {
  if (u.locs[loc].destroyed) return false
  return u.slots[loc].some((s) => !FILLER.has(s.token) && !(s.hit && s.hitPhase !== phaseSeq))
}

/** CRIT-002/003: roll slot dice until an open slot comes up; each roll is its own critSlot DiceRolled. Returns the slot index. */
function pickSlot(w: Work, unitId: UnitId, loc: Loc): number {
  for (let guard = 0; guard < 500; guard++) {
    const slots = unitOf(w, unitId).slots[loc]
    let idx: number
    if (slots.length > 6) {
      const upper = slots.slice(0, 6).some(open)
      const lower = slots.slice(6).some(open)
      if (upper && lower) {
        const r = roll2d6(w, { purpose: 'critSlot', unitId, reason: loc })
        idx = (r.dice[0]! <= 3 ? 0 : 6) + r.dice[1]! - 1
      } else {
        const r = roll1d6(w, { purpose: 'critSlot', unitId, reason: loc })
        idx = (upper ? 0 : 6) + r.dice[0]! - 1
      }
    } else {
      const r = roll1d6(w, { purpose: 'critSlot', unitId, reason: loc })
      idx = r.dice[0]! - 1
    }
    if (slots[idx] && open(slots[idx]!)) return idx
  }
  throw new Error('pickSlot: no open slot found')
}

const hitTokens = (u: UnitState, token: string): number => {
  let n = 0
  for (const sl of Object.values(u.slots)) for (const s of sl) if (s.hit && s.token === token) n++
  return n
}

/** Engine slots lost with a destroyed side torso count as engine crits (DMG-011). */
export function engineSlotsLost(w: Work, unitId: UnitId, loc: Loc): void {
  const phaseSeq = w.s.phaseSeq
  const u = unitOf(w, unitId)
  u.slots[loc].forEach((s, index) => {
    if (s.token !== 'engine' || s.hit) return
    s.hit = true
    s.hitPhase = phaseSeq
    const ev: CritSlotHit = { type: 'CritSlotHit', unitId, location: loc, index, token: 'engine', itemName: null, effect: 'engine' }
    w.ev.push(ev)
  })
  if (hitTokens(unitOf(w, unitId), 'engine') >= 3) destroyUnitW(w, unitId, 'engine')
}

/** What a hit on this slot does (no side effects). */
function effectOf(w: Work, u: UnitState, token: string): { effect: CritEffect; name: string | null } {
  if (token.startsWith('#')) {
    const id = token.slice(1)
    const bin = u.bins[id]
    if (bin) {
      return { effect: bin.exploded || binShots(w.data, u, id) <= 0 ? 'emptyBin' : 'ammoExplosion', name: recName(w.data, bin.ammo) }
    }
    const m = u.mounts[id]
    if (m) {
      const weapon = weaponRec(w.data, m.item)
      const eq = equipRec(w.data, m.item)
      const name = recName(w.data, m.item)
      if (m.destroyed) return { effect: 'none', name }
      if (isPartialWing(m.item)) return { effect: 'componentDamaged', name } // v7.01 errata: each wing crit trims the bonuses (see partialWingBonuses)
      if (weapon?.flags?.includes('explodes') || eq?.explodes) return { effect: 'componentExplosion', name }
      // EQUIP-017: an unused coolant pod bursts like an ammo bin (its crit hook does the explosion)
      if (codesOf(w.data, m.item).includes('coolantPod') && !podUsed(m)) return { effect: 'componentExplosion', name }
      if (weapon && hasFlag(weapon, 'ac') && m.critHits < 1) return { effect: 'componentDamaged', name } // EQUIP-010: the second crit destroys it
      if ((eq as { critEffect?: string } | null)?.critEffect === 'none') return { effect: 'none', name }
      if (eq?.kind === 'heatSink') return { effect: 'heatSink', name }
      if (eq?.kind === 'jumpJet') return { effect: 'jumpJet', name }
      return { effect: 'componentDestroyed', name }
    }
    return { effect: 'none', name: null }
  }
  switch (token) {
    case 'cockpit': return { effect: 'cockpit', name: null }
    case 'engine': return { effect: 'engine', name: null }
    case 'gyro': return { effect: 'gyro', name: null }
    case 'sensors': return { effect: 'sensors', name: null }
    case 'lifeSupport': return { effect: 'lifeSupport', name: null }
    case 'shoulder': case 'upperArm': case 'lowerArm': case 'hand': case 'hip': case 'upperLeg': case 'lowerLeg': case 'foot':
      return { effect: 'actuator', name: null }
    default: return { effect: 'none', name: null }
  }
}
const binShots = (data: DataBundle, u: UnitState, id: LocalId): number => {
  const b = u.bins[id]
  if (!b) return 0
  return isExplosiveSlot(data, u, `#${id}`) ? b.shots : 0
}

// Partial wing rules live in equipment.ts (hook partialWing); re-exported here for existing callers.
export { isPartialWing, partialWingBonuses }

const LEG_PSR: Partial<Record<string, PsrReason>> = { hip: 'hipCrit', upperLeg: 'upperLegCrit', lowerLeg: 'lowerLegCrit' }

/**
 * Hook point `crit` (00 §11.4): a slot of a mount whose item names a code hook was hit. Each bound hook of that mount is asked
 * in order; the first that reports `handled` replaces the normal effect (its result is applied). True = handled.
 */
function critHook(w: Work, unitId: UnitId, loc: Loc, mountId: LocalId): boolean {
  const snap = snapshot(w)
  const bound = collectHooksWith(w.data, snap, unitId, 'crit').filter((b) => b.mountId === mountId && b.hook.crit)
  if (bound.length === 0) return false
  let handled = false
  viaState(w, (s) => {
    for (const b of bound) {
      const r = b.hook.crit!({ state: s, point: 'crit', unitId, sourceId: b.sourceId, mountId, location: loc, params: { data: w.data } })
      if (r.handled) { handled = true; return r.result ?? { state: s, events: [] } }
    }
    return { state: s, events: [] }
  })
  return handled
}

/** Applies a slot's effect after CritSlotHit was emitted. */
function applyEffect(w: Work, unitId: UnitId, loc: Loc, token: string, effect: CritEffect): void {
  if (token.startsWith('#')) {
    const id = token.slice(1)
    if (effect === 'ammoExplosion') { explodeBinW(w, unitId, id, 'crit'); return }
    if (critHook(w, unitId, loc, id)) return
    const m = unitOf(w, unitId).mounts[id]
    if (!m) return
    m.critHits++
    if (effect === 'componentDamaged' || effect === 'none' || effect === 'emptyBin') return
    m.destroyed = true
    const ev: ComponentDestroyed = { type: 'ComponentDestroyed', unitId, mountId: id, token, location: loc }
    w.ev.push(ev)
    if (effect === 'componentExplosion') explodeComponentW(w, unitId, id)
    return
  }
  const u = unitOf(w, unitId)
  switch (token) {
    case 'cockpit':
      killPilotW(w, unitId)
      destroyUnitW(w, unitId, 'cockpit')
      return
    case 'engine':
      if (hitTokens(u, 'engine') >= 3) destroyUnitW(w, unitId, 'engine')
      return
    case 'gyro': {
      const n = hitTokens(u, 'gyro')
      if (n === 1) queuePsrW(w, { unitId, reason: 'gyroCrit', mod: 0, auto: false, when: 'endOfPhase' })
      else if (n === 2) queuePsrW(w, { unitId, reason: 'gyroDestroyed', mod: 0, auto: true, when: 'endOfPhase' })
      return
    }
    case 'hip': case 'upperLeg': case 'lowerLeg': {
      const key = `${unitId}:${loc}`
      if (w.legPsr.has(key) || u.locs[loc].destroyed) return // CRIT-095: one PSR per leg per damage instance
      w.legPsr.add(key)
      queuePsrW(w, { unitId, reason: LEG_PSR[token]!, mod: 0, auto: false, when: 'endOfPhase' })
      return
    }
    default: return // sensors, life support, arm actuators, foot: effects are read from the hit slots by the rules that use them
  }
}

/**
 * One crit check (CRIT-001): rolls 2d6, places each crit (CRIT-002/003/010), resolves each fully before the next.
 * On a destroyed location only crits landing on explosive slots resolve (CRIT-005).
 */
export function critCheckW(w: Work, p: CritCheckInput): void {
  const { unitId } = p
  const phaseSeq = w.s.phaseSeq
  let loc = p.location
  const destroyedMode = unitOf(w, unitId).locs[loc].destroyed
  if (destroyedMode && !hasExplosive(w.data, unitOf(w, unitId), loc)) return

  const mod = caseAt(w.data, unitOf(w, unitId), loc) === 'caseII' ? -1 : 0
  const r = roll2d6(w, { purpose: 'critCheck', unitId, flat: mod, reason: p.why })
  const total = r.total
  const blownOff = total >= 12 && BLOWN_OFF.has(loc) && !destroyedMode
  const crits = blownOff ? 0 : critsFor(total)
  const check = (appliesTo: Loc | null): void => {
    w.ev.push({ type: 'CritCheckRolled', unitId, location: p.location, roll: total, crits, blownOff, appliesTo, why: p.why })
  }
  if (blownOff) {
    check(loc)
    destroyLocationW(w, unitId, loc, 'blownOff') // CRIT-004: nothing transfers, ammo inside does not explode
    return
  }
  if (crits === 0) { check(loc); return }

  // CRIT-010: nothing crit-able since before this phase -> the crits move inward
  if (!destroyedMode) {
    while (!critableAtPhaseStart(unitOf(w, unitId), loc, phaseSeq)) {
      const next = TRANSFER[loc]
      if (!next) {
        check(null)
        w.ev.push({ type: 'CritLost', unitId, location: loc, count: crits, why: 'noSlotThisPhase' })
        return
      }
      loc = next
    }
  }
  check(loc)

  let discarded = 0
  for (let i = 0; i < crits; i++) {
    const slots = unitOf(w, unitId).slots[loc]
    if (!slots.some(open)) {
      w.ev.push({ type: 'CritLost', unitId, location: loc, count: crits - i, why: 'noSlotThisPhase' })
      break
    }
    const idx = pickSlot(w, unitId, loc)
    const slot = unitOf(w, unitId).slots[loc][idx]!
    if (destroyedMode && !isExplosiveSlot(w.data, unitOf(w, unitId), slot.token)) { discarded++; continue } // CRIT-005
    slot.hit = true
    slot.hitPhase = phaseSeq
    const { effect, name } = effectOf(w, unitOf(w, unitId), slot.token)
    const ev: CritSlotHit = { type: 'CritSlotHit', unitId, location: loc, index: idx, token: slot.token, itemName: name, effect }
    w.ev.push(ev)
    applyEffect(w, unitId, loc, slot.token, effect)
  }
  if (discarded > 0) w.ev.push({ type: 'CritLost', unitId, location: loc, count: discarded, why: 'notExplosive' })
}

/** Standalone crit check (state in, state + events out). */
export function critCheck(state: GameState, p: CritCheckInput, data?: DataBundle): Stepped {
  const w = beginWork(state, data ?? bundleFor(state))
  critCheckW(w, p)
  return endWork(w)
}


// ---------- wire the equipment module's late-bound crit check (equipment.ts must not import this file) ----------
equipDeps.critCheck = (state, p, data) => critCheck(state, p, data)
