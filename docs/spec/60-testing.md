# 60: Testing

Lean by default: about 10 focused tests per stage, plus the gates and invariants below, which always run. Verify loops are ON
only for the heat/crit/PSR engine, the equipment catalogue and each new 'Mech data batch (`CLAUDE.md`).

## 1. Gates (every stage, in this order, all FOREGROUND)

| # | Command | Pass when | From |
|---|---|---|---|
| G1 | `npm run typecheck` | exit 0 | M0 |
| G2 | `npm test` | exit 0 (vitest: engine, data, ai, client unit tests) | M0 |
| G3 | `npm run validate:data` | exit 0, no errors (warnings listed) | M0 |
| G4 | `npm run sim -- --games 50 --seed 1` | 50 games run, 0 invariant violations, 0 stalls, 0 decision-cap hits, 0 thrown errors | M1 |
| G5 | `npm run bench:ai -- --games 20 --seed 1` | normal beats random ≥ 18/20; 0 rejections, stalls, fallbacks (`40-ai` §15) | M4 (runs and reports from M3) |
| G6 | `PW_PORT=4183 npx playwright test <spec>` for the specs the stage touched | green; then **Read the screenshots** in `e2e-out/` | M3 |

- After an interrupted run: `git status`, then G1–G3.
- A failing sim or bench seed becomes a fixture test (§6) before the fix lands.
- Gates never write into tracked paths except fixtures a test explicitly creates; outputs go to `tools/out/`, `e2e-out/`,
  `test-results/` (never staged).

## 2. Layout and naming

| Path | Runner | Content |
|---|---|---|
| `tests/engine/*.test.ts` | vitest | rules tests named by checklist ID; golden; fuzz; invariants |
| `tests/data/*.test.ts` | vitest | schema + `validate-data` cross-checks, hook wiring |
| `tests/ai/*.test.ts` | vitest | `AI-` IDs from `40-ai` §16 |
| `tests/client/*.test.ts` | vitest (node) | director ordering, dice-tray purpose coverage, prompt text, store |
| `tests/e2e/*.spec.ts` | Playwright | the production build served at `/warmechforge/` |
| `tests/fixtures/` | | `build.ts` state helpers, `forced-dice.ts`, failing seeds, saves, golden replays |
| `tools/sim.ts`, `tools/ai-bench.ts`, `tools/checklist-coverage.ts`, `tools/validate-data.ts` | tsx | headless tools |

- **Checklist-ID naming.** Every rules test title starts with its ID from `12-rules-test-checklist`:
  `it('HEAT-014 shutdown avoid roll uses the highest threshold reached', …)`. Prefixes: `INIT- HEX- MOVE- LOS- ARC- TOHIT-
  HITLOC- CLUS- DMG- CRIT- AMMO- HEAT- PSR- PILOT- PHYS- EQUIP- SCN- BV-`, plus `AI-` (from `40-ai`), `GOLD-` (from
  `13-golden`), `INV-` (§3), `FUZZ-` (§5).
- `tools/checklist-coverage.ts` greps test titles under `tests/` and prints covered / uncovered IDs per prefix; it exits 1
  when an ID marked `must` for the current milestone is uncovered. Coverage is counted by names, not lines.
- Tests build states only through `createGame` + `step`, or `tests/fixtures/build.ts` helpers that call them (e.g.
  `buildDuel({a:'Atlas AS7-D', b:'Locust LCT-1V', aHex:'0807', aFacing:0, ...})`). Never hand-written `GameState`.
- `src/client/dev/scenarios.ts` (§8) is pure data and may be imported by tests.

## 3. Engine invariants (sim, fuzz and a vitest run of 5 sim games)

`tools/invariants.ts` exports `checkInvariants(prev, step, next): Violation[]`, called after every `step` in the sim, the
fuzz test and the bench. Each violation carries `{id, seed, decisionSeq, detail}`.

