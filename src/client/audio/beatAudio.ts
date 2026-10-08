// The presentation director's single hook: play the sounds for one beat as it starts.
import type { GameState, PlayerId } from '../../engine/index'
import type { Beat } from '../presentation/beats'
import { useGameStore } from '../store/gameStore'
import { audio, initAudio } from './audio'
import { soundsForBeat } from './eventSounds'

/** The seat a person is playing, or undefined when neither or both seats are human (neutral narration, no cockpit voice). */
export function humanSeat(): PlayerId | undefined {
  const c = useGameStore.getState().controllers
  const humans = (['A', 'B'] as const).filter((p) => c[p] === 'human')
  return humans.length === 1 ? humans[0] : undefined
}

const impacts = new Map<number | string, string>()
const IMPACT_LIMIT = 64

/** Music scene a game-over should switch to, from the human seat's point of view. */
export function endScene(winner: PlayerId | null, seat: PlayerId | undefined): 'victory' | 'defeat' {
  return winner && seat && winner !== seat ? 'defeat' : 'victory'
}

/**
 * Play a beat's sounds. `state` is the presented state as the beat starts; `durMs` its (speed-scaled) duration, 0 when
 * the beat is being skipped (fast-forward), which keeps timed beats silent. Never throws: sound must not break the game.
 */
export function playBeatAudio(beat: Beat, state: GameState | null, durMs: number): void {
  try {
    if (beat.baseMs > 0 && durMs <= 0) return
    initAudio()
    if (audio.music.getScene() === 'none') audio.setMusicScene('battle')
    const seat = humanSeat()
    if (impacts.size > IMPACT_LIMIT) impacts.clear()
    for (const e of beat.events) {
      if (e.event.type === 'GameEnded' && e.event.result.winner) audio.setMusicScene(endScene(e.event.result.winner, seat))
    }
    for (const s of soundsForBeat(beat, { perspective: seat, state, impacts })) {
      const delay = (s.at ?? 0) * durMs
      if (delay > 20) setTimeout(() => audio.play(s.id, s.opts), delay)
      else audio.play(s.id, s.opts)
    }
  } catch { /* sound must never break the game */ }
}
