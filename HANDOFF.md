# Handoff

## Morning summary (owner)
M3 is in: WarMechForge is playable on Pages (https://dragoonant.github.io/warmechforge/). Start the Intro Mission against the
random bot, then walk, run or jump your two 'Mechs, pick facings, twist torsos, fire with the live heat sum and every target
number explained, and kick or punch at close range, until one side is down. The board sits on a table in a little game shop
(Settings > Surroundings switches to a plain dark surround). Screenshots of a played game are in `e2e-out/` (local).

## Current state
- Engine: `src/engine/` (rules, queries, text). One small M3 fix: the reach set no longer offers moves that end in an
  occupied hex. Opponent: `src/ai/random.ts`, loaded lazily by `src/client/bot/botDriver.ts`.
- Client: `src/client/` (see STATUS M3). `GameScreen.tsx` composes the board, figures, overlays, VFX, the shop and the HUD.
  Camera keys: right-drag orbit, middle-drag / WASD pan, wheel zoom, 1 top-down, 2 home edge, 3 follow, 0 overview.
- URL hooks: `?test=1` (window.__game), `?scenario=intro&control=human,bot&seed=7&speed=4`, `?gallery`, `?fps`.
- Checks: `npm run typecheck`, `npm test`, `npm run validate:data`, `npm run sim -- --games 50 --seed 1`,
  `PW_PORT=4183 npx playwright test tests/e2e/play.spec.ts` (uses the GPU on Windows; about 1 minute).

## Next
1. Owner playtest: what reads badly, what is slow, what is confusing. Fix list goes to `tools/out/m3-followups.md`.
2. M3 figure gate: review the two generated figures (`?gallery`) and the height proposal in `docs/spec/30-figures.md` §2;
   the other slice 'Mechs still use the procedural stand-in.
3. M4: utility AI per `docs/spec/40-ai.md`, run in a worker; threat overlay (T).

## Known gaps
- The bot is the random tier (sensible but not clever).
- Only the Solitaire and the Regent have generated GLB figures; the other 'Mechs use procedural stand-ins.
- Water pools show the sea-bed steps between hexes of different depth through the surface; reads fine, could be softer.
- The camera follows the acting 'Mech only when it is off screen; there is no auto-camera for the bot's moves.
- Hook points other than initiative, toHit, attackRolled, crit and setup are not called yet; `choice` decisions
  (askDefender) are never raised (defaults decide).
