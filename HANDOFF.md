# Handoff

## Morning summary (owner)
M3 is in: WarMechForge is playable on Pages (https://dragoonant.github.io/warmechforge/). Start the Intro Mission against the
random bot, then walk, run or jump your two 'Mechs, pick facings, twist torsos, fire with the live heat sum and every target
number explained, and kick or punch at close range, until one side is down. The board sits on a table in a little game shop
(Settings > Surroundings switches to a plain dark surround). Screenshots of a played game are in `e2e-out/` (local).
M4 (utility AI in a worker, easy/normal tiers) is running/next; see Current state.

Data notes: the box's new variants (Solitaire 3, Rakshasa MDG-3D, Hollander BZK-W4, Vulture E...) have no public stats yet
(Sarna, MegaMek, MUL checked 2026-10-08; only BVs known), so the slice uses stock Solitaire Prime and Rakshasa MDG-1A,
labelled "(stock)". Mapsheets are 16 x 17 hexes (MegaMek boards and AGoAC agree; the brief said 15 x 17).

Questions:
1. Figure gate: do the Solitaire and Regent look right (`art/figure-sheets/bt-solitaire.png`, `bt-regent.png`, and the
   torso-twist / arm-loss sheets `*-split.png`; in game: `?gallery`)? Proportions are close to the real sculpts, only
   lightly stylised. Approve, or say "chunkier" / "more stylised", and I'll make the other six to match.
2. Rulings: `docs/needs-rules-check.md` has every judgement call (about 120 lines). Skim when convenient; a newer 2026
   rulebook would settle most of them.

## Current state
- Engine: `src/engine/` (rules, queries, text). One small M3 fix: the reach set no longer offers moves that end in an
  occupied hex.
- AI (M4): `src/ai/` utility decider (40-ai) with tiers random / easy / normal (`tiers.ts`, tuning in `tune.ts`). In the
  browser easy/normal run in a Web Worker (`src/ai/worker.ts`, `src/client/bot/aiWorkerClient.ts`, 3 s timeout, random-bot
  fallback); `botDriver.ts` loads the AI lazily and its 5 s watchdog counts only time with no presentation progress. Start
  screen opponent defaults to Normal AI. Bench (seed 1, 20 games): normal beats random 19/20, normal vs easy 12/20, 0
  rejections / stalls / fallbacks, decision p95 ~80 ms.
- Client: `src/client/` (see STATUS M3). `GameScreen.tsx` composes the board, figures, overlays, VFX, the shop and the HUD.
  Camera keys: right-drag orbit, middle-drag / WASD pan, wheel zoom, 1 top-down, 2 home edge, 3 follow, 0 overview.
- URL hooks: `?test=1` (window.__game), `?scenario=intro&control=human,bot&seed=7&speed=4`, `?gallery`, `?fps`.
- Checks: `npm run typecheck`, `npm test`, `npm run validate:data`, `npm run sim -- --games 50 --seed 1`,
  `npm run bench:ai -- --games 20 --seed 1`, `PW_PORT=4183 npx playwright test tests/e2e/play.spec.ts` (uses the GPU on
  Windows; about 1 minute; fails on any AiFallback or watchdog force-answer).

## Next
1. Owner playtest against the normal AI: what reads badly, what is slow, what is confusing, is the AI fair and fun.
   Fix list goes to `tools/out/m4-followups.md`.
2. M3 figure gate: review the two generated figures (`?gallery`) and the height proposal in `docs/spec/30-figures.md` §2;
   the other slice 'Mechs still use the procedural stand-in.
3. Threat overlay (T) and an AI trace overlay in the client (the decider already returns a top-3 trace); 40-ai §4.5 Monte
   Carlo refinement; normal vs easy is 12/20 (the report target), worth more tuning later.

## Known gaps
- The AI has no Monte Carlo pKill refinement and no client trace/threat overlay yet; normal only edges easy (12/20).
- Only the Solitaire and the Regent have generated GLB figures; the other 'Mechs use procedural stand-ins.
- Water pools show the sea-bed steps between hexes of different depth through the surface; reads fine, could be softer.
- The camera follows the acting 'Mech only when it is off screen; there is no auto-camera for the bot's moves.
- Hook points other than initiative, toHit, attackRolled, crit and setup are not called yet; `choice` decisions
  (askDefender) are never raised (defaults decide).
