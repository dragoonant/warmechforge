import { useEffect, useMemo } from 'react'
import { game, querySheet, uiActions, usePresentedState, usePrompt, usePromptLegal, useWaitingFor } from '../contract'
import './hud.css'
import { FirePanel } from './FirePanel'
import { MovePanel } from './MovePanel'
import { PhysicalPanel } from './PhysicalPanel'
import { PANEL_KINDS, buildPromptView, isLegalAction, type PromptView } from './promptView'

const typing = (t: EventTarget | null): boolean => {
  const el = t as HTMLElement | null
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)
}

const ammoName = (unitId: string, binId: string): string | null => {
  try { return querySheet(unitId)?.ammo.find((b) => b.binId === binId)?.name ?? null } catch { return null }
}

const weaponName = (unitId: string, mountId: string): string | null => {
  try { const w = querySheet(unitId)?.weapons.find((x) => x.mountId === mountId); return w ? `${w.name} (${w.location})` : null } catch { return null }
}

function GenericPrompt({ view }: { view: PromptView }) {
  const legal = usePromptLegal()
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (typing(e.target) || e.altKey || e.ctrlKey || e.metaKey) return
      if (e.key === 'Enter' && view.defaultId) {
        const o = view.options.find((x) => x.id === view.defaultId)
        if (o && isLegalAction(legal, o.action)) { e.preventDefault(); game.dispatch(o.action) }
      } else if (e.key === 'Escape' && view.canPass) { e.preventDefault(); game.pass() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [view, legal])
  return (
    <section className={`hud-dock hud-card prompt prompt-${view.kind}`} data-testid={view.testid} aria-live="polite">
      <h2 className="prompt-title" data-testid="prompt-title">{view.title}</h2>
      {view.lines.map((l, i) => <p key={i} className="prompt-line">{l}</p>)}
      {view.options.length > 0 && (
        <div className="pbtns pbtns-wrap">
          {view.options.map((o) => (
            <button
              key={o.id} type="button" disabled={!isLegalAction(legal, o.action)} data-testid={`prompt-${view.kind}-${o.id}`}
              className={`hud-btn ${o.tone === 'primary' ? 'hud-btn-primary' : o.tone === 'quiet' ? 'hud-btn-quiet' : ''}${o.id === view.defaultId ? ' hud-btn-default' : ''}`}
              onClick={() => game.dispatch(o.action)}
              onMouseEnter={() => { if (o.hoverUnitId) uiActions.hoverUnit(o.hoverUnitId) }} onMouseLeave={() => { if (o.hoverUnitId) uiActions.hoverUnit(null) }}
              onFocus={() => { if (o.hoverUnitId) uiActions.hoverUnit(o.hoverUnitId) }} onBlur={() => { if (o.hoverUnitId) uiActions.hoverUnit(null) }}
            >
              <span className="btn-label">{o.label}</span>
              {o.note && <span className="btn-note">{o.note}</span>}
            </button>
          ))}
        </div>
      )}
      {view.canPass && (
        <div className="pbtns"><button type="button" className="hud-btn hud-btn-quiet" data-testid="prompt-pass" onClick={() => game.pass()}>{view.passLabel} <kbd>Esc</kbd></button></div>
      )}
      {view.defaultId && <div className="hud-dim prompt-hint">Enter picks the highlighted answer.</div>}
    </section>
  )
}

/**
 * Bottom-centre dock. The open decision picks the panel: movement / fire / physical panels for the board decisions, a generic
 * prompt for the rest, "the opponent is thinking" while a bot decides. Opens only when the presentation is idle (usePrompt).
 */
export function PromptDock() {
  const pd = usePrompt()
  const legal = usePromptLegal()
  const state = usePresentedState()
  const waiting = useWaitingFor()
  const view = useMemo(() => (pd && state && !PANEL_KINDS.has(pd.kind) ? buildPromptView(state, pd, legal, { ammoName, weaponName }) : null), [pd, state, legal])
  if (pd && PANEL_KINDS.has(pd.kind)) {
    if (pd.kind === 'move' || pd.kind === 'standUp' || pd.kind === 'deploy') return <MovePanel />
    if (pd.kind === 'declarePhysical') return <PhysicalPanel />
    return <FirePanel />
  }
  if (pd && view && pd.kind !== 'gameOver') return <GenericPrompt key={pd.id} view={view} />
  if (waiting && waiting.controller === 'bot') {
    return <div className="hud-dock hud-dock-wait" data-testid="prompt-waiting" role="status">Opponent is deciding…</div>
  }
  return null
}
