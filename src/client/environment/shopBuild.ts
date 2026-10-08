// Procedural build of the game shop: pure geometry (no DOM), deterministic. 1 world unit = 1 hex (about 1.25 in, 3.175 cm).
// World frame: origin at the centre of the gaming table's mat surface, y up. The map sits on top of the mat.
import { Builder, rng, type BuilderOutput, type Rect } from './builder'
import {
  ART_DESIGNS, FLYER_COUNT, POSTER_COUNT, artCover, artSpine, artWhite, canLabelRect, binderLabelRect, corkRect, dieFaceRect, flyerRect,
  gridPaperRect, paperWhite, posterRect, signRect,
} from './atlas'

export const CM = 1 / 3.175
export const FLOOR_Y = -24
export const CEIL_Y = 70
export const ROOM = { x0: -126, x1: 126, z0: -182.5, z1: 132.5 } as const
export const MAT_Y = -0.01
export const TABLE_TOP_Y = -0.05
export const KEY_LIGHT_Y = 44

export interface ShopOptions {
  /** Map footprint in hexes (x width, z depth); the table is sized from it. */
  boardWidth: number
  boardDepth: number
}
export const DEFAULT_BOARD = { boardWidth: 14.2, boardDepth: 17.5 } as const

export interface TableSize { width: number; depth: number }
/** Real 3 x 5 ft (28.8 x 48 hexes), grown if the map needs more than 3 hexes of table beyond each edge. */
export function tableSize(o: ShopOptions): TableSize {
  return { width: Math.max(48, o.boardWidth + 6), depth: Math.max(28.8, o.boardDepth + 6) }
}

export interface Lamp { x: number; z: number; y: number; radius: number; key: boolean }

export interface ShopGeometry {
  /** Things on and around the play table: cast and receive shadows from the key light. */
  near: { solid: BuilderOutput; art: BuilderOutput; paper: BuilderOutput; wood: BuilderOutput }
  room: { solid: BuilderOutput; art: BuilderOutput; paper: BuilderOutput }
  glow: BuilderOutput
  glass: BuilderOutput
  lamps: Lamp[]
  table: TableSize
  triangles: number
}

type Rand = () => number
const pick = <T,>(r: Rand, a: readonly T[]): T => a[Math.floor(r() * a.length)]
const range = (r: Rand, a: number, b: number): number => a + (b - a) * r()

const BOX_TONES = ['#8a2f2a', '#2e5a7a', '#4a6a2c', '#7a5a1e', '#5a2f6a', '#2f6a64', '#a0501e', '#3a3a52', '#6a2f48', '#1f4a3a']
const WOOD = { dark: '#4a2e1c', mid: '#7a4f2e', light: '#a9794a', pale: '#c79a62' }
const PAINTS = ['#c0392b', '#e08a1e', '#e0c030', '#4a9a3a', '#2b8aa8', '#2f5aa8', '#7a3aa8', '#d0508a', '#e8e4d8', '#202228', '#8a5a2c', '#6a7a3a']

interface Bs { solid: Builder; art: Builder; paper: Builder; wood: Builder; glow: Builder; glass: Builder }
const allOf = (b: Bs): Builder[] => [b.solid, b.art, b.paper, b.wood, b.glow, b.glass]
const frame = (list: Builder[], x: number, y: number, z: number, ry: number, fn: () => void): void => {
  for (const b of list) b.push(x, y, z, ry)
  fn()
  for (const b of list) b.pop()
}

// ------------------------------------------------------------------------------------------ small prop makers
function statuette(solid: Builder, x: number, y: number, z: number, ry: number, s: number, body: string, accent: string, kind: number): void {
  solid.frame(x, y, z, ry, () => {
    const dark = '#2a2c30'
    for (const sx of [-1, 1]) {
      solid.box({ at: [sx * 0.42 * s, 0, 0], size: [0.46 * s, 0.35 * s, 0.9 * s], color: dark })
      solid.box({ at: [sx * 0.42 * s, 0.3 * s, -0.05 * s], size: [0.4 * s, 1.0 * s, 0.45 * s], color: body })
    }
    solid.box({ at: [0, 1.25 * s, 0], size: [1.55 * s, 1.0 * s, 0.95 * s], color: body })
    solid.box({ at: [0, 1.5 * s, 0.5 * s], size: [0.9 * s, 0.5 * s, 0.1 * s], color: accent })
    solid.box({ at: [0, 2.25 * s, 0.05 * s], size: [0.62 * s, 0.42 * s, 0.6 * s], color: kind % 2 ? accent : dark })
    for (const sx of [-1, 1]) {
      solid.box({ at: [sx * 1.0 * s, 1.35 * s, 0], size: [0.42 * s, 0.7 * s, 0.5 * s], color: accent })
      solid.box({ at: [sx * 1.0 * s, 1.55 * s, 0.35 * s], size: [0.22 * s, 0.22 * s, (0.9 + 0.3 * (kind % 3)) * s], color: dark })
    }
  })
}

function die(paper: Builder, r: Rand, x: number, y: number, z: number, size: number): void {
  const faces = [1, 2, 3, 4, 5, 6].sort(() => r() - 0.5)
  paper.box({
    at: [x, y, z], size: [size, size, size], ry: r() * Math.PI * 2,
    faces: { front: dieFaceRect(faces[0]), back: dieFaceRect(faces[1]), left: dieFaceRect(faces[2]), right: dieFaceRect(faces[3]), top: dieFaceRect(faces[4]), bottom: dieFaceRect(faces[5]) },
  })
}

