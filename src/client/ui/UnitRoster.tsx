import { crippledReason } from './format'
import { game, uiActions, useActiveUnitId, useForceColour, useHoverUnitId, usePresentedUnit, usePrompt, useSelectedId, useSheet, useSideName, useUnitIds, usePresentedUnits } from '../contract'
import type { PlayerId, UnitId } from '../../engine/index'
import './hud.css'
import { armorPercent } from './sheet/sheetView'

function RosterRow({ id }: { id: UnitId }) {
  const unit = usePresentedUnit(id)
  const sheet = useSheet(id)
  const selected = useSelectedId() === id
  const hovered = useHoverUnitId() === id
  const active = useActiveUnitId() === id
  const prompt = usePrompt()
  if (!unit || !sheet) return null
  const eligible = prompt?.kind === 'selectUnit' && (prompt.context.eligible ?? []).includes(id)
  const gone = unit.status === 'destroyed' || unit.status === 'withdrawn' || unit.status === 'surrendered'
  const icons: string[] = []
  if (unit.status === 'destroyed') icons.push('destroyed')
  else if (gone) icons.push(unit.status)
  if (unit.crippled && !gone) icons.push(`crippled: ${crippledReason(unit)}`)
  if (unit.prone) icons.push('prone')
  if (unit.shutdown) icons.push('shutdown')
  if (!unit.pilot.conscious && !unit.pilot.dead) icons.push('unconscious')
  if (unit.pilot.dead) icons.push('pilot killed')
  const armor = armorPercent(sheet)
  return (
    <li>
      <button
        type="button" data-testid={`roster-unit-${id}`} data-selected={selected ? 'true' : 'false'} data-eligible={eligible ? 'true' : 'false'} data-destroyed={unit.status === 'destroyed' ? 'true' : 'false'}
        className={`roster-row${selected ? ' roster-sel' : ''}${hovered ? ' roster-hover' : ''}${active ? ' roster-active' : ''}${eligible ? ' roster-eligible' : ''}${gone ? ' roster-gone' : ''}`}
        onClick={() => { if (eligible) game.selectUnit(id); uiActions.select(id) }}
        onMouseEnter={() => uiActions.hoverUnit(id)} onMouseLeave={() => uiActions.hoverUnit(null)} onFocus={() => uiActions.hoverUnit(id)} onBlur={() => uiActions.hoverUnit(null)}
      >
        <span className="roster-name">{unit.name}</span>
        <span className="roster-bar" aria-hidden="true"><i style={{ width: `${armor}%` }} /></span>
        <span className="roster-armor" title="Armor left" data-testid={`roster-armor-${id}`}>{armor}%</span>
        <span className={`roster-heat${unit.heat >= 10 ? ' roster-hot' : ''}`} title="Heat" data-testid={`roster-heat-${id}`}>{unit.heat}</span>
        {icons.length > 0 && <span className="roster-icons">{icons.map((i) => <span key={i} className="chip">{i}</span>)}</span>}
      </button>
    </li>
  )
}

function SideGroup({ player, ids }: { player: PlayerId; ids: UnitId[] }) {
  const name = useSideName(player)
  const colour = useForceColour(player)
  if (ids.length === 0) return null
  return (
    <div className="roster-side" data-testid={`roster-side-${player}`}>
      <h4 className="hud-h2" style={{ color: colour }}>{name}</h4>
      <ul className="roster-list">{ids.map((id) => <RosterRow key={id} id={id} />)}</ul>
    </div>
  )
}

/** Left rail: both forces, each 'Mech with armor left, heat and status. Click selects (or picks it when it is the one to act). */
export function UnitRoster() {
  const ids = useUnitIds()
  const units = usePresentedUnits()
  if (!units) return null
  return (
    <section className="hud-card roster" data-testid="roster" aria-label="Units">
      <h3 className="hud-h">Forces</h3>
      {(['A', 'B'] as PlayerId[]).map((p) => <SideGroup key={p} player={p} ids={ids.filter((id) => units[id]?.owner === p)} />)}
    </section>
  )
}
