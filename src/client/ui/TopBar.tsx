import { useMemo } from 'react'
import type { ReactNode } from 'react'
import {
  settings, uiActions, useBanner, useControllers, usePresentedState, usePrompt, useSettings, useShowRanges, useShowThreat, useUiMode, useWaitingFor,
  usePresentationIdle,
} from '../contract'
import './hud.css'
import { SettingsButton } from './SettingsPopover'
import { decisionLine, initiativeStrip, modeFor, phaseText, turnText } from './topbarView'

function Banner() {
  const b = useBanner()
  if (!b) return null
  return (
    <div key={b.id} className={`hud-banner hud-banner-${b.kind}`} data-testid="hud-banner" role="status" style={{ animationDuration: `${Math.max(400, b.durationMs)}ms` }}>
      {b.text}{b.sub ? <span className="banner-sub">{b.sub}</span> : null}
    </div>
  )
}

/** Turn, phase, initiative strip, whose decision it is, and the tool buttons (ruler, line of sight, grid, ranges, settings). */
export function TopBar({ extra }: { extra?: ReactNode }) {
  const state = usePresentedState()
  const waiting = useWaitingFor()
  const controllers = useControllers()
  const prompt = usePrompt()
  const idle = usePresentationIdle()
  const mode = useUiMode()
  const showRanges = useShowRanges()
  const showThreat = useShowThreat()
  const { grid } = useSettings()
  const strip = useMemo(() => (state ? initiativeStrip(state) : null), [state])
  if (!state) return null
  const humans = (controllers.A === 'human' ? 1 : 0) + (controllers.B === 'human' ? 1 : 0)
  const fallback = modeFor(prompt?.kind)
  return (
    <>
      <Banner />
      <header className="hud-top hud-card" data-testid="topbar">
        <div className="top-turn">
          <span className="top-round" data-testid="topbar-turn">{turnText(state)}</span>
          <span className="top-phase" data-testid="topbar-phase" data-phase={state.phase}>{phaseText(state)}</span>
        </div>
        {strip && (
          <div className="top-init" data-testid="topbar-initiative" title={strip.summary}>
            {strip.sides.map((s) => (
              <div key={s.player} className={`init-side${s.picking ? ' init-picking' : ''}`} data-testid={`topbar-side-${s.player}`} style={{ borderColor: s.colour }}>
                <span className="init-name" style={{ color: s.colour }}>{s.name}</span>
                {s.total !== null && <span className={`init-total${s.won ? ' init-won' : ''}`} title={s.won ? 'Won initiative: acts last' : 'Lost initiative: acts first'}>{s.total}</span>}
                <span className="init-pips" aria-label={`${s.units.filter((u) => u.acted).length} of ${s.units.length} have acted`}>
                  {s.units.map((u) => <i key={u.id} title={u.name} className={`pip${u.acted ? ' pip-done' : ''}${u.active ? ' pip-active' : ''}${u.gone ? ' pip-gone' : ''}`} style={{ borderColor: s.colour, ...(u.acted || u.active ? { background: s.colour } : {}) }} />)}
                </span>
              </div>
            ))}
            <span className="init-sum hud-dim">{strip.summary}</span>
          </div>
        )}
        <div className="top-decision" data-testid="topbar-decision" data-player={waiting?.player ?? ''} data-controller={waiting?.controller ?? ''}>{decisionLine(state, waiting, humans, !idle)}</div>
        <div className="top-tools">
          <button type="button" data-testid="topbar-ruler" className={`hud-btn hud-btn-sm${mode === 'measure' ? ' hud-btn-primary' : ''}`} title="Ruler (M)" onClick={() => uiActions.toggleTool('measure', fallback)}>Ruler</button>
          <button type="button" data-testid="topbar-los" className={`hud-btn hud-btn-sm${mode === 'los' ? ' hud-btn-primary' : ''}`} title="Line of sight (L)" onClick={() => uiActions.toggleTool('los', fallback)}>Line of sight</button>
          <button type="button" data-testid="topbar-ranges" className={`hud-btn hud-btn-sm${showRanges ? ' hud-btn-primary' : ''}`} title="Range rings (R)" onClick={() => uiActions.toggleRanges()}>Ranges</button>
          <button type="button" data-testid="topbar-threat" className={`hud-btn hud-btn-sm${showThreat ? ' hud-btn-primary' : ''}`} aria-pressed={showThreat} title="Threat overlay: where the enemy can hurt you next turn (T)" onClick={() => uiActions.toggleThreat()}>Threat</button>
          <button type="button" data-testid="topbar-grid" className={`hud-btn hud-btn-sm${grid ? ' hud-btn-primary' : ''}`} title="Hex grid (G)" onClick={() => settings.set({ grid: !grid })}>Grid</button>
          <SettingsButton />
          {extra}
        </div>
      </header>
    </>
  )
}
