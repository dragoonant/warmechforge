// Web Audio manager. Buses: sfx and voice -> master; music -> duck -> master. Unlocked on the first click, tap or key.
//  - volumes and mute persist (settings.ts); changes apply live,
//  - the music bus sits MUSIC_DB below SFX at equal sliders and ducks DUCK_DB under narrator lines,
//  - throttling: a burst of one sound id becomes a few layered instances, each detuned a little,
//  - missing or undecodable files fail silently (remembered, never retried).
import { AUDIO_BY_ID } from './manifest'
import { audioPath } from './paths'
import { MusicDirector, type MusicScene } from './music'
import { loadAudioSettings, saveAudioSettings, type AudioSettings } from './settings'
import { TRIMS } from './trims'

export type Bus = 'sfx' | 'voice' | 'music'
export interface PlayOptions {
  /** 0..1, multiplies the sound's own trim and bus volume. */
  volume?: number
  /** Max random pitch jitter in cents (+/-). Defaults per bus; 0 disables. */
  detuneJitter?: number
  /** Voice only: play even if another line is still speaking (otherwise the new line is dropped). */
  interrupt?: boolean
}

export const MUSIC_DB = -14
export const DUCK_DB = -6
const dbToGain = (db: number): number => Math.pow(10, db / 20)

