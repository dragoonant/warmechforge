// Lighting, fog and the dark off-board surround. Hemisphere fill + a warm sun key with a soft 1024 shadow map (re-rendered only when
// something that casts a shadow changed: markShadowsDirty), theme-tinted fog that matches the background, ACES tone mapping set on
// the Canvas (BoardCanvas).
import { useEffect, useMemo, type ReactElement } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Color, Fog } from 'three'
import type { BoardTheme } from './boards'
import { markShadowsDirty, takeShadowsDirty } from './frameRate'
import type { BoardLayout } from './layout'

/** Re-renders the shadow map only when asked (board, theme, graphics change or a caster calls markShadowsDirty). */
export function ShadowGate({ animating = false, rev }: { animating?: boolean; rev?: unknown }): null {
  const gl = useThree((s) => s.gl)
  const invalidate = useThree((s) => s.invalidate)
  useEffect(() => { gl.shadowMap.autoUpdate = false; gl.shadowMap.needsUpdate = true; return () => { gl.shadowMap.autoUpdate = true } }, [gl])
  useEffect(() => { markShadowsDirty(); invalidate() }, [rev, invalidate])
  useFrame(() => { if (takeShadowsDirty() || animating) gl.shadowMap.needsUpdate = true })
  return null
}

/** sceneLook=false: another scene (the game shop) owns the background and fog and adds its own warm light, so ours is turned down. */
export function Lights({ theme, layout, shadows, sceneLook = true }: { theme: BoardTheme; layout: BoardLayout; shadows: boolean; sceneLook?: boolean }): ReactElement {
  const k = sceneLook ? { hemi: 1, key: 1, fill: 1 } : { hemi: 0.1, key: 0.5, fill: 0.2 }
  const { light, fog } = theme
  const half = Math.max(layout.bounds.w, layout.bounds.d) * 0.62 + 2
  const sky = useMemo(() => new Color(light.sky), [light.sky])
  const scene = useThree((st) => st.scene)
  const invalidate = useThree((st) => st.invalidate)
  // background and fog belong to the scene, not to this component's parent group
  useEffect(() => {
    if (!sceneLook) return
    const prevBg = scene.background, prevFog = scene.fog
    scene.background = new Color(fog.color).multiplyScalar(0.62)   // ACES darkens the fogged far surround; match the clear colour to it
    scene.fog = new Fog(fog.color, fog.near, fog.far)
    invalidate()
    return () => { scene.background = prevBg; scene.fog = prevFog }
  }, [scene, fog.color, fog.near, fog.far, invalidate, sceneLook])
  return (
    <>
      <hemisphereLight args={[sky, new Color(light.groundBounce), light.hemiIntensity * k.hemi]} />
      <directionalLight
        position={[-9, 20, 11]} intensity={light.keyIntensity * k.key} color={light.key} castShadow={shadows}
        shadow-mapSize={[1024, 1024]} shadow-bias={-0.0004} shadow-normalBias={0.03} shadow-radius={3}
        shadow-camera-left={-half} shadow-camera-right={half} shadow-camera-top={half} shadow-camera-bottom={-half} shadow-camera-near={2} shadow-camera-far={70}
      />
      <directionalLight position={[14, 8, -12]} intensity={0.45 * k.fill} color={light.fill} />
    </>
  )
}

/** A darker, larger table surface under and around the board so the map edge reads cleanly. */
export function Surround({ theme, layout, shadows }: { theme: BoardTheme; layout: BoardLayout; shadows: boolean }): ReactElement {
  const size = Math.max(layout.bounds.w, layout.bounds.d) * 8 + 80
  const cx = (layout.bounds.minX + layout.bounds.maxX) / 2, cz = (layout.bounds.minZ + layout.bounds.maxZ) / 2
  return (
    <mesh name="surround" rotation={[-Math.PI / 2, 0, 0]} position={[cx, layout.baseY + 0.002, cz]} receiveShadow={shadows}>
      <planeGeometry args={[size, size]} />
      <meshStandardMaterial color={theme.surround} roughness={1} metalness={0} />
    </mesh>
  )
}
