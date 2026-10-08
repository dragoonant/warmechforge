// Threat model (40-ai §5): what each enemy is expected to take off our unit if it ends at hex c with leg facing f.
// Moved enemies fire from where they stand (best torso twist); unmoved enemies are sampled from their own reach set (near c,
// at their preferred range from c, and in c's rear arc) and face c. Every to-hit number comes from query.attackPreview.
import type { AttackDirection, Hex, MoveMode, ReachEntry, Twist, UnitAt, UnitId } from '../engine/index'
import { query } from '../engine/index'
import { facingToward, hexKey, turnGap, type AiCtx } from './ctx'
import { attackFromPreview, valuePerPoint, volleyValue, type AttackIn, type TargetModel } from './damage'
import { heatBase } from './fire'
import { bestMeleeFrom } from './physical'

/** Heat cap the AI assumes an enemy plays to when it predicts the enemy's volley. */
const ENEMY_HEAT_CAP = 13

export interface EnemyPos { hex: Hex; facing: number; mode: MoveMode; twist: Twist | null; weight: number }

/** Where an enemy will shoot from: its actual position when moved, else sampled end hexes (normal) or its hex (easy). */
export function enemyReachHexes(ctx: AiCtx, enemyId: UnitId): { hex: Hex; mode: MoveMode; dist0: number }[] {
  const k = `reach:${enemyId}`
  let v = ctx.memo.get(k) as { hex: Hex; mode: MoveMode; dist0: number }[] | undefined
  if (v) return v
  const e = ctx.unit(enemyId)
  const byHex = new Map<string, { hex: Hex; mode: MoveMode; dist0: number; mod: number }>()
  let entries: ReachEntry[] = []
  try { entries = query.reachable(ctx.state, enemyId) } catch { entries = [] }
  const modeMod: Record<MoveMode, number> = { standStill: 0, walk: 1, run: 2, jump: 3 }
  for (const r of entries) {
    if (r.endsProne || r.physical) continue
    const key = hexKey(r.hex)
    const cur = byHex.get(key)
    const mod = r.attackerMod ?? modeMod[r.mode]
    if (!cur || mod < cur.mod) byHex.set(key, { hex: r.hex, mode: r.mode, dist0: e.pos ? query.distance(e.pos, r.hex) : 0, mod })
  }
  if (!byHex.size && e.pos) byHex.set(hexKey(e.pos), { hex: e.pos, mode: 'standStill', dist0: 0, mod: 0 })
  v = [...byHex.values()].map(({ hex, mode, dist0 }) => ({ hex, mode, dist0 }))
  ctx.memo.set(k, v)
  return v
}

/** Expected volley of enemy e from position p on our unit at `usAt`: previews per weapon, greedy under e's heat cap. */
function enemyVolley(ctx: AiCtx, enemyId: UnitId, p: EnemyPos, usId: UnitId, usAt: UnitAt): { attacks: AttackIn[]; direction: AttackDirection; fast: number } {
  // our facing changes only the attack direction (hit table side), never the to-hit numbers: cache the volley without it
  const vk = `ev:${enemyId}:${hexKey(p.hex)}:${p.facing}:${p.mode}:${p.twist}:${usAt.hex ? hexKey(usAt.hex) : ''}:${usAt.hexesMoved}:${usAt.jumped ? 1 : 0}:${usAt.prone ? 1 : 0}`
  let v = ctx.memo.get(vk) as { attacks: AttackIn[]; fast: number; mountId: string | null } | undefined
  if (!v) { const r = enemyVolleyRaw(ctx, enemyId, p, usId, usAt); v = { attacks: r.attacks, fast: r.fast, mountId: r.mountId }; ctx.memo.set(vk, v) }
  let direction: AttackDirection = 'front'
  if (v.mountId) {
    const dk = `dir:${hexKey(p.hex)}:${usAt.hex ? hexKey(usAt.hex) : ''}:${usAt.facing}`
    let d = ctx.memo.get(dk) as AttackDirection | undefined
    if (!d) {
      d = query.attackPreview(ctx.state, { attackerId: enemyId, mountId: v.mountId, targetId: usId, attackerAt: { hex: p.hex, facing: p.facing as UnitAt['facing'] }, targetAt: usAt }).direction
      ctx.memo.set(dk, d)
    }
    direction = d
  }
  return { attacks: v.attacks, direction, fast: v.fast }
}

