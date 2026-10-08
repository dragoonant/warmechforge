import { useEffect, useMemo } from 'react'
import type { MoveMode } from '../../engine/index'
import {
  FACING_LABELS, game, groupReach, hexKey, uiActions, useMoveDraft, useMoveDraftEntry, useMoveModes, usePhysicalPreview, usePresentedState,
  usePresentedUnit, usePrompt, usePromptLegal, useReach, useSheet, hexName, unitName,
} from '../contract'
import './hud.css'
import { attackStrip, facingChoices, modeButtons, psrFlags, resultStrip, standChoices, standSentence } from './moveView'

const MODE_ID: Record<MoveMode, string> = { standStill: 'stand', walk: 'walk', run: 'run', jump: 'jump' }

function MovementStep() {
  const pd = usePrompt()
  const state = usePresentedState()
  const unitId = pd?.unitId ?? null
  const unit = usePresentedUnit(unitId)
  const sheet = useSheet(unitId)
  const draft = useMoveDraft()
  const modes = useMoveModes(unitId)
  const reach = useReach(unitId)
  const entry = useMoveDraftEntry(unitId)
  const locked = pd?.context.lockedMode
  const shown = useMemo(() => (locked ? modes.filter((m) => m === locked) : modes), [modes, locked])
  const buttons = modeButtons(shown.includes('standStill') ? shown : ['standStill', ...shown], sheet)
  const group = useMemo(() => (draft.hex ? groupReach(reach.filter((e) => e.mode === draft.mode)).get(hexKey(draft.hex)) : undefined), [reach, draft.mode, draft.hex])
  const attackEntry = group?.attacks.find((e) => e.physical && (draft.facing === null || e.facing === draft.facing)) ?? group?.attacks[0] ?? null
  const physical = attackEntry?.physical ?? null
  // preview the attack as it will be after this move: from the entry's end hex, facing, mode and hexes moved (engine-provided)
  const physReq = useMemo(() => (physical && attackEntry && unitId && draft.attack ? {
    attackerId: unitId, kind: physical.kind, targetId: physical.targetId,
    attackerAt: { hex: physical.fromHex ?? attackEntry.hex, facing: attackEntry.facing, mode: attackEntry.mode, hexesMoved: attackEntry.hexesMoved, jumped: attackEntry.mode === 'jump' },
  } : null), [physical, attackEntry, unitId, draft.attack])
  const physPreview = usePhysicalPreview(physReq)

  // a mode that is not offered (e.g. a unit that cannot jump) falls back to the first one that is
  useEffect(() => {
    if (!pd || shown.length === 0) return
    if (draft.mode !== 'standStill' && !shown.includes(draft.mode)) uiActions.setMoveDraft({ mode: shown.includes('walk') ? 'walk' : shown.find((m) => m !== 'standStill') ?? 'standStill', hex: null, facing: null, attack: false })
  }, [pd?.id, shown.join(','), draft.mode])

  if (!pd || !unit) return null
  const standEntry = reach.filter((e) => e.mode === 'standStill' && !e.physical).sort((a, b) => a.mpUsed - b.mpUsed)[0]
  const pickMode = (m: MoveMode) => {
    if (m === 'standStill') { if (standEntry) game.commitMove(standEntry); return }
    uiActions.setMoveDraft({ mode: m, hex: null, facing: null, attack: false })
  }
  const facings = facingChoices(group)
  const strip = entry ? (draft.attack && physical ? attackStrip(state, physical.kind, physical.targetId, physPreview) : resultStrip(state, entry, sheet)) : null
  const flags = entry && !draft.attack ? psrFlags(entry) : []
  return (
    <section className="hud-dock hud-card prompt panel panel-move" data-testid="move-panel" aria-live="polite">
      <h2 className="prompt-title">{unit.name}: move{pd.context.entry ? ` (enter from the ${pd.context.entry.edge} edge)` : ''}</h2>
      <div className="pbtns" role="group" aria-label="Movement mode">
        {buttons.map((b) => (
          <button
            key={b.mode} type="button" data-testid={`move-mode-${MODE_ID[b.mode]}`} disabled={b.mode === 'standStill' && !standEntry}
            className={`hud-btn${draft.mode === b.mode && b.mode !== 'standStill' ? ' hud-btn-primary' : ''}`} onClick={() => pickMode(b.mode)}
          >
            <span className="btn-label">{b.text}</span>
            {b.mode !== 'standStill' && <span className="btn-note">MP</span>}
          </button>
        ))}
      </div>
      {!draft.hex && <p className="prompt-line">Click a highlighted hex on the board: green is walking range, amber needs a run, blue is a jump. Stand still keeps this position.</p>}
      {draft.hex && (
        <>
          <p className="prompt-line" data-testid="move-hex">To {hexName(state, draft.hex)}. Pick the way it ends up facing{group && group.facings.length === 1 ? ' (only one is possible)' : ''}.</p>
          {group && group.attacks.length > 0 && physical && (
            <div className="pbtns" role="group" aria-label="Plain move or attack">
              <button type="button" data-testid="move-plain" className={`hud-btn hud-btn-sm${!draft.attack ? ' hud-btn-primary' : ''}`} onClick={() => uiActions.setMoveDraft({ attack: false, facing: null })}>Move here</button>
              <button type="button" data-testid="move-attack" className={`hud-btn hud-btn-sm${draft.attack ? ' hud-btn-primary' : ''}`} onClick={() => uiActions.setMoveDraft({ attack: true, facing: null })}>
                {physical.kind === 'charge' ? 'Charge' : 'DFA'} {unitName(state, physical.targetId)}
              </button>
            </div>
          )}
          <div className="pbtns" role="group" aria-label="Facing">
            {facings.map((f) => (
              <button
                key={f.facing} type="button" disabled={!f.enabled} data-testid={`move-facing-${f.facing}`} title={`Face ${f.word}${f.mp !== null ? `, ${f.mp} MP` : ''}`}
                className={`hud-btn hud-btn-sm${draft.facing === f.facing ? ' hud-btn-primary' : ''}`} onClick={() => uiActions.setMoveDraft({ facing: f.facing })}
              >
                <span className="btn-label">{FACING_LABELS[f.facing]}</span>{f.mp !== null && <span className="btn-note">{f.mp} MP</span>}
              </button>
            ))}
          </div>
        </>
      )}
      {strip && <p className="move-strip" data-testid="move-strip">{strip}</p>}
      {flags.length > 0 && <ul className="move-flags" data-testid="move-flags">{flags.map((f) => <li key={f} className="chip chip-bad">⚠ {f}</li>)}</ul>}
      <div className="pbtns">
        <button type="button" className="hud-btn hud-btn-primary hud-btn-default" data-testid="move-confirm" disabled={!entry} onClick={() => game.commitMoveDraft()}><span className="btn-label">Confirm move</span></button>
        <button type="button" className="hud-btn" data-testid="move-reset" disabled={!draft.hex} onClick={() => uiActions.resetMoveDraft()}><span className="btn-label">Reset</span></button>
      </div>
    </section>
  )
}

