import { useForceColour, usePresentedUnit, useSheet, useSideName } from '../../contract'
import { armorPercent, statusChips } from './sheetView'

/** Compact card for a hovered unit (shown in place of the record sheet): name, side, armor left, heat, pilot, status. */
export function HoverCard({ unitId }: { unitId: string }) {
  const unit = usePresentedUnit(unitId)
  const sheet = useSheet(unitId)
  const colour = useForceColour(unit?.owner ?? 'A')
  const side = useSideName(unit?.owner ?? 'A')
  if (!unit || !sheet) return null
  const chips = statusChips(sheet, unit)
  const gone = Object.entries(sheet.locations).filter(([, l]) => l.destroyed).map(([k]) => k)
  return (
    <section className="hud-card hovercard" data-testid={`hover-card-${unitId}`} style={{ borderTopColor: colour }}>
      <h3 className="hud-h">{sheet.name}</h3>
      <div className="hud-dim">{side} · {sheet.tonnage} t · {sheet.pilot.name} (G{sheet.pilot.gunnery}/P{sheet.pilot.piloting})</div>
      <div className="hover-row"><span>Armor left</span><b data-testid="hover-armor">{armorPercent(sheet)}%</b></div>
      <div className="hover-row"><span>Heat</span><b data-testid="hover-heat">{sheet.heat}</b></div>
      <div className="hover-row"><span>Move</span><b>{sheet.mp.walk}/{sheet.mp.run}{sheet.mp.baseJump ? `/${sheet.mp.jump}` : ''}</b></div>
      {gone.length > 0 && <div className="hover-row"><span>Lost</span><b>{gone.join(', ')}</b></div>}
      {sheet.pilot.hits > 0 && <div className="hover-row"><span>Pilot hits</span><b>{sheet.pilot.hits}</b></div>}
      {chips.length > 0 && <div className="chips">{chips.map((c) => <span key={c} className="chip">{c}</span>)}</div>}
    </section>
  )
}