function enemyVolleyRaw(ctx: AiCtx, enemyId: UnitId, p: EnemyPos, usId: UnitId, usAt: UnitAt): { attacks: AttackIn[]; fast: number; mountId: string | null } {
  const e = ctx.unit(enemyId)
  const facts = ctx.factsOf(enemyId)
  const attackerAt: UnitAt = { hex: p.hex, facing: p.facing as UnitAt['facing'], mode: p.mode, ...(p.twist !== null ? { twist: p.twist } : {}) }
  const opts: { pv: ReturnType<typeof query.attackPreview>; perGroup: number }[] = []
  for (const w of facts.weapons) {
    const pv = query.attackPreview(ctx.state, {
      attackerId: enemyId, mountId: w.mountId, targetId: usId, attackerAt, targetAt: usAt, primaryTargetId: null,
      ...(w.usesAmmo && w.ammo[0] ? { binId: w.ammo[0].binId } : {}),
    })
    if (!pv.legal || pv.pHit <= 0) continue
    opts.push({ pv, perGroup: w.cluster?.groupSize ?? 1 })
  }
  // greedy by expected damage per heat under the enemy's heat cap
  const hk = `ebase:${enemyId}:${p.mode}:${p.mode === 'jump' ? Math.max(1, query.distance(e.pos ?? p.hex, p.hex)) : 0}`
  let base = ctx.memo.get(hk) as number | undefined
  if (base === undefined) {
    base = heatBase(ctx, enemyId, { mode: e.move.mode ?? p.mode, ...(p.mode === 'jump' ? { hexesJumped: Math.max(1, query.distance(e.pos ?? p.hex, p.hex)) } : {}) })
    ctx.memo.set(hk, base)
  }
  opts.sort((a, b) => b.pv.expectedDamage / (b.pv.heat + 1) - a.pv.expectedDamage / (a.pv.heat + 1))
  const attacks: AttackIn[] = []
  let heat = 0, fast = 0
  for (const o of opts) {
    if (base + heat + o.pv.heat > ENEMY_HEAT_CAP && attacks.length > 0) continue
    heat += o.pv.heat
    attacks.push(attackFromPreview(o.pv, o.perGroup))
    fast += o.pv.expectedDamage
  }
  return { attacks, fast, mountId: facts.weapons[0]?.mountId ?? null }
}

/** Positions enemy e may shoot from this turn, as seen from our candidate hex c (40-ai §5.1). */
export function enemyPositions(ctx: AiCtx, enemyId: UnitId, c: Hex, sample: boolean): EnemyPos[] {
  const e = ctx.unit(enemyId)
  if (!e.pos) return []
  if (ctx.hasMoved(enemyId)) {
    const twistable = e.attacks.twistPhase === null && !e.prone
    const want = facingToward(e.pos, c)
    let twist: Twist = 0
    if (twistable) {
      let bestGap = turnGap(e.facing, want)
      for (const tw of [-1, 1] as Twist[]) { const g = turnGap((e.facing + tw + 6) % 6, want); if (g < bestGap) { bestGap = g; twist = tw } }
    }
    return [{ hex: e.pos, facing: e.facing, mode: e.move.mode ?? 'standStill', twist: twistable ? twist : null, weight: 1 }]
  }
  if (!sample) return [{ hex: e.pos, facing: facingToward(e.pos, c), mode: 'standStill', twist: null, weight: 1 }]
  const reach = enemyReachHexes(ctx, enemyId).filter((r) => !(r.hex.q === c.q && r.hex.r === c.r))
  const pref = ctx.factsOf(enemyId).prefRange
  const withD = reach.map((r) => ({ ...r, d: query.distance(r.hex, c) }))
  const pick = new Map<string, (typeof withD)[number]>()
  const take = (xs: typeof withD, n: number): void => { let k = 0; for (const x of xs) { if (k >= n) break; const key = hexKey(x.hex); if (!pick.has(key)) { pick.set(key, x); k++ } } }
  take([...withD].sort((a, b) => a.d - b.d || a.dist0 - b.dist0), 4)
  take([...withD].sort((a, b) => Math.abs(a.d - pref) - Math.abs(b.d - pref) || a.dist0 - b.dist0), 4)
  // hexes behind c (for some facing of ours): the far side of c from the enemy's current hex
  const away = withD.filter((x) => x.d <= 4 && query.distance(x.hex, e.pos!) > query.distance(c, e.pos!)).sort((a, b) => a.d - b.d)
  take(away, 4)
  const weight = e.prone ? 0.5 : 1
  return [...pick.values()].map((x) => ({ hex: x.hex, facing: facingToward(x.hex, c), mode: x.mode, twist: null, weight }))
}

