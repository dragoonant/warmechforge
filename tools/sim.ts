// Headless bot-vs-bot sim (60-testing §4): `npm run sim -- --games N --seed S [--turnLimit 30] [--mission mission.intro]`.
// Random-tier bots on both sides; invariants after every step; save/load equality every 50 decisions; replay determinism at
// the end. Prints a short summary and writes tools/out/sim-<date>.json. Exit 1 on any violation or unfinished game.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadBundle } from '../src/data/index'
import type { Force, Mission } from '../src/data/index'
import type { GameEvent, GameSetup, GameState, StepResult } from '../src/engine/index'
import { createGame, deriveSeedString, hashState, legalActions, load, replay, save, step, view } from '../src/engine/index'
import { decideRandom } from '../src/ai/random'
import { checkState, checkStep } from './invariants'
import type { Violation } from './invariants'

const DECISION_CAP = 5000
const STALL_CAP = 200
const SAVE_EVERY = 50

export interface SimArgs { games: number; seed: string; turnLimit: number; mission: string; quiet?: boolean }
export interface GameReport {
  index: number
  seed: string
  finished: boolean
  winner: 'A' | 'B' | null
  reason: string
  turns: number
  decisions: number
  violations: (Violation & { last20?: string[] })[]
  counts: Record<string, number>
  ms: number
}

function parseArgs(argv: string[]): SimArgs {
  const get = (k: string, d: string): string => { const i = argv.indexOf(`--${k}`); return i >= 0 && argv[i + 1] ? argv[i + 1]! : d }
  return { games: Number(get('games', '10')), seed: get('seed', '1'), turnLimit: Number(get('turnLimit', '30')), mission: get('mission', 'mission.intro') }
}

export function introSetup(bundle: ReturnType<typeof loadBundle>, missionId: string, turnLimit: number): GameSetup {
  const mission = bundle.missions[missionId] as Mission
  const sides = mission.sides.map((s) => {
    const force = bundle.forces[s.force] as Force
    return { sideId: s.id, label: s.label, control: 'ai' as const, force: { id: force.id, name: force.name, units: force.units.map((u) => ({ ...u })) } }
  })
  return {
    missionId: mission.id, mapId: mission.map === 'choose' ? 'map.test-canyons' : mission.map, sides: [sides[0]!, sides[1]!],
    forcedWithdrawal: false, turnLimit, bvBudget: null,
  }
}

const COUNTED: GameEvent['type'][] = ['PhysicalDeclaredInMove', 'PhysicalDeclared', 'UnitFell', 'UnitShutdown', 'AmmoExploded', 'LocationDestroyed', 'UnitDestroyed', 'PilotKilled', 'CritSlotHit', 'StandAttempted', 'UnitDisplaced']

/** Progress key (INV-05). */
const progressKey = (s: GameState, dmg: number, psrRolls: number): string =>
  `${s.turn}|${s.phase}|${s.selection?.acted.length ?? 0}|${dmg}|${psrRolls}`

