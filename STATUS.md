# Status

## M0 done (specs and frozen contracts)
- Scaffold: Vite + React 19 + three.js r3f + zustand, hello page, GitHub repo, Pages deploy from `main`.
- Specs in `docs/spec/`:
  - `00-architecture.md`: engine shape, state, phases, damage/PSR pipelines, queries, change log (§14).
  - `10-rules-core.md`: BattleTech Classic rules (AGoAC + 2026 changelog), numbered rule IDs.
  - `11-missions.md`: intro mission, skirmish, deployment, crippled/withdrawal/victory.
  - `12-rules-test-checklist.md`: test IDs that engine tests must use as names.
  - `13-golden.md`: forced-dice worked examples (GOLD-001..).
  - `20-data-schema.md` + `schemas/*.schema.json`: 'Mech, weapon, ammo, equipment, pilot, SPA, map,
    mission, force and table data.
  - `30-figures.md`, `40-ai.md`, `50-client.md`, `60-testing.md`, `70-maps.md`.
- Frozen engine contracts (additive changes only, logged in 00 §14):
  `src/engine/{types,actions,events,hooks,rng,decider,index}.ts`. Tests: `tests/engine/rng.test.ts`.
- `docs/needs-rules-check.md`: every RULING made so far (later lines supersede earlier ones).
- Not yet: rules engine logic, game data, client game screens, AI, figures, maps.
- Follow-ups by work package: `tools/out/m0-followups.md` (local, not committed).

## M1 done (engine math and slice data)
- Engine modules in `src/engine/`: hex, terrain, los, dice, tohit, hitloc, cluster, damage, crits, ammo, heat, psr, pilot, prob. Tests in `tests/engine/` named by checklist ID.
- Data in `src/data/`: core tables, weapons, ammo, equipment, SPAs, four slice 'Mechs, pilots, intro and skirmish missions, forces, stand-in map test-canyons. `tests/data/data.test.ts`, `npm run validate:data` (tools/validate-data.ts).
- typecheck, 164 tests and validate:data pass.
- Open (after M2): spec 10 partial wing rule needs updating; stand-in variants/map. See `docs/needs-rules-check.md`.

## M2 done (rules engine integrated, random bot, headless sim)
- Phase machine `src/engine/machine.ts`: deployment, initiative, Movement (walk/run/jump, stand, edge entry, charge and DFA
  declared with the move), Ranged (twist, composite fire, ammo choice), Physical (punch/kick/push, committed charge/DFA,
  Displacement Step), Heat, End (recovery, power, surrender, victory, 30-turn limit when set). Exactly one pending decision
  after every step; auto-resolved decisions emit `DecisionAutoResolved` and stay out of the log.
- `src/engine/index.ts` wired: createGame, step, validate, legalActions (never empty; members validated), save/load/replay,
  view, every `query.*` (`queries.ts`: reachable, los, arcs, attackPreview/firePreview with modifier lines and odds,
  physical previews, heat, PSR, fall, explosion, sheet, terrain, threat) and `describe.*` (`describe.ts`).
- Hooks: `code-hooks.ts` registers caseIIProtect (crit point) and ultraRapid (no-op); `collectHooks` binds data `code`
  names; validate-data refuses unregistered names. Bundle registry moved to `bundles.ts` (no import cycles).
- Data: `is.ammo.lrm-10-artemis` (Rakshasa bins, Artemis +2 cluster).
- AI: `src/ai/random.ts` random-tier bot that plays sensibly (closes, faces, fires under the heat cap, kicks).
- Sim: `npm run sim -- --games 50 --seed 1`: 50/50 games end (A 32, B 17, draw 1), mean 13.7 turns, ~0.73 s/game,
  0 violations (`tools/invariants.ts`: INV-01/02/03/06-12/14/17, NaN, stall, decision cap, save/load, replay).
- Tests: 30 files, 281 tests: golden GOLD-001..012 (+2b/2c, 6b/6c) with forced dice, action fuzz, API, hooks.
- All M2 RULINGs recorded in `docs/needs-rules-check.md` (open items there: PHYS-097, SCN-020, objective hooks, askDefender).

