// AI bench (40-ai §15): `npm run bench:ai -- --games N --seed S [--pairs normal:random,normal:easy] [--turnLimit 30]`
// [--map map.x[,map.y...] | all] [--forces A,B[;C,D...] | random] [--withdrawal] (as in tools/sim.ts; --forces switches to the
// skirmish mission). Several maps and/or force pairs make a sweep: every pair of tiers plays N games on each (map, forces) cell.
// --withdrawal turns forced withdrawal on (11 §3).
// Plays each pair on the intro mission with sides alternated (the first tier plays side A in even games, side B in odd
// games). Prints wins by cause, mean turns, mean and p95 ms per AI decision, rejections, stalls and fallbacks, and writes
// tools/out/bench-<date>.json. Exit 1 when any game has a rejection, stall, decision-cap hit, fallback or unhandled kind.
// It also audits every AI move for the two M7 playtest majors (M8): a move that ends with no shot at anything while a reachable
// hex had one, and a move that leaves its rear to a live enemy (already moved, with a legal shot) while a helpless enemy (prone
// with a leg gone, crippled or unconscious) is on the board.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadBundle } from '../src/data/index'
import type { Action, GameState, PlayerId, ReachEntry, StepResult, Twist, UnitId } from '../src/engine/index'
import { createGame, deriveSeedString, legalActions, query, step, view } from '../src/engine/index'
import { decideAi } from '../src/ai/decider'
import { decideRandom } from '../src/ai/random'
import { customSetup, randomForces } from './sim'

type Tier = 'random' | 'easy' | 'normal'
const DECISION_CAP = 5000
const STALL_CAP = 200

interface Args { games: number; seed: string; turnLimit: number; pairs: [Tier, Tier][]; mission: string; quiet: boolean; map?: string; forces?: string; withdrawal?: boolean }
/** Core Box maps (`--map all`). */
const ALL_MAPS = ['map.scorched-oasis', 'map.arid-canyons', 'map.headwater-crossing', 'map.sodden-hills']
function parseArgs(argv: string[]): Args {
  const get = (k: string, d: string): string => { const i = argv.indexOf(`--${k}`); return i >= 0 && argv[i + 1] ? argv[i + 1]! : d }
  const pairs = get('pairs', get('pair', 'normal:random,normal:easy')).split(',').map((p) => p.split(':') as [Tier, Tier])
  const forces = get('forces', ''), map = get('map', '')
  const mission = get('mission', forces ? 'mission.skirmish' : 'mission.intro')
  return { games: Number(get('games', '20')), seed: get('seed', '1'), turnLimit: Number(get('turnLimit', '30')), pairs, mission, quiet: argv.includes('--quiet'), ...(map ? { map } : {}), ...(forces ? { forces } : {}), ...(argv.includes('--withdrawal') ? { withdrawal: true } : {}) }
}

interface GameOut {
  index: number; seed: string; tierA: Tier; tierB: Tier; winnerTier: Tier | 'draw' | null; winner: PlayerId | null; reason: string; turns: number
  decisions: number; rejections: number; stall: boolean; engineErrors: string[]; capHit: boolean; fallbacks: string[]; unhandled: string[]
  ms: number[]; msByKind: Record<string, number[]>; shutdowns: Record<PlayerId, number>; ammoExplosions: Record<PlayerId, number>
  /** M7 majors audit, per tier: AI moves checked, no-shot moves, rear left to a live threat beside a helpless enemy. */
  audit: Record<string, { moves: number; noShot: number; cooling: number; backToThreat: number }>
}

