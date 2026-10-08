// Loads each enabled figure GLB at most once (module-level cache) WITHOUT suspending: callers get `null` until it is
// ready (or forever if it failed) and keep drawing the procedural figure meanwhile. Geometry, materials and textures are
// shared by every instance; `cloneSkinned` only clones the node tree. Copied from Whirr Machine and adapted.
import { useEffect, useState } from 'react'
import { useThree } from '@react-three/fiber'
import { Mesh, type Object3D } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js'

type Entry = { status: 'loading' | 'ready' | 'failed'; scene?: Object3D }
const cache = new Map<string, Entry>()
const listeners = new Set<() => void>()

export const glbUrl = (slug: string): string => `${import.meta.env?.BASE_URL ?? '/'}assets/models/${slug}.glb`

function request(slug: string): Entry {
  let e = cache.get(slug)
  if (e) return e
  e = { status: 'loading' }
  cache.set(slug, e)
  const entry = e
  try {
    new GLTFLoader()
      .loadAsync(glbUrl(slug))
      .then((gltf) => {
        gltf.scene.traverse((o) => {
          if ((o as Mesh).isMesh) (o as Mesh).castShadow = true // inert when the light does not cast (Low graphics)
        })
        entry.scene = gltf.scene
        entry.status = 'ready'
      })
      .catch(() => { entry.status = 'failed' })
      .finally(() => listeners.forEach((l) => l()))
  } catch {
    entry.status = 'failed'
  }
  return e
}

/** A private node-tree clone of a loaded GLB scene (shares geometry, materials and textures). */
export const cloneGlb = (scene: Object3D): Object3D => cloneSkinned(scene)

/** The shared loaded scene of the slug (never mutate it: `cloneGlb` it), or null while loading, when it failed or when slug
 *  is undefined. Re-renders once when the load settles and wakes the demand frameloop. */
export function useGlbScene(slug: string | undefined): Object3D | null {
  const invalidate = useThree((s) => s.invalidate)
  const gl = useThree((s) => s.gl)
  const [, setTick] = useState(0)
  const entry = slug ? request(slug) : undefined
  useEffect(() => {
    if (!slug) return
    const l = () => { setTick((n) => n + 1); gl.shadowMap.needsUpdate = true; invalidate() }
    listeners.add(l)
    return () => { listeners.delete(l) }
  }, [slug, gl, invalidate])
  const scene = entry?.status === 'ready' ? entry.scene : undefined
  return scene ?? null
}

/** Load state of a slug ('idle' when never requested); the gallery shows it. */
export const glbStatus = (slug: string): 'idle' | 'loading' | 'ready' | 'failed' => cache.get(slug)?.status ?? 'idle'
