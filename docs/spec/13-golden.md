# 13 Golden worked examples

Forced-dice scripts for `tests/engine/golden.test.ts` (`60-testing.md` §6). Each `GOLD-nnn` is one `it()`. The rules
come from `10-rules-core.md`; the arithmetic here is the expected engine output, step by step. Most examples restate a
worked example from the AGoAC rulebook in our own words, with numbers changed where 2026 changed the rule (each
change is noted). Dice faces are ours unless noted. No rulebook text is copied.

Action and event names in the scripts are descriptive ("stand attempt", "discarded crits"); the tests map them to the
`actions.ts` / `events.ts` names (for example "stand attempt" → `StandUpAction {attempt: true}` → `StandAttempted`).

## 0. Index

| ID | Topic | Source | Main IDs exercised |
|---|---|---|---|
| GOLD-001 | Two ranged attacks: partial cover, woods, jump, run | AGoAC to-hit example | TOHIT-010..024, LOS-013, LOS-030, LOS-032 |
| GOLD-002 | Divided LOS, defender's choice | AGoAC to-hit example (third 'Mech) | LOS-002, LOS-005, ARC-020 |
| GOLD-003 | LRM 20 cluster, 5-point groups | AGoAC missile example | CLUS-002, CLUS-003, HITLOC-010 |
| GOLD-004 | Armor, structure, crit checks, destruction, transfer, 20-damage PSR | AGoAC damage example, extended | DMG-002..005, PSR-015 |
| GOLD-005 | Heat build-up over 4 turns, shutdown, restart | AGoAC heat example, extended | HEAT-013, HEAT-020..022, HEAT-031, HEAT-040 |
| GOLD-006 | Failed stand attempt, fall, seatbelt | AGoAC fall example | MOVE-042, PSR-050..056 |
| GOLD-007 | Punch with missing actuators into woods | AGoAC punch example | PHYS-010, PHYS-032, PHYS-033, HITLOC-006 |
| GOLD-008 | Charge after running | AGoAC charge example | PHYS-040..045, PHYS-090, PSR-018, PSR-024 |
| GOLD-009 | Crits lost vs crits transferred | AGoAC critical hit example | CRIT-002, CRIT-003, CRIT-010, CRIT-040, CRIT-031 |
| GOLD-010 | Heat ammo explosion, 20 cap, XL side torso | ours (2026 explosion rules) | HEAT-034, AMMO-010, AMMO-030, DMG-011 |
| GOLD-011 | Two head hits, one consciousness check, recovery | ours (2026 consciousness rule) | PILOT-001, PILOT-010, PILOT-020 |
| GOLD-012 | Through-armor crit, gyro PSR, fall to the rear | ours (AGoAC TAC rule + 2026 fall side) | HITLOC-004, CRIT-040, PSR-053, PSR-056 |

## 1. Conventions

### 1.1 Board and positions

- Board: one 16 × 17 test sheet, every hex clear, level 0, unless the example lists an override.
- Positions are axial `(q, r)` (authoritative) with the printed label in backticks (HEX-003, odd-q offset). Facing 0 =
  north, clockwise (HEX-004). All examples use column `q = 6` (`07xx`) and its neighbours, so most LOS lines run straight
  north-south through hex centres and touch no corners.
- Side `a` is listed first. Each example's initiative rolls decide who acts first.

### 1.2 Roll order (the engine must roll in exactly this order)

