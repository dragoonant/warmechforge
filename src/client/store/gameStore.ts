// GameRunner (50 §1, §3): the true engine state and THE ONLY CALLER OF engine.step in the client.
// Every answer (human click, bot, test hook) goes through dispatch(); events are numbered, kept in a ring buffer,
// and handed to the presentation director as one batch per step.
import { create } from 'zustand'
import {
  EngineInvariantError, createGame, legalActions, load as engineLoad, save as engineSave, step,
  type Action, type GameEvent, type GameState, type Loc, type PendingDecision, type PlayerId, type RejectionCode, type SaveFile, type UnitId,
} from '../../engine/index'
import { enqueueBatch, resetPresentation } from '../presentation/director'
import type { SeqEvent } from '../presentation/beats'
import { buildSetup, bundle, defaultControllers, type BotTier, type Controller, type NewGameOptions } from './setup'
import { getStorage, readJson, writeJson } from './storage'
import { ui } from './uiStore'

export type { BotTier, Controller, NewGameOptions }

export interface BotConfig { tier: BotTier; seed: string }

export interface ClientRejection {
  code: RejectionCode | 'E_CLIENT'
  /** Player-facing text, our words. */
  text: string
  /** The engine's own message (for the log / tooltips). */
  detail: string
  action: Action | null
  at: number
  id: number
}

export type DispatchSource = 'human' | 'bot' | 'test' | 'watchdog'

export const EVENT_LOG_LIMIT = 2000

/** Running per-side tallies for the end screen (sums of event numbers; no rules). */
export interface SideStats { damageDealt: number; damageTaken: number; heatPeak: number }

/** Running per-'Mech tallies for the end screen's mini sheets: damage taken per location, damage dealt, kills, heat peak. */
export interface UnitTally { dealt: number; taken: number; byLoc: Partial<Record<Loc, number>>; kills: number; heatPeak: number; lastHitBy: UnitId | null }
export type UnitTallies = Record<UnitId, UnitTally>
const blankTally = (): UnitTally => ({ dealt: 0, taken: 0, byLoc: {}, kills: 0, heatPeak: 0, lastHitBy: null })

export interface GameStoreState {
  /** True engine state (NOT what the screen shows: render from the presented store). */
  state: GameState | null
  pending: PendingDecision | null
  controllers: Record<PlayerId, Controller>
  bot: BotConfig
  /** Ring buffer of the last EVENT_LOG_LIMIT events with their seq numbers. */
  events: SeqEvent[]
  /** Seq of the newest event (0 before any). */
  eventSeq: number
  lastRejection: ClientRejection | null
  /** Set when the engine threw (an engine bug); the game stops accepting answers until a new game or load. */
  fatal: string | null
  /** Increments on every accepted step and on new game / load. */
  version: number
  /** The options the game was started with (Play again reuses them with a new seed); null after a bare load. */
  options: NewGameOptions | null
  stats: Record<PlayerId, SideStats>
  /** Per-'Mech tallies (additive, polish pass). */
  unitStats: UnitTallies
}

const ZERO_STATS = (): Record<PlayerId, SideStats> => ({ A: { damageDealt: 0, damageTaken: 0, heatPeak: 0 }, B: { damageDealt: 0, damageTaken: 0, heatPeak: 0 } })

const INITIAL: GameStoreState = {
  state: null, pending: null, controllers: { A: 'human', B: 'bot' }, bot: { tier: 'random', seed: 'bot' },
  events: [], eventSeq: 0, lastRejection: null, fatal: null, version: 0, options: null, stats: ZERO_STATS(), unitStats: {},
}

export const useGameStore = create<GameStoreState>(() => ({ ...INITIAL, stats: ZERO_STATS(), unitStats: {} }))

// ---------- legal actions, cached per state object ----------
const legalCache = new WeakMap<GameState, Action[]>()
/** Legal answers to the state's open decision (cached; the engine validates every one). */
export function legalFor(state: GameState | null): Action[] {
  if (!state) return []
  const hit = legalCache.get(state)
  if (hit) return hit
  let out: Action[] = []
  try { out = state.pending.kind === 'gameOver' ? [] : legalActions(state) } catch { out = [] }
  legalCache.set(state, out)
  return out
}

