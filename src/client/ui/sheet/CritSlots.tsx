import { useState } from 'react'
import type { SheetView } from '../../../engine/index'
import { LOC_LABELS } from '../../contract'
import { buildCrits } from './sheetView'

/** Per location, 6 or 12 rows. A hit slot is struck through with a red tick; empty slots are dim. */
export function CritSlots({ sheet }: { sheet: SheetView }) {
  const [open, setOpen] = useState<string | null>(null)
  const locs = buildCrits(sheet)
  return (
    <div className="crits" data-testid="sheet-crits">
      {locs.map((l) => {
        const hits = l.slots.filter((s) => s.hit).length
        return (
          <details key={l.loc} open={open === l.loc} onToggle={(e) => { const o = (e.currentTarget as HTMLDetailsElement).open; setOpen((cur) => (o ? l.loc : cur === l.loc ? null : cur)) }}>
            <summary className={l.destroyedLoc ? 'crit-gone' : ''}>
              {LOC_LABELS[l.loc]}{hits ? <span className="crit-count"> · {hits} hit</span> : null}{l.destroyedLoc ? ' · destroyed' : ''}
            </summary>
            <ol className="crit-list">
              {l.slots.map((s) => (
                <li
                  key={s.index} data-testid={`sheet-crit-${l.loc}-${s.index + 1}`} data-hit={s.hit ? 'true' : 'false'}
                  className={`crit-slot${s.destroyed ? ' crit-hit' : ''}${s.empty ? ' crit-empty' : ''}${s.ammo ? ' crit-ammo' : ''}`}
                >
                  <span className="crit-n">{s.index + 1}</span>
                  <span className="crit-label">{s.label}</span>
                  {s.hit && <span className="crit-tick" aria-label="hit">✕</span>}
                </li>
              ))}
            </ol>
          </details>
        )
      })}
    </div>
  )
}
