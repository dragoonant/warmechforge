// Forced dice (60-testing §6). The test file owns the vi.mock (it must be hoisted there); this module holds the shared map
// and the mocked roll. Keys are the roll number the roll will have (state.rollSeq + 1, the n of `#n` in 13-golden).
//
//   const FORCED = vi.hoisted(() => ({ map: new Map<number, number[]>(), strict: { on: false } }))
//   vi.mock('../../src/engine/rng', async (orig) => {
//     const real = await orig<typeof import('../../src/engine/rng')>()
//     const { forcedRoll } = await import('../fixtures/forced-dice')
//     return { ...real, roll: forcedRoll(real, FORCED) }
//   })
import type { GameState } from '../../src/engine/types'
import type { DiceRolled } from '../../src/engine/events'
import type { RollSpec } from '../../src/engine/rng'

export interface ForcedDice { map: Map<number, number[]>; strict: { on: boolean } }
type RealRng = { roll(state: GameState, spec: RollSpec): { state: GameState; event: DiceRolled }; diceEvent(state: GameState, spec: RollSpec, dice: number[]): DiceRolled }

/** The mocked roll: a forced roll advances rollSeq only (never state.rng); strict mode refuses any unforced roll. */
export function forcedRoll(real: RealRng, forced: ForcedDice) {
  return (state: GameState, spec: RollSpec): { state: GameState; event: DiceRolled } => {
    const n = state.rollSeq + 1
    const f = forced.map.get(n)
    if (!f) {
      if (forced.strict.on) throw new Error(`unforced roll #${n} (${spec.purpose}${spec.reason ? `, ${spec.reason}` : ''})`)
      return real.roll(state, spec)
    }
    if (f.length !== Math.max(1, spec.count)) throw new Error(`forced dice count mismatch at roll #${n}: ${spec.purpose} wants ${spec.count}, forced ${f.length}`)
    forced.map.delete(n)
    return { state: { ...state, rollSeq: n }, event: real.diceEvent(state, spec, f) }
  }
}

/** Forces consecutive rolls starting at roll number `start`. */
export function force(forced: ForcedDice, start: number, ...rolls: number[][]): void {
  rolls.forEach((r, i) => forced.map.set(start + i, r))
}
/** The number the next roll will have. */
export const nextRollSeq = (s: GameState): number => s.rollSeq + 1
/** Throws when forced rolls were left unused (the roll order drifted). */
export function expectAllForcedUsed(forced: ForcedDice): void {
  const left = [...forced.map.keys()]
  forced.map.clear()
  forced.strict.on = false
  if (left.length) throw new Error(`forced rolls never used: #${left.join(', #')}`)
}
