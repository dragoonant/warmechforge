import { useMemo } from 'react'
import {
  useFireDraftPreview, useHeatProjection, useHeatScale, useMoveDraft, useMoveDraftEntry, usePrompt, usePresentedUnit, useSelectedId,
} from '../contract'
import { heatTotalText, heatParts, heatEffectChips, heatRisk } from './format'
import { buildSegments, buildThresholds } from './heatView'

/**
 * Vertical thermometer with the engine's threshold rows. Solid marker = heat now; ghost marker = projected end-of-turn heat while
 * a move or fire plan is open (the sum is printed under it).
 */
export function HeatScale() {
  const prompt = usePrompt()
  const selected = useSelectedId()
  const unitId = prompt?.unitId ?? selected
  const unit = usePresentedUnit(unitId)
  const scale = useHeatScale()
  const kind = prompt?.kind
  const moving = kind === 'move' || kind === 'standUp'
  const firing = kind === 'declareFire' || kind === 'torsoTwist'
  const fire = useFireDraftPreview(firing ? unitId : null)
  const draft = useMoveDraft()
  const entry = useMoveDraftEntry(moving ? unitId : null)
  const moveHeat = useHeatProjection(moving ? unitId : null, moving && draft.hex ? { mode: draft.mode, ...(draft.mode === 'jump' ? { hexesJumped: entry?.hexesMoved ?? 0 } : {}) } : null)
  const proj = firing ? fire?.heat ?? null : moving ? moveHeat : null
  const now = unit?.heat ?? 0
  const projected = proj ? proj.end : null
  const maxLevel = scale.length ? scale[scale.length - 1]!.level : 30
  const segs = useMemo(() => buildSegments(maxLevel, now, projected), [maxLevel, now, projected])
  const thr = useMemo(() => buildThresholds(scale, now, projected), [scale, now, projected])
  if (!unit) return null
  const parts = proj ? heatParts(proj) : null
  const risk = proj ? heatRisk(proj.effects) : 'none'
  return (
    <section className={`hud-card heat heat-risk-${risk}`} data-testid="heat-panel" aria-label="Heat scale">
      <h3 className="hud-h">Heat <span className="heat-who hud-dim">{unit.name}</span></h3>
      <div className="heat-body">
        <ol className="heat-bar" aria-hidden="true">
          {[...segs].reverse().map((s) => (
            <li key={s.level} className={`seg seg-${s.tone}${s.filled ? ' seg-on' : ''}${s.marker ? ` seg-${s.marker}` : ''}`} />
          ))}
        </ol>
        <div className="heat-side">
          <div className="heat-now" data-testid="heat-level" data-level={now} data-projected={projected ?? ''}>
            <b className="heat-num">{now}</b>
            {projected !== null && <span className="heat-proj" title="Heat at the end of this turn if you do this">→ {projected}</span>}
          </div>
          {parts && <div className="heat-sum hud-dim" data-testid="heat-sum">{heatTotalText(parts)}</div>}
          {proj && heatEffectChips(proj.effects).length > 0 && (
            <div className="chips" data-testid="heat-projected-effects">{heatEffectChips(proj.effects).map((c) => <span key={c} className={`chip${risk === 'danger' ? ' chip-bad' : ''}`}>{c}</span>)}</div>
          )}
          <ul className="heat-thr">
            {thr.map((t) => (
              <li key={t.level} className={`${t.active ? 'thr-active' : ''}${t.projected ? ' thr-projected' : ''}`} data-testid={`heat-threshold-${t.level}`}>
                <span className="thr-level">{t.level}</span><span className="thr-chips">{t.chips.join(', ')}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  )
}
