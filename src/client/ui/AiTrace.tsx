// AI trace panel: a small collapsible card with the bot's best three scored options for its last decision, as the utility AI
// saw them (40-ai §14 trace). Labels are the engine's own action text (describe.action); scores are the AI's value in damage
// points. Read-only: nothing here feeds back into play. Mounted by GameScreen through optionalOverlays (AiTraceLayer).
import { useState, type ReactElement } from 'react'
import { useControllers, usePresentedState, unitName } from '../contract'
import { useLastTrace, type AiTraceEntry } from '../bot/traceStore'

const KIND_WORDS: Record<string, string> = {
  move: 'Movement', declareFire: 'Ranged fire', torsoTwist: 'Torso twist', declarePhysical: 'Physical attack', selectUnit: 'Which unit acts',
  deploy: 'Deployment', standUp: 'Stand up', chooseAmmo: 'Ammo', powerChoice: 'Power', initiativeAck: 'Initiative', choice: 'Choice',
}
const PART_WORDS: Record<string, string> = {
  dealt: 'deal', taken: 'take', heat: 'heat', psr: 'fall risk', approach: 'range', physical: 'melee', position: 'position',
  damage: 'damage', heatEnd: 'end heat', pKill: 'kill chance', dv: 'damage', pStand: 'stand chance', value: 'value',
}

const fmt = (k: string, v: number): string => (k === 'pKill' || k === 'pStand' ? `${Math.round(v * 100)}%` : k === 'heatEnd' ? String(Math.round(v)) : (v > 0 ? `+${v}` : String(v)))

function partsLine(parts: Record<string, number> | undefined): string {
  if (!parts) return ''
  return Object.entries(parts).filter(([, v]) => Math.abs(v) >= 0.05).map(([k, v]) => `${PART_WORDS[k] ?? k} ${fmt(k, v)}`).join(' · ')
}

const card: React.CSSProperties = {
  // bottom right, under the right rail (which stops 56px above the bottom); grows upward over the rail when opened
  position: 'absolute', right: 150, bottom: 12, zIndex: 14, width: 'min(340px, calc(100vw - 24px))', pointerEvents: 'auto', fontSize: 12, padding: '4px 8px',
}

/** The trace card body for one entry (exported for tests). */
export function AiTraceBody({ entry, who }: { entry: AiTraceEntry; who: string }): ReactElement {
  const t = entry.trace
  const opts = t.options ?? []
  return (
    <div data-testid="ai-trace-body">
      <div className="hud-dim" style={{ marginBottom: 4 }}>
        Turn {entry.turn} · {KIND_WORDS[t.kind] ?? t.kind}{who ? ` · ${who}` : ''} · {t.ms} ms
      </div>
      {opts.length === 0 && <div className="hud-dim">No scored options for this decision.</div>}
      <ol style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 4 }}>
        {opts.map((o, i) => (
          <li key={i} data-testid="ai-trace-option" data-chosen={o.chosen} style={{ color: o.chosen ? 'var(--accent)' : undefined }}>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between' }}>
              <span>{o.label}{o.chosen ? ' (chosen)' : ''}</span>
              <span style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{o.score.toFixed(1)}</span>
            </div>
            {o.parts && <div className="hud-dim" style={{ fontSize: 11 }}>{partsLine(o.parts)}</div>}
          </li>
        ))}
      </ol>
    </div>
  )
}

/** Collapsible AI trace card; shown once a utility-AI bot (easy / normal) has decided something in this game. */
export function AiTrace(): ReactElement | null {
  const [open, setOpen] = useState(false)
  const state = usePresentedState()
  const entry = useLastTrace(state?.seed)
  const controllers = useControllers()
  const hasBot = controllers.A === 'bot' || controllers.B === 'bot'
  // only the utility AI (easy / normal) publishes traces; the random bot never shows the card
  if (!hasBot || !entry) return null
  const who = entry?.trace.unitId ? unitName(state, entry.trace.unitId) : ''
  return (
    <div className="hud-card" style={card} data-testid="ai-trace">
      <button
        type="button" className="hud-btn hud-btn-sm hud-btn-quiet" aria-expanded={open} data-testid="ai-trace-toggle"
        title="The bot's top three options for its last decision, with the scores it gave them" onClick={() => setOpen((v) => !v)}
        style={{ width: '100%', justifyContent: 'space-between' }}
      >
        <span className="hud-h" style={{ margin: 0 }}>AI trace</span>
        <span>{open ? 'Hide' : 'Show'}</span>
      </button>
      {open && <AiTraceBody entry={entry} who={who} />}
    </div>
  )
}

export default AiTrace