function diceTray(b: Bs, r: Rand, x: number, z: number, ry: number, w: number, d: number, nDice: number): void {
  frame([b.solid, b.paper], x, MAT_Y, z, ry, () => {
    b.solid.box({ at: [0, 0, 0], size: [w, 0.25, d], color: '#1f5a3a' })
    const t = 0.55, h = 0.95
    b.solid.box({ at: [0, 0, -d / 2 + t / 2], size: [w, h, t], color: WOOD.mid })
    b.solid.box({ at: [0, 0, d / 2 - t / 2], size: [w, h, t], color: WOOD.mid })
    b.solid.box({ at: [-w / 2 + t / 2, 0, 0], size: [t, h, d - 2 * t], color: WOOD.mid })
    b.solid.box({ at: [w / 2 - t / 2, 0, 0], size: [t, h, d - 2 * t], color: WOOD.mid })
    for (let i = 0; i < nDice; i++) die(b.paper, r, range(r, -w / 2 + 1.2, w / 2 - 1.2), 0.25, range(r, -d / 2 + 1.2, d / 2 - 1.2), 0.5)
  })
}

function clipboard(b: Bs, r: Rand, x: number, z: number, ry: number): void {
  frame([b.solid, b.paper], x, MAT_Y, z, ry, () => {
    b.solid.box({ at: [0, 0, 0], size: [7.4, 0.28, 9.8], color: WOOD.light })
    b.paper.box({ at: [0, 0.28, 0.2], size: [6.6, 0.06, 8.4], faces: { top: gridPaperRect() }, color: '#ffffff' })
    b.solid.box({ at: [0, 0.3, -4.5], size: [3.2, 0.45, 0.9], color: '#8a8f98' })
    // pencil
    b.solid.cyl({ at: [0, 0.4, 0], r: 0.14, h: 7, seg: 5, color: pick(r, ['#e0b020', '#c0392b', '#2b8aa8']), rx: Math.PI / 2, ry: 0 })
  })
}

function cluster<T>(n: number, fn: (i: number) => T): T[] { return Array.from({ length: n }, (_, i) => fn(i)) }

// ------------------------------------------------------------------------------------------ furniture
function chair(solid: Builder, x: number, z: number, ry: number, seat: string, frameCol: string): void {
  solid.frame(x, FLOOR_Y, z, ry, () => {
    for (const [lx, lz] of [[-5.4, -5.4], [5.4, -5.4], [-5.4, 5.4], [5.4, 5.4]]) solid.box({ at: [lx, 0, lz], size: [0.9, 14.2, 0.9], color: frameCol })
    solid.box({ at: [0, 14.2, 0], size: [12.6, 1.1, 12.6], color: seat })
    for (const lx of [-5.4, 5.4]) solid.box({ at: [lx, 15.3, -5.9], size: [0.9, 13, 0.9], color: frameCol })
    solid.box({ at: [0, 22, -5.9], size: [12.2, 5.6, 0.8], color: seat })
  })
}
function stool(solid: Builder, x: number, z: number, col: string): void {
  solid.frame(x, FLOOR_Y, z, 0, () => {
    for (const [lx, lz] of [[-3.4, -3.4], [3.4, -3.4], [-3.4, 3.4], [3.4, 3.4]]) solid.box({ at: [lx, 0, lz], size: [0.8, 20.5, 0.8], color: '#2f2f35' })
    solid.box({ at: [0, 8, 0], size: [7.6, 0.5, 0.5], color: '#2f2f35' })
    solid.box({ at: [0, 8, 0], size: [0.5, 0.5, 7.6], color: '#2f2f35' })
    solid.cyl({ at: [0, 20.5, 0], r: 5.4, h: 1.5, seg: 10, color: col })
  })
}

function table(b: Bs, cx: number, cz: number, w: number, d: number, topCol: string, legCol: string, textured: boolean): void {
  const top = textured ? b.wood : b.solid
  const all: Rect = [0.01, 0.01, 0.99, 0.99]
  top.box({ at: [cx, TABLE_TOP_Y - 2, cz], size: [w, 2, d], color: topCol, ...(textured ? { all } : {}) })
  const ap = textured ? b.wood : b.solid
  ap.box({ at: [cx, TABLE_TOP_Y - 6, cz - d / 2 + 2], size: [w - 4, 4, 0.8], color: legCol, ...(textured ? { all } : {}) })
  ap.box({ at: [cx, TABLE_TOP_Y - 6, cz + d / 2 - 2], size: [w - 4, 4, 0.8], color: legCol, ...(textured ? { all } : {}) })
  ap.box({ at: [cx - w / 2 + 2, TABLE_TOP_Y - 6, cz], size: [0.8, 4, d - 4], color: legCol, ...(textured ? { all } : {}) })
  ap.box({ at: [cx + w / 2 - 2, TABLE_TOP_Y - 6, cz], size: [0.8, 4, d - 4], color: legCol, ...(textured ? { all } : {}) })
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    b.solid.box({ at: [cx + sx * (w / 2 - 2.4), FLOOR_Y, cz + sz * (d / 2 - 2.4)], size: [2.6, -FLOOR_Y + TABLE_TOP_Y - 2, 2.6], color: legCol })
  }
}

