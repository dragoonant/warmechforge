import { useEffect, useMemo, useState } from 'react'
import { FAN_NOTICE, game, useGameResult, useGameStats, usePresentedState } from '../contract'
import './hud.css'
import { buildOver } from './gameOverView'

/** Full-screen result: who won and why, per-side damage and losses, then Play again / Back to start. */
export function GameOver({ onExit }: { onExit?: () => void }) {
  const result = useGameResult()
  const state = usePresentedState()
  const stats = useGameStats()
  const [hidden, setHidden] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const over = !!result
  useEffect(() => { if (!over) { setHidden(false); setErr(null) } }, [over])
  const view = useMemo(() => (state && result ? buildOver(state, result, stats) : null), [state, result, stats])
  if (!view) return null
  if (hidden) return <button type="button" className="hud-btn hud-over-chip" data-testid="end-show" onClick={() => setHidden(false)}>Battle over: show result</button>
  return (
    <div className="hud-over" data-testid="end-screen" role="dialog" aria-modal="true" aria-label="Battle over">
      <div className="hud-card over-card">
        <h2 className="over-title" data-testid="end-result">{view.headline}</h2>
        <p className="over-reason" data-testid="end-cause">{view.cause}</p>
        <p className="over-cause hud-dim">The battle lasted {view.turn} turn{view.turn === 1 ? '' : 's'}.</p>
        <table className="over-table" data-testid="end-table">
          <caption>Battle summary</caption>
          <thead><tr><th />{view.sides.map((s) => <th key={s.player} className={`side-${s.player}`}>{s.name}{s.winner ? ' (winner)' : ''}</th>)}</tr></thead>
          <tbody>
            <tr><td>Damage dealt</td>{view.sides.map((s) => <td key={s.player} data-testid={`end-dealt-${s.player}`}>{s.dealt}</td>)}</tr>
            <tr><td>Damage taken</td>{view.sides.map((s) => <td key={s.player} data-testid={`end-taken-${s.player}`}>{s.taken}</td>)}</tr>
            <tr><td>'Mechs destroyed</td>{view.sides.map((s) => <td key={s.player} data-testid={`end-destroyed-${s.player}`}>{s.destroyed}</td>)}</tr>
            <tr><td>'Mechs crippled</td>{view.sides.map((s) => <td key={s.player} data-testid={`end-crippled-${s.player}`}>{s.crippled}</td>)}</tr>
            <tr><td>'Mechs withdrawn</td>{view.sides.map((s) => <td key={s.player} data-testid={`end-withdrawn-${s.player}`}>{s.withdrawn}</td>)}</tr>
            <tr><td>Heat peak</td>{view.sides.map((s) => <td key={s.player} data-testid={`end-heat-${s.player}`}>{s.heatPeak}</td>)}</tr>
          </tbody>
        </table>
        {err && <p className="start-error" role="alert">{err}</p>}
        <div className="pbtns">
          <button type="button" className="hud-btn" data-testid="end-look" onClick={() => setHidden(true)}>Look at the board</button>
          <button type="button" className="hud-btn" data-testid="end-back" onClick={() => (onExit ? onExit() : window.location.reload())}>Back to start</button>
          <button type="button" className="hud-btn hud-btn-primary" data-testid="end-play-again" onClick={() => setErr(game.playAgain()?.text ?? null)}>Play again</button>
        </div>
        <p className="hud-dim over-note">{FAN_NOTICE}</p>
      </div>
    </div>
  )
}
