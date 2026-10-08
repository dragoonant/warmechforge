// FROZEN after M0: sfc32 seeded by cyrb128 with 15 warm-up draws (00 §12; copied from Whirr Machine).
// Pure: state in, state out; never Math.random. The engine rolls ONLY through roll(), imported from this module
// (tests mock it by module, 60-testing §6).
import type { DiceRolled } from './events'
import type { AttackId, GameState, Mod, RngState, RollPurpose, UnitId } from './types'

export function cyrb128(str: string): RngState {
  let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i)
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067)
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233)
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213)
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179)
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067)
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233)
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213)
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179)
  h1 ^= h2 ^ h3 ^ h4; h2 ^= h1; h3 ^= h1; h4 ^= h1
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0]
}

export const WARM_UP_DRAWS = 15

export function seedRng(seed: string): RngState {
  let s = cyrb128(seed)
  for (let i = 0; i < WARM_UP_DRAWS; i++) s = nextU32(s)[1]
  return s
}

export function nextU32(s: RngState): [number, RngState] {
  let [a, b, c, d] = s
  a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0
  const t = (((a + b) | 0) + d) | 0
  d = (d + 1) | 0
  a = b ^ (b >>> 9)
  b = (c + (c << 3)) | 0
  c = (c << 21) | (c >>> 11)
  c = (c + t) | 0
  return [t >>> 0, [a >>> 0, b >>> 0, c >>> 0, d >>> 0]]
}

export function nextFloat(s: RngState): [number, RngState] {
  const [u, n] = nextU32(s)
  return [u / 4294967296, n]
}

export function rollD6(s: RngState): [number, RngState] {
  const [f, n] = nextFloat(s)
  return [1 + Math.floor(f * 6), n]
}

export function rollDice(s: RngState, count: number): [number[], RngState] {
  const out: number[] = []
  let cur = s
  for (let i = 0; i < count; i++) { const [v, n] = rollD6(cur); out.push(v); cur = n }
  return [out, cur]
}

export interface RollSpec {
  count: number // number of d6, ≥ 1 (critSlot in a 12-slot location: 2 = [block, slot])
  sides: 6
  purpose: RollPurpose
  unitId?: UnitId // the unit the roll is for (roller or the unit checked)
  targetId?: UnitId
  attackId?: AttackId
  target?: number // TN; sets DiceRolled.success = total ≥ target
  flat?: number // added to the total (cluster modifiers; the caller clamps for table lookups)
  mods?: Mod[] // the TN breakdown, copied to the event for the dice tray
  reason?: string
}

/** The ONLY way the engine rolls: advances state.rng and rollSeq, returns the DiceRolled event. */
export function roll(state: GameState, spec: RollSpec): { state: GameState; event: DiceRolled } {
  const [dice, rng] = rollDice(state.rng, Math.max(1, spec.count))
  return { state: { ...state, rng, rollSeq: state.rollSeq + 1 }, event: diceEvent(state, spec, dice) }
}

/** Builds the DiceRolled event for given faces (shared by roll() and the forced-dice test mock). */
export function diceEvent(state: GameState, spec: RollSpec, dice: number[]): DiceRolled {
  const kept = [...dice]
  const total = kept.reduce((a, b) => a + b, 0) + (spec.flat ?? 0)
  const event: DiceRolled = { type: 'DiceRolled', rollId: `r:${state.rollSeq + 1}`, purpose: spec.purpose, dice, kept, total }
  if (spec.target !== undefined) { event.target = spec.target; event.success = total >= spec.target }
  if (spec.unitId !== undefined) event.unitId = spec.unitId
  if (spec.targetId !== undefined) event.targetId = spec.targetId
  if (spec.attackId !== undefined) event.attackId = spec.attackId
  if (spec.reason !== undefined) event.reason = spec.reason
  if (spec.mods !== undefined) event.mods = spec.mods
  return event
}

/** Seed state for out-of-engine randomness (AI, random bot): never touches state.rng. */
export function deriveSeed(...parts: (string | number)[]): RngState {
  return seedRng(parts.join('|'))
}

/** A game seed string derived from parts (sim: deriveSeedString(seed, 'sim', gameIndex)). 32 lowercase hex chars. */
export function deriveSeedString(...parts: (string | number)[]): string {
  return cyrb128(parts.join('|')).map((n) => n.toString(16).padStart(8, '0')).join('')
}