function pendant(b: Bs, x: number, z: number, lamps: Lamp[], key: boolean, radius: number): void {
  const y = KEY_LIGHT_Y
  b.solid.box({ at: [x, y + 5, z], size: [0.25, CEIL_Y - y - 5, 0.25], color: '#17181a' })
  b.solid.cyl({ at: [x, y - 0.5, z], r: radius, r2: radius * 0.28, h: 5.5, seg: 12, color: '#2f4a3a', capBottom: false, capTop: false })
  b.glow.cyl({ at: [x, y - 0.4, z], r: radius * 0.93, r2: radius * 0.25, h: 5.2, seg: 12, color: '#ffd9a0', capBottom: false, capTop: false, doubleSided: true })
  b.glow.cyl({ at: [x, y - 2.4, z], r: 0.9, r2: 0.2, h: 1.6, seg: 6, color: '#fff3d0', capBottom: false })
  lamps.push({ x, z, y, radius: radius * 4, key })
}

// ------------------------------------------------------------------------------------------ shelving
interface ShelfOpts { x: number; z: number; ry: number; width: number; rows: number; style: 'games' | 'kits' | 'paint'; seed: number; floorOffset?: number }
function shelf(b: Bs, o: ShelfOpts): void {
  const r = rng(o.seed)
  const depth = 10.8
  const pitch = 13.2
  const H = o.rows * pitch + 3.5
  frame([b.solid, b.art], o.x, FLOOR_Y + (o.floorOffset ?? 0), o.z, o.ry, () => {
    const wood = WOOD.mid
    b.solid.box({ at: [0, 0, 0.2], size: [o.width, H, 0.6], color: WOOD.dark })
    for (let k = 0; k <= 1; k++) b.solid.box({ at: [(k ? 1 : -1) * (o.width / 2 - 0.5), 0, depth / 2], size: [1, H, depth], color: wood })
    const rows: number[] = []
    for (let i = 0; i <= o.rows; i++) {
      const y = i === 0 ? 3 : 3 + i * pitch
      b.solid.box({ at: [0, y - 0.4, depth / 2], size: [o.width - 2, 0.8, depth], color: i === o.rows ? WOOD.dark : WOOD.light })
      if (i < o.rows) rows.push(y + 0.4)
    }
    b.solid.box({ at: [0, 0, depth - 0.8], size: [o.width - 2, 3, 0.6], color: WOOD.dark }) // kick plate
    for (const y of rows) fillRow(b, r, o, y, depth)
  })
}
function fillRow(b: Bs, r: Rand, o: ShelfOpts, y: number, depth: number): void {
  const x0 = -o.width / 2 + 1.2, x1 = o.width / 2 - 1.2
  if (o.style === 'paint') {
    const rowsDeep = 3
    for (let k = 0; k < rowsDeep; k++) {
      for (let x = x0 + 0.8; x < x1 - 0.6; x += 1.7) b.solid.cyl({ at: [x, y, depth - 1.6 - k * 1.9], r: 0.62, h: 1.6 + (k === 0 ? 0.0 : 0.4), seg: 5, color: pick(r, PAINTS) })
    }
    return
  }
  const mode = o.style === 'kits' ? 'kit' : pick(r, ['face', 'spine', 'spine', 'mix', 'face'] as const)
  let x = x0 + 0.3
  while (x < x1 - 4) {
    if (r() < 0.06) { x += range(r, 2, 6); continue }
    const cell = 1 + Math.floor(r() * ART_DESIGNS)
    const tone = pick(r, BOX_TONES)
    const thick = range(r, 1.6, 3.6)
    const bh = range(r, 9.5, 12.3)
    const bw = range(r, 7.2, 9.6)
    const useMode = mode === 'mix' ? (r() < 0.5 ? 'face' : 'spine') : mode
    if (useMode === 'face') {
      b.art.box({ at: [x + bw / 2, y, depth - thick / 2 - 0.9], size: [bw, bh, thick], faces: { front: artCover(cell), top: artCover(cell) }, color: tone })
      x += bw + 0.15
    } else if (useMode === 'spine') {
      b.art.box({ at: [x + thick / 2, y, depth - bw / 2 - 0.5], size: [bw, bh, thick], ry: -Math.PI / 2, faces: { right: artSpine(cell) }, color: tone })
      x += thick + 0.06
    } else { // kit: small stack of flat model-kit boxes
      const n = 2 + Math.floor(r() * 3)
      const kw = range(r, 6.5, 8.5), kd = range(r, 4.5, 6.2), kh = range(r, 1.6, 2.4)
      for (let i = 0; i < n; i++) b.art.box({ at: [x + kw / 2, y + i * (kh + 0.02), depth / 2 + 0.2], size: [kw, kh, kd], ry: (r() - 0.5) * 0.12, faces: { top: artCover(1 + Math.floor(r() * ART_DESIGNS)) }, color: pick(r, BOX_TONES) })
      x += kw + 0.4
    }
  }
}

