// Which chassis render from a pre-made GLB (public/assets/models/<slug>.glb) instead of the procedural kit (30-figures
// section 7). Key = chassis key (profile.chassisKey, e.g. 'solitaire'); value = slug = file name without '.glb'.
//
// TO ENABLE A FIGURE: drop <slug>.glb into public/assets/models/ and list the slug in public/assets/models/manifest.json
// (a test checks manifest <= files on disk). A slug that is not listed is never requested, so a missing GLB can never
// log a 404 and the chassis stays procedural. Copied from Whirr Machine and adapted.
import { useEffect, useState } from 'react'

/** Chassis key -> GLB slug: `bt-<chassis-kebab>`. Listing a chassis here does NOT enable it; the manifest does. */
export const GLB_SLUG_BY_MODEL: Readonly<Record<string, string>> = {
  solitaire: 'bt-solitaire',
  regent: 'bt-regent',
  eris: 'bt-eris',
  rakshasa: 'bt-rakshasa',
  uziel: 'bt-uziel',
  hollander: 'bt-hollander',
  'mad-cat-mk-ii': 'bt-mad-cat-mk-ii',
  'vulture-mk-iv': 'bt-vulture-mk-iv',
}

/** Slugs the manifest says exist on disk (filled once by loadGlbManifest; empty until then or if it cannot be read). */
const manifestSlugs = new Set<string>()
let manifestLoad: Promise<void> | undefined
let manifestListeners: Array<() => void> = []

/** Parse a manifest body ({ "slugs": [...] }) into slugs; anything malformed gives []. Pure (tests). */
export function parseGlbManifest(raw: unknown): string[] {
  const list = raw && typeof raw === 'object' ? (raw as { slugs?: unknown }).slugs : undefined
  return Array.isArray(list) ? list.filter((s): s is string => typeof s === 'string' && /^[a-z0-9-]+$/.test(s)) : []
}

/** Fetch public/assets/models/manifest.json once (never throws, never logs). Listeners fire when it settles. */
export function loadGlbManifest(): Promise<void> {
  if (manifestLoad) return manifestLoad
  manifestLoad = (async () => {
    try {
      if (typeof fetch === 'undefined' || typeof location === 'undefined') return
      const res = await fetch(`${import.meta.env?.BASE_URL ?? '/'}assets/models/manifest.json`, { cache: 'no-cache' })
      if (res.ok) for (const s of parseGlbManifest(await res.json())) manifestSlugs.add(s)
    } catch { /* offline or malformed: everything stays procedural */ }
    const ls = manifestListeners
    manifestListeners = []
    ls.forEach((l) => l())
  })()
  return manifestLoad
}
/** Call fn once when the manifest has loaded. */
export const onGlbManifest = (fn: () => void): void => { void loadGlbManifest().then(fn) }
/** Test hook: set the manifest slugs directly. */
export function setGlbManifestForTest(slugs: readonly string[]): void { manifestSlugs.clear(); slugs.forEach((s) => manifestSlugs.add(s)); manifestLoad = Promise.resolve() }

if (typeof window !== 'undefined') void loadGlbManifest()

/** Re-renders the caller once the manifest has loaded, so a figure picks up a GLB that is listed there. */
export function useGlbManifestReady(): boolean {
  const [, tick] = useState(0)
  useEffect(() => { onGlbManifest(() => tick((n) => n + 1)) }, [])
  return manifestSlugs.size > 0
}

/** True when the slug's file is known to exist (listed in the manifest). */
export const glbAvailable = (slug: string): boolean => manifestSlugs.has(slug)

/** The enabled GLB slug for a chassis key (explicit map first, then the data's `figure` id), or undefined = procedural. */
export function glbSlugFor(chassisKey: string, dataFigure?: string): string | undefined {
  const slug = GLB_SLUG_BY_MODEL[chassisKey] ?? dataFigure
  return slug && glbAvailable(slug) ? slug : undefined
}

/** Every available slug once, sorted. */
export const enabledSlugs = (): string[] => [...manifestSlugs].sort()
