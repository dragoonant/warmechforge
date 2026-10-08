// Hex outlines: one LineSegments2 (thin, crisp, pixel-width lines) for every shared hex edge, plus a brighter outline and a faint
// fill on the hovered hex. Toggle = settings.grid, opacity = boardStore. Lines sit just above the higher of the two tiles.
import { useEffect, useMemo, type ReactElement } from 'react'
import { useThree } from '@react-three/fiber'
import { BufferGeometry, DoubleSide, Float32BufferAttribute, type Vector2 } from 'three'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js'
import type { BoardState, HexLabel } from '../../engine/types'
import { LEVEL_HEIGHT } from '../../engine/types'
import { hexToLabel, neighbors } from '../../engine/hex'
import type { BoardTheme } from './boards'
import { WATER_DROP, type BoardLayout, type TileInfo } from './layout'
import { R_OUT } from './tileGeometry'
import { EDGE_FACING } from './water'

/** True hex outline radius (corner distance of a 1-unit flat-to-flat hex). */
const R_GRID = 1 / Math.sqrt(3)

/** World y of the visible surface of a tile (the water surface for water). */
export const visibleY = (t: TileInfo): number => (t.surfaceLevel !== null ? t.surfaceLevel * LEVEL_HEIGHT - WATER_DROP : t.topLevel * LEVEL_HEIGHT + t.dy)

/** Segment endpoints (x1,y1,z1,x2,y2,z2 ...) of every distinct hex edge on the board. */
export function gridSegments(layout: BoardLayout, board: BoardState): number[] {
  const out: number[] = []
  for (const t of layout.tiles) {
    const nb = neighbors(t.hex)
    for (let k = 0; k < 6; k++) {
      const l = hexToLabel(board, nb[EDGE_FACING[k]!]!)
      const n = l ? layout.byLabel.get(l) : undefined
      if (n && n.label < t.label) continue   // the lower label draws the shared edge
      const y = Math.max(visibleY(t), n ? visibleY(n) : -Infinity) + 0.004
      const a0 = (k * Math.PI) / 3, a1 = ((k + 1) * Math.PI) / 3
      out.push(t.x + R_GRID * Math.cos(a0), y, t.z + R_GRID * Math.sin(a0), t.x + R_GRID * Math.cos(a1), y, t.z + R_GRID * Math.sin(a1))
    }
  }
  return out
}

function useLineMaterial(color: string, widthPx: number, opacity: number): LineMaterial {
  const size = useThree((s) => s.size)
  const mat = useMemo(() => new LineMaterial({ color, linewidth: widthPx, transparent: true, opacity, depthTest: true, depthWrite: false, fog: false, worldUnits: false }), []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { mat.color.set(color); mat.linewidth = widthPx; mat.opacity = opacity; mat.needsUpdate = true }, [mat, color, widthPx, opacity])
  useEffect(() => { (mat.resolution as Vector2).set(size.width, size.height) }, [mat, size])
  useEffect(() => () => mat.dispose(), [mat])
  return mat
}

export function HexGrid({ board, layout, theme, visible, opacity, hover }: {
  board: BoardState; layout: BoardLayout; theme: BoardTheme; visible: boolean; opacity: number; hover: HexLabel | null
}): ReactElement {
  const invalidate = useThree((s) => s.invalidate)
  const mat = useLineMaterial(theme.grid, 1.1, opacity)
  const hoverMat = useLineMaterial(theme.gridHover, 2.4, 1)
  const geo = useMemo(() => { const g = new LineSegmentsGeometry(); g.setPositions(gridSegments(layout, board)); return g }, [layout, board])
  useEffect(() => () => geo.dispose(), [geo])
  const line = useMemo(() => { const l = new LineSegments2(geo, mat); l.name = 'hex-grid'; l.renderOrder = 3; l.frustumCulled = false; return l }, [geo, mat])
  const tile = hover ? layout.byLabel.get(hover) ?? null : null
  const hoverLine = useMemo(() => {
    if (!tile) return null
    const g = new LineSegmentsGeometry(), p: number[] = []
    const y = visibleY(tile) + 0.008
    for (let k = 0; k < 6; k++) {
      const a0 = (k * Math.PI) / 3, a1 = ((k + 1) * Math.PI) / 3
      p.push(tile.x + R_GRID * Math.cos(a0), y, tile.z + R_GRID * Math.sin(a0), tile.x + R_GRID * Math.cos(a1), y, tile.z + R_GRID * Math.sin(a1))
    }
    g.setPositions(p)
    const l = new LineSegments2(g, hoverMat); l.name = 'hex-hover'; l.renderOrder = 4; l.frustumCulled = false
    return l
  }, [tile, hoverMat])
  const fill = useMemo(() => {
    if (!tile) return null
    const y = visibleY(tile) + 0.003, pos: number[] = []
    for (let k = 0; k < 6; k++) {
      const a0 = (k * Math.PI) / 3, a1 = ((k + 1) * Math.PI) / 3, r = R_OUT
      pos.push(0, y, 0, r * Math.cos(a0), y, r * Math.sin(a0), r * Math.cos(a1), y, r * Math.sin(a1))
    }
    const g = new BufferGeometry(); g.setAttribute('position', new Float32BufferAttribute(pos, 3))
    return g
  }, [tile])
  useEffect(() => () => { hoverLine?.geometry.dispose() }, [hoverLine])
  useEffect(() => () => { fill?.dispose() }, [fill])
  useEffect(() => { invalidate() }, [visible, opacity, hover, theme, invalidate, line])
  return (
    <group name="hex-overlay">
      {visible && <primitive object={line} />}
      {hoverLine && <primitive object={hoverLine} />}
      {tile && fill && (
        <mesh geometry={fill} renderOrder={1}>
          <meshBasicMaterial color={theme.gridHover} transparent opacity={0.13} depthWrite={false} side={DoubleSide} polygonOffset polygonOffsetFactor={-2} polygonOffsetUnits={-2} toneMapped={false} />
        </mesh>
      )}
    </group>
  )
}
