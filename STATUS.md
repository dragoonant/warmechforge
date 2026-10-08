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
- Open: collectHooks stub (M2); Movement/heat must call partialWingBonuses; spec 10 PSR-053 side-fall columns and partial wing rule need updating; stand-in variants/map. See `docs/needs-rules-check.md`.

## Next: M2
- Movement (walk/run/jump, costs, facing, stand), phase loop, hooks registry, headless sim, AI.
