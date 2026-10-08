import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadDataset, validateDataset, REPO, type Dataset } from '../../tools/validate-data'
import { RAW, RAW_FILES, adjustedBv, effectiveProfile, engineHeldSinks, loadBundle, maxArmor, mechDisplayName } from '../../src/data'
import type { DataBundle } from '../../src/engine/types'

const ds = (): Dataset => structuredClone(loadDataset())
const errorsOf = (d: Dataset): string[] => validateDataset(d, { skipProse: true }).errors
const mech = (d: Dataset, id: string) => d.mechs.find((m) => m.id === id)!

function jsonFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name)
    return e.isDirectory() ? jsonFiles(p) : e.name.endsWith('.json') ? [p] : []
  })
}

describe('data validity (20-data-schema)', () => {
  it('DATA-001 the real data validates with zero errors', () => {
    const rep = validateDataset(loadDataset())
    expect(rep.errors).toEqual([])
  })

  it('DATA-002 raw.ts lists every JSON file under src/data', () => {
    const root = path.join(REPO, 'src', 'data')
    const onDisk = jsonFiles(root).map((p) => path.relative(root, p).split(path.sep).join('/')).sort()
    expect([...RAW_FILES].sort()).toEqual(onDisk)
  })

  it('DATA-003 loadBundle builds a DataBundle with a stable content version', () => {
    const a = loadBundle()
    const b = loadBundle()
    const asEngine: DataBundle = a
    expect(asEngine.version).toBe(b.version)
    expect(a.version).toMatch(/^[0-9a-f]{14}$/)
    const ids = Object.keys(a.mechs)
    for (const id of ['mech.eris.ers-2n', 'mech.rakshasa.mdg-1a', 'mech.solitaire.prime', 'mech.uziel.uzl-2s']) expect(ids).toContain(id)
    expect(ids.length).toBe(16)
    expect(a.byId['mission.intro']).toBeDefined()
    expect(a.missions['mission.skirmish']!.map).toBe('choose')
  })

  it('DATA-004 loadBundle throws on a duplicate id and on a dangling reference', () => {
    const dup = { ...RAW, pilots: [...RAW.pilots, RAW.pilots[0]!] }
    expect(() => loadBundle(dup)).toThrow(/duplicate/)
    const bad = structuredClone(RAW)
    bad.forces[0]!.units[0]!.mech = 'mech.nope.x'
    expect(() => loadBundle(bad)).toThrow(/dangling/)
  })

  it('DATA-010 stats match the sourced stock values for the four slice Mechs', () => {
    const b = loadBundle()
    const u = b.mechs['mech.uziel.uzl-2s']!
    expect([u.tonnage, u.movement.walk, u.movement.run, u.movement.jump, u.engine.rating]).toEqual([50, 6, 9, 6, 300])
    expect(u.armor.front).toEqual({ HD: 9, CT: 17, LT: 14, RT: 14, LA: 12, RA: 12, LL: 18, RL: 18 })
    expect(u.armor.rear).toEqual({ CT: 6, LT: 4, RT: 4 })
    const e = b.mechs['mech.eris.ers-2n']!
    expect([e.tonnage, e.movement.walk, e.movement.run, e.movement.jump, e.engine.rating]).toEqual([50, 5, 8, 5, 250])
    expect(e.armor.front).toEqual({ HD: 9, CT: 23, LT: 18, RT: 18, LA: 15, RA: 15, LL: 22, RL: 22 })
    const s = b.mechs['mech.solitaire.prime']!
    expect([s.tonnage, s.movement.walk, s.movement.run, s.techBase]).toEqual([25, 10, 15, 'Clan'])
    expect(s.armor.rear).toEqual({ CT: 3, LT: 3, RT: 3 })
    const r = b.mechs['mech.rakshasa.mdg-1a']!
    expect([r.tonnage, r.movement.walk, r.engine.rating, r.heatSinks.count]).toEqual([75, 5, 375, 15])
    expect(r.armor.front).toEqual({ HD: 9, CT: 32, LT: 22, RT: 22, LA: 21, RA: 21, LL: 28, RL: 28 })
  })

  it('DATA-011 stand-in variants carry the stock label and a standIn note; sourced ones do not', () => {
    const b = loadBundle()
    expect(mechDisplayName(b.mechs['mech.solitaire.prime']!)).toBe('Solitaire Prime (stock)')
    expect(mechDisplayName(b.mechs['mech.rakshasa.mdg-1a']!)).toBe('Rakshasa MDG-1A (stock)')
    expect(mechDisplayName(b.mechs['mech.uziel.uzl-2s']!)).toBe('Uziel UZL-2S')
    for (const m of Object.values(b.mechs)) expect(m.source.ref).toBeTruthy()
    const d = ds()
    delete mech(d, 'mech.solitaire.prime').verify
    expect(errorsOf(d).join('\n')).toMatch(/stand-in needs a root verify note/)
  })

  it('DATA-012 derived values: engine-held sinks, armor caps, adjusted BV', () => {
    const b = loadBundle()
    expect(engineHeldSinks(b.mechs['mech.uziel.uzl-2s']!)).toBe(10)
    expect(engineHeldSinks(b.mechs['mech.rakshasa.mdg-1a']!)).toBe(15)
    expect(maxArmor(b.tables, 50, 'CT')).toBe(32)
    expect(maxArmor(b.tables, 25, 'HD')).toBe(9)
    expect(adjustedBv(b.tables, 1352, 4, 5)).toBe(1352)
    expect(adjustedBv(b.tables, 1000, 3, 4)).toBe(1320)
    expect(Object.values(b.pilots).every((p) => p.gunnery === 4 && p.piloting === 5)).toBe(true)
    expect(Object.keys(b.pilots)).toHaveLength(4)
  })

  it('DATA-020 schema rejects a malformed mech and an unknown key', () => {
    const d = ds()
    ;(mech(d, 'mech.uziel.uzl-2s') as unknown as Record<string, unknown>).bogus = 1
    expect(errorsOf(d).join('\n')).toMatch(/schema mech/)
  })

  it('DATA-021 dangling mount, ammo and force references are caught', () => {
    const d = ds()
    mech(d, 'mech.uziel.uzl-2s').mounts[0]!.item = 'is.w.nothing'
    mech(d, 'mech.rakshasa.mdg-1a').ammoBins[0]!.ammo = 'is.ammo.nothing'
    d.forces[0]!.units[0]!.mech = 'mech.nope.x'
    const e = errorsOf(d).join('\n')
    expect(e).toMatch(/is\.w\.nothing/)
    expect(e).toMatch(/is\.ammo\.nothing/)
    expect(e).toMatch(/mech\.nope\.x/)
  })

  it('DATA-030 crit slot accounting: wrong counts, misplaced items and bad layouts fail', () => {
    const d = ds()
    const u = mech(d, 'mech.uziel.uzl-2s')
    u.crits.LA[3] = 'empty' // PPC loses a slot
    u.crits.CT[0] = 'gyro' // engine block broken
    u.crits.LL[1] = 'empty' // leg actuator missing
    const e = errorsOf(d).join('\n')
    expect(e).toMatch(/mount ppc-la occupies 2 slots, expected 3/)
    expect(e).toMatch(/CT slot 1 should be engine/)
    expect(e).toMatch(/LL slot 2 should be upperLeg/)
  })

  it('DATA-031 filler counts, armor caps, movement and sink counts are enforced', () => {
    const d = ds()
    const e0 = mech(d, 'mech.eris.ers-2n')
    e0.crits.LA[11] = 'empty' // one endo slot fewer
    e0.armor.front.CT = 30 // 30 + 8 > 32
    e0.movement.run = 9
    e0.heatSinks.count = 12 // two sink mounts missing
    const e = errorsOf(d).join('\n')
    expect(e).toMatch(/structure filler slots, expected 14/)
    expect(e).toMatch(/CT armor 30\+8 exceeds max 32/)
    expect(e).toMatch(/run 9/)
    expect(e).toMatch(/sink mounts, expected 2/)
  })

  it('DATA-032 tech base mixing and unlisted ammo are rejected', () => {
    const d = ds()
    mech(d, 'mech.uziel.uzl-2s').mounts[0]!.item = 'cl.w.heavy-large-laser'
    mech(d, 'mech.uziel.uzl-2s').ammoBins[0]!.options = ['is.ammo.machine-gun', 'is.ammo.srm-6']
    const e = errorsOf(d).join('\n')
    expect(e).toMatch(/is Clan, 'Mech is IS/)
    expect(e).toMatch(/not fireable by/)
  })

  it('DATA-040 weapon and ammo link both ways; unordered ranges fail', () => {
    const d = ds()
    d.weapons.find((w) => w.id === 'is.w.ppc')!.ranges = { min: 3, short: 12, medium: 12, long: 18 }
    d.ammo.find((a) => a.id === 'is.ammo.srm-6')!.weapons = []
    const e = errorsOf(d).join('\n')
    expect(e).toMatch(/is\.w\.ppc: ranges must satisfy/)
    expect(e).toMatch(/does not list this weapon back/)
  })

  it('DATA-050 map: slice map loads with the spec counts and bad terrain is rejected', () => {
    const d = ds()
    const m = d.maps.find((x) => x.id === 'map.test-canyons')!
    expect(m.width * m.height).toBe(272)
    const all = Object.entries(m.hexes!)
    const lights = all.filter(([, h]) => h.terrain?.some((t) => t.type === 'lightWoods')).length
    const heavies = all.filter(([, h]) => h.terrain?.some((t) => t.type === 'heavyWoods')).length
    const rough = all.filter(([, h]) => h.terrain?.some((t) => t.type === 'rough')).length
    const water = all.filter(([, h]) => h.terrain?.some((t) => t.type === 'water')).length
    expect([lights, heavies, rough, water]).toEqual([19, 4, 9, 5])
    m.hexes!['2001'] = { level: 1 } // outside 16 columns
    m.hexes!['0505'] = { terrain: [{ type: 'lightWoods' }, { type: 'water', depth: 1 }] }
    m.hexes!['0606'] = { terrain: [{ type: 'sand' }] }
    const e = errorsOf(d).join('\n')
    expect(e).toMatch(/hex 2001 outside/)
    expect(e).toMatch(/water excludes/)
    expect(e).toMatch(/UNSUPPORTED_TERRAIN sand at 0606/)
  })

  it('DATA-060 missions: opposite edges, forces, entry hexes and BV pass; broken ones fail', () => {
    const b = loadBundle()
    const intro = b.missions['mission.intro']!
    expect(intro.sides.map((s) => s.homeEdge)).toEqual(['south', 'north'])
    expect(b.missions['mission.skirmish']!.options.bvBudget).toBe(7500)
    const d = ds()
    d.missions[0]!.sides[1].homeEdge = 'south'
    d.missions[0]!.map = 'map.missing'
    const e = errorsOf(d).join('\n')
    expect(e).toMatch(/home edges must be opposite/)
    expect(e).toMatch(/map map\.missing does not exist/)
  })

  it('DATA-070 edition leak keys and Weapon Attack Phase text are rejected', () => {
    const d = ds()
    ;(d.weapons[0] as unknown as Record<string, unknown>).ghostHeat = 1
    d.missions[0]!.briefing = 'Fight in the Weapon Attack Phase.'
    const e = errorsOf(d).join('\n')
    expect(e).toMatch(/edition leak key "ghostHeat"/)
    expect(e).toMatch(/edition leak text/)
  })

  it('EQUIP-030 out-of-scope items (flail, flechette, ejection, industrial, UMU, boosters) fail validation', () => {
    for (const name of ['Flail', 'Flechette Ammo', 'Full-Head Ejection', 'Industrial Welder', 'UMU', 'Mechanical Jump Booster']) {
      const d = ds()
      d.equipment.push({ id: 'is.eq.banned', name, techBase: 'IS', kind: 'other', slots: 1, tons: 1, source: { ref: 'ours' } })
      expect(errorsOf(d).join('\n'), name).toMatch(/out-of-scope item/)
    }
  })

  it('EQUIP-001 catalogue numbers: weapons, ammo and the MML short-range override', () => {
    const b = loadBundle()
    const w = b.weapons
    expect(w['is.w.ppc']).toMatchObject({ heat: 10, damage: 10, slots: 3, tons: 7, ranges: { min: 3, short: 6, medium: 12, long: 18 } })
    expect(w['is.w.snub-nose-ppc']!.damage).toEqual({ short: 10, medium: 8, long: 5 })
    expect(w['cl.w.heavy-large-laser']).toMatchObject({ heat: 18, damage: 16, toHitMod: 1 })
    expect(w['is.w.medium-pulse-laser']!.toHitMod).toBe(-2)
    expect(b.ammo['is.ammo.srm-6']!.shotsPerTon).toBe(15)
    expect(b.ammo['is.ammo.lrm-10']!.shotsPerTon).toBe(12)
    const lrm = effectiveProfile(w['is.w.mml-5']!, b.ammo['is.ammo.mml-5-lrm'])
    const srm = effectiveProfile(w['is.w.mml-5']!, b.ammo['is.ammo.mml-5-srm'])
    expect(lrm).toMatchObject({ damage: 1, cluster: { rackSize: 5, groupSize: 5 }, ranges: { min: 6, short: 7, medium: 14, long: 21 } })
    expect(srm).toMatchObject({ damage: 2, cluster: { rackSize: 5, groupSize: 1 }, ranges: { short: 3, medium: 6, long: 9 } })
    expect(srm.flags).not.toContain('indirect')
    expect(lrm.flags).toContain('indirect')
  })
})

describe('tonnage audit', () => {
  it('DATA-TON-001 a heat sink count, armor or engine change that breaks the tonnage fails validation', () => {
    const a = ds()
    mech(a, 'mech.rakshasa.mdg-1a').armor.front.CT += 16
    expect(errorsOf(a).some((e) => e.includes('tonnage audit'))).toBe(true)
    const b = ds()
    mech(b, 'mech.rakshasa.mdg-1a').engine.rating = 350
    expect(errorsOf(b).some((e) => e.includes('tonnage audit'))).toBe(true)
  })
})
