// Start-screen view model (pure, no React): the mission list, force rosters with tonnage and BV, the form and the
// NewGameOptions it builds. Names, tonnage and BV are DATA lookups (the data bundle through the store's setup module);
// nothing here is a rules number. Local adapter: contract.listForces() has no tonnage/BV, so we read the bundle here.
import {
  defaultControllers, listForces, listMaps, listMechs, listMissions, SPEED_PRESETS, type BotTier, type Controller, type ForceInfo, type MapInfo, type MechInfo,
  type MissionInfo, type NewGameOptions,
} from '../../contract'
import { adjustedBv } from '../../../data/index'
import { bundle } from '../../store/setup'

export type Side = 'A' | 'B'

export interface RosterRow { mechId: string; name: string; variant: string; chassis: string; tonnage: number; bv: number; stock: boolean; pilot: string | null }
export interface ForceView { id: string; name: string; color: string | null; rows: RosterRow[]; tonnage: number; bv: number }

/** One roster line as shown: "Eris ERS-2N (stock)". */
export function mechTitle(r: Pick<RosterRow, 'chassis' | 'variant' | 'stock'>): string {
  return `${r.chassis} ${r.variant}${r.stock ? ' (stock)' : ''}`.trim()
}

/** Roster of a force: name, variant, tonnage, BV and the "(stock)" flag straight from the 'Mech records. */
export function forceView(f: ForceInfo): ForceView {
  const b = bundle()
  const src = b.forces[f.id]
  const rows: RosterRow[] = f.units.map((u, i) => {
    const m = b.mechs[u.mech]
    const fu = src?.units[i]
    const p = fu?.pilot ? b.pilots[fu.pilot] : undefined
    const g = fu?.skills?.gunnery ?? p?.gunnery
    const pl = fu?.skills?.piloting ?? p?.piloting
    return {
      mechId: u.mech, name: u.name, chassis: m?.chassis ?? u.name, variant: m?.model ?? '', tonnage: m?.tonnage ?? 0, bv: m?.bv ?? 0,
      stock: m?.stock === true, pilot: g !== undefined && pl !== undefined ? `G${g}/P${pl}` : null,
    }
  })
  return { id: f.id, name: f.name, color: f.color, rows, tonnage: rows.reduce((a, r) => a + r.tonnage, 0), bv: rows.reduce((a, r) => a + r.bv, 0) }
}

export const formatBv = (n: number): string => n.toLocaleString('en-US')

/** What the opponent can be: the random bot or the utility AI (40-ai) at easy or normal. Default normal. */
export const OPPONENTS: readonly { id: BotTier; label: string; ready: boolean }[] = [
  { id: 'random', label: 'Random bot', ready: true },
  { id: 'easy', label: 'Easy AI', ready: true },
  { id: 'normal', label: 'Normal AI', ready: true },
]

/** Speed choices: values are the settings store's animation speeds (0 = instant). */
export const SPEED_CHOICES: readonly { value: number; label: string }[] = [
  { value: SPEED_PRESETS.slow, label: 'Slow' },
  { value: SPEED_PRESETS.normal, label: 'Normal' },
  { value: SPEED_PRESETS.fast, label: 'Fast' },
  { value: SPEED_PRESETS.faster, label: 'Faster' },
  { value: SPEED_PRESETS.instant, label: 'Skip animations' },
]

/** One hand-picked 'Mech of a skirmish side: the variant and its pilot skills. */
export interface MechPick { mech: string; gunnery: number; piloting: number }

export interface StartForm {
  mission: string
  /** Force ids per side [A, B]. */
  forces: [string, string]
  /** Who plays each side. Normal play: one human, one bot; bot vs bot lets you watch. */
  controllers: Record<Side, Controller>
  opponent: BotTier
  seed: string
  map: string | null
  /** Skirmish any-vs-any picks per side [A, B], 1-4 each. */
  picks: [MechPick[], MechPick[]]
}

/** The variants of one chassis, cheapest first. */
export interface ChassisGroup { chassis: string; variants: MechInfo[] }
export interface StartCatalogue { missions: MissionInfo[]; forces: ForceInfo[]; maps: MapInfo[]; mechs: MechInfo[]; chassis: ChassisGroup[] }
export function catalogue(): StartCatalogue {
  const mechs = listMechs()
  const chassis: ChassisGroup[] = []
  for (const m of mechs) {
    const g = chassis.find((c) => c.chassis === m.chassis)
    if (g) g.variants.push(m)
    else chassis.push({ chassis: m.chassis, variants: [m] })
  }
  return { missions: listMissions(), forces: listForces(), maps: listMaps(), mechs, chassis }
}

