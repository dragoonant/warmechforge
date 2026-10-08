// Skirmish any-vs-any picker (M5): picks, BV totals, Even BV and the engine setup they build.
import { describe, expect, it } from 'vitest'
import {
  addPick, buildStartOptions, catalogue, defaultForm, evenBv, evenSide, mapChoices, mapLabel, mechOf, pickBv, removePick, setChassis, setPick,
  sideTotal, variantLabel, withMission, MAX_PICKS,
} from '../../src/client/ui/start/startOptions'
import { buildSetup, bundle } from '../../src/client/store/setup'
import { createGame } from '../../src/engine/index'

const cat = catalogue()
const skirmish = () => withMission(defaultForm(cat), cat, 'mission.skirmish')

describe('skirmish picker model', () => {
  it('offers every data Mech grouped by chassis, variants labelled "(stock)" where they are stand-ins', () => {
    expect(cat.mechs.length).toBe(Object.keys(bundle().mechs).length)
    expect(cat.chassis.map((c) => c.chassis)).toEqual(expect.arrayContaining(['Mad Cat Mk II', 'Regent', 'Vulture Mk IV', 'Hollander', 'Eris', 'Uziel', 'Solitaire', 'Rakshasa']))
    for (const g of cat.chassis) for (const v of g.variants) expect(v.chassis).toBe(g.chassis)
    const raks = cat.chassis.find((c) => c.chassis === 'Rakshasa')!.variants.find((v) => v.model === 'MDG-1B')!
    expect(variantLabel(raks)).toBe('MDG-1B (stock)')
    const regentA = mechOf(cat, 'mech.regent.a')!
    expect(variantLabel(regentA)).toBe('A')
  })

  it('defaults to Regent Lance vs Mad Cat Lance at 4/5; maps: the four Core Box maps first, then the dev map', () => {
    const f = skirmish()
    expect(f.picks[0].map((p) => p.mech)).toEqual(['mech.regent.prime', 'mech.rakshasa.mdg-1b', 'mech.eris.ers-2h', 'mech.hollander.bzk-g1'])
    expect(f.picks[1]).toHaveLength(4)
    for (const p of [...f.picks[0], ...f.picks[1]]) expect([p.gunnery, p.piloting]).toEqual([4, 5])
    const maps = mapChoices(cat.missions.find((m) => m.id === 'mission.skirmish'), cat.maps)
    expect(maps.map((m) => m.id)).toEqual(['map.scorched-oasis', 'map.arid-canyons', 'map.headwater-crossing', 'map.sodden-hills', 'map.test-canyons'])
    expect(mapLabel(maps[4]!)).toBe('Test Canyons (dev map)')
    expect(sideTotal(cat, f.picks[0]).bv).toBe(6732)
  })

  it('pilot skills change the adjusted BV; add, remove and chassis switches keep 1-4 picks', () => {
    let f = skirmish()
    const base = pickBv(cat, f.picks[0][0]!)
    f = setPick(f, 'A', 0, { gunnery: 3, piloting: 4 })
    expect(pickBv(cat, f.picks[0][0]!)).toBeGreaterThan(base)
    expect(addPick(f, cat, 'A').picks[0]).toHaveLength(MAX_PICKS) // already 4
    for (let i = 0; i < 5; i++) f = removePick(f, 'A', 0)
    expect(f.picks[0]).toHaveLength(1)
    f = setChassis(f, cat, 'A', 0, 'Mad Cat Mk II')
    expect(mechOf(cat, f.picks[0][0]!.mech)!.chassis).toBe('Mad Cat Mk II')
    f = addPick(f, cat, 'A')
    expect(f.picks[0]).toHaveLength(2)
  })

  it('Even BV moves the bot side\'s pilot skills until its BV is as close as it gets', () => {
    let f = skirmish()
    f = { ...f, picks: [[{ mech: 'mech.regent.a', gunnery: 4, piloting: 5 }], [{ mech: 'mech.hollander.bzk-f3', gunnery: 4, piloting: 5 }, { mech: 'mech.hollander.bzk-g1', gunnery: 4, piloting: 5 }]] }
    expect(evenSide(f)).toBe('B')
    const before = Math.abs(sideTotal(cat, f.picks[0]).bv - sideTotal(cat, f.picks[1]).bv)
    const e = evenBv(f, cat)
    const after = Math.abs(sideTotal(cat, e.picks[0]).bv - sideTotal(cat, e.picks[1]).bv)
    expect(after).toBeLessThan(before)
    expect(e.picks[0]).toEqual(f.picks[0])
    expect(e.picks[1].map((p) => p.mech)).toEqual(f.picks[1].map((p) => p.mech))
    for (const p of e.picks[1]) { expect(p.gunnery).toBeGreaterThanOrEqual(2); expect(p.piloting).toBeLessThanOrEqual(7) }
  })

  it('builds lineups that the engine accepts with no BV budget; repeated variants are numbered', () => {
    let f = skirmish()
    f = { ...f, map: 'map.scorched-oasis', picks: [[...f.picks[0]], [{ mech: 'mech.regent.a', gunnery: 3, piloting: 4 }, { mech: 'mech.regent.a', gunnery: 4, piloting: 5 }, { mech: 'mech.mad-cat-mk-ii.base', gunnery: 4, piloting: 5 }]] }
    const o = buildStartOptions(f, cat)
    expect(o.forces).toBeUndefined()
    expect(o.lineups![1].units).toHaveLength(3)
    const setup = buildSetup(o, { A: 'human', B: 'bot' })
    expect(setup.bvBudget).toBeNull()
    expect(setup.mapId).toBe('map.scorched-oasis')
    expect(setup.sides[1].force.units.map((u) => u.name)).toEqual(['Regent A 1', 'Regent A 2', `Mad Cat Mk II ${bundle().mechs['mech.mad-cat-mk-ii.base']!.model}`])
    expect(setup.sides[1].force.units[0]!.skills).toEqual({ gunnery: 3, piloting: 4 })
    const r = createGame(setup, 'pick', bundle())
    expect(r.rejection).toBeUndefined()
    expect(r.state.units.B1!.pilot.gunnery).toBe(3)
    expect(Object.keys(r.state.units)).toHaveLength(7)
    // the intro mission still sends its fixed forces
    expect(buildStartOptions(defaultForm(cat), cat).forces).toEqual(['force.intro-a', 'force.intro-b'])
  })
})