export async function playGame(bundle: ReturnType<typeof loadBundle>, setup: GameSetup, seed: string, index: number): Promise<GameReport & { final: GameState }> {
  const t0 = Date.now()
  const report: GameReport = { index, seed, finished: false, winner: null, reason: '', turns: 0, decisions: 0, violations: [], counts: {}, ms: 0 }
  const add = (vs: Violation[]): void => { for (const v of vs) if (report.violations.length < 20) report.violations.push({ ...v, last20: [] }) }
  let r: StepResult = createGame(setup, seed, bundle)
  if (r.rejection) { add([{ id: 'SETUP', seed, decisionSeq: 0, detail: r.rejection.message }]); return { ...report, final: r.state } }
  let s = r.state
  let dmg = 0, psrRolls = 0, stall = 0, lastKey = ''
  const recent: string[] = []
  while (s.pending.kind !== 'gameOver') {
    if (report.decisions >= DECISION_CAP) { add([{ id: 'INV-04', seed, decisionSeq: s.decisionSeq, detail: `over ${DECISION_CAP} decisions` }]); break }
    add(checkState(s, { fullLegal: report.decisions % 10 === 0 }))
    const legal = legalActions(s)
    if (legal.length === 0) break
    const action = decideRandom(view(s, s.pending.player), s.pending, legal, `${seed}|${s.pending.player}`)
    recent.push(`${s.pending.kind}:${JSON.stringify(action).slice(0, 160)}`)
    if (recent.length > 20) recent.shift()
    const next = step(s, action)
    report.decisions++
    const sv = checkStep(s, action, next)
    if (sv.length) { add(sv.map((x) => ({ ...x }))); for (const x of report.violations) if (!x.last20?.length) x.last20 = [...recent] }
    if (next.rejection) break
    for (const e of next.events) {
      if ((COUNTED as string[]).includes(e.type)) report.counts[e.type] = (report.counts[e.type] ?? 0) + 1
      if (e.type === 'DamageApplied') dmg += e.damage
      if (e.type === 'DiceRolled' && e.purpose === 'psr') psrRolls++
    }
    s = next.state
    const key = progressKey(s, dmg, psrRolls)
    if (key === lastKey) {
      if (++stall >= STALL_CAP) { add([{ id: 'INV-05', seed, decisionSeq: s.decisionSeq, detail: `no progress for ${STALL_CAP} decisions` }]); break }
    } else { stall = 0; lastKey = key }
    // INV-21: save/load mid-game
    if (report.decisions % SAVE_EVERY === 0) {
      const loaded = load(save(s), bundle)
      if (loaded.rejection) add([{ id: 'INV-21', seed, decisionSeq: s.decisionSeq, detail: `load rejected: ${loaded.rejection.message}` }])
      else if (hashState(loaded.state) !== hashState(s)) add([{ id: 'INV-21', seed, decisionSeq: s.decisionSeq, detail: 'save/load hash differs' }])
      else if (JSON.stringify(loaded.pending) !== JSON.stringify(s.pending)) add([{ id: 'INV-21', seed, decisionSeq: s.decisionSeq, detail: 'save/load pending differs' }])
    }
  }
  add(checkState(s))
  if (s.result) {
    report.finished = true
    report.winner = s.result.winner
    report.reason = s.result.reason
  }
  report.turns = s.turn
  // INV-20: replay determinism
  const rep = replay(setup, seed, bundle, s.log)
  if (rep.rejection) add([{ id: 'INV-20', seed, decisionSeq: s.decisionSeq, detail: `replay rejected: ${rep.rejection.message}` }])
  else if (hashState(rep.state) !== hashState(s)) add([{ id: 'INV-20', seed, decisionSeq: s.decisionSeq, detail: 'replay hash differs' }])
  report.ms = Date.now() - t0
  return { ...report, final: s }
}

export async function runSim(args: SimArgs): Promise<{ reports: GameReport[]; summary: string[] }> {
  const bundle = loadBundle()
  const setup = introSetup(bundle, args.mission, args.turnLimit)
  const reports: GameReport[] = []
  for (let i = 0; i < args.games; i++) {
    const seed = deriveSeedString(args.seed, 'sim', i)
    const { final: _f, ...rep } = await playGame(bundle, setup, seed, i)
    reports.push(rep)
    if (!args.quiet) process.stdout.write(rep.violations.length ? 'x' : rep.finished ? '.' : '?')
  }
  if (!args.quiet) process.stdout.write('\n')
  const finished = reports.filter((r) => r.finished)
  const wins: Record<string, number> = {}
  for (const r of finished) { const k = `${r.winner ?? 'draw'}:${r.reason}`; wins[k] = (wins[k] ?? 0) + 1 }
  const counts: Record<string, number> = {}
  for (const r of reports) for (const [k, n] of Object.entries(r.counts)) counts[k] = (counts[k] ?? 0) + n
  const violations = reports.flatMap((r) => r.violations)
  const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
  const decisions = reports.map((r) => r.decisions).sort((a, b) => a - b)
  const summary = [
    `games ${reports.length}, finished ${finished.length}, ended by turn limit ${finished.filter((r) => r.reason === 'turnLimitBV' || (r.reason === 'draw' && r.turns >= args.turnLimit)).length}`,
    `wins by cause: ${Object.entries(wins).map(([k, n]) => `${k} ${n}`).join(', ') || 'none'}`,
    `mean turns ${mean(finished.map((r) => r.turns)).toFixed(1)}, decisions p50 ${decisions[Math.floor(decisions.length / 2)] ?? 0} max ${decisions[decisions.length - 1] ?? 0}, mean ms/game ${mean(reports.map((r) => r.ms)).toFixed(0)}`,
    `events: ${Object.entries(counts).map(([k, n]) => `${k} ${n}`).join(', ')}`,
    `violations ${violations.length}`,
    ...violations.slice(0, 5).map((v) => `  ${v.id} seed ${v.seed} decision ${v.decisionSeq}: ${v.detail}`),
  ]
  return { reports, summary }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
if (isMain) {
  const args = parseArgs(process.argv.slice(2))
  const { reports, summary } = await runSim(args)
  for (const line of summary) console.log(line)
  const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'out')
  try {
    fs.mkdirSync(outDir, { recursive: true })
    const date = new Date().toISOString().slice(0, 10)
    fs.writeFileSync(path.join(outDir, `sim-${date}.json`), JSON.stringify({ args, summary, reports }, null, 1))
  } catch { /* the report file is optional */ }
  const bad = reports.some((r) => r.violations.length > 0 || !r.finished)
  process.exit(bad ? 1 : 0)
}