| ID | Invariant | Check |
|---|---|---|
| INV-01 | one open decision | every `StepResult.pending` is defined; kind is game-over iff the phase is ended |
| INV-02 | non-empty legal set | `legalActions(state).length > 0` for every open decision, and every member passes `validate` |
| INV-03 | reject, never throw | malformed actions return `rejection` with a code from the frozen list and the same state reference |
| INV-04 | decision cap | ≤ 5 000 decisions per game, else fail with the seed |
| INV-05 | stall detector | 200 consecutive decisions without a change in the progress key (below) → fail with the seed and the last 20 actions |
| INV-06 | armor bounds | per location `0 ≤ armor ≤ max` (front and rear separately) |
| INV-07 | structure bounds | per location `0 ≤ structure ≤ max`; structure 0 ⇔ location destroyed; a destroyed arm/leg never regains values |
| INV-08 | destruction | head or CT destroyed, 3 engine crits, or pilot dead ⇒ unit destroyed; destroyed units get no decisions |
| INV-09 | heat | integer, `heat ≥ 0` after every step; Heat Phase result = previous + generated − dissipated, floored at 0 |
| INV-10 | ammo | `0 ≤ shots ≤ capacity` per bin; exploded bin has 0 shots |
| INV-11 | pilot | hits 0..6; 6 ⇒ dead |
| INV-12 | crit slots | a slot is destroyed at most once; empty slots never show as hit |
| INV-13 | damage conservation | Σ damage in damage events this step = Σ armor lost + Σ structure lost + damage reported as lost overflow |
| INV-14 | phase order | each turn runs Initiative → Movement → Ranged Attack → Physical Attack → Heat → End; turn increases by exactly 1 |
| INV-15 | once per phase | each unit moves at most once per Movement Phase and declares at most one fire selection and one physical attack per turn |
| INV-16 | 2026 eligibility | shut-down or unconscious-crew units get no fire selection; immobile units get no movement selection |
| INV-17 | dice | every roll emits `DiceRolled`; each die in 1..6; `total` = Σ kept dice + flat; `rollSeq` increases by 1 per roll |
| INV-18 | numbers from state | for a roll that follows an attack or PSR decision, `DiceRolled.target` equals the TN the engine's preview showed for that decision |
| INV-19 | edition leaks | no skid event, no fall-facing roll purpose, no ammo-dump action kind, no PSR caused by shutdown, stand attempts add 0 heat, the phase id is the Ranged Attack Phase |
| INV-20 | determinism | `replay(setup, seed, log)` reproduces the final state hash (`hashState` = stable JSON → cyrb128) |
| INV-21 | save/load mid-game | at a seeded decision index: `save` → `load` → same hash and same `pending`; both copies continued with the same decider seeds end with equal hashes |
| INV-22 | positions | every unit on a valid map hex; no two standing 'Mechs of opposite sides in one hex at the end of the Movement Phase except where a rule allows it |

**Progress key (INV-05):** `(turn, phaseIndex, unitsActedThisPhase, Σ damage dealt, Σ dice rolled per purpose 'psr')`. A
key change resets the counter. Repeated stand attempts are bounded by MP, so they cannot stall forever.

## 4. Headless sim (`npm run sim`)

`tsx tools/sim.ts --games 50 --tiers random:random --seed 1 [--scenario <id>] [--turnLimit 30]`

- Game seeds: `deriveSeed(seed, 'sim', gameIndex)`. Deciders: the `random` tier from `40-ai` unless `--tiers` says otherwise.
- Per game: decision cap 5 000 (INV-04), stall detector 200 (INV-05), 60 s wall cap, turn limit 30 then end by the bench rule.
- After every step: `checkInvariants`. Every 50 decisions: INV-21 on a copy. At game end: INV-20.
- Output: `tools/out/sim-<date>.json` `{games, finished, endedByLimit, winners, decisions:{p50,p95,max}, stepMs:{p50,p95},
  violations:[{id, seed, decisionSeq, detail, last20}]}` and a summary of at most 10 lines. Exit 1 on any violation.
- Random play reaches rare paths (shutdown, heat ammo explosions, falls, DFA misses). The summary counts these events so a
  stage can see whether they were exercised.

## 5. Action fuzz test (`tests/engine/action-fuzz.test.ts`)

| ID | Test |
|---|---|
| FUZZ-01 | 20 seeded games × up to 600 decisions with random play: at every decision INV-02 holds and the picked action steps without rejection |
| FUZZ-02 | at every 10th decision, 5 malformed actions per mutation below return a rejection with a known code, the identical state reference, and no throw |
| FUZZ-03 | a random composite fire selection (random weapon subset × random targets) either validates and steps, or is rejected; `validate` and `step` agree on every one |

