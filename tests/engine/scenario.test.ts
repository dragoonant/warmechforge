import { describe, expect, it } from 'vitest'
import { loadBundle } from '../../src/data'
import type { Force } from '../../src/data'
import { createInitialState, isProblems, placementQueue } from '../../src/engine/scenario'
import type { GameSetup, GameState } from '../../src/engine/types'

const bundle = loadBundle()
const setupFor = (missionId: string, over: Partial<GameSetup> = {}): GameSetup => {
  const m = bundle.missions[missionId]!
  const sides = m.sides.map((s) => ({ sideId: s.id, control: 'ai' as const, force: bundle.forces[s.force as string]! as Force }))
  return { missionId, mapId: m.map === 'choose' ? 'map.test-canyons' : m.map, sides, forcedWithdrawal: false, turnLimit: null, bvBudget: null, ...over } as unknown as GameSetup
}
const ok = (setup: GameSetup): GameState => {
  const r = createInitialState(setup, 'seed', bundle)
  if (isProblems(r)) throw new Error(r.problems.join('; '))
  return r.state
}

describe('scenario setup (11 sections 1 and 4)', () => {
  it('SCN-001 an edge-entry mission starts turn 1 with every unit off board, heat 0, full armor and ammo', () => {
    const s = ok(setupFor('mission.intro'))
    expect(s).toMatchObject({ turn: 1, phase: 'initiative', step: 'initiative.roll' })
    expect(s.unitOrder).toEqual(['A1', 'A2', 'B1', 'B2'])
    for (const id of s.unitOrder) expect(s.units[id]).toMatchObject({ status: 'offBoard', pos: null, heat: 0, crippled: false })
    expect(s.sides.A).toMatchObject({ homeEdge: 'south', deployment: 'edgeEntry' })
    const eris = s.units.A1!
    expect(eris.locs.CT.armor).toBe(23)
    expect(eris.locs.CT.structure).toBe(16) // 50-ton centre torso
    expect(Object.values(eris.bins).map((b) => b.shots)).toEqual([Object.values(eris.bins)[0]!.capacity, Object.values(eris.bins)[1]!.capacity])
    expect(Object.keys(s.board.hexes)).toHaveLength(16 * 17)
    expect(s.pending.kind).toBe('initiativeAck')
  })

  it('SCN-001 a placing side (edgePlace) opens a deployment with a deploy decision limited to its zone', () => {
    const base = setupFor('mission.intro')
    const mission = bundle.missions['mission.intro']!
    const patched = { ...bundle, missions: { ...bundle.missions, 'mission.intro': { ...mission, sides: mission.sides.map((m) => ({ ...m, deployment: { mode: 'edgePlace', depth: 2 } })) } } }
    const r = createInitialState(base, 'seed', patched as unknown as typeof bundle)
    if (isProblems(r)) throw new Error('unexpected')
    expect(r.state).toMatchObject({ turn: 0, phase: 'deployment' })
    expect(r.state.pending).toMatchObject({ kind: 'deploy', player: 'A' })
    expect(r.state.pending.context.zone).toHaveLength(2 * 16) // two southern rows
    expect(placementQueue(r.state)).toEqual(['A', 'B', 'A', 'B'])
  })

  it('SCN-004 half loads: shots are floor(per ton / 2) for listed bins when the mission allows them', () => {
    const m = bundle.missions['mission.intro']!
    const force = bundle.forces['force.intro-a']!
    const binId = Object.keys(bundle.mechs[force.units[0]!.mech]!.ammoBins.reduce((o, b) => ({ ...o, [b.id]: 1 }), {}))[0]!
    const halfForce = { ...force, units: force.units.map((u, i) => (i === 0 ? { ...u, halfLoad: [binId] } : u)) }
    const patched = { ...bundle, missions: { ...bundle.missions, 'mission.intro': { ...m, options: { ...m.options, halfLoads: true } } } }
    const setup = setupFor('mission.intro')
    setup.sides[0]!.force = halfForce as never
    const r = createInitialState(setup, 's', patched as unknown as typeof bundle)
    if (isProblems(r)) throw new Error('unexpected')
    const full = ok(setupFor('mission.intro')).units.A1!.bins[binId]!
    expect(r.state.units.A1!.bins[binId]!.shots).toBe(Math.floor(full.capacity / 2))
  })

  it('SCN-001 bad setups come back as problems, never thrown: unknown mission, same-edge sides, over budget', () => {
    expect(createInitialState({ ...setupFor('mission.intro'), missionId: 'mission.nope' }, 's', bundle)).toMatchObject({ problems: [expect.stringContaining('unknown mission')] })
    const over = createInitialState(setupFor('mission.intro', { bvBudget: 1000 }), 's', bundle)
    expect(isProblems(over) && over.problems.some((p) => p.includes('over the budget'))).toBe(true)
  })

  it('SCN-001 the same setup and seed give the same state', () => {
    expect(ok(setupFor('mission.intro'))).toEqual(ok(setupFor('mission.intro')))
  })
})
