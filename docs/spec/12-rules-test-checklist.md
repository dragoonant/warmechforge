# 12 Rules test checklist

One line per testable rule in `10-rules-core.md`. Each engine test title starts with the ID (`it('HEAT-022 ...')`);
`tools/checklist-coverage.ts` greps titles under `tests/` (`60-testing.md` §2). All prose is ours.

## 0. How to read and use this file

| Column | Meaning |
|---|---|
| ID | Same ID as in `10-rules-core.md`. Never renumbered. A new rule in 10 gets a new line here in the same commit |
| Assertion | What the test must prove, with concrete numbers. Numbers come from 10; if they disagree, 10 wins and this line is fixed |
| P | **P1** = `must` at M2 (engine complete) because the M3 slice (intro 2v2, Scorched Oasis: hills, woods, rough, depth 1 water, jump-capable 'Mechs, edge entry) exercises it. M1 `must` = the P1 lines of HEX, LOS, MOVE, ARC. **P2** = `must` at M8 (optional rules, equipment outside the slice, rare cases). **P3** = no test yet (reserved, deferred or no engine behaviour); the coverage tool lists P3 IDs but never fails on them |

Conventions used below:
- "Piloting 5" / "Gunnery 4" are the pilot's skill numbers. TN = target number. `[a,b]` = forced dice faces.
- Hex coordinates are axial `(q, r)`, as in `13-golden.md` §1.
- Tests build states through `createGame` + `step` or `tests/fixtures/build.ts` helpers, with forced dice for every roll
  whose value matters (`60-testing.md` §6).
- "Event" means an engine event; "legal" means present in `legalActions`.

## 1. HEX: conventions

| ID | Assertion | P |
|---|---|---|
| HEX-001 | 2d6 vs TN 8: forced `[3,5]` succeeds, `[3,4]` fails. Every engine roll goes through `roll(state, spec)` and emits `DiceRolled` with `rollSeq` +1 | P1 |
| HEX-002 | Rounding: 55 t punch `ceil(5.5)` = 6; 65 t kick `ceil(13)` = 13; punch 7 halved once = 3, 6 halved twice = 1 (minimum 1); 9 fall damage halved in water = 4 | P1 |
| HEX-003 | Label round trip for every hex of a 16 × 17 sheet. Axial `(0,0)` prints `0101`; `(1,0)` prints `0201` and its centre is lower than `0101`'s; `(6,4)` prints `0708`; `(7,3)` prints `0807`; `(8,3)` prints `0908`; `0505` ↔ `(4,2)`, `0605` ↔ `(5,2)`, `0201` ↔ `(1,0)` (00 §3.1 table) | P1 |
| HEX-004 | Neighbours of `(6,4)`: facing 0 → `(6,3)`, 1 → `(7,3)`, 2 → `(7,4)`, 3 → `(6,5)`, 4 → `(5,5)`, 5 → `(5,4)`. By label (00 §3.1, matches MegaMek `Coords`): `0505` → `0504 0604 0605 0506 0405 0404`; `0605` → `0604 0705 0706 0606 0506 0505`; `0201` → off, `0301 0302 0202 0102 0101` | P1 |
| HEX-005 | Distance `(6,6)`–`(6,2)` = 4; `(6,4)`–`(8,3)` = 2; adjacent = 1; a target 1 hex away and 3 levels higher is at range 1 | P1 |
| HEX-006 | Bearings: `(6,6)`→`(6,2)` = 0°; `(6,4)`→`(8,3)` = 90°; `(6,5)`→`(7,5)` = 120°; `(6,2)`→`(6,6)` = 180° | P1 |
| HEX-007 | `rel` for bearing 180° and facing 5 = 240°; bearing 0° and facing 0 = 0°; bearing 300° and facing 5 = 0° | P1 |
| HEX-008 | Water hex level 0, depth 2 → floor −2; clear hex level 1 → floor 1 | P1 |
| HEX-009 | LOS level: standing on level 1 → 3; prone on level 1 → 2; standing in depth 1 water with surface 0 → 1 | P1 |
| HEX-010 | A unit displaced off the board is destroyed (cause `displacedOff`); LOS never includes a hex outside the 16 × 17 grid | P1 |

## 2. INIT: turn sequence and initiative

| ID | Assertion | P |
|---|---|---|
| INIT-001 | Phase events per turn are exactly Initiative, Movement, Ranged Attack, Physical Attack, Heat, End, in that order. No event, label or type uses "Weapon Attack" | P1 |
| INIT-002 | Initiative a `[3,3]` vs b `[4,4]`: b wins, a makes the first Movement selection. Tie a `[3,4]` vs b `[2,5]`: both sides re-roll (4 initiative rolls in total). Roll order is always side A then side B, re-rolls included (`DiceRolled.reason` = `A`, `B`, `A`, `B`) | P1 |
| INIT-003 | 2 v 2, a lost: Movement, Ranged and Physical selection order is a, b, a, b | P1 |
| INIT-004 | A shut-down unit is not counted in the Movement alternation; a unit with an unconscious pilot is not counted in Ranged or Physical; a destroyed unit is never counted | P1 |
| INIT-005 | Loser 1 vs winner 2 → `L WW`; loser 2 vs winner 1 → `LL W`; loser 2 vs winner 0 left → `L L` one at a time | P1 |
| INIT-006 | The three worked sequences: 3 v 4 → `L WW L W L W`; 10 v 18 → winner selects 2 per pair in pairs 1–8, then 1 and 1; 4 v 2 → `LL W LL W` | P1 |
| INIT-007 | When a side selects 2 units in a pair, the first unit's whole move ends (events closed) before the second unit's first step is accepted | P1 |
| INIT-008 | No initiative-die option exists in setup or options | P3 |
| INIT-009 | A PSR from running into depth 1 water is rolled before the next unit's Movement selection opens | P1 |
| INIT-010 | Ammo shots drop at declaration; resolution follows declaration order; a 2-missile SRM hit resolves missile 1 (location, damage, crit) completely before missile 2's location roll | P1 |
| INIT-011 | Physical declarations alternate loser first; the Displacement Step runs after every physical attack resolves and before the PSR queue | P1 |
| INIT-012 | A unit whose right arm is destroyed by an earlier attack in the same Ranged Attack Phase still resolves its declared right-arm PPC; a unit destroyed mid-phase still resolves its declared attacks; the destroyed weapon is gone only after the phase | P1 |
| INIT-013 | End of Ranged, Physical and Heat phases: gameplay effects and removal first, then one consciousness check per pilot hit that phase, then the PSR queue (automatic falls first), then one more check for any pilot hit by a fall in the queue | P1 |
| INIT-014 | Heat Phase follows HEAT-030 order (covered there) | P1 |
| INIT-015 | End Phase order: recovery roll, submerged life-support hit, twist/flip reset to feet facing, voluntary shutdown/restart, surrender check, removal, victory check. A torso twisted this turn faces forward again when the next turn starts | P1 |
| INIT-016 | Changing a declared attack after declaration is rejected; a move cannot be changed after the unit's first step | P1 |

## 3. MOVE: movement

| ID | Assertion | P |
|---|---|---|
| MOVE-001 | A unit gets exactly one mode per turn; 2 unspent MP do not carry into the next turn | P1 |
| MOVE-002 | Stand Still: 0 MP, heat 0, attacker modifier 0, TMM 0; no facing-change action is legal under Stand Still | P1 |
| MOVE-003 | Walk: heat 1, attacker +1; a backward step is legal | P1 |
| MOVE-004 | Run: heat 2, attacker +2; a backward step is rejected | P1 |
| MOVE-005 | Jump 2 hexes: heat 3; jump 5 hexes: heat 5; attacker +3; a unit prone at turn start cannot choose Jump | P1 |
| MOVE-006 | Base walk 5: 1 hip + 1 foot crit → walk 3, run 5; base walk 4 with 4 leg crits → walk 1, run 2; one leg destroyed → walk 1, run 2; walk 5 at heat 10 → walk 3, run 5; both legs destroyed → 0/0 | P1 |
| MOVE-007 | Jump 6 with 1 destroyed jump jet → 5; heat 15 leaves Jump MP 6 | P1 |
| MOVE-008 | Immobile: shut down → yes; unconscious pilot → yes; both legs destroyed and no jump → yes; prone → no; gyro destroyed → no; heat 25 with walk 3 (walk 0) → no | P1 |
| MOVE-009 | An immobile unit gets no Movement selection and is excluded from the alternation counts | P1 |
| MOVE-010 | Walking forward into the facing hex is legal; entering a hex that is neither ahead nor behind without turning first is rejected | P1 |
| MOVE-011 | Turning 3 hexsides costs 3 MP | P1 |
| MOVE-012 | May pass through a friendly unit and through a shut-down enemy; may not enter a mobile enemy's hex (except charge); may not end in any occupied hex | P1 |
| MOVE-013 | Forward 3 then backward 2 → TMM count 2; facing changes add 0; a 4-hex jump path → 4 | P1 |
| MOVE-014 | Walk 1 'Mech facing heavy woods (cost 3), no other MP spent: entering it is legal and counts as Run (heat 2, +2). Prone with exactly 1 MP: one stand attempt is legal and counts as Run | P1 |
| MOVE-015 | Entering a hex 2 levels up costs +2 and is legal; 3 levels up or down is rejected | P1 |
| MOVE-016 | Walking backward into a hex 1 level up is legal and triggers a PSR at +0 after entering | P1 |
| MOVE-017 | With a hip crit, a ground step that changes 2 levels is rejected; a 1-level change is legal | P1 |
| MOVE-020 | Clear hex costs 1 MP, no PSR | P1 |
| MOVE-021 | Paved/bridge costs 1 (exactly as clear), no PSR, no skid roll ever, no LOS or to-hit effect (map key reserved until M8) | P3 |
| MOVE-022 | Road-to-road along the road: level-change cost −1, minimum 0 (map key reserved until M8) | P3 |
| MOVE-023 | Rough costs 2 MP | P1 |
| MOVE-024 | Light woods costs 2 MP | P1 |
| MOVE-025 | Heavy woods costs 3 MP | P1 |
| MOVE-026 | Rubble costs 2 MP and a PSR +0 on entering (map key reserved until M8) | P3 |
| MOVE-027 | Walking into depth 1: no PSR. Running into depth 1: PSR at Piloting − 1 (Piloting 5 → TN 4) | P1 |
| MOVE-028 | Shore level 0 → depth 2 costs 5 MP. Running into depth 2: PSR +0; depth 3: PSR +1 (fixture map; release-1 maps have no depth 2+, LOS-041) | P2 |
| MOVE-029 | Each level up or down adds 1 MP | P1 |
| MOVE-030 | Rejected on the ground and as a jump landing: 3+ level change, off board, mobile enemy hex (non-charge), ending in an occupied hex | P1 |
| MOVE-031 | Each hexside turned costs 1 MP, no PSR | P1 |
| MOVE-032 | Dropping prone costs 1 MP | P1 |
| MOVE-033 | A stand attempt costs 2 MP and makes a PSR at −1 | P1 |
| MOVE-034 | Water costs: shore (level 0) → depth 1 = 3 MP; depth 1 → depth 1 = 2; shore → depth 2 = 5; depth 1 → shore = 2 | P1 |
| MOVE-035 | Map data containing ice, mud, sand, snow, swamp, fog, foliage, fire, smoke or buildings fails validation with `UNSUPPORTED_TERRAIN <key> at <hex>` | P1 |
| MOVE-040 | Drop prone mid-walk: 1 MP, facing kept, no damage, no extra heat; not legal while jumping | P1 |
| MOVE-041 | A unit prone at Movement start may pick Walk or Run but not Jump; while prone only facing changes and stand attempts are legal | P1 |
| MOVE-042 | Stand attempt (Piloting 5): 2 MP, TN 4, 0 heat. Pass → the unit takes `StandUpAction.facing` (or keeps its facing when omitted) at no MP cost. Fail → 0-level fall in place; a second attempt is legal if ≥ 2 MP remain and is again TN 4 (not 3) | P1 |
| MOVE-043 | No stand attempt is legal with both legs destroyed, one leg and both arms destroyed, or the gyro destroyed | P1 |
| MOVE-044 | One leg destroyed, Piloting 4: one stand attempt per turn, counts as Run, TN 4 + 5 − 1 = 8; every PSR the attempt needs is rolled separately | P1 |
| MOVE-045 | A prone unit cannot twist, flip or declare a physical attack | P1 |
| MOVE-050 | Jump cost = shortest hex path length (4 hexes → 4 MP), terrain ignored; jumping out and back into the start hex costs 1 | P1 |
| MOVE-051 | Jump MP 3 from level 0: landing on level 4 is illegal, a path over level 3 is legal, woods on the path never matter, a drop of any number of levels is legal | P1 |
| MOVE-052 | Landing facing is any of 6; landing in an occupied hex is rejected unless the jump is a declared DFA | P1 |
| MOVE-053 | Landing in depth 1: PSR +0. On failure a 50 t 'Mech falls 1 level: `5 × (1 + 1)` = 10, halved = 5 | P1 |
| MOVE-054 | Jump PSRs on landing are covered by PSR-031 | P1 |
| MOVE-060 | Standing in depth 1: partial cover, not submerged. Prone in depth 1 or standing in depth 2: submerged | P1 |
| MOVE-061 | Running into depth 1 is legal with its PSR; turning inside water or stepping water → land needs no PSR | P1 |
| MOVE-062 | Standing in depth 1: jump jets mounted in legs are not counted in Jump MP; submerged: Jump MP 0 | P1 |
| MOVE-063 | Water dissipation is covered by HEAT-012 | P1 |

## 4. SCN: deployment, victory, withdrawal

| ID | Assertion | P |
|---|---|---|
| SCN-001 | A mission with `placed` deployment starts turn 1 with units on their given hexes and facings; `edgeEntry` units start off board | P1 |
| SCN-002 | Edge entry: the first step enters the chosen home-edge hex at its normal cost; that hex counts for TMM; Jump is not legal on the entry turn; ending the move off board is rejected | P1 |
| SCN-003 | An entering unit may start with switchable equipment in a chosen state | P2 |
| SCN-004 | Half loads: a 15-shot bin starts with 7 shots, a 1-shot bin with 0 (2026?) | P2 |
| SCN-010 | Leaving by the home edge while allowed marks the unit `withdrawn`, not destroyed; leaving by another edge is rejected | P2 |
| SCN-020 | Victory: last enemy destroyed → win; both last units destroyed in one turn → draw; a crippled enemy counts as out only when the mission sets `cripple: true` | P1 |
| SCN-021 | The `crippled` flag follows 11 §2.2 exactly: set by a leg destroyed, or no weapon able to fire (destroyed, jammed or dry), or gyro destroyed, or 2 engine crits; not set by 4 pilot hits or 2 sensor crits alone | P1 |
| SCN-030 | Forced withdrawal on (11 §3.2): a unit with 2 sensor crits and no other damage becomes `withdrawing` (its `crippled` flag stays false) and `legalActions` offers only moves ending closer to its home edge; a unit with pilot hits 4 does the same | P2 |
| SCN-031 | A `withdrawing` unit (11 §3.4) that is immobile, or has 0 MP in all modes, or is prone and cannot stand surrenders in the End Phase (status `surrendered`) and counts as destroyed; a crippled unit that is not withdrawing never surrenders | P2 |

## 5. LOS: line of sight and cover

| ID | Assertion | P |
|---|---|---|
| LOS-001 | Attacker and target hexes are never in the intervening list; a hex whose corner the line touches is on the line | P1 |
| LOS-002 | `(6,4)`→`(8,3)` gives two different ±ε sequences, one through `(7,3)`, one through `(7,4)`: `divided = true`. `(6,6)`→`(6,2)` gives one sequence `(6,5),(6,4),(6,3)` | P1 |
| LOS-003 | LOS A→B equals LOS B→A for 200 random hex pairs on a real map; adjacent units always see each other | P1 |
| LOS-004 | A unit standing between attacker and target changes neither LOS nor any modifier | P1 |
| LOS-005 | With `askDefender` false (default) no decision is raised. Divided LOS with one blocked branch → the default choice is blocked (no attack legal); with woods +1 on one branch and clear on the other → the woods branch; equal → the +ε branch; the choice is reused for the same pair all turn | P1 |
| LOS-010 | Obstacle level: clear level 2 hex → 2; light woods on level 0 → 2; water hex → its surface level | P1 |
| LOS-011 | Attacker and target both LOS level 2: a level 2 clear hex mid-line intervenes; a level 1 hex adjacent to the attacker does not; a level 2 hex adjacent to a prone target (LOS level 1) does | P1 |
| LOS-012 | An intervening hex whose ground alone qualifies blocks LOS | P1 |
| LOS-013 | 1 light woods → +1; 2 light → +2; 1 heavy → +2; light + heavy (3 points) → blocked; 3 light → blocked | P1 |
| LOS-014 | Heavy woods in the target hex give +2 but do not add woods points; woods in the attacker's hex add nothing | P1 |
| LOS-015 | A depth 2 water hex between two standing land units never blocks LOS | P1 |
| LOS-016 | Prone target (LOS level 1) behind an adjacent level 1 hill on the line: blocked, with no special-case code path | P1 |
| LOS-020 | The verdict object has at least `visible, attackAllowed, divided, chosen, hexes, alt, blockers, woodsPoints, partialCover, reasons`; `chosen` is `'+'`, `'-'` or null | P1 |
| LOS-030 | Standing target on level 0 next to a level 1 hex on the line, attacker LOS level 2: partial cover. Attacker on level 1 (LOS level 3): none. Level 2 hill in that spot: blocked, not cover | P1 |
| LOS-031 | Standing target in depth 1: partial cover from an attacker on a level 3 hill too; a punch on it gets no cover | P1 |
| LOS-032 | Partial cover: +1 TN; a leg result does no damage, no crit, no pilot hit, and emits a `HitAbsorbedByCover` event | P1 |
| LOS-033 | Prone target: never partial cover; a charge against a target in depth 1 gets no +1 | P1 |
| LOS-034 | Attacker with partial cover from a hill on the line cannot fire leg weapons through it; attacker standing in depth 1 cannot fire leg weapons | P1 |
| LOS-040 | A submerged unit (prone in depth 1, release-1 maps; or standing in depth 2, fixture map) and a unit on land: no ranged or physical attack is legal either way | P1 |
| LOS-041 | Two units prone in adjacent depth 1 hexes: physical attack legal at half damage (round down); ranged attack legal with standard to-hit and ranges. `validate-data` rejects a release-1 map with a depth ≥ 2 water hex. No hull breach roll exists | P1 |

## 6. ARC: arcs and attack direction

| ID | Assertion | P |
|---|---|---|
| ARC-001 | Firing arcs by `rel`: 0, 60, 300 → Forward; 61, 120 → Right; 121, 180, 239 → Rear; 240, 299 → Left. Attacker `0505` facing 0, target `0605`: rel 120 → Right side (00 §3.4) | P1 |
| ARC-002 | Adjacent hexes for facing 0: directions 0, 1, 5 → Forward; 2 → Right; 3 → Rear; 4 → Left | P1 |
| ARC-003 | Torso weapon cannot fire at a target at `rel` 90; right-arm weapon can; left-arm weapon cannot; a rear-mounted torso weapon fires only at `rel` 121–239 | P1 |
| ARC-004 | After a right twist, arm and torso arcs use torso facing + 1; leg weapons, kicks and pushes keep feet facing | P1 |
| ARC-010 | One twist per turn, either in the Ranged or Physical declaration; a second twist is rejected; it resets in the End Phase | P1 |
| ARC-011 | A twist declared in the Physical Attack Phase changes punch arcs only | P1 |
| ARC-012 | Arm flip: legal only without lower arm and hand actuators in both arms; flipped arm weapons fire into the Rear arc; flip + twist in one turn is rejected | P2 |
| ARC-013 | A prone unit has no twist or flip actions | P1 |
| ARC-014 | A twisted target is hit on the column given by its feet facing | P1 |
| ARC-020 | Attack direction by `rel(target→attacker, feet)`: 0 → Front; 90 → Right; 180 → Rear; 240 → Left | P1 |
| ARC-021 | `rel` exactly 30 / 150 / 210 / 330: with `askDefender` true the target's controller gets a `choice`; otherwise (default) no decision and the default rule picks the zone whose roll-7 location has the most armor left, ties Front > Left > Right > Rear; stored for the pair this turn | P1 |
| ARC-022 | Divided LOS uses the straight centre line for direction, whatever branch was chosen | P1 |
| ARC-023 | A prone target's direction uses the facing it lies in | P1 |

## 7. TOHIT: ranged attacks

| ID | Assertion | P |
|---|---|---|
| TOHIT-001 | Gunnery 4, no modifiers: TN 4; each weapon rolls its own 2d6 | P1 |
| TOHIT-002 | TN 13 → attack not legal; TN 2 → automatic hit | P1 |
| TOHIT-003 | A weapon cannot be declared twice in a turn, nor at a target beyond long range or outside its arc or without LOS | P1 |
| TOHIT-004 | Declaring a friendly unit as target is rejected; an empty-hex shot spends ammo and heat and changes nothing else | P1 |
| TOHIT-005 | Targets A (Forward arc) and B (Right side arc): declaring A first makes A primary and B gets +1. A declaration whose first shot is at B while A is also declared is rejected with `E_PRIMARY_TARGET`; the engine does not reorder. B alone (no Forward target declared) is a legal primary | P1 |
| TOHIT-006 | Shut-down unit, unconscious pilot, or a unit that declared a charge or DFA: no ranged attack is legal | P1 |
| TOHIT-007 | Two sensor crits: no ranged attack is legal | P1 |
| TOHIT-008 | Prone, both arms intact: weapons in the propping arm and leg weapons cannot fire; others fire with standing arcs, +2 on top of the move modifier. One arm destroyed: still legal (2026). Both arms destroyed: no prone fire | P1 |
| TOHIT-010 | Medium laser (3/6/9) at range 3 → +0, 4 → +2, 7 → +4, 10 → not legal | P1 |
| TOHIT-011 | PPC (minimum 3): range 3 → +1, 2 → +2, 1 → +3, 4 → +0. LRM (minimum 6) at range 4 → +3 | P1 |
| TOHIT-012 | Attacker modifier by mode: Stand Still 0, Walk +1 (even 0 hexes), Run +2, Jump +3 | P1 |
| TOHIT-013 | Prone attacker that walked: +1 +2 = +3 | P1 |
| TOHIT-014 | TMM by hexes: 0 → 0, 2 → 0, 3 → +1, 4 → +1, 5 → +2, 7 → +3, 10 → +4, 17 → +4, 18 → +5, 25 → +6 | P1 |
| TOHIT-015 | Target jumped 2 hexes: TMM 0 + 1 = +1; jumped 5 hexes: +2 + 1 = +3 | P1 |
| TOHIT-016 | Prone target: adjacent attacker −2; at range 2 +1; both stack with TMM | P1 |
| TOHIT-017 | Shut-down target that ran 6 hexes earlier this turn but was immobile at phase start: −4 and no TMM | P1 |
| TOHIT-018 | Pilot knocked out at the end of the Ranged Attack Phase after running 5 hexes: Ranged attacks that phase used +2 TMM and no −4; Physical Phase attacks use −4 and no TMM (immobility snapshotted at phase start) | P1 |
| TOHIT-019 | TMM from the Movement Phase applies unchanged to every ranged and physical attack against that unit this turn | P1 |
| TOHIT-020 | Target in light woods +1; heavy woods +2 | P1 |
| TOHIT-021 | One intervening light woods +1; one heavy +2 | P1 |
| TOHIT-022 | Partial cover +1 | P1 |
| TOHIT-023 | Attacker heat 7 → 0; 8 → +1; 13 → +2; 17 → +3; 24 → +4; never on a physical attack | P1 |
| TOHIT-024 | Two secondary targets (one in the Rear arc of a rear-mounted weapon): +1 each, never +2 | P1 |
| TOHIT-025 | One sensor crit: +2 on ranged attacks | P1 |
| TOHIT-026 | Shoulder crit: +4 for that arm's weapons; an upper-arm crit in the same arm adds nothing more | P1 |
| TOHIT-027 | Upper arm actuator crit: +1 for that arm's weapons | P1 |
| TOHIT-028 | Lower arm or hand crit: +0 for that arm's weapons (2026) | P1 |
| TOHIT-029 | A weapon with data `toHitMod: −2` (pulse) adds −2 | P1 |
| TOHIT-030 | Aimed shot legal vs an immobile target or with a linked targeting computer vs a mobile 'Mech; never with missiles, LB-X cluster, MG arrays, indirect fire or physical attacks | P2 |
| TOHIT-031 | Targeting computer, eligible weapon: −1; LRM: 0 | P2 |
| TOHIT-032 | Target standing in depth 1 water gets no terrain modifier, only +1 partial cover | P1 |
| TOHIT-033 | No Large Target modifier, indirect fire or spotting action exists in v1 | P3 |
| TOHIT-034 | Gunnery 4, stood still, range 2 vs a shut-down target: non-head aimed TN 4 − 4 = 0 (auto); with TC −5; head aimed TN 4 + 3 = 7; TC vs mobile: +3 instead of −1, head not offered | P2 |
| TOHIT-035 | Aimed hit: 1d6 `[4]` → named location; `[3]` → normal 2d6 location roll | P2 |
| TOHIT-036 | Aimed shot at a target with partial cover: legs cannot be named, no +1; a normal roll giving a leg is re-rolled | P2 |
| TOHIT-040 | Indirect fire is deferred: no action exists | P3 |

## 8. HITLOC: hit location

| ID | Assertion | P |
|---|---|---|
| HITLOC-001 | Rear attack, roll 7 → CT rear armor; roll 8 → LT rear armor | P1 |
| HITLOC-002 | An LRM hit of 12 missiles rolls 3 separate locations (5, 5, 2) | P1 |
| HITLOC-003 | Table spot checks: Front 2 CT, 3 RA, 5 RL, 6 RT, 8 LT, 9 LL, 10 LA, 12 HD; Left 3 LL, 4 LA, 8 CT, 9 RT, 11 RL; Right 3 RL, 8 CT, 9 LT, 11 LL | P1 |
| HITLOC-004 | Roll 2 Front with CT armor 20, damage 5: armor 15 and one crit check on CT; if structure was also damaged, two crit checks; TAC on a destroyed LT moves with the damage to CT | P1 |
| HITLOC-005 | Floating crits on: a roll 2 re-rolls 2d6 on the same column for the TAC location; off by default | P2 |
| HITLOC-006 | Punch table (2026 reversed): Front 1 RA, 2 RT, 3 CT, 4 LT, 5 LA, 6 HD; Left 1 LA, 3 CT, 4 LT; Right 1 RA, 3 CT, 5 RT | P1 |
| HITLOC-007 | Kick table: Left 1–6 LL; Front 1–3 RL, 4–6 LL; Right 1–6 RL | P1 |
| HITLOC-008 | A punch or kick on a prone 'Mech uses the 2d6 table; a DFA on a prone 'Mech uses the Rear column | P1 |
| HITLOC-009 | Partial-cover leg hits are covered by LOS-032 | P1 |
| HITLOC-010 | 17 damage in groups of 5 → 5, 5, 5, 2, the 2 resolved last; 9 → 5, 4 | P1 |

## 9. CLUS: cluster hits

| ID | Assertion | P |
|---|---|---|
| CLUS-001 | A hitting cluster weapon rolls 2d6 once; the table value is the number of missiles that hit | P1 |
| CLUS-002 | Table spot checks: size 20 roll 8 → 12; size 10 roll 11 → 10; size 6 roll 7 → 4; size 4 roll 6 → 2; size 2 roll 7 → 1; size 15 roll 2 → 5; size 5 roll 9 → 4; size 3 roll 4 → 1; size 8 roll 2 → 2, roll 8 → 5, roll 10 → 7 (MegaMek-checked rows) | P1 |
| CLUS-003 | LRM 20 → 12 hits → groups 5, 5, 2. SRM 6 → 4 hits → 4 locations of 2 damage. LB-X cluster and MG arrays: 1 location per pellet / MG | P1 |
| CLUS-004 | Cluster roll modifiers: MG array +2, Artemis +2, MRM −1; a modified 13 reads as 12, a modified 1 as 2 | P2 |
| CLUS-005 | Streak SRM 4 hit: 4 missiles, no cluster roll. Miss: shots and heat unchanged | P1 |
| CLUS-006 | LB-X with slug ammo resolves as one hit of full damage | P2 |

## 10. DMG: applying damage

| ID | Assertion | P |
|---|---|---|
| DMG-001 | A 'Mech has 8 locations; LT, CT, RT have front and rear armor and one structure track | P1 |
| DMG-002 | LA armor 4, structure 11, hit for 5 → armor 0, structure 10, one crit check on LA. Structure reaching 0 → destroyed, crit check only if explosive (CRIT-005), leftover goes inward | P1 |
| DMG-003 | 10 damage on LA with 5 structure left: 5 destroys LA, 5 continues to LT in the same hit; a later hit rolled on LA transfers all to LT | P1 |
| DMG-004 | A hit that damages structure of an arm with no crit-able slot left at phase start sends its crit check to the torso | P1 |
| DMG-005 | Transfers: LA→LT, LL→LT, RA→RT, RL→RT, LT→CT, RT→CT; excess from HD or CT is lost and the 'Mech is destroyed | P1 |
| DMG-006 | A rear hit transferring from a destroyed LL into LT hits LT rear armor | P1 |
| DMG-007 | An ammo explosion of 20 in RT with 12 structure: RT structure 0, 8 to CT structure; no armor is touched | P1 |
| DMG-010 | A destroyed torso loses its rear armor too; that armor counts toward the 20-damage tally | P1 |
| DMG-011 | Destroyed RT: RA destroyed at once (its armor and structure not added to the tally); IS XL engine → 3 engine crits → 'Mech destroyed; standard engine → no engine crits | P1 |
| DMG-012 | Destroyed leg → CRIT-100; destroyed head → pilot dead, 'Mech destroyed; CT destroyed by an ammo explosion → pilot dead too | P1 |
| DMG-013 | An arm blown off by a crit 12 adds nothing to the tally and its ammo does not explode | P1 |
| DMG-020 | Each listed cause marks the unit destroyed; removal happens at the end of the phase, after its declared attacks. Displaced off board → cause `displacedOff`; no legal hex → `noLegalHex` | P1 |
| DMG-021 | Gyro destroyed, both legs destroyed or all weapons lost: unit not destroyed | P1 |
| DMG-022 | Every damage event carries `source, location, side, armorBefore, armorAfter, structureBefore, structureAfter, transferredTo, critChecks` | P1 |

## 11. CRIT: critical hits

| ID | Assertion | P |
|---|---|---|
| CRIT-001 | Crit roll 7 → 0; 8 and 9 → 1; 10 and 11 → 2; 12 on a torso → 3; 12 on an arm, leg or head → blown off. In a CASE II location a 9 counts as 8 | P1 |
| CRIT-002 | 12-slot location: block `[2]` + slot `[4]` → slot 4; block `[5]` + slot `[2]` → slot 8. Leg: slot `[3]` → slot 3. Lower block all inapplicable → only the slot die is rolled, in the upper block | P1 |
| CRIT-003 | A crit landing on an `empty`, `structure`, `armor` or already-hit slot re-rolls both dice (12-slot) or the die (6-slot); each re-roll is its own `critSlot` `DiceRolled` | P1 |
| CRIT-004 | Crit 12 on an arm: arm destroyed, nothing transfers, its ammo does not explode; 12 on the head: 'Mech destroyed, pilot dead | P1 |
| CRIT-005 | A location destroyed by the hit: crit check only if it holds ammo with shots or an explosive item; only crits on explosive slots resolve; none transfer; the discarded ones emit `CritLost {count, why: 'notExplosive'}` | P1 |
| CRIT-010 | RT whose crit-able slots were all hit in an earlier phase: crits move to CT. RT whose last crit-able slot is hit by the first of 3 crits this phase: the other 2 are lost, one `CritLost {location: 'RT', count: 2, why: 'noSlotThisPhase'}`, no dice. HD and CT crits never move | P1 |
| CRIT-011 | A 3-slot PPC hit twice: destroyed once, second crit absorbed. Engine, gyro, sensors count each slot | P1 |
| CRIT-012 | Crit effects persist into later turns and stack | P1 |
| CRIT-020 | Crit on an ammo bin with shots → explosion + 1 pilot hit; on an empty bin → slot marked, nothing else | P1 |
| CRIT-030 | Cockpit crit → pilot dead, 'Mech destroyed | P1 |
| CRIT-031 | Engine crits: 1 → +5 heat per Heat Phase; 2 → +10; 3 → destroyed; shut down → no engine heat | P1 |
| CRIT-040 | Gyro crit 1: +2 to all PSRs and a PSR at the end of the phase. Crit 2: automatic fall, no stand, prone fire only, may turn 1 hexside per turn with ≥ 1 MP. Running 1+ hex or jumping with 1 gyro crit: PSR | P1 |
| CRIT-050 | Sensor crit 1: +2 on ranged attacks, +0 on punches | P1 |
| CRIT-052 | Sensor crit 2: no ranged attack legal for the rest of the game; physical attacks still legal | P1 |
| CRIT-060 | Life support critted: end of Heat Phase heat 9 → 0 hits; 10 → 1; 19 → 1; 20 → 2 | P1 |
| CRIT-061 | Life support critted and submerged: 1 pilot hit in each End Phase | P1 |
| CRIT-070 | Destroyed single sink: dissipation −1; destroyed double: −2 | P1 |
| CRIT-071 | Jump jet crit: Jump MP −1 | P1 |
| CRIT-072 | Weapon crit: weapon destroyed and no longer legal | P1 |
| CRIT-073 | Crit on a `structure` or `armor` slot (endo-steel, ferro-fibrous) re-rolls like an empty slot; nothing is absorbed | P2 |
| CRIT-080 | Shoulder crit: that arm's weapons +4; no punch with it; push +2 per damaged shoulder | P1 |
| CRIT-081 | Upper arm crit: that arm's weapons +1; punch +2, punch damage halved (55 t: 6 → 3) | P1 |
| CRIT-082 | Lower arm crit: weapons +0; punch +2 and damage halved | P1 |
| CRIT-083 | Hand crit: punch +1 | P1 |
| CRIT-090 | Hip crit: walk −1 (5 → 4, no halving), PSRs +1, PSR at end of phase, no kick, 1-level step limit | P1 |
| CRIT-091 | Upper leg crit: walk −1, PSRs +1, PSR at end of phase, kick with that leg +2 TN and half damage | P1 |
| CRIT-092 | Lower leg crit: same as CRIT-091 | P1 |
| CRIT-093 | Foot crit: walk −1, no PSR, no PSR modifier, kick +1; no jump PSR from a foot crit alone | P1 |
| CRIT-094 | Base walk 3 with 3 leg crits → walk 1, run 2 | P1 |
| CRIT-095 | One hit giving hip + upper leg crits on the same leg → one PSR, TN Piloting + 2 | P1 |
| CRIT-100 | Leg destroyed: standing unit falls automatically; walk 1, run 2; PSRs use +5 for that leg instead of its actuator modifiers | P1 |
| CRIT-101 | Both legs destroyed: automatic fall, 0 MP, no stand or turn action, prone fire only | P1 |

## 12. AMMO: ammunition and explosions

| ID | Assertion | P |
|---|---|---|
| AMMO-001 | Declaring an SRM 6 shot with two SRM 6 bins: the shot comes from the chosen bin, at declaration, even if the attack later misses | P1 |
| AMMO-002 | Streak miss: bin unchanged | P1 |
| AMMO-003 | No ammo-dump action exists | P1 |
| AMMO-010 | SRM 6 bin with 10 shots explodes for 120 → capped 20, structure only, transfers structure to structure, 1 pilot hit. AC/5 bin with 2 shots → 10 | P1 |
| AMMO-011 | CASE side torso, structure 12, 120-point bin: 10 damage, structure 2, rear armor 0, nothing transfers. Structure 8: torso destroyed, 2 excess lost (rear-armor loss is 2026?) | P1 |
| AMMO-012 | CASE II torso: 1 to structure, rest (up to 20) to that torso's rear armor, excess lost; crit roll −1 | P2 |
| AMMO-013 | A Clan 'Mech without a CASE mount in data has no CASE | P1 |
| AMMO-020 | Gauss rifle (7 slots) crit → 14-point explosion, 1 pilot hit; Gauss ammo crit → no explosion | P2 |
| AMMO-030 | Heat explosion with bins SRM 6 ×15 (12 per shot, total 180) and MG ×200 (2 per shot, total 400): the SRM 6 bin explodes (12 per shot beats MG 2 per shot; AGoAC order). Equal per-shot value → most shots; still equal → controller's choice | P1 |

## 13. HEAT: heat

| ID | Assertion | P |
|---|---|---|
| HEAT-001 | Run + 2 PPCs + 1 engine crit → generated 2 + 20 + 5 = 27; a stand attempt adds 0 | P1 |
| HEAT-002 | A missed PPC still adds 10; a missed Streak adds 0 | P1 |
| HEAT-010 | 10 double sinks dissipate 20; 12 single dissipate 12 | P1 |
| HEAT-011 | A sink in a destroyed location does not dissipate | P1 |
| HEAT-012 | Standing in depth 1 with 2 leg sinks: +2; submerged with 10 sinks: +6 cap | P1 |
| HEAT-013 | Heat 28 + 15 − 10 = 33 stored; effects use 30 (automatic shutdown) | P1 |
| HEAT-020 | Walk 5: heat 4 → 5; 5 → 4; 9 → 4; 10 → 3; 14 → 3; 15 → 2; 25 → 0 | P1 |
| HEAT-021 | Ranged TN heat modifier: 7 → 0, 8 → +1, 12 → +1, 13 → +2, 17 → +3, 24 → +4 | P1 |
| HEAT-022 | Shutdown avoid TN: 14 → 4, 17 → 4, 18 → 6, 22 → 8, 26 → 10 | P1 |
| HEAT-023 | Heat 30: shut down, no roll | P1 |
| HEAT-024 | Ammo avoid TN: 19 → 4, 23 → 6, 28 → 8 | P1 |
| HEAT-025 | Life-support pilot hits: covered by CRIT-060 | P1 |
| HEAT-030 | Heat Phase per unit, loser first: apply heat, restart or shutdown check, ammo check, life support; then the end-of-phase steps | P1 |
| HEAT-031 | Heat 19: one shutdown roll at TN 6 (not one per threshold); unconscious pilot at heat 14 → shut down without a roll | P1 |
| HEAT-032 | Shut down: no PSR rolled (2026); a standing shut-down unit fails any PSR automatically; sinks keep working; no engine heat | P1 |
| HEAT-034 | Heat 23 with ammo: one ammo roll at TN 6; also rolled while shut down | P1 |
| HEAT-040 | Shut down in turn 3's Heat Phase: no restart roll that phase; turn 4 heat 0 → automatic restart; heat 20 → restart roll TN 6; heat 22 → TN 8; heat 30 → no restart | P1 |
| HEAT-041 | Voluntary shutdown in an End Phase, restart in a later End Phase after any avoid roll | P2 |

## 14. PSR: piloting skill rolls

| ID | Assertion | P |
|---|---|---|
| PSR-001 | Piloting 5, 1 gyro crit, took 20+ this phase: TN 5 + 2 + 1 = 8 for every queued PSR of that unit this phase. Movement: running through three depth 1 water hexes rolls three PSRs, each at TN Piloting − 1 (own modifier only; −1, −2, −3 never accumulates); a stand attempt after a water fall is TN Piloting − 1 | P1 |
| PSR-002 | Two queued PSRs at TN 8: `[2,3]` fails → falls; the second is not rolled | P1 |
| PSR-003 | TN 13 → automatic fail, no `DiceRolled` | P1 |
| PSR-004 | A prone unit that takes 25 damage makes no PSR. A prone unit that loses a leg or its gyro in the Ranged Attack Phase: its automatic fall is `PsrDiscarded {prone}`; no `UnitFell`, no fall damage, no seatbelt roll | P1 |
| PSR-005 | A standing shut-down unit kicked: PSR fails without a roll | P1 |
| PSR-006 | A kick TN ignores a gyro crit's +2; a PSR ignores the kick's −1 | P1 |
| PSR-010 | Each gyro crit +2 | P1 |
| PSR-011 | Each hip crit +1 | P1 |
| PSR-012 | Each upper/lower leg crit +1 | P1 |
| PSR-013 | Foot crit +0 | P1 |
| PSR-014 | Leg destroyed with a hip crit on it: +5 total from that leg (not +6) | P1 |
| PSR-015 | 45 damage in one phase: one +1 trigger, one PSR | P1 |
| PSR-016 | The PSR caused by a hip crit adds +0 on top of the hip's persistent +1 | P1 |
| PSR-017 | Kicked or pushed target: PSR +0 | P1 |
| PSR-018 | Target hit by a charge or DFA: +2 | P1 |
| PSR-019 | Stand attempt: −1, not cumulative: Piloting 5, three attempts in one Movement Phase all roll at TN 4 | P1 |
| PSR-023 | Missed kick: attacker PSR +0 | P1 |
| PSR-024 | Successful charge: attacker PSR +2 | P1 |
| PSR-025 | Successful DFA: attacker PSR +2 (not +4) | P1 |
| PSR-026 | Running into depth 1 / 2 / 3: −1 / 0 / +1 | P1 |
| PSR-027 | Backward level change, water landing, domino: +0 | P1 |
| PSR-028 | Running 1+ hex with a gyro crit: trigger +0, gyro's +2 applies | P1 |
| PSR-029 | Target of an accidental fall from above: +2 | P2 |
| PSR-033 | Shutting down adds no PSR and no modifier | P1 |
| PSR-020 | PSRs triggered in Ranged, Physical or Heat phases roll at end of phase in initiative order (loser's units first), automatic falls first | P1 |
| PSR-021 | 20+ damage, first gyro crit, hip/upper/lower leg crit each queue a PSR; second gyro crit, a leg destroyed, both legs destroyed queue automatic falls | P1 |
| PSR-022 | Kick hit / push hit / charge hit / DFA hit → target PSR; missed kick, successful charge, successful DFA → attacker PSR; missed DFA → attacker automatic fall | P1 |
| PSR-030 | Running into depth 1 rolls immediately on entering; failure → prone in that water hex, that hex's MP spent | P1 |
| PSR-031 | Ran 0 hexes with a gyro crit → no PSR; ran 1 hex → 1 PSR at move end; jumped with a hip crit → 1 PSR; jumped with only a foot crit → none | P1 |
| PSR-032 | Domino PSRs during the Displacement Step roll immediately | P1 |
| PSR-040 | Sensor check hook: TN = Piloting + persistent + 1 per sensor crit, never causes a fall (no core caller in v1) | P3 |
| PSR-050 | A fall leaves the unit prone in its current facing (no facing roll) in the hex being entered or its own hex | P1 |
| PSR-051 | Ordinary fall: 0 levels; pushed 3 levels down: 3 levels | P1 |
| PSR-052 | 85 t fall 0 levels: 9 → groups 5, 4. 45 t fall 2 levels: 5 × 3 = 15 → 5, 5, 5 | P1 |
| PSR-053 | Fall side d6: `[1]` → Rear column; `[2]`–`[6]` → Front column; one roll per fall | P1 |
| PSR-054 | 85 t fall ending in depth 1 (0 levels): 9 → 4 | P1 |
| PSR-055 | Fall damage applies at once, in any phase, and is added to that phase's damage tally (12 weapon damage + a 9-point fall in the same phase → tally 21) | P1 |
| PSR-056 | Seatbelt check after each fall, before fall damage: Piloting 5, gyro crit, 0 levels → TN 7; 2 levels → TN 9; the stand −1 and the 20-damage +1 are not added; fail → 1 pilot hit | P1 |
| PSR-057 | Shut-down unit falls: 1 pilot hit, no seatbelt roll; seatbelt TN 13 → 1 hit, no roll | P1 |
| PSR-058 | A unit that falls while walking keeps its remaining MP and may try to stand; after losing a leg or after a jump its move ends | P1 |

## 15. PILOT: pilot damage

| ID | Assertion | P |
|---|---|---|
| PILOT-001 | Head hit fully absorbed by armor → 1 hit; ammo explosion → 1; failed seatbelt → 1; life support at heat 20 → 2; partial-cover-absorbed hit → 0 | P1 |
| PILOT-002 | 6th hit → pilot dead, 'Mech destroyed, removed at end of phase | P1 |
| PILOT-010 | Consciousness TN for current total hits: 1 → 3, 2 → 5, 3 → 7, 4 → 10, 5 → 11. Pilot at 3 hits takes 2 in one phase → one roll at TN 11, **before** the PSR queue; a pilot knocked out by it then fails every queued PSR automatically (PSR-005). A seatbelt hit in the queue gets one extra check after it | P1 |
| PILOT-011 | Unconscious: immobile; no selections; heat 14 → shut down without a roll; a PSR while standing fails | P1 |
| PILOT-020 | Recovery: from the End Phase of the next turn, 2d6 ≥ the consciousness TN for current hits wakes the pilot | P1 |

## 16. PHYS: physical attacks

| ID | Assertion | P |
|---|---|---|
| PHYS-001 | Physical TN = Piloting + type mod + movement mods + TMM + target woods + actuator mods; never heat, sensor or secondary-target mods | P1 |
| PHYS-002 | Physical TN 2 → auto hit; TN 13 → not legal | P1 |
| PHYS-003 | One physical attack type per unit per turn; punching with both arms is one type; prone, shut-down and unconscious units get none | P1 |
| PHYS-004 | Not adjacent, wrong arc, or floors 2 levels apart (non-DFA) → not legal | P1 |
| PHYS-005 | A second charge, DFA or push on one target is not legal; nothing may target a unit making a charge or DFA | P1 |
| PHYS-006 | A push that displaces a unit does not cancel that unit's declared kick | P1 |
| PHYS-007 | Physical damage effects apply at end of phase; displacement waits for the Displacement Step | P1 |
| PHYS-008 | Comparative modifier: attacker Piloting 4 vs target 5 → −1; vs an immobile target → 4 − 4 = 0 | P1 |
| PHYS-010 | Punch base −1: Piloting 5, nothing else → TN 4 | P1 |
| PHYS-011 | Kick base −1: Piloting 5 → TN 4 | P1 |
| PHYS-012 | Push base −1 | P1 |
| PHYS-013 | Charge base 0 + comparative | P1 |
| PHYS-014 | DFA: Piloting + comparative + 3 (jumped); target-hex woods not added | P1 |
| PHYS-015 | Clubs and physical weapons are not actions in v1 | P3 |
| PHYS-020 | Same level standing: all types legal on normal tables | P1 |
| PHYS-021 | Target 1 level higher: punch uses the Kick table; kick not legal; charge legal; DFA legal against a standing target one level higher | P1 |
| PHYS-022 | Target 1 level lower: kick uses the Punch table; punch not legal; charge legal; DFA legal against a standing target one level lower | P1 |
| PHYS-023 | Prone target, same level: kick legal (2d6 table), punch not legal | P1 |
| PHYS-024 | Prone target 1 level higher: punch legal (2d6 table); DFA legal (own table, PHYS-064) | P1 |
| PHYS-025 | Prone target 1 level lower: only DFA legal | P1 |
| PHYS-026 | Floors 2 levels apart: only DFA legal | P1 |
| PHYS-030 | Left arm punches a target at `rel` 270 (Left arc); right arm cannot; each arm rolls separately | P1 |
| PHYS-031 | No punch with an arm that fired this turn or has a shoulder crit | P1 |
| PHYS-032 | 65 t, lower arm absent: 7 → 3; 55 t with upper and lower crits: 6 → 3 → 1 | P1 |
| PHYS-033 | Hand absent +1; lower arm absent +2; upper + lower critted +4 | P1 |
| PHYS-034 | Kick needs Forward arc by feet; a hip crit on either leg forbids kicks; only the leg that fired a leg weapon is barred | P1 |
| PHYS-035 | 55 t kick 11; with one lower leg crit on the kicking leg 5 | P1 |
| PHYS-036 | Kick with one upper leg crit and a foot crit: +3 | P1 |
| PHYS-037 | Kick hit → target PSR +0; miss → attacker PSR +0 | P1 |
| PHYS-040 | Charge legal only for a walking/running unit that ends adjacent, facing the target, with MP to enter its hex; target must have moved already; prone target → not legal | P1 |
| PHYS-041 | A unit that declared a charge has no ranged attack legal | P1 |
| PHYS-042 | Charger falls in the Ranged phase → charge fails, no roll; target displaced before the Physical phase → charger may declare a different legal physical attack | P1 |
| PHYS-043 | 65 t after 5 hexes: N = 6 → L = 5, `ceil(6.5 × 5)` = 33; charger takes `ceil(45 / 10)` = 5; 50 t after 2 hexes: N = 3, L = 3 → 15; 50 t after 12 hexes: N = 13, L = 10 → 50; 50 t after 0 hexes: N = 1 → 5 | P1 |
| PHYS-044 | Charge target column from the charger's hex; charger's damage on the Front column; no partial cover | P1 |
| PHYS-045 | Charge hit: charger enters the target hex, target displaced 1 hex directly away, both PSR +2. Miss: nobody moves | P1 |
| PHYS-060 | DFA legal only with Jump MP to reach the target hex and clear target floor + 2 (standing) or + 1 (prone) | P1 |
| PHYS-061 | DFA jumper is placed in its last path hex for the Ranged phase; no ranged attack legal for it; it cannot be targeted by physical attacks | P1 |
| PHYS-062 | DFA attacker failing a PSR in the Ranged phase misses | P1 |
| PHYS-063 | DFA direction comes from the hex held at the end of the Movement Phase | P1 |
| PHYS-064 | 55 t DFA hit: target 17 (groups 5, 5, 5, 2) on the Punch table (prone target: Rear column); attacker 11 on the Kick table Front column (5, 5, 1); both PSR +2 | P1 |
| PHYS-066 | DFA miss: attacker lands in the target hex and takes a 2-level fall, every group on the Rear column; target moved to an adjacent hex its controller picks | P1 |
| PHYS-067 | DFA displacement blocked on the intended hexside: try ±1, ±2, opposite; none legal → hit destroys the target, miss destroys the attacker | P1 |
| PHYS-070 | Push legal only vs a standing target directly ahead of the feet at the same floor level, when no arm weapon fired; +2 per damaged shoulder | P1 |
| PHYS-071 | Push hit: no damage; target moved 1 hex away; attacker enters the vacated hex using no MP; target PSR +0 | P1 |
| PHYS-072 | Mutual pushes both hit: neither moves, both PSR | P1 |
| PHYS-073 | Push into a prohibited hex: nobody moves, PSR still made; push off the board: target destroyed (cause `displacedOff`) | P1 |
| PHYS-090 | Two displacements resolve loser's attack first; a target destroyed by the attack is not displaced; domino PSRs resolve at once, before the PSR queue | P1 |
| PHYS-091 | Displacement into an empty hex 2 levels higher: moves; occupied: domino | P1 |
| PHYS-092 | Displacement into a hex 3 levels higher: nobody moves | P1 |
| PHYS-093 | Displacement 2 levels down: automatic 2-level fall, no PSR; off board: destroyed (cause `displacedOff`) | P1 |
| PHYS-094 | Domino: occupant PSR +0; fail → pushed on and falls; pass → may step forward/back into an empty legal hex if standing, mobile and did not jump; otherwise pushed on without falling; last unit with no legal hex destroyed | P1 |
| PHYS-097 | 80 t falls 3 levels onto a standing unit: hit roll TN 7 + TMM + terrain; hit → target takes `8 × max(1, 3 − 2)` = 8 on the Punch table and PSR +2; miss → faller lands in an empty adjacent hex first | P2 |

## 17. EQUIP: equipment touching the core

| ID | Assertion | P |
|---|---|---|
| EQUIP-001 | Targeting computer: −1 for a large laser, 0 for an LRM, flamer or machine gun; destroyed TC → 0 | P2 |
| EQUIP-002 | TC aimed shots follow TOHIT-034 | P2 |
| EQUIP-010 | AC/10 takes its first crit: still fires with no penalty; second crit on any of its slots: destroyed | P1 |
| EQUIP-011 | Ultra AC firing at double rate never jams (no jam roll exists) | P1 |
| EQUIP-012 | Firing a heavy Gauss rifle triggers no PSR | P2 |
| EQUIP-013 | Capacitor PPC attack roll `[1,1]` does not destroy the capacitor | P2 |
| EQUIP-020 | MASC used 3 turns running: avoid TNs 3, 5, 7; a failure makes one crit check on a random leg | P2 |
| EQUIP-030 | Data containing flail, flechette/fragmentation ammo, full-head ejection, industrial weapons, mechanical jump boosters or UMUs fails validation | P1 |

## 18. BV

| ID | Assertion | P |
|---|---|---|
| BV-001 | No engine rule; adjusted BV checks live in `11-missions.md` / data tests (`round(bv × multiplier)`, 4/5 → 1.00) | P2 |

## 19. MSN: mission hooks (from `11-missions.md` §10)

`MSN-` must be added to the coverage tool's prefix list (`60-testing.md` §2).

| ID | Assertion | P |
|---|---|---|
| MSN-001 | Edge entry pays the entry hex's normal cost | P1 |
| MSN-002 | Intro mission: crippled by two engine crits; ending when the last enemy is crippled | P1 |
| MSN-003 | Both sides eliminated in one check → draw | P1 |
| MSN-004 | A withdrawing unit must end its move closer to its home edge | P2 |
| MSN-005 | A withdrawing unit leaving by its home edge → `withdrawn` | P2 |
| MSN-006 | An immobile withdrawing unit surrenders in the End Phase | P2 |
| MSN-007 | Displaced off the map → `destroyed` (cause `displacedOff`); a voluntary non-home exit is rejected | P2 |
| MSN-008 | `turnLimitBV` tie → draw | P2 |

## 20. GOLD: worked examples

Each `GOLD-` ID in `13-golden.md` is one `it()` in `tests/engine/golden.test.ts`. All are P1: GOLD-001 to GOLD-012.
