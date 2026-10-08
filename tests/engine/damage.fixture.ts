// Shared fixture for the damage-pipeline tests: a minimal GameState, standard-layout 'Mechs and a tiny data bundle.
import type { DataBundle, DataRecord, GameState, Loc, LocalId, LocState, SlotState, UnitState } from '../../src/engine/types'
import { LOCS } from '../../src/engine/types'
import { seedRng } from '../../src/engine/rng'

const ARMOR: Record<Loc, number> = { HD: 9, CT: 20, LT: 14, RT: 14, LA: 10, RA: 10, LL: 14, RL: 14 }
const REAR: Partial<Record<Loc, number>> = { CT: 8, LT: 6, RT: 6 }
const STRUCT: Record<Loc, number> = { HD: 3, CT: 16, LT: 12, RT: 12, LA: 8, RA: 8, LL: 12, RL: 12 }

function defaultSlots(loc: Loc): string[] {
  const empty = (n: number): string[] => Array<string>(n).fill('empty')
  switch (loc) {
    case 'HD': return ['lifeSupport', 'sensors', 'cockpit', 'empty', 'sensors', 'lifeSupport']
    case 'CT': return ['engine', 'engine', 'engine', 'gyro', 'gyro', 'gyro', 'gyro', 'engine', 'engine', 'engine', 'empty', 'empty']
    case 'LT': case 'RT': return empty(12)
    case 'LA': case 'RA': return ['shoulder', 'upperArm', 'lowerArm', 'hand', ...empty(8)]
    default: return ['hip', 'upperLeg', 'lowerLeg', 'foot', 'empty', 'empty']
  }
}

export interface UnitOpts {
  armor?: Partial<Record<Loc, number>>
  rear?: Partial<Record<'CT' | 'LT' | 'RT', number>>
  structure?: Partial<Record<Loc, number>>
  slots?: Partial<Record<Loc, string[]>> // padded with 'empty' to the location size
  mounts?: { id: LocalId; item: string; location: Loc }[]
  bins?: { id: LocalId; ammo: string; location: Loc; shots: number }[]
  tonnage?: number
  prone?: boolean
}

export function mkUnit(id: string, owner: 'A' | 'B', o: UnitOpts = {}): UnitState {
  const locs = {} as Record<Loc, LocState>
  const slots = {} as Record<Loc, SlotState[]>
  for (const l of LOCS) {
    const armor = o.armor?.[l] ?? ARMOR[l]
    const hasRear = l === 'CT' || l === 'LT' || l === 'RT'
    const rear = hasRear ? (o.rear?.[l as 'CT'] ?? REAR[l]!) : null
    const structure = o.structure?.[l] ?? STRUCT[l]
    locs[l] = { armor, rear, structure, maxArmor: armor, maxRear: rear, maxStructure: structure, destroyed: false, destroyedCause: null }
    const size = l === 'HD' || l === 'LL' || l === 'RL' ? 6 : 12
    const tokens = [...(o.slots?.[l] ?? defaultSlots(l))]
    while (tokens.length < size) tokens.push('empty')
    slots[l] = tokens.map((token) => ({ token, hit: false, hitPhase: null }))
  }
  const mounts: UnitState['mounts'] = {}
  for (const m of o.mounts ?? []) {
    mounts[m.id] = { id: m.id, item: m.item, location: m.location, split: null, rear: false, linkedTo: null, critHits: 0, destroyed: false, jammed: false, firedTurn: null }
  }
  const bins: UnitState['bins'] = {}
  for (const b of o.bins ?? []) bins[b.id] = { id: b.id, ammo: b.ammo, location: b.location, shots: b.shots, capacity: b.shots, exploded: false }
  return {
    id, owner, mechId: 'mech.test', name: id, tonnage: o.tonnage ?? 50, baseMp: { walk: 4, run: 6, jump: 0 }, sinks: { count: 10, type: 'single' },
    status: 'active', crippled: false, pos: { q: 0, r: 0 }, facing: 0, prone: o.prone ?? false, shutdown: null, heat: 0,
    pilot: { pilotId: null, name: id, gunnery: 4, piloting: 5, hits: 0, conscious: true, dead: false, koTurn: null, spas: [] },
    locs, slots, mounts, bins,
    move: { mode: 'walk', startHex: null, startFacing: 0, hexesMoved: 0, jumped: false, mpSpent: 0, tmm: 0, attackerMod: 1, done: true, entered: false, standAttempts: 0, fell: false, ranHexes: 0 },
    attacks: { twist: 0, flipped: false, twistPhase: null, rangedDeclared: false, physicalDeclared: false, primaryTargetId: null, propArm: null, firedMounts: [], charge: null, dfa: null },
    doomed: null, destroyedCause: null, escalating: {},
  }
}