const onBoard = (s: GameState, id: UnitId): boolean => { const u = s.units[id]!; return !!u.pos && (u.status === 'active' || u.status === 'withdrawing') }
const helpless = (s: GameState, id: UnitId): boolean => {
  const u = s.units[id]!
  return !u.pilot.conscious || u.crippled || (u.prone && (u.locs.LL.destroyed || u.locs.RL.destroyed))
}
function hasShot(s: GameState, me: UnitId, e: ReachEntry, enemies: UnitId[]): boolean {
  for (const tw of [0, -1, 1] as Twist[]) {
    for (const mountId of Object.keys(s.units[me]!.mounts)) {
      for (const t of enemies) {
        const pv = query.attackPreview(s, { attackerId: me, mountId, targetId: t, attackerAt: { hex: e.hex, facing: e.facing, mode: e.mode, hexesMoved: e.hexesMoved, jumped: e.mode === 'jump', twist: tw } })
        if (pv.legal && pv.pHit > 0) return true
      }
    }
  }
  return false
}
/** Checks one AI move against the two M7 majors (outside the timed decision). */
function auditMove(s: GameState, me: UnitId, action: Action, a: { moves: number; noShot: number; cooling: number; backToThreat: number }): void {
  if (action.type !== 'move') return
  const u = s.units[me]!
  if (u.status === 'withdrawing') return
  const key = JSON.stringify(action)
  let reach: ReachEntry[] = []
  try { reach = query.reachable(s, me) } catch { return }
  let e = reach.find((x) => JSON.stringify(x.action) === key)
  if (!e) { try { e = query.reachable(s, me, { masc: true }).find((x) => JSON.stringify(x.action) === key) } catch { /* none */ } }
  if (!e || e.physical || e.endsProne) return
  a.moves++
  const enemies = s.unitOrder.filter((id) => s.units[id]!.owner !== u.owner && onBoard(s, id))
  if (!hasShot(s, me, e, enemies) && reach.some((x) => !x.physical && !x.endsProne && hasShot(s, me, x, enemies))) {
    a.noShot++
    if (u.heat >= 10) a.cooling++ // a hot unit breaking contact to cool down (its affordable shots are small)
  }
  if (!enemies.some((id) => helpless(s, id))) return
  for (const id of enemies) {
    if (helpless(s, id) || !s.units[id]!.move.done) continue
    for (const mountId of Object.keys(s.units[id]!.mounts)) {
      const pv = query.attackPreview(s, { attackerId: id, mountId, targetId: me, targetAt: { hex: e.hex, facing: e.facing, hexesMoved: e.hexesMoved, jumped: e.mode === 'jump' } })
      if (pv.legal && pv.direction === 'rear') { a.backToThreat++; return }
    }
  }
}

function playOne(bundle: ReturnType<typeof loadBundle>, args: Args, tiers: Record<PlayerId, Tier>, seed: string, index: number): GameOut {
  const forces: [string, string] | null = args.forces === 'random' ? randomForces(bundle, args.seed, index) : args.forces ? (args.forces.split(',') as [string, string]) : null
  const setup = customSetup(bundle, args, forces)
  if (args.withdrawal) setup.forcedWithdrawal = true
  const out: GameOut = {
    index, seed, tierA: tiers.A, tierB: tiers.B, winnerTier: null, winner: null, reason: 'unfinished', turns: 0, decisions: 0, rejections: 0,
    stall: false, capHit: false, engineErrors: [], fallbacks: [], unhandled: [], ms: [], msByKind: {}, shutdowns: { A: 0, B: 0 }, ammoExplosions: { A: 0, B: 0 },
    audit: {},
  }
  let r: StepResult = createGame(setup, seed, bundle)
  let s: GameState = r.state
  let lastKey = '', stall = 0, dmg = 0
  while (s.pending.kind !== 'gameOver') {
    if (out.decisions >= DECISION_CAP) { out.capHit = true; break }
    const p = s.pending
    const legal = legalActions(s)
    if (!legal.length) { out.engineErrors.push(`empty legalActions at ${p.id} (${p.kind} ${p.unitId ?? ''})`); break }
    const tier = tiers[p.player]
    let action: Action
    if (tier === 'random') {
      action = decideRandom(view(s, p.player), p, legal, `${seed}|${p.player}`)
    } else {
      const t0 = performance.now()
      action = decideAi(view(s, p.player), p, legal, {
        tier, onEvent: (kind, detail) => { (kind === 'fallback' ? out.fallbacks : out.unhandled).push(`${p.kind}:${detail}`) },
      }).action
      const dt = performance.now() - t0
      out.ms.push(dt)
      ;(out.msByKind[p.kind] ??= []).push(dt)
      if (p.kind === 'move' && p.unitId) auditMove(s, p.unitId, action, (out.audit[tier] ??= { moves: 0, noShot: 0, cooling: 0, backToThreat: 0 }))
    }
    const next = step(s, action)
    out.decisions++
    if (next.rejection) {
      out.rejections++
      // keep the game going with the first legal answer so one bad answer does not hide the rest of the game
      const again = step(s, legal[0]!)
      if (again.rejection) break
      r = again
    } else r = next
    for (const e of r.events) {
      if (e.type === 'DamageApplied') dmg += e.damage
      if (e.type === 'UnitShutdown') { const u = s.units[e.unitId]; if (u && (e as { cause?: string }).cause !== 'voluntary') out.shutdowns[u.owner]++ }
      if (e.type === 'AmmoExploded') { const u = s.units[e.unitId]; if (u && (e as { cause?: string }).cause === 'heat') out.ammoExplosions[u.owner]++ }
    }
    s = r.state
    const key = `${s.turn}|${s.phase}|${s.selection?.acted.length ?? 0}|${dmg}|${s.decisionSeq}`
    if (key === lastKey) { if (++stall >= STALL_CAP) { out.stall = true; break } } else { stall = 0; lastKey = key }
  }
  out.turns = s.turn
  if (s.result) {
    out.winner = s.result.winner
    out.reason = s.result.reason
    out.winnerTier = s.result.winner ? tiers[s.result.winner] : 'draw'
  }
  return out
}