// ------------------------------------------------------------------------------------------ the room
function room(b: Bs): void {
  const { x0, x1, z0, z1 } = ROOM
  const W = x1 - x0, D = z1 - z0, H = CEIL_Y - FLOOR_Y
  const cream = '#d1bd96', wain = '#5b3a29'
  // wall shells (outer faces hidden behind the interior surfaces)
  b.solid.box({ at: [0, FLOOR_Y, z0 - 1], size: [W + 4, H, 2], color: cream })
  b.solid.box({ at: [0, FLOOR_Y, z1 + 1], size: [W + 4, H, 2], color: cream })
  b.solid.box({ at: [x0 - 1, FLOOR_Y, (z0 + z1) / 2], size: [2, H, D], color: cream })
  b.solid.box({ at: [x1 + 1, FLOOR_Y, (z0 + z1) / 2], size: [2, H, D], color: cream })
  // wainscot, baseboard, trim
  const trim = (cx: number, cz: number, sx: number, sz: number): void => {
    b.solid.box({ at: [cx, FLOOR_Y, cz], size: [sx, 30, sz], color: wain })
    b.solid.box({ at: [cx, FLOOR_Y + 29.5, cz], size: [sx, 0.9, sz + 0.5], color: WOOD.light })
    b.solid.box({ at: [cx, FLOOR_Y, cz], size: [sx, 3, sz + 0.4], color: WOOD.dark })
    b.solid.box({ at: [cx, CEIL_Y - 1.5, cz], size: [sx, 1.5, sz + 0.6], color: WOOD.dark })
  }
  trim(0, z0 + 0.25, W, 0.5); trim(0, z1 - 0.25, W, 0.5)
  trim(x0 + 0.25, (z0 + z1) / 2, 0.5, D); trim(x1 - 0.25, (z0 + z1) / 2, 0.5, D)
  // ceiling with beams
  b.solid.box({ at: [0, CEIL_Y, (z0 + z1) / 2], size: [W, 1, D], color: '#2c2420' })
  for (let x = x0 + 21; x < x1; x += 42) b.solid.box({ at: [x, CEIL_Y - 4, (z0 + z1) / 2], size: [3.2, 4, D], color: WOOD.dark })
  // rug under the play table
  b.solid.box({ at: [0, FLOOR_Y, 0], size: [72, 0.12, 56], color: '#6f2a26' })
  b.solid.box({ at: [0, FLOOR_Y + 0.12, 0], size: [68, 0.08, 52], color: '#d8c9a0' })
  b.solid.box({ at: [0, FLOOR_Y + 0.2, 0], size: [64, 0.08, 48], color: '#2d3f55' })
  b.solid.box({ at: [0, FLOOR_Y + 0.28, 0], size: [56, 0.08, 40], color: '#6f2a26' })
}

function windows(b: Bs, lampsOut: Lamp[]): void {
  void lampsOut
  const mk = (z: number): void => {
    const x = ROOM.x1 - 0.7
    const y0 = FLOOR_Y + 32, wH = 40, wW = 42
    b.glow.push(x, y0, z, -Math.PI / 2)
    const L = -wW / 2, R = wW / 2
    const top = y0 + wH
    const cols = ['#f0a35a', '#e8805a', '#7a6aa8', '#3a4f86']
    for (let i = 0; i < 3; i++) {
      const ya = y0 + (i * wH) / 3 - y0, yb = y0 + ((i + 1) * wH) / 3 - y0
      void top
      b.glow.quad([[L, ya, 0], [R, ya, 0], [R, yb, 0], [L, yb, 0]], [cols[i], cols[i], cols[i + 1], cols[i + 1]])
    }
    b.glow.pop()
    b.solid.frame(x, y0, z, -Math.PI / 2, () => {
      b.solid.box({ at: [0, -2.5, 0.3], size: [wW + 6, 2.5, 3.2], color: WOOD.light })
      for (const sx of [-1, 0, 1]) b.solid.box({ at: [sx * (wW / 2), 0, 0.1], size: [1.4, wH, 1], color: '#efe6d2' })
      for (const sy of [0, 1 / 2, 1]) b.solid.box({ at: [0, wH * sy - (sy === 1 ? 1.4 : 0), 0.1], size: [wW + 1.4, 1.4, 1], color: '#efe6d2' })
    })
  }
  mk(-58); mk(-8); mk(42)
}

function posterOn(b: Bs, x: number, y: number, z: number, ry: number, idx: number, w = 14, h = 19): void {
  frame([b.solid, b.paper], x, y, z, ry, () => {
    b.solid.box({ at: [0, 0, 0.05], size: [w + 1.2, h + 1.2, 0.4], color: '#14110e' })
    b.paper.box({ at: [0, 0.6, 0.3], size: [w, h, 0.1], faces: { front: posterRect(idx % POSTER_COUNT) } })
  })
}

function corkboard(b: Bs, r: Rand, x: number, y: number, z: number, ry: number): void {
  frame([b.solid, b.paper], x, y, z, ry, () => {
    const w = 56, h = 32
    b.solid.box({ at: [0, 0, 0.1], size: [w + 2.4, h + 2.4, 0.7], color: WOOD.dark })
    b.paper.box({ at: [0, 1.2, 0.5], size: [w, h, 0.2], faces: { front: corkRect() } })
    for (let i = 0; i < FLYER_COUNT; i++) {
      const fx = -w / 2 + 4.5 + (i % 8) * 6.9 + range(r, -0.6, 0.6)
      const fy = 1.2 + (i < 8 ? h * 0.52 : h * 0.1) + range(r, -0.8, 0.8)
      b.paper.box({ at: [fx, fy, 0.7], size: [5.1, 7.1, 0.06], rz: (r() - 0.5) * 0.14, faces: { front: flyerRect(i) } })
      b.solid.cyl({ at: [fx, fy + 6.2, 0.78], r: 0.25, h: 0.3, seg: 4, color: pick(r, ['#c0392b', '#2f5aa8', '#e0c030']), rx: Math.PI / 2 })
    }
  })
}

