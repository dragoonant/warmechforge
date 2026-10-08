// On-screen frame-rate readout, shown with ?fps in the URL. FpsProbe lives inside the Canvas and samples frame times;
// FpsMeter is the DOM box it writes into twice a second (no React re-renders per frame). With the demand frameloop
// an idle board draws no frames at all, which reads as "idle".
import { useEffect, useRef, type ReactElement } from 'react'
import { useFrame, useThree } from '@react-three/fiber'

export const fpsEnabled = (): boolean => typeof location !== 'undefined' && new URLSearchParams(location.search).has('fps')

let box: HTMLDivElement | null = null

export function FpsMeter(): ReactElement {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => { box = ref.current; return () => { box = null } }, [])
  return (
    <div ref={ref} data-testid="fps-meter"
      style={{ position: 'absolute', left: 8, bottom: 8, zIndex: 30, pointerEvents: 'none', background: '#1e2127dd', color: '#7fd18b',
        border: '1px solid #c9a22766', borderRadius: 6, padding: '3px 8px', font: '600 12px ui-monospace, monospace', whiteSpace: 'pre' }}>
      fps …
    </div>
  )
}

export function FpsProbe(): null {
  const gl = useThree((s) => s.gl)
  const s = useRef({ frames: 0, worst: 0, last: 0, since: performance.now(), lastFrame: 0 })
  useFrame(() => {
    const now = performance.now()
    const st = s.current
    if (st.last) st.worst = Math.max(st.worst, now - st.last)
    st.last = now
    st.lastFrame = now
    st.frames++
  })
  useEffect(() => {
    const t = setInterval(() => {
      const st = s.current
      const now = performance.now()
      const secs = (now - st.since) / 1000
      const fps = st.frames / secs
      const idle = now - st.lastFrame > 600
      const { calls, triangles } = gl.info.render
      if (box) {
        box.textContent = idle
          ? `idle (no redraw needed)\n${calls} calls · ${(triangles / 1000).toFixed(0)}k tris`
          : `${fps.toFixed(0)} fps · worst ${st.worst.toFixed(0)} ms\n${calls} calls · ${(triangles / 1000).toFixed(0)}k tris`
        box.style.color = idle || fps >= 50 ? '#7fd18b' : fps >= 30 ? '#ffd866' : '#e0483a'
      }
      st.frames = 0; st.worst = 0; st.since = now; st.last = 0
    }, 500)
    return () => clearInterval(t)
  }, [gl])
  return null
}