// ---------- rejection text (our words; typed Record: every engine code needs a line) ----------
const REJECTION_TEXT: Record<RejectionCode, string> = {
  E_WRONG_DECISION: 'That does not answer the current question.',
  E_NOT_YOUR_DECISION: 'It is not your decision to make.',
  E_NOT_AN_OPTION: 'That choice is not available right now.',
  E_BAD_PAYLOAD: 'That order could not be read.',
  E_BAD_SETUP: 'The battle could not be set up with those choices.',
  E_DATA_VERSION: 'This save was made with different game data and cannot be loaded.',
  E_GAME_OVER: 'The battle is over.',
  E_UNKNOWN_UNIT: "That 'Mech is not in this battle.",
  E_NOT_YOUR_UNIT: "That 'Mech is not yours.",
  E_NOT_ELIGIBLE: "That 'Mech cannot act now.",
  E_SHUTDOWN: "That 'Mech is shut down.",
  E_UNCONSCIOUS: 'That pilot is unconscious.',
  E_OFF_BOARD: 'That is off the map.',
  E_BAD_FACING: 'That facing is not allowed.',
  E_PROHIBITED_HEX: "A 'Mech cannot enter that hex.",
  E_OCCUPIED: 'That hex is taken.',
  E_NOT_ENOUGH_MP: 'Not enough movement points.',
  E_BAD_MODE: 'That movement mode is not available.',
  E_NO_BACKWARD: 'It cannot move backward there.',
  E_LEVEL_CHANGE: 'The level change is too steep.',
  E_PRONE: "A prone 'Mech cannot do that.",
  E_CANNOT_STAND: 'It cannot stand up now.',
  E_CANNOT_JUMP: 'It cannot jump now.',
  E_JUMP_TOO_HIGH: 'That jump is too high.',
  E_BAD_ENTRY: 'It must enter from its home edge.',
  E_EXIT_EDGE: 'It cannot leave the map there.',
  E_WITHDRAWAL: 'A withdrawing unit must head for its edge.',
  E_NO_TWIST: 'It cannot twist its torso now.',
  E_UNKNOWN_WEAPON: 'That weapon is not on this unit.',
  E_WEAPON_DESTROYED: 'That weapon is destroyed.',
  E_WEAPON_USED: 'That weapon has already fired this turn.',
  E_DUPLICATE: 'That weapon is already in the plan.',
  E_OUT_OF_ARC: 'The target is out of that weapon’s arc.',
  E_OUT_OF_RANGE: 'The target is out of range.',
  E_NO_LOS: 'No line of sight.',
  E_WATER_LINE: 'No attack across the water line.',
  E_FRIENDLY_TARGET: 'That is a friendly unit.',
  E_TN_TOO_HIGH: 'That shot has no chance to hit.',
  E_NO_AMMO: 'No ammunition left.',
  E_WRONG_AMMO: 'That ammunition does not fit.',
  E_PRIMARY_TARGET: 'The first target must be in the front arc when any target is.',
  E_AIMED_SHOT: 'An aimed shot is not possible here.',
  E_NO_RANGED: 'It cannot make ranged attacks now.',
  E_PROP_ARM: 'It cannot prop on that arm.',
  E_RAPID_MODE: 'That firing mode is not available.',
  E_NOT_ADJACENT: 'The target is not adjacent.',
  E_LEVEL_DIFF: 'The height difference is too great.',
  E_LIMB_UNAVAILABLE: 'That limb cannot attack.',
  E_ATTACK_LIMIT: 'No more attacks this turn.',
  E_NO_PHYSICAL: 'It cannot make a physical attack now.',
  E_BAD_TARGET: 'Not a valid target.',
}
export function rejectionText(code: RejectionCode | 'E_CLIENT'): string {
  return code === 'E_CLIENT' ? 'That is not possible right now.' : REJECTION_TEXT[code] ?? 'That is not allowed.'
}

let rejectionSeq = 0
function reject(code: ClientRejection['code'], detail: string, action: Action | null, text?: string): ClientRejection {
  const r: ClientRejection = { code, text: text ?? rejectionText(code), detail, action, at: Date.now(), id: ++rejectionSeq }
  useGameStore.setState({ lastRejection: r })
  return r
}

// ---------- internals ----------
function randomSeed(): string { return Math.random().toString(36).slice(2, 10) }

function tally(stats: Record<PlayerId, SideStats>, state: GameState, events: readonly GameEvent[]): Record<PlayerId, SideStats> {
  let out: Record<PlayerId, SideStats> | null = null
  const edit = () => (out ??= { A: { ...stats.A }, B: { ...stats.B } })
  const owner = (id: UnitId | null | undefined): PlayerId | null => (id ? state.units[id]?.owner ?? null : null)
  for (const e of events) {
    if (e.type === 'DamageApplied') {
      const taken = e.armorBefore - e.armorAfter + (e.structureBefore - e.structureAfter)
      const victim = owner(e.unitId), by = owner(e.sourceUnitId)
      if (taken > 0 && victim) edit()[victim].damageTaken += taken
      if (taken > 0 && by && by !== victim) edit()[by].damageDealt += taken
    } else if (e.type === 'HeatApplied') {
      const o = owner(e.unitId)
      if (o && e.after > (out ?? stats)[o].heatPeak) edit()[o].heatPeak = e.after
    }
  }
  return out ?? stats
}