function counter(b: Bs, r: Rand): void {
  const cx = 70, cz = -150
  frame(allOf(b), cx, FLOOR_Y, cz, 0, () => {
    b.solid.box({ at: [0, 0, 0], size: [78, 33, 13], color: WOOD.mid })
    b.solid.box({ at: [0, 33, 1], size: [80, 1.4, 16], color: WOOD.pale })
    b.solid.box({ at: [-38.5, 0, 12], size: [13, 33, 24], color: WOOD.mid })
    b.solid.box({ at: [-38.5 + 0.3, 33, 12], size: [14, 1.4, 26], color: WOOD.pale })
    for (let i = 0; i < 6; i++) b.solid.box({ at: [-34 + i * 12, 3, 6.7], size: [10, 26, 0.3], color: WOOD.dark })
    // register
    b.solid.box({ at: [-4, 34.4, 0], size: [10, 3.2, 9], color: '#cfc6b0' })
    b.solid.box({ at: [-4, 37.6, -1.2], size: [8, 7, 0.9], color: '#25282d', rx: -0.35 })
    b.glow.box({ at: [-4, 38.4, -0.6], size: [6.4, 5, 0.1], color: '#8fe0b0', rx: -0.35 })
    b.solid.box({ at: [-4, 34.4, 4.6], size: [8.5, 0.5, 1.4], color: '#9aa0a8' })
    // tip jar, bell, dice dish, stacked dice tins
    b.glass.cyl({ at: [8, 34.4, 3], r: 2.1, h: 4.4, seg: 8, color: '#c9e6e0' })
    for (let i = 0; i < 6; i++) b.solid.cyl({ at: [8 + range(r, -1, 1), 34.4 + i * 0.35, 3 + range(r, -1, 1)], r: 0.45, h: 0.18, seg: 6, color: '#d3a24a' })
    b.solid.cyl({ at: [14, 34.4, 4], r: 1.3, r2: 0.8, h: 1.2, seg: 8, color: '#c9a227' })
    for (let i = 0; i < 4; i++) b.solid.cyl({ at: [22 + i * 4.4, 34.4, 3], r: 1.7, h: 2.2, seg: 8, color: pick(r, PAINTS) })
    // card display stand
    b.art.box({ at: [31, 34.4, 3], size: [6, 8, 0.4], faces: { front: artCover(5) }, rx: -0.2 })
    // sign above counter
    b.paper.box({ at: [0, 54, -8], size: [38, 9.5, 0.6], faces: { front: signRect() } })
  })
  chair(b.solid, cx - 8, cz - 8, 0, '#3b3f48', '#222')
}

function displayCase(b: Bs, r: Rand): void {
  const x = ROOM.x0 + 6.5, z = -30
  frame(allOf(b), x, FLOOR_Y, z, Math.PI / 2, () => {
    const w = 46, d = 13
    b.solid.box({ at: [0, 0, 0], size: [w, 22, d], color: WOOD.mid })
    b.solid.box({ at: [0, 22, 0], size: [w + 1, 0.9, d + 1], color: WOOD.light })
    const gh = 44
    for (const sx of [-1, 1]) b.solid.box({ at: [sx * (w / 2 - 0.4), 22.9, 0], size: [0.8, gh, d - 0.5], color: WOOD.dark })
    b.solid.box({ at: [0, 22.9 + gh, 0], size: [w + 1, 1.2, d + 1], color: WOOD.dark })
    b.solid.box({ at: [0, 22.9, -d / 2 + 0.3], size: [w - 1, gh, 0.5], color: '#2b221b' })
    b.glass.box({ at: [0, 22.9, d / 2 - 0.2], size: [w - 1, gh, 0.15], color: '#cfe6f0' })
    for (let s = 0; s < 3; s++) {
      const sy = 22.9 + s * 14 + 0.6
      b.glass.box({ at: [0, sy, 0], size: [w - 2, 0.3, d - 1], color: '#cfe6f0' })
      b.glow.box({ at: [0, sy + 12.2, 0], size: [w - 2, 0.25, d - 2], color: '#ffe9b8' }) // little strip light
      const n = 6
      for (let i = 0; i < n; i++) {
        const px = -w / 2 + 4.5 + i * ((w - 9) / (n - 1))
        statuette(b.solid, px, sy + 0.3, 0.5, (r() - 0.5) * 0.6, 1.7, pick(r, ['#8a2f2a', '#2e5a7a', '#c0a030', '#4a6a2c', '#7a7f88', '#a0501e']), pick(r, ['#e8e0c8', '#c9a227', '#d0402b', '#e08a1e']), i + s)
        b.solid.cyl({ at: [px, sy + 0.3, 0.5], r: 1.5, h: 0.2, seg: 8, color: '#1d1d20' })
      }
    }
  })
}

