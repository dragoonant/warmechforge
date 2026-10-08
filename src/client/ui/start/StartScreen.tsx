// Start screen (50 §15): mission, your force vs the enemy force, opponent, seed, speed, Continue, Start, How to Play.
// Fits one screen on desktop; below ~640px wide it stacks and scrolls. All copy is ours; names, tonnage and BV are data.
import { useMemo, useState } from 'react'
import { FAN_NOTICE, game, settings, useSettings, type NewGameOptions } from '../../contract'
import { openHelp } from '../help/HelpGuide'
import {
  OPPONENTS, SPEED_CHOICES, buildStartOptions, catalogue, defaultForm, evenBv, evenSide, fixedForce, forceHeading, forceView, formatBv, isSkirmish,
  mapChoices, mapLabel, mechTitle, sideOrder, swapSides, withControl, withForce, withMission, continueSummary, type Side, type StartForm,
} from './startOptions'
import { SkirmishPicker } from './SkirmishPicker'
import './start.css'

export interface StartScreenProps {
  /** Called with the built options; returns a rejection text when the game could not start, else null. */
  onStart(opts: NewGameOptions): string | null
  /** Resume the game in memory or the autosave; returns a rejection text or null. */
  onContinue?(): string | null
  /** Label for Continue (e.g. "Continue game"), or null/undefined to hide it. */
  continueLabel?: string | null
}

const shortId = (id: string): string => id.replace(/^(mission|force|map)\./, '')

