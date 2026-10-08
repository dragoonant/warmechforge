# 00: Architecture

Source of truth for module boundaries, the engine contract, hex geometry, the decision model and determinism.

- Rules semantics live in `10-rules-core` (IDs such as `HEAT-022`); data shapes in `20`; missions `11`; figures `30`;
  AI `40`; client `50`; testing `60`; maps `70`.
- `src/engine/{types,actions,events,hooks,rng,decider,index}.ts` are the code form of §2–§13 and are **FROZEN after M0**:
  changes are additive only (new optional fields, new union members, new functions) and need a row in §14 plus a line in
  the agent's `issues`.
- On a conflict, `10-rules-core` wins on what a rule does (numbers, procedures); this file wins on names, shapes, event
  order and timing of decisions. Log the mismatch as a `RULING:`.
- All prose is ours. No rulebook text, no record-sheet layout.

## 1. Modules

| Module | Path | May import | Must not | Runtime |
|---|---|---|---|---|
| engine | `src/engine/` | itself; *types* from `src/data/types.ts` (`import type`) | DOM, React, three, timers, `Math.random`, `Date`, data JSON | node, browser, worker |
| data | `src/data/` | schemas (types only) | side effects beyond building the bundle | JSON validated by `tools/validate-data.ts` |
| ai | `src/ai/` | engine public API (`src/engine/index.ts`) read-only, data types | client, three, DOM, engine internals | node, worker |
| client | `src/client/` | engine API, ai (via worker), data, assets | mutate `GameState`; compute any rules number | browser |
| tools | `tools/` | anything | be imported by `src/` | node (`tsx`) |
| tests | `tests/` | everything | | vitest, playwright |

- Dependency direction: `data ← engine ← ai ← client`. Alias `@/` → `src/` (no `baseUrl`).
- Enforced by `tests/engine/boundaries.test.ts` (greps import lines per module directory).
- Engine and ai run unchanged in `npm run sim`, `npm run bench:ai` and the Web Worker.
- Code split: the client loads `engine + data` and `ai` as separate dynamic chunks; the start screen renders first.

Engine file layout (brief C.2). Frozen contract files are marked ★; the rest are implementation modules whose names are
fixed now so parallel agents agree:

| File | Owns |
|---|---|
| ★ `types.ts` `actions.ts` `events.ts` `hooks.ts` `rng.ts` `decider.ts` `index.ts` | contract (§2–§13) |
| `hex.ts` | §3 geometry: labels, neighbours, distance, bearing, arcs, hex line, world units |
| `los.ts` | LOS-001..041 verdicts (`query.los`) |
| `terrain.ts` | board normalisation (§4.2), per-hex costs and LOS heights |
| `movement.ts` | MP (MOVE-006..008), paths, reachable search, move execution, PSR triggers while moving |
| `dice.ts` | closed-form 2d6 odds helpers used by previews |
| `tohit.ts` | TOHIT-001..036 modifier lists (ranged and physical) |
| `hitloc.ts` `cluster.ts` | HITLOC tables and groups; CLUS table |
| `damage.ts` | the ONE damage pipeline (§6) |
| `crits.ts` `ammo.ts` | CRIT and AMMO effects called by `damage.ts` |
| `heat.ts` | the ONE heat ledger (§8) |
| `psr.ts` | the ONE PSR queue and falls (§7) |
| `pilot.ts` | PILOT hits, consciousness, recovery |
| `physical.ts` | PHYS attacks and the Displacement Step |
| `initiative.ts` | INIT-002 rolls and INIT-005 selection order (§5.2) |
| `phases/{deployment,initiative,movement,ranged,physical,heat,end}.ts` | the phase machine (§5) |
| `pending.ts` | raising decisions, auto-resolution, `legalActions` candidates |
| `setup.ts` | `createGame` state build (§4.5) |
| `code-hooks.ts` `equipment/<family>.ts` | registered code hooks (§11.4) |
| `scenario.ts` | status, crippled, withdrawal, victory (11-missions) |
| `bv.ts` | BV and skill multiplier (11-missions) |

## 2. Engine API (`src/engine/index.ts`)

| Function | Returns | Notes |
|---|---|---|
| `createGame(setup, seed, bundle)` | `StepResult` | Registers the bundle. Bad setup → `rejection` `E_BAD_SETUP`, never throws. Builds state (§4.5). If no side uses placed deployment it rolls turn-1 initiative itself; first pending is `deploy` or `initiativeAck`. |
| `step(state, action)` | `StepResult` | Pure reducer. RNG restored from `state.rng`. Illegal → same `state` reference, `events = [ActionRejected]`, same `pending`, `rejection`. |
| `legalActions(state)` | `Action[]` | Answers to `state.pending`. **Never empty while a decision is open**; every member passes `validate` (§9.5). |
| `validate(state, action)` | `Rejection \| null` | Exactly the checks `step` runs; no mutation. Used by previews and drags at ≤30 Hz. |
| `replay(setup, seed, bundle, actions)` | `StepResult` | Folds `step` from `createGame`; stops at and returns the first rejection. Implemented. |
| `save(state, label?, savedAt?)` / `load(file, bundle)` | `SaveFile` / `StepResult` | §12.3. `save` implemented; `load` = `replay` (`E_DATA_VERSION` on mismatch). |
| `view(state, player)` | `PlayerView` | Deciders only see a view. No hidden information in release 1. Implemented. |
| `registerBundle(bundle)` / `bundleFor(state)` | | `step(state, action)` takes no bundle; the engine keeps bundles by `version`. |
| `hashState(state)` / `stableStringify(v)` | `string` | INV-20 hash (stable JSON → cyrb128, 32 hex). Implemented. |
| `query.*` | read-only numbers | §11. The ONLY source of numbers the UI or AI shows. |
| `describe.*` | strings in our words | §11.3. |
| `ENGINE_VERSION` | `'0.1.0'` | bump the minor version when a body lands that changes replays. |

```ts
interface StepResult { state: GameState; events: GameEvent[]; pending: PendingDecision; rejection?: Rejection }
interface Rejection { code: RejectionCode; message: string; detail?: Record<string, unknown> }
```

Reducer rules:
1. Immutable state; structural sharing via hand-written spreads. No I/O, clock or `Math.random`.
2. One action → 0..n events → exactly one `pending`. A decision with exactly one legal answer is resolved inside the step
   and emits `DecisionAutoResolved {decisionId, kind, optionId}` (exceptions: `initiativeAck` and `gameOver`, which exist
   for pacing and are always raised). Dice are never "confirmed" by a player.
3. Every rule effect emits an event (§10). Client and AI rebuild what they show from `state` + events, never from diffs.
4. **Read targets from state, not events.** The TN, modifiers and odds of the attack being resolved live in
   `state.current` (`AttackContext`) and of each declared attack in `state.declarations[i]` before the dice event; PSR TNs
   are in `PsrResolved` and in `DiceRolled.target`. A test pins this (INV-18).
5. `step` throws only `EngineInvariantError` (corrupt state). The sim counts a throw as a failed game.
6. Each accepted action is appended to `state.log`; auto-resolved answers are not logged (replay re-derives them).

## 3. Hex geometry and world units (`hex.ts`, constants in `types.ts`)

### 3.1 Coordinates and labels
- Internal: **axial** `Hex {q, r}`; cube `s = −q − r`. Off-board ("virtual") hexes are legal values; `onBoard(board, hex)`
  decides membership.
- Printed label `XXYY` = `(col + 1, row + 1)` zero padded; `0101` is the top-left (north-west) hex. Columns run west→east,
  rows north→south. A label exists only for on-board hexes; `hexToLabel` of an off-board hex returns `null`.
- Offset layout is **odd-q** on 0-based columns: odd 0-based columns (labels `02xx`, `04xx` … `16xx`) sit half a hex
  lower (south) than their even neighbours. Even 0-based columns (labels `01xx`, `03xx` …) are the "high" columns.
- Checked 2026-10-08 against MegaMek `Coords.java` (its `x, y` = our `col, row`; MegaMek prints `x+1, y+1`):
  `yInDir` moves NE/NW to `y − 1` from an even x and to `y` from an odd x, and SE/SW to `y` from an even x and to `y + 1`
  from an odd x; its direction numbers are ours (0 N, 1 NE, 2 SE, 3 S, 4 SW, 5 NW); its `toCube` is our conversion below.
  Same parity, no adjustment needed.
- Conversions: `q = col`, `r = row − (col − (col & 1)) / 2`; back: `col = q`, `row = r + (q − (q & 1)) / 2`.
- Worked examples (label → axial → neighbours in facing order 0–5; `—` = off board). Tests use these verbatim (HEX-003/004):

| Label | col, row | Axial | N (0) | NE (1) | SE (2) | S (3) | SW (4) | NW (5) |
|---|---|---|---|---|---|---|---|---|
| `0505` (even col, high) | 4, 4 | `(4,2)` | `0504` | `0604` | `0605` | `0506` | `0405` | `0404` |
| `0605` (odd col, low) | 5, 4 | `(5,2)` | `0604` | `0705` | `0706` | `0606` | `0506` | `0505` |
| `0201` (odd col, top edge) | 1, 0 | `(1,0)` | — | `0301` | `0302` | `0202` | `0102` | `0101` |

  Rule of thumb: from a high (odd label) column the NE/NW neighbours are one row up and SE/SW are on the same row; from a
  low (even label) column NE/NW are on the same row and SE/SW are one row down.
