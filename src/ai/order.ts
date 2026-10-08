// Which unit acts next (40-ai §7). Movement: slow, committed and threatened units move first; fast units, jumpers and the
// strongest shooters move last so they can exploit rear arcs after the enemy has committed. Attack phases: the strongest
// shooter declares first so later units focus through the plan memo (§8.6).
import type { Action, SelectUnitAction, UnitId } from '../engine/index'
import { query } from '../engine/index'
import type { AiCtx } from './ctx'
import { targetModel } from './damage'
import { threatAt } from './threat'

export function decideSelect(ctx: AiCtx, legal: Action[]): Action {
  const opts = legal.filter((a): a is SelectUnitAction => a.type === 'selectUnit')
  if (opts.length <= 1) return legal[0]!
  const phase = ctx.state.phase
  const key = (id: UnitId): number => {
    const u = ctx.unit(id)
    const fp = ctx.firepower(id)
    if (phase !== 'movement') return -fp
    const run = Math.ceil(u.baseMp.walk * 1.5)
    const adjacent = u.pos ? ctx.enemiesOf().some((e) => { const p = ctx.unit(e).pos; return !!p && query.distance(p, u.pos!) === 1 }) : false
    const flex = 2 * (u.baseMp.jump > 0 ? 1 : 0) + run / 2 - 3 * (adjacent ? 1 : 0) - 2 * (u.shutdown || u.prone ? 1 : 0)
    let threat = 0
    if (u.pos && ctx.tier.wT > 0) {
      threat = threatAt(ctx, id, { hex: u.pos, facing: u.facing, hexesMoved: 0, jumped: false }, targetModel(ctx, id), { fast: true, sample: false, lambda: 0 }).taken
    }
    // lost initiative → we move first in each pair: the most threatened / least committed go first;
    // strongest shooters are held for last
    return flex + 0.15 * fp - 0.08 * threat
  }
  let best = opts[0]!, bk = key(best.unitId)
  ctx.note(best, -bk)
  for (const o of opts.slice(1)) {
    const k = key(o.unitId)
    ctx.note(o, -k)
    if (k < bk - 1e-9 || (Math.abs(k - bk) <= 1e-9 && o.unitId < best.unitId)) { best = o; bk = k }
  }
  return best
}