export function mkState(units: UnitState[] = [mkUnit('A1', 'A'), mkUnit('B1', 'B')]): GameState {
  const byId: Record<string, UnitState> = {}
  for (const u of units) byId[u.id] = u
  return {
    format: 1, seed: 'test', rng: seedRng('test'), rollSeq: 0, decisionSeq: 0, attackSeq: 0, psrSeq: 0, phaseSeq: 5, dataVersion: 'test',
    turn: 1, phase: 'rangedAttack', step: 'ranged.resolve', damageWindow: 'immediate', initiative: null, selection: null,
    units: byId, unitOrder: units.map((u) => u.id), declarations: [], resolveIndex: 0, current: null,
    ledger: { phase: 'rangedAttack', damage: {}, damage20: [], pilotHit: [], immobileAtStart: [], displacements: [] },
    psr: { queue: [], history: {} }, heatLedger: {}, choices: { los: {}, direction: {} }, resume: null, result: null, log: [],
  } as unknown as GameState
}

const rec = (r: Record<string, unknown> & { id: string }): DataRecord => r as unknown as DataRecord
export const BUNDLE: DataBundle = {
  version: 'test', byId: {},
  weapons: {
    'w.mlaser': rec({ id: 'w.mlaser', name: 'Medium Laser', damage: 5, heat: 3, ranges: { short: 3, medium: 6, long: 9 }, slots: 1, flags: ['energy'] }),
    'w.ppc': rec({ id: 'w.ppc', name: 'PPC', damage: 10, heat: 10, ranges: { short: 6, medium: 12, long: 18, min: 3 }, slots: 3, flags: ['energy', 'ppc'] }),
    'w.ac5': rec({ id: 'w.ac5', name: 'AC/5', damage: 5, heat: 1, ranges: { short: 6, medium: 12, long: 18 }, slots: 4, ammo: ['a.ac5'], flags: ['ac'] }),
    'w.srm6': rec({ id: 'w.srm6', name: 'SRM 6', damage: 2, heat: 4, cluster: { rackSize: 6, groupSize: 1 }, ranges: { short: 3, medium: 6, long: 9 }, slots: 2, ammo: ['a.srm6'], flags: ['cluster', 'missile'] }),
    'w.streak2': rec({ id: 'w.streak2', name: 'Streak SRM 2', damage: 2, heat: 2, cluster: { rackSize: 2, groupSize: 1 }, ranges: { short: 3, medium: 6, long: 9 }, slots: 1, ammo: ['a.srm6'], flags: ['cluster', 'streak', 'missile'] }),
    'w.lrm20': rec({ id: 'w.lrm20', name: 'LRM 20', damage: 1, heat: 6, cluster: { rackSize: 20, groupSize: 5 }, ranges: { short: 7, medium: 14, long: 21, min: 6 }, slots: 5, ammo: ['a.lrm20'], flags: ['cluster', 'missile'] }),
    'w.gauss': rec({ id: 'w.gauss', name: 'Gauss Rifle', damage: 15, heat: 1, ranges: { short: 7, medium: 15, long: 22 }, slots: 7, ammo: ['a.gauss'], flags: ['ballistic', 'explodes'] }),
  },
  ammo: {
    'a.ac5': rec({ id: 'a.ac5', shotsPerTon: 20, explosionPerShot: 5 }),
    'a.srm6': rec({ id: 'a.srm6', shotsPerTon: 15, explosionPerShot: 12 }),
    'a.lrm20': rec({ id: 'a.lrm20', shotsPerTon: 6, explosionPerShot: 20 }),
    'a.mg': rec({ id: 'a.mg', shotsPerTon: 200, explosionPerShot: 2 }),
    'a.gauss': rec({ id: 'a.gauss', shotsPerTon: 8, explodes: false, explosionPerShot: 0 }),
  },
  equipment: {
    'e.case': rec({ id: 'e.case', name: 'CASE', kind: 'case', slots: 1, critEffect: 'none' }),
    'e.caseii': rec({ id: 'e.caseii', name: 'CASE II', kind: 'caseII', slots: 1 }),
    'e.sink': rec({ id: 'e.sink', name: 'Heat Sink', kind: 'heatSink', slots: 1, heatSink: { dissipation: 1 } }),
  },
  mechs: {}, pilots: {}, spas: {}, maps: {}, forces: {}, missions: {}, tables: {},
}

/** Forced-dice mock for vi.mock('../../src/engine/rng'): see the test files. */
export const FORCE_NOTE = 'faces are consumed in roll order; the roll count decides how many are taken'