function StandStep() {
  const pd = usePrompt()
  const legal = usePromptLegal()
  const state = usePresentedState()
  const unitId = pd?.unitId ?? null
  const unit = usePresentedUnit(unitId)
  const draft = useMoveDraft()
  if (!pd || !unit) return null
  const choices = standChoices(legal)
  return (
    <section className="hud-dock hud-card prompt panel panel-stand" data-testid="stand-panel" aria-live="polite">
      <h2 className="prompt-title" data-testid="stand-sentence">{standSentence(state, unit.id, pd.context.psr)}</h2>
      <div className="pbtns" role="group" aria-label="Facing after standing">
        <span className="hud-dim">Face</span>
        {([0, 1, 2, 3, 4, 5] as const).map((f) => (
          <button key={f} type="button" data-testid={`stand-facing-${f}`} className={`hud-btn hud-btn-sm${draft.facing === f ? ' hud-btn-primary' : ''}`} onClick={() => uiActions.setMoveDraft({ facing: draft.facing === f ? null : f })}>{FACING_LABELS[f]}</button>
        ))}
      </div>
      <div className="pbtns">
        {choices.map((c) => (
          <button
            key={c.key} type="button" data-testid={`stand-${c.key}`} className={`hud-btn${c.attempt ? ' hud-btn-primary' : ''}`}
            onClick={() => game.standUp(c.attempt, c.mode, c.attempt && draft.facing !== null ? draft.facing : undefined)}
          >
            <span className="btn-label">{c.label}</span>
          </button>
        ))}
      </div>
    </section>
  )
}

function DeployStep() {
  const pd = usePrompt()
  const state = usePresentedState()
  const draft = useMoveDraft()
  const legal = usePromptLegal()
  const unitId = pd?.unitId ?? null
  const eligible = pd?.context.eligible ?? []
  const pick = unitId && eligible.includes(unitId) ? unitId : eligible[0] ?? null
  if (!pd) return null
  const facing = draft.facing ?? 0
  const action = draft.hex && pick ? legal.find((a) => a.type === 'deploy' && a.unitId === pick && a.hex.q === draft.hex!.q && a.hex.r === draft.hex!.r && a.facing === facing) : undefined
  return (
    <section className="hud-dock hud-card prompt panel panel-deploy" data-testid="deploy-panel" aria-live="polite">
      <h2 className="prompt-title">Place your 'Mechs</h2>
      <div className="pbtns" role="group" aria-label="Unit to place">
        {eligible.map((id) => (
          <button key={id} type="button" data-testid={`deploy-unit-${id}`} className={`hud-btn hud-btn-sm${id === pick ? ' hud-btn-primary' : ''}`} onClick={() => uiActions.select(id)}>{unitName(state, id)}</button>
        ))}
      </div>
      <p className="prompt-line">{draft.hex ? `Place at ${hexName(state, draft.hex)}, facing ${FACING_LABELS[facing]}.` : 'Click a hex in your deployment zone on the board.'}</p>
      <div className="pbtns" role="group" aria-label="Facing">
        {([0, 1, 2, 3, 4, 5] as const).map((f) => (
          <button key={f} type="button" data-testid={`deploy-facing-${f}`} className={`hud-btn hud-btn-sm${facing === f ? ' hud-btn-primary' : ''}`} onClick={() => uiActions.setMoveDraft({ facing: f })}>{FACING_LABELS[f]}</button>
        ))}
      </div>
      <div className="pbtns">
        <button type="button" className="hud-btn hud-btn-primary hud-btn-default" data-testid="deploy-confirm" disabled={!action} onClick={() => action && game.dispatch(action)}><span className="btn-label">Place here</span></button>
      </div>
    </section>
  )
}

/** Bottom-centre panel for the movement, stand-up and deployment decisions. */
export function MovePanel() {
  const pd = usePrompt()
  if (!pd) return null
  if (pd.kind === 'move') return <MovementStep key={pd.id} />
  if (pd.kind === 'standUp') return <StandStep key={pd.id} />
  if (pd.kind === 'deploy') return <DeployStep key={pd.id} />
  return null
}
