// Water surface: ONE merged, static mesh for every water hex. A recessed translucent plane tinted by depth; vertex colour and alpha
// fade toward a pale, clearer shoreline where a neighbour is dry or the board ends, so the shore is soft and the same corner
// colours are shared by every hex that meets there (no seams between water hexes).
import { BufferGeometry, Color, Float32BufferAttribute } from 'three'
import type { BoardState } from '../../engine/types'
import { LEVEL_HEIGHT } from '../../engine/types'
import { hexToLabel, neighbors } from '../../engine/hex'
import type { BoardTheme } from './boards'
import { WATER_DROP, type BoardLayout, type TileInfo } from './layout'
import { R_OUT } from './tileGeometry'

/** Edge k of a flat-topped hex (between corner k and k+1, corners at k*60 degrees) faces this engine facing. */
export const EDGE_FACING = [2, 3, 4, 5, 0, 1] as const

/** Surface opacity by depth (spec: 0.55, 0.7, 0.8 for depth 1, 2, 3+). */
export const waterOpacity = (depth: number): number => (depth <= 1 ? 0.55 : depth === 2 ? 0.7 : 0.8)

export function buildWaterGeometry(layout: BoardLayout, board: BoardState, theme: BoardTheme, low: boolean): BufferGeometry | null {
  const wet = layout.tiles.filter((t) => t.depth > 0)
  if (!wet.length) return null
  const pos: number[] = [], col: number[] = []
  const shallow = new Color(theme.water.shallow), deep = new Color(theme.water.deep), shore = new Color(theme.water.shore), tmp = new Color()
  const R = R_OUT + 0.008 // meets the neighbouring water hex with no gap; the dry hexes' chamfers frame the shore
  const isLand = (t: TileInfo, k: number): boolean => {
    const h = neighbors(t.hex)[EDGE_FACING[k]!]!
    const l = hexToLabel(board, h)
    const n = l ? layout.byLabel.get(l) : undefined
    return !n || n.depth === 0
  }
  for (const t of wet) {
    const y = (t.surfaceLevel ?? t.topLevel) * LEVEL_HEIGHT - WATER_DROP
    const d = Math.min(3, t.depth)
    const base = shallow.clone().lerp(deep, (d - 1) / 2)
    const a0 = low ? 1 : waterOpacity(t.depth)
    const land = [0, 1, 2, 3, 4, 5].map((k) => isLand(t, k))
    const cornerS = (i: number): number => ((land[(i + 5) % 6] ? 1 : 0) + (land[i] ? 1 : 0)) / 2
    const push = (x: number, z: number, s: number, centre: boolean): void => {
      tmp.copy(base)
      if (centre) tmp.lerp(deep, 0.3)
      tmp.lerp(shore, s * (low ? 0.4 : 0.85))
      pos.push(t.x + x, y, t.z + z)
      col.push(tmp.r, tmp.g, tmp.b, a0 * (1 - (low ? 0 : 0.6) * s))
    }
    const cx = (i: number): number => R * Math.cos((i * Math.PI) / 3)
    const cz = (i: number): number => R * Math.sin((i * Math.PI) / 3)
    for (let k = 0; k < 6; k++) {
      const i0 = k, i1 = (k + 1) % 6
      const mx = (cx(i0) + cx(i1)) / 2, mz = (cz(i0) + cz(i1)) / 2
      const ms = land[k] ? 1 : 0
      push(0, 0, 0, true); push(mx, mz, ms, false); push(cx(i0), cz(i0), cornerS(i0), false)
      push(0, 0, 0, true); push(cx(i1), cz(i1), cornerS(i1), false); push(mx, mz, ms, false)
    }
  }
  const g = new BufferGeometry()
  g.setAttribute('position', new Float32BufferAttribute(pos, 3))
  g.setAttribute('color', new Float32BufferAttribute(col, 4))
  const nor: number[] = []
  for (let i = 0; i < pos.length / 3; i++) nor.push(0, 1, 0)
  g.setAttribute('normal', new Float32BufferAttribute(nor, 3))
  g.computeBoundingSphere()
  return g
}
