// Golden-example harness (13-golden §1-2): fixture 'Mechs, a clear 16 x 17 test sheet with overrides, placed deployment,
// and a small driver that answers decisions by unit. Import AFTER the test file's vi.mock of rng (vi.mock is hoisted).
import { expect } from 'vitest'
import { loadBundle } from '../../src/data/index'
import type { GameMap, MapHex, Mech, Mission } from '../../src/data/index'
import type { Action } from '../../src/engine/actions'
import type { DiceRolled, GameEvent } from '../../src/engine/events'
import { createGame, step } from '../../src/engine/index'
import { hexToLabel } from '../../src/engine/hex'
import type { DataBundle, DataRecord, Facing, GameSetup, GameState, Hex, Loc, PendingDecision, UnitState } from '../../src/engine/types'

// ---------- fixture data ----------
const rec = (r: Record<string, unknown> & { id: string }): DataRecord => r as unknown as DataRecord
/** Test-only weapons the release data lacks (standard numbers, 13-golden §2). */
const TEST_WEAPONS: DataRecord[] = [
  rec({ id: 'test.w.large-laser', name: 'Large Laser', category: 'energy', heat: 8, damage: 8, ranges: { short: 5, medium: 10, long: 15 }, slots: 2, tons: 5, flags: ['energy', 'directFire'] }),
  rec({ id: 'test.w.lrm-15', name: 'LRM 15', category: 'missile', heat: 5, damage: 1, cluster: { rackSize: 15, groupSize: 5 }, ranges: { min: 6, short: 7, medium: 14, long: 21 }, slots: 3, tons: 7, ammo: ['test.ammo.lrm-15'], flags: ['cluster', 'missile', 'indirect'] }),
  rec({ id: 'test.w.lrm-20', name: 'LRM 20', category: 'missile', heat: 6, damage: 1, cluster: { rackSize: 20, groupSize: 5 }, ranges: { min: 6, short: 7, medium: 14, long: 21 }, slots: 5, tons: 10, ammo: ['test.ammo.lrm-20'], flags: ['cluster', 'missile', 'indirect'] }),
]
const TEST_AMMO: DataRecord[] = [
  rec({ id: 'test.ammo.lrm-15', name: 'LRM 15 Ammo', weapons: ['test.w.lrm-15'], shotsPerTon: 8, explosionPerShot: 15 }),
  rec({ id: 'test.ammo.lrm-20', name: 'LRM 20 Ammo', weapons: ['test.w.lrm-20'], shotsPerTon: 6, explosionPerShot: 20 }),
]
const SLOTS: Record<string, number> = {
  'is.w.medium-laser': 1, 'is.w.ppc': 3, 'is.w.srm-6': 2, 'is.w.lrm-10': 2, 'is.w.machine-gun': 1,
  'test.w.large-laser': 2, 'test.w.lrm-15': 3, 'test.w.lrm-20': 5,
}

