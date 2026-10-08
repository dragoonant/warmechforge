// DOM labels anchored to world points, without a React root per label. drei's <Html> creates and unmounts a React root for
// every label, which React 19 reports as "synchronously unmount a root while React was already rendering" on each unmount.
// Here canvas-side components register a label spec in a tiny store; ONE overlay root (created once per canvas, unmounted on a
// later tick) renders them all, and a frame callback projects each anchor onto the screen. Works with frameloop="demand":
// positions update on every rendered frame, and a label change asks for one.
import { createElement, useEffect, useId, useReducer, type CSSProperties, type ReactElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { useFrame, useThree } from '@react-three/fiber'
import { Vector3 } from 'three'

export interface LabelSpec { pos: [number, number, number]; node: ReactNode; /** Clickable (buttons inside). Default: pointer-events none. */ pointer?: boolean; z?: number }

const labels = new Map<string, LabelSpec>()
const elements = new Map<string, HTMLElement>()
const subs = new Set<() => void>()
const wake = new Set<() => void>()
const notify = (): void => { subs.forEach((f) => f()); wake.forEach((f) => f()) }

/** Register, update or (null) remove a label. */
export function setLabel(id: string, spec: LabelSpec | null): void {
  if (spec) labels.set(id, spec)
  else if (!labels.delete(id)) return
  notify()
}
/** Move a live label's anchor without re-rendering the overlay (per-frame callers). */
export function moveLabel(id: string, x: number, y: number, z: number): void {
  const s = labels.get(id)
  if (s) s.pos = [x, y, z]
}
/** Number of live labels (tests). */
export const labelCount = (): number => labels.size
export const labelIds = (): string[] => [...labels.keys()]

/** Hook form: keeps a label alive while the component is mounted (null hides it). */
export function useWorldLabel(id: string, spec: LabelSpec | null): void {
  // update on every render (the node carries closures), remove on unmount
  useEffect(() => { setLabel(id, spec) })
  useEffect(() => () => setLabel(id, null), [id])
}

export interface WorldLabelProps { position: [number, number, number]; children: ReactNode; pointer?: boolean; z?: number }
/** Declarative label: renders nothing in the canvas, shows `children` in the DOM overlay at the world point. */
export function WorldLabel({ position, children, pointer, z }: WorldLabelProps): null {
  const id = useId()
  useWorldLabel(id, { pos: position, node: children, pointer, z })
  return null
}

function Overlay(): ReactElement {
  const [, force] = useReducer((n: number) => n + 1, 0)
  useEffect(() => { subs.add(force); return () => { subs.delete(force) } }, [])
  return (
    <>
      {[...labels].map(([id, s]) => {
        const style: CSSProperties = { position: 'absolute', left: 0, top: 0, pointerEvents: s.pointer ? 'auto' : 'none', zIndex: s.z ?? 8, willChange: 'transform' }
        return createElement('div', { key: id, 'data-world-label': id, style, ref: (el: HTMLDivElement | null) => { if (el) elements.set(id, el); else elements.delete(id) } }, s.node)
      })}
    </>
  )
}

const v = new Vector3()

/** Mount once inside the Canvas: owns the overlay root and projects every label each frame. */
export function WorldLabels(): null {
  const gl = useThree((s) => s.gl)
  const invalidate = useThree((s) => s.invalidate)
  useEffect(() => {
    const parent = gl.domElement.parentElement
    if (!parent) return
    const host = document.createElement('div')
    host.setAttribute('data-testid', 'world-labels')
    host.style.cssText = 'position:absolute;inset:0;overflow:hidden;pointer-events:none;'
    parent.appendChild(host)
    const root: Root = createRoot(host)
    root.render(createElement(Overlay))
    const poke = () => invalidate()
    wake.add(poke)
    invalidate()
    return () => {
      wake.delete(poke)
      // never unmount a root from inside React's commit: do it on the next task
      setTimeout(() => { root.unmount(); host.remove() }, 0)
    }
  }, [gl, invalidate])
  useFrame(({ camera, size }) => {
    for (const [id, s] of labels) {
      const el = elements.get(id)
      if (!el) continue
      v.set(s.pos[0], s.pos[1], s.pos[2]).project(camera)
      const visible = v.z > -1 && v.z < 1 && Math.abs(v.x) < 1.2 && Math.abs(v.y) < 1.2
      el.style.display = visible ? '' : 'none'
      if (visible) el.style.transform = `translate(${((v.x + 1) / 2) * size.width}px, ${((1 - v.y) / 2) * size.height}px) translate(-50%, -50%)`
    }
  })
  return null
}