// ---------- skirmish any-vs-any picker ----------
export const MAX_PICKS = 4
/** Pilot skill choices (rows and columns of the BV skill table); default 4 / 5. */
export const SKILL_CHOICES: readonly number[] = [0, 1, 2, 3, 4, 5, 6, 7]
export const DEFAULT_SKILLS = { gunnery: 4, piloting: 5 } as const
/** Maps kept for development (hand-built stand-ins): listed last with a "(dev map)" label. */
export const DEV_MAPS: readonly string[] = ['map.test-canyons']
export const mapLabel = (m: MapInfo): string => (DEV_MAPS.includes(m.id) ? `${m.name} (dev map)` : m.name)

export const isSkirmish = (m: MissionInfo | undefined): boolean => m?.kind === 'skirmish'
/** Variant option text: "MDG-1B (stock)". */
export const variantLabel = (m: Pick<MechInfo, 'model' | 'stock'>): string => `${m.model}${m.stock ? ' (stock)' : ''}`
export const mechOf = (cat: StartCatalogue, id: string): MechInfo | undefined => cat.mechs.find((m) => m.id === id)

/** Adjusted BV of one pick (base BV x the skill multiplier, from the data tables). */
export function pickBv(cat: StartCatalogue, p: MechPick): number {
  const m = mechOf(cat, p.mech)
  if (!m) return 0
  try { return adjustedBv(bundle().tables, m.bv, p.gunnery, p.piloting) } catch { return m.bv }
}
export interface SideTotal { count: number; tonnage: number; bv: number }
export function sideTotal(cat: StartCatalogue, picks: readonly MechPick[]): SideTotal {
  return { count: picks.length, tonnage: picks.reduce((a, p) => a + (mechOf(cat, p.mech)?.tonnage ?? 0), 0), bv: picks.reduce((a, p) => a + pickBv(cat, p), 0) }
}

/** Starting picks: the Regent Lance against the Mad Cat Lance when the data has them, else the first 'Mechs; 4/5 pilots. */
export function defaultPicks(cat: StartCatalogue): [MechPick[], MechPick[]] {
  const fromForce = (id: string): MechPick[] => (cat.forces.find((f) => f.id === id)?.units ?? []).filter((u) => mechOf(cat, u.mech)).map((u) => ({ mech: u.mech, ...DEFAULT_SKILLS }))
  const a = fromForce('force.regent-lance'), b = fromForce('force.mad-cat-lance')
  const first = (n: number): MechPick[] => cat.mechs.slice(n, n + 1).map((m) => ({ mech: m.id, ...DEFAULT_SKILLS }))
  return [a.length ? a : first(0), b.length ? b : first(1)]
}

const sideIx = (side: Side): 0 | 1 => (side === 'A' ? 0 : 1)
function withPicks(form: StartForm, side: Side, picks: MechPick[]): StartForm {
  const all: [MechPick[], MechPick[]] = [form.picks[0], form.picks[1]]
  all[sideIx(side)] = picks
  return { ...form, picks: all }
}
/** Change one pick (variant or skills). */
export function setPick(form: StartForm, side: Side, i: number, patch: Partial<MechPick>): StartForm {
  const list = form.picks[sideIx(side)].map((p, n) => (n === i ? { ...p, ...patch } : p))
  return withPicks(form, side, list)
}
/** Switch a pick to another chassis: its first (cheapest) variant, skills kept. */
export function setChassis(form: StartForm, cat: StartCatalogue, side: Side, i: number, chassis: string): StartForm {
  const v = cat.chassis.find((c) => c.chassis === chassis)?.variants[0]
  return v ? setPick(form, side, i, { mech: v.id }) : form
}
/** Add a 'Mech (up to 4): the next chassis in the list after the side's last pick, 4/5 pilot. */
export function addPick(form: StartForm, cat: StartCatalogue, side: Side): StartForm {
  const list = form.picks[sideIx(side)]
  if (list.length >= MAX_PICKS || cat.chassis.length === 0) return form
  const last = list.length ? mechOf(cat, list[list.length - 1]!.mech)?.chassis : undefined
  const at = last ? cat.chassis.findIndex((c) => c.chassis === last) : -1
  const g = cat.chassis[(at + 1) % cat.chassis.length]!
  return withPicks(form, side, [...list, { mech: g.variants[0]!.id, ...DEFAULT_SKILLS }])
}
/** Remove a 'Mech (a side keeps at least one). */
export function removePick(form: StartForm, side: Side, i: number): StartForm {
  const list = form.picks[sideIx(side)]
  if (list.length <= 1) return form
  return withPicks(form, side, list.filter((_, n) => n !== i))
}