/** Per-'Mech tallies: damage per location (armor + internal removed), damage dealt, kills (credited to the last 'Mech to hurt the victim), heat peak. */
function tallyUnits(prev: UnitTallies, events: readonly GameEvent[]): UnitTallies {
  let out: UnitTallies | null = null
  const cur = (id: UnitId): UnitTally | undefined => (out ?? prev)[id]
  const edit = (id: UnitId): UnitTally => {
    out ??= { ...prev }
    const c = out[id] ?? blankTally()
    const n = { ...c, byLoc: { ...c.byLoc } }
    out[id] = n
    return n
  }
  for (const e of events) {
    if (e.type === 'DamageApplied') {
      const taken = e.armorBefore - e.armorAfter + (e.structureBefore - e.structureAfter)
      if (taken <= 0) continue
      const v = edit(e.unitId)
      v.taken += taken
      v.byLoc[e.location] = (v.byLoc[e.location] ?? 0) + taken
      if (e.sourceUnitId && e.sourceUnitId !== e.unitId) { v.lastHitBy = e.sourceUnitId; edit(e.sourceUnitId).dealt += taken }
    } else if (e.type === 'HeatApplied') {
      if (e.after > (cur(e.unitId)?.heatPeak ?? 0)) edit(e.unitId).heatPeak = e.after
    } else if (e.type === 'UnitDestroyed' && e.effective) {
      const by = cur(e.unitId)?.lastHitBy
      if (by) edit(by).kills += 1
    }
  }
  return out ?? prev
}

function pushEvents(events: readonly GameEvent[]): { seqEvents: SeqEvent[]; first: number; last: number } {
  const s = useGameStore.getState()
  let seq = s.eventSeq
  const seqEvents = events.map((event) => ({ seq: ++seq, event }))
  return { seqEvents, first: s.eventSeq + 1, last: seq }
}

function commitStep(before: GameState, after: GameState, events: readonly GameEvent[], extra: Partial<GameStoreState> = {}): void {
  const { seqEvents, first, last } = pushEvents(events)
  const s = useGameStore.getState()
  useGameStore.setState({
    ...extra,
    state: after,
    pending: after.pending,
    events: seqEvents.length ? [...s.events, ...seqEvents].slice(-EVENT_LOG_LIMIT) : s.events,
    eventSeq: last,
    version: s.version + 1,
    stats: tally(s.stats, after, events),
    unitStats: tallyUnits(s.unitStats, events),
  })
  enqueueBatch({ firstSeq: first, lastSeq: seqEvents.length ? last : s.eventSeq, before, after, events: seqEvents })
}

function startFrom(state: GameState, events: readonly GameEvent[], controllers: Record<PlayerId, Controller>, bot: BotConfig, options: NewGameOptions | null, animate: boolean): void {
  useGameStore.setState({ ...INITIAL, stats: ZERO_STATS(), unitStats: {}, controllers, bot, options, version: useGameStore.getState().version + 1 })
  ui.reset()
  if (animate) {
    resetPresentation(state, 0)
    commitStep(state, state, events)
  } else {
    const { seqEvents, last } = pushEvents(events)
    // A loaded game keeps its history: feed, dice log and end-screen tallies come from the replayed events.
    useGameStore.setState({
      state, pending: state.pending, events: seqEvents.slice(-EVENT_LOG_LIMIT), eventSeq: last,
      stats: tally(ZERO_STATS(), state, events), unitStats: tallyUnits({}, events),
    })
    resetPresentation(state, last, seqEvents)
  }
}

// ---------- public actions ----------
/** Start a new game. Returns the rejection when the setup is refused (the old game stays). */
export function newGame(opts: NewGameOptions): ClientRejection | null {
  const controllers: Record<PlayerId, Controller> = { ...defaultControllers(opts.mission), ...(opts.controllers ?? {}) }
  const seed = opts.seed ?? randomSeed()
  let r
  try {
    r = createGame(buildSetup(opts, controllers), seed, bundle())
  } catch (e) {
    return reject('E_BAD_SETUP', e instanceof Error ? e.message : String(e), null)
  }
  if (r.rejection) return reject(r.rejection.code, r.rejection.message, null)
  const bot: BotConfig = { tier: opts.bot?.tier ?? 'random', seed }
  startFrom(r.state, r.events, controllers, bot, { ...opts, seed }, true)
  return null
}

