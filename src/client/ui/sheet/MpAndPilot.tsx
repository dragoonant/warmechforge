import type { SheetView, UnitState } from '../../../engine/index'
import { buildMp, buildPilot } from './sheetView'

/** Walk / run / jump: the current value, with the base in brackets in amber when something has reduced it. */
export function MpBlock({ sheet }: { sheet: SheetView }) {
  const mp = buildMp(sheet)
  return (
    <div className="sheet-mp" data-testid="sheet-mp">
      {mp.map((m) => (
        <span key={m.kind} className={`mp-cell${m.reduced ? ' mp-reduced' : ''}`} data-testid={`sheet-mp-${m.kind}`} data-current={m.current} data-base={m.base} title={m.trace || undefined}>
          <span className="mp-k">{m.kind === 'walk' ? 'Walk' : m.kind === 'run' ? 'Run' : 'Jump'}</span> <b>{m.text}</b>
        </span>
      ))}
    </div>
  )
}

/** Six hit boxes, the consciousness target under each, and the pilot's state. */
export function PilotBox({ sheet, unit }: { sheet: SheetView; unit: UnitState }) {
  const p = buildPilot(sheet, unit)
  return (
    <div className="sheet-pilot" data-testid="sheet-pilot" data-status={p.status}>
      <div className="pilot-head"><span>{p.name} ({p.skills})</span><span className={`chip pilot-${p.status}`}>{p.status}</span></div>
      <div className="pilot-boxes">
        {p.boxes.map((b) => (
          <div key={b.n} className="pilot-col">
            <span className={`pilot-box${b.hit ? ' pilot-hit' : ''}`} data-testid={`sheet-pilot-hit-${b.n}`} data-hit={b.hit ? 'true' : 'false'}>{b.hit ? '✕' : ''}</span>
            <span className="pilot-tn hud-dim" title={b.tn !== null ? `With ${b.n} hit${b.n === 1 ? '' : 's'}, stay conscious on ${b.tn}+` : 'Six hits kill the pilot'}>{b.tn !== null ? `${b.tn}+` : 'dead'}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