export interface FSpec {
  id: string
  tons: number
  walk: number
  jump?: number
  sinks: number
  double?: boolean
  xl?: boolean
  armor?: Partial<Record<Loc, number>>
  rear?: Partial<Record<'CT' | 'LT' | 'RT', number>>
  weapons?: { id: string; item: string; loc: Loc }[]
  bins?: { id: string; ammo: string; loc: Loc }[]
  crits?: Partial<Record<Loc, string[]>>
  pilot?: { gunnery: number; piloting: number }
}
const ARMOR: Record<Loc, number> = { HD: 9, CT: 20, LT: 15, RT: 15, LA: 12, RA: 12, LL: 15, RL: 15 }
const REAR = { CT: 6, LT: 4, RT: 4 }
const BASE_SLOTS: Record<Loc, string[]> = {
  HD: ['lifeSupport', 'sensors', 'cockpit', 'empty', 'sensors', 'lifeSupport'],
  CT: ['engine', 'engine', 'engine', 'gyro', 'gyro', 'gyro', 'gyro', 'engine', 'engine', 'engine'],
  LT: [], RT: [],
  LA: ['shoulder', 'upperArm', 'lowerArm', 'hand'], RA: ['shoulder', 'upperArm', 'lowerArm', 'hand'],
  LL: ['hip', 'upperLeg', 'lowerLeg', 'foot'], RL: ['hip', 'upperLeg', 'lowerLeg', 'foot'],
}
export function fixtureMech(f: FSpec): Mech {
  const crits = {} as Record<Loc, string[]>
  for (const l of Object.keys(BASE_SLOTS) as Loc[]) {
    const size = l === 'HD' || l === 'LL' || l === 'RL' ? 6 : 12
    let list: string[]
    if (f.crits?.[l]) list = [...f.crits[l]!]
    else {
      list = [...BASE_SLOTS[l]]
      if ((l === 'LT' || l === 'RT') && f.xl) list.unshift('engine', 'engine', 'engine')
      for (const w of f.weapons ?? []) if (w.loc === l) for (let i = 0; i < (SLOTS[w.item] ?? 1); i++) list.push(`#${w.id}`)
      for (const b of f.bins ?? []) if (b.loc === l) list.push(`#${b.id}`)
    }
    while (list.length < size) list.push('empty')
    crits[l] = list
  }
  return {
    id: `mech.test.${f.id}`, chassis: f.id, model: 'TEST', tonnage: f.tons, techBase: 'IS',
    engine: { type: f.xl ? 'xl' : 'standard', rating: f.tons * f.walk },
    movement: { walk: f.walk, run: Math.ceil(f.walk * 1.5), jump: f.jump ?? 0 },
    heatSinks: { count: f.sinks, type: f.double ? 'double' : 'single' },
    structure: { type: 'standard' },
    armor: { type: 'standard', front: { ...ARMOR, ...f.armor }, rear: { ...REAR, ...f.rear } },
    crits, mounts: (f.weapons ?? []).map((w) => ({ id: w.id, item: w.item, location: w.loc })),
    ammoBins: (f.bins ?? []).map((b) => ({ id: b.id, ammo: b.ammo, location: b.loc })),
    bv: 1000, source: { ref: 'ours', note: 'golden fixture' },
  } as unknown as Mech
}

