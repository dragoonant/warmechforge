// The one AudioManager per page, created lazily so importing this module costs nothing until audio is needed.
import { AudioManager } from './manager'

export const audio = new AudioManager()

let started = false
/** Idempotent: hook up first-gesture unlock. Called by the presentation director, the app shell and the sound settings panel. */
export function initAudio(): AudioManager {
  if (!started) {
    started = true
    audio.attachAutoUnlock()
    try {
      if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('test') === '1') (window as unknown as { __audio?: AudioManager }).__audio = audio
    } catch { /* no window */ }
  }
  return audio
}
