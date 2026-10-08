import { useEffect, useRef } from 'react'

/** Run `handler` on Enter (not while typing, not with modifiers). Pass null when there is nothing to confirm. */
export function useEnterKey(handler: (() => void) | null): void {
  const ref = useRef(handler)
  ref.current = handler
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || e.altKey || e.ctrlKey || e.metaKey || e.repeat) return
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' && (el as HTMLInputElement).type !== 'checkbox' && (el as HTMLInputElement).type !== 'radio' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.tagName === 'BUTTON' || el.isContentEditable)) return
      if (!ref.current) return
      e.preventDefault()
      ref.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
