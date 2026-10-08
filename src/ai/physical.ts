// Physical Attack Phase scoring (40-ai §9): V(o) = pHit × [DV(t, damage, table) + P(t fails PSR) × FALL_COST(t)]
// − P(own PSR fails) × FALL_COST(u) − pHit × DVself(self damage) − (1 − pHit) × missCost. Every number (pHit, damage, table,
// self damage, which PSRs each side rolls and their odds) comes from query.physicalPreview.
import type {
  ArmLoc, AttackDirection, LegLoc, PhysicalChoice, PhysicalKind, PhysicalPreview, UnitAt, UnitId,
} from '../engine/index'
import { query } from '../engine/index'
import type { AiCtx } from './ctx'
import { targetModel, volleyValue, type TargetModel } from './damage'

const five = (n: number): number[] => { const g: number[] = []; let left = n; while (left > 0) { g.push(Math.min(5, left)); left -= 5 } return g }

function modelOf(ctx: AiCtx, id: UnitId): TargetModel {
  const k = `tm:${id}`
  let m = ctx.memo.get(k) as TargetModel | undefined
  if (!m) { m = targetModel(ctx, id); ctx.memo.set(k, m) }
  return m
}

/** Value of one physical preview (one limb or one charge/DFA) for the attacker, in DP. */
export function previewValue(ctx: AiCtx, attackerId: UnitId, pv: PhysicalPreview, targetId: UnitId, direction: AttackDirection = 'front'): number {
  if (!pv.legal || pv.pHit <= 0) return pv.legal ? -0.01 : -Infinity
  const t = modelOf(ctx, targetId)
  const groups = pv.kind === 'charge' || pv.kind === 'dfa' ? five(pv.damage) : pv.damage > 0 ? [pv.damage] : []
  let v = 0
  if (groups.length) v += volleyValue(t, direction, [{ pHit: pv.pHit, table: pv.table, partialCover: false, damage: pv.damage, cluster: null, groups }]).dv
  if (pv.targetPsr) v += pv.pHit * (1 - pv.targetPsr.p) * ctx.fallCost(targetId)
  if (pv.attackerPsr) {
    const pRoll = pv.attackerPsr.onHit ? pv.pHit : 1 - pv.pHit
    v -= pRoll * (1 - pv.attackerPsr.p) * ctx.fallCost(attackerId)
  }
  if (pv.selfDamage > 0) {
    const self = modelOf(ctx, attackerId)
    const table = pv.kind === 'dfa' ? 'kick' as const : 'standard' as const
    v -= volleyValue(self, 'front', [{ pHit: pv.pHit, table, partialCover: false, damage: pv.selfDamage, cluster: null, groups: five(pv.selfDamage) }]).dv
  }
  if (pv.kind === 'dfa') v -= (1 - pv.pHit) * ctx.fallCost(attackerId) // a missed DFA is an automatic fall
  return v
}

/** Attack direction attacker → target (from an attack preview of any weapon; the direction does not depend on legality). */
export function directionOf(ctx: AiCtx, attackerId: UnitId, targetId: UnitId, attackerAt?: UnitAt, targetAt?: UnitAt): AttackDirection {
  const w = ctx.factsOf(attackerId).weapons[0] ?? null
  const mountId = w?.mountId ?? Object.keys(ctx.unit(attackerId).mounts)[0]
  if (!mountId) return 'front'
  return query.attackPreview(ctx.state, { attackerId, mountId, targetId, ...(attackerAt ? { attackerAt } : {}), ...(targetAt ? { targetAt } : {}) }).direction
}

/** Value of a full declarePhysical choice from the attacker's current position. */
export function choiceValue(ctx: AiCtx, attackerId: UnitId, c: PhysicalChoice): number {
  const s = ctx.state
  switch (c.kind) {
    case 'none': return 0
    case 'punch': {
      let v = 0
      for (const a of c.arms) v += previewValue(ctx, attackerId, query.physicalPreview(s, { attackerId, kind: 'punch', limb: a.arm, targetId: a.targetId }), a.targetId, directionOf(ctx, attackerId, a.targetId))
      return v
    }
    case 'kick': return previewValue(ctx, attackerId, query.physicalPreview(s, { attackerId, kind: 'kick', limb: c.leg, targetId: c.targetId }), c.targetId, directionOf(ctx, attackerId, c.targetId))
    case 'push': {
      const pv = query.physicalPreview(s, { attackerId, kind: 'push', targetId: c.targetId })
      return previewValue(ctx, attackerId, pv, c.targetId, directionOf(ctx, attackerId, c.targetId)) - 0.5 // pushes rarely beat a kick
    }
  }
}

/** Best punch/kick value from a hypothetical position against a target (movement scoring, §6.2 Physical). */
export function bestMeleeFrom(ctx: AiCtx, attackerId: UnitId, attackerAt: UnitAt, targetId: UnitId, targetAt?: UnitAt): number {
  const s = ctx.state
  const req = (kind: PhysicalKind, limb: ArmLoc | LegLoc) => query.physicalPreview(s, { attackerId, kind, limb, targetId, attackerAt, ...(targetAt ? { targetAt } : {}) })
  const dir = directionOf(ctx, attackerId, targetId, attackerAt, targetAt)
  const kick = Math.max(previewValue(ctx, attackerId, req('kick', 'LL'), targetId, dir), previewValue(ctx, attackerId, req('kick', 'RL'), targetId, dir))
  const pl = previewValue(ctx, attackerId, req('punch', 'LA'), targetId, dir)
  const pr = previewValue(ctx, attackerId, req('punch', 'RA'), targetId, dir)
  const punch = Math.max(0, pl) + Math.max(0, pr)
  return Math.max(0, kick, punch)
}
