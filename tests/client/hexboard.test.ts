// Hex board (50-client §4, §5): hex <-> world mapping, layout, tile prism geometry, terrain placement, water, camera presets,
// theme textures on disk. Pure modules only: no WebGL, no DOM.
import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createGame, LEVEL_HEIGHT, type BoardState } from '../../src/engine/index'
import { buildSetup } from '../../src/client/store/setup'
import { loadBundle } from '../../src/data/index'
import { getActiveBoard, hexToLabel, hexToWorld, hexSurfaceY, labelToHex, setActiveBoard, worldToHex } from '../../src/client/board/hexWorld'
import { jitterFor, layoutBoard, neighbourTiles, topYOf } from '../../src/client/board/layout'
import { A_IN, A_OUT, BEVEL_DROP, R_OUT, TILE_GAP, buildTileGeometry } from '../../src/client/board/tileGeometry'
import { TREE_MAX_H, rockPlacements, treeCount, treeHeight, treePlacements } from '../../src/client/board/props'
import { buildWaterGeometry, EDGE_FACING, waterOpacity } from '../../src/client/board/water'
import { cameraPose, fitDistance, MAX_DISTANCE, MIN_DISTANCE, MIN_POLAR, MAX_POLAR, panClamp } from '../../src/client/board/cameraPose'
import { THEMES, themeFor } from '../../src/client/board/boards'
import { gridSegments } from '../../src/client/board/HexGrid'
import { cellOf, LABEL_CAPACITY } from '../../src/client/board/HexLabels'

const bundle = loadBundle()
function board(mapId = 'map.test-canyons'): BoardState {
  const r = createGame(buildSetup({ mission: 'mission.intro', map: mapId }, { A: 'bot', B: 'bot' }), 'board-test', bundle)
  if (r.rejection) throw new Error(r.rejection.message)
  return r.state.board
}

describe('hexWorld', () => {
  const b = board()
  it('maps opposite sheet corners to opposite sides of the origin, and the middle hex near it', () => {
    const a = hexToWorld('0101', b), z = hexToWorld('1617', b), m = hexToWorld('0809', b)
    expect(a.x).toBeLessThan(0)
    expect(a.z).toBeLessThan(0)
    expect(z.x).toBeGreaterThan(0)
    expect(z.z).toBeGreaterThan(0)
    expect(Math.hypot(m.x, m.z)).toBeLessThan(1)
    expect(a.x + z.x).toBeCloseTo(0, 5)
  })
  it('accepts a label or an axial hex and round-trips through worldToHex', () => {
    for (const label of ['0101', '0507', '1617', '0802']) {
      const hex = labelToHex(label)!
      expect(hexToWorld(label, b)).toEqual(hexToWorld(hex, b))
      const back = worldToHex(hexToWorld(label, b), b)!
      expect(hexToLabel(b, back)).toBe(label)
    }
  })
  it('uses the registered board when none is passed, and reports surface height from the level', () => {
    expect(getActiveBoard()).toBeNull()
    expect(hexToWorld('0101')).toEqual({ x: 0, z: 0 })
    setActiveBoard(b)
    try {
      expect(hexToWorld('0101')).toEqual(hexToWorld('0101', b))
      const raised = Object.values(b.hexes).find((h) => h.level > 0 && h.depth === 0)!
      expect(hexSurfaceY(raised.label)).toBeCloseTo(raised.level * LEVEL_HEIGHT, 6)
    } finally { setActiveBoard(null) }
  })
})

describe('layout', () => {
  const b = board()
  const l = layoutBoard(b)
  it('has one tile per hex and groups by solid-top level', () => {
    expect(l.tiles.length).toBe(Object.keys(b.hexes).length)
    expect([...l.groups.values()].reduce((n, g) => n + g.length, 0)).toBe(l.tiles.length)
    expect(l.levels).toEqual([...l.levels].sort((a, c) => a - c))
  })
  it('puts a water hex floor below its surface and keeps the slab below every top', () => {
    const wet = l.tiles.filter((t) => t.depth > 0)
    expect(wet.length).toBeGreaterThan(0)
    for (const t of wet) expect(t.topLevel).toBe(t.surfaceLevel! - t.depth)
    for (const t of l.tiles) expect(l.baseY).toBeLessThan(topYOf(t))
    expect(l.plinthY).toBeGreaterThanOrEqual(l.baseY)
  })
  it('keeps jitter deterministic by label and within a subtle range', () => {
    expect(jitterFor('0507')).toEqual(jitterFor('0507'))
    expect(jitterFor('0507')).not.toEqual(jitterFor('0508'))
    for (const t of l.tiles) {
      expect(Math.abs(t.dy)).toBeLessThanOrEqual(0.006)
      for (const c of t.tint) {
        expect(c).toBeGreaterThan(0.85)
        expect(c).toBeLessThan(1.15)
      }
    }
  })
  it('bounds span the board (a 16 x 17 sheet is about 14 x 17.5 units)', () => {
    expect(l.bounds.w).toBeGreaterThan(13)
    expect(l.bounds.w).toBeLessThan(15)
    expect(l.bounds.d).toBeGreaterThan(17)
    expect(l.bounds.d).toBeLessThan(18)
  })
  it('finds on-board neighbours only', () => {
    const corner = l.byLabel.get('0101')!
    expect(neighbourTiles(l, b, corner).filter(Boolean).length).toBeLessThan(6)
    const mid = l.byLabel.get('0809')!
    expect(neighbourTiles(l, b, mid).every(Boolean)).toBe(true)
  })
})