/** The side Even BV adjusts: the bot side when exactly one side is human, else side B. */
export function evenSide(form: StartForm): Side {
  if (form.controllers.A === 'human' && form.controllers.B !== 'human') return 'B'
  if (form.controllers.B === 'human' && form.controllers.A !== 'human') return 'A'
  return 'B'
}
const EVEN_GUNNERY: readonly number[] = [2, 3, 4, 5, 6]
const EVEN_PILOTING: readonly number[] = [3, 4, 5, 6, 7]
/**
 * Even BV: changes the pilot skills of one side (evenSide) one step at a time, always the step that brings its adjusted BV
 * closest to the other side's, until no step helps. Skills stay within gunnery 2-6 and piloting 3-7. Variants are not touched.
 */
export function evenBv(form: StartForm, cat: StartCatalogue): StartForm {
  const side = evenSide(form)
  const target = sideTotal(cat, form.picks[sideIx(side === 'A' ? 'B' : 'A')]).bv
  let picks = form.picks[sideIx(side)].map((p) => ({ ...p }))
  let gap = Math.abs(sideTotal(cat, picks).bv - target)
  for (let guard = 0; guard < 64; guard++) {
    let best: MechPick[] | null = null
    for (let i = 0; i < picks.length; i++) {
      for (const [k, opts] of [['gunnery', EVEN_GUNNERY], ['piloting', EVEN_PILOTING]] as const) {
        for (const d of [-1, 1]) {
          const v = picks[i]![k] + d
          if (!opts.includes(v)) continue
          const next = picks.map((p, n) => (n === i ? { ...p, [k]: v } : p))
          const g = Math.abs(sideTotal(cat, next).bv - target)
          if (g < gap) { gap = g; best = next }
        }
      }
    }
    if (!best) break
    picks = best
  }
  return withPicks(form, side, picks)
}

/** Force id a mission fixes for side index i, or null when the player picks. */
export function fixedForce(m: MissionInfo | undefined, i: 0 | 1): string | null {
  const f = m?.sides[i]?.force
  return f && f !== 'pick' ? f : null
}

/** Forces to start with for a mission: its fixed forces, a 'pick' side takes the first force not already used. */
export function defaultForces(m: MissionInfo | undefined, forces: readonly ForceInfo[]): [string, string] {
  const a = fixedForce(m, 0)
  const b = fixedForce(m, 1)
  const pickA = a ?? forces.find((f) => f.id !== b)?.id ?? forces[0]?.id ?? ''
  const pickB = b ?? forces.find((f) => f.id !== pickA)?.id ?? forces[0]?.id ?? ''
  return [pickA, pickB]
}

export function defaultForm(cat: StartCatalogue, missionId?: string): StartForm {
  const m = cat.missions.find((x) => x.id === missionId) ?? cat.missions.find((x) => x.ready) ?? cat.missions[0]
  const mission = m?.id ?? ''
  const controllers: Record<Side, Controller> = mission ? defaultControllers(mission) : { A: 'human', B: 'bot' }
  return { mission, forces: defaultForces(m, cat.forces), controllers, opponent: 'normal', seed: '', map: null, picks: defaultPicks(cat) }
}

/** Switch mission: forces, sides and map reset to that mission's; seed and opponent are kept. */
export function withMission(form: StartForm, cat: StartCatalogue, id: string): StartForm {
  const m = cat.missions.find((x) => x.id === id)
  if (!m || !m.ready) return form
  return { ...defaultForm(cat, id), seed: form.seed, opponent: form.opponent, picks: form.picks }
}

