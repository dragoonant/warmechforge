// Soft heat cost and tiered hard caps on H_end (40-ai §8.4, §11; M4 brief caps). Every threshold comes from
// query.heatEffects; the AI only prices them.
import { query } from '../engine/index'
import type { UnitId } from '../engine/index'
import { pFail } from './prob'
import type { AiCtx } from './ctx'
import { TUNE } from './tune'

/** HeatCost(H) in DP: MP and to-hit thresholds reached, P(shutdown) and P(heat ammo explosion) priced (§8.4). */
export function heatCost(ctx: AiCtx, unitId: UnitId, H: number): number {
  if (H <= 0) return 0
  const k = `hc:${unitId}:${H}`
  const hit = ctx.memo.get(k) as number | undefined
  if (hit !== undefined) return hit
  const e = query.heatEffects(H)
  const facts = ctx.factsOf(unitId)
  const u = ctx.unit(unitId)
  let c = (TUNE.heatW ?? 1) * (3 * e.mpLoss + 0.25 * facts.firepower * e.toHitMod)
  const pShut = e.autoShutdown ? 1 : !u.pilot.conscious && e.shutdownTn !== null ? 1 : pFail(e.shutdownTn)
  c += pShut * (0.5 * facts.kill + facts.firepower)
  if (facts.liveAmmo && e.ammoTn !== null) c += pFail(e.ammoTn) * (0.5 * facts.kill)
  ctx.memo.set(k, c)
  return c
}

export interface HeatCapInfo { pKill: number; pDying: number }

/**
 * Highest H_end the tier accepts for this set: the default cap, raised when a kill shot is likely (shutdown avoid TN up to
 * the tier's kill-shot TN) or when the unit is about to die (avoid TN below the last-stand TN). Never automatic shutdown;
 * with live ammo never an ammo-explosion check outside a kill shot / last stand.
 */
export function heatCapFor(ctx: AiCtx, unitId: UnitId, info: HeatCapInfo): number {
  const t = ctx.tier
  let cap = t.heatCap
  const liveAmmo = ctx.factsOf(unitId).liveAmmo
  const highest = (ok: (h: number) => boolean): number => { let h = cap; for (let x = cap + 1; x < 30; x++) if (ok(x)) h = x; else break; return h }
  if (t.killShotAvoidTn !== null && info.pKill >= t.killShotP) {
    cap = highest((x) => { const e = query.heatEffects(x); return !e.autoShutdown && (e.shutdownTn ?? 0) <= t.killShotAvoidTn! && (!liveAmmo || e.ammoTn === null || info.pKill >= 0.8) })
  } else if (t.lastStandAvoidTn !== null && info.pDying >= t.dyingP) {
    cap = highest((x) => { const e = query.heatEffects(x); return !e.autoShutdown && (e.shutdownTn ?? 0) < t.lastStandAvoidTn! && (!liveAmmo || e.ammoTn === null) })
  }
  return Math.min(cap, 29)
}
