import type { SheetView } from '../../../engine/index'
import { LOC_SHORT } from '../../contract'
import { buildWeaponRows } from './sheetView'

/** Name, location, heat, damage, min / short / medium / long (hexes) and ammo left. Destroyed weapons are struck through. */
export function WeaponsTable({ sheet }: { sheet: SheetView }) {
  const rows = buildWeaponRows(sheet)
  if (rows.length === 0) return <p className="hud-dim">No weapons.</p>
  return (
    <table className="sheet-table" data-testid="sheet-weapons">
      <thead>
        <tr><th>Weapon</th><th>Loc</th><th title="Heat">Ht</th><th title="Damage">Dmg</th><th title="Minimum range">Min</th><th title="Short">S</th><th title="Medium">M</th><th title="Long">L</th><th title="Ammunition left">Ammo</th></tr>
      </thead>
      <tbody>
        {rows.map((w) => (
          <tr
            key={w.mountId} data-testid={`sheet-weapon-${w.mountId}`} data-destroyed={w.destroyed || w.orphaned ? 'true' : 'false'}
            className={`${w.destroyed ? 'w-struck' : ''}${w.orphaned ? ' w-grey' : ''}${w.fired ? ' w-fired' : ''}`}
          >
            <td>{w.name}{w.rear ? ' (rear)' : ''}</td><td>{LOC_SHORT[w.location]}</td><td>{w.heat}</td><td>{w.damage}</td>
            <td>{w.min}</td><td>{w.short}</td><td>{w.medium}</td><td>{w.long}</td><td>{w.ammo}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
