// Shared helpers for the AI tests: real intro-mission games, and constructed positions patched into a real state.
import { loadBundle } from '../../src/data/index'
import type { Action, Facing, GameState, Hex, PlayerId, UnitState } from '../../src/engine/index'
import { createGame, legalActions, step, view } from '../../src/engine/index'
import { decideAi, type AiDecideOptions } from '../../src/ai/decider'
import { decideRandom } from '../../src/ai/random'
import { introSetup } from '../../tools/sim'

export const BUNDLE = loadBundle()
export const SETUP = introSetup(BUNDLE, 'mission.intro', 30)

export type Tier = 'random' | 'easy' | 'normal'

/** One answer for the open decision by the given tier. */
export function answer(s: GameState, tier: Tier, opts: Partial<AiDecideOptions> = {}): Action {
  const p = s.pending
  const legal = legalActions(s)
  if (tier === 'random') return decideRandom(view(s, p.player), p, legal, `${s.seed}|${p.player}`)
  return decideAi(view(s, p.player), p, legal, { tier, ...opts }).action
}

/** Plays random vs random from a fresh intro game until `stop(state)` holds (or the game ends). */
export function playUntil(seed: string, stop: (s: GameState) => boolean, maxDecisions = 3000): GameState {
  let s = createGame(SETUP, seed, BUNDLE).state
  for (let i = 0; i < maxDecisions && s.pending.kind !== 'gameOver' && !stop(s); i++) {
    const r = step(s, answer(s, 'random'))
    if (r.rejection) throw new Error(`random bot rejected: ${r.rejection.message}`)
    s = r.state
  }
  return s
}

/** The same state on a flat, clear board (no hills, woods or water), so LOS and cover never interfere. */
export function flatten(s: GameState): GameState {
  const hexes = Object.fromEntries(Object.entries(s.board.hexes).map(([k, h]) => [k, { ...h, level: 0, woods: 'none' as const, depth: 0, rough: false, rubble: false }]))
  return { ...s, board: { ...s.board, hexes } }
}

export const hexOf = (s: GameState, label: string): Hex => s.board.hexes[label]!.hex

/** Patch one unit (position, facing, armor…). */
export function patchUnit(s: GameState, id: string, patch: Partial<UnitState> | ((u: UnitState) => Partial<UnitState>)): GameState {
  const u = s.units[id]!
  const p = typeof patch === 'function' ? patch(u) : patch
  return { ...s, units: { ...s.units, [id]: { ...u, ...p } } }
}

export function place(s: GameState, id: string, hex: Hex, facing: Facing): GameState {
  return patchUnit(s, id, (u) => ({ pos: hex, facing, prone: false, shutdown: null, heat: 0, status: 'active', attacks: { ...u.attacks, twist: 0, twistPhase: null, firedMounts: [], rangedDeclared: false, charge: null, dfa: null } }))
}

export const sideOf = (s: GameState, id: string): PlayerId => s.units[id]!.owner