describe('tile prism geometry', () => {
  const topY = 0.7, baseY = -0.3
  const g = buildTileGeometry({ topY, baseY })
  const pos = g.getAttribute('position'), nor = g.getAttribute('normal')
  it('is a hair-thin-gap prism: outline inside the unit hex, top face inset by the chamfer', () => {
    expect(TILE_GAP).toBeLessThan(0.03)
    expect(A_OUT).toBeCloseTo(0.5 - TILE_GAP / 2, 9)
    expect(A_IN).toBeLessThan(A_OUT)
    let maxR = 0
    for (let i = 0; i < pos.count; i++) maxR = Math.max(maxR, Math.hypot(pos.getX(i), pos.getZ(i)))
    expect(maxR).toBeCloseTo(R_OUT, 6)
  })
  it('has a chamfer: the side wall stops below the top face by the bevel drop', () => {
    const ys = new Set<number>()
    for (let i = 0; i < pos.count; i++) ys.add(Math.round(pos.getY(i) * 1e5) / 1e5)
    expect(ys.has(topY)).toBe(true)
    expect(ys.has(Math.round((topY - BEVEL_DROP) * 1e5) / 1e5)).toBe(true)
    expect(ys.has(baseY)).toBe(true)
  })
  it('has two draw groups (ground, cliff) and outward unit normals', () => {
    expect(g.groups.map((x) => x.materialIndex)).toEqual([0, 1])
    expect(g.groups[0]!.count + g.groups[1]!.count).toBe(pos.count)
    for (let i = 0; i < nor.count; i++) {
      expect(Math.hypot(nor.getX(i), nor.getY(i), nor.getZ(i))).toBeCloseTo(1, 4)
      const radial = nor.getX(i) * pos.getX(i) + nor.getZ(i) * pos.getZ(i)
      if (i >= g.groups[1]!.start) expect(radial).toBeGreaterThan(0) // side walls face away from the centre
      else expect(nor.getY(i)).toBeGreaterThan(0) // top cap and chamfer face up
    }
  })
  it('stays cheap: a tile is a few dozen triangles, not hundreds', () => {
    expect(pos.count / 3).toBeLessThan(60)
  })
})

describe('terrain props', () => {
  it('trees stay below the shoulder cap and are deterministic', () => {
    expect(TREE_MAX_H).toBeLessThanOrEqual(0.55 * 2 * LEVEL_HEIGHT + 1e-9)
    for (const size of [0, 0.5, 1]) expect(treeHeight(size)).toBeLessThanOrEqual(TREE_MAX_H)
    expect(treePlacements('0507', 'light')).toEqual(treePlacements('0507', 'light'))
  })
  it('light woods hold 3 to 5 trees; heavy woods are a dense clump; low graphics thins heavy woods', () => {
    for (const label of ['0101', '0507', '0910', '1203', '1617', '0302', '0808']) {
      const n = treeCount(label, 'light')
      expect(n).toBeGreaterThanOrEqual(3)
      expect(n).toBeLessThanOrEqual(5)
      expect(treeCount(label, 'heavy')).toBeGreaterThanOrEqual(8)
      expect(treeCount(label, 'heavy', true)).toBeLessThan(treeCount(label, 'heavy'))
    }
  })
  it('keeps every tree and rock inside its hex', () => {
    for (const label of ['0101', '0507', '1203']) {
      const all = [...treePlacements(label, 'heavy'), ...treePlacements(label, 'light'), ...rockPlacements(label)]
      for (const p of all) expect(Math.hypot(p.x, p.z)).toBeLessThan(0.4)
    }
    expect(rockPlacements('0507').length).toBeGreaterThanOrEqual(6)
  })
})