function tableSet(b: Bs, r: Rand, cx: number, cz: number, kind: 'terrain' | 'cards' | 'paint', lamps: Lamp[]): void {
  const w = 38, d = 24
  table(b, cx, cz, w, d, '#9b6b3e', '#4a2e1c', false)
  pendant(b, cx, cz, lamps, false, 5)
  const y = TABLE_TOP_Y
  if (kind === 'terrain') {
    b.solid.box({ at: [cx, y, cz], size: [w - 3, 0.12, d - 3], color: '#b79a66' })
    for (let i = 0; i < 8; i++) {
      const bx = cx + range(r, -w / 2 + 5, w / 2 - 5), bz = cz + range(r, -d / 2 + 4, d / 2 - 4)
      const bw = range(r, 2.2, 4.4), bd = range(r, 2.2, 4.0), bh = range(r, 1.4, 3.6)
      b.solid.box({ at: [bx, y + 0.12, bz], size: [bw, bh, bd], color: pick(r, ['#8a8e92', '#a69f94', '#7b7f86']), ry: r() * 1.5 })
      b.solid.box({ at: [bx, y + 0.12 + bh, bz], size: [bw + 0.3, 0.25, bd + 0.3], color: '#5c5f66', ry: 0 })
    }
    for (let i = 0; i < 10; i++) {
      const tx = cx + range(r, -w / 2 + 3, w / 2 - 3), tz = cz + range(r, -d / 2 + 3, d / 2 - 3)
      b.solid.cyl({ at: [tx, y + 0.12, tz], r: 0.2, h: 1, seg: 4, color: '#5a3a1c' })
      b.solid.cyl({ at: [tx, y + 0.8, tz], r: 0.95, r2: 0, h: 2.6, seg: 6, color: pick(r, ['#2e6a34', '#3d7a3a', '#245a2c']) })
    }
    for (let i = 0; i < 5; i++) b.solid.cyl({ at: [cx + range(r, -12, 12), y + 0.1, cz + range(r, -8, 8)], r: range(r, 2, 3.5), r2: range(r, 0.6, 1.2), h: range(r, 0.6, 1.2), seg: 7, color: '#a28a58' })
    for (let i = 0; i < 6; i++) statuette(b.solid, cx + range(r, -9, 9), y + 0.12, cz + range(r, -6, 6), r() * 6.28, 1, pick(r, ['#8a2f2a', '#2e5a7a', '#c0a030']), '#e8e0c8', i)
  } else if (kind === 'cards') {
    b.solid.box({ at: [cx, y, cz], size: [w - 3, 0.1, d - 3], color: '#2d4a3a' })
    b.art.box({ at: [cx, y + 0.1, cz], size: [13, 0.25, 13], faces: { top: artCover(9) }, color: '#ccc' })
    for (let i = 0; i < 10; i++) {
      const ang = (i / 10) * Math.PI * 2
      b.art.box({ at: [cx + Math.cos(ang) * 11, y + 0.1, cz + Math.sin(ang) * 7], size: [2.6, 0.03, 3.6], ry: -ang + 0.5, faces: { top: artCover(10 + i) }, color: '#eee' })
    }
    for (let i = 0; i < 24; i++) b.solid.cyl({ at: [cx + range(r, -14, 14), y + 0.1, cz + range(r, -9, 9)], r: 0.45, h: 0.35, seg: 6, color: pick(r, PAINTS) })
    for (let i = 0; i < 5; i++) b.solid.cyl({ at: [cx + range(r, -8, 8), y + 0.1, cz + range(r, -6, 6)], r: 0.45, r2: 0.25, h: 1.2, seg: 5, color: pick(r, PAINTS) })
  } else {
    b.solid.box({ at: [cx, y, cz], size: [w - 3, 0.06, d - 3], color: '#d8d2c0' })
    for (let i = 0; i < 12; i++) b.solid.cyl({ at: [cx - 14 + (i % 6) * 1.6, y + 0.06, cz - 8 + Math.floor(i / 6) * 1.7], r: 0.62, h: 1.5, seg: 5, color: pick(r, PAINTS) })
    for (let i = 0; i < 5; i++) b.solid.cyl({ at: [cx - 2 + i * 1.1, y + 0.06, cz + 6], r: 0.18, h: 6, seg: 4, color: pick(r, ['#c0392b', '#2b8aa8', '#e0b020']), rz: 0.5 })
    for (let i = 0; i < 4; i++) statuette(b.solid, cx + 6 + i * 3.2, y + 0.06, cz - 3 + (i % 2) * 3, 0.4, 1.3, pick(r, ['#8a2f2a', '#2e5a7a', '#c0a030']), '#e8e0c8', i)
    b.solid.cyl({ at: [cx + 12, y + 0.06, cz + 7], r: 1.6, h: 0.5, seg: 8, color: '#2a2c30' })
    b.solid.box({ at: [cx + 12, y + 0.56, cz + 7], size: [0.4, 7, 0.4], color: '#2a2c30' })
    b.solid.box({ at: [cx + 12, y + 7.2, cz + 7.6], size: [0.4, 0.4, 5], color: '#2a2c30' })
    b.glow.cyl({ at: [cx + 12, y + 6.6, cz + 10], r: 1.2, r2: 2.4, h: 1.2, seg: 8, color: '#fff0c0', capBottom: false })
  }
  const chairs: Array<[number, number, number]> = [
    [cx - 7, cz + d / 2 + 5, Math.PI], [cx + 7, cz + d / 2 + 5, Math.PI], [cx - 7, cz - d / 2 - 5, 0], [cx + 7, cz - d / 2 - 5, 0], [cx - w / 2 - 5, cz, Math.PI / 2],
  ]
  chairs.forEach(([x, z, ry], i) => { if (i < (kind === 'paint' ? 3 : 5)) chair(b.solid, x, z, ry, pick(r, ['#3b3f48', '#7a2f2a', '#2f5a52']), '#2a221c') })
}

