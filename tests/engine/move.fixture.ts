// Shared builders for the movement and deployment tests: a dense board, minimal units and a bare GameState.
import { hexToLabel, offsetToHex } from '../../src/engine/hex'
import type { BoardHex, Facing, GameState, Hex, Loc, UnitState } from '../../src/engine/types'

export { offsetToHex }
export const hexLabelFor = (cols: number, rows: number, h: Hex) => hexToLabel({ cols, rows }, h)
export const H = (col: number, row: number): Hex => offsetToHex(col, row)

const LOCS: Loc[] = ['HD', 'CT', 'LT', 'RT', 'LA', 'RA', 'LL', 'RL']
const loc = (destroyed = false) => ({ armor: 10, rear: null, structure: 5, maxArmor: 10, maxRear: null, maxStructure: 5, destroyed, destroyedCause: null })

export interface UnitOver {
  id?: string
  owner?: 'A' | 'B'
  pos?: Hex | null
  facing?: Facing
  prone?: boolean
  heat?: number
  piloting?: number
  tonnage?: number
  status?: UnitState['status']
  shutdown?: UnitState['shutdown']
  pilotConscious?: boolean
  locsDestroyed?: Loc[]
  slots?: Partial<Record<Loc, { token: string; hit: boolean; hitPhase: number | null }[]>>
  baseMp?: { walk: number; run: number; jump: number }
  mounts?: Record<string, unknown>
}
export function mkUnit(o: UnitOver = {}): UnitState {
  const slots = Object.fromEntries(LOCS.map((l) => [l, o.slots?.[l] ?? []]))
  const locs = Object.fromEntries(LOCS.map((l) => [l, loc(o.locsDestroyed?.includes(l))]))
  return {
    id: o.id ?? 'A1', owner: o.owner ?? 'A', mechId: 'x', name: 'x', tonnage: o.tonnage ?? 50,
    baseMp: o.baseMp ?? { walk: 5, run: 8, jump: 0 }, sinks: { count: 10, type: 'single' },
    status: o.status ?? 'active', crippled: false, pos: o.pos === undefined ? H(4, 6) : o.pos, facing: o.facing ?? 0,
    prone: o.prone ?? false, shutdown: o.shutdown ?? null, heat: o.heat ?? 0,
    pilot: { pilotId: null, name: 'P', gunnery: 4, piloting: o.piloting ?? 5, hits: 0, conscious: o.pilotConscious ?? true, dead: false, koTurn: null, spas: [] },
    locs, slots, mounts: o.mounts ?? {}, bins: {},
    move: { mode: null, startHex: null, startFacing: 0, hexesMoved: 0, jumped: false, mpSpent: 0, tmm: 0, attackerMod: 0, done: false, entered: false, standAttempts: 0, fell: false, ranHexes: 0 },
    attacks: { twist: 0, flipped: false, twistPhase: null, rangedDeclared: false, physicalDeclared: false, primaryTargetId: null, propArm: null, firedMounts: [], charge: null, dfa: null },
    doomed: null, destroyedCause: null, escalating: {},
  } as unknown as UnitState
}

/** A cols x rows board of clear level-0 hexes; `over` patches hexes by printed label ('0405' = col 4, row 5). */
export function mkBoard(cols: number, rows: number, over: Record<string, Partial<BoardHex>> = {}) {
  const hexes: Record<string, BoardHex> = {}
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      const label = String(c + 1).padStart(2, '0') + String(r + 1).padStart(2, '0')
      hexes[label] = { label, hex: offsetToHex(c, r), level: 0, woods: 'none', depth: 0, rough: false, rubble: false, pavement: false, road: [], ...(over[label] ?? {}) }
    }
  }
  return { mapId: 'map.test', cols, rows, hexes, centre: { x: ((cols - 1) * 0.866) / 2, z: (rows - 1) / 2 + 0.25 } }
}

export function mkState(units: UnitState[], over: Record<string, Partial<BoardHex>> = {}, cols = 9, rows = 9): GameState {
  return {
    format: 1, seed: 's', rng: [1, 2, 3, 4], rollSeq: 0, decisionSeq: 1, attackSeq: 0, psrSeq: 0, phaseSeq: 1, dataVersion: 'v', setup: { missionId: 'm', mapId: 'map.test', sides: [{ sideId: 'a' }, { sideId: 'b' }] },
    board: mkBoard(cols, rows, over),
    sides: {
      A: { id: 'A', sideId: 'a', label: 'A', control: 'human', homeEdge: 'south', deployment: 'edgeEntry' },
      B: { id: 'B', sideId: 'b', label: 'B', control: 'ai', homeEdge: 'north', deployment: 'edgeEntry' },
    },
    turn: 1, phase: 'movement', step: 'movement.move', damageWindow: 'immediate', initiative: null, selection: null,
    units: Object.fromEntries(units.map((u) => [u.id, u])), unitOrder: units.map((u) => u.id),
    declarations: [], resolveIndex: 0, current: null, ledger: { phase: 'movement', damage: {}, damage20: [], pilotHit: [], immobileAtStart: [], displacements: [] },
    psr: { queue: [], history: {} }, heatLedger: {}, choices: { los: {}, direction: {} }, resume: null, result: null,
    pending: { id: 'd:1', player: 'A', kind: 'move', phase: 'movement', step: 'movement.move', unitId: units[0]?.id ?? null, context: {}, canPass: false }, log: [],
  } as unknown as GameState
}
