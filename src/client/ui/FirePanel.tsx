import { useEffect, useMemo, useState } from 'react'
import type { ArcsView, FirePlan, FireShot, Twist } from '../../engine/index'
import {
  game, uiActions, useFireDraft, useFirePreview, useLos, usePresentedState, usePresentedUnit, usePrompt, useSettings, useShowRanges, useSheet,
  useWeaponPreviews, unitName, useArcs, queryAttackPreview, queryPhysicalPreview,
} from '../contract'
import './hud.css'
import { useEnterKey } from './useEnter'
import { buildWeaponRows, checkAllLegal, fireSentence, heatLine, losChips, orderShots, setShotTarget, toggleShot, twistOutcomes, type TwistProbe } from './fireView'
import { lifeSupportDamaged } from './format'
import { CHARGE_NOTE, RAPID_NOTE, ammoOptionsOf, capacitorOf, chargeSentence, holdChargeSentence, podOf, podSentence, rapidModesOf, toggleCharge, toggleRapid } from './equipView'

const twistLabel = (t: Twist): string => (t < 0 ? '◀ Twist left' : t > 0 ? 'Twist right ▶' : 'Keep forward')

/** Torso twist step: pick left / forward / right (or flip the arms), the board's arcs follow the draft. */
function TwistStep() {
  const pd = usePrompt()
  const unitId = pd?.unitId ?? null
  const unit = usePresentedUnit(unitId)
  const draft = useFireDraft()
  const options = pd?.context.twistOptions ?? [0]
  const canFlip = pd?.context.canFlip ?? false
  const state = usePresentedState()
  const sheet = useSheet(unitId)
  const arcsLeft = useArcs(unitId, -1), arcsCentre = useArcs(unitId, 0), arcsRight = useArcs(unitId, 1)
  const physical = pd?.context.phase === 'physicalAttack'
  const outcomes = useMemo(() => {
    const by: Record<number, ArcsView | null> = { [-1]: arcsLeft, 0: arcsCentre, 1: arcsRight }
    const probe: TwistProbe | undefined = unitId ? {
      shot: (t, mountId, targetId) => queryAttackPreview({ attackerId: unitId, mountId, targetId, attackerAt: { twist: t } }),
      punch: (t, limb, targetId) => queryPhysicalPreview({ attackerId: unitId, kind: 'punch', limb, targetId, attackerAt: { twist: t } }),
    } : undefined
    return twistOutcomes(state, unitId ?? '', ([-1, 0, 1] as Twist[]).filter((t) => options.includes(t)), (t) => by[t] ?? null, sheet, physical, probe)
  }, [state, unitId, arcsLeft, arcsCentre, arcsRight, sheet, physical, options.join(',')])
  const outcomeOf = (t: Twist) => outcomes.find((o) => o.twist === t)
  const nobody = outcomes.length > 0 && outcomes.every((o) => o.targets.length === 0)
  // no option leaves a legal shot / punch (enemies may stand in arc but be out of sight or range)
  const noneLegal = !nobody && outcomes.length > 0 && outcomes.every((o) => (o.legal ?? 1) === 0)
  const chosen = outcomeOf(draft.flip ? 0 : draft.twist)
  const chosenDead = !nobody && !noneLegal && !!chosen && chosen.legal === 0
  const better = outcomes.filter((o) => (o.legal ?? 0) > 0).map((o) => twistLabel(o.twist).replace(/[◀▶] ?| ?[◀▶]/g, '').toLowerCase())
  useEffect(() => { uiActions.setFireDraft({ twist: 0, flip: false, shots: [] }) }, [pd?.id])
  if (!pd || !unit) return null
  const pick = (t: Twist) => uiActions.setFireDraft({ twist: t, flip: false })
  return (
    <section className="hud-dock hud-card prompt panel panel-twist" data-testid="fire-twist-panel" aria-live="polite">
      <h2 className="prompt-title">{unit.name}: turn the torso?</h2>
      <p className="prompt-line">{physical
        ? 'Twisting turns the torso one hexside, which changes which way your punches can reach. Kicks and pushes use your feet, so they do not care. You may twist once per turn.'
        : 'Twisting moves the firing arcs one hexside; the shaded hexes on the board show what each choice covers. You may do this once per turn.'}</p>
      {nobody && <p className="prompt-line fire-warning" data-testid="twist-none">{physical ? 'No enemy is within reach of your punches whichever way you turn.' : 'No enemy is in any of your firing arcs this turn, so confirming means holding fire.'}</p>}
      {noneLegal && <p className="prompt-line fire-warning" data-testid="twist-nolegal">{physical ? 'No punch is possible whichever way you turn, so confirming means no punches this turn.' : 'No weapon has a legal shot whichever way you turn (line of sight or range), so confirming means holding fire.'}</p>}
      {chosenDead && <p className="prompt-line fire-warning" data-testid="twist-choice-dead">{physical ? 'That choice leaves no punch' : 'That choice leaves no legal shot'}{chosen?.targets.length ? ` (${chosen.targets.map((t) => t.blocker).filter(Boolean).join('; ')})` : ''}. {better.length ? `Better: ${better.join(' or ')}.` : ''}</p>}
      <div className="pbtns">
        {([-1, 0, 1] as Twist[]).map((t) => (
          <button
            key={t} type="button" disabled={!options.includes(t)} data-testid={`fire-twist-${t === -1 ? 'left' : t === 0 ? 'centre' : 'right'}`}
            className={`hud-btn${draft.twist === t && !draft.flip ? ' hud-btn-primary' : ''}`} onClick={() => pick(t)}
          >
            <span className="btn-label">{twistLabel(t)}</span>
            {outcomeOf(t) && <span className="btn-note" data-testid={`fire-twist-note-${t === -1 ? 'left' : t === 0 ? 'centre' : 'right'}`}>{outcomeOf(t)!.text}</span>}
          </button>
        ))}
        {canFlip && (
          <button type="button" data-testid="fire-flip" className={`hud-btn${draft.flip ? ' hud-btn-primary' : ''}`} onClick={() => uiActions.setFireDraft({ twist: 0, flip: !draft.flip })}>
            <span className="btn-label">Flip arms</span><span className="btn-note">arm weapons fire to the rear</span>
          </button>
        )}
      </div>
      <div className="pbtns">
        <button type="button" className="hud-btn hud-btn-primary hud-btn-default" data-testid="fire-twist-confirm" onClick={() => game.twist(draft.flip ? 0 : draft.twist, draft.flip)}>
          <span className="btn-label">Confirm</span>
        </button>
      </div>
    </section>
  )
}

