// Hover tooltips for record-sheet entries (weapons, critical slots, heat-scale rows). One shared layer: elements spread
// `tipProps(lines)` and the layer (mounted once in the HUD) shows the lines next to the pointer, clamped to the window.
// Touch and keyboard: focus shows it too, so it is not hover-only.
import { useEffect, useRef, useState, type HTMLAttributes } from 'react'
import { create } from 'zustand'

export interface TipContent { title?: string; lines: string[] }
interface TipStore { content: TipContent | null; x: number; y: number }
export const useTipStore = create<TipStore>(() => ({ content: null, x: 0, y: 0 }))

type TipHandlers = Pick<HTMLAttributes<HTMLElement>, 'onPointerEnter' | 'onPointerMove' | 'onPointerLeave' | 'onFocus' | 'onBlur'> & { 'data-tip'?: string }

/** Handlers to spread on any element: shows `content` while the pointer (or focus) is on it. */
export function tipProps(content: TipContent | null): TipHandlers {
  if (!content) return {}
  const show = (x: number, y: number) => useTipStore.setState({ content, x, y })
  return {
    'data-tip': [content.title, ...content.lines].filter(Boolean).join(' | '),
    onPointerEnter: (e) => show(e.clientX, e.clientY),
    onPointerMove: (e) => show(e.clientX, e.clientY),
    onPointerLeave: () => useTipStore.setState({ content: null }),
    onFocus: (e) => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); show(r.left + 12, r.bottom) },
    onBlur: () => useTipStore.setState({ content: null }),
  }
}

/** Mount once inside the HUD. */
export function TipLayer() {
  const { content, x, y } = useTipStore()
  const box = useRef<HTMLDivElement | null>(null)
  const [pos, setPos] = useState({ left: x, top: y })
  useEffect(() => {
    const el = box.current
    const w = el?.offsetWidth ?? 240, h = el?.offsetHeight ?? 80
    const left = Math.max(8, Math.min(window.innerWidth - w - 8, x + 14 > window.innerWidth - w - 8 ? x - w - 14 : x + 14))
    const top = Math.max(8, Math.min(window.innerHeight - h - 8, y + 16))
    setPos({ left, top })
  }, [x, y, content])
  useEffect(() => {
    const off = () => useTipStore.setState({ content: null })
    window.addEventListener('blur', off)
    window.addEventListener('keydown', off)
    return () => { window.removeEventListener('blur', off); window.removeEventListener('keydown', off) }
  }, [])
  if (!content) return null
  return (
    <div ref={box} className="tip-layer" data-testid="tip" role="tooltip" style={{ left: pos.left, top: pos.top }}>
      {content.title && <b className="tip-title">{content.title}</b>}
      {content.lines.map((l, i) => <div key={i} className="tip-line">{l}</div>)}
    </div>
  )
}
