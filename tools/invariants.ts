// Engine invariants (60-testing §3) checked after every step by the sim, the fuzz test and the bench.
import type { Action, GameEvent, GameState, PhaseId, StepResult } from '../src/engine/index'
import { LOCS, legalActions, validate } from '../src/engine/index'

export interface Violation { id: string; seed: string; decisionSeq: number; detail: string }

const PHASE_ORDER: PhaseId[] = ['initiative', 'movement', 'rangedAttack', 'physicalAttack', 'heat', 'end']

function hasNaN(v: unknown, path = '$', depth = 0): string | null {
  if (typeof v === 'number') return Number.isFinite(v) ? null : path
  if (!v || typeof v !== 'object' || depth > 8) return null
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    if (k === 'log' || k === 'board') continue
    const r = hasNaN(x, `${path}.${k}`, depth + 1)
    if (r) return r
  }
  return null
}

/** Invariants on one state (INV-01, 02, 06-12). `fullLegal` also validates every legal member (INV-02). */
export function checkState(s: GameState, opts: { fullLegal?: boolean } = {}): Violation[] {
  const out: Violation[] = []
  const v = (id: string, detail: string): void => { out.push({ id, seed: s.seed, decisionSeq: s.decisionSeq, detail }) }
  const p = s.pending
  if (!p) v('INV-01', 'no pending decision')
  else if ((p.kind === 'gameOver') !== (s.phase === 'ended')) v('INV-01', `pending ${p.kind} in phase ${s.phase}`)
  if (p && p.kind !== 'gameOver') {
    const legal = legalActions(s)
    if (legal.length === 0) v('INV-02', `empty legal set for ${p.kind} ${p.unitId ?? ''}`)
    const check = opts.fullLegal ? legal : legal.slice(0, 3)
    for (const a of check) {
      const r = validate(s, a)
      if (r) { v('INV-02', `legal member rejected: ${r.code} ${r.message} (${p.kind})`); break }
    }
  }
  const nan = hasNaN(s)
  if (nan) v('NaN', `non-finite number at ${nan}`)
  for (const id of s.unitOrder) {
    const u = s.units[id]!
    for (const l of LOCS) {
      const L = u.locs[l]
      if (L.armor < 0 || L.armor > L.maxArmor) v('INV-06', `${id} ${l} armor ${L.armor}/${L.maxArmor}`)
      if (L.rear !== null && (L.rear < 0 || L.rear > (L.maxRear ?? 0))) v('INV-06', `${id} ${l} rear ${L.rear}/${L.maxRear}`)
      if (L.structure < 0 || L.structure > L.maxStructure) v('INV-07', `${id} ${l} structure ${L.structure}/${L.maxStructure}`)
      if ((L.structure === 0) !== L.destroyed) v('INV-07', `${id} ${l} structure ${L.structure} destroyed ${L.destroyed}`)
    }
    if (u.status !== 'destroyed' && !u.doomed) {
      if (u.locs.HD.destroyed || u.locs.CT.destroyed) v('INV-08', `${id} head/CT destroyed but status ${u.status}`)
      if (u.pilot.dead) v('INV-08', `${id} pilot dead but status ${u.status}`)
    }
    if (!Number.isInteger(u.heat) || u.heat < 0) v('INV-09', `${id} heat ${u.heat}`)
    for (const b of Object.values(u.bins)) {
      if (b.shots < 0 || b.shots > b.capacity) v('INV-10', `${id} bin ${b.id} ${b.shots}/${b.capacity}`)
      if (b.exploded && b.shots !== 0) v('INV-10', `${id} exploded bin ${b.id} has ${b.shots}`)
    }
    if (u.pilot.hits < 0 || u.pilot.hits > 6) v('INV-11', `${id} pilot hits ${u.pilot.hits}`)
    if (u.pilot.hits >= 6 && !u.pilot.dead) v('INV-11', `${id} 6 hits but alive`)
    for (const l of LOCS) for (const sl of u.slots[l]) if (sl.hit && (sl.token === 'empty' || sl.token === 'structure' || sl.token === 'armor')) v('INV-12', `${id} filler slot hit in ${l}`)
    if (p && p.unitId === id && u.status === 'destroyed') v('INV-08', `destroyed ${id} has a decision`)
  }
  return out
}

/** Transition invariants (INV-03, INV-14, INV-17) for prev → result after `action`. */
export function checkStep(prev: GameState, action: Action, r: StepResult): Violation[] {
  const out: Violation[] = []
  const s = r.state
  const v = (id: string, detail: string): void => { out.push({ id, seed: prev.seed, decisionSeq: prev.decisionSeq, detail }) }
  if (r.rejection) {
    if (r.state !== prev) v('INV-03', 'rejected step changed the state reference')
    v('REJECT', `legal action rejected: ${r.rejection.code} ${r.rejection.message} (${action.type})`)
    return out
  }
  if (r.pending !== s.pending) v('INV-01', 'StepResult.pending is not state.pending')
  // phase order
  let phase: PhaseId = prev.phase
  let turn = prev.turn
  let rolls = prev.rollSeq
  for (const e of r.events as GameEvent[]) {
    if (e.type === 'TurnStarted') {
      if (e.turn !== turn + 1) v('INV-14', `turn ${turn} → ${e.turn}`)
      turn = e.turn
    } else if (e.type === 'PhaseStarted') {
      const a = PHASE_ORDER.indexOf(phase), b = PHASE_ORDER.indexOf(e.phase)
      const ok = (phase === 'end' && e.phase === 'initiative') || (phase === 'deployment' && e.phase === 'initiative') || b === a + 1
      if (!ok) v('INV-14', `phase ${phase} → ${e.phase}`)
      phase = e.phase
    } else if (e.type === 'DiceRolled') {
      rolls++
      if (e.dice.some((d) => d < 1 || d > 6 || !Number.isInteger(d))) v('INV-17', `bad die in ${e.purpose}`)
      if (e.rollId !== `r:${rolls}`) v('INV-17', `roll id ${e.rollId}, expected r:${rolls}`)
    }
  }
  if (rolls !== s.rollSeq) v('INV-17', `rollSeq ${s.rollSeq} but ${rolls} rolls seen`)
  if (s.turn < prev.turn) v('INV-14', 'turn went backwards')
  return out
}