const pct = (xs: number[], p: number): number => { if (!xs.length) return 0; const a = [...xs].sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.floor(p * a.length))]! }
const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)

/** The (map, forces) cells of a sweep: --map a,b or all, --forces "A,B;C,D". One cell when neither lists more than one. */
export function benchCells(args: Args): Args[] {
  const maps: (string | undefined)[] = args.map === 'all' ? ALL_MAPS : args.map ? args.map.split(',').filter(Boolean) : [undefined]
  const forces: (string | undefined)[] = args.forces ? args.forces.split(';').filter(Boolean) : [undefined]
  const out: Args[] = []
  for (const m of maps) for (const f of forces) {
    const { map: _m, forces: _f, ...rest } = args
    out.push({ ...rest, ...(m ? { map: m } : {}), ...(f ? { forces: f } : {}) })
  }
  return out
}

/** One line per (cell, pair) for the sweep table. */
export interface BenchRow { cell: string; pair: string; games: number; wins: number; losses: number; draws: number; p95: number; max: number; bad: number }

export function runBench(args: Args): { games: GameOut[]; summary: string[]; rows: BenchRow[]; bad: boolean } {
  const bundle = loadBundle()
  const games: GameOut[] = []
  const summary: string[] = []
  const rows: BenchRow[] = []
  let bad = false
  const cells = benchCells(args)
  for (const cell of cells) {
    const label = `${cell.map ?? '(mission map)'} | ${cell.forces ?? cell.mission}`
    if (cells.length > 1) summary.push(`== ${label}`)
    const r = runCell(bundle, cell, label)
    games.push(...r.games); summary.push(...r.summary); rows.push(...r.rows)
    if (r.bad) bad = true
  }
  if (cells.length > 1) {
    summary.push('== sweep')
    for (const r of rows) summary.push(`  ${r.cell} | ${r.pair}: ${r.wins}/${r.games} (losses ${r.losses}, draws ${r.draws}), p95 ${r.p95.toFixed(0)} ms, max ${r.max.toFixed(0)} ms, rejections+stalls+fallbacks ${r.bad}`)
  }
  return { games, summary, rows, bad }
}

