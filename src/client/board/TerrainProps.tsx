// Terrain on top of the tiles: rough = scattered rocks, light/heavy woods = low-poly trees (capped below 'Mech shoulder height),
// water = one merged translucent surface. Each kind is a single InstancedMesh (water: one merged mesh), static under the demand loop.
import { useEffect, useLayoutEffect, useMemo, useRef, type ReactElement, type RefObject } from 'react'
import { useThree } from '@react-three/fiber'
import { Color, DoubleSide, Euler, Matrix4, Quaternion, Vector3, type InstancedMesh } from 'three'
import type { BoardState } from '../../engine/types'
import type { BoardTheme } from './boards'
import { markShadowsDirty } from './frameRate'
import { topYOf, type BoardLayout, type TileInfo } from './layout'
import { buildRockGeometry, buildTreeGeometry } from './propGeometry'
import { rockPlacements, rockRadius, treeHeight, treePlacements, type Placement } from './props'
import { buildWaterGeometry } from './water'

interface Item { t: TileInfo; p: Placement }

export function TerrainProps({ board, layout, theme, low }: { board: BoardState; layout: BoardLayout; theme: BoardTheme; low: boolean }): ReactElement {
  const light = useMemo(() => layout.tiles.filter((t) => t.woods === 'light' && t.depth === 0), [layout])
  const heavy = useMemo(() => layout.tiles.filter((t) => t.woods === 'heavy' && t.depth === 0), [layout])
  const rough = useMemo(() => layout.tiles.filter((t) => t.rough && t.woods === 'none' && t.depth === 0), [layout])
  return (
    <group name="terrain-props">
      <Trees tiles={light} woods="light" theme={theme} low={low} />
      <Trees tiles={heavy} woods="heavy" theme={theme} low={low} />
      <Rocks tiles={rough} theme={theme} />
      <Water board={board} layout={layout} theme={theme} low={low} />
    </group>
  )
}

function useInstances(count: number, fill: (m: InstancedMesh) => void, deps: unknown[]): RefObject<InstancedMesh | null> {
  const ref = useRef<InstancedMesh>(null)
  const invalidate = useThree((s) => s.invalidate)
  useLayoutEffect(() => {
    const m = ref.current
    if (!m) return
    fill(m)
    m.instanceMatrix.needsUpdate = true
    if (m.instanceColor) m.instanceColor.needsUpdate = true
    m.computeBoundingSphere()
    markShadowsDirty()
    invalidate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count, invalidate, ...deps])
  return ref
}

const Q = new Quaternion(), E = new Euler(), P = new Vector3(), S = new Vector3(), M = new Matrix4(), C = new Color()

function Trees({ tiles, woods, theme, low }: { tiles: TileInfo[]; woods: 'light' | 'heavy'; theme: BoardTheme; low: boolean }): ReactElement | null {
  const items = useMemo<Item[]>(() => tiles.flatMap((t) => treePlacements(t.label, woods, low).map((p) => ({ t, p }))), [tiles, woods, low])
  const geo = useMemo(() => buildTreeGeometry(woods === 'heavy' ? theme.props.foliageHeavy : theme.props.foliageLight, theme.props.trunk, low), [woods, theme, low])
  useEffect(() => () => geo.dispose(), [geo])
  const ref = useInstances(items.length, (m) => {
    items.forEach(({ t, p }, i) => {
      const h = treeHeight(p.size) * (woods === 'heavy' ? 1.0 : 0.92)
      const w = h * (woods === 'heavy' ? 1.15 : 1.0)
      P.set(t.x + p.x, topYOf(t) + t.dy - 0.01, t.z + p.z)
      S.set(w, h, w)
      Q.setFromEuler(E.set(0, p.rot, 0))
      m.setMatrixAt(i, M.compose(P, Q, S))
      const k = 0.85 + p.tone * 0.3
      m.setColorAt(i, C.setRGB(k, k * (0.97 + p.tone * 0.06), k * (1.02 - p.tone * 0.06)))
    })
  }, [items, woods])
  if (!items.length) return null
  return (
    <instancedMesh ref={ref} name={`trees-${woods}`} args={[geo, undefined, items.length]} frustumCulled={false} castShadow receiveShadow>
      <meshStandardMaterial vertexColors roughness={0.9} metalness={0} flatShading />
    </instancedMesh>
  )
}

function Rocks({ tiles, theme }: { tiles: TileInfo[]; theme: BoardTheme }): ReactElement | null {
  const items = useMemo<Item[]>(() => tiles.flatMap((t) => rockPlacements(t.label).map((p) => ({ t, p }))), [tiles])
  const geo = useMemo(() => buildRockGeometry(1), [])
  useEffect(() => () => geo.dispose(), [geo])
  const ref = useInstances(items.length, (m) => {
    items.forEach(({ t, p }, i) => {
      const r = rockRadius(p.size), sy = 0.8 + p.tone * 0.5
      P.set(t.x + p.x, topYOf(t) + t.dy + r * 0.12, t.z + p.z)
      S.set(r * (1.1 - p.tone * 0.3), r * sy, r * (0.8 + p.tone * 0.4))
      Q.setFromEuler(E.set(0, p.rot, 0))
      m.setMatrixAt(i, M.compose(P, Q, S))
      const k = 0.78 + p.tone * 0.4
      m.setColorAt(i, C.setRGB(k, k * 0.98, k * 0.95))
    })
  }, [items])
  if (!items.length) return null
  return (
    <instancedMesh ref={ref} name="rocks" args={[geo, undefined, items.length]} frustumCulled={false} castShadow receiveShadow>
      <meshStandardMaterial color={theme.props.rock} roughness={0.95} metalness={0} vertexColors flatShading />
    </instancedMesh>
  )
}

function Water({ board, layout, theme, low }: { board: BoardState; layout: BoardLayout; theme: BoardTheme; low: boolean }): ReactElement | null {
  const geo = useMemo(() => buildWaterGeometry(layout, board, theme, low), [layout, board, theme, low])
  useEffect(() => () => geo?.dispose(), [geo])
  const invalidate = useThree((s) => s.invalidate)
  useEffect(() => { invalidate() }, [geo, invalidate])
  if (!geo) return null
  return (
    <mesh name="water" geometry={geo} receiveShadow renderOrder={2}>
      <meshStandardMaterial vertexColors transparent={!low} opacity={1} roughness={0.18} metalness={0.05} depthWrite={low} side={DoubleSide} />
    </mesh>
  )
}