## M3 done (playable vertical slice vs random bot)
- Client in `src/client/` (patterns copied from Whirr Machine): `GameScreen.tsx` (board canvas + HUD, lazy chunk), `contract.ts`
  (frozen client surface), `store/` (gameStore is the only caller of `step`), `presentation/` (director, beats, banners,
  narration), `board/` (bevelled hex tiles with ground mats, cliff strata, water, woods, rough, grid, labels, camera presets
  1/2/3/0, `?fps` meter), `figures/` (GLB + procedural 'Mechs in force colours, `?gallery`), `interaction/` (reach, path, facing
  picker, arcs, LOS, range rings, ruler), `ui/` (start screen, How to Play, coach tips, top bar, roster, event feed, move / fire /
  physical panels, record sheet, heat scale, dice tray and log, settings, end screen), `vfx/`, `environment/` (game-shop
  surroundings with an establishing shot; Settings > Surroundings: Game shop / Plain; Low graphics forces Plain).
- Every number on screen comes from `query.*`, `describe.*`, the pending decision or event payloads.
- Play: start screen -> intro mission vs the random bot; walk / run / jump with facing, torso twist, fire with the live heat
  sum, kick / punch / push, charge and DFA chips, standing up, ammo choice; autosave + Continue; end screen with Play again.
- Engine fix: `reachable` no longer lists ground moves that end in an occupied hex (MOVE-012 test added).
- Bundle: main chunk 469 kB; game chunk 239 kB + three.js chunk 995 kB; the bot in its own lazy chunk.
- Tests: 36 files, 395 unit tests. `tests/e2e/play.spec.ts` plays four turns through the real UI, then fast-forwards to the
  end screen (screenshots in `e2e-out/`: start, howto, shop-wide, move, fire-prompt, record-sheet, midgame, board, shop-play,
  end). Sim: 20/20 games end, 0 violations.

## M4 done (utility AI in a worker, easy/normal tiers)
- AI: `src/ai/` utility decider per `40-ai` (`decider`, `ctx` value model, `damage` per-location marginals/pKill, `threat`
  with sampled enemy reach, `moves` two-stage movement score, `fire` heat knapsack + primary target + twist + plan memo,
  `physical`, `order`, `heat` caps, `tiers`, `tune`). Every rules number from `query.*` and `src/engine/prob.ts`.
- Tiers: random, easy (noise, cap 13, no threat model), normal (full; end heat <= 9 unless kill shot / about to die).
  Start screen opponent selector, default Normal AI.
- Worker: `src/ai/worker.ts` + `src/client/bot/aiWorkerClient.ts` (3 s timeout, random-bot fallback); the bot driver's
  watchdog now counts only time with no presentation progress.
- Bench `npm run bench:ai -- --games 20 --seed 1`: normal beats random 19/20, normal vs easy 12/20; 0 rejections, stalls,
  fallbacks, unhandled; move p95 ~110 ms, max ~150 ms.
- Tests: 40 files, 406 unit tests (tests/ai: kill shot, heat cap, rear arc, legality over seeded games, driver). Sim 30/30,
  0 violations. E2E plays vs the normal AI from its worker with no fallback or watchdog answer.

## M5 done (full stock roster, Core Box maps, skirmish picker, engine fixes)
- Data: all 8 Core Box chassis with two variants each (16 'Mechs; box variants without public stats replaced by public stock variants
  labelled "(stock)"), the 4 Core Box maps (Scorched Oasis, Arid Canyons, Headwater Crossing, Sodden Hills) and the dev map; new
  weapons/ammo/equipment (Clan ER PPC, LB 5-X / 10-X / 20-X slug and cluster ammo, Ultra AC/10, Gauss rifles, Streak SRM 4,
  heavy lasers, micro/ER pulse lasers, Clan TC, MASC, PPC capacitor, coolant pod, Guardian ECM, improved jump jets).
- Engine: ferro-lamellor damage cut (EQUIP-014), Clan targeting computer (EQUIP-001), Guardian ECM vs Artemis IV (EQUIP-015),
  stacking after a fall (MOVE-012), cached movement lookups; LB-X, Ultra AC and Gauss behaviour verified on the real roster.
- Client: Skirmish any-vs-any picker (1-4 'Mechs per side, variant per chassis, pilot skills, BV per pick and per side, Even BV,
  map choice). Feed lines show ferro-lamellor reductions.
- Tools: sim and bench take `--map` and `--forces A,B|random`.
- Gates: typecheck; 46 test files (437 tests); validate:data 0 errors; sim 30/30 (intro on Scorched Oasis) and 30/30 random-roster skirmishes,
  0 violations; bench normal vs random 10/10, normal vs easy 8/10, 0 rejections / stalls / fallbacks; e2e play + skirmish specs.
- Not yet: PPC capacitor, coolant pod, MASC, Ultra AC double-tap in the UI/AI (`tools/out/m5-followups.md`).

