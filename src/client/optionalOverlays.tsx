// Overlays owned by the AI package (ThreatOverlay, AiTrace): mounted through lazy imports that tolerate the file being absent,
// so the client builds and runs whether or not they have landed. Each is found by file glob; a missing file renders nothing.
import { Suspense, lazy, type ComponentType, type ReactElement } from 'react'

type Loader = () => Promise<Record<string, unknown>>

function pick(loaders: Record<string, Loader>, names: string[]): ComponentType | null {
  const load = Object.values(loaders)[0]
  if (!load) return null
  return lazy(async () => {
    const mod = await load()
    const C = (mod['default'] ?? names.map((n) => mod[n]).find(Boolean)) as ComponentType | undefined
    return { default: C ?? (() => null) }
  })
}

const Threat = pick(import.meta.glob('./interaction/ThreatOverlay.tsx') as Record<string, Loader>, ['ThreatOverlay'])
const Trace = pick(import.meta.glob('./ui/AiTrace.tsx') as Record<string, Loader>, ['AiTrace'])

/** Inside the r3f Canvas: the enemy reach / threat heat-map (T). */
export function ThreatLayer(): ReactElement | null {
  return Threat ? <Suspense fallback={null}><Threat /></Suspense> : null
}

/** In the HUD layer: the AI trace panel. */
export function AiTraceLayer(): ReactElement | null {
  return Trace ? <Suspense fallback={null}><Trace /></Suspense> : null
}

export const overlaysPresent = { threat: Threat !== null, trace: Trace !== null }
