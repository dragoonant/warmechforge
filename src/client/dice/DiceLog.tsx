import { useEffect, useMemo, useRef } from 'react'
import { useDiceLog, useEventFeed, usePresentedState } from '../contract'
import '../ui/hud.css'
import { viewRoll } from './diceView'
import { tray, useTrayStore } from './trayStore'

/** Every roll of the game, oldest first; click a row to pin it in the tray and scroll the event feed to its entry. */
export function DiceLog() {
  const log = useDiceLog()
  const state = usePresentedState()
  const feed = useEventFeed()
  const pinned = useTrayStore((s) => s.pinned)
  const rows = useMemo(() => log.slice(-200).map((r) => viewRoll(r, state, feed)), [log, state, feed])
  const end = useRef<HTMLLIElement | null>(null)
  useEffect(() => { end.current?.scrollIntoView?.({ block: 'nearest' }) }, [rows.length])
  const click = (rollId: string, seq: number) => {
    tray.pin(rollId)
    if (typeof document !== 'undefined') document.querySelector(`[data-testid="feed-entry-${seq}"]`)?.scrollIntoView?.({ block: 'center' })
  }
  return (
    <section className="hud-card dlog" data-testid="dice-log" aria-label="Dice log">
      <h3 className="hud-h">Dice log <span className="hud-dim">{log.length}</span></h3>
      <ol className="dlog-list">
        {rows.length === 0 && <li className="hud-dim">Nothing rolled yet.</li>}
        {rows.map((v) => (
          <li key={v.rollId}>
            <button
              type="button" className={`dlog-row tray-${v.verdict.tone}${pinned === v.rollId ? ' dlog-pinned' : ''}`}
              data-testid={`log-row-${v.rollId}`} onClick={() => click(v.rollId, v.seq)} title="Show this roll in the tray"
            >
              <span className="dlog-label">{v.label}</span>
              <span className="dlog-dice">{v.dice.map((d) => d.value).join(' ')}</span>
              <span className="dlog-total">{v.hideTotal ? '' : v.total}{v.target !== null ? `/${v.target}` : ''}</span>
              <span className="dlog-verdict">{v.verdict.word}</span>
            </button>
          </li>
        ))}
        <li ref={end} aria-hidden="true" />
      </ol>
    </section>
  )
}
