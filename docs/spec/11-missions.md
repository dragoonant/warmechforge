# 11: Missions

Missions are data (`src/data/missions/<id>.json`, schema `mission.schema.json`, fields in `20-data-schema.md` §10).
Turn structure, movement, attacks, heat, damage and PSRs belong to `10-rules-core`; this spec owns setup, deployment,
elimination, forced withdrawal, victory and the mission list. All text shown to players is our own words.

Values marked **(2026?)** are our best reading where the 2026 Core Rules text is not in hand; each has a RULING in §9.

## 1. Setup

### 1.1 `MissionSetup` (runtime object, built by the start screen or URL params)

| Field | Type | Default | Notes |
|---|---|---|---|
| `missionId` | Id | — | |
| `mapId` | Id | mission `map` | required when mission `map` = `choose` |
| `sides[2]` | `{sideId, control: 'human'\|'ai', force: Force}` | from mission | `force` is the resolved force record (fixed or picked) |
| `forcedWithdrawal` | boolean | `on` → true, `off`/`playerChoice` → false | editable only when the option is `playerChoice` |
| `turnLimit` | int \| null | mission `turnLimit` | editable for `kind: skirmish` only |
| `bvBudget` | int \| null | mission `options.bvBudget` | skirmish only |
| `seed` | string | random word | |

- `createGame(setup, seed, bundle)` rejects (code, not throw) a setup whose side forces exceed `bvBudget`, use a side id
  not in the mission, or name a map that fails validation.
- Ammo choices and half loads live on the force units (`20-data-schema.md` §9). Half loads are offered only when
  `options.halfLoads`; pilot cards and SPAs only when `options.pilotCards`.
- Release 1 is one human vs one AI. `control: 'either'` lets the start screen assign either; `?control=bot,bot` runs AI vs AI.

### 1.2 Home edges and map edges

- `north` = row `01`, `south` = row `height`, `west` = column `01`, `east` = column `width` (every hex whose label has that
  row/column). The two sides of a mission must have opposite home edges (validated).
- "Toward the home edge" = the hex-distance from the unit's hex to the nearest hex of the home edge decreases.

## 2. Unit status and elimination

### 2.1 Status values (engine `UnitStatus`)

| Status | Set when | On map | Counts as eliminated |
|---|---|---|---|
| `offBoard` | before entry (edge entry) | no | no |
| `active` | entered or placed | yes | no |
| `crippled` | §2.2 condition true (re-checked after each damage resolution and in the End Phase) | yes | **yes** if the mission's `eliminate.cripple` is true |
| `withdrawing` | forced withdrawal triggered (§3) | yes | no |
| `withdrawn` | left the map by its home edge while `withdrawing` | no | yes |
| `surrendered` | §3.4 | no (removed) | yes |
| `destroyed` | destruction per 10-rules-core (CT or head destroyed, MechWarrior killed, 3 engine hits, displaced off the map: cause `displacedOff`, HEX-010 ...) | wreck stays | yes |

- `crippled` is a flag on top of `active`/`withdrawing`: a crippled 'Mech keeps fighting unless forced withdrawal moves it.
- There is no `fled` status. A unit forced off the map (displacement, charge, DFA, push) is `destroyed` with cause `displacedOff`. Voluntary exits exist only for `withdrawing` units on their home edge (`withdrawn`, §3.3); a voluntary exit by any other edge is never legal (rejected).
- Wrecks stay in their hex (terrain effects owned by 10-rules-core).

### 2.2 Crippled (2026?) - the single condition list

This section and §3 are the only place these conditions are defined. 10-rules-core SCN-021, SCN-030 and SCN-031 point
here and carry no conditions of their own.

A 'Mech is crippled when **any** of these is true:
1. a leg is destroyed (one or both);
2. no weapon can fire: every weapon destroyed, jammed, or with no ammo left in any bin it can use;
3. gyro destroyed;
4. 2 or more engine critical hits.

The conditions come from the AGoAC scenarios; the 2026 changelog gives no new numbers (2026?). The earlier draft's "pilot
unconscious" condition is removed: 10-rules-core never had it and unconsciousness is handled by the PILOT rules.

## 3. Forced withdrawal (optional rule; 2026 rewrite, details (2026?))

### 3.1 When it applies

Only when `setup.forcedWithdrawal` is true. Both sides, human and AI, follow it.

### 3.2 Trigger (crippling damage)

A unit becomes `withdrawing` the moment any of these is true (checked after each damage resolution):
1. any §2.2 condition (crippled);
2. a side torso destroyed;
3. its MechWarrior has taken 4 or more hits;
4. 2 or more sensor critical hits.

The earlier "structure damage in 3+ locations" trigger is removed (no source). This is the 10-rules-core SCN-030 list.

