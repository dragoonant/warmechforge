// Cluster Hits Table and grouping (10 §9, CLUS-001..006, HITLOC-010).
import type { ClusterResolved } from './events'
import type { AttackId, DataBundle, Id, LocalId, UnitId, UnitState } from './types'
import type { Work } from './dice'
import { clamp, roll2d6 } from './dice'

/** Rows = weapon size 2..20, columns = modified 2d6 2..12 (CLUS-002). */
export const CLUSTER_TABLE: Readonly<Record<number, readonly number[]>> = {
  2: [1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2],
  3: [1, 1, 1, 2, 2, 2, 2, 2, 3, 3, 3],
  4: [1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4],
  5: [1, 2, 2, 3, 3, 3, 3, 4, 4, 5, 5],
  6: [2, 2, 3, 3, 4, 4, 4, 5, 5, 6, 6],
  7: [2, 2, 3, 4, 4, 4, 4, 6, 6, 7, 7],
  8: [2, 3, 3, 4, 4, 5, 5, 6, 7, 8, 8],
  9: [3, 3, 4, 5, 5, 5, 5, 7, 7, 9, 9],
  10: [3, 3, 4, 6, 6, 6, 6, 8, 8, 10, 10],
  11: [4, 4, 5, 7, 7, 7, 7, 9, 9, 11, 11],
  12: [4, 4, 5, 8, 8, 8, 8, 10, 10, 12, 12],
  13: [4, 4, 5, 8, 8, 8, 8, 11, 11, 13, 13],
  14: [5, 5, 6, 9, 9, 9, 9, 11, 11, 14, 14],
  15: [5, 5, 6, 9, 9, 9, 9, 12, 12, 15, 15],
  16: [5, 5, 7, 10, 10, 10, 10, 13, 13, 16, 16],
  17: [5, 5, 7, 10, 10, 10, 10, 14, 14, 17, 17],
  18: [6, 6, 8, 11, 11, 11, 11, 14, 14, 18, 18],
  19: [6, 6, 8, 11, 11, 11, 11, 15, 15, 19, 19],
  20: [6, 6, 9, 12, 12, 12, 12, 16, 16, 20, 20],
}

/** Missiles/pellets that hit for a rack of `size` on a modified roll (clamped to 2..12). Size 1 → 1. Sizes above 20 use the 20 row scaled. */
export function clusterHits(size: number, modifiedRoll: number): number {
  if (size <= 1) return Math.max(0, size)
  const col = clamp(modifiedRoll, 2, 12) - 2
  const row = CLUSTER_TABLE[size]
  if (row) return row[col]!
  if (size > 20) return Math.max(1, Math.round((CLUSTER_TABLE[20]![col]! * size) / 20))
  return CLUSTER_TABLE[2]![col]!
}

/**
 * Damage groups for `hits` missiles of `dmgPerHit` each, `perGroup` missiles to a location (CLUS-003, HITLOC-010):
 * full groups first, the leftover group last. LRM: perGroup 5 (groups of 5 damage); SRM / pellets / MGs: perGroup 1.
 */
export function clusterGroups(hits: number, dmgPerHit: number, perGroup: number): number[] {
  const out: number[] = []
  let left = hits
  const g = Math.max(1, perGroup)
  while (left > 0) { const n = Math.min(g, left); out.push(n * dmgPerHit); left -= n }
  return out
}

/** Split a plain damage total into groups of `size`, the leftover last (HITLOC-010): 17 → [5,5,5,2]. */
export function splitGroups(total: number, size = 5): number[] {
  const out: number[] = []
  let left = total
  while (left > 0) { const n = Math.min(size, left); out.push(n); left -= n }
  return out
}

export interface ClusterRollInput {
  attackId: AttackId | null
  attackerId: UnitId
  targetId?: UnitId | null
  rackSize: number
  mod: number // CLUS-004 roll modifier (sum of all)
  dmgPerHit: number
  perGroup: number
  streak?: boolean // CLUS-005: no roll, all hit
}

/** Rolls (or, for Streak, skips) the cluster roll and emits ClusterResolved. Returns the hits and damage groups. */
export function rollCluster(w: Work, p: ClusterRollInput): { hits: number; groups: number[]; roll: number; modified: number } {
  let rollTotal = 0
  let modified = 0
  let hits = p.rackSize
  if (!p.streak) {
    const spec: Parameters<typeof roll2d6>[1] = { purpose: 'cluster', unitId: p.attackerId, flat: p.mod, reason: `rack ${p.rackSize}` }
    if (p.targetId) spec.targetId = p.targetId
    if (p.attackId) spec.attackId = p.attackId
    const r = roll2d6(w, spec)
    rollTotal = r.dice.reduce((a, b) => a + b, 0)
    modified = clamp(r.total, 2, 12)
    hits = clusterHits(p.rackSize, modified)
  }
  const groups = clusterGroups(hits, p.dmgPerHit, p.perGroup)
  const ev: ClusterResolved = { type: 'ClusterResolved', attackId: p.attackId ?? '', rackSize: p.rackSize, roll: rollTotal, modified, hits, groups }
  w.ev.push(ev)
  return { hits, groups, roll: rollTotal, modified }
}

const WAYS = [0, 0, 1, 2, 3, 4, 5, 6, 5, 4, 3, 2, 1]

/** P(hits = k) for k = 0..size (index = hits), closed form over 2d6 + modifier (clamped 2..12). */
export function clusterDistribution(size: number, modifier: number): number[] {
  const out = new Array<number>(Math.max(1, size) + 1).fill(0)
  for (let t = 2; t <= 12; t++) {
    const hits = clusterHits(size, t + modifier)
    out[hits] = (out[hits] ?? 0) + WAYS[t]! / 36
  }
  return out
}

export function expectedClusterHits(size: number, modifier: number): number {
  return clusterDistribution(size, modifier).reduce((a, p, k) => a + p * k, 0)
}

/**
 * CLUS-004: Artemis IV adds +2 to the cluster roll when an intact Artemis mount is linked to the firing weapon AND the ammo
 * loaded is Artemis-capable (RULING: data marks that with an ammo id ending in "-artemis"). Streak never rolls, so never calls this.
 */
export function artemisClusterMod(data: DataBundle, u: UnitState, mountId: LocalId, ammoId: Id | null): number {
  if (!ammoId || !ammoId.endsWith('-artemis')) return 0
  for (const m of Object.values(u.mounts)) {
    if (m.destroyed || m.linkedTo !== mountId) continue
    if ((data.equipment[m.item] as { kind?: string } | undefined)?.kind === 'artemis') return 2
  }
  return 0
}
