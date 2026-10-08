// Game shop surroundings: geometry budget, determinism, clutter placement, atlas layout, setting and camera path.
import { beforeEach, describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { Builder } from '../../src/client/environment/builder'
import { buildShop, tableSize, MAT_Y, DEFAULT_BOARD, ROOM, FLOOR_Y } from '../../src/client/environment/shopBuild'
import {
  ART_DESIGNS, FLYERS, POSTERS, artCover, artSpine, boxArtInfo, dieFaceRect, flyerRect, posterRect,
} from '../../src/client/environment/atlas'
import { resolveSurroundings, useSurroundingsStore, SURROUNDINGS_KEY } from '../../src/client/environment/surroundings'
import { shotPose, toOrbit, wideShopOrbit, SHOT_DURATION_S } from '../../src/client/environment/shotPath'
import { memoryStorage, setStorage, readJson } from '../../src/client/store/storage'

const shop = buildShop()
const outputs = [shop.near.solid, shop.near.art, shop.near.paper, shop.near.wood, shop.room.solid, shop.room.art, shop.room.paper, shop.glow, shop.glass]

describe('shop geometry', () => {
  it('SHOP-001 stays under the 150k triangle budget', () => {
    const total = outputs.reduce((n, o) => n + o.triangles, 0)
    expect(total).toBe(shop.triangles)
    expect(total).toBeGreaterThan(20000)
    expect(total).toBeLessThan(150000)
  })
  it('SHOP-002 is deterministic and has no NaN', () => {
    const again = buildShop()
    expect(again.triangles).toBe(shop.triangles)
    expect(Array.from(again.room.art.position.slice(0, 300))).toEqual(Array.from(shop.room.art.position.slice(0, 300)))
    for (const o of outputs) {
      expect(o.position.every(Number.isFinite)).toBe(true)
      expect(o.normal.every(Number.isFinite)).toBe(true)
      expect(o.position.length).toBe(o.triangles * 9)
      expect(o.uv.length).toBe(o.triangles * 6)
      expect(o.color.length).toBe(o.triangles * 9)
    }
  })
  it('SHOP-003 UVs stay inside the atlases', () => {
    for (const o of outputs) for (const v of o.uv) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1) }
  })
  it('SHOP-004 table is a real 3x5 ft top (about 29 x 48 hexes) and grows for big maps', () => {
    expect(tableSize(DEFAULT_BOARD)).toEqual({ width: 48, depth: 28.8 })
    const big = tableSize({ boardWidth: 48, boardDepth: 40 })
    expect(big.width).toBe(54); expect(big.depth).toBe(46)
  })
  it('SHOP-005 the room is about 8 x 10 m (hexes of 3.175 cm)', () => {
    const w = ((ROOM.x1 - ROOM.x0) * 3.175) / 100, d = ((ROOM.z1 - ROOM.z0) * 3.175) / 100
    expect(w).toBeGreaterThan(7.5); expect(w).toBeLessThan(8.5)
    expect(d).toBeGreaterThan(9.5); expect(d).toBeLessThan(10.5)
  })
  it('SHOP-006 tabletop clutter never covers the map footprint', () => {
    const hw = DEFAULT_BOARD.boardWidth / 2, hd = DEFAULT_BOARD.boardDepth / 2
    for (const o of [shop.near.solid, shop.near.art, shop.near.paper]) {
      for (let i = 0; i < o.position.length; i += 3) {
        const x = o.position[i], y = o.position[i + 1], z = o.position[i + 2]
        if (y > MAT_Y + 0.02 && y < 8) expect(Math.abs(x) >= hw + 0.5 || Math.abs(z) >= hd + 0.5, `vertex ${x},${y},${z}`).toBe(true)
      }
    }
  })
  it('SHOP-007 mat sits below the board plane and the floor is a table height lower', () => {
    let top = -Infinity
    for (let i = 1; i < shop.near.solid.position.length; i += 3) { const y = shop.near.solid.position[i]; if (y <= 0.001 && y > top && y > -0.5) top = y }
    expect(top).toBeLessThan(0)
    expect(-FLOOR_Y * 3.175).toBeGreaterThan(70); expect(-FLOOR_Y * 3.175).toBeLessThan(82)
  })
  it('SHOP-008 has a key lamp over the table plus others', () => {
    expect(shop.lamps.filter((l) => l.key)).toHaveLength(1)
    expect(shop.lamps.length).toBeGreaterThanOrEqual(3)
  })
})

