// Mission setup (00 4.5, 11 section 1 and 4): validates a GameSetup against the bundle and builds turn 0 / turn 1.
// createGame in index.ts is a frozen stub; the phase machine calls createInitialState and then owns the rest of turn 1.
import type { Ammo, Force, ForceUnit, GameMap, MapHex, Mech, Mission, Pilot, Tables } from '../data/types'
import type { GameEvent } from './events'
import { hexToLabel, hexToOffset, labelToHex, offsetToHex } from './hex'
import { bundleFor, registerBundle } from './bundles'
import { seedRng } from './rng'
import { freshAttacks, freshMove } from './phases/end'
import type {
  BoardHex, BoardState, DataBundle, Edge, Hex, HexLabel, Loc, LocState, PendingDecision, PlayerId, SideState, SlotState,
  UnitId, UnitState,
} from './types'
import { COLUMN_STEP, LOCS } from './types'
import type { GameSetup, GameState } from './types'

const OPPOSITE: Record<Edge, Edge> = { north: 'south', south: 'north', east: 'west', west: 'east' }
const PLAYERS: PlayerId[] = ['A', 'B']

// ---------- board (20 section 8) ----------
interface FlatHex { level?: number; terrain?: MapHex['terrain'] }
/** Flattens a map record (direct hexes or composite sheets) to 0-based `col,row` -> hex data. */
function flattenMap(bundle: DataBundle, map: GameMap, depth = 0): Map<string, FlatHex> {
  const out = new Map<string, FlatHex>()
  if (depth > 3) return out
  for (const [label, h] of Object.entries(map.hexes ?? {})) {
    const hx = labelToHex(label)
    if (!hx) continue
    const { col, row } = hexToOffset(hx)
    out.set(`${col},${row}`, h)
  }
  for (const sh of map.sheets ?? []) {
    const sub = bundle.maps[sh.map] as GameMap | undefined
    if (!sub) continue
    for (const [k, h] of flattenMap(bundle, sub, depth + 1)) {
      const [c, r] = k.split(',').map(Number) as [number, number]
      const cc = sh.rotate180 ? sub.width - 1 - c : c
      const rr = sh.rotate180 ? sub.height - 1 - r : r
      out.set(`${cc + sh.col},${rr + sh.row}`, h)
    }
  }
  return out
}

export function buildBoard(bundle: DataBundle, map: GameMap): BoardState {
  const flat = flattenMap(bundle, map)
  const hexes: Record<HexLabel, BoardHex> = {}
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity
  for (let col = 0; col < map.width; col++) {
    for (let row = 0; row < map.height; row++) {
      const hex = offsetToHex(col, row)
      const label = hexToLabel({ cols: map.width, rows: map.height }, hex)!
      const src = flat.get(`${col},${row}`)
      const bh: BoardHex = { label, hex, level: src?.level ?? map.defaultLevel ?? 0, woods: 'none', depth: 0, rough: false, rubble: false, pavement: false, road: [] }
      for (const f of src?.terrain ?? []) {
        if (f.type === 'lightWoods') bh.woods = 'light'
        else if (f.type === 'heavyWoods') bh.woods = 'heavy'
        else if (f.type === 'rough') bh.rough = true
        else if (f.type === 'rubble') bh.rubble = true
        else if (f.type === 'pavement') bh.pavement = true
        else if (f.type === 'water') bh.depth = f.depth
        else if (f.type === 'road') bh.road = f.exits as BoardHex['road']
      }
      hexes[label] = bh
      const x = hex.q * COLUMN_STEP, z = hex.r + hex.q / 2
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z)
    }
  }
  return { mapId: map.id, cols: map.width, rows: map.height, hexes, centre: { x: (minX + maxX) / 2, z: (minZ + maxZ) / 2 } }
}

// ---------- units ----------
function internalStructure(tables: Tables, tonnage: number, loc: Loc): number {
  const row = tables.internalStructure[String(tonnage)]
  if (!row) throw new Error(`no internal structure row for ${tonnage} t`)
  return loc === 'HD' ? row.HD : loc === 'CT' ? row.CT : loc === 'LT' || loc === 'RT' ? row.sideTorso : loc === 'LA' || loc === 'RA' ? row.arm : row.leg
}
const adjustedBv = (tables: Tables, bv: number, g: number, p: number): number => {
  const m = tables.bvSkillMultiplier.rows[g]?.[p]
  return m === undefined ? bv : Math.floor(bv * m + 0.5 + 1e-9)
}

