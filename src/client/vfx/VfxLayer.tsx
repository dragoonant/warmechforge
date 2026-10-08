// The beat-driven effects layer: watches the presented store, plans effects for each beat as it starts (effects.ts) and
// plays them (engine.ts). Mounted once per canvas (UnitsLayer mounts it). Demand-frameloop friendly: asks for frames only
// while something is playing.
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, type ReactElement } from 'react'
import type { PerspectiveCamera } from 'three'
import { directorNow } from '../presentation/director'
import { usePresentedStore } from '../presentation/presentedStore'
import { getSettings, useSettingsStore } from '../store/settingsStore'
import { VfxEngine } from './engine'
import { planBeat } from './effects'
import { glowPool, smokePool } from './particles'

export function VfxLayer(): ReactElement {
  const engine = useMemo(() => new VfxEngine(), [])
  const invalidate = useThree((s) => s.invalidate)
  const graphics = useSettingsStore((s) => s.graphics)

  useEffect(() => { engine.lite = graphics === 'low'; invalidate() }, [engine, graphics, invalidate])

  useEffect(() => {
    let lastBeat = usePresentedStore.getState().beat?.id ?? -1
    const off = usePresentedStore.subscribe((s, prev) => {
      if (!s.state || (!s.beat && !prev.beat)) return
      if (s.cursor < prev.cursor) { engine.clear(); lastBeat = -1 } // new game or reload
      const b = s.beat
      if (!b || b.id === lastBeat) return
      lastBeat = b.id
      const speed = getSettings().speed
      if (speed <= 0) return // instant: nothing plays
      const specs = planBeat(b, { state: s.state, tweens: s.tweens, now: directorNow() })
      if (specs.length) { engine.play(specs, performance.now(), speed); invalidate() }
    })
    return () => { off(); engine.dispose() }
  }, [engine, invalidate])

  useFrame((st, delta) => {
    const cam = st.camera as PerspectiveCamera
    const fov = cam.isPerspectiveCamera ? (cam.fov * Math.PI) / 180 : 0.7
    const scale = (st.size.height * st.viewport.dpr) / (2 * Math.tan(fov / 2))
    glowPool.material.uniforms.uScale!.value = scale
    smokePool.material.uniforms.uScale!.value = scale
    engine.update(performance.now(), Math.min(0.05, delta))
    if (engine.busy) invalidate()
  })

  return <primitive object={engine.group} />
}
