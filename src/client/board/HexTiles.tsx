// The tile prisms: one InstancedMesh per distinct level (top cap + chamfer share the ground material, sides the cliff material).
// Per-tile colour (instanceColor) and height jitter come from the layout; terrain only tints the floor (forest floor, rough, bed).
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { useThree, type ThreeEvent } from '@react-three/fiber'
import { Color, InstancedMesh, Matrix4, type BufferGeometry } from 'three'
import type { BoardState, Hex, HexLabel } from '../../engine/types'
import type { BoardTheme } from './boards'
import { markShadowsDirty } from './frameRate'
import { shareMatAlbedo } from './matShare'
import { loadMat, makeTileMaterials, type MatTextures } from './materials'
import { topYOf, type BoardLayout, type TileInfo } from './layout'
import { buildTileGeometry } from './tileGeometry'

/** Colour multiplier (linear) of a tile: its own jitter times what lies on it. */
export function tileColour(t: TileInfo, theme: BoardTheme): [number, number, number] {
  let m: [number, number, number] = [1, 1, 1]
  if (t.depth > 0) { m = theme.water.bed; const k = Math.pow(0.8, t.depth - 1); m = [m[0] * k, m[1] * k, m[2] * k] }
  else if (t.woods === 'heavy') m = theme.props.floorHeavy
  else if (t.woods === 'light') m = theme.props.floorLight
  else if (t.rough) m = theme.props.roughFloor
  else if (t.pavement) m = theme.props.pavement
  return [t.tint[0] * m[0], t.tint[1] * m[1], t.tint[2] * m[2]]
}

function useTileTextures(theme: BoardTheme): { ground: MatTextures | null; cliff: MatTextures | null; ready: boolean } {
  const gl = useThree((s) => s.gl)
  const invalidate = useThree((s) => s.invalidate)
  const [s, setS] = useState<{ ground: MatTextures | null; cliff: MatTextures | null; ready: boolean }>({ ground: null, cliff: null, ready: false })
  useEffect(() => {
    let live = true
    const an = Math.min(8, gl.capabilities.getMaxAnisotropy())
    setS({ ground: null, cliff: null, ready: false })
    Promise.all([loadMat(theme.ground, an).catch(() => null), loadMat(theme.cliff, an).catch(() => null)]).then(([ground, cliff]) => {
      if (!live) return
      setS({ ground, cliff, ready: true }); markShadowsDirty(); invalidate()
    })
    return () => { live = false }
  }, [theme, gl, invalidate])
  return s
}

export interface HexTilesProps {
  board: BoardState
  layout: BoardLayout
  theme: BoardTheme
  onHover?: (hex: Hex | null, label: HexLabel | null) => void
  onPick?: (hex: Hex, label: HexLabel) => void
}

export function HexTiles({ layout, theme, onHover, onPick }: HexTilesProps): ReactElement {
  const invalidate = useThree((s) => s.invalidate)
  const tex = useTileTextures(theme)
  const origin = useMemo(() => ({ x: (layout.bounds.minX + layout.bounds.maxX) / 2, z: (layout.bounds.minZ + layout.bounds.maxZ) / 2 }), [layout])
  // a board bigger than one mat image repeats the (de-tiled) mat; smaller boards sit inside one image
  const matSize = Math.max(theme.matSize, Math.max(layout.bounds.w, layout.bounds.d) + 4)
  const mats = useMemo(() => makeTileMaterials(theme, tex.ground, tex.cliff, origin, matSize, layout.baseY, layout.plinthY), [theme, tex.ground, tex.cliff, origin, matSize, layout.baseY, layout.plinthY])
  useEffect(() => () => mats.dispose(), [mats])
  useEffect(() => { shareMatAlbedo(tex.ground?.albedo ?? null); return () => shareMatAlbedo(null) }, [tex.ground])
  useEffect(() => { markShadowsDirty(); invalidate() }, [mats, invalidate])
  const down = useRef<{ x: number; y: number } | null>(null)
  const lastHover = useRef<string | null>(null)

  const hoverOf = (e: ThreeEvent<PointerEvent>): TileInfo | null => {
    const tiles = (e.object.userData as { tiles?: TileInfo[] }).tiles
    return tiles && e.instanceId !== undefined ? tiles[e.instanceId] ?? null : null
  }
  return (
    <group
      name="hex-tiles"
      onPointerMove={(e) => {
        const t = hoverOf(e)
        if (!t || lastHover.current === t.label) return
        lastHover.current = t.label; onHover?.(t.hex, t.label)
      }}
      onPointerLeave={() => { if (lastHover.current !== null) { lastHover.current = null; onHover?.(null, null) } }}
      onPointerDown={(e) => { if (e.button === 0) down.current = { x: e.clientX, y: e.clientY } }}
      onPointerUp={(e) => {
        const d = down.current; down.current = null
        if (e.button !== 0 || !d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4) return
        const t = hoverOf(e); if (t) onPick?.(t.hex, t.label)
      }}
    >
      {layout.levels.map((lv) => (
        <LevelMesh key={`${lv}`} level={lv} tiles={layout.groups.get(lv)!} baseY={layout.baseY} theme={theme} mats={mats} invalidate={invalidate} />
      ))}
    </group>
  )
}

function LevelMesh({ level, tiles, baseY, theme, mats, invalidate }: {
  level: number; tiles: TileInfo[]; baseY: number; theme: BoardTheme; mats: ReturnType<typeof makeTileMaterials>; invalidate: () => void
}): ReactElement {
  const ref = useRef<InstancedMesh>(null)
  const geo: BufferGeometry = useMemo(() => buildTileGeometry({ topY: topYOf({ topLevel: level }), baseY }), [level, baseY])
  useEffect(() => () => geo.dispose(), [geo])
  const args = useMemo(() => [geo, [mats.top, mats.side], tiles.length] as ConstructorParameters<typeof InstancedMesh>, [geo, mats, tiles.length])
  useLayoutEffect(() => {
    const m = ref.current; if (!m) return
    const mx = new Matrix4(), c = new Color()
    tiles.forEach((t, i) => {
      mx.makeTranslation(t.x, t.dy, t.z); m.setMatrixAt(i, mx)
      const k = tileColour(t, theme); c.setRGB(k[0], k[1], k[2]); m.setColorAt(i, c)
    })
    m.instanceMatrix.needsUpdate = true
    if (m.instanceColor) m.instanceColor.needsUpdate = true
    m.computeBoundingSphere(); m.userData.tiles = tiles
    markShadowsDirty(); invalidate()
  }, [args, tiles, theme, invalidate])
  return (
    <instancedMesh ref={ref} name={`tiles-L${level}`} args={args} frustumCulled={false} castShadow receiveShadow />
  )
}
