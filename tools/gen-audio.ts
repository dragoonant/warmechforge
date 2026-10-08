// Generates the audio assets listed in tools/audio-manifest.json via the ElevenLabs API.
// SFX and voice go to public/audio/<id>.mp3, music to public/audio/music/<id>.mp3.
// Idempotent: a file that already exists on disk is skipped, so reruns never re-spend credits.
//
//   ELEVENLABS_API_KEY="$(tr -d '\r\n ' < path/to/Tokens.txt)" npx tsx tools/gen-audio.ts [options]
//
// Options:
//   --kind=sfx,voice   kinds to generate (default sfx,voice; music costs far more, so it is opt-in)
//   --only=prefix      only ids starting with this prefix
//   --dry              list what would be generated, no key and no spend
//
// Env: CREDIT_CEILING (default 52100): the account character_count must never exceed this.
//      RUN_BUDGET (default 12000): credits this run may spend.
// The key is read from the environment only and is never printed or written.

import { mkdir, readFile, writeFile, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(__dirname, '..')
const MANIFEST_PATH = join(REPO_ROOT, 'tools', 'audio-manifest.json')
const OUT_DIR = join(REPO_ROOT, 'public', 'audio')
const MUSIC_DIR = join(OUT_DIR, 'music')

const CREDIT_CEILING = Number(process.env.CREDIT_CEILING ?? 52100)
const RUN_BUDGET_CREDITS = Number(process.env.RUN_BUDGET ?? 12000)
// Rough pre-call cost guesses (credits), replaced by the largest observed delta per kind.
// Measured about 12-40 credits per short SFX; narrator lines cost roughly one credit per character.
const INITIAL_ESTIMATE: Record<Kind, number> = { sfx: 40, voice: 60, music: 3000 }

type Kind = 'sfx' | 'voice' | 'music'

interface SfxItem { id: string; kind: 'sfx'; prompt: string; durationSeconds: number; promptInfluence: number; loop?: boolean }
interface VoiceItem { id: string; kind: 'voice'; text: string; voice?: string }
interface MusicItem { id: string; kind: 'music'; prompt: string; durationSeconds: number; loop?: boolean }
type ManifestItem = SfxItem | VoiceItem | MusicItem

interface Manifest {
  voice: { voiceId: string; voiceName: string; modelId: string }
  /** Optional per-role voices (item.voice picks one); falls back to `voice`. */
  voices?: Record<string, { voiceId: string; voiceName: string; modelId: string }>
  music: { endpoint: string; modelId: string; forceInstrumental: boolean; outputFormat: string }
  items: ManifestItem[]
}

interface Subscription { character_count: number; character_limit: number }

const args = process.argv.slice(2)
const flag = (name: string): string | undefined => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3)
const dry = args.includes('--dry')
const kinds = new Set((flag('kind') ?? 'sfx,voice').split(','))
const only = flag('only') ?? ''

function apiKey(): string {
  const key = process.env.ELEVENLABS_API_KEY
  if (!key) throw new Error('ELEVENLABS_API_KEY is not set. Load it from the token file inside the same shell command.')
  return key
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

async function withRetry<T>(label: string, fn: () => Promise<T>, maxAttempts = 5): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn()
    } catch (err) {
      const rateLimited = err instanceof Error && err.message.includes('429')
      if (!rateLimited || attempt >= maxAttempts) throw err
      const backoffMs = 1000 * 2 ** (attempt - 1)
      console.log(`[gen-audio] ${label} rate-limited, retrying in ${backoffMs}ms (attempt ${attempt}/${maxAttempts})`)
      await sleep(backoffMs)
    }
  }
}

async function fetchSubscription(key: string): Promise<Subscription> {
  return withRetry('subscription check', async () => {
    const res = await fetch('https://api.elevenlabs.io/v1/user/subscription', { headers: { 'xi-api-key': key } })
    if (!res.ok) throw new Error(`GET /v1/user/subscription failed: ${res.status}`)
    return (await res.json()) as Subscription
  })
}

async function fileExists(path: string): Promise<boolean> {
  try {
    const s = await stat(path)
    return s.isFile() && s.size > 0
  } catch {
    return false
  }
}

const outPathFor = (item: ManifestItem): string => join(item.kind === 'music' ? MUSIC_DIR : OUT_DIR, `${item.id}.mp3`)

async function post(label: string, url: string, key: string, body: unknown): Promise<Buffer> {
  return withRetry(label, async () => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error(`${label} failed: ${res.status} ${(await res.text()).slice(0, 300)}`)
    return Buffer.from(await res.arrayBuffer())
  })
}