/** The fixture 'Mechs of 13-golden §2. */
export const F = {
  WVR: { id: 'F-WVR', tons: 55, walk: 5, jump: 5, sinks: 12, armor: { CT: 23 }, weapons: [{ id: 'ml-ra', item: 'is.w.medium-laser', loc: 'RA' }, { id: 'srm-rt', item: 'is.w.srm-6', loc: 'RT' }], bins: [{ id: 'srm-ammo', ammo: 'is.ammo.srm-6', loc: 'LT' }] },
  GRF: { id: 'F-GRF', tons: 55, walk: 5, jump: 5, sinks: 12, weapons: [{ id: 'ppc-ra', item: 'is.w.ppc', loc: 'RA' }, { id: 'lrm-rt', item: 'is.w.lrm-10', loc: 'RT' }], bins: [{ id: 'lrm-ammo', ammo: 'is.ammo.lrm-10', loc: 'RT' }], pilot: { gunnery: 3, piloting: 4 } },
  TDR: { id: 'F-TDR', tons: 65, walk: 4, sinks: 15, armor: { CT: 30 }, weapons: [{ id: 'ml-ra', item: 'is.w.medium-laser', loc: 'RA' }], pilot: { gunnery: 4, piloting: 4 } },
  CPLT20: { id: 'F-CPLT20', tons: 65, walk: 4, jump: 4, sinks: 15, weapons: [{ id: 'lrm-rt', item: 'test.w.lrm-20', loc: 'RT' }], bins: [{ id: 'lrm-ammo', ammo: 'test.ammo.lrm-20', loc: 'RT' }] },
  CPLT: {
    id: 'F-CPLT', tons: 65, walk: 4, jump: 4, sinks: 15, armor: { CT: 30 },
    weapons: [{ id: 'lrm-la', item: 'test.w.lrm-15', loc: 'LA' }, { id: 'lrm-ra', item: 'test.w.lrm-15', loc: 'RA' }], bins: [{ id: 'lrm-ammo', ammo: 'test.ammo.lrm-15', loc: 'LT' }],
    crits: { LA: ['shoulder', 'upperArm', '#lrm-la', '#lrm-la', '#lrm-la'], RA: ['shoulder', 'upperArm', '#lrm-ra', '#lrm-ra', '#lrm-ra'] },
  },
  TGT45: {
    id: 'F-TGT45', tons: 45, walk: 4, sinks: 10, armor: { HD: 9, CT: 20, LT: 14, RT: 14, LA: 12, RA: 12, LL: 16, RL: 16 }, rear: { CT: 6, LT: 4, RT: 4 },
    weapons: [{ id: 'ml-ct', item: 'is.w.medium-laser', loc: 'CT' }],
  },
  GHR: {
    id: 'F-GHR', tons: 70, walk: 4, jump: 4, sinks: 22, armor: { LA: 22, LT: 20 }, weapons: [{ id: 'ml-la', item: 'is.w.medium-laser', loc: 'LA' }],
  },
  SHOOTX: { id: 'F-SHOOT-X', tons: 65, walk: 4, sinks: 20, weapons: [{ id: 'ppc-ra', item: 'is.w.ppc', loc: 'RA' }, { id: 'll-la', item: 'test.w.large-laser', loc: 'LA' }] },
  SHOOTY: { id: 'F-SHOOT-Y', tons: 60, walk: 4, sinks: 15, weapons: [{ id: 'lrm-lt', item: 'is.w.lrm-10', loc: 'LT' }, { id: 'ppc-ra', item: 'is.w.ppc', loc: 'RA' }], bins: [{ id: 'lrm-ammo', ammo: 'is.ammo.lrm-10', loc: 'LT' }] },
  AWS: { id: 'F-AWS', tons: 80, walk: 3, sinks: 26, weapons: [{ id: 'ppc-la', item: 'is.w.ppc', loc: 'LA' }, { id: 'ppc-rt', item: 'is.w.ppc', loc: 'RT' }, { id: 'ppc-ra', item: 'is.w.ppc', loc: 'RA' }] },
  BLR: {
    id: 'F-BLR', tons: 85, walk: 4, sinks: 18, armor: { CT: 30, LT: 20 }, rear: { CT: 10, LT: 8 },
    weapons: [{ id: 'ml1', item: 'is.w.medium-laser', loc: 'RT' }, { id: 'ml2', item: 'is.w.medium-laser', loc: 'RT' }, { id: 'ml3', item: 'is.w.medium-laser', loc: 'RT' }],
  },
  ML2: { id: 'F-ML2', tons: 50, walk: 5, sinks: 10, weapons: [{ id: 'ml-la', item: 'is.w.medium-laser', loc: 'LA' }, { id: 'ml-ra', item: 'is.w.medium-laser', loc: 'RA' }] },
  UZL: {
    id: 'F-UZL', tons: 50, walk: 6, jump: 6, sinks: 10, double: true, xl: true,
    weapons: [
      { id: 'ppc-la', item: 'is.w.ppc', loc: 'LA' }, { id: 'ppc-ra', item: 'is.w.ppc', loc: 'RA' }, { id: 'mg-lt', item: 'is.w.machine-gun', loc: 'LT' },
      { id: 'mg-rt', item: 'is.w.machine-gun', loc: 'RT' }, { id: 'srm-ct', item: 'is.w.srm-6', loc: 'CT' },
    ],
    bins: [{ id: 'srm-ammo', ammo: 'is.ammo.srm-6', loc: 'LT' }, { id: 'mg-ammo', ammo: 'is.ammo.machine-gun', loc: 'RT' }],
  },
  DUMMY: { id: 'F-DUMMY', tons: 50, walk: 5, sinks: 10, weapons: [{ id: 'ml-ct', item: 'is.w.medium-laser', loc: 'CT' }] },
} satisfies Record<string, FSpec>