export interface ThreatResult {
  /** Σ_e threat(e→c,f) in DP. */
  taken: number
  /** P(our unit is destroyed this turn) from the enemies' best sampled volleys. */
  pDying: number
  /** Some enemy position sees our rear arc. */
  rearExposed: number
}

/**
 * threat(e→c, f) summed over enemies (40-ai §5.3). `fast` uses the additive per-point value and the enemies' current hexes;
 * the full form samples unmoved enemies and runs the exact DV per position, plus a melee threat when adjacent.
 */
export function threatAt(ctx: AiCtx, usId: UnitId, usAt: UnitAt & { hex: Hex }, own: TargetModel, opts: { fast: boolean; sample: boolean; lambda: number }): ThreatResult {
  let taken = 0, survive = 1, rearExposed = 0
  for (const eid of ctx.enemiesOf()) {
    const e = ctx.unit(eid)
    if (e.shutdown || !e.pilot.conscious) continue
    const positions = enemyPositions(ctx, eid, usAt.hex, opts.sample && !opts.fast)
    if (!positions.length) continue
    let mx = 0, sum = 0, wsum = 0, bestKill = 0, rear = 0
    for (const p of positions) {
      const v = enemyVolley(ctx, eid, p, usId, usAt)
      let val: number
      if (opts.fast) {
        val = v.fast * valuePerPoint(own, v.direction)
      } else {
        const vv = volleyValue(own, v.direction, v.attacks)
        val = vv.dv
        bestKill = Math.max(bestKill, vv.pKill)
        if (query.distance(p.hex, usAt.hex) === 1 && !e.prone) {
          val += 0.5 * bestMeleeFromEnemy(ctx, eid, p, usId, usAt)
        }
      }
      if (v.direction === 'rear' && v.attacks.length) rear = Math.max(rear, ctx.firepower(eid))
      val *= p.weight
      mx = Math.max(mx, val)
      sum += val
      wsum += 1
    }
    const lam = positions.length === 1 ? 1 : opts.lambda
    taken += lam * mx + (1 - lam) * (wsum ? sum / wsum : 0)
    survive *= 1 - bestKill
    rearExposed += rear
  }
  return { taken, pDying: 1 - survive, rearExposed }
}

function bestMeleeFromEnemy(ctx: AiCtx, enemyId: UnitId, p: EnemyPos, usId: UnitId, usAt: UnitAt): number {
  // value of the enemy's best kick/punch on us = what we lose; bestMeleeFrom prices it from the enemy's side, so swap roles
  // by reading the raw preview value (damage on our model and our fall risk) through the enemy as attacker
  return Math.max(0, bestMeleeFrom(ctx, enemyId, { hex: p.hex, facing: p.facing as UnitAt['facing'], mode: p.mode }, usId, usAt))
}