const generateSfx = (key: string, item: SfxItem) =>
  post(`sound-generation "${item.id}"`, 'https://api.elevenlabs.io/v1/sound-generation', key, {
    text: item.prompt,
    duration_seconds: item.durationSeconds,
    prompt_influence: item.promptInfluence,
  })

function generateVoice(key: string, m: Manifest, item: VoiceItem): Promise<Buffer> {
  const v = (item.voice && m.voices?.[item.voice]) || m.voice
  return post(`text-to-speech "${item.id}"`, `https://api.elevenlabs.io/v1/text-to-speech/${v.voiceId}?output_format=mp3_44100_64`, key, {
    text: item.text,
    model_id: v.modelId,
  })
}

// ElevenLabs Music: POST /v1/music?output_format=..., body {prompt, music_length_ms (3000-600000), model_id, force_instrumental}.
const generateMusic = (key: string, m: Manifest, item: MusicItem) =>
  post(`music "${item.id}"`, `https://api.elevenlabs.io${m.music.endpoint}?output_format=${m.music.outputFormat}`, key, {
    prompt: item.prompt,
    music_length_ms: Math.round(item.durationSeconds * 1000),
    model_id: m.music.modelId,
    force_instrumental: m.music.forceInstrumental,
  })

async function main(): Promise<void> {
  const manifest = JSON.parse(await readFile(MANIFEST_PATH, 'utf8')) as Manifest
  const todo: ManifestItem[] = []
  let skipped = 0
  for (const item of manifest.items) {
    if (!kinds.has(item.kind) || !item.id.startsWith(only)) continue
    if (await fileExists(outPathFor(item))) skipped++
    else todo.push(item)
  }

  if (dry) {
    for (const item of todo) console.log(`[gen-audio] would generate ${item.kind} ${item.id}`)
    console.log(`[gen-audio] dry run: ${todo.length} to generate, ${skipped} already present`)
    return
  }

  const key = apiKey()
  await mkdir(OUT_DIR, { recursive: true })
  await mkdir(MUSIC_DIR, { recursive: true })

  const before = await fetchSubscription(key)
  console.log(`[gen-audio] account credits before: ${before.character_count}/${before.character_limit}; ceiling ${CREDIT_CEILING}; run budget ${RUN_BUDGET_CREDITS}`)

  const estimate: Record<Kind, number> = { ...INITIAL_ESTIMATE }
  const observed: Partial<Record<Kind, number>> = {}
  let spent = 0
  let count = before.character_count
  let generated = 0
  let stopped = ''

  for (const item of todo) {
    if (count + estimate[item.kind] > CREDIT_CEILING) { stopped = `credit ceiling ${CREDIT_CEILING} (at ${count}, next ${item.kind} estimated ${estimate[item.kind]})`; break }
    if (spent + estimate[item.kind] > RUN_BUDGET_CREDITS) { stopped = `run budget ${RUN_BUDGET_CREDITS} (spent ${spent})`; break }
    try {
      const audio =
        item.kind === 'sfx' ? await generateSfx(key, item)
        : item.kind === 'voice' ? await generateVoice(key, manifest, item)
        : await generateMusic(key, manifest, item)
      await writeFile(outPathFor(item), audio)
      generated++
      await sleep(1500)
      const after = await fetchSubscription(key)
      const delta = Math.max(0, after.character_count - count)
      count = after.character_count
      spent += delta
      observed[item.kind] = Math.max(observed[item.kind] ?? 0, delta)
      estimate[item.kind] = observed[item.kind] ?? estimate[item.kind]
      console.log(`[gen-audio] generated ${item.id}.mp3 (${item.kind}, +${delta} credits, ${spent} spent this run, account at ${count})`)
      await sleep(1500)
    } catch (err) {
      console.error(`[gen-audio] FAILED "${item.id}": ${err instanceof Error ? err.message : String(err)}`)
      await sleep(1500)
    }
  }

  const end = await fetchSubscription(key)
  console.log(`[gen-audio] account credits after: ${end.character_count}/${end.character_limit}`)
  console.log(`[gen-audio] done: ${generated} generated, ${skipped} already present, ${spent} credits spent${stopped ? `; stopped early: ${stopped}` : ''}`)
}

main().catch((err) => {
  console.error('[gen-audio] fatal:', err instanceof Error ? err.message : err)
  process.exitCode = 1
})
