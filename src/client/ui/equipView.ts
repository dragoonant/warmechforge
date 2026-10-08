// Special-equipment view model (M8): Ultra AC double tap, PPC capacitor charge, coolant pod and MASC (10 EQUIP-013..023).
// The engine owns every number: states and avoid numbers come from SheetView.equipment, heat and odds from query.firePreview /
// query.reachable. This file only finds which mount is which (data lookups) and words the choices.
import type { FireShot, GameState, LocalId, SheetView, UnitId } from '../../engine/index'
import { bundle } from '../store/setup'

type EquipEntry = NonNullable<SheetView['equipment']>[number]

/** Rapid-fire modes above a single shot that a weapon mount offers ([2] for an Ultra AC), from its data record. */
export function rapidModesOf(state: GameState | null, unitId: UnitId, mountId: LocalId): number[] {
  const item = state?.units[unitId]?.mounts[mountId]?.item
  if (!item) return []
  const rec = bundle().byId[item] as { rapidFire?: { modes?: number[] } } | undefined
  return (rec?.rapidFire?.modes ?? []).filter((n) => n > 1)
}

export interface AmmoOption { binId: LocalId; ammoId: string; shots: number }
/**
 * The ammunition kinds a mount can fire when the unit carries more than one (an MML with SRM and LRM bins), one bin per kind
 * (the one the engine would use: fewest shots left). Empty when there is nothing to choose.
 */
export function ammoOptionsOf(state: GameState | null, unitId: UnitId, mountId: LocalId): AmmoOption[] {
  const u = state?.units[unitId]
  const item = u?.mounts[mountId]?.item
  if (!u || !item) return []
  const ok = new Set((bundle().byId[item] as { ammo?: string[] } | undefined)?.ammo ?? [])
  const byKind = new Map<string, AmmoOption>()
  for (const b of Object.values(u.bins)) {
    if (!ok.has(b.ammo) || b.shots <= 0 || b.exploded || u.locs[b.location]?.destroyed) continue
    const cur = byKind.get(b.ammo)
    if (!cur || b.shots < cur.shots) byKind.set(b.ammo, { binId: b.id, ammoId: b.ammo, shots: b.shots })
  }
  return byKind.size > 1 ? [...byKind.values()] : []
}

/** The capacitor linked to a PPC mount, with its state ('ready' | 'charging' | 'charged' | 'destroyed'), or null. */
export function capacitorOf(state: GameState | null, sheet: SheetView | null, unitId: UnitId, weaponMountId: LocalId): EquipEntry | null {
  const mounts = state?.units[unitId]?.mounts
  if (!mounts) return null
  return sheet?.equipment?.find((e) => e.kind === 'capacitor' && mounts[e.mountId]?.linkedTo === weaponMountId) ?? null
}

/** The unit's coolant pod entry, if it carries one. */
export const podOf = (sheet: SheetView | null): EquipEntry | null => sheet?.equipment?.find((e) => e.kind === 'coolantPod') ?? null
/** The unit's MASC entry that still works (or is active this turn), if any. */
export const mascOf = (sheet: SheetView | null): EquipEntry | null => sheet?.equipment?.find((e) => e.kind === 'masc' && e.state !== 'destroyed') ?? null

// ---------- words ----------
export const CHARGE_NOTE = 'Fires +5 damage next turn, +5 heat now, cannot fire this turn.'
export const RAPID_NOTE = 'Two shots in one: more damage if they hit, twice the heat and ammunition.'

/** One-line outcome for a charge choice: "ER PPC (RA): capacitor charges now (+5 heat); next turn it fires for +5 damage." */
export function chargeSentence(names: readonly string[]): string {
  return `Charging ${names.join(' and ')}: ${CHARGE_NOTE}`
}

/** Holding an already charged capacitor: the charged shot is given up this turn (EQUIP-016). */
export function holdChargeSentence(names: readonly string[]): string {
  return `Holding the charge on ${names.join(' and ')}: skips the charged +5 shot this turn and keeps the charge for next turn, for 5 more heat now.`
}

/** "Vent the coolant pod: the turn ends at 9 heat instead of 17." */
export function podSentence(before: number, after: number, on: boolean): string {
  if (before === after) return `Venting the coolant pod would not change this turn's end heat (${after}). It works once per game, so save it for a hotter turn.`
  return on
    ? `Venting the coolant pod: this turn ends at ${after} heat instead of ${before}. The pod works once per game.`
    : `Venting the coolant pod would end this turn at ${after} heat instead of ${before}. The pod works once per game.`
}

