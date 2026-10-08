// Volume and mute settings, persisted so a player's mix survives a reload (storage key wmf.audio).
import { readJson, writeJson } from '../store/storage'

export interface AudioSettings { master: number; sfx: number; voice: number; music: number; muted: boolean }

export const DEFAULT_AUDIO_SETTINGS: AudioSettings = { master: 0.9, sfx: 1, voice: 1, music: 1, muted: false }
export const AUDIO_SETTINGS_KEY = 'wmf.audio'

const clamp01 = (n: unknown, fallback: number): number => (typeof n === 'number' && Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : fallback)

export function sanitizeAudioSettings(raw: Partial<AudioSettings> | null): AudioSettings {
  const d = DEFAULT_AUDIO_SETTINGS
  if (!raw || typeof raw !== 'object') return { ...d }
  return {
    master: clamp01(raw.master, d.master), sfx: clamp01(raw.sfx, d.sfx), voice: clamp01(raw.voice, d.voice),
    music: clamp01(raw.music, d.music), muted: raw.muted === true,
  }
}

export function loadAudioSettings(): AudioSettings {
  try { return sanitizeAudioSettings(readJson<Partial<AudioSettings>>(AUDIO_SETTINGS_KEY)) } catch { return { ...DEFAULT_AUDIO_SETTINGS } }
}

export function saveAudioSettings(s: AudioSettings): void {
  try { writeJson(AUDIO_SETTINGS_KEY, s) } catch { /* best effort */ }
}