/** Same setup AND the same seed (end screen "Rematch with same forces": the dice stream starts over, so a different plan shows). */
export function rematch(): ClientRejection | null {
  const s = useGameStore.getState()
  if (!s.options) return reject('E_CLIENT', 'no previous setup', null, 'Start a new battle from the start screen.')
  return newGame({ ...s.options, controllers: s.controllers, bot: { tier: s.bot.tier } })
}

/** Same setup, new seed (end screen "Play again"). */
export function playAgain(): ClientRejection | null {
  const s = useGameStore.getState()
  if (!s.options) return reject('E_CLIENT', 'no previous setup', null, 'Start a new battle from the start screen.')
  const { seed: _old, ...rest } = s.options
  return newGame({ ...rest, controllers: s.controllers, bot: { tier: s.bot.tier } })
}

/**
 * Answer the open decision. `source` 'human' is refused (client-side) when the decision belongs to a bot.
 * Returns null when accepted, else the rejection (also stored in lastRejection).
 */
export function dispatch(action: Action, source: DispatchSource = 'human'): ClientRejection | null {
  const s = useGameStore.getState()
  if (!s.state) return reject('E_CLIENT', 'no game', action, 'Start a battle first.')
  if (s.fatal) return reject('E_CLIENT', s.fatal, action, 'The game hit an internal error; load a save or start again.')
  const pd = s.state.pending
  if (source === 'human' && pd.kind !== 'gameOver' && s.controllers[pd.player] !== 'human') return reject('E_NOT_YOUR_DECISION', `decision ${pd.id} belongs to the bot (${pd.player})`, action)
  let r
  try {
    r = step(s.state, action)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (e instanceof EngineInvariantError) useGameStore.setState({ fatal: msg })
    return reject('E_CLIENT', msg, action, 'The game hit an internal error.')
  }
  if (r.rejection) return reject(r.rejection.code, r.rejection.message, action)
  if (r.state === s.state && !r.events.length) return null // gameOver ack: nothing changes
  commitStep(s.state, r.state, r.events, s.lastRejection ? { lastRejection: null } : {})
  return null
}

/** An action for the open decision built from its payload (decisionId and player filled in). */
export type ActionPayload = Action extends infer A ? (A extends Action ? Omit<A, 'decisionId' | 'player'> : never) : never
export function actionFor(payload: ActionPayload): Action | null {
  const pd = useGameStore.getState().state?.pending
  if (!pd) return null
  return { ...payload, decisionId: pd.id, player: pd.player } as Action
}

export function clearRejection(): void { if (useGameStore.getState().lastRejection) useGameStore.setState({ lastRejection: null }) }

export function setController(player: PlayerId, c: Controller): void {
  useGameStore.setState((s) => ({ controllers: { ...s.controllers, [player]: c } }))
}

export function isHumanDecision(s: GameStoreState = useGameStore.getState()): boolean {
  return !!s.pending && s.pending.kind !== 'gameOver' && s.controllers[s.pending.player] === 'human'
}
export function isBotDecision(s: GameStoreState = useGameStore.getState()): boolean {
  return !!s.pending && s.pending.kind !== 'gameOver' && s.controllers[s.pending.player] === 'bot'
}

// ---------- save / load (50 §15) ----------
export const AUTOSAVE_KEY = 'wmf.autosave'
export const SAVE_PREFIX = 'wmf.save.'
/** Client save format version; bump when ClientSave changes shape. */
export const CLIENT_SAVE_VERSION = 1

/** What we store: the engine SaveFile (setup + seed + action log) plus who controls each side. */
export interface ClientSave { kind: 'wmf-save'; v: 1; file: SaveFile; controllers: Record<PlayerId, Controller>; bot: BotConfig; options: NewGameOptions | null }
export interface SaveSummary { turn: number; scenario: string; map: string; forces: [string, string] }
/** The autosave slot (50 §15). `version` = client save version + data bundle version: Continue only when it matches. */
export interface AutosaveSlot { version: string; savedAt: string; summary: SaveSummary; save: ClientSave }

export function saveVersion(): string { return `${CLIENT_SAVE_VERSION}:${bundle().version}` }

export function exportSave(label = ''): ClientSave | null {
  const s = useGameStore.getState()
  if (!s.state) return null
  return { kind: 'wmf-save', v: 1, file: engineSave(s.state, label, new Date().toISOString()), controllers: s.controllers, bot: s.bot, options: s.options }
}

