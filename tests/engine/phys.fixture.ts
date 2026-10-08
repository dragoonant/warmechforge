// Shared helpers for the initiative / ranged / physical tests: a small flat board, units placed by (col,row), forced dice.
import { BUNDLE, mkState, mkUnit } from './damage.fixture'
import type { UnitOpts } from './damage.fixture'
import { hexToLabel, offsetToHex } from '../../src/engine/hex'
import type { BoardHex, BoardState, GameState, Hex, UnitState } from '../../src/engine/types'
import { registerBundle } from '../../src/engine/index'

export { BUNDLE, mkUnit, mkState }

export function mkBoard(cols = 8, rows = 8, over: Record<string, Partial<BoardHex>> = {}): BoardState {
  const hexes: Record<string, BoardHex> = {}
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      const hex = offsetToHex(c, r)
      const label = hexToLabel({ cols, rows }, hex)!
      hexes[label] = { label, hex, level: 0, woods: 'none', depth: 0, rough: false, rubble: false, pavement: false, road: [], ...over[label] }
    }
  }
  return { mapId: 'map.test', cols, rows, hexes, centre: { x: 0, z: 0 } }
}

export const at = (col: number, row: number): Hex => offsetToHex(col, row)

export const MLASER = { id: 'm1', item: 'w.mlaser', location: 'RA' as const }
export const PPC = { id: 'm2', item: 'w.ppc', location: 'RT' as const }

/** A state with the test board and units placed. Units: [id, owner, col, row, facing, opts]. */
export function world(
  specs: [string, 'A' | 'B', number, number, 0 | 1 | 2 | 3 | 4 | 5, UnitOpts?][],
  board: BoardState = mkBoard(),
): GameState {
  registerBundle(BUNDLE)
  const units: UnitState[] = specs.map(([id, owner, col, row, facing, o]) => ({ ...mkUnit(id, owner, o ?? {}), pos: at(col, row), facing }))
  const s = mkState(units)
  return {
    ...s, board, phase: 'rangedAttack', step: 'ranged.declare',
    initiative: { winner: 'B', loser: 'A', totals: { A: 5, B: 9 }, rerolls: 0 },
    sides: {} as GameState['sides'],
  } as GameState
}

/** Forced-dice queue shared with a vi.mock of '../../src/engine/rng' (see the test files). */
export const withUnit = (s: GameState, id: string, patch: Partial<UnitState>): GameState =>
  ({ ...s, units: { ...s.units, [id]: { ...s.units[id]!, ...patch } } })
