import { describe, expect, it } from 'vitest'
import { loadDataset, validateDataset } from '../../tools/validate-data'
import { adjustedBv, effectiveProfile, loadBundle } from '../../src/data'

const b = loadBundle()
const mech = (id: string) => b.mechs[id]!

describe('Core Box roster data (stock variants)', () => {
  it('ROSTER-001 the whole dataset validates, including every tonnage audit', () => {
    const rep = validateDataset(loadDataset())
    expect(rep.errors).toEqual([])
    const audits = rep.logs.filter((l: string) => l.includes('tonnage audit:'))
    expect(audits.length).toBe(16)
  })

  it('ROSTER-002 every chassis of the box has its first and second variant', () => {
    const chassis = new Map<string, number>()
    for (const m of Object.values(b.mechs)) chassis.set(m.chassis, (chassis.get(m.chassis) ?? 0) + 1)
    for (const c of ['Eris', 'Uziel', 'Solitaire', 'Rakshasa', 'Mad Cat Mk II', 'Vulture Mk IV', 'Hollander', 'Regent']) expect(chassis.get(c)).toBe(2)
  })

  it('ROSTER-003 stats match the stock values in the brief (BATTLETECH-HANDOFF, from MegaMek)', () => {
    const rp = mech('mech.regent.prime')
    expect([rp.tonnage, rp.movement.walk, rp.movement.run, rp.movement.jump, rp.heatSinks.count, rp.omni]).toEqual([90, 3, 5, 0, 19, true])
    expect(rp.armor.front).toEqual({ HD: 9, CT: 42, LT: 28, RT: 28, LA: 30, RA: 30, LL: 38, RL: 38 })
    expect(rp.armor.rear).toEqual({ CT: 16, LT: 10, RT: 10 })
    expect(rp.mounts.filter((x) => x.item === 'cl.w.er-large-laser').map((x) => x.location).sort()).toEqual(['LT', 'RA', 'RT'])
    const ra = mech('mech.regent.a')
    expect([ra.heatSinks.count, ra.bv]).toEqual([26, 3412])
    expect(ra.mounts.filter((x) => x.item === 'cl.w.er-ppc')).toHaveLength(3)
    const mc = mech('mech.mad-cat-mk-ii.base')
    expect([mc.tonnage, mc.movement.walk, mc.movement.run, mc.movement.jump, mc.heatSinks.count]).toEqual([90, 4, 6, 3, 14])
    expect(mc.armor.front).toEqual({ HD: 9, CT: 38, LT: 26, RT: 26, LA: 27, RA: 27, LL: 34, RL: 34 })
    expect(mc.armor.rear).toEqual({ CT: 12, LT: 8, RT: 8 })
    expect(mc.mounts.filter((x) => x.item === 'cl.w.gauss-rifle')).toHaveLength(2)
    const vp = mech('mech.vulture-mk-iv.prime')
    expect([vp.tonnage, vp.movement.walk, vp.movement.run, vp.heatSinks.count, vp.armor.type]).toEqual([60, 5, 8, 12, 'ferroLamellor'])
    expect(vp.armor.front).toEqual({ HD: 9, CT: 30, LT: 20, RT: 20, LA: 20, RA: 20, LL: 28, RL: 28 })
    expect(vp.mounts.filter((x) => x.item === 'cl.w.srm-6')).toHaveLength(4)
    const h = mech('mech.hollander.bzk-f3')
    expect([h.tonnage, h.movement.walk, h.movement.run, h.movement.jump, h.heatSinks.count, h.heatSinks.type]).toEqual([35, 5, 8, 0, 10, 'single'])
    expect(h.armor.front).toEqual({ HD: 8, CT: 10, LT: 8, RT: 8, LA: 6, RA: 6, LL: 8, RL: 8 })
    expect(h.armor.rear).toEqual({ CT: 3, LT: 3, RT: 3 })
  })

  it('ROSTER-004 BV values are the MUL base values', () => {
    const bv: Record<string, number> = {
      'mech.regent.prime': 2437, 'mech.regent.a': 3412, 'mech.mad-cat-mk-ii.base': 3135, 'mech.mad-cat-mk-ii.2': 2822,
      'mech.vulture-mk-iv.prime': 2110, 'mech.vulture-mk-iv.a': 2177, 'mech.hollander.bzk-f3': 953, 'mech.hollander.bzk-g1': 873,
      'mech.eris.ers-2h': 1674, 'mech.uziel.uzl-8s': 1393, 'mech.solitaire.2': 1471, 'mech.rakshasa.mdg-1b': 1748,
    }
    for (const [id, v] of Object.entries(bv)) expect(mech(id).bv).toBe(v)
  })

  it('ROSTER-005 stand-ins carry the stock flag and a standIn note; box-confirmed variants do not', () => {
    for (const id of ['mech.hollander.bzk-f3', 'mech.vulture-mk-iv.prime', 'mech.mad-cat-mk-ii.2', 'mech.eris.ers-2h', 'mech.solitaire.2']) {
      expect(mech(id).stock).toBe(true)
      expect((mech(id).verify ?? []).some((v) => v.status === 'standIn')).toBe(true)
    }
    for (const id of ['mech.regent.prime', 'mech.regent.a', 'mech.mad-cat-mk-ii.base']) expect(mech(id).stock).toBeUndefined()
  })

  it('ROSTER-006 LB-X ammo choice turns the weapon into a slug or a 1-point cluster with -1 to hit', () => {
    const w = b.weapons['cl.w.lb-20x']!
    const slug = effectiveProfile(w, b.ammo['cl.ammo.lb-20x-slug'])
    expect([slug.damage, slug.cluster, slug.toHitMod]).toEqual([20, undefined, undefined])
    const clu = effectiveProfile(w, b.ammo['cl.ammo.lb-20x-cluster'])
    expect([clu.damage, clu.cluster, clu.toHitMod]).toEqual([1, { rackSize: 20, groupSize: 1 }, -1])
    expect(clu.flags).toContain('cluster')
    const reg = mech('mech.regent.prime').ammoBins.find((x) => x.ammo === 'cl.ammo.lb-20x-slug')!
    expect(reg.options).toContain('cl.ammo.lb-20x-cluster')
  })

  it('ROSTER-007 Gauss ammo is inert and the Gauss rifle explodes only through its own crit', () => {
    expect(b.ammo['cl.ammo.gauss-rifle']!.explodes).toBe(false)
    expect(b.ammo['is.ammo.gauss-rifle']!.explosionPerShot).toBe(0)
    expect(b.weapons['cl.w.gauss-rifle']!.flags).toContain('explodes')
  })

  it('ROSTER-008 the two lance presets are four Mechs each at similar BV, inside the skirmish budget', () => {
    const total = (id: string): number => b.forces[id]!.units.reduce((s, u) => s + adjustedBv(b.tables, mech(u.mech).bv, 4, 5), 0)
    for (const id of ['force.regent-lance', 'force.mad-cat-lance']) {
      expect(b.forces[id]!.units).toHaveLength(4)
      expect(total(id)).toBeLessThanOrEqual(7500)
    }
    const a = total('force.regent-lance')
    const c = total('force.mad-cat-lance')
    expect(Math.abs(a - c) / Math.max(a, c)).toBeLessThan(0.05)
  })
})
