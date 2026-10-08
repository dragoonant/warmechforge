import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { DiceLog } from '../dice/DiceLog'
import { DiceTray } from '../dice/DiceTray'
import {
  game, panels, useActiveUnitId, useControllers, useFatal, useHasGame, useHoverUnitId, useNarration, usePresentedUnits, useRailCollapsed, useRejection, useSelectedId,
  useSettings, useUnitIds, type Rail,
} from '../contract'
import './hud.css'
import { EventFeed } from './EventFeed'
import { GameOver } from './GameOver'
import { TipLayer } from './Tip'
import { HeatScale } from './HeatScale'
import { PromptDock } from './Prompt'
import { HoverCard } from './sheet/HoverCard'
import { RecordSheet } from './sheet/RecordSheet'
import { TopBar } from './TopBar'
import { UnitRoster } from './UnitRoster'

/** A refused answer, in our words, for a few seconds (the engine's own text is the tooltip). */
function Toast() {
  const r = useRejection()
  useEffect(() => {
    if (!r) return
    const t = setTimeout(() => game.clearRejection(), 5000)
    return () => clearTimeout(t)
  }, [r?.id])
  if (!r) return null
  return (
    <div className="hud-toast" data-testid="hud-toast" role="alert" title={r.detail} onClick={() => game.clearRejection()}>
      {r.text}
    </div>
  )
}

function Fatal() {
  const f = useFatal()
  if (!f) return null
  return (
    <div className="hud-over" data-testid="hud-fatal" role="alertdialog">
      <div className="hud-card over-card">
        <h2 className="over-title">The game hit a snag</h2>
        <p>Something went wrong inside the rules engine. Load a save or start a new game.</p>
        <pre className="hud-dim fatal-detail">{f}</pre>
        <div className="pbtns"><button type="button" className="hud-btn hud-btn-primary" onClick={() => window.location.reload()}>Reload</button></div>
      </div>
    </div>
  )
}

/** One-line narration of the latest beat (settings.narration). */
function Narration() {
  const on = useSettings().narration
  const lines = useNarration()
  const last = lines[lines.length - 1]
  if (!on || !last) return null
  return <div className="hud-narration" data-testid="hud-narration" role="log" aria-live="off">{last.text}</div>
}

/** One side rail with its collapse tab. The body stays mounted while collapsed (the feed keeps scrolling) and is only hidden. */
function SideRail({ rail, label, hint, children }: { rail: Rail; label: string; hint: string; children: ReactNode }) {
  const collapsed = useRailCollapsed(rail)
  return (
    <div className={`hud-${rail} hud-rail${collapsed ? ' is-collapsed' : ''}`} data-testid={`rail-${rail}`} data-collapsed={collapsed ? 'true' : 'false'}>
      <div className="rail-body" hidden={collapsed}>{children}</div>
      <button
        type="button" className={`rail-tab rail-tab-${rail}`} data-testid={`rail-${rail}-toggle`} aria-expanded={!collapsed}
        aria-label={`${collapsed ? 'Show' : 'Hide'} ${label}`} title={`${collapsed ? 'Show' : 'Hide'} ${label} (${hint})`} onClick={() => panels.toggle(rail)}
      >
        <span aria-hidden="true">{(rail === 'left') === collapsed ? '▸' : '◂'}</span>
        {collapsed && <span className="rail-tab-label">{label}</span>}
      </button>
    </div>
  )
}

/** Right rail top: the hovered unit's compact card, else the selected (or acting) unit's record sheet. */
function SheetSlot() {
  const hover = useHoverUnitId()
  const selected = useSelectedId()
  const active = useActiveUnitId()
  const controllers = useControllers()
  const ids = useUnitIds()
  const units = usePresentedUnits()
  const own = ids.find((id) => units?.[id] && controllers[units[id]!.owner] === 'human') ?? ids[0] ?? null
  const shown = selected ?? active ?? own
  if (hover && hover !== shown) return <HoverCard unitId={hover} />
  if (!shown) return <p className="hud-card hud-dim sheet-empty" data-testid="sheet-empty">Click a 'Mech to see its record sheet.</p>
  return <RecordSheet unitId={shown} />
}

/**
 * The in-game overlay: top bar, unit roster and event feed on the left, record sheet / heat scale / dice on the right,
 * the decision panel at the bottom centre, and the result screen. Pointer events pass through the gaps to the board.
 * `[` and `]` (rail collapse) are bound by the board's key handler; the rail tabs are clickable too.
 */
export function Hud({ onExit, topExtra }: { onExit?: () => void; topExtra?: ReactNode }) {
  const has = useHasGame()
  if (!has) return null
  return (
    <div className="hud" data-testid="hud">
      <TopBar extra={topExtra} />
      <Narration />
      <SideRail rail="left" label="Forces" hint="[">
        <UnitRoster />
        <EventFeed />
      </SideRail>
      <SideRail rail="right" label="Record sheet" hint="]">
        <SheetSlot />
        <HeatScale />
        <DiceTray />
        <DiceLog />
      </SideRail>
      <PromptDock />
      <Toast />
      <TipLayer />
      <GameOver onExit={onExit} />
      <Fatal />
    </div>
  )
}