describe('water', () => {
  const b = board(), l = layoutBoard(b)
  const geo = buildWaterGeometry(l, b, THEMES.desert, false)!
  it('uses the spec opacities by depth', () => {
    expect([1, 2, 3, 5].map(waterOpacity)).toEqual([0.55, 0.7, 0.8, 0.8])
  })
  it('builds one merged surface below the surrounding ground, with rgba vertex colours', () => {
    expect(geo).not.toBeNull()
    const wet = l.tiles.filter((t) => t.depth > 0)
    expect(geo.getAttribute('position').count).toBe(wet.length * 36)
    expect(geo.getAttribute('color').itemSize).toBe(4)
    const t = wet[0]!
    expect(geo.getAttribute('position').getY(0)).toBeLessThan(t.surfaceLevel! * LEVEL_HEIGHT)
  })
  it('maps edges to facings (edge 4 faces north, edge 1 south)', () => {
    expect(EDGE_FACING[4]).toBe(0)
    expect(EDGE_FACING[1]).toBe(3)
  })
  it('is null for a dry board', () => {
    const dry = { ...b, hexes: Object.fromEntries(Object.entries(b.hexes).map(([k, h]) => [k, { ...h, depth: 0 }])) }
    expect(buildWaterGeometry(layoutBoard(dry), dry, THEMES.desert, false)).toBeNull()
  })
})

describe('grid and labels', () => {
  const b = board(), l = layoutBoard(b)
  it('draws every shared edge once', () => {
    const seg = gridSegments(l, b)
    expect(seg.length % 6).toBe(0)
    const edges = seg.length / 6
    // each interior edge is shared by two hexes and drawn once; boundary edges belong to one
    const boundary = l.tiles.reduce((n, t) => n + neighbourTiles(l, b, t).filter((x) => !x).length, 0)
    expect(edges).toBe((6 * l.tiles.length + boundary) / 2)
  })
  it('the label atlas holds every hex of a 16 x 34 composite', () => {
    expect(LABEL_CAPACITY).toBeGreaterThanOrEqual(16 * 34)
    expect(cellOf(0)).toEqual({ col: 0, row: 0 })
    expect(cellOf(17).col).toBe(1)
  })
})

describe('camera presets', () => {
  const b = layoutBoard(board()).bounds
  it('keep the eye inside the allowed distance and polar range for every preset', () => {
    for (const p of ['overview', 'top', 'home', 'follow', 'low'] as const) {
      const pose = cameraPose(p, b, { focus: { x: 1, z: 1 }, edge: 'north' })
      expect(pose.distance).toBeGreaterThanOrEqual(MIN_DISTANCE)
      expect(pose.distance).toBeLessThanOrEqual(MAX_DISTANCE)
      expect(pose.polar).toBeGreaterThanOrEqual(MIN_POLAR - 1e-9)
      expect(pose.polar).toBeLessThanOrEqual(MAX_POLAR + 1e-9)
      const d = Math.hypot(pose.position[0] - pose.target[0], pose.position[1] - pose.target[1], pose.position[2] - pose.target[2])
      expect(d).toBeCloseTo(pose.distance, 6)
    }
  })
  it('overview looks from the south, top is steepest, the home edge swings the eye round the board', () => {
    expect(cameraPose('overview', b).position[2]).toBeGreaterThan(0)
    expect(cameraPose('top', b).polar).toBeLessThan(cameraPose('overview', b).polar)
    expect(cameraPose('home', b, { edge: 'north' }).position[2]).toBeLessThan(0)
    expect(cameraPose('follow', b, { focus: { x: 3, z: -2 } }).target).toEqual([3, 0, -2])
  })
  it('fits a wider viewport with a nearer eye', () => {
    expect(fitDistance(b, 2.4)).toBeLessThanOrEqual(fitDistance(b, 1.0))
  })
  it('clamps a pan target to the board plus two hexes', () => {
    expect(panClamp({ x: 0, z: 0 }, b)).toEqual({ dx: 0, dz: 0 })
    expect(panClamp({ x: b.maxX + 5, z: 0 }, b).dx).toBeCloseTo(-3, 6)
    expect(panClamp({ x: 0, z: b.minZ - 4 }, b).dz).toBeCloseTo(2, 6)
  })
})

describe('themes and texture files', () => {
  const root = join(__dirname, '..', '..', 'public', 'assets', 'terrain')
  it('every theme names a ground mat and a cliff mat that exist on disk, within a sane size', () => {
    for (const th of Object.values(THEMES)) {
      for (const f of [...Object.values(th.ground), ...Object.values(th.cliff)]) {
        const p = join(root, f)
        expect(existsSync(p), p).toBe(true)
        expect(statSync(p).size).toBeLessThan(1_000_000)
      }
    }
  })
  it('falls back to desert for an unknown theme and knows both map themes', () => {
    expect(themeFor('nope').id).toBe('desert')
    expect(themeFor('grasslands').id).toBe('grasslands')
    expect(Object.keys(THEMES).sort()).toEqual(['desert', 'grasslands'])
  })
})