A withdrawing unit stays withdrawing for the rest of the game.

### 3.3 Movement while withdrawing

- In each Movement Phase it must move, and its path must end at least one hex closer to its home edge than it started
  (`legalActions` offers only such paths; standing still is legal only when no such path exists, which starts §3.4).
- It may run or jump; it may stand up from prone (the stand-up attempt counts as its movement if it fails).
- It may make attacks normally.
- On a home-edge hex it may spend 1 MP to leave the map (status `withdrawn`). It may never leave by another edge.

### 3.4 Forced surrender (2026?)

At the End Phase, a withdrawing unit that is immobile, has 0 MP in every movement mode, or is prone and cannot stand
**surrenders**: it is removed from the map with status `surrendered` (destroy cause `surrendered`; counts as destroyed for
victory). A unit with no legal path closer to its home edge does not surrender; it simply stays put (§3.3).

## 4. Deployment

### 4.1 `edgeEntry` (2026 generic deployment, details (2026?))

- All of the side's units start `offBoard`.
- In the Movement Phase of **turn 1**, a unit moving for this side enters: its first step moves from an imaginary hex just
  off the home edge into any home-edge hex, paying that hex's normal MP cost (terrain + level change from the hex's own
  level, i.e. the off-map hex is treated as the same level as the entry hex). It may walk or run; it may not jump on its
  entry turn (10-rules-core SCN-002). The entry hex counts toward hexes moved for the attacker movement modifier and for TMM.
- Its starting facing (before the first step) is the facing pointing straight into the map: south edge → 0 (north),
  north edge → 3 (south), west edge → 1/2 (player chooses), east edge → 4/5 (player chooses).
- Every unit must enter on turn 1. Entry hexes the unit cannot afford are not offered; validate-data guarantees every
  home edge has an entry hex costing ≤ 2 MP (§9), so `legalActions` is never empty.
- Initiative and move order are unchanged: the side that lost initiative moves (and enters) a unit first.
- Units off the map cannot attack or be attacked.
- Systems start in their default state (no shutdown, heat 0); 2026 allows choosing activated/deactivated systems at
  entry, which no release-1 item needs.

### 4.2 `edgePlace`

Before turn 1, the sides alternate placing one unit at a time on any empty hex within `depth` rows (or columns) of their
home edge, with any facing; `sides[0]` places first. Then turn 1 starts with the Initiative Phase.

### 4.3 `hexes`

As `edgePlace`, but only on the listed hexes.

## 5. Victory

`victory[]` entries are checked in order after every damage resolution, after each Movement Phase (withdrawals), and in
the End Phase. The first that resolves ends the game with an outcome `{winner: sideId | null, reason}`.

| Type | Resolves when | Outcome |
|---|---|---|
| `eliminate` | every unit of one side is eliminated (§2.1) | the other side wins; if both sides are fully eliminated at the same check: draw |
| `turnLimitBV` | End Phase of `turnLimit` | side that eliminated more enemy **base** BV wins (crippled-but-on-map units count only if `cripple` is true); equal = draw |
| `objective` | its hook returns an outcome | as returned |

- With no `turnLimit`, `turnLimitBV` is ignored.
- The end screen shows: winner, reason, turns played, per unit status, damage dealt/taken, BV eliminated per side.

## 6. Intro mission (`mission.intro`)

The Core Box intro game, as best known (brief E.1/G.1). No public description of it was found (searches 2026-10-08:
Sarna Core Box page, retailer listings, review citations), so every field below is **verify** until the owner's booklet
is read. Display name: "Intro Mission" until the booklet's title is known.

| Field | Value | Status |
|---|---|---|
| `kind` | `intro` | |
| `map` | `map.scorched-oasis` (one sheet, 16 × 17, desert theme) | verify; brief says Arid Canyons / Scorched Oasis, so `mapChoices` = both |
| Side `a` | label "Eris Lance"; force `force.intro-a`: Eris ERS-2N + Uziel UZL-2S, 4/5, no pilot cards | verify (Uziel may be the UZL-9S) |
| Side `b` | label "Solitaire Lance"; force `force.intro-b`: Solitaire 3 + Rakshasa MDG-3D, 4/5, no pilot cards | verify; if 3 / MDG-3D are unsourced at M3, use Solitaire Prime and Rakshasa MDG-1A with `stock: true` |
| Home edges | `a` south, `b` north | ours |
| Deployment | `edgeEntry` both sides | per brief |
| `defaultHumanSide` | `a` | ours |
| `turnLimit` | none | |
| `victory` | `[{type:'eliminate', cripple:true}]` | AGoAC pattern |
| `options` | `forcedWithdrawal: 'off'`, `halfLoads: false`, `pilotCards: false` | ours (keeps the first game simple) |
| `specialRules` | none | |
| Briefing | our own two-sentence setup: two lances meet in the desert; the last lance with a working 'Mech wins | ours |

