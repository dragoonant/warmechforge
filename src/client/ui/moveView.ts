// Movement view model (50 §6). Reach entries, mode MP and the result strip all come from the engine; this file picks, groups and
// words them. Reach colours are display tones only (a hex is walk-green if any walk entry reaches it, else run-amber, else jump-blue).
import type { Action, Facing, GameState, MoveMode, PhysicalPreview, PsrReason, ReachEntry, SheetView, UnitId } from '../../engine/index'
import { FACING_LABELS, FACING_WORDS, MOVE_MODE_LABELS, PSR_REASON_LABELS, formatMod, formatOdds, hexKey, hexName, unitName, type ReachHex } from '../contract'
import { modPhrases } from './format'

export interface ModeButton { mode: MoveMode; label: string; mp: number | null; text: string }

/** Mode buttons in stand still / walk / run / jump order: "Walk 5", "Run 8", "Jump 4", "Stand still". MP from the sheet. */
export function modeButtons(modes: readonly MoveMode[], sheet: SheetView | null): ModeButton[] {
  const order: MoveMode[] = ['standStill', 'walk', 'run', 'jump']
  return order.filter((m) => modes.includes(m)).map((mode) => {
    const mp = mode === 'walk' ? sheet?.mp.walk ?? null : mode === 'run' ? sheet?.mp.run ?? null : mode === 'jump' ? sheet?.mp.jump ?? null : null
    return { mode, label: MOVE_MODE_LABELS[mode], mp, text: mp === null ? MOVE_MODE_LABELS[mode] : `${MOVE_MODE_LABELS[mode]} ${mp}` }
  })
}

export type ReachTone = 'walk' | 'run' | 'jump'
/** Per-hex tone for a reach set (all modes). */
export function hexTones(entries: readonly ReachEntry[]): Map<string, ReachTone> {
  const out = new Map<string, ReachTone>()
  const rank: Record<ReachTone, number> = { walk: 3, run: 2, jump: 1 }
  for (const e of entries) {
    if (e.mode === 'standStill' || e.physical) continue
    const key = hexKey(e.hex), tone = e.mode as ReachTone
    const cur = out.get(key)
    if (!cur || rank[tone] > rank[cur]) out.set(key, tone)
  }
  return out
}

export interface FacingChoice { facing: Facing; label: string; word: string; mp: number | null; enabled: boolean }
/** Six facing buttons for a locked hex: enabled only for facings in the reach set, each with its MP total. */
export function facingChoices(group: ReachHex | undefined, entries: readonly ReachEntry[] = group?.entries ?? []): FacingChoice[] {
  return ([0, 1, 2, 3, 4, 5] as Facing[]).map((facing) => {
    const hit = entries.filter((e) => !e.physical && e.facing === facing)
    const mp = hit.length ? Math.min(...hit.map((e) => e.mpUsed)) : null
    return { facing, label: FACING_LABELS[facing], word: FACING_WORDS[facing], mp, enabled: !!group?.facings.includes(facing) }
  })
}

/** "Walk 0608 · 5/6 MP · target modifier +2 · you +1 to-hit · +1 heat" (all four numbers from the reach entry). */
export function resultStrip(state: GameState | null, entry: ReachEntry, sheet: SheetView | null): string {
  const avail = entry.mode === 'walk' ? sheet?.mp.walk : entry.mode === 'run' ? sheet?.mp.run : entry.mode === 'jump' ? sheet?.mp.jump : undefined
  const mp = avail !== undefined ? `${entry.mpUsed}/${avail} MP` : `${entry.mpUsed} MP`
  const parts = [
    `${MOVE_MODE_LABELS[entry.mode]} ${entry.label ?? hexName(state, entry.hex)}`, mp, `target modifier ${formatMod(entry.tmm)}`,
    `you ${formatMod(entry.attackerMod)} to-hit`, `${formatMod(entry.heat)} heat`,
  ]
  return parts.join(' · ')
}

const PSR_WORDS: Partial<Record<PsrReason, string>> = {
  runWater: 'Run into water', rubble: 'Enter rubble', backwardLevel: 'Back down a level', landWater: 'Land in water',
  runDamaged: 'Run on damaged legs', jumpDamaged: 'Jump on damaged legs', stand: 'Stand up',
}
/** "Run into water: PSR TN 7 (58%)" per roll the move would trigger. */
export function psrFlags(entry: ReachEntry): string[] {
  return entry.psrs.map((p) => `${PSR_WORDS[p.reason] ?? PSR_REASON_LABELS[p.reason]}: piloting roll TN ${p.tn} (${formatOdds(p.p, p.tn)})`)
}

/** Charge / DFA chip result: "Charge Rakshasa · TN 7 (58%) · 20 dmg, you take 8 · both PSR". */
export function attackStrip(state: GameState | null, kind: 'charge' | 'dfa', targetId: UnitId, p: PhysicalPreview | null): string {
  const name = unitName(state, targetId)
  const verb = kind === 'charge' ? 'Charge' : 'DFA'
  if (!p) return `${verb} ${name}`
  if (!p.legal) return `${verb} ${name} · not possible from here: ${p.why ?? 'the engine refuses this attack'}`
  const mods = modPhrases(p.mods)
  const psr = [p.attackerPsr ? 'you roll a PSR' : null, p.targetPsr ? 'it rolls a PSR' : null].filter((x): x is string => !!x)
  return `${verb} ${name} · TN ${p.tn}${mods.length ? ` (${mods.join(', ')})` : ''} (${formatOdds(p.pHit, p.tn)}) · ${p.damage} dmg${p.selfDamage ? `, you take ${p.selfDamage}` : ''}${psr.length ? ` · ${psr.length === 2 ? 'both PSR' : psr[0]}` : ''}`
}

/** Standing up: "Uziel is prone. Stand up? PSR TN 4 (Piloting 5, standing −1) = 92%. Fail: fall again." */
export function standSentence(state: GameState | null, unitId: UnitId, psr: { tn: number; mods: Parameters<typeof modPhrases>[0]; p: number; auto: boolean } | undefined): string {
  const who = unitName(state, unitId)
  if (!psr) return `${who} is prone. Try to stand?`
  if (psr.auto) return `${who} is prone. Stand up? It cannot keep its footing: the attempt fails automatically.`
  const mods = modPhrases(psr.mods)
  return `${who} is prone. Stand up? PSR TN ${psr.tn}${mods.length ? ` (${mods.join(', ')})` : ''} = ${formatOdds(psr.p, psr.tn)}. Fail: fall again.`
}

/** The legal standUp answers as buttons. */
export function standChoices(legal: readonly Action[]): { key: string; label: string; attempt: boolean; mode?: 'walk' | 'run' }[] {
  const out: { key: string; label: string; attempt: boolean; mode?: 'walk' | 'run' }[] = []
  for (const a of legal) {
    if (a.type !== 'standUp') continue
    const key = a.attempt ? `try${a.mode ? `-${a.mode}` : ''}` : 'stay'
    if (out.some((o) => o.key === key)) continue
    out.push({ key, attempt: a.attempt, ...(a.attempt && a.mode ? { mode: a.mode } : {}), label: a.attempt ? `Try to stand${a.mode ? ` (${a.mode})` : ''}` : 'Stay prone' })
  }
  return out.sort((x, y) => Number(y.attempt) - Number(x.attempt))
}