// ---------- the game ----------
export interface GUnit { side: 'A' | 'B'; mech: FSpec; at: Hex; facing: Facing }
export interface GoldenOpts { units: GUnit[]; overrides?: Record<string, MapHex>; patch?: (s: GameState) => GameState }

const BOARD = { cols: 16, rows: 17 }
export const label = (h: Hex): string => hexToLabel(BOARD, h)!

let bundles = 0
function goldenBundle(id: string, o: GoldenOpts): { bundle: DataBundle; setup: GameSetup } {
  const base = loadBundle()
  const mechs: Record<string, DataRecord> = {}
  for (const u of o.units) { const m = fixtureMech(u.mech); mechs[m.id] = m as unknown as DataRecord }
  const map = { id: `map.golden.${id}`, name: 'golden sheet', theme: 'grasslands', width: 16, height: 17, defaultLevel: 0, hexes: o.overrides ?? {}, source: { ref: 'ours' } } as unknown as GameMap
  const hexesOf = (side: 'A' | 'B'): string[] => o.units.filter((u) => u.side === side).map((u) => label(u.at))
  const mission = {
    id: `mission.golden.${id}`, name: 'golden', kind: 'skirmish', map: map.id,
    sides: [
      { id: 'a', label: 'a', force: 'pick', homeEdge: 'south', deployment: { mode: 'hexes', hexes: hexesOf('A') } },
      { id: 'b', label: 'b', force: 'pick', homeEdge: 'north', deployment: { mode: 'hexes', hexes: hexesOf('B') } },
    ],
    victory: [{ type: 'eliminate' }], options: { forcedWithdrawal: 'off' }, source: { ref: 'ours' },
  } as unknown as Mission
  const extra: DataRecord[] = [...TEST_WEAPONS, ...TEST_AMMO, ...Object.values(mechs), map as unknown as DataRecord, mission as unknown as DataRecord]
  const byId = { ...base.byId }
  for (const r of extra) byId[r.id] = r
  const bundle: DataBundle = {
    ...base, version: `golden-${id}-${++bundles}`, byId,
    weapons: { ...base.weapons, ...Object.fromEntries(TEST_WEAPONS.map((w) => [w.id, w])) },
    ammo: { ...base.ammo, ...Object.fromEntries(TEST_AMMO.map((a) => [a.id, a])) },
    mechs: { ...base.mechs, ...mechs }, maps: { ...base.maps, [map.id]: map as unknown as DataRecord },
    missions: { ...base.missions, [mission.id]: mission as unknown as DataRecord },
  }
  const force = (side: 'A' | 'B') => ({
    id: `force.golden.${side}`, name: side,
    units: o.units.filter((u) => u.side === side).map((u) => ({ mech: `mech.test.${u.mech.id}`, skills: u.mech.pilot ?? { gunnery: 4, piloting: 5 }, name: u.mech.id })),
  })
  const setup: GameSetup = {
    missionId: mission.id, mapId: map.id,
    sides: [{ sideId: 'a', control: 'human', force: force('A') }, { sideId: 'b', control: 'ai', force: force('B') }],
    forcedWithdrawal: false, turnLimit: null, bvBudget: null,
  }
  return { bundle, setup }
}

