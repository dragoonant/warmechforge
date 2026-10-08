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

## Next: M3 playable client
- Client game screens on Pages: board, units, decision prompts from `describe.*`, numbers from `query.*`,
  `GameRunner` driving `step` with the random bot as the opponent.
