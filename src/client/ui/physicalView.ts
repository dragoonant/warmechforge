// Physical attack view model (50 §7.6). Rows from query.physicalOptions; the both-arms punch is the engine's own legal choice.
// Release 1: punch, kick and push only here; charge and DFA are declared with the move and only shown as a locked row.
import type { Action, GameState, PhysicalChoice, PhysicalPreview, UnitId } from '../../engine/index'
import { formatOdds, hexName, unitName, type Settings } from '../contract'
import { modPhrases, targetHexes } from './format'
import { whyText } from './fireView'

export interface PhysicalRowView {
  id: string
  kind: PhysicalPreview['kind'] | 'punchBoth'
  label: string
  legal: boolean
  why: string | null
  /** "Kick (LL) · TN 8 · 42% · 10 dmg" */
  line: string
  /** "miss: you make a PSR (TN 7, 58%)", "you take 4", ... */
  risk: string[]
  breakdown: string[]
  choice: PhysicalChoice | null
  previews: PhysicalPreview[]
}

const LIMB_WORDS: Record<string, string> = { LA: 'left arm', RA: 'right arm', LL: 'left leg', RL: 'right leg' }
const VERB: Record<PhysicalPreview['kind'], string> = { punch: 'Punch', kick: 'Kick', push: 'Push', charge: 'Charge', dfa: 'Death from above' }
const TABLE_WORDS: Record<PhysicalPreview['table'], string> = { standard: 'standard', punch: 'punch', kick: 'kick' }

function odds(p: number, tn: number, mode: Settings['odds']): string {
  return mode === 'tn' ? `TN ${tn}` : formatOdds(p, tn)
}

export function riskLines(state: GameState | null, p: PhysicalPreview, mode: Settings['odds'] = 'percent'): string[] {
  const out: string[] = []
  if (p.selfDamage > 0) out.push(`you take ${p.selfDamage}`)
  if (p.attackerPsr) out.push(`${p.attackerPsr.onHit ? 'hit' : 'miss'}: you make a PSR (TN ${p.attackerPsr.tn}, ${odds(p.attackerPsr.p, p.attackerPsr.tn, mode)})`)
  if (p.targetPsr) out.push(`target makes a PSR (TN ${p.targetPsr.tn}, ${odds(p.targetPsr.p, p.targetPsr.tn, mode)})`)
  if (p.displacement) out.push(`target is pushed to ${hexName(state, p.displacement)}`)
  return out
}

const labelOf = (p: PhysicalPreview): string => `${VERB[p.kind]}${p.limb ? ` (${LIMB_WORDS[p.limb] ?? p.limb})` : ''}`

export function buildPhysicalRows(
  state: GameState | null, targetId: UnitId, options: readonly PhysicalPreview[], legal: readonly Action[], mode: Settings['odds'] = 'percent',
): PhysicalRowView[] {
  const rows: PhysicalRowView[] = options.map((p, i) => ({
    id: `${p.kind}${p.limb ? `-${p.limb}` : ''}-${i}`, kind: p.kind, label: labelOf(p), legal: p.legal && !!p.choice, why: p.legal && p.choice ? null : whyText(p),
    line: p.legal ? `${labelOf(p)} · TN ${p.tn}${mode === 'percent' ? ` · ${formatOdds(p.pHit, p.tn)}` : ''} · ${p.damage} dmg` : labelOf(p),
    risk: p.legal ? riskLines(state, p, mode) : [],
    breakdown: p.legal ? [`TN ${p.tn} = ${modPhrases(p.mods, { targetHexes: targetHexes(state, targetId) }).join(', ') || 'no modifiers'}`] : [],
    choice: p.legal ? p.choice : null, previews: [p],
  }))
  // both arms: only when the engine lists that exact combination as a legal answer
  const both = legal.find((a) => a.type === 'declarePhysical' && a.attack.kind === 'punch' && a.attack.arms.length === 2 && a.attack.arms.every((x) => x.targetId === targetId))
  const arms = options.filter((p) => p.kind === 'punch' && p.legal)
  if (both && both.type === 'declarePhysical' && arms.length === 2) {
    const dmg = arms.reduce((n, p) => n + p.damage, 0)
    const idx = rows.findIndex((r) => r.kind === 'push')
    const row: PhysicalRowView = {
      id: 'punchBoth', kind: 'punchBoth', label: 'Punch with both arms', legal: true, why: null,
      line: `Punch with both arms · ${arms.map((p) => `${p.limb} TN ${p.tn}${mode === 'percent' ? ` ${formatOdds(p.pHit, p.tn)}` : ''}`).join(' and ')} · ${dmg} dmg if both land`,
      risk: [...new Set(arms.flatMap((p) => riskLines(state, p, mode)))],
      breakdown: arms.map((p) => `${p.limb}: TN ${p.tn} = ${modPhrases(p.mods, { targetHexes: targetHexes(state, targetId) }).join(', ') || 'no modifiers'}`),
      choice: both.attack, previews: arms,
    }
    rows.splice(idx < 0 ? rows.length : idx, 0, row)
  }
  return rows
}

/** "Kick Solitaire? TN 8 (Piloting 5, kick −1, ...) = 42%. 10 damage on the kick table; miss: you make a PSR." */
export function physicalSentence(state: GameState | null, row: PhysicalRowView, targetId: UnitId, mode: Settings['odds'] = 'percent'): string {
  const target = unitName(state, targetId)
  if (!row.choice || row.previews.length === 0) return `Make no physical attack?`
  if (row.kind === 'punchBoth') {
    const bits = row.previews.map((p) => `${LIMB_WORDS[p.limb ?? ''] ?? p.limb} TN ${p.tn}${mode === 'percent' ? ` = ${formatOdds(p.pHit, p.tn)}` : ''}`)
    return `Punch ${target} with both arms? ${bits.join(', ')}.${row.risk.length ? ` ${row.risk.join('; ')}.` : ''}`
  }
  const p = row.previews[0]!
  const mods = modPhrases(p.mods, { targetHexes: targetHexes(state, targetId) })
  const tail = row.risk.length ? `; ${row.risk.join('; ')}` : ''
  return `${VERB[p.kind]} ${target}? TN ${p.tn}${mods.length ? ` (${mods.join(', ')})` : ''}${mode === 'percent' ? ` = ${formatOdds(p.pHit, p.tn)}` : ''}. ${p.damage} damage${p.table === 'standard' ? '' : ` on the ${TABLE_WORDS[p.table]} table`}${tail}.`
}

/** Locked read-only line for a charge or DFA declared with the move. */
export function lockedAttackLine(state: GameState | null, p: PhysicalPreview, targetId: UnitId): string {
  return `${VERB[p.kind]} ${unitName(state, targetId)} · TN ${p.tn} · ${p.damage} dmg · resolves with the other attacks`
}
