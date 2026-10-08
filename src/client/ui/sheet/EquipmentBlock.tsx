import type { SheetView } from '../../../engine/index'
import { tipProps } from '../Tip'
import { equipmentChips } from '../equipView'

/** Equipment with a state of its own: PPC capacitors, coolant pod, MASC avoid number, jammed weapons (SheetView.equipment). */
export function EquipmentBlock({ sheet }: { sheet: SheetView }) {
  const chips = equipmentChips(sheet)
  if (chips.length === 0) return null
  return (
    <details open data-testid="sheet-equipment">
      <summary className="hud-h2">Equipment</summary>
      <ul className="equip-list">
        {chips.map((c) => (
          <li key={c.key} className={`chip equip-${c.tone}${c.tone === 'bad' ? ' chip-bad' : ''}`} data-testid={`sheet-equip-${c.key}`} data-tone={c.tone} tabIndex={0} {...tipProps({ title: c.text, lines: [c.tip] })}>{c.text}</li>
        ))}
      </ul>
    </details>
  )
}
