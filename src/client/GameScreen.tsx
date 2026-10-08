// The in-game screen: the 3D board (tiles, terrain, figures, overlays, VFX, the optional game shop around it) with the HUD
// over it. Lazy-loaded by App, so three.js and the board live in this chunk. Pattern from Whirr Machine's GameScreen.
import { useEffect, useMemo, type ReactElement } from 'react'
import { useThree } from '@react-three/fiber'
import { Vector3 } from 'three'
import { BoardCanvas, HexBoard, cameraActions, hexTopPoint, layoutBoard } from './board'
import { FpsMeter, FpsProbe, fpsEnabled } from './board/FpsMeter'
import { registerHexToScreen, useControllers, usePresentedState, usePrompt, type HexToScreen } from './contract'
import { usePresentedStore } from './presentation/presentedStore'
import { useUiStore } from './store/uiStore'
import { EstablishingHint, EstablishingShot, GameShop, useEffectiveSurroundings, useEstablishingActive } from './environment'
import { UnitsLayer } from './figures'
import { InteractionProxies, interactionActions } from './interaction'
import { Hud } from './ui'

/** window.__game.hexToScreen: page pixels of a hex centre through the live camera (E2E clicks the real canvas). */
function HexProjector(): null {
  const camera = useThree((s) => s.camera)
  const gl = useThree((s) => s.gl)
  useEffect(() => {
    const fn: HexToScreen = (label) => {
      const p = hexTopPoint(label)
      camera.updateMatrixWorld()
      const v = new Vector3(p.x, p.y, p.z).project(camera)
      const r = gl.domElement.getBoundingClientRect()
      return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height }
    }
    registerHexToScreen(fn)
    return () => registerHexToScreen(null)
  }, [camera, gl])
  return null
}

/** World point of a unit as presented (its hex top), or null off the board. */
function unitPoint(id: string | null | undefined): { x: number; y: number; z: number } | null {
  const u = id ? usePresentedStore.getState().state?.units[id] : undefined
  return u?.pos ? hexTopPoint(u.pos) : null
}

/**
 * Camera presets on the keyboard (50 §5): 1 top-down, 2 behind your home edge, 3 follow the acting (or selected) 'Mech, 0 overview.
 * At the start of a human decision the camera eases to the acting 'Mech only when it is off screen (never while the player drags).
 */
function CameraKeys(): null {
  const controllers = useControllers()
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement | null
      if (e.ctrlKey || e.metaKey || e.altKey || (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable))) return
      const st = usePresentedStore.getState().state
      if (e.key === '1') cameraActions.topDown()
      else if (e.key === '0') cameraActions.overview()
      else if (e.key === '2') {
        const me = controllers.A === 'human' || controllers.B !== 'human' ? 'A' : 'B'
        cameraActions.home(st?.sides[me]?.homeEdge ?? 'south')
      } else if (e.key === '3') {
        const p = unitPoint(st?.selection?.activeUnit ?? useUiStore.getState().selectedId)
        if (p) cameraActions.follow(p.x, p.z, p.y)
      } else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [controllers])
  return null
}

/** Inside the Canvas: when a human decision opens for a 'Mech that is off screen, ease the camera to it. */
function FollowOffscreen(): null {
  const prompt = usePrompt()
  const camera = useThree((s) => s.camera)
  useEffect(() => {
    if (!prompt?.unitId) return
    const p = unitPoint(prompt.unitId)
    if (!p) return
    camera.updateMatrixWorld()
    const v = new Vector3(p.x, p.y + 0.5, p.z).project(camera)
    const off = v.z > 1 || Math.abs(v.x) > 0.85 || v.y > 0.8 || v.y < -0.55 // the bottom of the view sits under the decision panel
    if (off) cameraActions.follow(p.x, p.z, p.y)
  }, [prompt?.id, prompt?.unitId, camera])
  return null
}

/** Interaction drafts belong to one decision: drop them whenever the open decision changes. */
function DraftReset(): null {
  const id = usePrompt()?.id ?? null
  useEffect(() => { interactionActions.reset() }, [id])
  return null
}

function Board(): ReactElement | null {
  const state = usePresentedState()
  const surroundings = useEffectiveSurroundings()
  const board = state?.board ?? null
  const layout = useMemo(() => (board ? layoutBoard(board) : null), [board])
  if (!board || !layout) return null
  const shop = surroundings === 'shop'
  return (
    <div data-testid="board" style={{ position: 'absolute', inset: 0 }} onContextMenu={(e) => e.preventDefault()}>
      <BoardCanvas style={{ position: 'absolute', inset: 0 }}>
        <HexBoard map={board} surround={!shop}>
          <UnitsLayer />
        </HexBoard>
        {shop && (
          // The shop's table top sits at y = -0.05: drop it so the board's slab rests on the mat.
          <group position={[0, layout.baseY + 0.05, 0]}>
            <GameShop boardWidth={layout.bounds.w} boardDepth={layout.bounds.d} keyIntensity={1.5} />
          </group>
        )}
        {shop && <EstablishingShot />}
        <HexProjector />
        <FollowOffscreen />
        {fpsEnabled() && <FpsProbe />}
      </BoardCanvas>
      <InteractionProxies />
      <EstablishingHint />
      {fpsEnabled() && <FpsMeter />}
    </div>
  )
}

/** The HUD steps aside while the establishing shot sweeps through the shop, then fades back in. */
function HudLayer({ onExit }: { onExit?: () => void }): ReactElement {
  const shot = useEstablishingActive()
  return (
    <div data-testid="hud-layer" style={{ opacity: shot ? 0 : 1, transition: 'opacity 500ms ease', pointerEvents: shot ? 'none' : undefined }}>
      <Hud onExit={onExit} />
    </div>
  )
}

export function GameScreen({ onExit }: { onExit?: () => void }): ReactElement {
  return (
    <>
      <DraftReset />
      <CameraKeys />
      <Board />
      <HudLayer onExit={onExit} />
    </>
  )
}

export default GameScreen