/** The chip of a MASC in Run mode: its avoid number and what the boost buys. */
export function mascLines(sheet: SheetView, e: EquipEntry, now: { available: boolean; entering: boolean } = { available: true, entering: false }): { label: string; note: string; risk: string; available: boolean } {
  const run = sheet.mp.run, boosted = e.mascRun ?? run
  const extra = Math.max(0, boosted - run)
  if (e.state === 'active') {
    return {
      available: false,
      label: `MASC on: Run ${boosted}`,
      note: `The MASC is already running this turn (up to ${boosted} MP), so no new roll is needed.`,
      risk: 'The strain is paid: the next roll this game is harder.',
    }
  }
  if (!now.available) {
    return {
      available: false, label: `MASC: +${extra} MP`, risk: '',
      note: now.entering
        ? `Not on the move that brings this 'Mech onto the map. From next turn: run up to ${boosted} MP, roll ${e.avoidTn ?? '?'}+ to avoid trouble.`
        : `The MASC has to be switched on before the 'Mech spends any movement this turn.`,
    }
  }
  return {
    available: true,
    label: `MASC: +${extra} MP`,
    note: `Run up to ${boosted} MP instead of ${run}. Before you move, roll 2d6: you need ${e.avoidTn ?? '?'}+ to avoid trouble.`,
    risk: `Fail the roll and the MASC is wrecked, a leg takes a critical hit check, and your move stops where a normal run would have ended. Each use makes the next roll harder.`,
  }
}

// ---------- shot list editing (pure) ----------
/** Switch a weapon's rapid-fire mode on (adding the shot if it is not picked yet) or off (the shot stays picked). */
export function toggleRapid(shots: readonly FireShot[], mountId: LocalId, targetId: UnitId, mode = 2): FireShot[] {
  const cur = shots.find((s) => s.mountId === mountId)
  if (!cur) return [...shots, { mountId, targetId, rapidShots: mode }]
  return shots.map((s) => {
    if (s.mountId !== mountId) return s
    if (s.rapidShots) { const { rapidShots: _drop, ...rest } = s; void _drop; return rest }
    return { ...s, rapidShots: mode }
  })
}

/** Turn a PPC's capacitor charge on or off; charging removes its shot (a charging PPC does not fire). */
export function toggleCharge(charge: readonly LocalId[], shots: readonly FireShot[], mountId: LocalId): { charge: LocalId[]; shots: FireShot[] } {
  if (charge.includes(mountId)) return { charge: charge.filter((c) => c !== mountId), shots: [...shots] }
  return { charge: [...charge, mountId], shots: shots.filter((s) => s.mountId !== mountId) }
}

// ---------- record sheet ----------
export interface EquipChip { key: string; text: string; tone: 'ok' | 'info' | 'bad'; tip: string }
/** Record-sheet lines for SheetView.equipment: capacitor charged, pod used, MASC avoid number, jammed weapons. */
export function equipmentChips(sheet: SheetView): EquipChip[] {
  const out: EquipChip[] = []
  for (const e of sheet.equipment ?? []) {
    const key = e.mountId
    if (e.kind === 'capacitor') {
      const t = e.state === 'charged' ? { text: `${e.name}: charged (+5 damage on the PPC shot this turn)`, tone: 'ok' as const, tip: 'Charged last turn. The linked PPC fires for +5 damage this turn; a charge that is not fired this turn is lost.' }
        : e.state === 'charging' ? { text: `${e.name}: charging`, tone: 'info' as const, tip: 'Charging this turn. The linked PPC fires for +5 damage next turn.' }
        : e.state === 'destroyed' ? { text: `${e.name}: destroyed`, tone: 'bad' as const, tip: 'This capacitor is gone; the PPC fires normally.' }
        : { text: `${e.name}: ready to charge`, tone: 'info' as const, tip: CHARGE_NOTE }
      out.push({ key, ...t })
    } else if (e.kind === 'coolantPod') {
      out.push(e.state === 'used' ? { key, text: `${e.name}: used`, tone: 'info', tip: 'A coolant pod works once per game.' }
        : e.state === 'destroyed' ? { key, text: `${e.name}: destroyed`, tone: 'bad', tip: 'This pod is gone.' }
        : { key, text: `${e.name}: ready`, tone: 'ok', tip: 'Vent it in the ranged attack step for extra cooling that turn. One use per game.' })
    } else if (e.kind === 'masc') {
      out.push(e.state === 'destroyed' ? { key, text: `${e.name}: destroyed`, tone: 'bad', tip: 'This MASC is gone.' }
        : { key, text: `${e.name}: ${e.state === 'active' ? 'running' : 'ready'}, avoid ${e.avoidTn ?? '?'}+`, tone: e.state === 'active' ? 'info' : 'ok', tip: `Roll ${e.avoidTn ?? '?'}+ on 2d6 to avoid a failure when you switch it on. Every use makes the next roll harder.` })
    } else if (e.kind === 'rapidFire' && e.state === 'jammed') {
      out.push({ key, text: `${e.name}: jammed`, tone: 'bad', tip: 'Jammed: it cannot fire until it is cleared.' })
    }
  }
  return out
}
