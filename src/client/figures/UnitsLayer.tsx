// Everything that stands on the board besides terrain: the figures, the VFX layer, the damage pops and the interaction layer.
// Mount once inside the board's <Canvas> (frameloop="demand"). Invalidates on every presented change and while anything animates.
import { useEffect, type ReactElement } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { InteractionLayer } from '../interaction/InteractionLayer'
import { useAnimating, usePresentedRev, useUnitIds } from '../contract'
import { Pops } from '../vfx/Pops'
import { VfxLayer } from '../vfx/VfxLayer'
import { Figure } from './Figure'
import { WorldLabels } from './worldLabels'

export function UnitsLayer(): ReactElement {
  const ids = useUnitIds()
  const rev = usePresentedRev()
  const animating = useAnimating()
  const invalidate = useThree((s) => s.invalidate)
  const gl = useThree((s) => s.gl)
  useEffect(() => { gl.shadowMap.needsUpdate = true; invalidate() }, [rev, gl, invalidate])
  useFrame(() => { if (animating) invalidate() })
  return (
    <group name="wmf-units">
      {ids.map((id) => <Figure key={id} id={id} />)}
      <WorldLabels />
      <VfxLayer />
      <Pops />
      <InteractionLayer />
    </group>
  )
}
