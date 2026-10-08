// Start-screen catalogue (missions, forces, maps from the data bundle) and the GameSetup builder. Data lookups only:
// no rules. Mission defaults (map, forces, withdrawal, BV budget, turn limit) come from the mission record.
import { loadBundle, type Force, type GameMap, type Mission, type TypedBundle } from '../../data/index'
import type { GameSetup, Id, PlayerId } from '../../engine/index'

let cached: TypedBundle | null = null
/** The data bundle, built once per page. */
export function bundle(): TypedBundle {
  cached ??= loadBundle()
  return cached
}

export type Controller = 'human' | 'bot'
/** Bot tiers: 'random' (src/ai/random.ts) and the utility AI at 'easy' / 'normal' (src/ai/decider.ts, M4). */
export type BotTier = 'random' | 'easy' | 'normal'
export const BOT_TIERS: readonly BotTier[] = ['random', 'easy', 'normal']

export interface NewGameOptions {
  /** Mission id, e.g. 'mission.intro' (short names like 'intro' are accepted). */
  mission: Id
  /** Force per side [A, B]; default: the mission's forces (a 'pick' side takes the first force not already used). */
  forces?: [Id, Id]
  /** Map id; default: the mission's map (or its first choice / the first map for 'choose'). */
  map?: Id
  /** Who plays each side; default: the mission's defaultHumanSide is human, the other a bot. */
  controllers?: Partial<Record<PlayerId, Controller>>
  bot?: { tier?: BotTier }
  /** Engine seed; random when omitted. */
  seed?: string
  /** null = no limit. Default: the mission's turnLimit, else none. */
  turnLimit?: number | null
  /** Default: the mission's option ('on' = true, 'off' / 'playerChoice' = false). */
  forcedWithdrawal?: boolean
}

export interface MissionInfo { id: Id; name: string; kind: Mission['kind']; briefing: string; ready: boolean; order: number; sides: { label: string; force: Id | 'pick' }[]; map: Id | 'choose' }
export interface ForceInfo { id: Id; name: string; color: string | null; units: { mech: Id; name: string }[] }
export interface MapInfo { id: Id; name: string; theme: GameMap['theme'] }

/** Missions, ready ones first, by order. */
export function listMissions(): MissionInfo[] {
  return Object.values(bundle().missions)
    .map((m: Mission): MissionInfo => ({
      id: m.id, name: m.name, kind: m.kind, briefing: m.briefing ?? '', ready: (m.status ?? 'ready') === 'ready', order: m.order ?? 99,
      sides: m.sides.map((s) => ({ label: s.label, force: s.force })), map: m.map,
    }))
    .sort((a, b) => Number(b.ready) - Number(a.ready) || a.order - b.order || a.name.localeCompare(b.name))
}

export function listForces(): ForceInfo[] {
  const mechs = bundle().mechs
  return Object.values(bundle().forces).map((f: Force) => ({
    id: f.id, name: f.name, color: f.color ?? null,
    units: f.units.map((u) => {
      const m = mechs[u.mech]
      return { mech: u.mech, name: u.name ?? (m ? `${m.chassis} ${m.model}` : u.mech) }
    }),
  }))
}

export function listMaps(): MapInfo[] {
  return Object.values(bundle().maps).map((m: GameMap) => ({ id: m.id, name: m.name, theme: m.theme }))
}

/** 'intro' -> 'mission.intro'; unknown ids come back unchanged (createGame then refuses them). */
export function resolveMissionId(v: string): Id {
  const ms = bundle().missions
  if (ms[v]) return v
  if (ms[`mission.${v}`]) return `mission.${v}`
  return v
}
export function resolveForceId(v: string): Id {
  const fs = bundle().forces
  if (fs[v]) return v
  if (fs[`force.${v}`]) return `force.${v}`
  return v
}
export function resolveMapId(v: string): Id {
  const ms = bundle().maps
  if (ms[v]) return v
  if (ms[`map.${v}`]) return `map.${v}`
  return v
}

/** Default controllers for a mission: its defaultHumanSide (else side A) is human. */
export function defaultControllers(missionId: Id): Record<PlayerId, Controller> {
  const m = bundle().missions[resolveMissionId(missionId)]
  const humanIdx = m ? Math.max(0, m.sides.findIndex((s) => s.id === (m.defaultHumanSide ?? m.sides[0].id))) : 0
  return humanIdx === 1 ? { A: 'bot', B: 'human' } : { A: 'human', B: 'bot' }
}

/** Build the engine GameSetup. Throws Error with our words when the mission/force/map is unknown. */
export function buildSetup(opts: NewGameOptions, controllers: Record<PlayerId, Controller>): GameSetup {
  const b = bundle()
  const missionId = resolveMissionId(opts.mission)
  const mission = b.missions[missionId]
  if (!mission) throw new Error(`unknown mission ${opts.mission}`)
  const used = new Set<Id>()
  const allForces = Object.keys(b.forces)
  const forceIds = mission.sides.map((s, i) => {
    const want = opts.forces?.[i]
    const id = want ? resolveForceId(want) : s.force !== 'pick' ? s.force : allForces.find((f) => !used.has(f)) ?? allForces[0]
    if (!id || !b.forces[id]) throw new Error(`unknown force ${want ?? s.force}`)
    used.add(id)
    return id
  })
  const mapId = opts.map ? resolveMapId(opts.map) : mission.map !== 'choose' ? mission.map : mission.mapChoices?.[0] ?? Object.keys(b.maps)[0]
  if (!mapId || !b.maps[mapId]) throw new Error(`unknown map ${opts.map ?? mission.map}`)
  const players: PlayerId[] = ['A', 'B']
  const sides = mission.sides.map((s, i) => {
    const f = b.forces[forceIds[i]!]!
    return {
      sideId: s.id, label: s.force === 'pick' ? f.name : s.label, control: controllers[players[i]!] === 'human' ? ('human' as const) : ('ai' as const),
      force: { id: f.id, name: f.name, ...(f.color ? { color: f.color } : {}), units: f.units.map((u) => ({ ...u })) },
    }
  })
  return {
    missionId, mapId, sides: [sides[0]!, sides[1]!],
    forcedWithdrawal: opts.forcedWithdrawal ?? mission.options.forcedWithdrawal === 'on',
    turnLimit: opts.turnLimit !== undefined ? opts.turnLimit : mission.turnLimit ?? null,
    bvBudget: mission.options.bvBudget ?? null,
  }
}