/** Maps a mission lets the player choose from (empty = fixed by the mission). */
export function mapChoices(m: MissionInfo | undefined, maps: readonly MapInfo[]): MapInfo[] {
  return m && m.map === 'choose' ? [...maps.filter((x) => !DEV_MAPS.includes(x.id)), ...maps.filter((x) => DEV_MAPS.includes(x.id))] : []
}

/** Sets a side's force; if both sides would hold the same force the other (unfixed) side moves to a different one. */
export function withForce(form: StartForm, cat: StartCatalogue, side: Side, id: string): StartForm {
  const i = side === 'A' ? 0 : 1
  const forces: [string, string] = [form.forces[0], form.forces[1]]
  forces[i] = id
  const o = 1 - i
  const m = cat.missions.find((x) => x.id === form.mission)
  if (forces[o] === id && !fixedForce(m, o as 0 | 1)) forces[o] = cat.forces.find((f) => f.id !== id)?.id ?? forces[o]
  return { ...form, forces }
}

/** Set one side's controller. */
export function withControl(form: StartForm, side: Side, c: Controller): StartForm {
  return { ...form, controllers: { ...form.controllers, [side]: c } }
}

/** Swap who plays which side. */
export function swapSides(form: StartForm): StartForm {
  return { ...form, controllers: { A: form.controllers.B, B: form.controllers.A } }
}

/** Heading of a force card: "Your force" / "Enemy force" when exactly one side is human, else "Force A" / "Force B". */
export function forceHeading(form: StartForm, side: Side): string {
  const other: Side = side === 'A' ? 'B' : 'A'
  const mine = form.controllers[side] === 'human'
  const theirs = form.controllers[other] === 'human'
  if (mine !== theirs) return mine ? 'Your force' : 'Enemy force'
  return side === 'A' ? 'Force A' : 'Force B'
}

/** Display order: your side first when exactly one side is human. */
export function sideOrder(form: StartForm): [Side, Side] {
  return form.controllers.A !== 'human' && form.controllers.B === 'human' ? ['B', 'A'] : ['A', 'B']
}

/** Seed text -> engine seed (blank = random, left to the engine). */
export function cleanSeed(raw: string): string | undefined {
  const s = raw.trim().slice(0, 40)
  return s === '' ? undefined : s
}

/** The NewGameOptions for the form (a skirmish sends its picks as lineups; `cat` tells which mission kind it is). */
export function buildStartOptions(form: StartForm, cat?: StartCatalogue): NewGameOptions {
  const seed = cleanSeed(form.seed)
  const skirmish = isSkirmish((cat ?? catalogue()).missions.find((m) => m.id === form.mission))
  const c = cat ?? catalogue()
  // picks that are exactly a preset lance keep that lance's name and colour, so the board says "Regent Lance", not "Blue Lance"
  const presetOf = (picks: readonly MechPick[]) => c.forces.find((f) => f.units.length === picks.length && [...f.units.map((u) => u.mech)].sort().join('|') === picks.map((x) => x.mech).sort().join('|'))
  const pa = presetOf(form.picks[0]), pb = presetOf(form.picks[1])
  const named = (preset: ReturnType<typeof presetOf>, other: ReturnType<typeof presetOf>) => (preset && preset !== other ? { name: preset.name, ...(preset.color ? { color: preset.color } : {}) } : {})
  const lineups: NonNullable<NewGameOptions['lineups']> = [
    { ...named(pa, pb), units: form.picks[0].map((p) => ({ ...p })) }, { ...named(pb, pa), units: form.picks[1].map((p) => ({ ...p })) },
  ]
  return {
    mission: form.mission,
    ...(skirmish ? { lineups } : { forces: [form.forces[0], form.forces[1]] as [string, string] }),
    ...(form.map ? { map: form.map } : {}),
    controllers: { A: form.controllers.A, B: form.controllers.B },
    bot: { tier: form.opponent },
    ...(seed ? { seed } : {}),
  }
}

/** One-line summary of an autosave for the Continue button. */
export function continueSummary(s: { turn: number; scenario: string; map: string; forces: [string, string] } | null | undefined): string {
  if (!s) return ''
  return `${s.scenario} on ${s.map}, turn ${Math.max(1, s.turn)}: ${s.forces[0]} vs ${s.forces[1]}`
}
