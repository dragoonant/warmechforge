// Start-screen view model (pure, no React): the mission list, force rosters with tonnage and BV, the form and the
// NewGameOptions it builds. Names, tonnage and BV are DATA lookups (the data bundle through the store's setup module);
// nothing here is a rules number. Local adapter: contract.listForces() has no tonnage/BV, so we read the bundle here.
import { defaultControllers, listForces, listMaps, listMissions, SPEED_PRESETS, type BotTier, type Controller, type ForceInfo, type MapInfo, type MissionInfo, type NewGameOptions } from '../../contract'
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

export interface StartForm {
  mission: string
  /** Force ids per side [A, B]. */
  forces: [string, string]
  /** Who plays each side. Normal play: one human, one bot; bot vs bot lets you watch. */
  controllers: Record<Side, Controller>
  opponent: BotTier
  seed: string
  map: string | null
}

export interface StartCatalogue { missions: MissionInfo[]; forces: ForceInfo[]; maps: MapInfo[] }
export function catalogue(): StartCatalogue { return { missions: listMissions(), forces: listForces(), maps: listMaps() } }

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
  return { mission, forces: defaultForces(m, cat.forces), controllers, opponent: 'normal', seed: '', map: null }
}

/** Switch mission: forces, sides and map reset to that mission's; seed and opponent are kept. */
export function withMission(form: StartForm, cat: StartCatalogue, id: string): StartForm {
  const m = cat.missions.find((x) => x.id === id)
  if (!m || !m.ready) return form
  return { ...defaultForm(cat, id), seed: form.seed, opponent: form.opponent }
}

/** Maps a mission lets the player choose from (empty = fixed by the mission). */
export function mapChoices(m: MissionInfo | undefined, maps: readonly MapInfo[]): MapInfo[] {
  return m && m.map === 'choose' ? [...maps] : []
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

/** The NewGameOptions for the form. */
export function buildStartOptions(form: StartForm): NewGameOptions {
  const seed = cleanSeed(form.seed)
  return {
    mission: form.mission,
    forces: [form.forces[0], form.forces[1]],
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
