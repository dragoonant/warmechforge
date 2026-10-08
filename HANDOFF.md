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
3. ElevenLabs key: the key in `WarMechForge\Tokens.txt` (same one Whirr used) now returns 401 "invalid API key", so no
   audio was generated. Please paste a fresh key into that file (`EL=sk_...`); SFX + voice (~2k credits) then run
   without asking, music (~12k) waits for your OK.
2. Rulings: `docs/needs-rules-check.md` has every judgement call (about 120 lines). Skim when convenient; a newer 2026
   rulebook would settle most of them.

Content: all 8 chassis (stock variants), the 4 Core Box maps, Skirmish any-vs-any

## Current state
- Engine: `src/engine/` (rules, queries, text). M5 added ferro-lamellor (damage.ts, 10 EQUIP-014: 1 point per 5 stopped while
  the struck armor stands; `DamageApplied.reduced`), the Clan targeting computer -1 for direct-fire weapons (ranged.ts, EQUIP-001)
  and Guardian ECM cancelling hostile Artemis IV (cluster.ts, EQUIP-015). LB-X slug/cluster ammo choice, the Ultra AC two-shot
  cluster and the Gauss crit explosion already worked and are now tested on the real roster (`tests/engine/equipment-m5.test.ts`).
  Stacking after a fall (MOVE-012) resolves when the fallen unit's move ends (movement.ts `resolveStacking`).
- Data: 16 'Mechs (two variants for each of the 8 Core Box chassis; unknown box variants are public stock stand-ins labelled
  "(stock)"), the 4 Core Box maps (Scorched Oasis, Arid Canyons, Headwater Crossing, Sodden Hills; layouts cross-checked with
  MegaMek boards) plus the dev map Test Canyons; the intro mission now plays on Scorched Oasis. Presets: Regent Lance, Mad Cat Lance.
- AI (M4): `src/ai/` utility decider, tiers random / easy / normal, in a Web Worker in the browser (3 s timeout, random-bot fallback).
- Client: start screen Skirmish has an any-vs-any picker (`ui/start/SkirmishPicker.tsx`, model in `startOptions.ts`): 1-4 'Mechs per
  side from every data 'Mech (chassis + variant dropdowns, "(stock)" labels, base BV), G/P skills per 'Mech (default 4/5), adjusted
  BV per pick and side totals, an Even BV button (moves the bot side's pilot skills), and the map list (4 Core Box maps, then the
  dev map). Hand-picked sides are sent as `NewGameOptions.lineups` and skip the 7500 BV budget (RULING).
- Tools: `npm run sim` and `npm run bench:ai` take `--map <id>` and `--forces A,B` (force ids or '+'-joined 'Mech ids) or
  `--forces random` (seeded 1-4 'Mechs per side from the whole roster, skirmish rules).
- Checks: `npm run typecheck`, `npm test` (46 files, 437 tests), `npm run validate:data`, `npm run sim -- --games 30 --seed 5` (also with
  `--forces random --map map.scorched-oasis`), `npm run bench:ai -- --games 10 --seed 2`, `PW_PORT=4183 npx playwright test`
  (play.spec + skirmish.spec; screenshots in `e2e-out/`, incl. `skirmish-setup.png` and `scorched-oasis.png`).

## Next
1. Owner playtest on Pages: Skirmish with any 'Mechs on the four Core Box maps; does the picker read well, is Even BV useful?
2. Equipment still unmodelled (all optional to use): PPC capacitor charge (Regent A), coolant pod (Regent A), Clan MASC sprint
   (Solitaire 2), other ECM effects. The fire panel and AI cannot fire an Ultra AC twice yet; previews and the AI ignore
   ferro-lamellor. List: `tools/out/m5-followups.md`.
3. M3 figure gate (Solitaire and Regent GLBs), then figures for the other six chassis.
4. Threat overlay (T), AI trace overlay, 40-ai §4.5 Monte Carlo refinement.

## Known gaps
- Only the Solitaire and the Regent have generated GLB figures; the other 'Mechs use procedural stand-ins.
- Unmodelled equipment above; skirmish turn-limit and withdrawal choices are not on the start screen yet.
- Water pools show the sea-bed steps between hexes of different depth through the surface; reads fine, could be softer.
- The camera follows the acting 'Mech only when it is off screen; there is no auto-camera for the bot's moves.
- Hook points other than initiative, toHit, attackRolled, crit and setup are not called yet; `choice` decisions
  (askDefender) are never raised (defaults decide).
