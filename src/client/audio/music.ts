// Music director: title theme, alternating battle loops, victory/defeat stingers, with crossfades of at least 1.5 s.
// Tracks stream through <audio> elements (a 150 s track decoded to PCM would be ~50 MB). A missing file just errors
// and the director moves to the next candidate, so a build without music is silent, never broken.
import { AUDIO_ASSETS, AUDIO_BY_ID } from './manifest'
import { audioPath } from './paths'
import { TRIMS } from './trims'

export const CROSSFADE_S = 2
export type MusicScene = 'none' | 'title' | 'battle' | 'victory' | 'defeat'

const ids = (prefix: string): string[] => AUDIO_ASSETS.filter((a) => a.kind === 'music' && a.id.startsWith(prefix)).map((a) => a.id)

/** Battle order alternates the two battle loops: 1a, 2a, 1b, 2b. */
export const BATTLE_ORDER: readonly string[] = ['mus-battle1-a', 'mus-battle2-a', 'mus-battle1-b', 'mus-battle2-b']

interface Track { el: HTMLAudioElement; gain: GainNode; node: MediaElementAudioSourceNode; id: string; fadingOut: boolean }

export interface MusicHost { ctx: AudioContext; bus: AudioNode; urlFor(path: string): string; isUnlocked(): boolean; onTrackStart?(id: string): void }

export class MusicDirector {
  private scene: MusicScene = 'none'
  private current: Track | null = null
  private battleIndex = 0
  private titleIndex = 0
  private wanted: MusicScene = 'none'
  private dead = new Set<string>()

  constructor(private host: () => MusicHost | null) {}

  getScene(): MusicScene { return this.wanted }

  /** Ask for a scene. Remembered until the audio context is unlocked. Repeating the current scene is a no-op. */
  setScene(scene: MusicScene): void {
    if (scene === this.wanted && (this.scene === scene || !this.host()?.isUnlocked())) return
    this.wanted = scene
    this.apply()
  }

  /** Called when the context becomes available/unlocked. */
  resume(): void { if (this.wanted !== this.scene) this.apply() }

  private apply(): void {
    const host = this.host()
    if (!host || !host.isUnlocked()) return
    const scene = this.wanted
    this.scene = scene
    if (scene === 'none') { this.fadeOut(this.current, CROSSFADE_S); this.current = null; return }
    if (scene === 'title') this.start(this.candidates(ids('mus-title'), this.titleIndex++), true, 'title')
    else if (scene === 'battle') this.start(this.candidates([...BATTLE_ORDER], this.battleIndex++), false, 'battle')
    else this.start(this.candidates(ids(scene === 'victory' ? 'mus-victory' : 'mus-defeat'), 0), false, scene)
  }

  /** Candidate ids starting at `from` (rotating), skipping ones that failed to load. */
  private candidates(all: string[], from: number): string[] {
    const live = all.filter((id) => !this.dead.has(id) && !AUDIO_BY_ID[id]?.pending)
    if (!live.length) return []
    const n = live.length
    return Array.from({ length: n }, (_, i) => live[(from + i) % n]!)
  }

  private start(cands: string[], loop: boolean, scene: MusicScene): void {
    const host = this.host()
    const id = cands[0]
    if (!host || !id) { this.fadeOut(this.current, CROSSFADE_S); this.current = null; return }
    const { ctx } = host
    const el = new Audio(host.urlFor(audioPath({ id, kind: 'music' })))
    el.loop = loop
    el.crossOrigin = 'anonymous'
    el.preload = 'auto'
    const gain = ctx.createGain()
    gain.gain.value = 0
    const node = ctx.createMediaElementSource(el)
    node.connect(gain).connect(host.bus)
    const track: Track = { el, gain, node, id, fadingOut: false }

    let failed = false
    const fail = () => {
      if (failed) return
      failed = true
      this.dead.add(id)
      this.dispose(track)
      if (this.current === track && this.wanted === scene) {
        this.current = null
        const rest = cands.slice(1)
        if (rest.length) this.start(rest, loop, scene)
      }
    }
    el.addEventListener('error', fail, { once: true })

    if (!loop && scene === 'battle') {
      // Hand over to the next battle theme one crossfade before this one ends.
      let handed = false
      const next = () => { if (handed || this.current !== track || this.wanted !== 'battle') return; handed = true; this.start(this.candidates([...BATTLE_ORDER], this.battleIndex++), false, 'battle') }
      el.addEventListener('timeupdate', () => { if (el.duration > 0 && el.duration - el.currentTime <= CROSSFADE_S + 0.1) next() })
      el.addEventListener('ended', next)
    }

    const prev = this.current
    this.current = track
    void el.play().then(() => {
      if (this.current !== track) { this.dispose(track); return }
      this.fadeOut(prev, CROSSFADE_S)
      const t = ctx.currentTime
      gain.gain.setValueAtTime(0, t)
      gain.gain.linearRampToValueAtTime(TRIMS[id] ?? 1, t + CROSSFADE_S)
      host.onTrackStart?.(id)
    }).catch((err: unknown) => {
      if ((err as { name?: string } | null)?.name === 'NotAllowedError') {
        // autoplay refused: drop this track and let the next unlock retry the scene
        if (this.current === track) { this.current = prev; this.scene = 'none' }
        this.dispose(track)
      } else fail()
    })
  }

  private fadeOut(track: Track | null, seconds: number): void {
    const host = this.host()
    if (!track || !host || track.fadingOut) return
    track.fadingOut = true
    const t = host.ctx.currentTime
    track.gain.gain.cancelScheduledValues(t)
    track.gain.gain.setValueAtTime(track.gain.gain.value, t)
    track.gain.gain.linearRampToValueAtTime(0, t + seconds)
    setTimeout(() => this.dispose(track), seconds * 1000 + 100)
  }

  private dispose(track: Track): void {
    try { track.el.pause(); track.el.removeAttribute('src'); track.el.load(); track.node.disconnect(); track.gain.disconnect() } catch { /* already gone */ }
  }
}
