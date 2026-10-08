import { useEffect, useMemo, useRef } from 'react'
import { querySheet, useEventFeed, usePresentedState } from '../contract'
import './hud.css'
import { buildFeed, lastRows } from './feedView'

const weaponName = (unitId: string, mountId: string): string | null => {
  try { return querySheet(unitId)?.weapons.find((w) => w.mountId === mountId)?.name ?? null } catch { return null }
}

/** Rolling log of what happened, newest at the bottom; each row opens to its full breakdown. */
export function EventFeed() {
  const feed = useEventFeed()
  const state = usePresentedState()
  const rows = useMemo(() => lastRows(buildFeed(state, feed, { weaponName })), [state, feed])
  const end = useRef<HTMLLIElement | null>(null)
  useEffect(() => { end.current?.scrollIntoView?.({ block: 'nearest' }) }, [rows.length, rows[rows.length - 1]?.text])
  return (
    <section className="hud-card feed" data-testid="feed" aria-label="Event feed">
      <h3 className="hud-h">What happened</h3>
      <ol className="feed-list">
        {rows.length === 0 && <li className="hud-dim">Nothing yet.</li>}
        {rows.map((r) => (
          <li key={r.seq} className={`feed-row feed-${r.tone}`} data-testid={`feed-entry-${r.seq}`}>
            {r.detail.length > 0 ? (
              <details>
                <summary className="feed-text">{r.text}</summary>
                <ul className="feed-detail">{r.detail.map((d, i) => <li key={i}>{d}</li>)}</ul>
              </details>
            ) : <span className="feed-text">{r.text}</span>}
          </li>
        ))}
        <li ref={end} aria-hidden="true" />
      </ol>
    </section>
  )
}
