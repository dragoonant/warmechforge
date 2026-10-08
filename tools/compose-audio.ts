// Builds composite SFX from approved source clips in tools/audio-src/ (decoded in headless Chromium,
// re-encoded with lamejs) for sounds a single prompt could not get right. Each composite is skipped
// unless its source files exist, so this is safe to run at any time. Always overwrites its outputs;
// gen-audio.ts then skips them because they exist. Run: npx tsx tools/compose-audio.ts
import { readFile, writeFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from '@playwright/test'
import { Mp3Encoder } from '@breezystack/lamejs'

const SR = 44100
const root = join(import.meta.dirname, '..')
const src = (f: string) => join(root, 'tools', 'audio-src', f)
const out = (id: string) => join(root, 'public', 'audio', `${id}.mp3`)
const has = (p: string) => stat(p).then(() => true, () => false)

/** Index of the first sample within 30% of the peak, backed off 5 ms so the attack is kept. */
function onset(pcm: Float32Array): number {
  let peak = 0
  for (const v of pcm) peak = Math.max(peak, Math.abs(v))
  const i = pcm.findIndex((v) => Math.abs(v) >= peak * 0.3)
  return Math.max(0, i - Math.round(SR * 0.005))
}

/** tanh soft-clip keeps summed transients punchy without hard clipping. */
const soft = (pcm: Float32Array) => pcm.map((v) => Math.tanh(v * 1.2) / Math.tanh(1.2))

function burst(shot: Float32Array, rounds: number, spacing: number, gains: number[]): Float32Array {
  const s = shot.subarray(onset(shot))
  const step = Math.round(SR * spacing)
  const o = new Float32Array(step * (rounds - 1) + s.length)
  for (let r = 0; r < rounds; r++) for (let i = 0; i < s.length; i++) o[r * step + i] += s[i]! * (gains[r] ?? 1) * 0.75
  return soft(o)
}

function append(a: Float32Array, b: Float32Array, overlap: number): Float32Array {
  const bs = b.subarray(onset(b))
  const start = Math.max(0, a.length - Math.round(SR * overlap))
  const o = new Float32Array(Math.max(a.length, start + bs.length))
  o.set(a)
  for (let i = 0; i < bs.length; i++) o[start + i] += bs[i]!
  return soft(o)
}

function encode(pcm: Float32Array): Buffer {
  const enc = new Mp3Encoder(1, SR, 128)
  const i16 = Int16Array.from(pcm, (v) => Math.max(-32767, Math.min(32767, Math.round(v * 32767))))
  const parts: Uint8Array[] = []
  for (let i = 0; i < i16.length; i += 1152) parts.push(enc.encodeBuffer(i16.subarray(i, i + 1152)))
  parts.push(enc.flush())
  return Buffer.concat(parts.map((p) => Buffer.from(p)))
}

type Decode = (file: string) => Promise<Float32Array>
interface Composite { id: string; sources: string[]; build: (d: Float32Array[]) => Float32Array }

// Add entries when the owner likes a single clip and wants more of it (put the clip in tools/audio-src/).
const COMPOSITES: Composite[] = [
  // Example: { id: 'wp-ac', sources: ['ac-shot.mp3'], build: ([s]) => burst(s!, 3, 0.12, [1, 0.9, 0.95]) },
]

const browser = await chromium.launch()
const page = await browser.newPage()
const decode: Decode = async (path) => {
  const b64 = (await readFile(path)).toString('base64')
  const data: number[] = await page.evaluate(async (d) => {
    const bytes = Uint8Array.from(atob(d), (c) => c.charCodeAt(0))
    const buf = await new OfflineAudioContext(1, 44100, 44100).decodeAudioData(bytes.buffer)
    return Array.from(buf.getChannelData(0))
  }, b64)
  return Float32Array.from(data)
}

const wrote: string[] = []
for (const c of COMPOSITES) {
  if (!(await Promise.all(c.sources.map((s) => has(src(s))))).every(Boolean)) continue
  const pcm = await Promise.all(c.sources.map((s) => decode(src(s))))
  await writeFile(out(c.id), encode(c.build(pcm)))
  wrote.push(c.id)
}
await browser.close()
console.log(`[compose-audio] wrote ${wrote.length ? wrote.join(', ') : 'nothing (no composite sources present in tools/audio-src)'}`)