## M7 done (equipment rules, AI for the full roster, threat overlay, client polish)
- Engine (`src/engine/equipment.ts` + hooks; 00 §14 rows of 2026-10-08 tagged M6): PPC capacitor charge and +5 shot (EQUIP-016),
  coolant pod (EQUIP-017), Clan MASC with escalating failure and the turn-start reset (EQUIP-020/021), RAC jam and unjam
  (EQUIP-022, fixture weapon), partial wing through the heat/movement hooks (EQUIP-018), Beagle probe no-op (EQUIP-023),
  Ultra AC no-jam (2026 W11). New `EquipmentUsed` / `WeaponJamChanged` events, `UnitDisplaced.cause: 'stacking'`,
  `SheetView.equipment`, `query.reachable(..., {masc})`. Tests: `tests/engine/equipment-m6.test.ts`.
- AI: plays the 16-variant roster on all Core Box maps (ammo choice, explosion risk, ECM vs Artemis, jumpers, terrain),
  charges capacitors, vents pods, uses MASC, double-taps Ultra ACs, prefers leaving when forced to withdraw. Bench sweeps
  `--map a,b|all`, `--forces "A,B;C,D"`, `--withdrawal`. Tests: `tests/ai/equipment.test.ts`, `tests/ai/roster.test.ts`.
- Client: threat overlay (T or the Threat button; engine `query.threat`), AI trace panel, Follow action camera for bot moves
  (setting), end screen with per-'Mech mini sheets, kills, heat peaks, Play again / Rematch, same forces / Back to setup,
  How to Play sections for the roster's equipment and the Skirmish picker, hover tips on the record sheet, softer water
  seams, Low graphics audit, new intro briefing for Scorched Oasis. E2E `tests/e2e/polish.spec.ts` (`e2e-out/polish-*.png`).
- Gates: typecheck; 50 test files (470 tests); validate:data 0 errors; sim 30/30 (seed 7), 0 violations; bench normal vs
  random 19/20, normal vs easy 16/20, 0 rejections / stalls / fallbacks; Playwright 9/9.
- Not yet: player controls for capacitor / pod / MASC / Ultra double tap (engine and AI have them); `tools/out/m7-followups.md`.

## M6 done (audio: SFX, narrator and cockpit voice, audio manager)
- Tools: `tools/gen-audio.ts` (ElevenLabs, idempotent, `--kind` / `--only` / `--dry`, `CREDIT_CEILING` / `RUN_BUDGET`),
  `tools/measure-audio.ts` (RMS / peak / crest), `tools/compose-audio.ts` (layering from `tools/audio-src/`). Prompts live in
  `tools/audio-manifest.json`, mirrored by `src/client/audio/manifest.ts`. Weapon flavours: `src/client/weaponFlavour.ts` (a test
  fails if any weapon lacks one).
- Assets: 65 files in `public/audio/`: 49 SFX (footsteps by weight class, twist, jump jets, fall / stand, 20 weapon flavours,
  physicals, damage, heat, UI) and 16 voice lines (11 narrator, 5 cockpit computer; all lines our own). Loudness trims in
  `src/client/audio/trims.ts`. Generation used 756 credits (account 27,876 of 59,062).
- Client: `src/client/audio/` Web Audio manager (master / sfx / voice / music buses, sfx limiter, persisted volumes and mute in
  Settings, unlock on first input, throttling with detune), beat-to-sound mapping in `beatAudio.ts` / `eventSounds.ts` hooked
  into the presentation director. Music director (title, alternating battle loops, stingers, 2 s crossfades, ducking under
  voice) is wired but silent: the 10 music items are `pending: true` in the runtime manifest and never requested.
- Audition: `/warmechforge/sounds.html` lists every id. Verified headless: 65/65 decode, 0 failed, 0 console errors in a
  human game and a bot-vs-bot game (weapons, impacts, crits, footsteps, falls, narrator all fire).
- Not yet: music (about 12k credits, needs owner OK; when generated, drop `pending` from those manifest rows).

## Next
- Owner playtest on Pages: Skirmish vs the normal AI with the threat overlay (T) and the new end screen.
- Fire-panel and move-panel controls for PPC capacitor, coolant pod, MASC and Ultra AC double tap.
- Ferro-lamellor in previews and the AI damage model; skirmish turn-limit / withdrawal options; 40-ai §4.5 Monte Carlo.
- M8: smoke / hidden units (Beagle probe effects), figure gate follow-ups, music once the owner OKs the spend.