- **Force balance check:** base BV a = 1400 + 1352 = 2752; b = 1608 + 2100 = 3708 (b is 35% heavier). If the booklet
  confirms these forces, keep them; otherwise this imbalance suggests different variants or skills. Flag in the morning
  summary; do not rebalance silently.
- Figures: both variants of a chassis share one figure.

## 7. Skirmish (`mission.skirmish`)

Generic battle for any forces.

| Field | Value |
|---|---|
| `kind` | `skirmish` |
| `map` | `choose` (any ready map; default the first by `order`) |
| Sides | `a` "Blue", `b` "Red"; `force: 'pick'`; `control: 'either'` |
| Home edges | `a` south, `b` north (setup may swap to west/east; must stay opposite) |
| Deployment | `edgeEntry` |
| `options.bvBudget` | 7500 per side (adjusted BV; about half the 15103 total of the eight box 'Mechs); setup range 1000–20000 in steps of 250 |
| Units per side | 1–4 (one lance) by default; validate-data allows up to 12 |
| `turnLimit` | none by default; setup choices none / 8 / 12 / 16 |
| `victory` | `[{type:'eliminate', cripple:true}, {type:'turnLimitBV'}]` |
| `options` | `forcedWithdrawal: 'playerChoice'`, `halfLoads: true`, `pilotCards: true` |

- The AI force picker (40-ai) fills its side to within 10% under the budget.
- A side may field the same variant more than once (one figure per unit).

## 8. Core Box missions (placeholders)

Five missions from the Core Box rulebook (brief E.1); only "Focal Point" is named publicly. Each ships as a data file with
`status: 'todo'` (hidden from the start screen) until the owner's booklet is read; then it gets real fields, its own
section here, and any objective hooks in `code-hooks.ts`.

| Id | Name | Status | Known | To fill |
|---|---|---|---|---|
| `mission.focal-point` | Focal Point | TODO | name only | map(s), forces/BV, deployment, objectives (likely an objective-hex hook), turn limit |
| `mission.box-2` | TODO | TODO | — | everything |
| `mission.box-3` | TODO | TODO | — | everything |
| `mission.box-4` | TODO | TODO | — | everything |
| `mission.box-5` | TODO | TODO | — | everything |

Placeholder file shape (valid against the schema):

```json
{"id":"mission.focal-point","name":"Focal Point","kind":"box","status":"todo","map":"choose",
 "sides":[{"id":"a","label":"Side A","force":"pick","homeEdge":"south","deployment":{"mode":"edgeEntry"}},
          {"id":"b","label":"Side B","force":"pick","homeEdge":"north","deployment":{"mode":"edgeEntry"}}],
 "victory":[{"type":"eliminate","cripple":true}],"options":{"forcedWithdrawal":"playerChoice","bvBudget":7500},
 "source":{"ref":"ours","note":"placeholder"},"verify":[{"path":"","note":"Core Box mission not yet read","status":"standIn"}]}
```

Objective hooks expected (names reserved): `holdHex` (control a hex at the End Phase for N turns), `exitUnits` (move N
units off an edge), `destroyTarget` (a marked unit). Each is specified when its mission is filled.

## 9. Validation (validate-data)

| Check | Rule |
|---|---|
| sides | 2 sides with distinct ids; opposite `homeEdge`s; `defaultHumanSide` is one of them |
| refs | `map` and `mapChoices` resolve to maps; fixed `force` ids resolve |
| deployment | `hexes` labels exist on the map; `edgePlace.depth` < half the map dimension across the edges |
| entry | every home edge has at least one hex enterable from off-map for ≤ 2 MP (clear/road/pavement, no level change > 1, not depth 2+ water) |
| BV | a fixed force's adjusted BV ≤ `options.bvBudget` when both are set |
| status | `todo` missions are skipped by the start screen and by `tools/sim.ts` |
| victory | `turnLimitBV` requires `turnLimit` or `kind: skirmish` |

## 10. Test hooks for 12-rules-test-checklist

Suggested IDs (the checklist owns the final list): `MSN-001` edge entry pays the entry hex cost; `MSN-002` crippled by two
engine hits ends the intro when the last enemy is crippled; `MSN-003` both sides eliminated in one check = draw;
`MSN-004` withdrawing unit must end closer to its home edge; `MSN-005` withdrawing unit leaves by home edge →
`withdrawn`; `MSN-006` immobile withdrawing unit surrenders at the End Phase; `MSN-007` a unit displaced off the map is
`destroyed`, cause `displacedOff`; a voluntary exit by a non-home edge is rejected; `MSN-008` `turnLimitBV` tie = draw.