| # | Situation | Order |
|---|---|---|
| R1 | Initiative | side `a` 2d6, then side `b` 2d6; a tie re-rolls in the same order (10 INIT-002) |
| R2 | One ranged weapon | to-hit 2d6 → (hit, cluster weapon) cluster 2d6 → for each hit or group in order: location roll → crit check 2d6 if structure was damaged and not destroyed, or TAC → per crit: **one `critSlot` roll** with dice `[block, slot]` (block 1d6 then slot 1d6, 12-slot location) or a single die `[slot]` when one block is entirely inapplicable; each re-roll of an inapplicable slot is a new `critSlot` roll (00 §6, §10.2) |
| R3 | Units in a phase | declaration order; within a unit, the declared weapon order |
| R4 | Charge / DFA | to-hit → target's damage groups (R2 per group) → attacker's damage groups |
| R5 | A fall | seatbelt 2d6 → side 1d6 → location 2d6 per group (R2 crit steps if structure is damaged) |
| R6 | End-of-phase PSR queue | units in initiative order (loser's first); per unit, its PSRs one at a time |
| R7 | Heat Phase | units in initiative order; per unit: restart or shutdown roll → ammo roll → (explosion R2 crit steps) |
| R8 | Consciousness | **before** the PSR queue (AGoAC order, INIT-013 b), one roll per pilot who took hits that phase; one more roll after the queue for a pilot hit by a fall in it |

A golden test asserts the full ordered list of `DiceRolled` events (purpose and faces) from its first roll to its last,
and `expectAllForcedUsed()`. A roll not listed in the script is a failure.

### 1.3 Script notation

- `#n purpose [faces] = total → result` is the n-th roll of the script; the test forces it with
  `force(nextRollSeq(s), ...)`.
- Action lines describe the action in words; the test maps them to `actions.ts` kinds.
- `Expect:` lines are assertions on events or state at that point.
- "Stand Still" for both units means two Movement selections in initiative order.

## 2. Fixture 'Mechs

Test-only 'Mechs in `tests/fixtures/mechs/`. They are schema-valid (`mech.schema.json`); only the listed values matter
to the examples, the rest may be filled freely so data checks pass. Names point at the AGoAC example they stand in for;
the values are **not** claims about the published record sheets. Internal structure always comes from the tonnage table
(`20-data-schema.md` §6.3).

| Fixture | Tons | Walk / Run / Jump | Heat sinks | Weapons (location) | Ammo (location, shots) | Values that matter | Pilot G/P |
|---|---|---|---|---|---|---|---|
| F-WVR "Wolverine" | 55 | 5 / 8 / 5 | 12 single | Medium laser (RA), SRM 6 (RT) | SRM 6 (LT, 15) | CT front armor 23; LA has shoulder, upper arm, lower arm, hand | 4 / 5 |
| F-GRF "Griffin" | 55 | 5 / 8 / 5 | 12 single | PPC (RA), LRM 10 (RT) | LRM 10 (RT, 12) | — | 3 / 4 |
| F-TDR "Thunderbolt" | 65 | 4 / 6 / 0 | 15 single | any | any | CT front armor 30 | 4 / 4 |
| F-CPLT20 "Catapult (LRM 20)" | 65 | 4 / 6 / 4 | 15 single | LRM 20 (RT) | LRM 20 (RT, 6) | — | 4 / 5 |
| F-CPLT "Catapult" | 65 | 4 / 6 / 4 | 15 single | LRM 15 (LA), LRM 15 (RA) | LRM 15 (LT, 8) | arms have shoulder and upper arm only (no lower arm, no hand); CT front armor 30 | 4 / 5 |
| F-TGT45 | 45 | 4 / 6 / 0 | 10 single | Medium laser (CT) | none | front HD 9, CT 20, LT 14, RT 14, LA 12, RA 12, LL 16, RL 16; rear CT 6, LT 4, RT 4; standard engine; CT slots `engine ×3, gyro ×3 / gyro, engine ×3, empty ×2` (slots 1–12) | 4 / 5 |
| F-GHR "Grasshopper" | 70 | 4 / 6 / 4 | 22 single | Medium laser (LA), others free | none in LA | LA armor 22 (structure 11); LT front armor 20 (structure 15); LA slots: shoulder, upper arm, lower arm, hand, medium laser, empty ×7 | 4 / 5 |
| F-SHOOT-X | 65 | 4 / 6 / 0 | 20 single | PPC (RA), Large laser (LA) | none | — | 4 / 5 |
| F-SHOOT-Y | 60 | 4 / 6 / 0 | 15 single | LRM 10 (LT), PPC (RA) | LRM 10 (LT, 12) | — | 4 / 5 |
| F-AWS "Awesome" | 80 | 3 / 5 / 0 | 26 single | PPC (LA), PPC (RT), PPC (RA) | none | no ammo bins at all | 4 / 5 |
| F-BLR "BattleMaster" | 85 | 4 / 6 / 0 | 18 single | any arm weapons | any | front CT 30, LT 20; rear CT 10, LT 8; RT structure 18; RT slots: medium laser ×3 (slots 1–3), empty ×9; CT slots as F-TGT45; standard engine | 4 / 5 |
| F-ML2 | 50 | 5 / 8 / 0 | 10 single | Medium laser (LA), Medium laser (RA) | none | — | 4 / 5 |
| F-UZL "Uziel" | 50 | 6 / 9 / 6 | 10 double | per the UZL-2S skeleton in `20-data-schema.md` (PPC LA, PPC RA, MG LT, MG RT, SRM 6 CT) | SRM 6 (LT, 15), MG (RT, 200) | IS XL 300 (3 engine slots in each side torso); neither side torso has CASE | 4 / 5 |
| F-DUMMY | 50 | 5 / 8 / 0 | 10 single | any | none | never moves (Stand Still) and declares no attacks | 4 / 5 |

Weapon numbers used (standard data, unchanged in 2026): medium laser 5 damage, 3 heat, 3/6/9; SRM 6 2 per missile,
4 heat, 3/6/9; PPC 10 damage, 10 heat, minimum 3, 6/12/18; large laser 8 damage, 8 heat, 5/10/15; LRM 10 1 per missile,
4 heat, minimum 6, 7/14/21; LRM 20 1 per missile, 6 heat, minimum 6, 7/14/21.

---

## GOLD-001 Two ranged attacks: partial cover, woods, jump, run

Source: the AGoAC to-hit example. A running Wolverine fires a medium laser and an SRM 6 at a Griffin that jumped two
hexes and stands behind a low hill; the Griffin answers with its PPC. The book gives the two target numbers (11 and 10);
the board layout and dice below are ours. 2026 changes nothing here.

**Board overrides:** `(6,3)` `0707` level 1, clear. `(6,5)` `0709` light woods. `(6,6)` `0710` light woods.

**Units:** a: F-WVR at `(6,11)` `0715`, facing 0. b: F-GRF at `(6,0)` `0704`, facing 3. Heat 0, no damage.

**Script**

1. `#1 initiative a [3,3] = 6`, `#2 initiative b [4,4] = 8` → b wins; a acts first.
2. Movement, a: F-WVR **Run**, forward 5 hexes to `(6,6)`. MP: 1 + 1 + 1 + 1 + 2 (light woods) = 6 of 8.
   Expect: TMM hex count 5.
3. Movement, b: F-GRF **Jump** to `(6,2)` `0706`, landing facing 3. MP 2 (path `(6,1)`, `(6,2)`).
   Expect: TMM hex count 2, `jumped = true`. No rolls.
4. Ranged declarations: a: F-WVR medium laser (RA) and SRM 6 (RT) at F-GRF. b: F-GRF PPC (RA) at F-WVR.
   Expect: F-WVR SRM 6 bin 15 → 14 at declaration.
   Expect LOS F-WVR → F-GRF: `visible`, not divided, `woodsPoints 1` (from `(6,5)`), `partialCover true` (from `(6,3)`).
   Expect LOS F-GRF → F-WVR: `visible`, `woodsPoints 1`, `partialCover false`.
5. Resolution, F-WVR. Target number for both weapons:

   | Item | Mod |
   |---|---|
   | Gunnery | 4 |
   | Attacker ran | +2 |
   | Target moved 2 hexes (TMM 0) and jumped | +1 |
   | Intervening light woods `(6,5)` (obstacle 2 ≥ both LOS levels 2) | +1 |
   | Partial cover: `(6,3)` is level 1 = target floor + 1, adjacent, on the line, not blocking; attacker LOS level 2 ≤ target's 2 | +1 |
   | Range 4: medium for 3/6/9 | +2 |
   | Attacker heat 0 | 0 |
   | **TN** | **11** |

   - `#3 to-hit medium laser [5,6] = 11` → hit.
   - Direction: bearing Griffin → Wolverine 180°, Griffin facing 3 → rel 0 → **Front**.
   - `#4 location [2,3] = 5` → RL. Leg + partial cover → hit absorbed: no damage, no crit check, no event on RL armor.
   - `#5 to-hit SRM 6 [4,6] = 10` → miss. No cluster roll.
6. Resolution, F-GRF PPC:

   | Item | Mod |
   |---|---|
   | Gunnery | 3 |
   | Attacker jumped | +3 |
   | Target ran 5 hexes (TMM) | +2 |
   | Intervening light woods `(6,5)` | +1 |
   | Target in light woods `(6,6)` | +1 |
   | `(6,3)` is level 1, adjacent to the attacker, below its LOS level 2: does not intervene | 0 |
   | Range 4: short for 6/12/18; minimum 3 cleared | 0 |
   | **TN** | **10** |

   - `#6 to-hit PPC [4,6] = 10` → hit.
   - Direction: bearing Wolverine → Griffin 0°, Wolverine facing 0 → rel 0 → **Front**.
   - `#7 location [3,4] = 7` → CT. Expect: F-WVR CT front armor 23 → 13; no structure damage, no crit check.
7. End of Ranged phase: phase damage F-WVR 10, F-GRF 0 → no PSR. No pilot hits.
8. Physical: no physical attack is legal (not adjacent); both declare none.
9. Heat Phase (a first). Expect no rolls.

   | Unit | Generated | Dissipated | Heat |
   |---|---|---|---|
   | F-WVR | run 2 + laser 3 + SRM 6 4 = 9 | 12 | 0 + 9 − 12 → **0** |
   | F-GRF | jump max(3, 2) = 3 + PPC 10 = 13 | 12 | 0 + 13 − 12 → **1** |

10. End Phase: no rolls. Total rolls: 7.

---

## GOLD-002 Divided LOS: the defender picks the blocked line

Source: the third 'Mech in the same AGoAC example: the Wolverine wants to shoot a Thunderbolt, the line runs exactly
along the border of two hexes, and the defender picks the hex that blocks. Layout ours. 2026 changes nothing here.

**Board overrides:** `(7,3)` `0807` level 3, clear.

**Units:** a: F-WVR at `(6,4)` `0708`, facing 1. b: F-TDR at `(8,3)` `0908`, facing 0.

Geometry: the centres of `(6,4)` and `(8,3)` lie on one east-west line (bearing 90°, range 2). That line runs along the
shared hexside of `(7,3)` (north) and `(7,4)` (south), so the ±ε sequences differ.

**Script**

1. `#1 initiative a [3,3] = 6`, `#2 initiative b [4,4] = 8` → b wins.
2. Movement: both Stand Still (a first).
3. Ranged declarations, a. Expect LOS F-WVR → F-TDR: `divided true`; branches `[(7,3)]` (blocked: ground 3 ≥ both LOS
   levels 2) and `[(7,4)]` (clear); `chosen` = the `(7,3)` branch (LOS-005: blocked beats open); `visible false`.
   Expect: `legalActions` for F-WVR has no ranged attack on F-TDR. Same for F-TDR → F-WVR in b's declaration.
4. Both declare no attacks. No further rolls in the turn. Total rolls: 2.

**Variant 2b** (`it('GOLD-002b ...')`): `(7,3)` is level 0 light woods instead. Expect: `divided true`; neither branch
blocked; `chosen` = the woods branch (higher total modifier); F-WVR medium laser TN = 4 + 0 + 0 + 1 (woods) + 0 (range 2,
short) = **5**; its arc is Forward (bearing 90°, facing 1 → rel 30). Attack direction on F-TDR: bearing F-TDR → F-WVR
270°, facing 0 → rel 270 → **Left** (straight line, ARC-022).

**Variant 2c**: `(7,3)` and `(7,4)` both clear. Expect: `divided true`, the +ε branch chosen, medium laser TN **4**.

---

## GOLD-003 LRM 20 cluster hit in 5-point groups

Source: the AGoAC missile example: an LRM 20 hits, the cluster roll is 8, 12 missiles land, and the three groups strike
CT, LA and RL from the left side with location rolls 8, 4 and 11. Our dice reproduce those rolls. 2026: the leftover
2-point group must be resolved last (`[CL D2]`); it already is.

**Units:** a: F-CPLT20 at `(6,10)` `0714`, facing 0. b: F-TGT45 at `(6,3)` `0707`, facing 5. Range 7.

**Script**

1. `#1 initiative a [2,2] = 4`, `#2 initiative b [5,5] = 10` → a acts first.
2. Movement: both Stand Still.
3. Ranged: a declares LRM 20 at F-TGT45 (bin 6 → 5). b declares none.
   TN = Gunnery 4 + 0 (stood still) + 0 (TMM) + 0 (range 7: short for 7/14/21; minimum 6 cleared) = **4**.
4. `#3 to-hit [2,3] = 5` → hit.
5. `#4 cluster [4,4] = 8` → size 20 column → **12** missiles → groups 5, 5, 2 (2 last).
6. Direction: bearing target → attacker 180°, target facing 5 → rel 240 → **Left** column.
7. `#5 location [4,4] = 8` → CT: front armor 20 → 15.
   `#6 location [1,3] = 4` → LA: 12 → 7.
   `#7 location [5,6] = 11` → RL: 16 → 14.
   Expect: no structure damage, no crit checks; phase damage 12 → no PSR.
8. Physical: none. Heat: F-CPLT20 0 + 6 − 15 → **0**. Total rolls: 7.

---

## GOLD-004 Armor, structure, crit checks, destruction and transfer

Source: the AGoAC step-by-step damage example: a Grasshopper's left arm (armor 22, structure 11) takes a PPC (10), a
large laser (8) and two 5-point LRM groups; the third hit overflows armor by 1 and the fourth takes 5 structure, each
followed by a crit check. We add a final PPC that destroys the arm and spills into the left torso. 2026 changes
nothing here.

**Units:** a: F-GHR at `(6,3)` `0707`, facing 5. b: F-SHOOT-X at `(6,7)` `0711`, facing 0; F-SHOOT-Y at `(6,10)`
`0714`, facing 0. F-SHOOT-X standing between Y and the target does not affect Y's attacks (LOS-004).

**Script**

1. `#1 initiative a [2,2] = 4`, `#2 initiative b [5,5] = 10` → a loses. Selection order 1 v 2: `a, b, b`.
2. Movement: F-GHR, F-SHOOT-X, F-SHOOT-Y all Stand Still.
3. Ranged declarations: F-GHR none. F-SHOOT-X: PPC (RA), then large laser (LA), at F-GHR. F-SHOOT-Y: LRM 10 (LT),
   then PPC (RA), at F-GHR. Expect: F-SHOOT-Y LRM 10 bin 12 → 11.
   Target numbers: X PPC 4 (range 4, short; minimum 3 cleared); X large laser 4 (range 4, short); Y LRM 10 4 (range 7,
   short; minimum 6 cleared); Y PPC 4 + 2 (range 7, medium) = **6**.
   Direction for every hit: rel 240 → **Left** column (4 and 5 → LA).
4. Resolution:

   | Roll | Faces | Result | LA armor | LA structure | Other |
   |---|---|---|---|---|---|
   | `#3` X PPC to-hit | [2,2] = 4 | hit | | | |
   | `#4` location | [1,3] = 4 | LA, 10 | 22 → 12 | 11 | |
   | `#5` X large laser to-hit | [3,3] = 6 | hit | | | |
   | `#6` location | [2,3] = 5 | LA, 8 | 12 → 4 | 11 | |
   | `#7` Y LRM 10 to-hit | [4,4] = 8 | hit | | | |
   | `#8` cluster | [5,6] = 11 | 10 missiles → 5, 5 | | | |
   | `#9` group 1 location | [1,3] = 4 | LA, 5 | 4 → 0 | 11 → 10 | |
   | `#10` crit check LA | [2,3] = 5 | none | | | |
   | `#11` group 2 location | [2,2] = 4 | LA, 5 | 0 | 10 → 5 | |
   | `#12` crit check LA | [3,4] = 7 | none | | | |
   | `#13` Y PPC to-hit | [3,3] = 6 | hit | | | |
   | `#14` location | [1,4] = 5 | LA, 10 | 0 | 5 → 0, destroyed | 5 transfers to LT front armor 20 → 15 |

   Expect: no crit check for the destroyed LA (no ammo, nothing explosive); no crit check on LT (armor only).
   Expect the damage event for `#14`: `structureAfter 0`, `transferredTo 'LT'`.
5. End of Ranged phase: (a) LA and its medium laser marked destroyed now. (b) Phase damage 10 + 8 + 5 + 5 + 10 = 38
   ≥ 20 → one PSR, TN = Piloting 5 + 1 = **6**. `#15 PSR [3,4] = 7` → pass. (c) no pilot hits.
6. Physical: none. Heat: F-GHR 0; F-SHOOT-X 18 − 20 → 0; F-SHOOT-Y 4 + 10 − 15 → 0. Total rolls: 15.

---

## GOLD-005 Heat build-up, shutdown and restart

Source: the AGoAC heat example: an Awesome at heat 4 walks and fires three PPCs (31 heat) with 26 working sinks, reaching
9, then 14 the next turn with a shutdown roll at 4+. We continue to a shutdown and restart. The book says the Awesome
walks 2 / runs 3 at heat 14; its own scale gives walk 3 − 2 = 1, run 2, and we follow the scale (note below). 2026
changes nothing on the heat scale; a shutdown no longer forces a PSR (`[CL H3]`).

**Units:** a: F-AWS at `(6,10)` `0714`, facing 0, heat 4. b: F-DUMMY at `(6,3)` `0707`, facing 3.

**Script.** Every turn: `initiative a [1,2] = 3`, `initiative b [6,6] = 12` → a acts first. F-DUMMY always Stands Still
and declares nothing. The F-AWS to-hit rolls are forced misses `[1,1]`; only their TN and heat matter.

| Turn | Rolls | F-AWS move | Range | PPC TN (G4 + walk 1 + heat mod) | Heat Phase | Expect |
|---|---|---|---|---|---|---|
| 1 | `#1–#2` init; `#3–#5` PPC to-hit [1,1] | walk MP 3 offered; walks 1 hex to `(6,9)` | 6 (short) | 4 + 1 + 0 = **5** | 4 + (1 + 30) − 26 = **9** | no Heat Phase roll |
| 2 | `#6–#7` init; `#8–#10` PPC [1,1]; `#11 shutdown [2,2] = 4` | walk MP **2**, run **3** offered; walks to `(6,8)` | 5 | 4 + 1 + 1 = **6** | 9 + 31 − 26 = **14**; shutdown TN 4, 4 ≥ 4 → stays up | no ammo roll (no bins) |
| 3 | `#12–#13` init; `#14–#16` PPC [1,1]; `#17 shutdown [2,3] = 5` | walk MP **1**, run **2** offered; walks to `(6,7)` | 4 (minimum 3 cleared) | 4 + 1 + 2 = **7** | 14 + 31 − 26 = **19**; shutdown TN 6 (highest of 4, 6), 5 < 6 → **shut down** | no PSR event; no ammo roll (no bins, though heat ≥ 19) |
| 4 | `#18–#19` init | no Movement selection (immobile) | — | no Ranged selection | 19 + 0 − 26 → **0**; heat < 14 → **automatic restart**, no roll | restart event |
| 5 | `#20–#21` init | Movement selection offered with walk **3**, run **5** | | | | script ends |

Total rolls: 21.

---

## GOLD-006 Failed stand attempt, fall and seatbelt check

Source: the AGoAC falling example: a prone 85-ton BattleMaster (Piloting 5) fails to stand, falls 0 levels and takes 9
damage in groups of 5 and 4; its seatbelt check needs 5+. 2026 changes:
- The stand PSR gets −1 (`[CL O2]`): TN 4 (AGoAC 5).
- A stand attempt makes no heat (`[CL H1]`).
- No facing roll (`[CL O7]`). The book rolled a 1 on the old facing table (front). In 2026 a side roll of 1 means
  rear (`[CL O8]`), so the main script forces 3 (front) and variant 6b shows the 1.
- Seatbelt: Piloting + persistent modifiers + levels fallen = 5 + 0 + 0 = 5, as in the book.

**Units:** a: F-BLR at `(6,6)` `0710`, facing 2, **prone**. b: F-DUMMY at `(6,1)` `0705`, facing 3.

**Script**

1. `#1 initiative a [1,2] = 3`, `#2 initiative b [6,6] = 12` → a moves first.
2. F-BLR selects **Walk** (4 MP). Stand attempt: 2 MP, PSR TN 5 − 1 = **4**.
   `#3 stand PSR [1,2] = 3` → fail. Expect: fall in `(6,6)`, 0 levels, still prone, facing **2**.
3. `#4 seatbelt [2,3] = 5` vs TN 5 → pass, no pilot hit.
4. Fall damage `ceil(85 / 10) × (0 + 1)` = **9** → groups 5, 4.
   `#5 fall side [3]` → **Front** column.
   `#6 location [3,4] = 7` → CT front 30 → 25.
   `#7 location [4,4] = 8` → LT front 20 → 16.
5. Expect: F-BLR has 2 MP left and `legalActions` offers a second stand attempt and ending the move. The script ends
   the move (see RULING on repeated stand modifiers). F-DUMMY Stands Still.
6. Ranged, Physical: none. Heat: F-BLR walk 1 − 18 → **0** (no stand heat). Total rolls: 7.

**Variant 6b**: `#5 fall side [1]` → **Rear** column: `#6 [3,4] = 7` → CT rear 10 → 5; `#7 [4,4] = 8` → LT rear 8 → 4.

**Variant 6c** (repeated attempt, PSR-019): after step 4 F-BLR makes a second stand attempt with its last 2 MP, facing 0.
TN is again 5 − 1 = **4** (the −1 never accumulates). `#8 stand PSR [2,2] = 4` → pass: F-BLR stands facing **0** with
0 MP left (`StandAttempted {success: true, facing: 0, mpLeft: 0}`); the move ends. Heat as step 6. Total rolls: 8.

---

## GOLD-007 Punch with missing actuators into light woods

Source: the AGoAC punch example: a Catapult (Piloting 5, no lower arm or hand actuator) punches a Thunderbolt standing
in light woods on its right side; neither moved; the punch hits on a 9 for 3 damage to the CT (punch table roll 3).
2026 changes: punch base modifier −1 (`[CL C34]`), so TN **8** (AGoAC 9); punch table reversed (`[CL C18]`), row 3 is
CT in both versions.

**Board overrides:** `(6,5)` `0709` light woods.

**Units:** a: F-CPLT at `(7,5)` `0809`, facing 5. b: F-TDR at `(6,5)` `0709`, facing 0.

**Script**

1. `#1 initiative a [2,2] = 4`, `#2 initiative b [5,5] = 10` → a first.
2. Movement: both Stand Still. Ranged: both declare none (the F-CPLT right arm must not fire, PHYS-031).
3. Physical: F-CPLT declares a right-arm punch on F-TDR. Arc: bearing F-CPLT → F-TDR 300°, facing 5 → rel 0, Forward.

   | Item | Mod |
   |---|---|
   | Piloting | 5 |
   | Punch | −1 |
   | Lower arm actuator absent | +2 |
   | Hand actuator absent | +1 |
   | Attacker stood still, target TMM 0 | 0 |
   | Target in light woods | +1 |
   | **TN** | **8** |

   `#3 punch [4,5] = 9` → hit.
4. Damage `ceil(65 / 10)` = 7, halved once for the absent lower arm (round down) = **3**.
   Direction: bearing F-TDR → F-CPLT 120°, facing 0 → rel 120 → **Right** column.
   `#4 punch location [3]` → CT: front armor 30 → 27.
5. End of phase: no PSR (a punch causes none; 3 < 20). Heat 0 for both. Total rolls: 4.

---

## GOLD-008 Charge after running

Source: the AGoAC charge example: a 65-ton Catapult moves 5 hexes, has 1 MP left to enter the target's hex, and charges
a 45-ton 'Mech: 33 damage to the target (6.5 × 5, rounded up), 5 to the Catapult (45 / 10, rounded up).
2026 changes: charge damage uses the TMM-bracket formula (`[CL C24]`, PHYS-043, RULING in §4): N = 5 + 1 = 6 falls in the
5–6 bracket, L = 5, damage `ceil(65 / 10 × 5)` = **33** (same as AGoAC here). Charger damage stays 5. Charger's hit column is our ruling (Front).

**Units:** a: F-CPLT at `(6,8)` `0712`, facing 0. b: F-TGT45 at `(6,2)` `0706`, facing 3.

**Script**

1. `#1 initiative a [5,5] = 10`, `#2 initiative b [2,2] = 4` → b loses and moves first (the target must have moved
   before a charge is declared).
2. Movement: F-TGT45 Stands Still. F-CPLT **Runs** forward 5 hexes to `(6,3)` `0707` (5 of 6 MP; 1 MP left = cost to enter
   the target's clear hex) and declares a **charge** on F-TGT45. Expect: TMM hex count 5.
3. Ranged: F-TGT45 declares none; F-CPLT has no ranged attack legal.
4. Physical: F-TGT45 none. Charge TN = Piloting 5 + 0 (charge) + (5 − 5) comparative + 2 (ran) + 0 (target TMM) = **7**.
   `#3 charge [3,4] = 7` → hit.
5. Target damage 33 → groups 5 × 6 + 3. Direction: bearing target → charger 180°, facing 3 → rel 0 → **Front**.

   | Roll | Faces | Location | Damage | Armor after |
   |---|---|---|---|---|
   | `#4` | [3,4] = 7 | CT | 5 | 20 → 15 |
   | `#5` | [3,3] = 6 | RT | 5 | 14 → 9 |
   | `#6` | [4,4] = 8 | LT | 5 | 14 → 9 |
   | `#7` | [3,4] = 7 | CT | 5 | 15 → 10 |
   | `#8` | [1,3] = 4 | RA | 5 | 12 → 7 |
   | `#9` | [4,6] = 10 | LA | 5 | 12 → 7 |
   | `#10` | [4,5] = 9 | LL | 3 | 16 → 13 |

6. Charger damage `ceil(45 / 10)` = 5, Front column: `#11 [3,4] = 7` → CT front 30 → 25.
7. Displacement Step: F-TGT45 moves 1 hex directly away to `(6,1)` `0705`, facing 3 kept. F-CPLT enters `(6,2)` `0706`,
   facing 0. No rolls (empty clear hex).
8. PSR queue (b first): F-TGT45 has two triggers, charged (+2) and 33 ≥ 20 (+1): TN 5 + 2 + 1 = **8** for both rolls.
   `#12 [4,4] = 8` pass; `#13 [5,6] = 11` pass. F-CPLT: successful charge +2 → TN **7**: `#14 [3,4] = 7` pass.
9. Heat: F-TGT45 0; F-CPLT run 2 − 15 → 0. Total rolls: 14.

---

## GOLD-009 Crits lost in one phase, transferred in the next

Source: the AGoAC critical hit example: a BattleMaster's right torso (three medium lasers, two already destroyed) takes
structure damage and rolls 12: one crit kills the last laser and the other two are lost because the torso still had a
live slot at the start of the phase. In the Physical Attack Phase of the same turn the torso is damaged again, rolls 10,
and both crits move to the CT. Layout and CT outcomes ours. 2026 change: a gyro crit is +2 to PSRs (`[CL D13]`), so the
gyro PSR is TN 7 (old rules 8).

**Units:** a: F-WVR at `(6,4)` `0708`, facing 0. b: F-BLR at `(6,3)` `0707`, facing 3, standing, with prior damage: RT
front armor 0, RT slots 1 and 2 (medium lasers) destroyed. RT structure 18 intact.

**Script**

1. `#1 initiative a [2,2] = 4`, `#2 initiative b [5,5] = 10` → a first.
2. Movement: both Stand Still.
3. Ranged: F-WVR medium laser (RA) at F-BLR; F-BLR declares none. TN = 4 + 0 + 0 + 0 (range 1, short) = **4**.
   `#3 to-hit [2,2] = 4` → hit. Direction: rel 0 → **Front**.
   `#4 location [3,3] = 6` → RT: armor 0, structure 18 → 13.
   `#5 crit check RT [6,6] = 12` → 3 crits (torso).
   - Crit 1: slots 7–12 are all empty, so no block die; `#6 critSlot [3]` (single die) → slot 3, medium laser destroyed.
   - Crits 2 and 3: no applicable RT slot left, and RT had one at the start of this phase → both **lost**, no dice.
     Expect one `CritLost {location: 'RT', count: 2, why: 'noSlotThisPhase'}` for F-BLR (CRIT-010), right after
     the `CritSlotHit` of crit 1.
4. End of Ranged phase: 5 damage, no PSR.
5. Physical: F-WVR punches with its left arm (it fired only the right-arm laser). TN = Piloting 5 − 1 = **4**.
   `#7 punch [2,2] = 4` → hit. Damage `ceil(55 / 10)` = 6.
   `#8 punch location [2]` → Front column row 2 = RT: structure 13 → 7.
   `#9 crit check RT [4,6] = 10` → 2 crits. RT had no applicable slot at the start of this phase → both **transfer to CT**.
   - CT crit 1: `#10 critSlot [2,4]` → block 1 (slots 1–6), slot 4 → slot 4, **gyro** (gyro crit 1).
   - CT crit 2: `#11 critSlot [5,2]` → block 2 (slots 7–12), slot 2 → slot 8, **engine** (engine crit 1).
6. Displacement: none. PSR queue: F-BLR gyro crit → TN 5 + 2 = **7**. `#12 PSR [3,4] = 7` → pass.
7. Heat (a first): F-WVR 3 − 12 → 0. F-BLR: generated 5 (engine crit; shown as `engine` in the breakdown) − 18 → 0.
   Total rolls: 12.

---

## GOLD-010 Heat-triggered ammo explosion with the 20-point cap

Ours, built on the 2026 explosion rules: heat 21 leads to a failed ammo roll; the bin with the highest damage per shot
blows (AGoAC order); the damage is capped at 20; destroying the XL side torso (here the left one) destroys the 'Mech. Under AGoAC rules the same SRM 6 bin
would deal its full 180 points and cause 2 pilot hits; 2026 caps it at 20 (`[CL D11]`) with 1 pilot hit (`[CL D8]`). The bin is picked
by the AGoAC rule (AMMO-030; the "simplified" `[CL H2]` text is unknown, RULING in §4).

**Units:** a: F-UZL at `(6,8)` `0712`, facing 0, **heat 21**. b: F-DUMMY at `(6,3)` `0707`, facing 3. Range 5.

**Script**

1. `#1 initiative a [1,2] = 3`, `#2 initiative b [6,6] = 12` → a first.
2. Movement: F-UZL is offered walk 6 − 4 = **2** (heat 21), run 3, jump 6; it Stands Still. F-DUMMY Stands Still.
3. Ranged: F-UZL fires both PPCs at F-DUMMY. TN = 4 + 0 + 0 + 0 (range 5, short; minimum 3 cleared) + 3 (heat 21)
   = **7**. `#3 [1,1]` miss, `#4 [1,1]` miss.
4. Physical: none.
5. Heat Phase, F-UZL: heat 21 + 20 − 20 = **21**.
   - Shutdown: TN 6 (highest of 14 → 4, 18 → 6). `#5 [3,4] = 7` → stays up.
   - Ammo: TN 4 (19 → 4). `#6 [1,2] = 3` → explosion.
   - Bin: SRM 6 bin LT, 12 per shot (6 missiles × 2) beats MG bin RT, 2 per shot (the MG bin's larger total, 400 vs 180,
     does not matter) → the **SRM 6 bin in LT** explodes (no roll).
   - Damage min(15 × 12 = 180, 20) = **20**, structure only: LT structure 12 → 0, **LT destroyed**; 8 transfers to CT
     structure 16 → 8. CT armor unchanged.
   - LT destroyed: no crit check (its only explosive item, the SRM 6 bin, is now empty). CT took structure damage:
     `#7 crit check CT [2,3] = 5` → none.
   - Consequences of LT destruction: LA and its PPC destroyed, the LT machine gun destroyed; LT rear armor lost; the 3 XL
     engine slots in LT count as 3 engine crits → **F-UZL destroyed**. Pilot hits 0 → 1. SRM 6 bin shots → 0.
6. End of Heat Phase: (a) F-UZL removed. (b) and (c): no PSR (despite 20 damage) and no consciousness roll for a
   destroyed unit.
7. End Phase: victory check → side b wins (side a has no units). Total rolls: 7.

---

## GOLD-011 Two head hits, one consciousness check, recovery

Ours, built on the 2026 rule that a pilot hit several times in one phase makes one check at the number for the new total
(`[CL O14]`). Under the old rules the same phase would need two checks (TN 10, then 11).

**Units:** a: F-ML2 at `(6,6)` `0710`, facing 0. b: F-TGT45 at `(6,3)` `0707`, facing 3, **pilot hits 3**.

**Script**

1. `#1 initiative a [2,2] = 4`, `#2 initiative b [5,5] = 10` → a first.
2. Movement: both Stand Still.
3. Ranged: F-ML2 fires both medium lasers at F-TGT45. TN = 4 + 0 + 0 + 0 (range 3, short) = **4**.
   - `#3 to-hit [3,3] = 6` hit; `#4 location [6,6] = 12` → HD: armor 9 → 4; pilot hits 3 → 4. No crit check.
   - `#5 to-hit [4,4] = 8` hit; `#6 location [6,6] = 12` → HD: armor 4 → 0, structure 3 → 2; pilot hits 4 → 5.
     `#7 crit check HD [2,2] = 4` → none.
4. End of Ranged phase: no PSR (10 < 20). One consciousness check for 5 hits: TN **11**. `#8 [5,5] = 10` →
   **unconscious**. Expect: F-TGT45 immobile from the Physical phase on.
5. Physical: F-TGT45 has no selection. F-ML2 declares none. Heat: F-ML2 3 + 3 − 10 → 0. End Phase turn 1: no recovery
   roll (the pilot was knocked out this turn).
6. Turn 2: `#9 initiative a [2,2] = 4`, `#10 initiative b [5,5] = 10`. Expect: F-TGT45 gets no Movement, Ranged or
   Physical selection. F-ML2 Stands Still, declares nothing.
7. End Phase turn 2: recovery TN 11. `#11 [6,6] = 12` → **conscious**. Total rolls: 11.

---

## GOLD-012 Through-armor crit, gyro PSR and a fall to the rear

Ours: a location roll of 2 forces a crit check with armor still on (AGoAC TAC rule, unchanged), the crit hits the gyro,
the end-of-phase PSR fails, and the fall lands on the rear under the 2026 side roll. 2026 changes: gyro +2 (`[CL D13]`;
old TN would be 8); rear on a 1 (`[CL O8]`); seatbelt adds only persistent modifiers and levels (`[CL O12] [CL O13]`).

**Units:** a: F-WVR at `(6,6)` `0710`, facing 0. b: F-TGT45 at `(6,3)` `0707`, facing 3.

**Script**

1. `#1 initiative a [2,2] = 4`, `#2 initiative b [5,5] = 10` → a first.
2. Movement: both Stand Still.
3. Ranged: F-WVR medium laser (RA) at F-TGT45. TN = 4 + 0 (range 3, short) = **4**.
   `#3 to-hit [3,3] = 6` → hit. Direction: rel 0 → **Front**.
   `#4 location [1,1] = 2` → CT, TAC. CT front armor 20 → 15; no structure damage.
   `#5 TAC crit check CT [4,4] = 8` → 1 crit. `#6 critSlot [1,5]` → block 1 (slots 1–6), slot 5 → slot 5, **gyro** (crit 1).
4. End of Ranged phase: PSR queue: gyro crit → TN 5 + 2 = **7**. `#7 PSR [2,3] = 5` → fail.
   Expect: F-TGT45 falls in `(6,3)`, 0 levels, prone, facing **3**.
   `#8 seatbelt [4,3] = 7` vs TN 5 + 2 + 0 = **7** → pass, no pilot hit.
   Fall damage `ceil(45 / 10) × 1` = **5**, one group. `#9 fall side [1]` → **Rear** column.
   `#10 location [3,4] = 7` → CT rear armor 6 → 1.
   No consciousness check (no pilot hits).
5. Physical: F-TGT45 is prone (no physical attacks); F-WVR is not adjacent. Heat: F-WVR 3 − 12 → 0; F-TGT45 0.
   Total rolls: 10.

---

## 3. 2026 adjustments made to the source examples

| Example | AGoAC value | 2026 value | Reason |
|---|---|---|---|
| GOLD-006 | stand PSR TN 5; 1 heat per stand attempt; facing roll 1 → front | TN 4; 0 heat; side roll 1 → rear | `[CL O2] [CL H1] [CL O7] [CL O8]` |
| GOLD-007 | punch TN 9 | TN 8 | `[CL C34]` punch −1 |
| GOLD-008 | charge damage 33 | 33 (formula differs at other speeds) | `[CL C24]` TMM-bracket formula (RULING) |
| GOLD-009 | gyro PSR TN 8 | TN 7 | `[CL D13]` |
| GOLD-005 | walk 2 / run 3 at heat 14 (book text) | walk 1 / run 2 | the book's own scale (−2 at 10+) on walk 3; not a 2026 change |
| GOLD-010 | full bin damage (180), 2 pilot hits | 20 cap, 1 pilot hit; same bin chosen | `[CL D11] [CL D8]` |
| GOLD-011 | one check per hit | one check per phase | `[CL O14]` |

## 4. Rulings made in this file

| Rule | What we did | Why |
|---|---|---|
| Charge/DFA damage order | target's groups are rolled before the attacker's (R4) | no source fixes the order; forced-dice tests need one |
| Repeated stand attempts in one phase | each stand attempt is Piloting + persistent mods − 1 (own modifier only, PSR-019); the main GOLD-006 script stops after one attempt and variant 6c makes a second at the same TN | PSR-001: Movement-phase PSRs never carry earlier triggers; only the end-of-phase batch accumulates |
| Charge damage (`[CL C24]`) | ceil(tonnage / 10 × L), L = lowest hex count of the TOHIT-014 bracket for hexes moved + 1 (PHYS-043) | changelog gives no numbers; AGoAC-like below 10 hexes, lower above |
| Heat-explosion bin (`[CL H2]`) | AGoAC rule: most damage per shot, then most shots (AMMO-030) | 2026 text unknown |
| Consciousness vs PSR order | consciousness first, then the PSR queue, then one more check for fall hits | AGoAC; `[CL O14]` does not reorder |
| Water-landing fall levels | MOVE-053 (levels = depth) beats PSR-051 (jump falls 0 levels) | the specific rule wins; checklist MOVE-053 uses it |
| Destroyed units at end of phase | no PSR or consciousness roll for a unit removed in INIT-013 step (a) | removal comes first in INIT-013 |