function runCell(bundle: ReturnType<typeof loadBundle>, args: Args, label: string): { games: GameOut[]; summary: string[]; rows: BenchRow[]; bad: boolean } {
  const games: GameOut[] = []
  const summary: string[] = []
  const rows: BenchRow[] = []
  let bad = false
  for (const [x, y] of args.pairs) {
    const pairGames: GameOut[] = []
    for (let i = 0; i < args.games; i++) {
      const seed = deriveSeedString(args.seed, 'bench', i)
      const tiers: Record<PlayerId, Tier> = i % 2 === 0 ? { A: x, B: y } : { A: y, B: x }
      const g = playOne(bundle, args, tiers, seed, i)
      pairGames.push(g)
      if (!args.quiet) process.stdout.write(g.winnerTier === x ? 'W' : g.winnerTier === y ? 'L' : g.winnerTier === 'draw' ? 'd' : '?')
    }
    if (!args.quiet) process.stdout.write('\n')
    games.push(...pairGames)
    const wins = pairGames.filter((g) => g.winnerTier === x).length
    const losses = pairGames.filter((g) => g.winnerTier === y).length
    const causes: Record<string, number> = {}
    for (const g of pairGames) { const k = `${g.winnerTier ?? 'unfinished'}:${g.reason}`; causes[k] = (causes[k] ?? 0) + 1 }
    const ms = pairGames.flatMap((g) => g.ms)
    const rej = pairGames.reduce((n, g) => n + g.rejections, 0)
    const stalls = pairGames.filter((g) => g.stall || g.capHit).length
    const fb = pairGames.reduce((n, g) => n + g.fallbacks.length, 0)
    const un = pairGames.reduce((n, g) => n + g.unhandled.length, 0)
    const engineErr = pairGames.reduce((n, g) => n + g.engineErrors.length, 0)
    const asX = (g: GameOut): PlayerId => (g.tierA === x ? 'A' : 'B')
    const shut = pairGames.reduce((n, g) => n + g.shutdowns[asX(g)], 0)
    const boom = pairGames.reduce((n, g) => n + g.ammoExplosions[asX(g)], 0)
    const winsAsA = pairGames.filter((g) => g.winnerTier === x && g.tierA === x && g.winner === 'A').length
    const sideA = pairGames.filter((g) => g.winner === 'A').length
    const sideB = pairGames.filter((g) => g.winner === 'B').length
    const decided = pairGames.filter((g) => g.winner !== null).length
    summary.push(
      x === y
        ? `${x} vs ${y} (mirror): side A wins ${sideA}, side B wins ${sideB}, draws/unfinished ${pairGames.length - decided}`
        : `${x} vs ${y}: ${x} wins ${wins}/${pairGames.length} (as A ${winsAsA}, as B ${wins - winsAsA}), losses ${losses}, draws/unfinished ${pairGames.length - wins - losses}; side A wins ${sideA}, side B ${sideB}`,
      `  wins by cause: ${Object.entries(causes).map(([k, n]) => `${k} ${n}`).join(', ')}`,
      `  mean turns ${mean(pairGames.map((g) => g.turns)).toFixed(1)}; AI ms/decision mean ${mean(ms).toFixed(1)} p95 ${pct(ms, 0.95).toFixed(1)} max ${pct(ms, 1).toFixed(1)} (${ms.length} decisions)`,
      `  rejections ${rej}, stalls ${stalls}, fallbacks ${fb}, unhandled ${un}, engine errors ${engineErr}; ${x} heat shutdowns ${shut}, heat ammo explosions ${boom}`,
    )
    const aud = pairGames.reduce((n, g) => { const v = g.audit[x]; if (v) { n.moves += v.moves; n.noShot += v.noShot; n.cooling += v.cooling; n.backToThreat += v.backToThreat } return n }, { moves: 0, noShot: 0, cooling: 0, backToThreat: 0 })
    if (x !== 'random') summary.push(`  M7 majors audit (${x}): ${aud.moves} moves, no-shot moves ${aud.noShot} (${aud.cooling} by units at heat 10+), rear to a live threat beside a helpless enemy ${aud.backToThreat}`)
    for (const g of pairGames) for (const f of [...g.engineErrors, ...g.fallbacks, ...g.unhandled].slice(0, 3)) summary.push(`    game ${g.index}: ${f}`)
    const kinds = [...new Set(pairGames.flatMap((g) => Object.keys(g.msByKind)))].sort()
    summary.push(`  ms by kind (p50/p95/max): ${kinds.map((k) => { const xs = pairGames.flatMap((g) => g.msByKind[k] ?? []); return `${k} ${pct(xs, 0.5).toFixed(0)}/${pct(xs, 0.95).toFixed(0)}/${pct(xs, 1).toFixed(0)}` }).join(', ')}`)
    if (rej || stalls || fb || un || engineErr) bad = true
    const mirror = x === y
    rows.push({
      cell: label, pair: `${x}:${y}`, games: pairGames.length, wins: mirror ? sideA : wins, losses: mirror ? sideB : losses,
      draws: pairGames.length - (mirror ? decided : wins + losses), p95: pct(ms, 0.95), max: pct(ms, 1), bad: rej + stalls + fb + un + engineErr,
    })
  }
  return { games, summary, rows, bad }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
if (isMain) {
  const args = parseArgs(process.argv.slice(2))
  const { games, summary, rows, bad } = runBench(args)
  for (const line of summary) console.log(line)
  try {
    const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'out')
    fs.mkdirSync(outDir, { recursive: true })
    const date = new Date().toISOString().slice(0, 10)
    fs.writeFileSync(path.join(outDir, `bench-${date}.json`), JSON.stringify({ args, summary, rows, games: games.map(({ ms, msByKind: _k, ...g }) => ({ ...g, msMean: mean(ms), msMax: pct(ms, 1) })) }, null, 1))
  } catch { /* the report file is optional */ }
  process.exit(bad ? 1 : 0)
}
