import type { SheetView } from '../../../engine/index'
import { LOC_SHORT } from '../../contract'

/** One row per ammunition bin: what it holds, where it sits and the shots left of its capacity. */
export function AmmoBins({ sheet }: { sheet: SheetView }) {
  if (sheet.ammo.length === 0) return <p className="hud-dim" data-testid="sheet-ammo">No ammunition carried.</p>
  return (
    <ul className="ammo-list" data-testid="sheet-ammo">
      {sheet.ammo.map((b) => (
        <li key={b.binId} data-testid={`sheet-ammo-${b.binId}`} data-shots={b.shots} className={b.shots === 0 ? 'ammo-empty' : ''}>
          <span>{b.name}</span><span className="hud-dim">{LOC_SHORT[b.location]}</span><b>{b.shots}/{b.capacity}</b>
        </li>
      ))}
    </ul>
  )
}