const MAX_CONCURRENT = 4
const MIN_RETRIGGER_MS: Record<Bus, number> = { sfx: 12, voice: 150, music: 0 }
const JITTER_CENTS: Record<Bus, number> = { sfx: 35, voice: 0, music: 0 }
const DUCK_ATTACK_S = 0.12
const DUCK_RELEASE_S = 0.7

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n))
const nowMs = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now())
const baseUrl = (): string => {
  try { return (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/' } catch { return '/' }
}
export const audioUrl = (path: string): string => `${baseUrl()}${path}`

interface Throttle { active: number; lastStart: number }

/** Counters for tests and debugging (exposed as window.__audio with ?test=1). */
export interface AudioStats { decoded: string[]; failed: string[]; played: Record<string, number>; music: string[] }

export class AudioManager {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private bus: Partial<Record<Bus, GainNode>> = {}
  private duck: GainNode | null = null
  private settings: AudioSettings = loadAudioSettings()
  private listeners = new Set<(s: AudioSettings) => void>()
  private buffers = new Map<string, AudioBuffer>()
  private loading = new Map<string, Promise<AudioBuffer | null>>()
  private missing = new Set<string>()
  private throttle = new Map<string, Throttle>()
  private unlocked = false
  private attached = false
  private voiceActive = 0
  private duckHold = 0
  readonly stats: AudioStats = { decoded: [], failed: [], played: {}, music: [] }
  readonly music = new MusicDirector(() => (this.ctx && this.duck ? { ctx: this.ctx, bus: this.duck, urlFor: audioUrl, isUnlocked: () => this.unlocked, onTrackStart: (id: string) => { this.stats.music.push(id) } } : null))

  /** One-time listeners: the first pointer, key or touch unlocks audio. Safe to call repeatedly. */
  attachAutoUnlock(): void {
    if (this.attached || typeof window === 'undefined') return
    this.attached = true
    const handler = () => {
      window.removeEventListener('pointerdown', handler, true)
      window.removeEventListener('keydown', handler, true)
      window.removeEventListener('touchstart', handler, true)
      void this.unlock()
    }
    window.addEventListener('pointerdown', handler, true)
    window.addEventListener('keydown', handler, true)
    window.addEventListener('touchstart', handler, true)
    // soft click on every button, once audio is running
    window.addEventListener('pointerdown', (e) => {
      const t = e.target as Element | null
      if (this.unlocked && t?.closest?.('button')) this.play('ui-click', { volume: 0.5 })
    })
  }

  async unlock(): Promise<void> {
    try {
      this.ensureContext()
      if (this.ctx && this.ctx.state === 'suspended') await this.ctx.resume().catch(() => undefined)
      this.unlocked = this.ctx?.state === 'running'
      if (this.unlocked) {
        this.music.resume()
        for (const a of Object.values(AUDIO_BY_ID)) if (a.kind !== 'music' && !a.loop) void this.ensureBuffer(a.id)
      }
    } catch { /* no Web Audio: stay silent */ }
  }

  private ensureContext(): void {
    if (this.ctx || typeof window === 'undefined') return
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return
    const ctx = new Ctor()
    this.ctx = ctx
    this.master = ctx.createGain()
    this.master.connect(ctx.destination)
    // sfx goes through a fast limiter so boosted quiet clips (trim up to 4x) never clip
    const limiter = ctx.createDynamicsCompressor()
    limiter.threshold.value = -6
    limiter.knee.value = 6
    limiter.ratio.value = 20
    limiter.attack.value = 0.002
    limiter.release.value = 0.12
    limiter.connect(this.master)
    for (const b of ['sfx', 'voice', 'music'] as const) {
      const g = ctx.createGain()
      g.connect(b === 'sfx' ? limiter : this.master)
      this.bus[b] = g
    }
    this.duck = ctx.createGain()
    this.duck.connect(this.bus.music!)
    this.applyGains()
  }

  private applyGains(): void {
    if (!this.master) return
    const s = this.settings
    this.master.gain.value = s.muted ? 0 : clamp01(s.master)
    this.bus.sfx!.gain.value = clamp01(s.sfx)
    this.bus.voice!.gain.value = clamp01(s.voice)
    this.bus.music!.gain.value = clamp01(s.music) * dbToGain(MUSIC_DB)
  }

  /** Decode a file into memory; failures are remembered silently. */
  private ensureBuffer(id: string): Promise<AudioBuffer | null> {
    const have = this.buffers.get(id)
    if (have) return Promise.resolve(have)
    if (this.missing.has(id)) return Promise.resolve(null)
    const inflight = this.loading.get(id)
    if (inflight) return inflight
    const asset = AUDIO_BY_ID[id]
    if (!asset || asset.kind === 'music') return Promise.resolve(null)
    const p = (async () => {
      try {
        this.ensureContext()
        if (!this.ctx) return null
        const res = await fetch(audioUrl(audioPath(asset)))
        if (!res.ok) throw new Error(String(res.status))
        const type = res.headers.get('content-type') ?? ''
        if (type.includes('text/html')) throw new Error('not audio')
        const buf = await this.ctx.decodeAudioData(await res.arrayBuffer())
        this.buffers.set(id, buf)
        this.stats.decoded.push(id)
        return buf
      } catch {
        this.missing.add(id)
        this.stats.failed.push(id)
        return null
      } finally {
        this.loading.delete(id)
      }
    })()
    this.loading.set(id, p)
    return p
  }

  /** Play a one-shot sfx or voice line. Silent before unlock, while decoding, if the file is missing, or when throttled. */
  play(id: string, opts: PlayOptions = {}): void {
    try {
      const asset = AUDIO_BY_ID[id]
      if (!asset || asset.kind === 'music' || asset.loop || this.missing.has(id)) return
      const bus: Bus = asset.kind === 'voice' ? 'voice' : 'sfx'
      const t = nowMs()
      const st = this.throttle.get(id) ?? { active: 0, lastStart: 0 }
      if (st.active >= MAX_CONCURRENT || t - st.lastStart < MIN_RETRIGGER_MS[bus]) return
      if (bus === 'voice' && this.voiceActive > 0 && !opts.interrupt) return
      const buf = this.buffers.get(id)
      if (!buf) { void this.ensureBuffer(id); return }
      this.start(id, bus, buf, opts, st, t)
    } catch { /* never let sound break the game */ }
  }

  private start(id: string, bus: Bus, buf: AudioBuffer, opts: PlayOptions, st: Throttle, t: number): void {
    const ctx = this.ctx
    const dest = this.bus[bus]
    if (!this.unlocked || !ctx || !dest) return
    const src = ctx.createBufferSource()
    src.buffer = buf
    const jitter = opts.detuneJitter ?? JITTER_CENTS[bus]
    if (jitter) src.detune.value = (Math.random() * 2 - 1) * jitter
    const g = ctx.createGain()
    // simultaneous copies of one sound layer, each a little quieter so a volley stays under the limiter
    g.gain.value = clamp01(opts.volume ?? 1) * Math.min(4, TRIMS[id] ?? 1) / (1 + 0.35 * st.active)
    src.connect(g).connect(dest)
    st.active++
    this.stats.played[id] = (this.stats.played[id] ?? 0) + 1
    st.lastStart = t
    this.throttle.set(id, st)
    if (bus === 'voice') { this.voiceActive++; this.duckMusic(buf.duration) }
    src.onended = () => {
      st.active = Math.max(0, st.active - 1)
      if (bus === 'voice') this.voiceActive = Math.max(0, this.voiceActive - 1)
      src.disconnect()
      g.disconnect()
    }
    src.start()
  }

  /** Duck the music bus DUCK_DB for `seconds`, then release. */
  private duckMusic(seconds: number): void {
    const ctx = this.ctx
    const duck = this.duck
    if (!ctx || !duck) return
    const now = ctx.currentTime
    this.duckHold = Math.max(this.duckHold, now + DUCK_ATTACK_S + seconds)
    duck.gain.cancelScheduledValues(now)
    duck.gain.setValueAtTime(duck.gain.value, now)
    duck.gain.linearRampToValueAtTime(dbToGain(DUCK_DB), now + DUCK_ATTACK_S)
    duck.gain.setValueAtTime(dbToGain(DUCK_DB), this.duckHold)
    duck.gain.linearRampToValueAtTime(1, this.duckHold + DUCK_RELEASE_S)
  }

  // ---------- music ----------
  setMusicScene(scene: MusicScene): void { try { this.music.setScene(scene) } catch { /* silent */ } }

  // ---------- settings ----------
  getSettings(): AudioSettings { return this.settings }
  setMuted(muted: boolean): void { this.update({ ...this.settings, muted }) }
  setVolume(bus: 'master' | Bus, value: number): void { this.update({ ...this.settings, [bus]: clamp01(value) }) }
  private update(next: AudioSettings): void {
    this.settings = next
    saveAudioSettings(next)
    this.applyGains()
    for (const l of this.listeners) l(next)
  }
  onSettingsChange(l: (s: AudioSettings) => void): () => void { this.listeners.add(l); return () => { this.listeners.delete(l) } }
  isUnlocked(): boolean { return this.unlocked }
}
