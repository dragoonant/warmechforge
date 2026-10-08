// <HexBoard>: the whole board scene (tiles, terrain, outlines, labels, lights, surround, camera). Mount it inside <BoardCanvas>.
// Other agents add figures and overlays as siblings in the same canvas. Rendering reads the map's BoardState only: the engine
// owns every rules number, this draws what the engine's hexes say.
import { useEffect, useMemo, type ReactElement, type ReactNode } from 'react'
import { Canvas } from '@react-three/fiber'
import { ACESFilmicToneMapping, SRGBColorSpace } from 'three'
import type { BoardState, Hex, HexLabel } from '../../engine/types'
import { loadBundle } from '../../data/index'
import { hexToLabel } from '../../engine/hex'
import { uiActions, useHoverHex, usePresentedState, useSettings } from '../contract'
import { THEMES, themeFor, type BoardTheme, type BoardThemeId } from './boards'
import { useBoardView } from './boardStore'
import { CameraRig } from './Camera'
import { HexGrid } from './HexGrid'
import { HexLabels } from './HexLabels'
import { HexTiles } from './HexTiles'
import { setActiveBoard } from './hexWorld'
import { layoutBoard } from './layout'
import { Lights, ShadowGate, Surround } from './Lights'
import { TerrainProps } from './TerrainProps'

let bundleCache: ReturnType<typeof loadBundle> | null = null
/** Map theme ('desert' | 'grasslands') from the data bundle; desert when the map is unknown. */
export function themeOfMap(mapId: string): BoardTheme {
  try {
    bundleCache ??= loadBundle()
    const m = bundleCache.maps[mapId] as { theme?: string } | undefined
    return themeFor(m?.theme)
  } catch { return THEMES.desert }
}

export interface HexBoardProps {
  /** The engine's board (state.board). Omitted: the presented state's board. */
  map?: BoardState
  /** Theme override: 'desert' | 'grasslands' (default: the map data's theme). */
  theme?: BoardThemeId | BoardTheme
  /** Overrides settings.graphics ('low' drops shadows, simplifies trees, opaque water). */
  graphics?: 'low' | 'high'
  /** Overrides settings.grid / settings.hexLabels / boardStore.gridOpacity. */
  showGrid?: boolean
  gridOpacity?: number
  labels?: 'hover' | 'always' | 'off'
  /** Hovered hex; omitted = the shared ui store's hover. */
  hoverHex?: Hex | null
  /** Pointer moved onto a hex or off the board (default writes the shared ui store's hover). */
  onHover?: (hex: Hex | null, label: HexLabel | null) => void
  /** Left click (not a drag) on a hex. Right/middle buttons belong to the camera. */
  onPickHex?: (hex: Hex, label: HexLabel) => void
  /** Draw the dark off-board table, background and fog (default true). False when the game shop surrounds the board. */
  surround?: boolean
  children?: ReactNode
}

export function HexBoard(props: HexBoardProps): ReactElement | null {
  const presented = usePresentedState()
  const board = props.map ?? presented?.board ?? null
  const settings = useSettings()
  const uiHover = useHoverHex()
  const viewOpacity = useBoardView((s) => s.gridOpacity)
  const theme = useMemo(() => {
    if (props.theme && typeof props.theme === 'object') return props.theme
    if (typeof props.theme === 'string') return THEMES[props.theme] ?? THEMES.desert
    return board ? themeOfMap(board.mapId) : THEMES.desert
  }, [props.theme, board])
  const layout = useMemo(() => (board ? layoutBoard(board) : null), [board])
  const low = (props.graphics ?? settings.graphics) === 'low'
  useEffect(() => { setActiveBoard(board); return () => setActiveBoard(null) }, [board])
  if (!board || !layout) return null

  const hexHover = props.hoverHex !== undefined ? props.hoverHex : uiHover
  const hoverLabel = hexHover ? hexToLabel(board, hexHover) : null
  const onHover = props.onHover ?? ((h: Hex | null) => uiActions.hoverHex(h))
  return (
    <group name="hex-board">
      <ShadowGate rev={`${board.mapId}|${theme.id}|${low}`} />
      <Lights theme={theme} layout={layout} shadows={!low} sceneLook={props.surround !== false} />
      {props.surround !== false && <Surround theme={theme} layout={layout} shadows={!low} />}
      <HexTiles board={board} layout={layout} theme={theme} onHover={onHover} onPick={props.onPickHex} />
      <TerrainProps board={board} layout={layout} theme={theme} low={low} />
      <HexGrid board={board} layout={layout} theme={theme} visible={props.showGrid ?? settings.grid} opacity={props.gridOpacity ?? viewOpacity} hover={hoverLabel} />
      <HexLabels layout={layout} theme={theme} mode={props.labels ?? settings.hexLabels} hover={hoverLabel} />
      <CameraRig bounds={layout.bounds} />
      {props.children}
    </group>
  )
}

/** The canvas the board lives in: demand frameloop, ACES tone mapping, soft shadows (off on Low graphics). */
export function BoardCanvas({ children, graphics, className, style }: { children?: ReactNode; graphics?: 'low' | 'high'; className?: string; style?: React.CSSProperties }): ReactElement {
  const settings = useSettings()
  const low = (graphics ?? settings.graphics) === 'low'
  return (
    <Canvas
      className={className}
      style={style}
      frameloop="demand"
      dpr={low ? 1 : [1, 1.5]}
      shadows={low ? false : 'percentage'}
      gl={{ antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: wantsCapture() }}
      camera={{ fov: 38, near: 0.1, far: 220, position: [0, 18, 18] }}
      onCreated={({ gl }) => { gl.toneMapping = ACESFilmicToneMapping; gl.toneMappingExposure = 1.0; gl.outputColorSpace = SRGBColorSpace }}
    >
      {children}
    </Canvas>
  )
}

/** Screenshots (Playwright, ?test=1 or the dev route) read the canvas back, which needs the drawing buffer kept. */
function wantsCapture(): boolean {
  try { return /[?&](test|capture)=1\b/.test(location.search) || location.pathname.endsWith('/dev.html') } catch { return false }
}
