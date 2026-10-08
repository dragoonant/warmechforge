import { describe, expect, it } from 'vitest'
import { RAW } from '../../src/data/raw'

type T = { type: string; depth?: number }
const tally = (id: string) => {
  const m = RAW.maps.find((x) => x.id === id)!
  const hs = Object.values(m.hexes!)
  const count = (ty: string) => hs.filter((h) => (h.terrain as T[] | undefined)?.some((t) => t.type === ty)).length
  const levels = [0, 1, 2, 3].map((l) => hs.filter((h) => (h.level ?? 0) === l).length + (l === 0 ? 272 - hs.length : 0))
  return { m, levels, light: count('lightWoods'), heavy: count('heavyWoods'), rough: count('rough'), water: count('water'), road: count('road') }
}

// Expected counts come from the MegaMek board each map was converted from (see the map's source note).
const EXPECT: Record<string, { levels: number[]; light: number; heavy: number; rough: number; water: number; road: number; theme: string }> = {
  'map.headwater-crossing': { levels: [232, 23, 14, 3], light: 11, heavy: 2, rough: 9, water: 32, road: 13, theme: 'grasslands' },
  'map.sodden-hills': { levels: [172, 70, 29, 1], light: 54, heavy: 0, rough: 0, water: 0, road: 0, theme: 'grasslands' },
  'map.scorched-oasis': { levels: [244, 14, 9, 5], light: 20, heavy: 4, rough: 4, water: 10, road: 0, theme: 'desert' },
  'map.arid-canyons': { levels: [154, 77, 37, 4], light: 40, heavy: 0, rough: 0, water: 0, road: 0, theme: 'desert' },
}

describe('Core Box maps', () => {
  for (const [id, e] of Object.entries(EXPECT)) {
    it(`MAPS-001 ${id} keeps its transcribed hex counts`, () => {
      const t = tally(id)
      expect(t.m.width * t.m.height).toBe(272)
      expect(t.m.theme).toBe(e.theme)
      expect(t.m.source.ref).toBe('megamek')
      expect(t.levels).toEqual(e.levels)
      expect([t.light, t.heavy, t.rough, t.water, t.road]).toEqual([e.light, e.heavy, e.rough, e.water, e.road])
    })
  }

  it('MAPS-002 intro points at Scorched Oasis; skirmish can choose all four plus the test map', () => {
    expect(RAW.missions.find((m) => m.id === 'mission.intro')!.map).toBe('map.scorched-oasis')
    const ids = RAW.maps.map((m) => m.id)
    for (const id of Object.keys(EXPECT)) expect(ids).toContain(id)
    expect(ids).toContain('map.test-canyons')
    expect(RAW.missions.find((m) => m.id === 'mission.skirmish')!.map).toBe('choose')
  })
})
