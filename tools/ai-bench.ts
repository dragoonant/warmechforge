// AI bench (40-ai §15): `npm run bench:ai -- --games N --seed S [--pairs normal:random,normal:easy] [--turnLimit 30]`
// [--map map.x] [--forces A,B | random] (as in tools/sim.ts; --forces switches to the skirmish mission).
// Plays each pair on the intro mission with sides alternated (the first tier plays side A in even games, side B in odd
// games). Prints wins by cause, mean turns, mean and p95 ms per AI decision, rejections, stalls and fallbacks, and writes
// tools/out/bench-<date>.json. Exit 1 when any game has a rejection, stall, decision-cap hit, fallback or unhandled kind.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadBundle } from '../src/data/index'
import type { Action, GameState, PlayerId, StepResult } from '../src/engine/index'
import { createGame, deriveSeedString, legalActions, step, view } from '../src/engine/index'
import { decideAi } from '../src/ai/decider'
import { decideRandom } from '../src/ai/random'
import { customSetup, randomForces } from './sim'

type Tier = 'random' | 'easy' | 'normal'
const DECISION_CAP = 5000
const STALL_CAP = 200

interface Args { games: number; seed: string; turnLimit: number; pairs: [Tier, Tier][]; mission: string; quiet: boolean; map?: string; forces?: string }
function parseArgs(argv: string[]): Args {
  const get = (k: string, d: string): string => { const i = argv.indexOf(`--${k}`); return i >= 0 && argv[i + 1] ? argv[i + 1]! : d }
  const pairs = get('pairs', get('pair', 'normal:random,normal:easy')).split(',').map((p) => p.split(':') as [Tier, Tier])
  const forces = get('forces', ''), map = get('map', '')
  const mission = get('mission', forces ? 'mission.skirmish' : 'mission.intro')
  return { games: Number(get('games', '20')), seed: get('seed', '1'), turnLimit: Number(get('turnLimit', '30')), pairs, mission, quiet: argv.includes('--quiet'), ...(map ? { map } : {}), ...(forces ? { forces } : {}) }
}

interface GameOut {
  index: number; seed: string; tierA: Tier; tierB: Tier; winnerTier: Tier | 'draw' | null; winner: PlayerId | null; reason: string; turns: number
  decisions: number; rejections: number; stall: boolean; engineErrors: string[]; capHit: boolean; fallbacks: string[]; unhandled: string[]
  ms: number[]; msByKind: Record<string, number[]>; shutdowns: Record<PlayerId, number>; ammoExplosions: Record<PlayerId, number>
}

function playOne(bundle: ReturnType<typeof loadBundle>, args: Args, tiers: Record<PlayerId, Tier>, seed: string, index: number): GameOut {
  const forces: [string, string] | null = args.forces === 'random' ? randomForces(bundle, args.seed, index) : args.forces ? (args.forces.split(',') as [string, string]) : null
  const setup = customSetup(bundle, args, forces)
  const out: GameOut = {
    index, seed, tierA: tiers.A, tierB: tiers.B, winnerTier: null, winner: null, reason: 'unfinished', turns: 0, decisions: 0, rejections: 0,
    stall: false, capHit: false, engineErrors: [], fallbacks: [], unhandled: [], ms: [], msByKind: {}, shutdowns: { A: 0, B: 0 }, ammoExplosions: { A: 0, B: 0 },
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

export function runBench(args: Args): { games: GameOut[]; summary: string[]; bad: boolean } {
  const bundle = loadBundle()
  const games: GameOut[] = []
  const summary: string[] = []
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
    const winsAsA = pairGames.filter((g) => g.winnerTier === x && g.tierA === x).length
    summary.push(
      `${x} vs ${y}: ${x} wins ${wins}/${pairGames.length} (as A ${winsAsA}, as B ${wins - winsAsA}), losses ${losses}, draws/unfinished ${pairGames.length - wins - losses}`,
      `  wins by cause: ${Object.entries(causes).map(([k, n]) => `${k} ${n}`).join(', ')}`,
      `  mean turns ${mean(pairGames.map((g) => g.turns)).toFixed(1)}; AI ms/decision mean ${mean(ms).toFixed(1)} p95 ${pct(ms, 0.95).toFixed(1)} max ${pct(ms, 1).toFixed(1)} (${ms.length} decisions)`,
      `  rejections ${rej}, stalls ${stalls}, fallbacks ${fb}, unhandled ${un}, engine errors ${engineErr}; ${x} heat shutdowns ${shut}, heat ammo explosions ${boom}`,
    )
    for (const g of pairGames) for (const f of [...g.engineErrors, ...g.fallbacks, ...g.unhandled].slice(0, 3)) summary.push(`    game ${g.index}: ${f}`)
    const kinds = [...new Set(pairGames.flatMap((g) => Object.keys(g.msByKind)))].sort()
    summary.push(`  ms by kind (p50/p95/max): ${kinds.map((k) => { const xs = pairGames.flatMap((g) => g.msByKind[k] ?? []); return `${k} ${pct(xs, 0.5).toFixed(0)}/${pct(xs, 0.95).toFixed(0)}/${pct(xs, 1).toFixed(0)}` }).join(', ')}`)
    if (rej || stalls || fb || un || engineErr) bad = true
  }
  return { games, summary, bad }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
if (isMain) {
  const args = parseArgs(process.argv.slice(2))
  const { games, summary, bad } = runBench(args)
  for (const line of summary) console.log(line)
  try {
    const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'out')
    fs.mkdirSync(outDir, { recursive: true })
    const date = new Date().toISOString().slice(0, 10)
    fs.writeFileSync(path.join(outDir, `bench-${date}.json`), JSON.stringify({ args, summary, games: games.map(({ ms, msByKind: _k, ...g }) => ({ ...g, msMean: mean(ms), msMax: pct(ms, 1) })) }, null, 1))
  } catch { /* the report file is optional */ }
  process.exit(bad ? 1 : 0)
}
