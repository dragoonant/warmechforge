# Handoff

## Morning summary (owner)
M2 is in: the rules engine plays a full intro-mission game end to end. Two bots finish 50 of 50 games with no rule
violations (about 14 turns each), and the golden worked examples replay exactly with forced dice. Open rules questions
are in `docs/needs-rules-check.md` (new M2 lines at the end).

## Current state
- Engine: `src/engine/` complete for release 1 (phase machine in `machine.ts`, queries in `queries.ts`, text in
  `describe.ts`). Public API: `src/engine/index.ts`.
- Opponent: `src/ai/random.ts` (`createRandomBot(seed)`) answers every decision with a legal action.
- Checks: `npm run typecheck`, `npm test`, `npm run validate:data`, `npm run sim -- --games 50 --seed 1`.

## Next: M3 playable client
1. `GameRunner` store (only caller of `step`), human `Decider` from the UI, the random bot for side B.
2. Board and units on the three.js scene; prompts from `describe.decision`; move targets from `query.reachable`;
   fire odds from `query.firePreview`; record sheet from `query.sheet`.
3. Save/load via `save`/`load` in localStorage; deploy to Pages and screenshot for the owner.

## Known gaps
- Hook points other than initiative, toHit, attackRolled, crit and setup are not called yet (no data uses them).
- `choice` decisions (askDefender) are never raised; defaults decide (00 §9.2).
- Fixture 'Mechs for the golden tests live in `tests/fixtures/golden.ts` (TS), not JSON under `tests/fixtures/mechs/`.
