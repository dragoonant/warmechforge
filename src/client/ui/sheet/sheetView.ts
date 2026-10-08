// Record sheet view model (50 §10, our own layout). Pure: SheetView (engine) in, display rows out. Fractions are for drawing
// only; every number printed comes from the sheet query.
import type { Loc, Mod, SheetView, UnitState } from '../../../engine/index'
import { LOC_SHORT, STATUS_LABELS } from '../../contract'
import { modPhrases } from '../format'

export type CellState = 'full' | 'damaged' | 'exposed' | 'destroyed'

export interface DollCell {
  loc: Loc
  rear: boolean
  label: string
  armor: number
  maxArmor: number
  internal: number
  maxInternal: number
  armorFrac: number
  internalFrac: number
  state: CellState
  destroyed: boolean
  title: string
}

const frac = (n: number, max: number): number => (max > 0 ? Math.max(0, Math.min(1, n / max)) : 0)

function cellState(armor: number, maxArmor: number, internal: number, maxInternal: number, destroyed: boolean): CellState {
  if (destroyed || internal <= 0) return 'destroyed'
  if (armor <= 0 && maxArmor > 0) return 'exposed'
  if (internal < maxInternal || armor < maxArmor) return 'damaged'
  return 'full'
}

export const FRONT_LOCS: Loc[] = ['HD', 'CT', 'LT', 'RT', 'LA', 'RA', 'LL', 'RL']
export const REAR_LOCS: Loc[] = ['LT', 'CT', 'RT']

/** Eight front cells and three rear cells. A rear cell shows rear armor over the SAME internal structure as its front. */
export function buildDoll(sheet: SheetView): { front: DollCell[]; rear: DollCell[] } {
  const front = FRONT_LOCS.map((loc): DollCell => {
    const l = sheet.locations[loc]
    const state = cellState(l.armor, l.maxArmor, l.structure, l.maxStructure, l.destroyed)
    return {
      loc, rear: false, label: LOC_SHORT[loc], armor: l.armor, maxArmor: l.maxArmor, internal: l.structure, maxInternal: l.maxStructure,
      armorFrac: frac(l.armor, l.maxArmor), internalFrac: frac(l.structure, l.maxStructure), state, destroyed: state === 'destroyed',
      title: `${LOC_SHORT[loc]} ${l.armor}/${l.maxArmor} armor · ${l.structure}/${l.maxStructure} internal${l.destroyed ? ' · destroyed' : ''}`,
    }
  })
  const rear = REAR_LOCS.map((loc): DollCell => {
    const l = sheet.locations[loc]
    const armor = l.rear ?? 0, maxArmor = l.maxRear ?? 0
    const state = cellState(armor, maxArmor, l.structure, l.maxStructure, l.destroyed)
    return {
      loc, rear: true, label: `${LOC_SHORT[loc]}-R`, armor, maxArmor, internal: l.structure, maxInternal: l.maxStructure,
      armorFrac: frac(armor, maxArmor), internalFrac: frac(l.structure, l.maxStructure), state, destroyed: state === 'destroyed',
      title: `${LOC_SHORT[loc]} rear ${armor}/${maxArmor} armor · ${l.structure}/${l.maxStructure} internal${l.destroyed ? ' · destroyed' : ''}`,
    }
  })
  return { front, rear }
}

/** Armor and internal left over what the unit started with, as whole percents (hover card, roster). */
export function armorPercent(sheet: Pick<SheetView, 'locations'>): number {
  let a = 0, m = 0
  for (const l of Object.values(sheet.locations)) { a += l.armor + (l.rear ?? 0); m += l.maxArmor + (l.maxRear ?? 0) }
  return m > 0 ? Math.round((a / m) * 100) : 0
}

// ---------- weapons ----------
export interface WeaponRowView {
  mountId: string
  name: string
  location: Loc
  rear: boolean
  heat: number
  damage: string
  min: string
  short: string
  medium: string
  long: string
  ammo: string
  destroyed: boolean
  /** Its location is gone (grey) as opposed to the weapon itself being destroyed (struck through). */
  orphaned: boolean
  fired: boolean
}

/** "min 3, 3/6/9" or "3/6/9" or "-" into columns (formatting only). */
export function parseRanges(s: string): { min: string; short: string; medium: string; long: string } {
  const m = /^(?:min (\d+), )?(\d+)\/(\d+)\/(\d+)$/.exec(s.trim())
  if (!m) return { min: '-', short: '-', medium: '-', long: '-' }
  return { min: m[1] ?? '-', short: m[2]!, medium: m[3]!, long: m[4]! }
}

/** Ammo left for a weapon: bins whose ammo name starts with the weapon name (display match, not a rules lookup). */
export function ammoFor(sheet: SheetView, weaponName: string): string {
  const bins = sheet.ammo.filter((b) => b.name === weaponName || b.name.startsWith(`${weaponName} `) || b.name.startsWith(`${weaponName}-`))
  if (!bins.length) return '-'
  return String(bins.reduce((n, b) => n + b.shots, 0))
}