export function StartScreen({ onStart, onContinue, continueLabel }: StartScreenProps) {
  const cat = useMemo(catalogue, [])
  const [form, setForm] = useState<StartForm>(() => defaultForm(cat))
  const [error, setError] = useState<string | null>(null)
  const { speed } = useSettings()
  const mission = cat.missions.find((m) => m.id === form.mission)
  const maps = mapChoices(mission, cat.maps)
  const slot = continueLabel && onContinue ? game.readAutosave() : null
  const patch = (f: StartForm) => { setForm(f); setError(null) }

  const skirmish = isSkirmish(mission)
  const start = () => setError(onStart(buildStartOptions(form, cat)))
  const resume = () => setError(onContinue ? onContinue() : null)

  const forceCard = (side: Side) => {
    const i = side === 'A' ? 0 : 1
    const info = cat.forces.find((f) => f.id === form.forces[i])
    const view = info ? forceView(info) : null
    const fixed = !!fixedForce(mission, i as 0 | 1)
    const heading = forceHeading(form, side)
    if (skirmish) {
      return (
        <section className="start-card start-force start-force-pick" key={side} data-testid={`start-force-${side}`}>
          <header className="start-force-head">
            <h2>{heading}</h2>
            <div className="start-seg" role="group" aria-label={`${heading} controlled by`}>
              {(['human', 'bot'] as const).map((c) => (
                <button key={c} type="button" className={form.controllers[side] === c ? 'on' : ''} aria-pressed={form.controllers[side] === c}
                  data-testid={`start-control-${side}-${c}`} onClick={() => patch(withControl(form, side, c))}>
                  {c === 'human' ? 'Human' : 'Bot'}
                </button>
              ))}
            </div>
          </header>
          <SkirmishPicker side={side} form={form} cat={cat} onChange={patch} />
        </section>
      )
    }
    return (
      <section className="start-card start-force" key={side} data-testid={`start-force-${side}`} style={view?.color ? { borderTopColor: view.color } : undefined}>
        <header className="start-force-head">
          <h2>{heading}</h2>
          <div className="start-seg" role="group" aria-label={`${heading} controlled by`}>
            {(['human', 'bot'] as const).map((c) => (
              <button key={c} type="button" className={form.controllers[side] === c ? 'on' : ''} aria-pressed={form.controllers[side] === c}
                data-testid={`start-control-${form.forces[i]}-${c}`} onClick={() => patch(withControl(form, side, c))}>
                {c === 'human' ? 'Human' : 'Bot'}
              </button>
            ))}
          </div>
        </header>
        {fixed || cat.forces.length < 2 ? (
          <p className="start-force-name" data-testid={`start-force-name-${side}`}>{view?.name ?? form.forces[i]}</p>
        ) : (
          <select aria-label={`${heading} force`} data-testid={`start-force-select-${side}`} value={form.forces[i]}
            onChange={(e) => patch(withForce(form, cat, side, e.target.value))}>
            {cat.forces.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        )}
        {view && (
          <>
            <ul className="start-roster" data-testid={`start-roster-${side}`}>
              {view.rows.map((r, n) => (
                <li key={`${r.mechId}-${n}`}>
                  <strong>{mechTitle(r)}</strong>
                  <span>{r.tonnage} t · BV {formatBv(r.bv)}{r.pilot ? ` · ${r.pilot}` : ''}</span>
                </li>
              ))}
            </ul>
            <p className="start-total">{view.rows.length} 'Mechs · {view.tonnage} t · BV {formatBv(view.bv)}</p>
          </>
        )}
      </section>
    )
  }

  return (
    <main className="start" data-testid="start-screen">
      <header className="start-title">
        <h1 data-testid="title">WarMechForge</h1>
        <p>Turn-based hex battles between giant walking war machines. Free, in your browser.</p>
        <p className="start-fan" data-testid="fan-notice">{FAN_NOTICE}</p>
      </header>

      <div className="start-main">
        <div className="start-col">
          <section className="start-card" data-testid="start-mission-card">
            <h2>Mission</h2>
            <div className="start-missions" role="radiogroup" aria-label="Mission">
              {cat.missions.map((m) => (
                <button key={m.id} type="button" role="radio" aria-checked={m.id === form.mission} disabled={!m.ready}
                  className={m.id === form.mission ? 'on' : ''} data-testid={`start-mission-${shortId(m.id)}`}
                  onClick={() => patch(withMission(form, cat, m.id))}>
                  {m.name}{m.ready ? '' : ' (soon)'}
                </button>
              ))}
            </div>
            {mission && <p className="start-brief" data-testid="start-briefing">{mission.kind === 'skirmish' ? "Pick any 'Mechs for each side, then fight a single battle on any ready map. The BV totals and Even BV help you balance the two sides. The last side with a fighting force wins." : mission.briefing}</p>}
            {maps.length > 0 && (
              <label>Map
                <select data-testid="start-map" value={form.map ?? maps[0]!.id} onChange={(e) => patch({ ...form, map: e.target.value })}>
                  {maps.map((m) => <option key={m.id} value={m.id}>{mapLabel(m)}</option>)}
                </select>
              </label>
            )}
          </section>

          <section className="start-card" data-testid="start-options-card">
            <h2>Match</h2>
            <div className="start-fields">
              <label>Opponent
                <select data-testid="start-opponent" value={form.opponent} onChange={(e) => patch({ ...form, opponent: e.target.value as StartForm['opponent'] })}>
                  {OPPONENTS.map((o) => <option key={o.id} value={o.id} disabled={!o.ready}>{o.label}</option>)}
                </select>
              </label>
              <label>Seed (optional)
                <input type="text" data-testid="start-seed" placeholder="random" maxLength={40} value={form.seed} spellCheck={false}
                  onChange={(e) => patch({ ...form, seed: e.target.value })} />
              </label>
              <label>Animation speed
                <select data-testid="start-speed" value={speed} onChange={(e) => settings.set({ speed: Number(e.target.value) })}>
                  {SPEED_CHOICES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </label>
              <button type="button" className="start-swap" data-testid="start-swap" onClick={() => patch(swapSides(form))}>Swap sides</button>
              {skirmish && (
                <button type="button" className="start-swap" data-testid="pick-even-bv" title={`Changes the pilot skills of ${forceHeading(form, evenSide(form)).toLowerCase()} to bring its BV close to the other side`}
                  onClick={() => patch(evenBv(form, cat))}>Even BV</button>
              )}
            </div>
          </section>
        </div>

        <div className="start-col start-forces">
          {sideOrder(form).map(forceCard)}
        </div>
      </div>

      {error && <p className="start-error" role="alert" data-testid="start-error">{error}</p>}

      <div className="start-actions">
        {continueLabel && onContinue && (
          <button type="button" className="start-continue" data-testid="start-continue" onClick={resume}>
            {continueLabel}
            {slot && <small>{continueSummary(slot.summary)}</small>}
          </button>
        )}
        <button type="button" className="start-go" data-testid="start-go" disabled={!mission?.ready || !form.forces[0] || !form.forces[1]} onClick={start}>Start battle</button>
        <button type="button" className="start-help" data-testid="start-help" onClick={() => openHelp()}>How to Play</button>
      </div>

      <footer className="start-foot">BattleTech and 'Mech names belong to their respective owners. Free and non-commercial.</footer>
    </main>
  )
}