/** A running golden game: answers decisions by unit name and records every event. */
export class Golden {
  s: GameState
  ev: GameEvent[] = []
  ids: Record<string, string> = {}
  constructor(id: string, o: GoldenOpts) {
    const { bundle, setup } = goldenBundle(id, o)
    const r = createGame(setup, `golden-${id}`, bundle)
    if (r.rejection) throw new Error(r.rejection.message)
    this.s = r.state
    this.ev.push(...r.events)
    for (const uid of this.s.unitOrder) this.ids[this.s.units[uid]!.name] = uid
    const placed = new Set<string>()
    while (this.s.pending.kind === 'deploy') {
      const p = this.s.pending
      const g = o.units.find((u) => u.side === p.player && !placed.has(u.mech.id))!
      placed.add(g.mech.id)
      this.act({ type: 'deploy', unitId: this.ids[g.mech.id]!, hex: g.at, facing: g.facing })
    }
    if (o.patch) this.s = o.patch(this.s)
  }
  id(name: string): string { const x = this.ids[name]; if (!x) throw new Error(`no unit ${name}`); return x }
  u(name: string): UnitState { return this.s.units[this.id(name)]! }
  get p(): PendingDecision { return this.s.pending }
  /** Answers the open decision; fills decisionId and player. */
  act(a: Record<string, unknown>): this {
    const action = { ...a, decisionId: this.s.pending.id, player: this.s.pending.player } as unknown as Action
    const r = step(this.s, action)
    if (r.rejection) throw new Error(`${a.type} rejected at ${this.s.pending.kind}: ${r.rejection.code} ${r.rejection.message}`)
    this.s = r.state
    this.ev.push(...r.events)
    return this
  }
  ack(): this { expect(this.p.kind).toBe('initiativeAck'); return this.act({ type: 'ack' }) }
  /** Selects the unit if a selectUnit decision is open (one candidate is auto-resolved by the engine). */
  select(name: string): this {
    if (this.p.kind === 'selectUnit') this.act({ type: 'selectUnit', unitId: this.id(name) })
    expect(this.p.unitId).toBe(this.id(name))
    return this
  }
  move(name: string, m: Record<string, unknown>): this {
    this.select(name)
    return this.act({ type: 'move', unitId: this.id(name), ...m })
  }
  standStill(name: string): this { return this.move(name, { mode: 'standStill', steps: [], facing: this.u(name).facing }) }
  forward(n: number): { op: 'forward' }[] { return Array.from({ length: n }, () => ({ op: 'forward' as const })) }
  /** Ranged: keep the torso forward, then declare `shots` (empty = hold). Skips decisions the engine auto-resolved. */
  fire(name: string, shots: { mountId: string; target: string }[] = []): this {
    if (this.p.kind === 'selectUnit' || this.p.unitId !== this.id(name)) {
      if (this.p.kind === 'selectUnit' && (this.p.context.eligible ?? []).includes(this.id(name))) this.act({ type: 'selectUnit', unitId: this.id(name) })
    }
    if (this.p.kind === 'torsoTwist' && this.p.unitId === this.id(name)) this.act({ type: 'torsoTwist', unitId: this.id(name), twist: 0, flip: false })
    if (this.p.kind === 'declareFire' && this.p.unitId === this.id(name)) {
      this.act({ type: 'declareFire', unitId: this.id(name), shots: shots.map((x) => ({ mountId: x.mountId, targetId: this.id(x.target) })) })
    } else if (shots.length > 0) throw new Error(`${name} has no declareFire decision (pending ${this.p.kind} ${this.p.unitId})`)
    return this
  }
  physical(name: string, attack: Record<string, unknown> = { kind: 'none' }): this {
    if (this.p.kind === 'selectUnit' && (this.p.context.eligible ?? []).includes(this.id(name))) this.act({ type: 'selectUnit', unitId: this.id(name) })
    if (this.p.kind === 'torsoTwist' && this.p.unitId === this.id(name)) this.act({ type: 'torsoTwist', unitId: this.id(name), twist: 0, flip: false })
    if (this.p.kind === 'declarePhysical' && this.p.unitId === this.id(name)) this.act({ type: 'declarePhysical', unitId: this.id(name), attack })
    else if (attack.kind !== 'none') throw new Error(`${name} has no declarePhysical decision (pending ${this.p.kind} ${this.p.unitId})`)
    return this
  }
  dice(): { purpose: string; dice: number[] }[] {
    return this.ev.filter((e): e is DiceRolled => e.type === 'DiceRolled').map((e) => ({ purpose: e.purpose, dice: e.dice }))
  }
  events<T extends GameEvent['type']>(type: T): Extract<GameEvent, { type: T }>[] {
    return this.ev.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[]
  }
}