Mutations: unknown unit id; a unit of the other side; hex off the map; facing 6 or −1; path through an impassable or occupied
hex; mode the unit lacks (jump with 0 JP); weapon not on the unit; weapon in a destroyed location; out-of-arc target; own
unit as target; target out of range or without LOS; torso twist while prone or by 2 hexsides; punch with an arm that fired;
kick with a leg whose weapon fired (2026); ammo bin of a different weapon type; stand attempt while standing; action for a
decision kind that is not open; duplicate weapon in one selection.

## 6. Forced-dice tests (golden and rules)

`tests/fixtures/forced-dice.ts` provides the pattern below; tests import it **before** importing the engine. The engine
must call `roll` through its import from `src/engine/rng.ts` (never a same-file helper), and `GameState.rollSeq` counts rolls,
so the mock intercepts every roll.

```ts
export const FORCED = vi.hoisted(() => new Map<number, number[]>())  // rollSeq -> dice faces
vi.mock('../../src/engine/rng', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/engine/rng')>()
  return {
    ...real,
    roll(state, spec) {
      const f = FORCED.get(state.rollSeq)
      if (!f) return real.roll(state, spec)
      if (f.length !== spec.count) throw new Error(`forced dice count mismatch at rollSeq ${state.rollSeq}`)
      FORCED.delete(state.rollSeq)
      // same shape as real.roll; rng NOT advanced, rollSeq +1, DiceRolled event built from f
    },
  }
})
export function force(seqStart: number, ...rolls: number[][]): void  // consecutive rollSeq values
export function expectAllForcedUsed(): void                           // afterEach: FORCED is empty
```

- `force(...)` keys are the `rollSeq` the roll will have. Helper `nextRollSeq(state)` returns it, so tests read
  `force(nextRollSeq(s), [4, 5], [3, 3])` (to-hit 9, then hit location 6).
- Forced rolls do not advance `state.rng`, so unforced rolls after them stay seeded and deterministic.
- `afterEach(expectAllForcedUsed)` catches a test whose roll order drifted.
- **Golden test** `tests/engine/golden.test.ts` (`GOLD-` IDs from `13-golden`): authored positions and pilots, forced dice,
  the action log, and the expected events (to-hit TN with its modifier list, hit location, damage per location, transfer,
  crit check, heat at the Heat Phase) and end state. Arithmetic lives in `13-golden`; the test asserts every step.
- Rules tests use forced dice for every roll whose value matters; others leave dice seeded.

## 7. Hook wiring and data tests

- `validate-data` fails when a data item references a `{code:'<hook>'}` that `code-hooks.ts` does not register, or a
  registered hook that core code never calls (wiring table in `00-architecture`).
- Every code hook has one test proving it fires in a real game: build a duel with the item, step until the hook's event
  appears (forced dice where needed), assert the effect. Title: `EQUIP-xxx <hook> fires in play`.
- Data tests: every 'Mech's armor ≤ the per-location maximum (2 × structure, head 9), slot totals ≤ capacity, tonnage sums,
  unconfirmed values carry a `source` and a flag (`20-data-schema`).

## 8. Scenario dev positions (`src/client/dev/scenarios.ts`)

Loaded by `?scenario=<id>` (with `?test=1`); each entry is `{id, map, units:[{variant, side, hex, facing, heat?, damage?,
prone?, shutdown?}], pilots, seed, forcedDice?: number[][], note}`. Forced dice in a scenario only apply with `?test=1`. Each
scenario has a vitest that loads it headless and asserts the key number from the engine, and an e2e check that the UI shows
the same number (`scenarios.spec.ts`).

