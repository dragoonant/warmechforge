// Hex prism geometry: flat-topped, a small chamfer on the top edge, a hair-thin gap to its neighbours, layered strata colours
// on the sides. One geometry per distinct level (all tiles of that level share it as an InstancedMesh); y values are absolute
// world heights, instances only translate x/z (+ a tiny jitter), so strata line up across neighbouring tiles.
import { BufferGeometry, Float32BufferAttribute } from 'three'
import { LEVEL_HEIGHT } from '../../engine/types'

/** Gap between neighbouring prisms (world units). Hair thin: it reads as a groove, not a hole. */
export const TILE_GAP = 0.016
export const BEVEL_WIDTH = 0.032
export const BEVEL_DROP = 0.026
/** Apothem (centre to flat edge) and circumradius of the prism outline, and of the flat top face. */
export const A_OUT = 0.5 - TILE_GAP / 2
export const R_OUT = A_OUT / Math.cos(Math.PI / 6)
export const A_IN = A_OUT - BEVEL_WIDTH
export const R_IN = A_IN / Math.cos(Math.PI / 6)
/** Height of one strata band on the cliff sides. */
export const STRATA_BAND = LEVEL_HEIGHT / 4
/** Texture scale on the cliff sides (units per texture repeat is the reciprocal). */
export const CLIFF_UV = { u: 0.8, v: 1.1 }

const corner = (i: number, r: number): [number, number] => { const a = (i * Math.PI) / 3; return [r * Math.cos(a), r * Math.sin(a)] }

type V = { p: [number, number, number]; c: [number, number, number]; uv: [number, number] }
interface Buf { pos: number[]; nor: number[]; col: number[]; uv: number[] }
const newBuf = (): Buf => ({ pos: [], nor: [], col: [], uv: [] })

/** Push a triangle, flipping its winding so the face normal points along `hint` (a rough outward direction). */
function tri(b: Buf, a: V, bb: V, c: V, hint: [number, number, number]): void {
  const e1 = [bb.p[0] - a.p[0], bb.p[1] - a.p[1], bb.p[2] - a.p[2]], e2 = [c.p[0] - a.p[0], c.p[1] - a.p[1], c.p[2] - a.p[2]]
  let n: [number, number, number] = [e1[1]! * e2[2]! - e1[2]! * e2[1]!, e1[2]! * e2[0]! - e1[0]! * e2[2]!, e1[0]! * e2[1]! - e1[1]! * e2[0]!]
  const len = Math.hypot(n[0], n[1], n[2]) || 1
  n = [n[0] / len, n[1] / len, n[2] / len]
  let v1 = bb, v2 = c
  if (n[0] * hint[0] + n[1] * hint[1] + n[2] * hint[2] < 0) { v1 = c; v2 = bb; n = [-n[0], -n[1], -n[2]] }
  for (const v of [a, v1, v2]) { b.pos.push(...v.p); b.nor.push(...n); b.col.push(...v.c); b.uv.push(...v.uv) }
}

export interface TileGeometryOpts {
  /** Absolute world y of the solid top of this level. */
  topY: number
  /** Absolute world y of the slab bottom. */
  baseY: number
  /** Colour of the chamfer's outer edge (the dark top-edge line). */
  lipShade?: number
}

/** Group 0 = top cap + chamfer (ground material), group 1 = sides (cliff material). */
export function buildTileGeometry(o: TileGeometryOpts): BufferGeometry {
  const { topY, baseY } = o
  const lip = o.lipShade ?? 0.52
  const white: [number, number, number] = [1, 1, 1]
  const top = newBuf(), side = newBuf()
  const yLip = topY - BEVEL_DROP
  // flat top: a fan of six triangles around the centre
  const centre: V = { p: [0, topY, 0], c: white, uv: [0, 0] }
  for (let i = 0; i < 6; i++) {
    const [x0, z0] = corner(i, R_IN), [x1, z1] = corner(i + 1, R_IN)
    tri(top, centre, { p: [x0, topY, z0], c: white, uv: [0, 0] }, { p: [x1, topY, z1], c: white, uv: [0, 0] }, [0, 1, 0])
  }
  // chamfer: outer ring (dark lip) up to the inner ring
  const lc: [number, number, number] = [lip, lip, lip]
  for (let i = 0; i < 6; i++) {
    const [ox0, oz0] = corner(i, R_OUT), [ox1, oz1] = corner(i + 1, R_OUT), [ix0, iz0] = corner(i, R_IN), [ix1, iz1] = corner(i + 1, R_IN)
    const mx = Math.cos(((i + 0.5) * Math.PI) / 3), mz = Math.sin(((i + 0.5) * Math.PI) / 3)
    const hint: [number, number, number] = [mx * 0.6, 0.8, mz * 0.6]
    const A: V = { p: [ox0, yLip, oz0], c: lc, uv: [0, 0] }, B: V = { p: [ox1, yLip, oz1], c: lc, uv: [0, 0] }
    const C: V = { p: [ix1, topY, iz1], c: white, uv: [0, 0] }, D: V = { p: [ix0, topY, iz0], c: white, uv: [0, 0] }
    tri(top, A, B, C, hint); tri(top, A, C, D, hint)
  }
  // sides: one quad per face; the strata colour bands are computed per fragment from world height (see materials.ts)
  const edge = R_OUT
  const sc: [number, number, number] = [1, 1, 1]
  for (let i = 0; i < 6; i++) {
    const [x0, z0] = corner(i, R_OUT), [x1, z1] = corner(i + 1, R_OUT)
    const hint: [number, number, number] = [Math.cos(((i + 0.5) * Math.PI) / 3), 0, Math.sin(((i + 0.5) * Math.PI) / 3)]
    const u0 = i * edge * CLIFF_UV.u, u1 = (i + 1) * edge * CLIFF_UV.u
    const a: V = { p: [x0, baseY, z0], c: sc, uv: [u0, baseY * CLIFF_UV.v] }, b: V = { p: [x1, baseY, z1], c: sc, uv: [u1, baseY * CLIFF_UV.v] }
    const d: V = { p: [x1, yLip, z1], c: sc, uv: [u1, yLip * CLIFF_UV.v] }, e: V = { p: [x0, yLip, z0], c: sc, uv: [u0, yLip * CLIFF_UV.v] }
    tri(side, a, b, d, hint); tri(side, a, d, e, hint)
  }
  const g = new BufferGeometry()
  const all = (k: keyof Buf) => [...top[k], ...side[k]]
  g.setAttribute('position', new Float32BufferAttribute(all('pos'), 3))
  g.setAttribute('normal', new Float32BufferAttribute(all('nor'), 3))
  g.setAttribute('color', new Float32BufferAttribute(all('col'), 3))
  g.setAttribute('uv', new Float32BufferAttribute(all('uv'), 2))
  g.addGroup(0, top.pos.length / 3, 0)
  g.addGroup(top.pos.length / 3, side.pos.length / 3, 1)
  g.computeBoundingSphere(); g.computeBoundingBox()
  return g
}