export function buildWeaponRows(sheet: SheetView): WeaponRowView[] {
  return sheet.weapons.map((w): WeaponRowView => {
    const r = parseRanges(w.ranges)
    const orphaned = sheet.locations[w.location].destroyed
    return {
      mountId: w.mountId, name: w.name, location: w.location, rear: w.rear, heat: w.heat, damage: w.damage, ...r,
      ammo: ammoFor(sheet, w.name), destroyed: w.destroyed && !orphaned, orphaned, fired: w.firedThisTurn,
    }
  })
}

// ---------- critical slots ----------
export interface CritSlotView { index: number; label: string; hit: boolean; destroyed: boolean; empty: boolean; ammo: boolean; shots: number | null }
export interface CritLocView { loc: Loc; slots: CritSlotView[]; destroyedLoc: boolean }

export function buildCrits(sheet: SheetView): CritLocView[] {
  const bins = new Map(sheet.ammo.map((b) => [b.binId, b]))
  return FRONT_LOCS.map((loc): CritLocView => ({
    loc,
    destroyedLoc: sheet.locations[loc].destroyed,
    slots: sheet.slots[loc].map((s, index): CritSlotView => {
      const id = s.token.startsWith('#') ? s.token.slice(1) : null
      const bin = id ? bins.get(id) : undefined
      const empty = s.token === 'empty' || s.label === 'empty'
      return {
        index, label: bin ? `${s.label} (${bin.shots})` : s.label, hit: s.hit, destroyed: s.destroyed || s.hit, empty,
        ammo: !!bin, shots: bin ? bin.shots : null,
      }
    }),
  }))
}

// ---------- movement points ----------
export interface MpView { kind: 'walk' | 'run' | 'jump'; current: number; base: number; reduced: boolean; text: string; trace: string }
export function buildMp(sheet: SheetView): MpView[] {
  const trace = modPhrases(sheet.mp.walkMods).join(', ')
  const row = (kind: MpView['kind'], current: number, base: number): MpView => {
    const reduced = current < base
    return { kind, current, base, reduced, text: reduced ? `${current} (${base})` : String(current), trace: reduced ? (trace || 'reduced') : '' }
  }
  return [row('walk', sheet.mp.walk, sheet.mp.baseWalk), row('run', sheet.mp.run, sheet.mp.baseRun), row('jump', sheet.mp.jump, sheet.mp.baseJump)]
}

// ---------- pilot ----------
export interface PilotBoxView { n: number; hit: boolean; tn: number | null }
export interface PilotView { name: string; skills: string; boxes: PilotBoxView[]; status: 'awake' | 'unconscious' | 'killed'; conscious: boolean }
export function buildPilot(sheet: SheetView, unit?: Pick<UnitState, 'pilot'>): PilotView {
  const p = sheet.pilot
  const dead = unit?.pilot.dead ?? p.hits >= 6
  // consciousnessTns[0] is the TN for 1 hit (engine); the sixth box is a kill
  const boxes = [1, 2, 3, 4, 5, 6].map((n): PilotBoxView => ({ n, hit: p.hits >= n, tn: n <= 5 && p.consciousnessTns[n - 1] ? p.consciousnessTns[n - 1]! : null }))
  return { name: p.name, skills: `G${p.gunnery}/P${p.piloting}`, boxes, status: dead ? 'killed' : p.conscious ? 'awake' : 'unconscious', conscious: p.conscious }
}

// ---------- header, sinks, status ----------
export function sheetHeader(sheet: SheetView): string {
  return `${sheet.name} · ${sheet.tonnage} t · BV ${sheet.adjustedBv}${sheet.adjustedBv !== sheet.bv ? ` (${sheet.bv} base)` : ''}`
}
export function sinkText(sheet: SheetView): string {
  const s = sheet.sinks
  const lost = s.count - s.operable
  return `${s.count} ${s.type}${lost > 0 ? ` · ${lost} destroyed` : ''} · sheds ${s.dissipation} per turn`
}
export function statusChips(sheet: SheetView, unit: Pick<UnitState, 'status' | 'crippled'>): string[] {
  const out: string[] = []
  const st = sheet.status
  if (unit.status !== 'active' && unit.status !== 'offBoard') out.push(STATUS_LABELS[unit.status])
  if (unit.status === 'offBoard') out.push('waiting off the board')
  if (unit.crippled) out.push('crippled')
  if (st.prone) out.push('prone')
  if (st.shutdown) out.push('shutdown')
  if (st.immobile) out.push('immobile')
  if (st.jumped) out.push('jumped')
  if (st.twist) out.push(`twisted ${st.twist < 0 ? 'left' : 'right'}`)
  if (st.flipped) out.push('arms flipped')
  return out
}

export const modsText = (mods: readonly Mod[]): string => modPhrases(mods).join(', ')
