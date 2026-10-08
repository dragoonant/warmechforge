// Frame pacing for the demand frameloop. Ambient animation (focus orbs, stationary shells, clouds, status particles)
// runs at the display refresh rate on Medium/High graphics and at a 30 Hz cap on Low (laptops). Shadows are not part
// of this: the shadow map only re-renders when something that casts one actually moved (see markShadowsDirty).
import { useEffect } from 'react'
import { useFrame, useThree } from '@react-three/fiber'

export const LOW_AMBIENT_MS = 33

/** Keeps frames coming while `active`: every frame normally, ~30 Hz when `capped`. */
export function useAmbientFrames(active: boolean, capped: boolean): void {
  const invalidate = useThree((s) => s.invalidate)
  useEffect(() => {
    if (!active) return
    if (capped) { const t = setInterval(invalidate, LOW_AMBIENT_MS); return () => clearInterval(t) }
    invalidate()
    return undefined
  }, [active, capped, invalidate])
  useFrame(() => { if (active && !capped) invalidate() })
}

let shadowsDirty = true
/** A shadow caster moved or changed shape (figure turn, tip-over, fade, late model load): re-render the shadow map once. */
export function markShadowsDirty(): void { shadowsDirty = true }
/** Read and clear the dirty flag (ShadowGate calls this once per frame). */
export function takeShadowsDirty(): boolean { const d = shadowsDirty; shadowsDirty = false; return d }
