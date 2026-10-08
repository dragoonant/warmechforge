// The board's interaction layer (inside the Canvas): a board-wide pick plane (hover + hex clicks), the overlays and the
// keyboard. Left button only; camera drags (pointer travel) never click. Mount once inside <Canvas>.
import { useEffect, useMemo, type ReactElement } from 'react'
import { useThree, type ThreeEvent } from '@react-three/fiber'
import { uiActions, usePresentedState } from '../contract'
import { handleHexClick } from './controller'
import { useBoardKeys } from './keys'
import { rayToHex } from './pick'
import { ArcOverlay, FacingPicker, LosLayer, PathPreview, RangeRings, ReachOverlay, Ruler } from './Overlays'
import { interactionActions } from './store'

/** Clicks closer than this many pixels to their press count as clicks (the camera uses larger drags). */
export const CLICK_SLOP_PX = 4

function PickPlane(): ReactElement | null {
  const state = usePresentedState()
  const invalidate = useThree((s) => s.invalidate)
  const size = useMemo(() => (state ? { w: state.board.cols + 6, h: state.board.rows + 6 } : null), [state?.board.cols, state?.board.rows])
  if (!state || !size) return null
  const hexAt = (e: ThreeEvent<PointerEvent | MouseEvent>) => rayToHex(state, e.ray.origin, e.ray.direction)
  return (
    <mesh
      rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.03, 0]}
      onPointerMove={(e) => { const h = hexAt(e); uiActions.hoverHex(h); invalidate() }}
      onPointerLeave={() => { uiActions.hoverHex(null); invalidate() }}
      onClick={(e) => {
        if (e.nativeEvent.button !== 0 || e.delta > CLICK_SLOP_PX) return
        const h = hexAt(e)
        if (h) { e.stopPropagation(); handleHexClick(h); invalidate() }
      }}
    >
      <planeGeometry args={[size.w * 1.2, size.h * 1.2]} />
      <meshBasicMaterial transparent opacity={0} depthWrite={false} />
    </mesh>
  )
}

export function InteractionLayer(): ReactElement {
  useBoardKeys()
  useEffect(() => () => interactionActions.reset(), [])
  return (
    <group name="wmf-interaction">
      <PickPlane />
      <ReachOverlay />
      <PathPreview />
      <ArcOverlay />
      <RangeRings />
      <LosLayer />
      <Ruler />
      <FacingPicker />
    </group>
  )
}