describe('builder', () => {
  it('SHOP-010 a box is 12 triangles with outward normals', () => {
    const b = new Builder(); b.box({ at: [0, 0, 0], size: [2, 2, 2] })
    const o = b.output(); expect(o.triangles).toBe(12)
    for (let t = 0; t < 12; t++) {
      const p = [0, 1, 2].map((k) => new THREE.Vector3(o.position[t * 9 + k * 3], o.position[t * 9 + k * 3 + 1], o.position[t * 9 + k * 3 + 2]))
      const n = new THREE.Vector3().crossVectors(p[1].clone().sub(p[0]), p[2].clone().sub(p[0])).normalize()
      const centre = p[0].clone().add(p[1]).add(p[2]).divideScalar(3).sub(new THREE.Vector3(0, 1, 0))
      expect(n.dot(centre)).toBeGreaterThan(0)
    }
  })
  it('SHOP-011 frames rotate and translate children', () => {
    const b = new Builder(); b.push(10, 0, 0, Math.PI / 2); b.box({ at: [0, 0, 1], size: [1, 1, 1] }); b.pop()
    const o = b.output(); let sx = 0; for (let i = 0; i < o.position.length; i += 3) sx += o.position[i]
    expect(sx / (o.position.length / 3)).toBeCloseTo(11, 1) // local +z becomes world +x
  })
})

describe('atlas and copy', () => {
  it('SHOP-020 box cells map to distinct rectangles inside the atlas', () => {
    const seen = new Set<string>()
    for (let c = 1; c <= ART_DESIGNS; c++) {
      for (const r of [artCover(c), artSpine(c)]) for (const v of r) { expect(v).toBeGreaterThan(0); expect(v).toBeLessThan(1) }
      seen.add(artCover(c).join(','))
    }
    expect(seen.size).toBe(ART_DESIGNS)
    expect(dieFaceRect(6)[0]).toBeGreaterThan(0); expect(posterRect(3)[2]).toBeLessThan(1); expect(flyerRect(15)[3]).toBeGreaterThan(0)
  })
  it('SHOP-021 all signage is original: no real brand or product words', () => {
    const banned = /battletech|mechwarrior|catalyst|topps|warhammer|games workshop|citadel|magic the|pok[eé]mon|catan|dungeons|d&d|wizards|hasbro|mattel|lego|nintendo|coca|pepsi|red bull|gundam|bandai|privateer|warmachine|malifaux/i
    const texts: string[] = []
    for (let c = 1; c <= ART_DESIGNS; c++) { const i = boxArtInfo(c); texts.push(i.title, i.maker, i.tag) }
    for (const p of POSTERS) texts.push(p.head, p.big, p.sub)
    for (const f of FLYERS) texts.push(...f)
    texts.push('THE CROOKED DIE', 'FIZZWHISTLE')
    for (const t of texts) expect(t, t).not.toMatch(banned)
  })
  it('SHOP-022 box titles are varied', () => {
    const titles = new Set(Array.from({ length: ART_DESIGNS }, (_, i) => boxArtInfo(i + 1).title))
    expect(titles.size).toBeGreaterThan(25)
  })
})

describe('surroundings setting', () => {
  beforeEach(() => { setStorage(memoryStorage()); useSurroundingsStore.getState().reload() })
  it('SHOP-030 defaults to the game shop and persists the choice', () => {
    expect(useSurroundingsStore.getState().value).toBe('shop')
    useSurroundingsStore.getState().set('plain')
    expect(readJson(SURROUNDINGS_KEY)).toBe('plain')
    useSurroundingsStore.getState().set('shop')
    expect(useSurroundingsStore.getState().value).toBe('shop')
  })
  it('SHOP-031 Low graphics always resolves to Plain', () => {
    expect(resolveSurroundings('shop', 'low')).toBe('plain')
    expect(resolveSurroundings('shop', 'high')).toBe('shop')
    expect(resolveSurroundings('plain', 'high')).toBe('plain')
  })
  it('SHOP-032 garbage stored values fall back to the shop', () => {
    useSurroundingsStore.getState().set('nonsense' as 'shop')
    expect(useSurroundingsStore.getState().value).toBe('shop')
  })
})

describe('establishing shot path', () => {
  const end = toOrbit(new THREE.Vector3(0, 24, 20), new THREE.Vector3(0, 0, 0))
  const start = wideShopOrbit(end)
  it('SHOP-040 starts wide in the shop and ends exactly on the play view', () => {
    const a = shotPose(start, end, 0), z = shotPose(start, end, 1)
    expect(a.radius).toBeGreaterThan(100)
    expect(z.radius).toBeCloseTo(end.radius, 6); expect(z.az).toBeCloseTo(end.az, 6); expect(z.target.distanceTo(end.target)).toBeLessThan(1e-9)
    expect(SHOT_DURATION_S).toBeGreaterThan(4)
  })
  it('SHOP-041 stays inside the room and above the floor the whole way', () => {
    for (let k = 0; k <= 1; k += 0.02) {
      const p = shotPose(start, end, k); const c = Math.cos(p.el)
      const x = p.target.x + p.radius * c * Math.sin(p.az), y = p.target.y + p.radius * Math.sin(p.el), zz = p.target.z + p.radius * c * Math.cos(p.az)
      expect(x).toBeGreaterThan(ROOM.x0); expect(x).toBeLessThan(ROOM.x1)
      expect(zz).toBeGreaterThan(ROOM.z0); expect(zz).toBeLessThan(ROOM.z1)
      expect(y).toBeGreaterThan(FLOOR_Y + 5); expect(y).toBeLessThan(65)
    }
  })
})
