import { useForceColour, usePresentedUnit, useSheet, useSideName } from '../../contract'
import { AmmoBins } from './AmmoBins'
import { CritSlots } from './CritSlots'
import { EquipmentBlock } from './EquipmentBlock'
import { MpBlock, PilotBox } from './MpAndPilot'
import { PaperDoll } from './PaperDoll'
import { sheetHeader, sinkText, statusChips } from './sheetView'
import { WeaponsTable } from './WeaponsTable'

/** The selected unit's record sheet: a vertical card with collapsible sections (our own layout). */
export function RecordSheet({ unitId }: { unitId: string }) {
  const unit = usePresentedUnit(unitId)
  const sheet = useSheet(unitId)
  const colour = useForceColour(unit?.owner ?? 'A')
  const side = useSideName(unit?.owner ?? 'A')
  if (!unit || !sheet) return null
  const chips = statusChips(sheet, unit)
  const pilotLine = `${sheet.pilot.name} (G${sheet.pilot.gunnery}/P${sheet.pilot.piloting})`
  return (
    <section className="hud-card sheet" data-testid={`sheet-root-${unitId}`} aria-label={`Record sheet: ${sheet.name}`} style={{ borderTopColor: colour }}>
      <header className="sheet-head" style={{ borderLeftColor: colour }}>
        <h3 className="hud-h" data-testid="sheet-title">{sheetHeader(sheet)}</h3>
        <div className="sheet-sub hud-dim">{side} · {pilotLine}</div>
        {chips.length > 0 && <div className="chips" data-testid="sheet-status">{chips.map((c) => <span key={c} className="chip">{c}</span>)}</div>}
      </header>
      <MpBlock sheet={sheet} />
      <PaperDoll sheet={sheet} unitId={unitId} />
      <div className="sheet-sinks hud-dim" data-testid="sheet-sinks">Heat sinks: {sinkText(sheet)}</div>
      <details open><summary className="hud-h2">Weapons</summary><WeaponsTable sheet={sheet} /></details>
      <EquipmentBlock sheet={sheet} />
      <details><summary className="hud-h2">Critical slots</summary><CritSlots sheet={sheet} /></details>
      <details open><summary className="hud-h2">Ammunition</summary><AmmoBins sheet={sheet} /></details>
      <details open><summary className="hud-h2">Pilot</summary><PilotBox sheet={sheet} unit={unit} /></details>
    </section>
  )
}