| id | Sets up | Asserts (engine number = UI number) |
|---|---|---|
| `dfa` | jumper 3 hexes from a target one level lower | DFA TN, damage, attacker leg damage; miss → automatic fall |
| `fall-cliff` | 'Mech pushed toward a 2-level drop | displacement, fall damage, rear only on 1d6 = 1 (2026), no facing change |
| `ammo-explosion` | 'Mech at heat 21 with SRM ammo | ammo Avoid TN 4; explosion capped at 20, 1 pilot hit (2026) |
| `heat-shutdown` | 'Mech projecting heat 18 | shutdown Avoid TN 6; on shutdown no PSR (2026); immobile modifier for attackers |
| `torso-twist-arc` | target exactly on the front/side arc boundary, then after a twist | arc verdict before and after twist; attack direction unchanged by twist |
| `rear-shot` | attacker in the target's rear arc | rear armor used on torso hits |
| `partial-cover` | target behind a 1-level hill | +1 TN; leg results absorbed by cover |
| `woods-los` | 2 light woods between | +2 TN; 3 light woods (or heavy + light) blocks LOS |
| `cluster-lrm` | LRM-20 at medium range | cluster distribution shown equals the table; minimum range modifier at 4 hexes |
| `kick-prone` | adjacent prone target | kick TN (2026 −1 base), prone target −2 adjacent |
| `charge-tmm` | charge after running | 2026 TMM-based charge damage; failed charge does not displace |
| `leg-destroyed` | leg at 1 structure | after destruction: fall, Walk 1 / Run 2 (2026), one PSR per leg instance |
| `side-torso-arm` | side torso nearly destroyed | arm lost with the side torso; transfer to CT |
| `tac-roll-2` | forced location roll 2 | through-armor crit check on the right location |
| `aimed-immobile` | shut-down target | aimed shot offered; 1d6 4+ (2026) shown in the prompt |
| `water-run` | run into depth 1 water | PSR required (2026); walking in needs none |
| `consciousness` | pilot at 3 hits takes 2 more in one phase | one check at the highest Avoid number (2026) |

## 9. Playwright (E2E)

- `playwright.config.ts` builds and serves production at `http://localhost:${PW_PORT ?? 4173}/warmechforge/` (the Pages
  sub-path). Every `page.goto` is relative (`./?test=1&seed=…`), so base-path bugs fail locally. Asset URLs use
  `import.meta.env.BASE_URL`.
- Run: `PW_PORT=4183 npx playwright test <spec>`. Screenshots go to `e2e-out/` (never staged); the agent Reads them.
- Drive the game through `window.__game` (`?test=1`) and `data-testid`s from `50-client`; assert with DOM proxies (e.g.
  `unit-<id>` with `data-hex`, `data-facing`, `data-heat`). Selectors match exact text or `data-testid`, never substrings.
- Drags on the three.js canvas use `page.mouse` with `steps ≥ 10` (the built-in browser pane's drag does not move three.js
  objects).
- Every spec fails on any console error and on any request outside `/warmechforge/`.

| Spec | Covers |
|---|---|
| `home.spec.ts` | title, fan-project notice, start button |
| `base-path.spec.ts` | all requests under `/warmechforge/`, no 404, the AI worker chunk loads |
| `play-slice.spec.ts` | bot vs bot at speed 0 to the end screen within 120 s |
| `human-turn.spec.ts` | select a 'Mech; reach highlight count = `query.reachable` count; move with a facing; fire: odds text = engine preview; dice tray shows the roll with its target; heat projection updates |
| `record-sheet.spec.ts` | armor/structure pips equal state after damage |
| `ai-worker.spec.ts` | normal AI answers each decision within 3 s, no `AiFallback` log |
| `save-load.spec.ts` | save mid-turn, reload, same hash via `window.__game.hash()` |
| `scenarios.spec.ts` | each §8 scenario: load, perform the step, compare the UI number with `window.__game.query` |

## 10. Definition of done per milestone

| Milestone | Done when |
|---|---|
| M0 | specs 00–70 written and reviewed once; frozen contract files compile; `validate:data` runs; skeleton on Pages; checklist IDs exist |
| M1 | `HEX- LOS- MOVE- ARC-` must IDs covered; `npm run sim` with INV-01..05, 14, 17, 20, 21 live; LOS memoised by hex pair |
| M2 | all `must` IDs covered; golden test passes; fuzz FUZZ-01..03 green; 50-game random sim: 0 violations of INV-01..22; verify loop passed |
| M3 | Pages build playable end to end vs the random bot; `home`, `base-path`, `play-slice`, `human-turn`, `record-sheet`, `save-load` green; scenarios `dfa`, `fall-cliff`, `ammo-explosion`, `torso-twist-arc` load and match; owner gates answered |
| M4 | G5 gate met (`40-ai` §15); AI-001..020 green; `ai-worker.spec.ts` green; worker p95 ≤ 800 ms |
| M5 | every 'Mech GLB present and enabled; gallery screenshots read |
| M6 | every `DiceRolled.purpose` and weapon flavour has a sound; `sounds.html` audition; no unheard files |
| M7 | feed breakdowns, end screen, Low mode; perf budgets met |
| M8 | per new 'Mech batch or mission: verify loop on data and rules, `validate:data`, e2e spec + screenshots; all §8 scenarios green |

Every stage: G1–G3 (and G4 from M1, G5 from M4) green, commit, push, Pages deploy green.