export function buildUnit(bundle: DataBundle, fu: ForceUnit, id: UnitId, owner: PlayerId, halfLoads: boolean, pilotCards: boolean): UnitState {
  const mech = bundle.mechs[fu.mech] as Mech
  const tables = bundle.tables as Tables
  const card = fu.pilot ? (bundle.pilots[fu.pilot] as Pilot | undefined) : undefined
  const locs = {} as Record<Loc, LocState>
  const slots = {} as Record<Loc, SlotState[]>
  for (const l of LOCS) {
    const armor = mech.armor.front[l]
    const torso = l === 'CT' || l === 'LT' || l === 'RT'
    const rear = torso ? mech.armor.rear[l as 'CT'] : null
    const structure = internalStructure(tables, mech.tonnage, l)
    locs[l] = { armor, rear, structure, maxArmor: armor, maxRear: rear, maxStructure: structure, destroyed: false, destroyedCause: null }
    slots[l] = (mech.crits[l] ?? []).map((token) => ({ token, hit: false, hitPhase: null }))
  }
  const mounts: UnitState['mounts'] = {}
  for (const m of mech.mounts) {
    mounts[m.id] = { id: m.id, item: m.item, location: m.location, split: m.split ?? null, rear: m.rear ?? false, linkedTo: m.linkedTo ?? null, critHits: 0, destroyed: false, jammed: false, firedTurn: null }
  }
  const bins: UnitState['bins'] = {}
  for (const b of mech.ammoBins) {
    const ammoId = fu.ammo?.[b.id] ?? b.ammo
    const cap = (bundle.ammo[ammoId] as Ammo | undefined)?.shotsPerTon ?? 0
    const half = b.load === 'half' || (halfLoads && (fu.halfLoad ?? []).includes(b.id)) // SCN-004
    bins[b.id] = { id: b.id, ammo: ammoId, location: b.location, shots: half ? Math.floor(cap / 2) : cap, capacity: cap, exploded: false }
  }
  return {
    id, owner, mechId: mech.id, name: fu.name ?? `${mech.chassis} ${mech.model}`, tonnage: mech.tonnage,
    baseMp: { walk: mech.movement.walk, run: mech.movement.run, jump: mech.movement.jump },
    sinks: { count: mech.heatSinks.count, type: mech.heatSinks.type },
    status: 'offBoard', crippled: false, pos: null, facing: 0, prone: false, shutdown: null, heat: 0,
    pilot: {
      pilotId: fu.pilot ?? null, name: card?.name ?? 'MechWarrior', gunnery: fu.skills?.gunnery ?? card?.gunnery ?? 4,
      piloting: fu.skills?.piloting ?? card?.piloting ?? 5, hits: 0, conscious: true, dead: false, koTurn: null, spas: pilotCards ? [...(card?.spas ?? [])] : [],
    },
    locs, slots, mounts, bins, move: freshMove(0), attacks: freshAttacks(), doomed: null, destroyedCause: null, escalating: {},
  }
}

// ---------- validation and build ----------
export type SetupResult = { state: GameState; events: GameEvent[] } | { problems: string[] }
export const isProblems = (r: SetupResult): r is { problems: string[] } => 'problems' in r

export function createInitialState(setup: GameSetup, seed: string, bundle: DataBundle): SetupResult {
  registerBundle(bundle)
  const problems: string[] = []
  const mission = bundle.missions[setup.missionId] as Mission | undefined
  const map = bundle.maps[setup.mapId] as GameMap | undefined
  if (!mission) problems.push(`unknown mission ${setup.missionId}`)
  if (!map) problems.push(`unknown map ${setup.mapId}`)
  if (!mission || !map) return { problems }

  const msides = setup.sides.map((s) => mission.sides.find((m) => m.id === s.sideId))
  msides.forEach((m, i) => { if (!m) problems.push(`side ${setup.sides[i]!.sideId} is not in mission ${mission.id}`) })
  if (msides[0] && msides[1] && msides[0].homeEdge !== OPPOSITE[msides[1].homeEdge]) problems.push('home edges must be opposite')
  if (setup.sides[0].sideId === setup.sides[1].sideId) problems.push('both sides use the same side id')

  const tables = bundle.tables as Tables
  const budget = setup.bvBudget
  setup.sides.forEach((side, i) => {
    const f: Force = side.force as unknown as Force
    if (!f.units || f.units.length === 0) problems.push(`side ${i} has no units`)
    let bv = 0
    for (const u of f.units ?? []) {
      const mech = bundle.mechs[u.mech] as Mech | undefined
      if (!mech) { problems.push(`unknown mech ${u.mech}`); continue }
      if (u.pilot && !bundle.pilots[u.pilot]) problems.push(`unknown pilot ${u.pilot}`)
      const card = u.pilot ? (bundle.pilots[u.pilot] as Pilot | undefined) : undefined
      bv += adjustedBv(tables, mech.bv, u.skills?.gunnery ?? card?.gunnery ?? 4, u.skills?.piloting ?? card?.piloting ?? 5)
    }
    if (budget !== null && budget !== undefined && bv > budget) problems.push(`side ${i} BV ${bv} is over the budget ${budget}`)
  })
  if (problems.length) return { problems }

  let board: BoardState
  const units: Record<UnitId, UnitState> = {}
  const unitOrder: UnitId[] = []
  try {
    board = buildBoard(bundle, map)
    setup.sides.forEach((side, i) => {
      const f = side.force as unknown as Force
      f.units.forEach((fu, n) => {
        const id = `${PLAYERS[i]}${n + 1}`
        units[id] = buildUnit(bundle, fu, id, PLAYERS[i]!, mission.options.halfLoads === true, mission.options.pilotCards === true)
        unitOrder.push(id)
      })
    })
  } catch (e) {
    return { problems: [(e as Error).message] }
  }

  const sides = {} as Record<PlayerId, SideState>
  PLAYERS.forEach((p, i) => {
    const ms = msides[i]!
    sides[p] = { id: p, sideId: ms.id, label: setup.sides[i]!.label ?? ms.label, control: setup.sides[i]!.control, homeEdge: ms.homeEdge, deployment: ms.deployment.mode }
  })

  const base: GameState = {
    format: 1, seed, rng: seedRng(seed), rollSeq: 0, decisionSeq: 0, attackSeq: 0, psrSeq: 0, phaseSeq: 0, dataVersion: bundle.version,
    setup, board, sides, turn: 0, phase: 'deployment', step: 'deployment.place', damageWindow: 'immediate', initiative: null, selection: null,
    units, unitOrder, declarations: [], resolveIndex: 0, current: null,
    ledger: { phase: 'deployment', damage: {}, damage20: [], pilotHit: [], immobileAtStart: [], displacements: [] },
    psr: { queue: [], history: {} }, heatLedger: {}, choices: { los: {}, direction: {} }, resume: null, result: null,
    pending: undefined as unknown as PendingDecision, log: [],
  }
  const events: GameEvent[] = [{ type: 'GameStarted', missionId: setup.missionId, mapId: setup.mapId, seed }]
  const placing = placementQueue(base).length > 0
  let state: GameState = base
  if (!placing) state = { ...base, turn: 1, phase: 'initiative', step: 'initiative.roll', ledger: { ...base.ledger, phase: 'initiative' } }
  state = { ...state, ...withDecision(state, bundle) }
  return { state, events }
}