- Map keys inside the engine are labels (`board.hexes[label]`); a generic key for any hex is `hexKey(h) = "q,r"`.

### 3.2 Facing and neighbours
Facing 0 = north (the 'Mech faces the north hexside), clockwise. Facing `f` means the unit's front points through the
hexside it shares with `neighbor(h, f)`; that neighbour is "directly ahead" and `neighbor(h, (f + 3) % 6)` is "directly
behind". `HEX_DIRS` in `types.ts`:

| Facing | Name | `(dq, dr)` | Bearing |
|---|---|---|---|
| 0 | N | (0, −1) | 0° |
| 1 | NE | (+1, −1) | 60° |
| 2 | SE | (+1, 0) | 120° |
| 3 | S | (0, +1) | 180° |
| 4 | SW | (−1, +1) | 240° |
| 5 | NW | (−1, 0) | 300° |

- `neighbor(h, f) = {q: h.q + dq, r: h.r + dr}`; `directionTo(a, b)` = the `f` with `neighbor(a, f) = b`, else `null`.
- `turnCost(f1, f2) = min(|f1 − f2|, 6 − |f1 − f2|)` hexsides (1 MP each, MOVE-011).
- `turnLeft(f) = (f + 5) % 6`, `turnRight(f) = (f + 1) % 6`; torso facing = `(feet + twist + 6) % 6`.
- Backward step moves to `neighbor(h, (f + 3) % 6)` keeping facing `f`.

### 3.3 Distance and areas
- `distance(a, b) = (|dq| + |dr| + |ds|) / 2`. Range = distance (HEX-005): adjacent = 1, same hex = 0.
- `ring(c, n)`, `hexesWithin(c, n)` (all hexes with distance ≤ n, in ring order starting at facing 4 corner, walking clockwise;
  the order only matters for determinism).

### 3.4 Bearing, arcs, attack direction
- Pixel centre (circumradius 1, y down): `px = 1.5·q`, `py = √3·(r + q/2)`.
  `bearing(a, b) = atan2(px_b − px_a, −(py_b − py_a))` in degrees, normalised to `[0, 360)`. `bearing(a, a)` is undefined:
  callers handle the same hex first.
- `rel(a, b, f) = (bearing(a, b) − 60·f) mod 360` (HEX-007). Compare angles with tolerance `1e-6`.
- `firingArc(attackerHex, arcFacing, targetHex)` → ARC-001: Forward `rel ≤ 60 or rel ≥ 300`; Right `60 < rel ≤ 120`;
  Rear `120 < rel < 240`; Left `240 ≤ rel < 300`.
- `attackDirection(targetHex, targetFeetFacing, attackerHex)` → ARC-020 zone, or `{tie: [zoneA, zoneB]}` when `rel` is
  30, 150, 210 or 330 (ARC-021; the defender's choice, §9.3 `attackDirection`).
- Worked checks (attacker `(0,0)` facing 0): `(1,−1)` 60° Forward; `(1,0)` 120° Right; `(0,1)` 180° Rear; `(−1,1)` 240°
  Left; `(−1,0)` 300° Forward. Target `(0,0)` facing 0 attacked from `(1,−1)`: rel 60 → right side; from `(0,−2)`: rel 0 → front.
- Conventions, stated once:
  - Both `firingArc` and `attackDirection` measure `rel` clockwise from the unit's facing direction, 0 = straight ahead.
  - **Firing arcs** (ARC-001) are four sectors from the attacker: Forward 120° wide (300 ≤ rel ≤ 60, both edges
    inclusive, so the front-left and front-right adjacent hexes are Forward), Right side 60° (60 < rel ≤ 120), Rear 120°
    (120 < rel < 240, edges exclusive), Left side 60° (240 ≤ rel < 300). These are MegaMek `ComputeArc.isInArc`
    `ARC_FORWARD`, `ARC_RIGHT_SIDE`, `ARC_REAR`, `ARC_LEFT_SIDE` exactly (checked 2026-10-08); an arm's arc is Forward ∪
    its side.
  - **Attack direction** (ARC-020) divides the target's surroundings by the three lines through opposite corners of its
    hex: six 60° wedges, each centred on one hexside. Front = the wedge through the front hexside (330–30), Right = the two
    wedges through the front-right and rear-right hexsides (30–150), Rear = the rear hexside's wedge (150–210), Left =
    210–330. A line from the attacker that runs exactly along a corner line (rel 30, 150, 210, 330) is a tie (ARC-021).
    This is the AGoAC attack direction diagram; MegaMek's side table was not re-fetched (fetch budget), so tests pin our
    numbers (12 ARC-020/021).
  - Arc and direction worked examples with labels: attacker `0505` facing 0, target `0605` (`(5,2)`, bearing 120° from
    `(4,2)`): rel 120 → Right side, so a left-arm weapon cannot fire at it. Target `0605` facing 5 attacked from `0505`:
    `rel(target→attacker) = (bearing((5,2)→(4,2)) − 300) mod 360 = (300 − 300) = 0` → Front. The same target facing 2:
    `(300 − 120) = 180` → Rear.

### 3.5 Hex line (LOS-001/002)
`hexLine(a, b) → {plus: Hex[], minus: Hex[], divided: boolean}`; both sequences include `a` and `b`.
1. `N = distance(a, b)`; if `N = 0` return `[a]` for both, `divided = false`.
2. World centres (flat-to-flat 1): `X = q·√3/2`, `Y = r + q/2`. Direction `d = (Xb − Xa, Yb − Ya)`; unit perpendicular
   `n = (−dY, dX) / |d|`; `ε = 1e-6`.
3. For `i = 0..N`: `t = i / N`; `P± = A + t·d ± ε·n`; fractional axial `q = X·2/√3`, `r = Y − q/2`; cube-round
   (round all three, then fix the component with the largest rounding error so `q + r + s = 0`).
4. Drop consecutive duplicates. `divided = plus ≠ minus` (element-wise).
5. Worked checks: `0101 → 0103` single `[0101, 0102, 0103]`. `0101 → 0202` (axial `(0,0) → (1,1)`) divided:
   one sequence passes `0201`, the other `0102`.

### 3.6 World units (`types.ts` constants; the only definitions)

| Constant | Value | Meaning |
|---|---|---|
| `HEX_FLAT` | 1 | world units per hex, flat side to flat side |
| `COLUMN_STEP` | `√3/2 ≈ 0.8660` | x distance between neighbouring column centres |
| `LEVEL_HEIGHT` | 0.35 | world height of one level (a standing 'Mech is 2 levels = 0.70) |

- `hexToWorld(hex) = {x: q·√3/2 − centre.x, z: (r + q/2) − centre.z}`; y is up, +z is south, +x is east.
- `board.centre` = midpoint of the bounding box of all on-board hex centres before centring. 16 × 17 sheet:
  x ∈ [0, 12.990], z ∈ [0, 16.5] → centre `(6.4952, 8.25)`.
- Surface height: `y = level · LEVEL_HEIGHT`. Water floor: `(level − depth) · LEVEL_HEIGHT`. A 'Mech stands on the floor.
- Rotation: `rotation.y = −facing · π/3` (model front = −z); torso node `rotation.y = −twist · π/3` relative to the legs.
- Worked checks: `0101` → axial `(0,0)`; `0201` → `(1,0)`, world before centring `(0.866, 0.5)`; `0102` → `(0,1)`;
  `0301` → `(2,−1)`; `1617` → `(15,9)`; `distance(0101, 1617) = 24`; `bearing(0101, 0201) = 120°`.

### 3.7 `hex.ts` signatures (owned by M1; pure)
`labelToHex(label) → Hex | null`, `hexToLabel(hex) → HexLabel | null` (needs board size), `offsetToHex(col, row)`,
`hexToOffset(hex) → {col, row}`, `hexKey`, `neighbor`, `neighbors(h) → Hex[6]` (facing order), `directionTo`,
`distance`, `ring`, `hexesWithin`, `bearing`, `rel`, `firingArc`, `attackDirection`, `hexLine`, `turnCost`,
`hexToWorld(board, hex)`, `worldToHex(board, {x, z})`, `onBoard(board, hex)`, `edgeHexes(board, edge)`.

## 4. Game state (`types.ts`)

### 4.1 `GameState`

| Field | Type | Notes |
|---|---|---|
| `format` | `1` | |
| `seed`, `rng` | `string`, `RngState` | sfc32 state (§12) |
| `rollSeq` `decisionSeq` `attackSeq` `psrSeq` `phaseSeq` | int | id counters: `r:<n>`, `d:<n>`, `a:<n>`, `p:<n>`; `phaseSeq` +1 at every `PhaseStarted` |
| `dataVersion` | string | bundle hash; replay/load refuse a mismatch |
| `setup` | `GameSetup` | 11-missions §1.1 (side 0 → `'A'`, side 1 → `'B'`) |
| `board` | `BoardState` | §4.2 |
| `sides` | `Record<PlayerId, SideState>` | control, home edge, deployment mode |
| `turn`, `phase`, `step` | int, `PhaseId`, `PhaseStep` | turn 0 during deployment; steps §5.1 |
| `damageWindow` | `'immediate' \| 'simultaneous'` | §5.3 |
| `initiative` | `InitiativeState \| null` | this turn's winner/loser |
| `selection` | `SelectionState \| null` | INIT-005 bookkeeping (§5.2) |
| `units`, `unitOrder` | `Record<UnitId, UnitState>`, `UnitId[]` | ids `A1..An`, `B1..Bn` in force order |
| `declarations`, `resolveIndex` | `Declaration[]`, int | this phase's attacks with frozen TNs; next to resolve |
| `current` | `AttackContext \| null` | the attack resolving now (rule 4) |
| `ledger` | `PhaseLedger` | 20-damage tally, owed consciousness checks, phase-start immobile snapshot, displacements |
| `psr` | `PsrState` | the ONE PSR queue (§7) |
| `heatLedger` | `Record<UnitId, HeatEntry[]>` | the ONE heat ledger (§8) |
| `choices` | `{los, direction}` | defender choices per `attacker>target` pair, cleared at turn start (LOS-005, ARC-021) |
| `resume` | `ResumePoint \| null` | continuation of a procedure paused by `chooseAmmo` or `choice` |
| `result` | `GameResult \| null` | set when the game ends |
| `pending` | `PendingDecision` | also returned in `StepResult` |
| `log` | `Action[]` | accepted actions, for save and replay |

### 4.2 `BoardState`
Built once in `createGame` from the map record (composites assembled per 20 §8): `{mapId, cols, rows, hexes, centre}`;
`hexes` is dense (every on-board label). `BoardHex = {label, hex, level, woods: 'none'|'light'|'heavy', depth, rough,
rubble, pavement, road: Facing[]}`. `floor = level − depth`. Reserved terrain (M8) is rejected by validate-data and never
reaches the board. New terrain adds optional fields (additive).

### 4.3 `UnitState`

| Field | Notes |
|---|---|
| `id`, `owner`, `mechId`, `name`, `tonnage` | `name` = force unit name or `chassis model` |
| `baseMp {walk, run, jump}`, `sinks {count, type}` | data snapshot at createGame; never changes |
| `status`, `crippled` | `UnitStatus` of 11 §2.1; `crippled` re-checked after each damage resolution and in the End Phase |
| `pos`, `facing`, `prone` | `pos = null` while `offBoard`/`withdrawn`/`surrendered`; wrecks keep `pos` |
| `shutdown` | `{cause: 'heat' \| 'voluntary', turn}` or `null` |
| `heat` | integer ≥ 0, may exceed 30 |
| `pilot` | `{pilotId, name, gunnery, piloting, hits 0..6, conscious, dead, koTurn, spas}` |
| `locs[Loc]` | `{armor, rear, structure, maxArmor, maxRear, maxStructure, destroyed, destroyedCause}`; `rear` only CT/LT/RT |
| `slots[Loc]` | `SlotState[]` (12 for CT/LT/RT/LA/RA, 6 for HD/LL/RL): `{token, hit, hitPhase}` |
| `mounts[id]` | `{id, item, location, split, rear, linkedTo, critHits, destroyed, jammed, firedTurn}` |
| `bins[id]` | `{id, ammo, location, shots, capacity, exploded}` |
| `move` | this turn's `MoveRecord` (mode, start, hexesMoved, jumped, mpSpent, tmm, attackerMod, done, entered, standAttempts, fell, ranHexes); reset at turn start; TMM persists all turn (TOHIT-019) |
| `attacks` | this turn's `AttackRecord` (twist, flipped, twistPhase, declared flags, primary target, propArm, firedMounts, charge/dfa) |
| `doomed` | destruction booked inside a simultaneous window (§5.3) |
| `destroyedCause` | set when `status` becomes `destroyed` |
| `escalating[mountId]` | EQUIP-020 step per item |

### 4.4 Derived values (computed by engine modules, never stored)
Current walk/run/jump MP (MOVE-006/007, HEAT-020), operable sinks and dissipation (HEAT-010..012), persistent PSR
modifiers (PSR-010..014), crit counts per system (count `hit` slots by token), immobile (MOVE-008), weapon operable
(mount not destroyed, location not destroyed, not jammed), ammo available per weapon, consciousness TN.
Every such value has exactly one function; previews and rules call the same function.

### 4.5 `createGame` build order
1. Validate: mission, map and every force unit's mech/pilot resolve; two sides with opposite home edges; force BV ≤
   `bvBudget` when set; else `E_BAD_SETUP` (`detail.problems: string[]`).
2. `rng = seedRng(seed)`; counters 0; `board` built; `sides` from mission sides.
3. Units in force order: locations from data armor + internal structure table; slots from `crits`; mounts and bins
   (ammo choice from `force.units[].ammo`, half loads `floor(shotsPerTon / 2)`); pilot = `skills` ?? pilot card ?? 4/5.
   Hook point `setup` runs per unit.
4. Edge-entry units: `status 'offBoard'`, `pos null`. Placed sides: `status 'active'` once placed.
5. Events: `GameStarted`. If a side uses `edgePlace`/`hexes`: `phase 'deployment'`, pending `deploy` (side A first).
   Else start turn 1 (§5.1).

## 5. Phase machine

### 5.1 Turn and steps (`PHASE_STEPS`)

| Phase | Steps in order | What happens |
|---|---|---|
| `deployment` | `deployment.place` | sides alternate `deploy`, A first, one unit each; a side with none left is skipped; then turn 1 |
| `initiative` | `initiative.roll`, `initiative.ack` | `TurnStarted`, `PhaseStarted`; per-turn resets (`move`, `attacks`, `choices`; `heatLedger` is already empty); both sides roll 2d6 (`initiative`, A then B), ties re-roll both; `InitiativeResolved`; `initiativeAck` |
| `movement` | `movement.select`, `movement.move`, `movement.end` | §5.2 selections; per unit `move`/`standUp`; `movement.end`: owed consciousness checks, victory check |
| `rangedAttack` | `ranged.select`, `ranged.twist`, `ranged.declare`, `ranged.resolve`, `ranged.endOfPhase` | declarations alternate (§5.2); then resolve all in declaration order in a simultaneous window; then §5.4 |
| `physicalAttack` | `physical.select`, `physical.twist`, `physical.declare`, `physical.resolve`, `physical.displace`, `physical.endOfPhase` | as ranged; then the Displacement Step (PHYS-090) in an immediate window; then §5.4 |
| `heat` | `heat.apply`, `heat.endOfPhase` | per unit in initiative order (loser's units first, each side in `unitOrder`): HEAT-030 steps 1–5; then §5.4 (b)–(e) (step (a) has nothing to do: Heat Phase damage is immediate) |
| `end` | `end.recovery`, `end.lifeSupport`, `end.consciousness`, `end.reset`, `end.power`, `end.surrender`, `end.cleanup`, `end.victory` | INIT-015 in order; `end.consciousness` checks pilots hit in `end.lifeSupport`; `end.power` raises `powerChoice` (§9.2); `end.victory` also applies `turnLimit` |
| `ended` | `game.over` | `GameEnded`; pending `gameOver` |

- Every phase emits `PhaseStarted` (resets `ledger` and `psr.history`, snapshots `ledger.immobileAtStart`) and `PhaseEnded`.
- Steps with no decision run inside the same `step` call; the reducer advances until a decision is open.

### 5.2 Selection order (INIT-003..007)
For `movement`, `rangedAttack`, `physicalAttack`; `L` = initiative loser, `W` = winner.
1. Eligible (INIT-004): movement = units `active`/`withdrawing` on board or `offBoard` due to enter, not immobile;
   ranged/physical = units on board, not shut down, pilot conscious. Destroyed (including `doomed`) units never count.
2. At the start of each pair: `a` = L's eligible units not yet selected this phase, `b` = W's. Both 0 → selections done.
   One side 0 → the other selects all its remaining units, one `selectUnit` each.
   Else `n_L = a > b ? ceil(a/b) : 1`, `n_W = b > a ? ceil(b/a) : 1` (`PairStarted {counts}`); L selects `n_L`, then W
   selects `n_W`, each capped by what is still eligible at that moment.
3. Each selection is one `selectUnit` decision for that side (auto-resolved with one candidate), followed by that unit's
   whole move or declaration before the next selection (INIT-007).
4. Oracles (tests): L3/W4 → `L WW L W L W`; L4/W2 → `LL W LL W`; L10/W18 → W selects 2 per pair in pairs 1–8, then 1 and 1.

### 5.3 Damage windows (INIT-012)
- `damageWindow = 'simultaneous'` only during `ranged.resolve` and `physical.resolve`; `'immediate'` otherwise.
- In both windows the damage pipeline books armor, structure, slots, transfers and explosions at once (later hits see them).
- Simultaneous: a unit that would be destroyed gets `doomed = cause` and `UnitDestroyed {effective: false}`; it keeps
  resolving its declared attacks. Declared TNs never change (frozen in `Declaration`). Gameplay effects (destroyed
  weapons, MP loss, crit modifiers) matter only from the next phase because every rules function reads current slots
  when it next computes a value.
- Immediate (Movement falls, Displacement Step, Heat Phase, End Phase): destruction applies at once: `status 'destroyed'`,
  `UnitDestroyed {effective: true}`, `StatusChanged`, victory check.
- PSRs: Movement-phase triggers resolve at once (`when 'now'` / `'endOfMove'`); every other trigger waits for §5.4 (c).
- Pilot hits in any phase add the unit to `ledger.pilotHit`; checks happen at §5.4 (b) and (d), or at `movement.end`.

### 5.4 End-of-phase steps (INIT-013), Ranged, Physical and Heat
Steps in order (10 INIT-013; consciousness before the PSR queue, as AGoAC orders it):
- (a) Apply the phase's gameplay effects and remove destroyed units: every `doomed` unit → `destroyed`
  (`UnitDestroyed {effective: true}`, `StatusChanged`). Removed units get no consciousness check or PSR below (their
  queued PSRs are `PsrDiscarded {destroyed}`).
- (b) One `ConsciousnessChecked` per unit in `ledger.pilotHit` whose pilot is still conscious and alive, in initiative
  order, at the pilot's current total hits. Then `ledger.pilotHit` is cleared.
- (c) Resolve the PSR queue (§7), automatic falls included. A pilot knocked out in (b) fails every PSR here (PSR-005).
  Seatbelt pilot hits from falls add the unit to `ledger.pilotHit` again.
- (d) One more `ConsciousnessChecked` per unit in `ledger.pilotHit` (pilots hit by a fall during (c)), same rules as (b);
  then `ledger.pilotHit` is cleared.
- (e) Crippled/withdrawal re-check (11 §2–3), victory check (11 §5); `PhaseEnded`.

`PHASE_STEPS` keeps one step per phase for all of this (`ranged.endOfPhase`, `physical.endOfPhase`, `heat.endOfPhase`); the
step runs (a)–(e) inside one reducer call and raises no decision of its own.
Victory is checked whenever a unit enters an eliminated status outside a simultaneous window and at `end.victory`.

## 6. The ONE damage pipeline (`damage.ts`)

Entry points: `resolveAttack(state, declaration)` for attacks and `applyDamage(state, DamageInstance)` for everything
(falls, explosions, physical self-damage). Explosions and crits are processed **depth-first** with an explicit stack:
each crit is fully resolved (including any explosion and its own crits) before the next (CRIT-003).

Ranged or physical attack, as events in order:
1. `state.current` set from the declaration (TN, mods, `pHit`, direction, table).
2. TN ≤ 2 or ≥ 13 handled per TOHIT-002 / PHYS-002 (auto hit still emits `AttackRolled {auto: 'hit', roll: null}`).
   Else `DiceRolled {purpose: 'toHit' | 'physicalToHit', target: tn, mods}` → `AttackRolled`.
   Hook point `attackRolled`. Miss → `AttackEnded {hit: false}` (plus miss consequences: missed-kick PSR, DFA miss fall,
   Streak: no heat and no ammo). Streak hit → its `HeatAdded` and `AmmoSpent` now.
3. Aimed shot hit: `DiceRolled {aimedShot, target: 4}` → `AimedShotResolved`.
4. Cluster weapon: `DiceRolled {cluster, flat: clusterMod}` → `ClusterResolved {hits, groups}`. Groups (HITLOC-010):
   full groups first, leftover last. Non-cluster: one group of the weapon's damage. Physical: groups of 5 where the rule
   says so, else one group. Charge damage to the target is PHYS-043: `ceil(tonnage / 10 × L)` with `N` = the charger's
   MOVE-013 hex count + 1 and `L = N` for `N ≤ 2`, else the lowest hex count of the TOHIT-014 bracket holding `N`
   (3, 5, 7, 10, 18, 25); damage to the charger is `ceil(target tonnage / 10)`. Both in groups of 5, the target's groups
   first (13 R4).
5. Per group, in order: location roll `DiceRolled {hitLocation | punchLocation | kickLocation}` (skipped for an on-target
   aimed shot) → hook `hitLocation` → `HitLocated {location, side, tac}`.
   - Partial cover and a leg location → `HitAbsorbedByCover`; next group.
   - Head location → `PilotHit {cause: 'head'}` (even if armor absorbs it).
   - `applyDamage` (below), then if `tac`: TAC crit check (HITLOC-004).
6. `AttackEnded {hit: true, damageDealt}`; `state.current = null`; event-driven PSRs (kicked, pushed, charged, …) are
   queued by the attack type's module after step 5.

`applyDamage({unitId, amount, location, side, source, sourceUnitId, attackId, internal, noTransfer})`, per location step:
1. If the location is already destroyed: transfer the full amount inward (DMG-003/005, DMG-011 side-torso arms); HD/CT:
   the unit is destroyed (already) and the amount is `lost`.
2. Hook `damage` may adjust the amount (first location only).
3. Armor (rear armor when `side = 'rear'` on a torso; skipped when `internal`) absorbs up to its value.
4. The rest hits structure. `DamageApplied {armorBefore/After, structureBefore/After, transferredTo, transferred, lost}`.
5. Tally: armor + structure removed are added to `ledger.damage[unitId]`; crossing 20 the first time this phase →
   `PsrQueued {damage20, +1}` (PSR-015).
6. Structure > 0 and ≥ 1 structure damage → crit check on this location (CRIT-001, with DMG-004/CRIT-010 re-targeting).
7. Structure reaches 0 → `LocationDestroyed {armorLost}` (remaining armor joins the tally, DMG-010); items destroyed; side
   torso → its arm destroyed (`cause 'sideTorso'`, no tally) and engine slots count as engine crits (DMG-011); leg →
   `PsrQueued {legDestroyed | bothLegs, auto}`; HD/CT → unit destroyed (§5.3). Crit check only for explosive contents
   (CRIT-005).
8. Leftover: `noTransfer` (CASE) → `lost`; HD/CT → `lost`; else continue at step 1 on the inward location (rear armor
   for a rear attack, DMG-006; structure only when `internal`).

Crit check: `DiceRolled {critCheck}` → `CritCheckRolled {crits, blownOff, appliesTo}` → per crit: **one** `DiceRolled
{critSlot}` whose `dice` are `[block, slot]` (12-slot location, both blocks applicable) or `[slot]` alone (6-slot location,
or one block entirely inapplicable); inapplicable slots (`empty`, `structure`, `armor`, already hit) re-roll per CRIT-003,
each re-roll a new `critSlot` roll → `CritSlotHit {token, effect}` → effect events: `ComponentDestroyed`,
`AmmoExploded` / `ComponentExploded` (then `applyDamage {internal: true, source: ammoExplosion | componentExplosion}` and
`PilotHit {explosion}`), `PsrQueued` (gyro, hip, upper/lower leg; one per leg per damage instance, CRIT-095),
`UnitDestroyed` (cockpit, 3rd engine). Crits that find no slot to hit emit one `CritLost {count, why}` per crit check and
reason, after the crits of that check that did land (CRIT-010 location already emptied this phase, or HD/CT with no slot
left: `noSlotThisPhase`, no dice; CRIT-005 non-explosive slot in a location destroyed by this hit: `notExplosive`, after its
`critSlot` roll), so the feed accounts for every crit counted by `CritCheckRolled`. Blown off → `LocationDestroyed {cause: 'blownOff'}`, nothing transfers.

Pilot hits: every `PilotHit` updates `pilot.hits`; at 6 → `PilotKilled`, unit destroyed (`pilotKilled`, per §5.3 window).

## 7. The ONE PSR queue (`psr.ts`)

- Only `queuePsr(state, {unitId, reason, mod, auto, when, levels?})` adds a PSR: it appends to `psr.queue` and to
  `psr.history[unitId]` and emits `PsrQueued`. Only `resolvePsrs(state, scope)` rolls them. No other module rolls a PSR.
- `when`: `'now'` (movement hex entry, stand, landing, displacement and domino) resolves inside the same procedure;
  `'endOfMove'` (PSR-031) when the unit's move ends; `'endOfPhase'` at §5.4 (c).
- Unit order for a batch: initiative order (loser's units first, each side in `unitOrder`).
- Per unit, in queue order:
  1. Destroyed or doomed unit → `PsrDiscarded {why: 'destroyed'}` for all.
  2. Prone unit → entries other than `stand` and `seatbelt` are `PsrDiscarded {prone}` (PSR-004), `auto` entries
     included: automatic falls (leg destroyed, gyro destroyed, both legs) never apply to a unit that is already prone,
     so a prone 'Mech losing a leg or its gyro does not fall again (no second fall damage or seatbelt check).
  3. Any remaining `auto` entry (unit standing) → the unit falls once (`PsrResolved {auto: true, success: false}`); all
     others `PsrDiscarded {alreadyFell}`.
  4. Standing and shut down or unconscious → each fails automatically (PSR-005).
  5. TN = piloting + persistent mods (§4.4) + event mods + hook `psr` lines, where the event mods depend on `when`
     (PSR-001):
     - `'endOfPhase'` entries (the end-of-phase batch, the `damage20` trigger included): Σ `mod` of every entry in
       `psr.history[unitId]` this phase **that was queued with `when 'endOfPhase'`**. Every roll of the batch uses the
       same TN.
     - `'now'` and `'endOfMove'` entries: that entry's own `mod` only. Earlier Movement-phase triggers never carry over,
       so every stand attempt is piloting + persistent − 1 (PSR-019), however many attempts came before.
     TN > 12 → automatic failure, no roll. Else `DiceRolled {psr, target: tn, reason, mods}` → `PsrResolved`.
  6. First failure → fall; the unit's remaining entries in this batch → `PsrDiscarded {alreadyFell}` (PSR-002).
- Fall procedure (PSR-050..058), events in order: `UnitFell {levels, facing kept}` (prone = true) → seatbelt:
  `DiceRolled {seatbelt, target}` (or the automatic pilot hit of PSR-057, no roll) → `PilotHit {seatbelt}` on a failure →
  `DiceRolled {fallSide}` (1d6: 1 rear column, 2–6 front) → per 5-point group `DiceRolled {fallLocation}` → `HitLocated`
  → `applyDamage {source: 'fall'}` (water halving first, PSR-054).
- Sensor checks (PSR-040) use the same queue with `reason 'sensorCheck'` and never cause a fall.

## 8. The ONE heat ledger (`heat.ts`)

- Only `addHeat(state, unitId, {source, amount, ref})` writes heat for the turn: appends to `heatLedger[unitId]`, emits
  `HeatAdded {entry, turnTotal}`. `unit.heat` itself changes only in the Heat Phase (and by HEAT-013 overflow rules).
- Entries and when they are booked:

| Source | Amount | Booked at |
|---|---|---|
| `movement` | walk 1, run 2, jump `max(3, hexes jumped)`; stand still and stand attempts 0 (no entry) | `MoveEnded` |
| `weapon` | data heat (× shots for rapid fire); `ref` = mount id | declaration (`FireDeclared`); Streak only on a hit |
| `engine` | 5 per engine crit (CRIT-031), 0 while shut down | `heat.apply` step, before dissipation |
| `equipment` / `environment` / `other` | hook-provided | when the hook fires |

- `heat.apply` per unit: `generated = Σ entries`; `dissipated` = operable sinks + water bonus (HEAT-010..012) + hook
  delta; `after = max(0, before + generated − dissipated)` → `HeatApplied {before, generated, dissipated, after, entries}`;
  the unit's ledger is cleared. Then restart / shutdown / ammo / life support checks (HEAT-030..040) with rolls
  `startup`, `shutdownAvoid`, `ammoExplosionAvoid` (and `tieBreak` for AMMO-030 ties).
- `query.heatProjection` uses the same functions on a copy of the ledger plus the hypothetical plan.

## 9. Decisions and actions

### 9.1 `PendingDecision`
```ts
interface PendingDecision {
  id: string             // 'd:<n>'
  player: 'A' | 'B'
  kind: DecisionKind
  phase: PhaseId; step: PhaseStep
  unitId: UnitId | null  // the unit the decision is about
  context: DecisionContext   // engine-computed numbers for the prompt (fields per kind below)
  options?: DecisionOption[] // finite decisions: {id, label, action, p?}
  canPass: boolean
}
```
The answer must carry `decisionId === pending.id` and `player === pending.player`.

### 9.2 Kinds

| Kind | Player | Raised at | Context | Answer | Auto-resolved when |
|---|---|---|---|---|---|
| `deploy` | placing side | `deployment.place` | `eligible`, `zone` | `DeployAction {unitId, hex, facing}` (any facing) | never (facing is free) |
| `initiativeAck` | first side with `control 'human'`, else A | `initiative.ack` | `data: {totals, winner}` | `ack` | never |
| `selectUnit` | selecting side | `*.select` | `phase`, `eligible`, `count` | `SelectUnitAction` | one eligible unit |
| `move` | owner | `movement.move` | `mpLeft?`, `lockedMode?`, `entry?` (off-board unit: home edge, entry hexes, start facings) | `MoveAction` (§9.3) | never (stand still is always an option unless §9.3 says otherwise) |
| `standUp` | owner | prone unit selected, or after a fall with MP left (PSR-058) | `psr {tn, mods, p}`, `mpLeft` | `StandUpAction {attempt, mode?, facing?}`; on success the unit takes `facing` (default: current) free (MOVE-042); `legalActions` offers the attempt once per facing | only option is "stay prone" |
| `torsoTwist` | owner | `ranged.twist`, or `physical.twist` when no twist/flip this turn | `twistOptions`, `canFlip` | `TorsoTwistAction` | prone, or no twist/flip possible |
| `declareFire` | owner | `ranged.declare` | `targets` | `DeclareFireAction`: the unit's **whole** declaration in one composite action (§9.7); empty `shots` = hold fire, always legal | the unit has no legal shot (hold fire) |
| `chooseAmmo` | owner | during `declareFire` processing (§9.4) | `mountId`, `bins` | `ChooseAmmoAction {mountId, binId}` | never (raised only with ≥ 2 ammo types) |
| `declarePhysical` | owner | `physical.declare` | `targets`, `data.code 'chargeVoided'` when PHYS-042 lets a charger choose again | `DeclarePhysicalAction` | no legal attack (`none`); a still-valid charge/DFA resolves without a decision |
| `powerChoice` | each side, loser first | `end.power` | `power[] {unitId, options, avoidTn?}` | `PowerChoiceAction {changes}` | not raised unless a unit of that side is voluntarily shut down (restart offered) or `options.manualPower` is true |
| `choice` | as the code says | any | `code`, `data`, `options` | `ChoiceAction {optionId}` | one option |
| `gameOver` | A | `game.over` | `result` | `ack` (no state change) | never |

`choice` codes (each raised only when `setup.options.askDefender` is true, else the default rule of the cited ID applies):
`dividedLos` (target's controller, LOS-005, options `plus`/`minus`), `attackDirection` (ARC-021, two zones),
`dominoDodge` (PHYS-094, `dodgeForward`/`dodgeBackward`/`stay`), `dfaMissMove` (PHYS-066, one option per legal hex),
`displaceSide` (PHYS-067 ties). `spa`: raised by SPA hooks with `usage 'choice'` (always raised).

### 9.3 Flows
**Movement.** `selectUnit` → off-board unit: `move` with `context.entry` (answer must carry `entry`: a virtual off-board
hex adjacent to a home-edge hex and a facing whose forward step enters it; 11 §4.1) → prone unit: `standUp` → else
`move`. A `move` is executed step by step:
- Ground: `steps` in order, then the cheapest turns to `facing` (ties turn right). Each step emits `UnitStepped`;
  hex-entry PSRs (`when 'now'`) roll on entry; a failure → fall in the entered hex, `MoveTruncated`, remaining steps
  dropped; then `standUp` if PSR-058 allows and MP ≥ 2 (or MOVE-014), else the move ends.
- Jump: `jumpTo` and free `facing` → `UnitJumped` → landing PSRs.
- `exit` step on a home-edge hex leaves the board (withdrawing units only, 1 MP) → `UnitExited`.
- End: `endOfMove` PSRs (PSR-031) → `MoveEnded` → movement heat (§8) → `PhysicalDeclaredInMove {kind, targetId,
  fromHex}` for `attack` (§9.6). A move truncated by a fall drops its `attack` (no event).
- Stand-up facing: `StandAttempted.facing` is the `StandUpAction.facing` chosen (free on success; ignored on failure).
  The following `MoveAction.facing` turns still cost 1 MP per hexside from that facing.
- A prone unit that stays prone answers `standUp {attempt: false}` and then gets a `move` whose steps may only be turns.
- Withdrawing units (11 §3.3): `legalActions` offers only paths ending closer to the home edge; stand still only when none exists.

**Ranged.** `selectUnit` → `torsoTwist` → `declareFire` → zero or more `chooseAmmo` / `choice` (resumed via
`state.resume`) → `TorsoTwisted`, `FireDeclared` (primary target = first shot's target; TOHIT-005 checked), `AmmoSpent`,
`HeatAdded` per shot. After the last selection: `ranged.resolve` (§6) in declaration order, then §5.4.

**Physical.** `selectUnit` → `torsoTwist` (if none this turn) → `declarePhysical` → `PhysicalDeclared`. Then resolve
in declaration order (charges and DFAs declared in movement are declarations of their unit's selection), then the
Displacement Step (`UnitDisplaced`, domino PSRs `when 'now'`), then §5.4.

### 9.4 Ammo bin default
When a `FireShot` omits `binId`: eligible bins = bins with `shots ≥ shots needed` (1, or `rapidShots`), not exploded, in a
non-destroyed location, holding an ammo id the weapon lists. All eligible bins hold one ammo id → the bin with the fewest
shots, ties by the record's bin order. Two or more ammo ids → `chooseAmmo` for that mount. None → `E_NO_AMMO`.

### 9.5 `legalActions` (never empty; every member validated)

| Kind | Members (deterministic order) |
|---|---|
| `deploy` | per unplaced unit × zone hex: facing toward the board centre (nearest facing, ties lower) |
| `selectUnit` / `torsoTwist` / `chooseAmmo` / `choice` | one per option |
| `standUp` | stay prone; then, if standing is allowed, one attempt per facing (6) with the allowed `mode` |
| `move` | one per `query.reachable` entry (`action`), stand still first |
| `declareFire` | hold fire **first, always present** (never removed by the cap); then each legal single shot (mount order × target order); then per target, all weapons legal at it as one action; capped at 64 members including hold fire. `binId` omitted (§9.4); multi-target combinations are legal answers but not enumerated (the AI builds them with `query.firePreview`) |
| `declarePhysical` | `none`, then each legal option of `query.physicalOptions` per target |
| `powerChoice` | no change; each single-unit change |
| `initiativeAck` / `gameOver` | `ack` |

`pass` is legal iff `canPass` (no release-1 kind sets it).

### 9.6 Charge and DFA in a move: `MoveAction.attack` and `ReachEntry.physical`
- `MoveAction.attack = {kind: 'charge' | 'dfa', targetId, dfaFrom?}` declares the attack with the move (PHYS-040, PHYS-060).
  - **Charge:** `mode` walk or run. `steps` end in the hex adjacent to the target where the charger waits (they never
    enter the target's hex); the final `facing` must point at the target (`directionTo(end, targetHex)`), and the MP left
    after the move must cover entering the target's hex legally (PHYS-040). `dfaFrom` must be absent.
  - **DFA:** `mode` jump, `jumpTo` = the target's hex. `dfaFrom` = the last hex before the target on the chosen shortest
    jump path (PHYS-061); required only when two path hexes tie, else the engine fills the unique one. `facing` must be
    `directionTo(dfaFrom, targetHex)`.
  - Checks, in §13.1 order: target is an enemy on the board (`E_BAD_TARGET`), PHYS-005 limits (`E_ATTACK_LIMIT`),
    the PHYS-040/060 conditions (`E_BAD_TARGET`), facing (`E_BAD_FACING`), MP (`E_NOT_ENOUGH_MP`).
  - Executing the move emits `PhysicalDeclaredInMove {kind, targetId, fromHex}` with `fromHex` = the waiting hex (charge:
    the move's end hex; DFA: `dfaFrom`). Until resolution the unit counts as standing in `fromHex` facing the target.
- `ReachEntry.physical = {kind, targetId, fromHex} | null`: non-null exactly for entries whose `action.attack` is set;
  the engine lists such entries in addition to the plain entries for the same `(hex, facing, mode)`. For a charge
  `entry.hex` = `fromHex`; for a DFA `entry.hex` = the target's hex and `fromHex` = `dfaFrom`. An entry is
  physicalPreview-able: `query.physicalPreview(state, {attackerId, kind, targetId, attackerAt: {hex: fromHex, facing:
  directionTo(fromHex, targetHex), mode: entry.mode, hexesMoved: entry.hexesMoved, jumped: mode === 'jump'}})` returns the
  numbers the client chip and the AI use (50 §6.8, 40 §9).

### 9.7 Fire declaration: one composite action
- `DeclareFireAction {unitId, shots, propArm?}` is the unit's complete Ranged Attack declaration (the twist or flip was
  answered just before in `torsoTwist`). `validate` checks the whole action at once against the state after the twist;
  any failing shot rejects the whole action (no partial declarations). Checks: protocol, unit, payload shape, then per
  shot in order: weapon known/operable/unused/not duplicated, target, arc, range, LOS and water line, TN ≤ 12, ammo,
  aimed shot, prop arm, rapid mode; then TOHIT-005 across the shots.
- `shots: []` (hold fire) is always legal for a unit that has a `declareFire` decision, and `legalActions` always lists it
  first.
- TOHIT-005: the first shot's target is the primary target. If any declared target is in the attacker's Forward arc and
  the first shot's target is not, the action is rejected with `E_PRIMARY_TARGET`; the engine never reorders shots.
- Ammo: a shot without `binId` takes the §9.4 default; only a mount with ≥ 2 eligible ammo ids raises `chooseAmmo` after
  validation, and the declaration is booked only when every such choice is answered (`state.resume`).

## 10. Events and dice

### 10.1 Event union (`events.ts`)

| Group | Events (emitted when) |
|---|---|
| flow | `GameStarted`, `UnitDeployed`, `TurnStarted`, `PhaseStarted`, `PhaseEnded`, `InitiativeResolved`, `PairStarted`, `UnitSelected`, `DecisionAutoResolved`, `ActionRejected` |
| movement | `MoveStarted` (mode, MP), `UnitEntered`, `UnitStepped` (each step: op, from, to, facing, cost, mpLeft), `UnitJumped`, `StandAttempted`, `MoveTruncated`, `MoveEnded` (hexesMoved, tmm, attackerMod), `PhysicalDeclaredInMove`, `UnitExited` |
| declarations | `TorsoTwisted`, `FireDeclared` (each shot with its frozen TN), `PhysicalDeclared`, `AmmoSpent`, `HeatAdded` |
| resolution | `AttackRolled`, `AimedShotResolved`, `ClusterResolved`, `HitLocated`, `HitAbsorbedByCover`, `DamageApplied`, `LocationDestroyed`, `CritCheckRolled`, `CritLost`, `CritSlotHit`, `ComponentDestroyed`, `AmmoExploded`, `ComponentExploded`, `PilotHit`, `UnitDestroyed`, `AttackEnded` |
| PSR | `PsrQueued`, `PsrResolved`, `PsrDiscarded`, `UnitFell`, `UnitDisplaced` |
| heat | `HeatApplied`, `UnitShutdown`, `UnitRestarted` |
| pilot | `ConsciousnessChecked`, `PilotRecovered`, `PilotKilled` |
| end | `TwistReset`, `StatusChanged`, `UnitRemoved`, `GameEnded` |
| dice | `DiceRolled` (every roll) |

No event exists for skidding, fall facing, ammo dumping or a shutdown PSR (INV-19).

### 10.2 `DiceRolled` and purposes
`DiceRolled {rollId, purpose, dice, kept, total, target?, success?, unitId?, targetId?, attackId?, reason?, mods?}`;
`total = Σ kept + flat`; `success = total ≥ target` when `target` is set. Every purpose has a dice-tray renderer (50 §9).

| Purpose | Dice | Rule IDs | `target` |
|---|---|---|---|
| `initiative` | 2d6 | INIT-002 | — (`reason` = player) |
| `toHit` | 2d6 | TOHIT-001 | TN |
| `physicalToHit` | 2d6 | PHYS-001 | TN |
| `aimedShot` | 1d6 | TOHIT-035 | 4 |
| `cluster` | 2d6 (+`flat`) | CLUS-001 | — |
| `hitLocation` | 2d6 | HITLOC-003 (`reason 'floatingCrit'` for HITLOC-005) | — |
| `punchLocation` / `kickLocation` | 1d6 | HITLOC-006/007 | — |
| `fallSide` | 1d6 | PSR-053 | — |
| `fallLocation` | 2d6 | PSR-052 | — |
| `critCheck` | 2d6 | CRIT-001 | — |
| `critSlot` | 2d6 `[block, slot]` or 1d6 | CRIT-002/003 | — |
| `psr` | 2d6 | PSR-001 (`reason` = `PsrReason`) | TN |
| `seatbelt` | 2d6 | PSR-056 | TN |
| `consciousness` / `recovery` | 2d6 | PILOT-010 / PILOT-020 | TN |
| `shutdownAvoid` / `startup` / `ammoExplosionAvoid` | 2d6 | HEAT-031 / HEAT-040, HEAT-041 / HEAT-034 | avoid number |
| `fallFromAbove` | 2d6 | PHYS-097 | TN |
| `escalatingFailure` | 2d6 | EQUIP-020 | avoid number |
| `jam` | 2d6 | EQUIP-011 (RAC data) | per hook |
| `sensorCheck` | 2d6 | PSR-040 | TN |
| `tieBreak` | 1d6 per candidate | AMMO-030, PHYS-097 random hex | — |

## 11. Queries, describe, hooks

### 11.1 `query.*` (pure; take hypothetical inputs; result types in `index.ts`)

| Query | Returns |
|---|---|
| `distance(a, b)` | hexes |
| `reachable(state, unitId)` | `ReachEntry[]`: per `(hex, facing, mode)` the cheapest path with `PathStep {op, hex, facing, cost {base, terrain, level, turn, total}, psr}`, `mpUsed`, `hexesMoved`, `tmm`, `attackerMod`, `heat`, `psrs [{reason, tn, p}]`, `endsProne`, `physical?`, ready `action` |
| `los(state, from, to, opts?)` | `LosVerdict {visible, attackAllowed, divided, chosen, hexes, alt, blockers, woodsPoints, partialCover, reasons}`; `opts.fromAt` / `opts.toAt` (`UnitAt`) override a unit endpoint's hex and prone state, or give a hex endpoint a 'Mech (default for a hex: standing 'Mech, not submerged) |
| `arcs(state, unitId, twist?)` | hex sets per arc and the arcs each mount fires into |
| `attackPreview(state, req)` | `AttackPreview {legal, reason?, why?, distance, band, tn, mods[], pHit, direction, table, partialCover, los, heat, damage, cluster?, expectedDamage}` (`attackerAt`/`targetAt` override position, facing, twist, mode, TMM) |
| `firePreview(state, unitId, plan)` | per-weapon `AttackPreview[]`, primary target, heat projection with move and weapon parts |
| `physicalPreview(state, req)` / `physicalOptions(state, attackerId, targetId)` | `PhysicalPreview {legal, tn, mods, pHit, damage, table, selfDamage, attackerPsr, targetPsr, displacement, choice}` |
| `hitTable(direction, table, opts)` | location → probability, TAC location and chance |
| `clusterTable(rackSize, modifier)` | `P(hits = k)` |
| `heatProjection(state, unitId, plan)` | `{now, entries, generated, dissipation, end, effects}` |
| `heatEffects(heat)` / `heatScale()` | thresholds of 10 §13.2 |
| `psrPreview(state, unitId, reason)` | `{tn, mods, p, auto}` |
| `fallPreview(state, unitId, levels?)` | damage, groups, location distribution, seatbelt TN |
| `explosionPreview(state, unitId, slot)` | damage, location, transfer chain, pilot hits, destroys unit |
| `isKillLocation(state, unitId, loc)` / `mustWithdraw(state, unitId)` | boolean |
| `sheet(state, unitId)` | record-sheet view model (our layout) |
| `terrainInfo(state, hex)` | label, level, terrain, depth, MP cost per mode, LOS effect text |
| `hexToWorld(state, hex)` | centred world `{x, z}` |
| `p2d6(tn)` | `P(2d6 ≥ tn)`; implemented (`p2d6AtLeast`) |
| `threat(state, hex)` | `ThreatView {hex, bySide, sources}`: expected damage to a standing 'Mech at the hex from each side's units where they stand (release 1; the AI threat model is 40-ai §5, M4) |

The client maps any naming difference inside `src/client/contract.ts` (50 §2). Odds are always engine values.

### 11.2 Mods
`Mod {code: ModCode, value, detail?}`. Every TN in a preview, a declaration, a decision context and a `DiceRolled` carries
its full list, base skill included (`gunnery`/`piloting` line first), so `tn = Σ value`.

### 11.3 `describe.*`
`decision(state, pending) → {title, prompt, lines}`, `event(state, event) → string`, `action(state, action) → string`,
`unit(state, unitId) → string`, `location(loc) → string` (implemented). Text is ours, names real; never the phrase
"Weapon Attack Phase".

### 11.4 Code hooks (`hooks.ts`)
Data names hooks (`code`, SPA `hook`); `code-hooks.ts` registers a `CodeHook {name, points, <method per point>}` for each
name in `EQUIPMENT_HOOKS` and each `spa.<name>`. Core calls them only through `collectHooks(state, unitId, point)` at the
places in `HOOK_WIRING`:

| Point | Called from |
|---|---|
| `passive` | values read by queries and rules |
| `setup` | `createGame`, once per unit |
| `initiative` | initiative roll modifier |
| `movement` | MP computation and move handler |
| `attackDeclare` | declaration validation |
| `toHit` | modifier lists |
| `attackRolled` | after the to-hit roll |
| `hitLocation` | after the location roll |
| `cluster` | cluster roll modifier |
| `damage` | before armor, per hit |
| `crit` | when a slot of the item is hit |
| `psr` | PSR TN lines |
| `heat` | Heat Phase entries and dissipation |
| `consciousness` | consciousness and recovery TN lines |
| `endPhase` | once per unit per End Phase |

Hooks are pure (`HookResult {state, events}`) and roll only through `roll`. `code-hooks.ts` (M2) registers `ultraRapid` as a
no-op hook that never rolls (EQUIP-011: Ultra ACs never jam); only the rotary AC's data `jamHook` rolls `jam`.

### 11.5 Hypothetical-position queries (40-ai §13)
The AI and the client ask "what if" without building a state. Every query below is pure, never advances `rng` or any
counter, and returns exactly the numbers `step` would produce if the state matched the hypothesis.

| Query | Hypothetical inputs | Returns (fields the AI reads) |
|---|---|---|
| `reachable(state, unitId)` | – (from the unit's current position and MP) | `ReachEntry {hex, facing, mode, path, mpUsed, hexesMoved, tmm, attackerMod, heat, psrs [{reason, tn, p}], endsProne, physical, action}` (§9.6) |
| `attackPreview(state, req)` | `attackerAt`, `targetAt` (`UnitAt`), `primaryTargetId`, `aimedAt`, `binId`, `propArm`, `rapidShots` | `{legal, reason?, tn, mods, pHit, band, direction, table, partialCover, los, heat, damage, cluster, expectedDamage}` |
| `firePreview(state, unitId, plan)` | `FirePlan` (twist/flip, shots, prop arm) | per-shot previews with the plan's primary target, heat with move and weapon parts |
| `hitTable(direction, table, opts)` | `prone`, `partialCover` | location → probability, TAC location and chance |
| `clusterTable(rackSize, modifier)` | – | `P(hits = k)` for k = 0..rackSize |
| `heatProjection(state, unitId, plan)` | `HeatPlan {mode, hexesJumped, mounts, rapidShots}` | `{now, entries, generated, dissipation, end, effects}` |
| `heatEffects(heat)` | any heat value | MP loss, to-hit mod, shutdown TN, ammo TN, life-support hits |
| `physicalPreview(state, req)` | `attackerAt`, `targetAt`, `kind`, `limb` | `{legal, tn, mods, pHit, damage, table, selfDamage, attackerPsr, targetPsr, displacement, choice}` |
| `psrPreview(state, unitId, reason)` | – | `{tn, mods, p, auto}` |
| `fallPreview(state, unitId, levels?)` | levels fallen | damage, groups, location distribution, seatbelt TN, `P(pilot hit)` |
| `explosionPreview(state, unitId, slot)` | the slot assumed hit | damage, location, transfer chain, pilot hits, destroys unit |
| `isKillLocation(state, unitId, loc)` | – | true when destroying `loc` destroys the unit (HD, CT, or a side torso whose engine slots bring the unit to 3 engine crits, DMG-011) |
| `mustWithdraw(state, unitId)` | – | true when forced withdrawal is on and 11 §3.2 triggers |
| `los(state, a, b, opts?)` | `opts.fromAt`, `opts.toAt` | `LosVerdict` |

`UnitAt` semantics (every field optional; an omitted field keeps the unit's current value):
- `hex`, `facing`, `twist`, `prone`: position used for range, arcs, LOS levels, partial cover and attack direction.
- `mode`: attacker movement modifier (TOHIT-012) for an attacker; `hexesMoved` + `jumped`: TMM (TOHIT-014/015) for a
  target. `tmm` overrides the computed TMM directly. `immobile`: forces TOHIT-017 on or off.
- `attackPreview.primaryTargetId`: omitted or `null` → the request's target is treated as primary; another unit id →
  this target is secondary (+1, TOHIT-024) and TOHIT-005 is checked against it.
- A hypothetical position that is illegal for the unit (occupied, off board) still returns numbers; `legal` reflects only
  the attack's own checks.

## 12. Determinism, RNG, replay, save, Decider

### 12.1 RNG (`rng.ts`, implemented, copied from Whirr Machine)
- sfc32 seeded by `cyrb128(seed)` with **15** warm-up draws (`seedRng`). State lives in `state.rng`.
- `roll(state, {count, sides: 6, purpose, unitId?, targetId?, attackId?, target?, flat?, mods?, reason?})` is the only
  way the engine rolls; it advances `rng` and `rollSeq` and returns `{state, event: DiceRolled}`. Engine modules import
  `roll` from `./rng` (never a local copy) so the forced-dice mock of 60 §6 intercepts every roll (`diceEvent` builds the
  same event for forced faces). A same-file helper or a re-exported alias would bypass `vi.mock('./rng')`, so none may
  exist. A forced roll advances `rollSeq` (so roll ids stay `r:<n>` in order) but does **not** advance `state.rng`: the
  next unforced roll draws exactly what it would have drawn first.
- Out-of-engine randomness: `deriveSeed(...parts) → RngState` (AI: `deriveSeed(gameSeed, 'ai', side, decisionSeq, tier)`)
  and `deriveSeedString(...parts) → string` (sim game seeds). Never touches `state.rng`.

### 12.2 Replay
`replay(setup, seed, bundle, log)` reproduces every state; INV-20 compares `hashState`. Auto-resolved decisions and
clock-free rules make the log the complete input.

### 12.3 Save, load, undo
`SaveFile {format: 1, engine, dataVersion, setup, seed, actions, meta {savedAt, label}}` (the client passes `savedAt`;
the engine never reads the clock). Load = replay. Undo = replay minus the trailing actions back to the human's previous
decision (vs AI only). Storage: `localStorage` `wmf.save.<slot>` and `wmf.autosave` (each turn), wrapped in try/catch;
export as `.json`.

### 12.4 Unit and decision ids
Units `A1..`, `B1..` (force order); decisions `d:<n>`; rolls `r:<n>`; attacks `a:<n>`; PSRs `p:<n>`.

### 12.5 Decider (`decider.ts`)
```ts
interface Decider { decide(view: PlayerView, pending: PendingDecision, legal: Action[]): Promise<Action> }
```
- One interface for the human (interaction layer), AI (`40-ai`, worker), random bot and replay.
  `createRandomDecider(seed)` and `createReplayDecider(actions)` are implemented. `AiTier = 'random' | 'easy' | 'normal'`.
- `GameRunner` (`src/client/store/`) is the ONLY caller of `step`; the bot answers only when the presentation is idle,
  with a 5 s no-progress watchdog that force-answers bot-owned decisions with `legal[0]`.

## 13. Rejection codes and budgets

### 13.1 `RejectionCode` (`REJECTION_CODES` in `types.ts`; new codes are additive)

| Group | Codes |
|---|---|
| protocol | `E_WRONG_DECISION` (wrong id or action type for the kind), `E_NOT_YOUR_DECISION`, `E_NOT_AN_OPTION`, `E_BAD_PAYLOAD` (malformed), `E_BAD_SETUP`, `E_DATA_VERSION`, `E_GAME_OVER` |
| unit | `E_UNKNOWN_UNIT`, `E_NOT_YOUR_UNIT`, `E_NOT_ELIGIBLE` (not selectable / already acted / not the active unit), `E_SHUTDOWN`, `E_UNCONSCIOUS` |
| movement | `E_OFF_BOARD`, `E_BAD_FACING` (not 0–5), `E_PROHIBITED_HEX` (MOVE-030), `E_OCCUPIED`, `E_NOT_ENOUGH_MP`, `E_BAD_MODE` (mode lacking MP, jump while prone, mode change after lock), `E_NO_BACKWARD` (run backward), `E_LEVEL_CHANGE` (3+ levels, hip limit), `E_PRONE` (action needs standing), `E_CANNOT_STAND` (MOVE-043), `E_CANNOT_JUMP`, `E_JUMP_TOO_HIGH` (MOVE-051), `E_BAD_ENTRY` (edge entry), `E_EXIT_EDGE`, `E_WITHDRAWAL` (11 §3.3), `E_NO_TWIST` (twist/flip illegal or already used) |
| ranged | `E_UNKNOWN_WEAPON`, `E_WEAPON_DESTROYED`, `E_WEAPON_USED`, `E_DUPLICATE`, `E_OUT_OF_ARC`, `E_OUT_OF_RANGE`, `E_NO_LOS`, `E_WATER_LINE` (LOS-040), `E_FRIENDLY_TARGET`, `E_TN_TOO_HIGH`, `E_NO_AMMO`, `E_WRONG_AMMO`, `E_PRIMARY_TARGET` (TOHIT-005), `E_AIMED_SHOT` (TOHIT-030), `E_NO_RANGED` (sensors ×2, charge/DFA declared), `E_PROP_ARM` (TOHIT-008), `E_RAPID_MODE` |
| physical | `E_NOT_ADJACENT`, `E_LEVEL_DIFF` (PHYS-020..026), `E_LIMB_UNAVAILABLE` (arm fired, shoulder crit, hip crit, leg weapon fired), `E_ATTACK_LIMIT` (PHYS-005), `E_NO_PHYSICAL` (prone, shut down), `E_BAD_TARGET` |

When several checks fail, the first in this order is reported: protocol → unit → payload shape → the rule checks in the
order the table lists them.

### 13.2 Performance budgets

| Item | Budget |
|---|---|
| `step` | ≤ 1 ms median, ≤ 5 ms p99 (node, laptop class), excluding the AI |
| `legalActions` | ≤ 10 ms p99; `move` ≤ 20 ms p99 |
| `query.reachable` | ≤ 5 ms per unit (run 9 MP / jump 8 on a 16 × 17 board) |
| `query.los` | ≤ 0.05 ms per pair |
| `npm run sim` | random-vs-random 2v2 game ≤ 1.5 s; 50-game batch ≤ 2 min |
| AI decision (normal) | ≤ 500 ms p95, 2 s hard cap in the worker |
| JS | initial chunk ≤ 350 KB gz; engine+data ≤ 250 KB gz; ai ≤ 150 KB gz |
| Frame | 60 fps at 1080p mid GPU; ≤ 200 draw calls; ≤ 400k triangles on board |

## 14. Contract change log (additive only)

| Date | File | Change | Why |
|---|---|---|---|
| 2026-10-08 | events.ts | `CritLost {unitId, location, count, why: 'noSlotThisPhase' | 'notExplosive'}` | crits dropped by CRIT-010 / CRIT-005 had no event (GOLD-009) |
| 2026-10-08 | actions.ts | `StandUpAction.facing?: Facing` | MOVE-042 free facing on a successful stand could not be expressed |
| 2026-10-08 | index.ts | `SheetView`: `bv`, `adjustedBv`, `mp.walkMods`, `pilot.consciousnessTns`, `sinks.type`, `status` | record sheet numbers had no query source |
| 2026-10-08 | hooks.ts | hook `ultraJam` renamed `ultraRapid` (no-op, never rolls; 2026 W11: Ultra ACs do not jam) | avoid wiring a TW jam roll |
| 2026-10-08 | 00 §7 | prone check precedes `auto` entries (PSR-004) | double fall on a prone unit |
| 2026-10-08 | rng.ts, index.ts | helpers beyond the brief, now part of the contract: `rng.diceEvent` (forced-dice mock, 60 §6), `rng.deriveSeedString` (sim seeds are strings, 60 §4), `index.hashState` / `stableStringify` (INV-20), `p2d6AtLeast`, `registerBundle` / `bundleFor` (§2) | recorded at the pre-freeze review (M0 follow-up WP-CORE 19) |
| 2026-10-08 | index.ts | `query.los(state, from, to, opts?: LosOptions)`, `LosOptions {fromAt?, toAt?}` (§11.5) | 40-ai §13 needs LOS from hypothetical positions |
| 2026-10-08 | index.ts | `ReachEntry.physical` gains `fromHex?: Hex` (always set by the engine) | §9.6: the waiting hex a physicalPreview needs for a charge/DFA entry |
| 2026-10-08 | index.ts, actions.ts | doc comments only: §9.6 meaning of `MoveAction.attack` / `ReachEntry.physical`; §9.7 composite `DeclareFireAction`, `E_PRIMARY_TARGET`, hold fire always legal; §11.5 `UnitAt` and `primaryTargetId` semantics | pre-freeze clarifications (WP-CORE 9, 11, 16, 17) |
| 2026-10-08 | types.ts | comment on `PHASE_STEPS`: `*.endOfPhase` runs §5.4 (a)–(e) | §5.4 rewritten (consciousness before the PSR queue, extra check for fall hits) |
| 2026-10-08 | 00 §5.4, §7 | §5.4 order (a) effects/removal, (b) consciousness, (c) PSR queue, (d) consciousness for fall hits, (e) crippled/victory; §7 step 5 sums history mods only for `endOfPhase` entries | matches 10 INIT-013 and PSR-001 (WP-CORE 13, 14) |
| 2026-10-08 | hooks.ts | `collectHooks` body (M2); additive `registeredHooks()` and `collectHooksWith(data, state, unitId, point)` (the damage pipeline's Work carries its own bundle); the registry is built from `CODE_HOOKS` in `code-hooks.ts` | M2 hook wiring (60 §7) |
| 2026-10-08 | index.ts | `query.threat(state, hex)` returns `ThreatView {hex, bySide, sources}` (was `never`, an M4 placeholder); `ThreatView` exported | release-1 threat view for the client overlay; the AI's model stays 40-ai §5 |
| 2026-10-08 | index.ts | `registerBundle` / `bundleFor` live in `bundles.ts` and are re-exported from index under the same names; API bodies delegate to `machine.ts`, `queries.ts`, `describe.ts` | rules modules read the bundle without an import cycle through index |
| 2026-10-08 | events.ts | `DamageApplied.reduced?: number` (points ferro-lamellor stopped at that location; a fully stopped hit emits `damage: 0`) | M5 ferro-lamellor (10 EQUIP-014) |

### Rulings made in this spec

| Rule | What we did | Why |
|---|---|---|
| End Phase pilot hits (CRIT-061) | consciousness check in a new step `end.consciousness` right after `end.lifeSupport` | PILOT-010 checks after any phase with new hits; INIT-015 lists no step for it |
| Ammo bin default (AMMO-001) | omitted `binId` → fewest shots, ties by record order; ≥ 2 ammo types → `chooseAmmo` | the player chooses per shot; the default keeps decisions few and empties partial bins first |
| Rapid-fire draw | one bin must hold every shot of a rapid-fire attack | keeps one bin per shot (AMMO-001) |
| Heat restart (HEAT-040) | a heat-shut-down unit always attempts to restart when allowed; no decline option | no release-1 reason to stay down; 40-ai always restarts |
| Voluntary shutdown (HEAT-041) | `powerChoice` only when a unit is voluntarily shut down, or `options.manualPower` | avoids a prompt every End Phase |
| Victory timing (10 SCN-020 vs 11 §5) | checked whenever a unit is eliminated outside a simultaneous window, and at `end.victory` | equivalent to "after every damage resolution" given INIT-012 simultaneity |
| Initiative pacing | `initiativeAck` every turn for the first human side (A in AI vs AI) | gives the presentation a stop; not a rule |
| Defender choices (LOS-005, ARC-021, PHYS-067 ties, PHYS-094 dodge) | made automatically by the defender-favouring default rule; `setup.options.askDefender` (default false) turns them into `choice` decisions | keeps decisions few; the default always picks the option best for the defender |
| Initiative roll order (INIT-002) | side A rolls first, then B; a tie re-rolls A then B | forced-dice tests need one order (13 R1) |
| Attack-direction zones (ARC-020) | six 60° wedges through the hex corners, Front/Rear one wedge, sides two | AGoAC diagram; MegaMek side table not re-fetched in the 2026-10-08 check |