function FireStep() {
  const pd = usePrompt()
  const state = usePresentedState()
  const unitId = pd?.unitId ?? null
  const unit = usePresentedUnit(unitId)
  const sheet = useSheet(unitId)
  const draft = useFireDraft()
  const settings = useSettings()
  const showRanges = useShowRanges()
  const targets = pd?.context.targets ?? []
  const target = draft.targetId && targets.includes(draft.targetId) ? draft.targetId : null
  const twist = unit?.attacks.twist ?? 0
  const flip = unit?.attacks.flipped ?? false

  // keep the board's draft in step with what the engine holds, and always have a target when one exists
  useEffect(() => {
    if (!pd) return
    const patch: Partial<typeof draft> = {}
    if (draft.twist !== twist) patch.twist = twist
    if (draft.flip !== flip) patch.flip = flip
    if (!target && targets.length > 0) patch.targetId = targets[0]!
    const stale = draft.shots.filter((s) => !s.targetId || !targets.includes(s.targetId))
    if (stale.length) patch.shots = draft.shots.filter((s) => s.targetId && targets.includes(s.targetId))
    if (Object.keys(patch).length) uiActions.setFireDraft(patch)
  }, [pd?.id, twist, flip, target, targets.join(','), draft.shots, draft.twist, draft.flip])

  // equipment choices of this declaration (M8): capacitor charges and the coolant pod; Ultra AC double taps live on the shots
  const [charge, setCharge] = useState<string[]>([])
  const [pod, setPod] = useState(false)
  const podEntry = podOf(sheet)
  const podMount = podEntry && podEntry.state === 'ready' ? podEntry.mountId : null
  const base0 = useWeaponPreviews(unitId, target)
  // a weapon that can load more than one kind of ammunition (MML): preview it with the bin that gives the best number, and send that bin
  const ammoOpts = useMemo(() => {
    const m = new Map<string, { opt: ReturnType<typeof ammoOptionsOf>[number]; p: NonNullable<ReturnType<typeof queryAttackPreview>> | null }[]>()
    if (!unitId || !target || !sheet) return m
    for (const w of sheet.weapons) {
      const opts = ammoOptionsOf(state, unitId, w.mountId)
      if (opts.length) m.set(w.mountId, opts.map((opt) => ({ opt, p: queryAttackPreview({ attackerId: unitId, mountId: w.mountId, targetId: target, binId: opt.binId }) })))
    }
    return m
  }, [state, unitId, target, sheet])
  const bestBin = (mountId: string): string | undefined => {
    const l = ammoOpts.get(mountId)
    if (!l) return undefined
    const rank = (x: (typeof l)[number]) => (x.p?.legal ? x.p.expectedDamage : -1)
    return [...l].sort((a, b) => rank(b) - rank(a) || (a.p?.tn ?? 99) - (b.p?.tn ?? 99))[0]!.opt.binId
  }
  const base = useMemo(() => base0.map((p) => { const b = bestBin(p.mountId); return b ? ammoOpts.get(p.mountId)!.find((x) => x.opt.binId === b)?.p ?? p : p }), [base0, ammoOpts])
  // every checked multi-ammo shot carries its bin, so the engine never has to ask (the panel's number is the number rolled)
  useEffect(() => {
    if (!pd || ammoOpts.size === 0) return
    const missing = draft.shots.filter((s) => !s.binId && ammoOpts.has(s.mountId))
    if (missing.length) uiActions.setFireDraft({ shots: draft.shots.map((s) => (!s.binId && ammoOpts.has(s.mountId) ? { ...s, binId: bestBin(s.mountId)! } : s)) })
  }, [pd?.id, draft.shots, ammoOpts])
  const planBase: FirePlan | null = useMemo(() => (unitId ? {
    twist, flip, shots: draft.shots.filter((s): s is FireShot & { targetId: string } => !!s.targetId && targets.includes(s.targetId)).map((s) => ({ mountId: s.mountId, targetId: s.targetId, ...(s.binId ? { binId: s.binId } : {}), ...(s.rapidShots ? { rapidShots: s.rapidShots } : {}) })),
    ...(charge.length ? { charge } : {}),
  } : null), [unitId, twist, flip, draft.shots, targets.join(','), charge.join(',')])
  const planPod: FirePlan | null = useMemo(() => (planBase && podMount ? { ...planBase, coolantPod: podMount } : null), [planBase, podMount])
  const fireNoPod = useFirePreview(unitId, planBase)
  const firePod = useFirePreview(unitId, planPod)
  const fire = pod && firePod ? firePod : fireNoPod
  const los = useLos(unitId, target)
  const rows = useMemo(() => (sheet ? buildWeaponRows({ state, sheet, shots: draft.shots, base, plan: fire?.weapons ?? [], oddsMode: settings.odds, primaryId: target, charging: charge }) : []), [state, sheet, draft.shots, base, fire, settings.odds, target, charge.join(',')])
  const orderedShots = orderShots(draft.shots.filter((s) => !!s.targetId && targets.includes(s.targetId)), target)
  const dangerHeat = !!fire && heatLine(fire).risk === 'danger'
  // a plan that reaches shutdown or ammo-explosion range is never fired by a stray Enter: Hold fire is the default then
  const hasEquip = charge.length > 0 || (pod && !!podMount)
  const declare = (shots: FireShot[]) => (pd && pd.unitId ? game.dispatch({
    type: 'declareFire', decisionId: pd.id, player: pd.player, unitId: pd.unitId, shots,
    ...(charge.length ? { charge } : {}), ...(pod && podMount ? { coolantPod: podMount } : {}),
  }) : null)
  useEnterKey(pd && (orderedShots.length > 0 || hasEquip) && !dangerHeat ? () => { declare(orderedShots) } : null)
  if (!pd || !unit || !sheet) return null
  const heat = fire ? heatLine(fire, lifeSupportDamaged(unit)) : null
  const nameOf = (mountId: string): string => sheet.weapons.find((w) => w.mountId === mountId)?.name ?? mountId
  const sentence = fire ? fireSentence(state, unit.id, fire, nameOf, settings.odds, lifeSupportDamaged(unit)) : null
  const ordered = orderedShots
  const setShots = (shots: FireShot[]) => uiActions.setFireDraft({ shots })
  const losLine = losChips(los)
  const nameWithLoc = (mountId: string): string => { const w = sheet.weapons.find((x) => x.mountId === mountId); return w ? `${w.name} (${w.location})` : mountId }
  const w0 = nameWithLoc
  const podBefore = fireNoPod?.heat.end, podAfter = firePod?.heat.end
  return (
    <section className="hud-dock hud-card prompt panel panel-fire" data-testid="fire-panel" aria-live="polite">
      <h2 className="prompt-title">{unit.name}: ranged attack</h2>
      {targets.length === 0 ? <p className="prompt-line">Nothing is in reach. You can only hold fire.</p> : (
        <div className="fire-targets" role="group" aria-label="Target">
          <span className="hud-dim">Target</span>
          {targets.map((t) => (
            <button key={t} type="button" data-testid={`fire-target-${t}`} className={`hud-btn hud-btn-sm${t === target ? ' hud-btn-primary' : ''}`} onClick={() => { uiActions.setFireDraft({ targetId: t, shots: orderShots(draft.shots, t) }); uiActions.select(t) }}>
              <span className="btn-label">{unitName(state, t)}</span>
            </button>
          ))}
          {losLine.length > 0 && <span className="los-chips">{losLine.map((c) => <span key={c} className="chip">{c}</span>)}</span>}
        </div>
      )}
      {heat && fire && (
        <div className={`fire-heat heat-risk-${heat.risk}`} data-testid="fire-heat-total" data-end={fire.heat.end}>
          <b>{heat.text}</b>
          {heat.effects.length > 0 && <span className="fire-heat-effects">{heat.effects.map((e) => <span key={e} className={`chip${heat.risk === 'danger' ? ' chip-bad' : ''}`}>{e}</span>)}</span>}
        </div>
      )}
      <ul className="fire-rows">
        {rows.map((r) => (
          <li key={r.mountId} className={`fire-row${r.checked ? ' fire-row-on' : ''}${r.disabledWhy ? ' fire-row-off' : ''}`}>
            <label>
              <input
                type="checkbox" data-testid={`fire-weapon-${r.mountId}`} checked={r.checked} disabled={!!r.disabledWhy && !r.checked}
                onChange={() => target && setShots(toggleShot(draft.shots, r.mountId, target, target))}
              />
              <span className="fire-line" data-testid={`fire-line-${r.mountId}`}>{r.line}</span>
            </label>
            {r.disabledWhy && <span className="fire-why" data-testid={`fire-why-${r.mountId}`}>{r.disabledWhy}</span>}
            {r.checked && (ammoOpts.get(r.mountId)?.length ?? 0) > 1 && (
              <select
                className="fire-pick" data-testid={`fire-ammo-${r.mountId}`} aria-label={`Ammunition for ${r.name}`}
                value={draft.shots.find((s) => s.mountId === r.mountId)?.binId ?? bestBin(r.mountId) ?? ''}
                onChange={(e) => setShots(draft.shots.map((s) => (s.mountId === r.mountId ? { ...s, binId: e.target.value } : s)))}
              >
                {ammoOpts.get(r.mountId)!.map(({ opt, p }) => (
                  <option key={opt.binId} value={opt.binId}>
                    {sheet.ammo.find((b) => b.binId === opt.binId)?.name ?? opt.ammoId}{p ? (p.legal ? ` · TN ${p.tn} · ${Math.round(p.pHit * 100)}%` : ` · ${p.why ?? 'cannot fire'}`) : ''}
                  </option>
                ))}
              </select>
            )}
            {rapidModesOf(state, unit.id, r.mountId).includes(2) && (
              <button
                type="button" className={`hud-btn hud-btn-sm hud-btn-toggle${draft.shots.find((s) => s.mountId === r.mountId)?.rapidShots === 2 ? ' hud-btn-primary' : ''}`}
                data-testid={`fire-rapid-${r.mountId}`} aria-pressed={draft.shots.find((s) => s.mountId === r.mountId)?.rapidShots === 2} title={RAPID_NOTE}
                disabled={!target || (!!r.disabledWhy && !r.checked)} onClick={() => target && setShots(orderShots(toggleRapid(draft.shots, r.mountId, target), target))}
              >2 shots</button>
            )}
            {(() => {
              const cap = capacitorOf(state, sheet, unit.id, r.mountId)
              if (!cap || cap.state === 'destroyed') return null
              const on = charge.includes(r.mountId)
              return (
                <>
                  {cap.state === 'charged' && <span className="chip chip-ok" data-testid={`fire-charged-${r.mountId}`} title="Charged last turn: this PPC shot deals +5 damage. The charge is lost if it does not fire this turn.">capacitor charged: +5 damage</span>}
                  {(cap.state === 'ready' || cap.state === 'charged') && (
                    <button
                      type="button" className={`hud-btn hud-btn-sm hud-btn-toggle${on ? ' hud-btn-primary' : ''}`} data-testid={`fire-charge-${r.mountId}`} aria-pressed={on} title={cap.state === 'charged' ? holdChargeSentence([w0(r.mountId)]) : CHARGE_NOTE}
                      onClick={() => { const next = toggleCharge(charge, draft.shots, r.mountId); setCharge(next.charge); setShots(next.shots) }}
                    >{cap.state === 'charged' ? 'Hold charge' : 'Charge'}</button>
                  )}
                </>
              )
            })()}
            {r.checked && targets.length > 1 && (
              <select
                className="fire-pick" data-testid={`fire-shot-target-${r.mountId}`} value={r.targetId ?? ''} aria-label={`Target for ${r.name}`}
                onChange={(e) => setShots(setShotTarget(draft.shots, r.mountId, e.target.value, target))}
              >
                {targets.map((t) => <option key={t} value={t}>{unitName(state, t)}</option>)}
              </select>
            )}
            {r.breakdown.length > 0 && (
              <details className="fire-why-tn"><summary>why this number</summary><ul>{r.breakdown.map((b, i) => <li key={i}>{b}</li>)}</ul></details>
            )}
          </li>
        ))}
      </ul>
      {(podEntry || charge.length > 0) && (
        <div className="fire-equip" data-testid="fire-equipment">
          {podEntry && (
            <div className="fire-equip-row">
              <button
                type="button" className={`hud-btn hud-btn-sm hud-btn-toggle${pod ? ' hud-btn-primary' : ''}`} data-testid="fire-pod" aria-pressed={pod}
                disabled={!podMount} onClick={() => setPod(!pod)}
              >Vent coolant pod</button>
              <span className="fire-equip-note" data-testid="fire-pod-note">
                {podEntry.state === 'used' ? 'The coolant pod is spent: it works once per game.'
                  : podEntry.state === 'destroyed' ? 'The coolant pod is destroyed.'
                  : podBefore !== undefined && podAfter !== undefined ? podSentence(podBefore, podAfter, pod) : ''}
              </span>
            </div>
          )}
          {charge.length > 0 && <p className="fire-equip-note" data-testid="fire-charge-note">{(() => { const held = charge.filter((m) => capacitorOf(state, sheet, unit.id, m)?.state === 'charged'), fresh = charge.filter((m) => !held.includes(m)); return [fresh.length ? chargeSentence(fresh.map(nameWithLoc)) : '', held.length ? holdChargeSentence(held.map(nameWithLoc)) : ''].filter(Boolean).join(' ') })()}</p>}
        </div>
      )}
      {sentence && <p className="prompt-title fire-sentence" data-testid="fire-sentence">{sentence.text}</p>}
      {heat?.warning && <p className={`fire-warning heat-risk-${heat.risk}`} data-testid="fire-warning" role="alert">{heat.warning}</p>}
      <div className="pbtns">
        <button
          type="button" className={dangerHeat ? 'hud-btn' : 'hud-btn hud-btn-primary hud-btn-default'} data-testid="fire-confirm" disabled={ordered.length === 0 && !hasEquip}
          onClick={() => declare(ordered)}
        >
          <span className="btn-label">{ordered.length === 0 ? 'Confirm' : dangerHeat ? 'Fire anyway' : 'Fire'}</span>
        </button>
        <button type="button" className={dangerHeat ? 'hud-btn hud-btn-primary hud-btn-default' : 'hud-btn'} data-testid="fire-hold" onClick={() => game.holdFire()}><span className="btn-label">Hold fire</span></button>
        <button type="button" className="hud-btn hud-btn-quiet hud-btn-sm" data-testid="fire-all" disabled={!target} onClick={() => target && setShots(orderShots(checkAllLegal(rows, target), target))}>Select all legal</button>
        <button type="button" className="hud-btn hud-btn-quiet hud-btn-sm" data-testid="fire-clear" disabled={draft.shots.length === 0} onClick={() => setShots([])}>Clear</button>
        <button type="button" className={`hud-btn hud-btn-quiet hud-btn-sm${showRanges ? ' hud-btn-primary' : ''}`} data-testid="fire-ranges" onClick={() => uiActions.toggleRanges()} title="Show the range bands of the checked weapons (R)">Range rings</button>
      </div>
    </section>
  )
}

/** Bottom-centre panel for the torso twist and ranged declaration decisions. */
export function FirePanel() {
  const pd = usePrompt()
  if (!pd) return null
  if (pd.kind === 'torsoTwist') return <TwistStep key={pd.id} />
  if (pd.kind === 'declareFire') return <FireStep key={pd.id} />
  return null
}