function extras(b: Bs, r: Rand): void {
  // potted plants, bins, a floor lamp, a bench by the window
  const plant = (x: number, z: number, s: number): void => {
    b.solid.cyl({ at: [x, FLOOR_Y, z], r: 2.2 * s, r2: 1.6 * s, h: 4 * s, seg: 8, color: '#a0502e' })
    for (let i = 0; i < 7; i++) b.solid.cyl({ at: [x + range(r, -0.7, 0.7) * s, FLOOR_Y + 4 * s, z + range(r, -0.7, 0.7) * s], r: 1.0 * s, r2: 0, h: range(r, 5, 9) * s, seg: 4, color: pick(r, ['#2e6a34', '#3d7a3a', '#4a8a40']), rz: range(r, -0.5, 0.5) })
  }
  plant(ROOM.x1 - 6, -33, 1.4); plant(ROOM.x1 - 6, 17, 1.2); plant(ROOM.x0 + 5, 40, 1.3); plant(ROOM.x0 + 5, -110, 1.2)
  b.solid.cyl({ at: [-30, FLOOR_Y, -138], r: 2.4, h: 8, seg: 8, color: '#3c4048' })
  // floor lamp
  b.solid.cyl({ at: [ROOM.x1 - 8, FLOOR_Y, 62], r: 1.8, h: 0.5, seg: 8, color: '#222' })
  b.solid.box({ at: [ROOM.x1 - 8, FLOOR_Y, 62], size: [0.4, 50, 0.4], color: '#222' })
  b.glow.cyl({ at: [ROOM.x1 - 8, FLOOR_Y + 46, 62], r: 4.4, r2: 3, h: 7, seg: 8, color: '#ffd9a0', capTop: false, capBottom: false, doubleSided: true })
  // window bench
  b.solid.box({ at: [ROOM.x1 - 6, FLOOR_Y, 80], size: [8, 14, 36], color: WOOD.mid })
  b.solid.box({ at: [ROOM.x1 - 6, FLOOR_Y + 14, 80], size: [8.4, 2, 36.4], color: '#7a2f2a' })
  // door on the south wall
  b.solid.box({ at: [60, FLOOR_Y, ROOM.z1 - 0.7], size: [26, 62, 1.2], color: WOOD.mid })
  b.glass.box({ at: [60, FLOOR_Y + 30, ROOM.z1 - 1.4], size: [18, 26, 0.2], color: '#cfe6f0' })
  // coat rack
  b.solid.cyl({ at: [-100, FLOOR_Y, 100], r: 0.5, h: 56, seg: 5, color: WOOD.dark })
  for (let i = 0; i < 4; i++) b.solid.box({ at: [-100, FLOOR_Y + 52, 100], size: [8, 0.5, 0.5], ry: (i * Math.PI) / 4, color: WOOD.dark })
}

// ------------------------------------------------------------------------------------------ the play table and clutter
function playTable(b: Bs, r: Rand, o: ShopOptions, lamps: Lamp[]): void {
  const t = tableSize(o)
  const all: Rect = [0.01, 0.01, 0.99, 0.99]
  table(b, 0, 0, t.width, t.depth, '#ffffff', '#8a5a34', true)
  // neoprene mat (sits just under the board's own surface)
  b.solid.box({ at: [0, MAT_Y - 0.08, 0], size: [t.width - 3, 0.05, t.depth - 3], color: '#2b3b36' })
  void all
  pendant(b, 0, 0, lamps, true, 7)
  const hx = t.width / 2, bx = o.boardWidth / 2 + 3.5
  // right end: dice tray, clipboards, pencils (everything stays clear of the map and its surround)
  diceTray(b, r, hx - 5.2, -9.5, 0.1, 8.4, 5.8, 6)
  clipboard(b, r, hx - 4.8, 0.5, -0.06)
  frame([b.solid, b.paper], hx - 7, 0, 10.2, Math.PI / 2 + 0.1, () => { clipboard(b, r, 0, 0, 0) })
  for (let i = 0; i < 3; i++) b.solid.cyl({ at: [hx - 10.5 + i * 0.5, MAT_Y + 0.14, -4 + i * 0.7], r: 0.14, h: 6, seg: 5, color: pick(r, ['#e0b020', '#c0392b', '#2b8aa8']), rx: Math.PI / 2, ry: 0.6 + i * 0.2 })
  // left end: binder, soda can, carry case
  frame([b.solid, b.paper], -hx + 5, MAT_Y, 8.4, 0.12, () => {
    b.solid.box({ at: [0, 0, 0], size: [8.6, 2.3, 11], color: '#2e3a52' })
    b.solid.box({ at: [-4.1, 0, 0], size: [1.0, 2.3, 11], color: '#1d2536' })
    b.paper.box({ at: [0, 2.3, 0], size: [5.5, 0.05, 1.7], faces: { top: binderLabelRect() }, ry: Math.PI / 2 })
    for (let i = 0; i < 3; i++) b.solid.cyl({ at: [-4.1, 0.4 + i * 0.7, -3.4 + i * 3.4], r: 0.45, h: 0.5, seg: 6, color: '#b8bcc4', rx: Math.PI / 2 })
  })
  b.paper.cyl({ at: [-hx + 11.2, MAT_Y, 12.2], r: 0.85, h: 2.4, seg: 10, color: '#e8644a' }) // soda can
  b.paper.box({ at: [-hx + 11.2, MAT_Y + 0.4, 12.2 + 0.86], size: [1.3, 1.5, 0.02], faces: { front: canLabelRect() } })
  b.solid.cyl({ at: [-hx + 11.2, MAT_Y + 2.4, 12.2], r: 0.7, h: 0.1, seg: 8, color: '#c8ccd2' })
  frame([b.solid], -hx + 5, MAT_Y, -7.5, Math.PI / 2 - 0.1, () => {
    b.solid.box({ at: [0, 0, 0], size: [13.5, 4.2, 9], color: '#25272c' })
    b.solid.box({ at: [0, 4.2, 0], size: [13.7, 0.5, 9.2], color: '#3a3d44' })
    b.solid.box({ at: [-4, 0.8, 4.55], size: [1.4, 1.2, 0.3], color: '#b8bcc4' })
    b.solid.box({ at: [4, 0.8, 4.55], size: [1.4, 1.2, 0.3], color: '#b8bcc4' })
    b.solid.box({ at: [0, 4.7, 0], size: [4, 0.6, 1], color: '#25272c' })
  })
  for (let i = 0; i < 9; i++) {
    const side = r() < 0.5 ? -1 : 1
    die(b.paper, r, side * range(r, 9.8, hx - 2), MAT_Y, range(r, -t.depth / 2 + 1.2, t.depth / 2 - 1.2), 0.5)
  }
  void bx
  stool(b.solid, -hx - 6, 4, '#7a2f2a'); stool(b.solid, hx + 6, -4, '#7a2f2a')
}

