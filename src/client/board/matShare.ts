// The current board's ground-mat albedo, shared so procedural pieces (the trench berms) can sample the same texture
// and blend into the mat. Surface publishes it once loaded; null while loading, on failure, or with no board shown.
import { useSyncExternalStore } from 'react'
import type { Texture } from 'three'

let current: Texture | null = null
const listeners = new Set<() => void>()

export function shareMatAlbedo(t: Texture | null): void {
  if (current === t) return
  current = t
  listeners.forEach((l) => l())
}

export function useMatAlbedo(): Texture | null {
  return useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l) } }, () => current, () => null)
}
