// Frame-rate helpers for a frameloop="demand" canvas. Local to figures / vfx / interaction so they do not depend on the
// board's own frame meter: ask for another frame at a capped rate while something ambient (pulse, smoke) is alive.
const last = new WeakMap<object, number>()
const timers = new WeakMap<object, ReturnType<typeof setTimeout>>()

/** Call from a useFrame while ambient effects are alive: schedules the next frame no sooner than 1/hz s from the last one. */
export function ambientFrame(invalidate: () => void, key: object, hz = 24): void {
  if (timers.has(key)) return
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now()
  const wait = Math.max(0, 1000 / hz - (now - (last.get(key) ?? 0)))
  const t = setTimeout(() => { timers.delete(key); last.set(key, typeof performance !== 'undefined' ? performance.now() : Date.now()); invalidate() }, wait)
  timers.set(key, t)
}
