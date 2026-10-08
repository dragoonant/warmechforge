import { useMemo } from 'react'
import { useCurrentBeat, useDiceLog, useEventFeed, usePresentedState, useShownRoll, useShownRolls, type ShownRoll } from '../contract'
import '../ui/hud.css'
import { viewRoll, type RollView } from './diceView'
import { useTrayStore } from './trayStore'

/** One roll as dice faces, modifiers, total against its target and a result word. */
export function RollCard({ view, rolling, compact }: { view: RollView; rolling?: boolean; compact?: boolean }) {
  return (
    <div
      className={`tray-roll tray-${view.verdict.tone}${compact ? ' tray-compact' : ''}${rolling ? ' tray-rolling' : ''}`}
      data-testid={`tray-roll-${view.rollId}`} data-purpose={view.purpose} data-total={view.total} data-tn={view.target ?? ''}
      title={view.mods.length ? `Modifiers: ${view.mods.join(', ')}` : undefined}
    >
      <div className="tray-roll-head">
        <span className="tray-label">{view.label}</span>
      </div>
      {view.actors && !compact && <div className="tray-actors hud-dim">{view.actors}</div>}
      <div className="tray-dice" aria-label={`dice ${view.dice.map((d) => d.value).join(' ')}`}>
        {view.dice.map((d, i) => (
          <span key={i} className={`tray-die${d.kept ? '' : ' tray-die-dropped'}`} data-value={d.value}>{rolling ? '?' : d.value}</span>
        ))}
        {view.mods.length > 0 && !compact && <span className="tray-mod">{view.mods.join(' ')}</span>}
      </div>
      {!rolling && (
        <div className="tray-result">
          <span className="tray-total" data-testid={`tray-total-${view.rollId}`}>{view.total}</span>
          {view.target !== null && <span className="tray-target" data-testid={`tray-target-${view.rollId}`}>vs {view.targetWord} {view.target}</span>}
          <span className="tray-verdict" data-testid={`tray-verdict-${view.rollId}`}>{view.verdict.word}</span>
        </div>
      )}
    </div>
  )
}

/** Right rail, under the heat panel: the latest (or pinned) roll large, the two before it small. */
export function DiceTray() {
  const state = usePresentedState()
  const last = useShownRoll()
  const lastRolls = useShownRolls()
  const log = useDiceLog()
  const feed = useEventFeed()
  const beat = useCurrentBeat()
  const pinned = useTrayStore((s) => s.pinned)
  const shown: ShownRoll | null = useMemo(() => (pinned ? log.find((r) => r.event.rollId === pinned) ?? last : last), [pinned, log, last])
  const rolling = !!beat && !!shown && !pinned && beat.firstSeq <= shown.seq && shown.seq <= beat.lastSeq && beat.durationMs > 0
  // an initiative beat shows both sides' dice together
  const group: ShownRoll[] = useMemo(() => (!pinned && shown && shown.event.purpose === 'initiative' ? lastRolls.filter((r) => r.event.purpose === 'initiative') : shown ? [shown] : []), [pinned, shown, lastRolls])
  const mains = useMemo(() => group.map((r) => viewRoll(r, state, feed)), [group, state, feed])
  const before = useMemo(() => {
    if (!shown) return []
    const i = log.findIndex((r) => r.seq === shown.seq && r.event.rollId === shown.event.rollId)
    const start = Math.max(0, (i < 0 ? log.length - 1 : i) - group.length + 1)
    return log.slice(Math.max(0, start - 2), start).map((r) => viewRoll(r, state, feed)).reverse()
  }, [shown, group, log, state, feed])
  return (
    <section className="hud-card tray" data-testid="tray" aria-label="Dice tray">
      <h3 className="hud-h">Dice tray{pinned ? <span className="tray-pin"> (pinned)</span> : null}</h3>
      {mains.length > 0 ? mains.map((m) => <RollCard key={m.rollId} view={m} rolling={rolling} />) : <p className="hud-dim" data-testid="tray-empty">No dice rolled yet.</p>}
      {before.length > 0 && <div className="tray-before">{before.map((v) => <RollCard key={v.rollId} view={v} compact />)}</div>}
    </section>
  )
}
