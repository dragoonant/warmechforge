import { useEffect, useMemo, useState } from 'react'
import {
  game, uiActions, useEventFeed, usePhysicalDraft, usePhysicalOptions, usePhysicalPreview, usePresentedState, usePresentedUnit, usePrompt, usePromptLegal,
  useSettings, unitName,
} from '../contract'
import './hud.css'
import { useEnterKey } from './useEnter'
import { buildPhysicalRows, lockedAttackLine, physicalSentence } from './physicalView'

/** Physical Attack Phase: pick a target, then one punch / kick / push (or none). Charge and DFA only show as a locked row. */
export function PhysicalPanel() {
  const pd = usePrompt()
  const legal = usePromptLegal()
  const state = usePresentedState()
  const unitId = pd?.unitId ?? null
  const unit = usePresentedUnit(unitId)
  const draft = usePhysicalDraft()
  const settings = useSettings()
  const feed = useEventFeed()
  const targets = pd?.context.targets ?? []
  const target = draft.targetId && targets.includes(draft.targetId) ? draft.targetId : null
  const [picked, setPicked] = useState<string | null>(null)

  useEffect(() => { setPicked(null) }, [pd?.id, target])
  useEffect(() => { if (pd && !target && targets.length > 0) uiActions.setPhysicalDraft({ targetId: targets[0]! }) }, [pd?.id, target, targets.join(',')])

  const options = usePhysicalOptions(unitId, target)
  const rows = useMemo(() => (target ? buildPhysicalRows(state, target, options, legal, settings.odds) : []), [state, target, options, legal, settings.odds])
  const row = rows.find((r) => r.id === picked && r.legal) ?? null

  // charge / DFA declared with the move
  const lockedKind = unit?.attacks.charge ? 'charge' : unit?.attacks.dfa ? 'dfa' : null
  const locked = unit?.attacks.charge ?? unit?.attacks.dfa ?? null
  const lockedPreview = usePhysicalPreview(unitId && lockedKind && locked ? { attackerId: unitId, kind: lockedKind, targetId: locked.targetId, attackerAt: { hex: locked.fromHex } } : null)
  const voided = pd?.context.data?.code === 'chargeVoided'
  const voidedTarget = useMemo(() => {
    if (!voided || !unitId) return null
    for (let i = feed.length - 1; i >= 0; i--) { const e = feed[i]!.event; if (e.type === 'PhysicalDeclaredInMove' && e.unitId === unitId) return e.targetId }
    return null
  }, [voided, unitId, feed])

  useEnterKey(pd && row?.choice ? () => { game.physical(row.choice!) } : null)
  if (!pd || !unit) return null
  return (
    <section className="hud-dock hud-card prompt panel panel-phys" data-testid="phys-panel" aria-live="polite">
      <h2 className="prompt-title">{unit.name}: physical attack</h2>
      {voided && <p className="phys-void" role="alert" data-testid="phys-void">Your charge{voidedTarget ? ` on ${unitName(state, voidedTarget)}` : ''} is void: choose another attack.</p>}
      {lockedPreview && locked && lockedKind && (
        <p className="phys-locked" data-testid="phys-locked">{lockedAttackLine(state, lockedPreview, locked.targetId)}</p>
      )}
      {targets.length === 0 ? <p className="prompt-line">Nothing is close enough to hit. You can only make no attack.</p> : (
        <div className="fire-targets" role="group" aria-label="Target">
          <span className="hud-dim">Target</span>
          {targets.map((t) => (
            <button key={t} type="button" data-testid={`phys-target-${t}`} className={`hud-btn hud-btn-sm${t === target ? ' hud-btn-primary' : ''}`} onClick={() => { uiActions.setPhysicalDraft({ targetId: t }); uiActions.select(t) }}>
              <span className="btn-label">{unitName(state, t)}</span>
            </button>
          ))}
        </div>
      )}
      <ul className="fire-rows">
        {rows.map((r) => (
          <li key={r.id} className={`fire-row${picked === r.id ? ' fire-row-on' : ''}${!r.legal ? ' fire-row-off' : ''}`}>
            <label>
              <input type="radio" name="phys" data-testid={`phys-option-${r.kind === 'punchBoth' ? 'punch-both' : r.id.replace(/-\d+$/, '')}`} checked={picked === r.id} disabled={!r.legal} onChange={() => setPicked(r.id)} />
              <span className="fire-line">{r.line}</span>
            </label>
            {r.why && <span className="fire-why">{r.why}</span>}
            {r.legal && r.risk.length > 0 && <span className="phys-risk hud-dim">{r.risk.join('; ')}</span>}
            {r.breakdown.length > 0 && <details className="fire-why-tn"><summary>why this number</summary><ul>{r.breakdown.map((b, i) => <li key={i}>{b}</li>)}</ul></details>}
          </li>
        ))}
      </ul>
      {row && target && <p className="prompt-title fire-sentence" data-testid="phys-sentence">{physicalSentence(state, row, target, settings.odds)}</p>}
      <div className="pbtns">
        <button type="button" className="hud-btn hud-btn-primary hud-btn-default" data-testid="phys-confirm" disabled={!row} onClick={() => row?.choice && game.physical(row.choice)}>
          <span className="btn-label">Attack</span>
        </button>
        <button type="button" className="hud-btn" data-testid="phys-none" onClick={() => game.physical({ kind: 'none' })}><span className="btn-label">No physical attack</span></button>
      </div>
    </section>
  )
}