// ------------------------------------------------------------------------------------------ assemble
export function buildShop(opts: Partial<ShopOptions> = {}): ShopGeometry {
  const o: ShopOptions = { ...DEFAULT_BOARD, ...opts }
  const rand = rng(20261008)
  const mk = (): Bs => ({
    solid: new Builder(), art: new Builder(artWhite()), paper: new Builder(paperWhite()), wood: new Builder(), glow: new Builder(), glass: new Builder(),
  })
  const near = mk(), far = mk()
  const lamps: Lamp[] = []
  playTable(near, rand, o, lamps)
  room(far)
  windows(far, lamps)
  displayCase(far, rand)
  counter(far, rand)
  extras(far, rand)
  tableSet(far, rand, -78, -78, 'terrain', lamps)
  tableSet(far, rand, 84, -62, 'cards', lamps)
  tableSet(far, rand, -84, 62, 'paint', lamps)
  // wall shelving: north wall (games), west wall (kits + paint), east between windows, south
  const { x0, x1, z0, z1 } = ROOM
  let seed = 100
  for (let i = 0; i < 4; i++) shelf(far, { x: x0 + 34 + i * 62, z: z0, ry: 0, width: 60, rows: 6, style: 'games', seed: seed++ })
  shelf(far, { x: 70, z: z0, ry: 0, width: 80, rows: 2, style: 'kits', seed: seed++, floorOffset: 40 })
  for (let k = 0; k < 2; k++) shelf(far, { x: x0 + 8 + 4 * 0, z: -140 + k * 0 + (k ? 28 : 0) - 4, ry: Math.PI / 2, width: 52, rows: 6, style: k ? 'kits' : 'games', seed: seed++ })
  for (let i = 0; i < 2; i++) shelf(far, { x: x0, z: 36 + i * 54, ry: Math.PI / 2, width: 52, rows: 6, style: i ? 'paint' : 'games', seed: seed++ })
  for (let i = 0; i < 2; i++) shelf(far, { x: x1, z: -122 + i * 54, ry: -Math.PI / 2, width: 52, rows: 6, style: i ? 'kits' : 'games', seed: seed++ })
  for (let i = 0; i < 3; i++) shelf(far, { x: -90 + i * 62, z: z1, ry: Math.PI, width: 60, rows: 5, style: i === 1 ? 'paint' : 'games', seed: seed++ })
  // free-standing gondolas
  for (const gx of [-52, 14]) {
    shelf(far, { x: gx, z: -112, ry: 0, width: 56, rows: 4, style: 'games', seed: seed++ })
    shelf(far, { x: gx, z: -112, ry: Math.PI, width: 56, rows: 4, style: 'kits', seed: seed++ })
  }
  // posters and corkboards
  for (let i = 0; i < 6; i++) posterOn(far, x0 + 36 + i * 38, FLOOR_Y + 70, z0 + 0.6, 0, i)
  for (let i = 0; i < 3; i++) posterOn(far, x0 + 0.6, FLOOR_Y + 66, -80 + i * 23, Math.PI / 2, i + 1)
  for (let i = 0; i < 3; i++) posterOn(far, x1 - 0.6, FLOOR_Y + 66, -110 + i * 22, -Math.PI / 2, i + 2)
  corkboard(far, rand, 8, FLOOR_Y + 48, z1 - 0.7, Math.PI)
  corkboard(far, rand, x0 + 0.8, FLOOR_Y + 46, 14, Math.PI / 2)
  const bufs = (s: Bs) => ({ solid: s.solid.output(), art: s.art.output(), paper: s.paper.output(), wood: s.wood.output() })
  const nearOut = bufs(near)
  const roomOut = bufs(far)
  const glow = new Builder()
  const mergeGlow = [near.glow.output(), far.glow.output()]
  const glass = [near.glass.output(), far.glass.output()]
  void glow
  const cat = (a: BuilderOutput, c: BuilderOutput): BuilderOutput => ({
    position: concat(a.position, c.position), normal: concat(a.normal, c.normal), uv: concat(a.uv, c.uv), color: concat(a.color, c.color), triangles: a.triangles + c.triangles,
  })
  const glowOut = cat(mergeGlow[0], mergeGlow[1]), glassOut = cat(glass[0], glass[1])
  const tris = [nearOut, { solid: roomOut.solid, art: roomOut.art, paper: roomOut.paper, wood: roomOut.wood }].reduce((n, g) => n + g.solid.triangles + g.art.triangles + g.paper.triangles + g.wood.triangles, 0) + glowOut.triangles + glassOut.triangles
  return {
    near: nearOut, room: { solid: roomOut.solid, art: roomOut.art, paper: roomOut.paper }, glow: glowOut, glass: glassOut, lamps, table: tableSize(o), triangles: tris,
  }
}

function concat(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(a.length + b.length); out.set(a, 0); out.set(b, a.length); return out
}

void cluster