function summaryOf(state: GameState): SaveSummary {
  const b = bundle()
  return {
    turn: state.turn,
    scenario: b.missions[state.setup.missionId]?.name ?? state.setup.missionId,
    map: b.maps[state.setup.mapId]?.name ?? state.setup.mapId,
    forces: [state.setup.sides[0].force.name, state.setup.sides[1].force.name],
  }
}

const isClientSave = (x: unknown): x is ClientSave => !!x && typeof x === 'object' && (x as ClientSave).kind === 'wmf-save'
const isSaveFile = (x: unknown): x is SaveFile => !!x && typeof x === 'object' && Array.isArray((x as SaveFile).actions) && !!(x as SaveFile).setup

/** Load a ClientSave or a bare engine SaveFile (controllers then stay as they are). No replay animation. */
export function importSave(data: unknown): ClientRejection | null {
  const file = isClientSave(data) ? data.file : isSaveFile(data) ? data : null
  if (!file) return reject('E_BAD_PAYLOAD', 'not a save file', null)
  let r
  try { r = engineLoad(file, bundle()) } catch (e) { return reject('E_CLIENT', e instanceof Error ? e.message : String(e), null, 'That save could not be loaded.') }
  if (r.rejection) return reject(r.rejection.code, r.rejection.message, null)
  const cur = useGameStore.getState()
  const controllers = isClientSave(data) ? data.controllers : cur.controllers
  const bot = isClientSave(data) ? data.bot : { ...cur.bot, seed: file.seed }
  startFrom(r.state, r.events, controllers, bot, isClientSave(data) ? data.options : null, false)
  return null
}

/** Write the autosave slot now (also called by installAutosave each turn). */
export function autosave(): boolean {
  const s = useGameStore.getState()
  const save = exportSave('Autosave')
  if (!s.state || !save) return false
  const slot: AutosaveSlot = { version: saveVersion(), savedAt: save.file.meta.savedAt, summary: summaryOf(s.state), save }
  writeJson(AUTOSAVE_KEY, slot)
  return true
}

/** The autosave slot when its version matches (Continue shows only then); else null. */
export function readAutosave(): AutosaveSlot | null {
  const slot = readJson<AutosaveSlot>(AUTOSAVE_KEY)
  if (!slot || typeof slot !== 'object' || slot.version !== saveVersion() || !isClientSave(slot.save)) return null
  return slot
}
export function hasAutosave(): boolean { return readAutosave() !== null }
export function clearAutosave(): void { getStorage().removeItem(AUTOSAVE_KEY) }

/** Continue from the autosave. A load failure deletes the slot and returns the rejection (show it as a toast). */
export function continueGame(): ClientRejection | null {
  const slot = readAutosave()
  if (!slot) { clearAutosave(); return reject('E_CLIENT', 'no autosave', null, 'There is no saved battle to continue.') }
  const rej = importSave(slot.save)
  if (rej) { clearAutosave(); return { ...rej, text: `The saved battle could not be loaded and was removed. ${rej.text}` } }
  return null
}

/** Named slots (download/upload and manual saves). */
export function saveGame(slot: string, label = ''): boolean {
  const data = exportSave(label)
  if (!data) return false
  writeJson(SAVE_PREFIX + slot, data)
  return true
}
export function loadGame(slot: string): ClientRejection | null {
  const data = readJson<unknown>(SAVE_PREFIX + slot)
  if (!data) return reject('E_CLIENT', `no save in slot ${slot}`, null, 'No saved battle there.')
  return importSave(data)
}

/**
 * Autosave once per turn (after the End phase: when the turn number advances) and clear the slot when the battle
 * ends. Installed by bootClient. Returns an unsubscribe.
 */
export function installAutosave(): () => void {
  let lastTurn = useGameStore.getState().state?.turn ?? -1
  let lastVersion = useGameStore.getState().version
  return useGameStore.subscribe((s) => {
    const st = s.state
    if (!st || s.version === lastVersion) return
    lastVersion = s.version
    if (st.pending.kind === 'gameOver') { clearAutosave(); lastTurn = st.turn; return }
    if (st.turn === lastTurn) return
    lastTurn = st.turn
    if (st.turn >= 1) autosave()
  })
}

/** Tests: forget the current game entirely. */
export function resetGameStore(): void {
  useGameStore.setState({ ...INITIAL, stats: ZERO_STATS(), unitStats: {} })
  resetPresentation(null, 0)
  ui.reset()
}