// ---------- deployment helpers ----------
/** Units still to place for `player` (edgePlace / hexes sides only). */
export function toPlace(state: GameState, player: PlayerId): UnitId[] {
  if (state.sides[player].deployment === 'edgeEntry') return []
  return state.unitOrder.filter((id) => state.units[id]!.owner === player && state.units[id]!.status === 'offBoard' && state.units[id]!.pos === null)
}
/** Alternating placement order: A first, one unit each, a side with none left is skipped (00 5.1). */
export function placementQueue(state: GameState): PlayerId[] {
  const a = toPlace(state, 'A'), b = toPlace(state, 'B')
  const out: PlayerId[] = []
  for (let i = 0; i < Math.max(a.length, b.length); i++) { if (i < a.length) out.push('A'); if (i < b.length) out.push('B') }
  return out
}

/** Legal hexes for a placing side (11 4.2, 4.3), empty ones only. */
export function placementZone(state: GameState, player: PlayerId, data?: DataBundle): Hex[] {
  const d = data ?? bundleFor(state)
  const mission = d.missions[state.setup.missionId] as Mission
  const ms = mission.sides.find((s) => s.id === state.sides[player].sideId)!
  const dep = ms.deployment
  const taken = new Set(Object.values(state.units).filter((u) => u.pos).map((u) => `${u.pos!.q},${u.pos!.r}`))
  let zone: Hex[] = []
  if (dep.mode === 'hexes') zone = dep.hexes.map((l) => labelToHex(l)).filter((h): h is Hex => h !== null)
  else if (dep.mode === 'edgePlace') {
    const edge = state.sides[player].homeEdge
    zone = Object.values(state.board.hexes).map((h) => h.hex).filter((h) => {
      const { col, row } = hexToOffset(h)
      return edge === 'north' ? row < dep.depth : edge === 'south' ? row >= state.board.rows - dep.depth : edge === 'west' ? col < dep.depth : col >= state.board.cols - dep.depth
    })
  }
  return zone.filter((h) => !taken.has(`${h.q},${h.r}`))
}

/** The next decision at setup time: a deploy for the next placing side, else a placeholder initiativeAck for the Initiative Phase owner to replace. */
export function withDecision(state: GameState, data?: DataBundle): Pick<GameState, 'pending' | 'decisionSeq'> {
  const id = `d:${state.decisionSeq + 1}`
  const next = placementQueue(state)[0]
  const pending: PendingDecision = next
    ? { id, player: next, kind: 'deploy', phase: 'deployment', step: 'deployment.place', unitId: null, canPass: false,
        context: { phase: 'deployment', eligible: toPlace(state, next), zone: placementZone(state, next, data) } }
    : { id, player: 'A', kind: 'initiativeAck', phase: 'initiative', step: 'initiative.roll', unitId: null, canPass: false, context: { phase: 'initiative' } }
  return { pending, decisionSeq: state.decisionSeq + 1 }
}
