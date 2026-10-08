// The coach line: one sentence at the bottom saying what the game wants next. Dismiss per kind of decision (remembered
// in localStorage under wmf.coach), or turn all tips off. Shows only for a decision a human can answer now.
import { useState, useSyncExternalStore } from 'react'
import { usePrompt } from '../../contract'
import { COACH_KEY, coachKey, coachTip, dismissKey, parseCoach, shouldCoach, type CoachMemory } from './coachText'
import { openHelp } from './HelpGuide'
import './help.css'

let mem: CoachMemory | null = null
function load(): CoachMemory {
  if (mem) return mem
  let raw: string | null = null
  try { raw = localStorage.getItem(COACH_KEY) } catch { /* blocked: memory only */ }
  return (mem = parseCoach(raw))
}
const listeners = new Set<() => void>()
function save(next: CoachMemory): void {
  mem = next
  try { localStorage.setItem(COACH_KEY, JSON.stringify(next)) } catch { /* blocked */ }
  for (const l of listeners) l()
}

/** Coach tips on or off (Settings and the line's own "Turn tips off" share this). */
export function tipsEnabled(): boolean { return !load().off }
export function setTipsEnabled(on: boolean): void { save({ ...load(), off: !on, ...(on ? { seen: [] } : {}) }) }
export function useTipsEnabled(): boolean {
  return useSyncExternalStore((cb) => { listeners.add(cb); return () => { listeners.delete(cb) } }, tipsEnabled, () => true)
}

export function CoachLine() {
  const prompt = usePrompt()
  useTipsEnabled()
  const [, bump] = useState(0)
  const m = load()
  if (!prompt || !shouldCoach(m, prompt)) return null
  const key = coachKey(prompt)!
  return (
    <div className="coach" role="status" data-testid="coach-line">
      <span className="coach-text">{coachTip(prompt)}</span>
      <button type="button" className="coach-link" data-testid="coach-help" onClick={() => openHelp()}>How to play</button>
      <button type="button" className="coach-link" data-testid="coach-off" onClick={() => { save({ ...m, off: true }); bump((n) => n + 1) }}>Turn tips off</button>
      <button type="button" className="coach-x" data-testid="coach-dismiss" aria-label="Dismiss this tip" title="Dismiss this tip"
        onClick={() => { save(dismissKey(m, key)); bump((n) => n + 1) }}>x</button>
    </div>
  )
}
