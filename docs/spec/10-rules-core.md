# 10 Rules core (BattleTech Classic, 2026 Core Rules target)

The engine's rules contract. All prose is ours; no rulebook text is copied.

- **Baseline:** the A Game of Armored Combat rulebook (AGoAC, TW-era), checked 2026-10-08 against the text extract
  in `docs/sources/agoac-rulebook.txt` and the reference card.
- **Target:** the 2026 Core Rules. Every change from the 2026 Master Changelog that touches a rule here is applied
  and tagged with its changelog reference: `[CL P5]` = Playing the Game item 5. Section letters: P Playing,
  M Movement, C Combat, D Damage, H Heat, O Other Actions, B Battlefield, MS Missions, W Weapons & Equipment.
- **Tags:**
  - `(2026)`: a confirmed 2026 change, with its `[CL ..]` reference.
  - `(2026?)`: 2026 changed the rule but the changelog gives no number, or both sources are silent. The value is
    our ruling and appears as a `RULING:` line for `docs/needs-rules-check.md`.
  - Untagged: AGoAC rule unchanged by 2026.
- **IDs** (`HEAT-022`) are referenced by `12-rules-test-checklist.md` and engine test names. They are never
  renumbered; retired IDs stay listed as "retired". Families: INIT HEX MOVE LOS ARC TOHIT HITLOC CLUS DMG CRIT
  AMMO HEAT PSR PILOT PHYS EQUIP SCN BV.
- Where this file and `00-architecture.md` disagree about types or event names, `00-architecture.md` wins; the
  numbers and procedures here win.

## 0. Edition leak guard (hard fail in code or data)

| Never implement | Our rule |
|---|---|
| Alpha Strike damage (2/2/1), inch ranges, one structure track | Per-weapon damage, hex ranges, armor + internal structure per location |
| HBS stability bar, evasion pips, morale called shots | PSRs and TMM (§3, §13); aimed shots only per TOHIT-030 |
| MechWarrior ghost heat, real-time beams | Turn-based heat scale (§12) |
| Skidding, Facing After Fall table, ammo dumping, PSR on shutdown | Removed in 2026 `[CL B7] [CL O7] [CL O15] [CL H3]` |
| "Weapon Attack Phase" | "Ranged Attack Phase" `[CL C1]` |
| Stand-up heat, +3 gyro, +2 hip, hip halves MP, foot PSR, 2 pilot hits per ammo explosion, +2 rear secondary target | All replaced by 2026 values below |

## 1. General conventions

| ID | Rule |
|---|---|
| HEX-001 | All dice are d6. "2d6 ≥ TN" succeeds when the sum is equal to or greater than the target number (TN). Every roll goes through `roll(state, spec)` |
| HEX-002 | Rounding: damage values computed by division round **up** (tonnage ÷ 10, ÷ 5) unless a rule says otherwise. Halving punch/kick damage for actuator damage rounds **down**, minimum 1. Halving fall damage in water rounds down |
| HEX-003 | Map: flat-topped hexes. Internal coordinates are axial `(q, r)`; the printed label is `XXYY` = (column + 1, row + 1) with 0-based odd-q offset (odd 0-based columns, labels `02xx`, `04xx` …, sit half a hex lower; `0101` top-left, `0201` is lower than `0101`). Checked 2026-10-08 against MegaMek `Coords` (`yInDir`, `toCube`): same parity and the same direction numbering. Worked examples: 00 §3.1 |
| HEX-004 | Facing 0 = north (pointing at the north hexside), 0–5 clockwise. Axial neighbour of facing f: 0 `(0,-1)`, 1 `(+1,-1)`, 2 `(+1,0)`, 3 `(0,+1)`, 4 `(-1,+1)`, 5 `(-1,0)` |
| HEX-005 | Range = hex distance (cube distance): the target's hex counts, the attacker's does not. Adjacent = range 1. Level differences never change range |
| HEX-006 | Bearing from hex A to hex B: compute pixel centres (flat-top: `x = 1.5·q`, `y = √3·(r + q/2)`, y down) and take `atan2(dx, −dy)` in degrees, 0 = north, clockwise, normalised to [0, 360). Compare angles with a tolerance of 1e-6° |
| HEX-007 | Relative bearing `rel(A→B, f) = (bearing(A→B) − 60·f) mod 360` |
| HEX-008 | Each hex has an integer ground **level** and at most one terrain type from §3.3. A water hex's level is its surface; its **depth** d ≥ 1 puts its **floor** (bottom) at `level − d`. For every other hex, floor = level |
| HEX-009 | A 'Mech occupies one hex. Height: standing 2 levels, prone 1 level. A 'Mech's **LOS level** = its hex's floor (ground, or water bottom) + height |
| HEX-010 | Partial hexes at map edges do not exist on our boards; LOS always ignores partial hexes `[CL C6]`. A unit moved or displaced off the board or into a partial hex is destroyed with cause `displacedOff` (a voluntary exit is SCN-010, never this) |

## 2. Turn sequence and initiative

| ID | Rule |
|---|---|
| INIT-001 | A turn is six phases in order: **Initiative, Movement, Ranged Attack, Physical Attack, Heat, End** `[CL C1]`. Every unit completes a phase before the next begins |
| INIT-002 | Initiative: each side rolls 2d6. Ties re-roll (both sides). Higher total wins. The loser acts first in every alternating phase; the winner acts last. Engine roll order: side `A` (setup side 0) first, then side `B`; each re-roll repeats A then B (13 §1.2 R1; every golden depends on it) |
| INIT-003 | Alternating phases are Movement, Ranged Attack (declarations) and Physical Attack (declarations). In each, sides alternate **selections** (one unit's complete move, or one unit's complete attack declaration), loser first |
| INIT-004 | **Eligible units** for a phase's alternation: Movement: every unit on the board or due to enter this turn, except immobile units (2026 `[CL M7]`; they are skipped and do not count). Ranged and Physical: every unit except those shut down or with an unconscious pilot (2026 `[CL C3]`). Destroyed units never count |
| INIT-005 | **Unequal numbers, front-loaded** (2026 `[CL P5]`): selections happen in *pairs*, loser's turn then winner's. At the start of each pair let `a` = loser's eligible units not yet selected, `b` = winner's. Loser selects `n_L = a > b ? ceil(a/b) : 1` units; then the winner selects `n_W = b > a ? ceil(b/a) : 1` units, using the counts from the start of the pair. If one side has 0 left, the other selects all its remaining units one at a time. The extra units of the larger side therefore come early in the phase |
| INIT-006 | Worked examples (tests): loser 3 vs winner 4 → `L WW L W L W`. Loser 10 vs winner 18 → winner selects 2 per pair for pairs 1–8, then 1 and 1 (pairs 9–10). Loser 4 vs winner 2 → pair 1 (`a=4, b=2`) `LL W`, pair 2 (`a=2, b=1`) `LL W`: sequence `LL W LL W`. Equal sides alternate 1:1 |
| INIT-007 | A unit selected for several units in one turn of the pair is chosen and resolved one at a time (each unit's whole move before the next unit starts) |
| INIT-008 | The optional Initiative Die `[CL P4]` is not implemented |
| INIT-009 | **Movement Phase:** units move per INIT-005. Movement-caused PSRs resolve the moment they trigger (PSR-030). Charge and DFA are declared here (PHYS-040, PHYS-060) |
| INIT-010 | **Ranged Attack Phase:** (1) declarations alternate per INIT-005: torso twist or arm flip (ARC-010..014), each weapon and its target, aimed-shot choices; ammo is spent at declaration (AMMO-001). (2) Resolution: units resolve one at a time in declaration order; per unit, the controller orders weapons; each hit (each cluster group) is resolved fully, crits included, before the next. (3) End-of-phase steps INIT-013 |
| INIT-011 | **Physical Attack Phase:** declarations alternate per INIT-005 (a torso twist may be declared here if none was declared this turn, ARC-011). Resolution as INIT-010. Then the Displacement Step (PHYS-090), then INIT-013 |
| INIT-012 | **Damage timing:** damage from attacks is booked immediately (armor, structure, crits, transfers, explosions; a destroyed location takes no further damage and transfers it), but its gameplay effects (destroyed weapons, crit modifiers, destroyed units, MP loss) apply only after every attack declared that phase is resolved. A unit destroyed mid-phase still makes all its declared attacks. Damage from falls, displacement and the Heat Phase applies at once |
| INIT-013 | **End-of-phase steps** for Ranged, Physical and Heat: (a) apply gameplay effects of the phase's damage; remove destroyed units; (b) one consciousness check per pilot that took hits this phase (PILOT-010); (c) resolve the PSR queue (PSR-020) including automatic falls; (d) one more consciousness check for each pilot hit **by a fall during step (c)** (seatbelt, PSR-056). Order b before c follows AGoAC (the Consciousness Roll comes first when both are due); `[CL O14]` only merges the per-hit checks into one and does not move them. A pilot knocked out in (b) fails every PSR in (c) automatically (PSR-005) |
| INIT-014 | **Heat Phase:** HEAT-030 order |
| INIT-015 | **End Phase**, in order: (1) unconscious-pilot recovery rolls (PILOT-020); (2) life support submerged damage (CRIT-061); (3) torso twists and flipped arms return forward; (4) voluntary shutdown / restart (HEAT-041); (5) forced withdrawal surrender check if enabled (SCN-031); (6) remove destroyed units; (7) victory check (SCN-020) |
| INIT-016 | Movement selections may not be changed after the unit starts moving; attack declarations may not be changed after declaration |

## 3. Movement

### 3.1 Modes and MP

| ID | Rule |
|---|---|
| MOVE-001 | Each eligible unit is assigned exactly one mode: **Stand Still, Walk, Run, Jump**. Unspent MP is lost |
| MOVE-002 | Stand Still: spends no MP (not even facing changes). Attacker mod 0, TMM 0, heat 0. Choosing it does not make a unit immobile |
| MOVE-003 | Walk: up to Walk MP; forward and backward moves allowed. Attacker mod +1, heat 1 |
| MOVE-004 | Run: up to Run MP; no backward moves. Attacker mod +2, heat 2 |
| MOVE-005 | Jump: up to Jump MP; only if standing at the start of the turn. Attacker mod +3, TMM gets +1 extra (TOHIT-012), heat = max(3, hexes jumped) |
| MOVE-006 | **Current MP:** `walk = baseWalk − legActuatorCrits` (each hip, upper leg, lower leg, foot crit = 1; 2026 `[CL D15]`), floored at 1 while at least one leg is intact (2026 `[CL D5]`). One leg destroyed → walk = 1 (2026 `[CL M9]`). Both legs destroyed → walk 0, run 0. Then subtract heat MP loss (HEAT-020), floor 0. `run = ceil(1.5 × walk)` (so walk 1 → run 2). Leg damage never raises MP `[CL D5]` |
| MOVE-007 | `jump = jumpJets` operable (−1 per destroyed jump jet, CRIT-071); heat MP loss never reduces Jump MP. Jump jets in a submerged location can't fire (MOVE-062) |
| MOVE-008 | **Immobile** (2026 `[CL M6]`): a unit is immobile if it is shut down, its pilot is unconscious, or damage alone has left it 0 MP in every mode it has (e.g. both legs gone and no jump). Not immobile: standing still by choice, prone, gyro destroyed, 0 MP from heat |
| MOVE-009 | Immobile units get no movement selection (2026 `[CL M7]`) |

### 3.2 Moving hex to hex

| ID | Rule |
|---|---|
| MOVE-010 | Ground movement (walk/run): enter the hex directly ahead (forward) or directly behind (backward, walk only). Any other hex needs facing changes first |
| MOVE-011 | Facing change: 1 MP per hexside, any number, any time during ground movement |
| MOVE-012 | A unit may move through friendly units, and through **immobile enemy** units (2026 `[CL M8]`). It may not enter a hex with a mobile enemy except as a charge (PHYS-040). It may never end movement in an occupied hex (stacking limit 1 per hex at the end of the Movement Phase) |
| MOVE-013 | **TMM hex count**: hexes entered this turn; if the unit moved both forward and backward, count only hexes entered since the last change of direction. Facing changes, stand attempts and dropping prone add nothing. Jump: hexes along the jump path |
| MOVE-014 | **Minimum movement:** a unit with ≥1 MP that spends no other MP this turn (no facing change) may enter the hex directly ahead even if it costs more than its MP, if the hex is not prohibited. It counts as Run (so a water hex is allowed with its run-entry PSR, MOVE-061). A prone unit with exactly 1 MP may use this to make one stand attempt (counts as Run) |
| MOVE-015 | Level change per hex entered: up or down by 1 or 2 levels only; 3+ is prohibited (MOVE-030) |
| MOVE-016 | **Backward level changes** are allowed (2026 `[CL M4]`). Each backward move that changes level triggers a PSR at +0 after entering the hex (2026?) |
| MOVE-017 | A unit with one or more **hip** crits may change at most 1 level per hex entered (2026? `[CL D15]` "impedes level changes") |

### 3.3 MOVEMENT COSTS table

Cost to enter a hex = 1 (base) + terrain cost + level-change cost.

| ID | Terrain / action | MP | PSR on entering (walk/run) |
|---|---|---|---|
| MOVE-020 | Clear | +0 | none |
| MOVE-021 | Paved / bridge (`pavement`) | +0: costs exactly as clear; no LOS and no to-hit effect | none (no skidding, 2026 `[CL B7]`) |
| MOVE-022 | Road, moving from a road hex along the road | +0, and level-change cost −1 (min 0) (2026 `[CL M11]`) | none |
| MOVE-023 | Rough | +1 | none |
| MOVE-024 | Light woods (jungle = woods `[CL B2]`) | +1 | none |
| MOVE-025 | Heavy woods | +2 | none |
| MOVE-026 | Rubble | +1 | PSR +0 |
| MOVE-027 | Water depth 1 | +1 (cost on the bottom; add level change separately) | Walk: none (2026 `[CL M2]`). Run: PSR −1 (2026 `[CL M3]`) |
| MOVE-028 | Water depth 2+ | +2 (2026 `[CL M1]`, was +3) + level change | Walk: none. Run: depth 2 PSR +0, depth 3+ PSR +1 |
| MOVE-029 | Level change | +1 per level (up or down), max 2 per hex | none (backward: MOVE-016) |
| MOVE-030 | **Prohibited** (never enterable on the ground or by a jump landing) `[CL M5]` | 3+ level change in one hex; off-board; hex with a mobile enemy (except charge); ending in any occupied hex | — |
| MOVE-031 | Facing change | 1 per hexside | none |
| MOVE-032 | Drop prone | 1 | none |
| MOVE-033 | Stand up attempt | 2 per attempt | PSR −1 (PSR-019) |

Notes:
- MOVE-034: Water example: level 0 shore → depth 1 = 1 + 1 + 1 (down 1 level) = 3 MP; depth 1 → depth 1 = 2 MP;
  shore → depth 2 = 1 + 2 + 2 = 5 MP; depth 1 → shore = 1 + 0 + 1 = 2 MP.
- MOVE-035: Ice, mud, sand, snow, swamp, fog, foliage, fire/smoke and buildings (`[CL B1] [CL B3] [CL C5]`) are
  reserved for the battlefield module (M8). Engine data must reject them until then.

### 3.4 Prone and standing

| ID | Rule |
|---|---|
| MOVE-040 | Drop prone: 1 MP, any time during walk/run movement, not if jumping. No damage, no heat beyond the mode's. Facing kept |
| MOVE-041 | A unit starting the Movement Phase prone declares Walk or Run (not Jump). While prone it may only change facing (1 MP/hexside) or attempt to stand |
| MOVE-042 | Stand attempt: 2 MP, then PSR at −1 (2026 `[CL O2]`), **no heat** (2026 `[CL H1]`). Every attempt is −1: the modifier never grows with repeated attempts in one phase (PSR-019). Success: the unit takes the facing given by `StandUpAction.facing` (default: current) at no MP cost, then continues with remaining MP. Failure: the unit falls again in its hex (0-level fall, PSR-050) and may try again if it has MP. A unit that fell this turn may stand the same phase if it has MP and did not jump |
| MOVE-043 | Can't stand: both legs destroyed; one leg and both arms destroyed; gyro destroyed |
| MOVE-044 | One-legged unit: one stand attempt per turn, always counts as Run. All PSRs the attempt requires are rolled separately (2026 `[CL M10]` removed the single-PSR exception) |
| MOVE-045 | Prone units: height 1, can't torso twist or flip arms, fire per TOHIT-008, can't make physical attacks |

### 3.5 Jumping

| ID | Rule |
|---|---|
| MOVE-050 | Cost: 1 MP per hex along a **shortest** hex path from start to landing, ignoring terrain and units on the path. Jumping back into the start hex costs 1 MP |
| MOVE-051 | Height: every hex on the chosen path, and the landing hex, must have level ≤ start hex floor level + Jump MP available. If every shortest path fails, the landing hex is unreachable by jump. Woods heights never matter. Any number of levels down is allowed |
| MOVE-052 | Landing: choose any facing free. Must obey MOVE-030 (no occupied landing hex except DFA, PHYS-060) |
| MOVE-053 | Landing in water depth ≥ 1: PSR +0 on landing. Failure: the unit falls to the bottom; levels fallen = depth; fall damage halved (round down) |
| MOVE-054 | Jump PSRs on landing: see PSR-031 |

### 3.6 Water

| ID | Rule |
|---|---|
| MOVE-060 | A standing unit in depth 1 has its legs submerged and gets partial cover (LOS-031). **Submerged**: standing in depth 2+, or prone in depth 1+ |
| MOVE-061 | Running into a water hex of depth ≥ 1 is allowed with a PSR (MOVE-027/028; 2026 `[CL M3]`). Facing changes inside water and moving water → land never need a PSR |
| MOVE-062 | Jump jets in submerged locations can't fire: standing in depth 1 → leg jump jets unusable; submerged → all |
| MOVE-063 | Heat dissipation in water: HEAT-012 |

### 3.7 Deployment and edge entry

| ID | Rule |
|---|---|
| SCN-001 | A scenario sets each side's deployment: `edgePlace` (placed inside a depth-limited edge zone) or `hexes` (placed on the listed hexes) before turn 1 (data `deployment.mode`, `20-data-schema.md`), or `edgeEntry` (units enter during a Movement Phase) (2026 `[CL P2]`) |
| SCN-002 | **Edge entry:** an entering unit is treated as standing in a virtual off-board hex adjacent to the chosen edge hex of its home edge, facing straight onto the board. Its first move enters that edge hex at normal cost. It may Walk or Run (not Jump) on its entry turn. Hexes entered on the board count for TMM. It may not stop off board |
| SCN-003 | Units enter with systems in a chosen state (e.g. switchable equipment on or off) instead of waiting for the first End Phase (2026 `[CL P2]`) |
| SCN-004 | **Half loads:** at force setup, any ammo bin may start with half its shots, rounded down (2026 `[CL P3]`; rounding 2026?) |

## 4. Line of sight

| ID | Rule |
|---|---|
| LOS-001 | LOS runs centre to centre. A hex is on the line if the line passes through it or touches its corner. The attacker's and target's hexes are never intervening |
| LOS-002 | Implementation: build the hex sequence twice, nudging the endpoints by +ε and −ε (ε = 1e-6 along the perpendicular). If both sequences match, LOS is single. If they differ, LOS is **divided**: the defender picks one whole sequence (LOS-005) |
| LOS-003 | LOS is mutual. Adjacent units always have LOS, unless LOS-040 forbids the attack |
| LOS-004 | Units never block LOS or affect attacks against others |
| LOS-005 | **Divided LOS choice:** the target's controller picks the +ε or −ε sequence. The AI (and the human, unless `setup.options.askDefender` is true; default false, RULING) picks: a blocked sequence over an open one; else the higher total to-hit modifier from §4/§7; else the +ε sequence. The choice is stored per (attacker, target) pair for the rest of the turn |
| LOS-010 | **Obstacle level** of an intervening hex: its ground level (hills; water hexes use their surface level), or ground + 2 if it has woods. Woods are the only feature with height on Core Box maps |
| LOS-011 | An intervening hex **intervenes** if its obstacle level is (a) ≥ both the attacker's and target's LOS levels; or (b) ≥ the attacker's LOS level and the hex is adjacent to the attacker; or (c) ≥ the target's LOS level and the hex is adjacent to the target |
| LOS-012 | An intervening hex whose **ground** level alone satisfies LOS-011 is a hill: LOS is **blocked** |
| LOS-013 | An intervening woods hex (woods top satisfies LOS-011, ground does not) adds woods points: light 1, heavy 2. **3 or more points block LOS.** Under 3, each point is +1 to hit (TOHIT-020) |
| LOS-014 | Woods in the target's hex add their to-hit modifier (TOHIT-020) but never count toward the block. Woods in the attacker's hex do nothing |
| LOS-015 | Water never blocks LOS (2026 `[CL C7]`); see LOS-040 |
| LOS-016 | A prone target adjacent along the LOS to a hex whose ground is ≥ its LOS level is blocked by LOS-011(c) (no special case needed) |
| LOS-020 | The engine returns a verdict object `LosVerdict { visible, attackAllowed, divided, chosen ('+' | '-' | null), hexes, alt, blockers[], woodsPoints, partialCover, reasons[] }` (00 §12) used by the UI overlay and AI |

### 4.1 Partial cover

| ID | Rule |
|---|---|
| LOS-030 | A **standing** target has partial cover if a hex adjacent to it on the LOS has ground level exactly target floor + 1 (hill; not woods), the hex does not block LOS, and the attacker's LOS level ≤ the target's LOS level. Attacking downhill (attacker LOS level higher) removes hill cover |
| LOS-031 | Water: a standing target in depth 1 always has partial cover, from any attacker, including attackers at higher levels (2026 `[CL C13]` "exceptions removed"; 2026?). Exception: attacks that roll on the Punch table can't hit legs, so no cover applies |
| LOS-032 | Effect: +1 to hit (TOHIT-022). If the hit location is a leg, the hit strikes the cover and does no damage (no crit, no pilot hit); the engine emits `HitAbsorbedByCover` |
| LOS-033 | Prone targets never get partial cover. Charges ignore partial cover (2026 `[CL C14]`). Physical attacks between adjacent hexes otherwise never get hill cover (no hex lies between) |
| LOS-034 | An attacker's leg-mounted weapons can't fire through a hex that gives the attacker partial cover; an attacker standing in depth 1 can't fire leg-mounted weapons |

### 4.2 Water line

| ID | Rule |
|---|---|
| LOS-040 | No attack of any kind (ranged or physical) may be declared between a submerged unit and a non-submerged unit (2026 `[CL C7]`) |
| LOS-041 | Attacks where both units are submerged: physical attacks allowed at half damage (round down). Ranged attacks between two submerged units are legal with the standard to-hit and ranges, no extra modifier and no weapon restrictions (2026 `[CL B6]`; RULING: the exact 2026 rule is unknown, this is the simplest reading). **Hull breach (2026 `[CL D3]`, roll-low) is not modelled in release 1** (RULING: no source gives the 2026 numbers). To keep both out of play, `validate-data` rejects any release-1 map hex with water depth ≥ 2; depth 2+ stays fully specified for the movement and LOS rules (MOVE-028) and is testable on fixture maps. The only submerged units on release-1 maps are units prone in depth 1 water |

## 5. Arcs and attack direction

| ID | Rule |
|---|---|
| ARC-001 | Firing arcs from the attacker, using `rel = rel(attacker→target, arcFacing)` (HEX-007): **Forward** rel ≤ 60 or rel ≥ 300; **Right side** 60 < rel ≤ 120; **Rear** 120 < rel < 240; **Left side** 240 ≤ rel < 300. Arcs run to the board edge. Boundaries checked 2026-10-08 against MegaMek `ComputeArc.isInArc` (same inclusive/exclusive edges) |
| ARC-002 | Adjacent hexes: front, front-right, front-left are Forward; rear-right is Right side; rear is Rear; rear-left is Left side |
| ARC-003 | Weapon arcs: torso and head weapons fire Forward. Right-arm weapons fire Forward + Right side; left-arm weapons Forward + Left side. Rear-mounted weapons `(R)` fire Rear only. Leg weapons fire Forward (or Rear if rear-mounted) by the feet |
| ARC-004 | `arcFacing` = torso facing for head, torso and arm weapons (after twist); feet facing for leg weapons, kicks, pushes |
| ARC-010 | **Torso twist:** rotate the torso one hexside left or right. Feet facing is unchanged. Declared once per turn, in the unit's Ranged Attack declaration **or** its Physical Attack declaration (2026 `[CL C4]`); it lasts until the End Phase |
| ARC-011 | A twist declared in the Physical Attack Phase affects only physical attacks (ranged attacks are already resolved) |
| ARC-012 | **Arm flip:** only if neither arm has (or was built with) lower arm and hand actuators, and no weapon is split between an arm and torso. Both arms flip (one if the other is gone). Flipped arm weapons fire into the Rear arc instead. Declared in either attack phase (2026 `[CL C4]`). Can't combine with a twist in the same turn |
| ARC-013 | Prone units can't twist or flip; their arcs follow their facing |
| ARC-014 | Twisting or flipping never changes how the unit is hit (ARC-020 uses feet facing) |
| ARC-020 | **Attack direction** (picks the hit-location column): `rel = rel(target→attacker, targetFeetFacing)`. **Front** 330 < rel < 30; **Right** 30 < rel < 150; **Rear** 150 < rel < 210; **Left** 210 < rel < 330 |
| ARC-021 | rel exactly 30, 150, 210 or 330 (the line crosses a hex corner): the target's controller picks either neighbouring zone. AI/default rule: the zone whose column's roll-7 location has the most armor left (torso rear armor for Rear); ties Front > Left > Right > Rear. This default rule applies to both players unless `setup.options.askDefender` is true (default false, RULING: defender-favouring automatic choice keeps decisions few). Stored per (attacker, target) per turn |
| ARC-022 | For divided LOS, ARC-020 uses the straight centre line regardless of the LOS-005 choice |
| ARC-023 | A prone target uses the facing its head points to. Physical attacks set their own direction source (PHYS-044, PHYS-063) |

## 6. Ranged attacks: declaration rules

| ID | Rule |
|---|---|
| TOHIT-001 | TN = attacker's **Gunnery** + every modifier in §7. Roll 2d6 ≥ TN to hit. Each weapon rolls separately |
| TOHIT-002 | TN ≥ 13: the attack can't be declared (`legalActions` excludes it). TN ≤ 2: automatic hit (still roll for nothing) |
| TOHIT-003 | Each weapon fires once per turn at one target in its arc with LOS and range ≤ long range |
| TOHIT-004 | Never target a friendly unit. A unit may target an empty hex (expends ammo/heat; no effect) |
| TOHIT-005 | **Primary target:** the first declared target; if any declared target is in the Forward arc, the primary must be one of them (a declaration whose first shot is not in the Forward arc while a Forward-arc target is declared is rejected with `E_PRIMARY_TARGET`; the engine never reorders). Every other target is secondary (+1 each, TOHIT-024). Only one primary per turn, even with several arcs |
| TOHIT-006 | Units that are shut down or have an unconscious pilot make no ranged attacks (2026 `[CL C3]`). A unit that declared a charge or DFA makes no ranged attacks |
| TOHIT-007 | Two sensor crits: no ranged attacks (CRIT-052) |
| TOHIT-008 | **Firing while prone:** needs at least one intact arm (one-armed prone fire allowed, 2026 `[CL C15]`). The unit picks one intact arm to prop on each turn: that arm's weapons, and weapons split between it and its torso, can't fire. No leg-mounted weapons. All other weapons fire with the arcs they would have standing with the same facing. +2 (TOHIT-013). No twist or flip. A unit with a destroyed gyro, or both legs destroyed, fires this way |

## 7. To-hit modifier table (ranged attacks)

All cumulative unless noted.

| ID | Group | Condition | Mod |
|---|---|---|---|
| TOHIT-010 | Range | Short / Medium / Long | +0 / +2 / +4 |
| TOHIT-011 | Range | Range ≤ weapon minimum range | + (minimum − range + 1) (e.g. min 3: range 3 +1, 2 +2, 1 +3) |
| TOHIT-012 | Attacker move | Stood still / walked / ran / jumped | +0 / +1 / +2 / +3 (by mode, not distance) |
| TOHIT-013 | Attacker | Firing while prone | +2 (in addition to TOHIT-012) |
| TOHIT-014 | Target move (TMM) | Hexes moved (MOVE-013): 0–2 / 3–4 / 5–6 / 7–9 / 10–17 / 18–24 / 25+ | 0 / +1 / +2 / +3 / +4 / +5 / +6 |
| TOHIT-015 | Target move | Target jumped this turn | +1 more |
| TOHIT-016 | Target | Prone: attacker adjacent / not adjacent | −2 / +1 (cumulative with TMM) |
| TOHIT-017 | Target | Immobile (MOVE-008) | −4, and TMM and TOHIT-015 are not applied |
| TOHIT-018 | Target | A unit that becomes immobile during a phase keeps its TMM and gets no −4 for the rest of that phase (2026 `[CL C10]`). Immobility is snapshotted at phase start | — |
| TOHIT-019 | Target | TMM from the Movement Phase applies to every attack against the unit for the whole turn | — |
| TOHIT-020 | Terrain | Target in light / heavy woods | +1 / +2 |
| TOHIT-021 | Terrain | Each intervening light / heavy woods hex (LOS-013) | +1 / +2 |
| TOHIT-022 | Terrain | Target has partial cover (LOS-030/031) | +1 |
| TOHIT-023 | Heat | Attacker heat 0–7 / 8–12 / 13–16 / 17–23 / 24+ | 0 / +1 / +2 / +3 / +4 |
| TOHIT-024 | Targets | Each secondary target, any arc (2026 `[CL C12]`, flat; no +2 for side/rear) | +1 |
| TOHIT-025 | Damage | Sensors: 1 crit | +2 (2 crits: no ranged attacks) |
| TOHIT-026 | Damage | Shoulder crit, weapons in that arm | +4, and ignore other actuator mods in that arm |
| TOHIT-027 | Damage | Upper arm actuator crit, weapons in that arm | +1 |
| TOHIT-028 | Damage | Lower arm actuator crit or hand crit, weapons in that arm | 0 (2026 `[CL D12]` removed the lower-arm +1) |
| TOHIT-029 | Weapon | Intrinsic weapon modifier from data (`toHitMod`: pulse lasers −2, X-pulse −2, etc.) | data |
| TOHIT-031 | Equipment | Targeting computer, eligible weapon (EQUIP-001) | −1 |
| TOHIT-032 | Terrain | Water gives no terrain modifier (only partial cover) | 0 |
| TOHIT-033 | — | "Large Target" `[CL C11]`, indirect fire, spotting `[CL C9]`: not used in v1 (no superheavies; indirect fire deferred, TOHIT-040) | — |

### 7.1 Aimed shots (2026)

| ID | Rule |
|---|---|
| TOHIT-030 | An aimed shot names a location at declaration. Allowed only: (a) against an immobile target, or (b) with a targeting computer linked to the weapon, against a mobile 'Mech (EQUIP-002). Never with missiles, cluster attacks (LB-X cluster, MG arrays), indirect fire or physical attacks |
| TOHIT-034 | Modifiers: immobile target, non-head: −4 (the immobile mod); with TC also −1 (total −5). Immobile target, head: no −4, +3 instead; no TC −1. TC vs mobile target: +3 instead of the TC −1; head not allowed. Pulse weapons: no aimed shot vs mobile targets, and never the TC −1 on aimed shots |
| TOHIT-035 | On a hit roll 1d6: **4–6** the named location is hit; **1–3** roll normally on the hit table (2026 `[CL C16]`) |
| TOHIT-036 | Partial cover: only non-leg locations may be named; the partial-cover +1 is not applied; a normal roll that gives a leg is re-rolled until it isn't |

### 7.2 Indirect fire (deferred, IDs reserved)

| ID | Rule |
|---|---|
| TOHIT-040 | LRM-type weapons may fire indirectly at a target with no LOS, via a friendly spotter with LOS: +1, spotter movement mod, terrain from the spotter, +1 more if the spotter also attacked. 2026 rewrote spotter timing `[CL C9]`. Not in v1 |

## 8. Hit location

| ID | Rule |
|---|---|
| HITLOC-001 | Roll 2d6 on the column chosen by ARC-020. Rear attacks use the Front/Rear column and hit the **rear** armor of LT/CT/RT |
| HITLOC-002 | Each hit (each cluster group, each damage group) rolls its own location and is fully resolved before the next |
| HITLOC-003 | **Hit Location Table (2d6)** |

| 2d6 | Left side | Front / Rear | Right side |
|---|---|---|---|
| 2 | LT (TAC) | CT (TAC) | RT (TAC) |
| 3 | LL | RA | RL |
| 4 | LA | RA | RA |
| 5 | LA | RL | RA |
| 6 | LL | RT | RL |
| 7 | LT | CT | RT |
| 8 | CT | LT | CT |
| 9 | RT | LL | LT |
| 10 | RA | LA | LA |
| 11 | RL | LA | LL |
| 12 | HD | HD | HD |

| ID | Rule |
|---|---|
| HITLOC-004 | **TAC** (through-armor critical): on a natural 2, apply the hit's damage normally (it must deal ≥ 1 damage), then make a crit check (CRIT-001) on that torso even if armor remains. This is in addition to any crit check from structure damage. If the torso is already destroyed, the TAC transfers with the damage to CT |
| HITLOC-005 | **Floating crits** (optional, default off; 2026 `[CL D7]`): on a natural 2, the TAC check is made against a location found by re-rolling 2d6 on the same column (repeat while 2) (2026?) |
| HITLOC-006 | **Punch Location Table (1d6), 2026 reversed** `[CL C18]`: |

| 1d6 | Left side | Front / Rear | Right side |
|---|---|---|---|
| 1 | LA | RA | RA |
| 2 | LA | RT | RA |
| 3 | CT | CT | CT |
| 4 | LT | LT | RT |
| 5 | LT | LA | RT |
| 6 | HD | HD | HD |

(2026?: the changelog says only "reversed to match the standard table"; we reversed rows 1–5 in every column and kept
the head on 6, which puts low rolls on the right side for front attacks and on near limbs for side attacks, as in
HITLOC-003.)

| ID | Rule |
|---|---|
| HITLOC-007 | **Kick Location Table (1d6):** Left side: 1–6 LL. Front/Rear: 1–3 RL, 4–6 LL. Right side: 1–6 RL |
| HITLOC-008 | Attacks on a prone 'Mech always use HITLOC-003 (any table the attack would normally use is replaced), except DFA (PHYS-064) |
| HITLOC-009 | Partial cover leg hits: LOS-032 |
| HITLOC-010 | **Damage groups:** where a rule says "groups of 5", split total damage into as many 5-point groups as possible plus one leftover group; the leftover group is always resolved **last** (2026 `[CL D2]`) |

## 9. Cluster hits

| ID | Rule |
|---|---|
| CLUS-001 | A hitting cluster weapon rolls 2d6 (+ modifiers, result clamped to 2–12) on the column for its size; the result is the number of missiles/projectiles that hit |
| CLUS-002 | **Cluster Hits Table** (rows: weapon size; columns: modified 2d6) |

| Size | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 2 | 1 | 1 | 1 | 1 | 1 | 1 | 2 | 2 | 2 | 2 | 2 |
| 3 | 1 | 1 | 1 | 2 | 2 | 2 | 2 | 2 | 3 | 3 | 3 |
| 4 | 1 | 2 | 2 | 2 | 2 | 3 | 3 | 3 | 3 | 4 | 4 |
| 5 | 1 | 2 | 2 | 3 | 3 | 3 | 3 | 4 | 4 | 5 | 5 |
| 6 | 2 | 2 | 3 | 3 | 4 | 4 | 4 | 5 | 5 | 6 | 6 |
| 7 | 2 | 2 | 3 | 4 | 4 | 4 | 4 | 6 | 6 | 7 | 7 |
| 8 | 2 | 3 | 3 | 4 | 4 | 5 | 5 | 6 | 7 | 8 | 8 |
| 9 | 3 | 3 | 4 | 5 | 5 | 5 | 5 | 7 | 7 | 9 | 9 |
| 10 | 3 | 3 | 4 | 6 | 6 | 6 | 6 | 8 | 8 | 10 | 10 |
| 11 | 4 | 4 | 5 | 7 | 7 | 7 | 7 | 9 | 9 | 11 | 11 |
| 12 | 4 | 4 | 5 | 8 | 8 | 8 | 8 | 10 | 10 | 12 | 12 |
| 13 | 4 | 4 | 5 | 8 | 8 | 8 | 8 | 11 | 11 | 13 | 13 |
| 14 | 5 | 5 | 6 | 9 | 9 | 9 | 9 | 11 | 11 | 14 | 14 |
| 15 | 5 | 5 | 6 | 9 | 9 | 9 | 9 | 12 | 12 | 15 | 15 |
| 16 | 5 | 5 | 7 | 10 | 10 | 10 | 10 | 13 | 13 | 16 | 16 |
| 17 | 5 | 5 | 7 | 10 | 10 | 10 | 10 | 14 | 14 | 17 | 17 |
| 18 | 6 | 6 | 8 | 11 | 11 | 11 | 11 | 14 | 14 | 18 | 18 |
| 19 | 6 | 6 | 8 | 11 | 11 | 11 | 11 | 15 | 15 | 19 | 19 |
| 20 | 6 | 6 | 9 | 12 | 12 | 12 | 12 | 16 | 16 | 20 | 20 |

Sizes 2, 4, 5, 6, 10, 15, 20 match the AGoAC card. Every row 2–20 was checked on 2026-10-08 against MegaMek
`Compute.clusterHitsTable`: row 3 (roll 4 → 1) and row 8 (rolls 2, 4, 8, 10 → 2, 3, 5, 7) were corrected to match it;
the other rows already matched.

| ID | Rule |
|---|---|
| CLUS-003 | **Grouping:** LRM (and MML firing LRM ammo): 1 damage per missile, groups of 5 (HITLOC-010). SRM (and MML SRM ammo, Streak SRM): 2 damage per missile, each missile its own location. LB-X with cluster ammo: column = the AC's size, 1 damage per pellet, each its own location. MG array: column = number of linked MGs, each hit = one MG's damage, own location. Other cluster weapons follow their data `cluster.groupSize` |
| CLUS-004 | **Roll modifiers:** MG array +2 (2026 `[CL W15]`); Artemis IV with Artemis ammo +2; MRM −1 (2026 `[CL W18]`); others from data `clusterMod`. Clamp to 2–12 after modifiers |
| CLUS-005 | **Streak:** no cluster roll; if the attack hits, every missile hits. If it misses, no ammo is spent and no heat is generated (AMMO-002, HEAT-002) |
| CLUS-006 | LB-X firing slug ammo is a normal single-hit weapon |

## 10. Damage application

| ID | Rule |
|---|---|
| DMG-001 | Locations: HD, CT, LT, RT, LA, RA, LL, RL. Torsos have front and rear armor and one structure track |
| DMG-002 | **Procedure per hit** (location L, damage D, side front/rear): (1) armor of L (rear armor if rear attack and L is a torso) absorbs up to its remaining value; (2) the rest strikes L's internal structure; (3) if L's structure > 0 and it took ≥1 structure damage: crit check on L (CRIT-001); (4) if L's structure reaches 0: L is destroyed (DMG-010); crit check only if L holds an explosive item (CRIT-005); (5) leftover damage transfers inward (DMG-005) and restarts at step 1 on the new location (front armor unless the attack came from the rear) |
| DMG-003 | Transfer of excess from structure that just hit 0 continues in the same hit; later hits that roll a destroyed location transfer in full |
| DMG-004 | Crit-check special case: if L had no crit-able slot at the start of this phase, the crit check rolled for L applies to the next location inward instead (CRIT-010) |
| DMG-005 | **Transfer map:** LA → LT, LL → LT, RA → RT, RL → RT, LT → CT, RT → CT. HD and CT never transfer: excess is lost and the 'Mech is destroyed |
| DMG-006 | Transferred damage from a rear attack hits the rear armor of the torso it enters |
| DMG-007 | Internal explosions (ammo, components) apply to structure only and transfer structure to structure, skipping armor (AMMO-010) |
| DMG-010 | **Destroyed location:** all its items are destroyed. Its remaining armor (e.g. a torso's rear armor) is lost and counts toward the 20-damage PSR tally (PSR-001) |
| DMG-011 | Destroyed side torso: the arm on that side is destroyed at once (its armor and structure do **not** count toward the tally). Damage that later rolls that arm or torso transfers to CT. Engine slots in the torso are destroyed: each counts as an engine crit (IS XL: 3 → 'Mech destroyed; Clan XL / light: 2 → +10 heat; standard engine: none) |
| DMG-012 | Destroyed leg: CRIT-100/101; destroyed head: pilot killed, 'Mech destroyed; destroyed CT: 'Mech destroyed (pilot also killed if the CT was destroyed by an internal explosion) |
| DMG-013 | Limbs blown off by a crit (CRIT-004) don't add their armor or structure to the tally, and their ammo does not explode |
| DMG-020 | **'Mech destroyed** when any of: head destroyed; CT destroyed; cockpit crit; pilot dead (6 hits); 3 engine crits; displaced off board or into a partial hex (cause `displacedOff`, HEX-010), or left with no legal hex (cause `noLegalHex`, PHYS-067/094). Destroyed units are removed at the end of the phase (INIT-013), after making their declared attacks |
| DMG-021 | Not destroyed by these alone: gyro destroyed (even with forced withdrawal), both legs destroyed, all weapons lost. Victory treats them per SCN-020 |
| DMG-022 | Every damage event emits `{source, location, side, armorBefore, armorAfter, structureBefore, structureAfter, transferredTo, critChecks[]}` |

## 11. Critical hits

### 11.1 Determining and placing crits

| ID | Rule |
|---|---|
| CRIT-001 | **Crit check** (2d6): 2–7 none; 8–9 one crit; 10–11 two crits; 12 three crits on a torso, or the limb/head **blown off** on an arm, leg or head (CRIT-004). CASE II location: −1 to the roll (2026 `[CL W51]`) |
| CRIT-002 | 12-slot locations (torsos, arms): roll 1d6 for the block (1–3 upper six, 4–6 lower six), then 1d6 for the slot. 6-slot locations (head, legs): 1d6 for the slot. If one block is entirely inapplicable, roll only 1d6 in the other |
| CRIT-003 | **Inapplicable slot** (re-roll both dice in 12-slot locations): a slot holding the `empty`, `structure` or `armor` token (20 §6.4), or a slot already hit. Each re-roll is a new `critSlot` roll. Each crit is fully resolved before the next |
| CRIT-004 | Blown off (12 on arm/leg/head): the location is destroyed; nothing transfers; ammo inside does not explode; head blown off destroys the 'Mech and kills the pilot |
| CRIT-005 | Location destroyed this hit: crit check only if it holds an explosive item with something to explode (ammo bin with shots, or an explosive component); only crits landing on explosive slots resolve, others are discarded; none transfer. The discarded crits emit one `CritLost {count, why: 'notExplosive'}` for that check |
| CRIT-010 | **Transferring crits:** if every slot of the location was inapplicable before this phase, the crits move to the next location inward (DMG-005). If some slots were hit earlier this phase, excess crits are lost: one `CritLost {count, why: 'noSlotThisPhase'}` per crit check, `count` = crits lost. HD and CT crits that find no slot are lost the same way; they never transfer |
| CRIT-011 | A multi-slot item is knocked out by its first crit; further crits on its other slots soak with no extra effect. Exceptions that count per slot: engine, gyro, sensors; autocannons (EQUIP-010) |
| CRIT-012 | Crit effects are permanent and cumulative unless stated |

### 11.2 Crit effects (2026 values)

| ID | Item | Effect |
|---|---|---|
| CRIT-020 | Ammo bin | Explodes if it has shots (AMMO-010); 1 pilot hit (2026 `[CL D8]`). Empty bin: slot marked, nothing else |
| CRIT-030 | Cockpit | Pilot killed, 'Mech destroyed |
| CRIT-031 | Engine | 1 crit: +5 heat per turn; 2: +10 total; 3: 'Mech destroyed. No engine heat while shut down |
| CRIT-040 | Gyro (standard) | Each crit +2 to all PSRs (2026 `[CL D13]`). 1st crit: PSR at end of phase. 2nd crit: gyro destroyed, automatic fall (no PSR), can't stand; fires per TOHIT-008 and may turn 1 hexside per turn if it has ≥1 MP. Running (≥1 hex moved, 2026 `[CL D6]`) or jumping with a damaged gyro: PSR. Heavy-duty gyro: 4 crits, no PSRs (2026 `[CL W47]`; data only) |
| CRIT-050 | Sensors, 1st crit | +2 to ranged attacks. Never affects physical attacks |
| CRIT-052 | Sensors, 2nd crit | No ranged attacks for the rest of the game. Physical attacks unaffected |
| CRIT-060 | Life support | Pilot hits at the end of each Heat Phase: heat 10–19 → 1 hit, heat 20+ → 2 hits (2026 `[CL D16]`). Further life-support crits do nothing more |
| CRIT-061 | Life support | Also: 1 pilot hit in each End Phase while the 'Mech is submerged |
| CRIT-070 | Heat sink | Destroyed: dissipation −1 (single) or −2 (double) |
| CRIT-071 | Jump jet | −1 Jump MP |
| CRIT-072 | Weapon / equipment | Destroyed (autocannons: EQUIP-010; explosive items: AMMO-020) |
| CRIT-073 | Endo-steel, ferro-fibrous and other structure/armor slots | Inapplicable (tokens `structure`, `armor`): the crit re-rolls per CRIT-003, exactly like an `empty` slot. Nothing is absorbed |
| CRIT-080 | Shoulder | Ranged: +4 for that arm's weapons (overrides other actuator mods in the arm). No punch or physical-weapon or club with that arm; +2 to pushes per damaged shoulder |
| CRIT-081 | Upper arm actuator | Ranged +1 for that arm; punch +2 and punch damage halved |
| CRIT-082 | Lower arm actuator | No ranged modifier (2026 `[CL D12]`); punch +2 and punch damage halved; no club |
| CRIT-083 | Hand actuator | Punch +1; no club or physical weapon with that arm |
| CRIT-090 | Hip | −1 Walk MP (2026, no halving `[CL D15]`); +1 to all PSRs; PSR at end of phase; MOVE-017 level limit; no kicks; PSR when running ≥1 hex or jumping. Hip crutching rules deleted: all leg crit modifiers stack |
| CRIT-091 | Upper leg actuator | −1 Walk MP; +1 to all PSRs; PSR at end of phase; PSR when jumping; kicks +2 TN and half damage (with that leg) |
| CRIT-092 | Lower leg actuator | −1 Walk MP; +1 to all PSRs; PSR at end of phase; PSR when jumping; kicks +2 TN and half damage (with that leg) |
| CRIT-093 | Foot actuator | −1 Walk MP; **no PSR and no PSR modifier** (2026 `[CL D14]`); kicks +1 TN. No jump PSR for foot damage alone (2026?) |
| CRIT-094 | Leg MP floor | Leg crits never reduce Walk below 1 or Run below 2 (2026 `[CL D5]`) |
| CRIT-095 | Leg PSR cap | One damage instance (one hit with its crits) causes at most one PSR per leg, whatever the number of leg crits; both legs destroyed is still its own automatic fall (2026 `[CL D4] [CL O4]`) |

### 11.3 Leg loss

| ID | Rule |
|---|---|
| CRIT-100 | One leg destroyed: a standing 'Mech falls automatically (end of phase; during movement, at once, and its move ends). Walk 1 / Run 2 (2026 `[CL M9]`); heat can lower this. +5 to all PSRs, replacing every other PSR modifier from that leg. Running ≥1 hex or jumping: PSR. Prone: one hexside turn per turn counts as Walk; stand per MOVE-044 |
| CRIT-101 | Both legs destroyed: automatic fall; 0 MP; can't stand or turn; fires per TOHIT-008 |

## 12. Ammunition and explosions

| ID | Rule |
|---|---|
| AMMO-001 | Each shot is drawn from one bin holding the exact ammo type, in any location, chosen per shot; spent at declaration. Bins track shots separately |
| AMMO-002 | Streak launchers spend ammo only on a hit (CLUS-005) |
| AMMO-003 | Ammo dumping does not exist (2026 `[CL O15]`) |
| AMMO-010 | **Ammo explosion:** damage = shots left × damage per shot (missile bins: missiles per shot × damage per missile). **Capped at 20** (2026 `[CL D11]`). Applied to the bin's location structure, skipping armor; transfers structure to structure; crit checks apply (DMG-002). 1 pilot hit |
| AMMO-011 | **CASE** in the location: the explosion is capped at **10** and confined: excess beyond the location's structure is lost (no transfer); the location's rear armor (torsos) is lost (2026?) |
| AMMO-012 | **CASE II** in the location: 1 point to structure, the rest (up to the 20 cap) to that location's armor (rear for torsos); excess lost; crit checks in the location −1 (2026 `[CL W51]`; the explosion result is 2026?) |
| AMMO-013 | Clan 'Mechs: CASE presence comes from the unit data, never assumed |
| AMMO-020 | **Component explosion** (2026 `[CL D9] [CL D10]`): an item flagged `explodes` (e.g. Gauss rifles) that takes a crit explodes for **2 × its slot count**, under AMMO-010 (20 cap, CASE rules, 1 pilot hit). No ammo is needed. Gauss ammo itself never explodes (data) |
| AMMO-030 | **Heat explosion** (HEAT-034): the exploding bin is chosen by the AGoAC rule: the non-empty bin with the highest damage **per shot** (the damage one firing does: MG 2, SRM 6 12, LRM 15 15); then, between bins of equal per-shot value, the most shots remaining; then the controller chooses (AI: random). Changelog `[CL H2]` only says the criteria were "simplified" and gives no new text. RULING: AGoAC order used until the 2026 text is in hand |

## 13. Heat

### 13.1 Ledger

| ID | Rule |
|---|---|
| HEAT-001 | Heat generated per turn = movement heat (MOVE-002..005; stand attempts 0, 2026 `[CL H1]`) + every weapon fired (data heat) + engine crits (CRIT-031) + later environment |
| HEAT-002 | A weapon generates heat when it fires, hit or miss (Streak miss: 0) |
| HEAT-010 | Dissipation = operable heat sinks: single 1 each, double 2 each, including engine-integral sinks |
| HEAT-011 | Destroyed sinks (CRIT-070) and sinks in destroyed locations don't dissipate |
| HEAT-012 | Water: each submerged heat sink dissipates +1 more, max +6 per turn. Standing in depth 1: leg sinks submerged. Submerged 'Mech: all sinks, engine sinks included |
| HEAT-013 | New heat = max(0, old + generated − dissipated). Heat above 30 is kept (overflow) and must be dissipated later; effects use min(heat, 30) except where noted |

### 13.2 Heat scale

| ID | Heat ≥ | Effect |
|---|---|---|
| HEAT-020 | 5 / 10 / 15 / 20 / 25 | Walk MP −1 / −2 / −3 / −4 / −5 (not cumulative; replace each other). Run recomputed (MOVE-006). Jump MP unaffected |
| HEAT-021 | 8 / 13 / 17 / 24 | Ranged to-hit +1 / +2 / +3 / +4 (TOHIT-023). Never on physical attacks |
| HEAT-022 | 14 / 18 / 22 / 26 | Shutdown unless avoided on 2d6 ≥ 4 / 6 / 8 / 10 |
| HEAT-023 | 30 | Automatic shutdown (no avoid roll) |
| HEAT-024 | 19 / 23 / 28 | Ammo explosion unless avoided on 2d6 ≥ 4 / 6 / 8 |
| HEAT-025 | 10–19 / 20+ | Pilot hits 1 / 2 if life support is critted (CRIT-060) |

Effects last while heat stays at that level and end as soon as heat drops below it.

### 13.3 Heat Phase order

| ID | Rule |
|---|---|
| HEAT-030 | Per unit, in initiative order (loser first): (1) apply HEAT-013; (2) restart attempt if shut down (HEAT-040); (3) else shutdown check (HEAT-031); (4) ammo explosion check (HEAT-034); (5) life support pilot hits (CRIT-060); then INIT-013 for all units |
| HEAT-031 | Shutdown check: if heat ≥ 14 and not shut down, roll 2d6 once against the **highest** avoid number reached; below it → shut down. Heat ≥ 30 → shut down, no roll. An unconscious pilot can't avoid: heat ≥ 14 → shut down |
| HEAT-032 | Shut down: immobile (−4 to be hit, aimed shots allowed); no movement, ranged or physical selections; no engine-crit heat; heat sinks keep working. **No PSR** for shutting down (2026 `[CL H3]`). PSRs it must make while standing fail automatically (PSR-005) |
| HEAT-034 | Ammo check: if heat ≥ 19 and any bin has shots, roll 2d6 once against the highest avoid number reached; below it → one bin explodes (AMMO-030). Checked even while shut down |
| HEAT-040 | Restart: a unit shut down by heat stays down at least one full turn; from the next Heat Phase on, after heat is applied: heat < 14 → restarts automatically (even with an unconscious pilot); heat 14–29 → restart on 2d6 ≥ the highest avoid number for current heat; heat ≥ 30 → no restart. A restarted unit acts normally from the next turn |
| HEAT-041 | Voluntary shutdown in any End Phase; restart in a later End Phase, passing any heat avoid roll first |

## 14. Piloting skill rolls

### 14.1 Making PSRs

| ID | Rule |
|---|---|
| PSR-001 | TN = Piloting + persistent damage modifiers (PSR-010..014) + event modifiers (PSR-015..029). **Queued PSRs** (the end-of-phase batch of the Ranged, Physical and Heat Phases, PSR-020): each roll adds the event modifiers of **every** trigger the unit has had so far this phase, 20-damage trigger included (AGoAC: all modifiers from damage inflicted that phase). **Movement-phase PSRs** (`when` = `now` or `endOfMove`: stand attempts, water hexes, rubble, backward level change, landing, displacement and domino, end-of-move damaged-gear checks): Piloting + persistent mods + **that PSR's own event modifier only**; earlier Movement-phase triggers never carry over. So three depth 1 water hexes run through = three separate PSRs, each at TN Piloting − 1 (not −1, −2, −3), and every stand attempt is Piloting − 1 (stand only). Roll 2d6 ≥ TN. A player can't fail on purpose |
| PSR-002 | Several PSRs for one unit at once: roll one at a time with the same TN; the first failure makes the unit fall and the rest are discarded |
| PSR-003 | TN > 12: automatic failure (no roll) |
| PSR-004 | A prone unit ignores every PSR except stand attempts and the seatbelt check. Automatic falls (leg destroyed, both legs destroyed, gyro destroyed) do not apply to a unit that is already prone either: no second fall, no fall damage, no seatbelt check |
| PSR-005 | A standing unit that is immobile (shut down) or has an unconscious pilot fails every PSR automatically |
| PSR-006 | "Physical attack rolls" use Piloting but are not PSRs: PSR modifiers never apply to them and vice versa (2026 `[CL C20]`) |

### 14.2 Modifiers

| ID | Source | Modifier |
|---|---|---|
| PSR-010 | Persistent: per gyro crit | +2 (2026 `[CL D13]`) |
| PSR-011 | Persistent: per hip crit | +1 (2026 `[CL D15]`) |
| PSR-012 | Persistent: per upper/lower leg actuator crit | +1 |
| PSR-013 | Persistent: per foot crit | 0 (2026 `[CL D14]`) |
| PSR-014 | Persistent: leg destroyed | +5, replacing all other modifiers from that leg |
| PSR-015 | Event: took 20+ damage this phase (one PSR per phase, however much more) | +1 |
| PSR-016 | Event: crit to gyro, hip, upper or lower leg actuator (the crit's persistent mod already counts) | 0 |
| PSR-017 | Event: kicked / pushed | 0 / 0 |
| PSR-018 | Event: hit by a charge or DFA | +2 |
| PSR-019 | Event: stand attempt | −1 (2026 `[CL O2]`), the same for every attempt: a second or third attempt in one phase is still −1, never −2 or −3 |
| PSR-023 | Event: missed a kick | 0 |
| PSR-024 | Event: made a successful charge | +2 |
| PSR-025 | Event: made a successful DFA | +2 (2026 `[CL O3]`, was +4) |
| PSR-026 | Event: ran into water depth 1 / 2 / 3+ | −1 / 0 / +1 |
| PSR-027 | Event: entered rubble; backward level change (MOVE-016); landed in water (MOVE-053); domino target (PHYS-094) | 0 |
| PSR-028 | Event: ran ≥1 hex or jumped with damaged gyro/hip/leg actuators or a destroyed leg | 0 (persistent mods apply) |
| PSR-029 | Event: target of an accidental fall from above (PHYS-097) | +2 |
| PSR-033 | Shutdown | none (2026 `[CL H3]`; the old +3 is gone) |

### 14.3 Triggers and timing

| ID | Rule |
|---|---|
| PSR-020 | **Queue:** PSRs triggered in the Ranged, Physical or Heat Phase join that unit's queue and are rolled at the end of the phase (INIT-013), after the phase's damage effects are applied. Automatic falls in the queue resolve first. Units resolve in initiative order (loser first) |
| PSR-021 | Damage triggers: 20+ damage in a phase (all sources, armor and structure); gyro crit (first only; second is an automatic fall); hip, upper leg, lower leg crit (one per leg per damage instance, CRIT-095); leg destroyed → automatic fall; both legs → automatic fall. A unit that is prone when the queue resolves discards all of these, automatic falls included (PSR-004) |
| PSR-022 | Physical triggers: kicked (hit); pushed (hit); charged or DFA'd (hit) — target; missed kick, successful charge, successful DFA — attacker. A failed DFA is an automatic fall for the attacker |
| PSR-030 | Movement triggers resolve **immediately** after the action: stand attempt; running into water (on entering each such hex); entering rubble (each hex); backward level change; landing in water. A failed hex-entry PSR makes the unit fall in the hex it entered (its MP for that hex is spent) |
| PSR-031 | End-of-movement triggers (rolled when the unit's move ends, 2026 `[CL D6]` needs ≥1 hex moved for running): ran ≥1 hex with a damaged gyro, a hip crit or a destroyed leg; jumped with a damaged gyro, a hip, upper or lower leg actuator crit, or a destroyed leg. One roll per trigger type |
| PSR-032 | Displacement PSRs (PHYS-090..097) roll at once during the Displacement Step |
| PSR-040 | **Sensor check** (2026 `[CL O1]`): a PSR subtype that never causes a fall; TN = Piloting + persistent modifiers + 1 per sensor crit (2026?). No core rule calls it in v1; the hook exists for visibility and hidden-unit rules (M8) |

### 14.4 Falls

| ID | Rule |
|---|---|
| PSR-050 | A fall leaves the 'Mech **prone in the same facing** (2026 `[CL O7]`; no facing roll). Falling while moving between hexes: in the hex being entered. Otherwise in its current hex |
| PSR-051 | Levels fallen: 0 for an ordinary fall (including jump-landing falls); for displacement 2+ levels down, the drop between the old and new hex floors |
| PSR-052 | Damage = ceil(tonnage / 10) × (levels fallen + 1), in groups of 5 (HITLOC-010) |
| PSR-053 | Side hit: roll 1d6 once per fall: **1 → Rear column** (rear armor), **2–6 → Front column** (2026 `[CL O8]`) |
| PSR-054 | Fall in water (ending in depth ≥1): damage halved, round down, one calculation (2026 `[CL O6]`) |
| PSR-055 | Fall damage applies immediately (any phase) and counts toward the 20-damage tally |
| PSR-056 | **Seatbelt check** after every fall, before the fall damage is applied: a PSR with TN = Piloting + persistent modifiers (PSR-010..014) + levels fallen (+1 per level, 0 for a 0-level fall) (2026 `[CL O12] [CL O13]`). Event modifiers, terrain and this phase's 20-damage modifier are not added (2026? reading of "straight PSR"). Fail → 1 pilot hit |
| PSR-057 | Automatic 1 pilot hit, no roll: the unit was immobile when it fell, or the seatbelt TN > 12 |
| PSR-058 | A unit that falls during its Movement Phase keeps its remaining MP and may try to stand (MOVE-042), except after losing a leg (move ends) or jumping |

## 15. Pilot damage and consciousness

| ID | Rule |
|---|---|
| PILOT-001 | Pilot hits from: any hit on the head location (1, even if armor absorbs it all; partial-cover-absorbed hits don't count); failed seatbelt (1); ammo or component explosion (1, 2026 `[CL D8]`); life support heat (1 or 2); life support submerged (1) |
| PILOT-002 | 6 hits: pilot dead, 'Mech destroyed (removed at end of phase) |
| PILOT-010 | **Consciousness check, once per phase** (2026 `[CL O14]`): at the end of any phase in which a conscious pilot took ≥1 new hit (INIT-013 step b; Movement Phase: at the end of the phase), roll 2d6 once against the consciousness number for the pilot's **current total** hits: 1 → 3, 2 → 5, 3 → 7, 4 → 10, 5 → 11. Below it → unconscious. The check comes **before** the phase's PSR queue (AGoAC order). A pilot hit taken by a fall inside the queue gets one further check after the queue (INIT-013 step d), at the total then reached |
| PILOT-011 | Unconscious: the unit is immobile (−4 to be hit, aimed shots allowed), gets no movement, ranged or physical selections, can't avoid heat shutdown, fails PSRs while standing |
| PILOT-020 | Recovery: in each End Phase from the turn after the pilot was knocked out, roll 2d6 ≥ the consciousness number for current hits to wake. No further checks until a new hit |

## 16. Physical attacks

### 16.1 General

| ID | Rule |
|---|---|
| PHYS-001 | Physical attack roll TN = attacker's **Piloting** + attack-type modifier + standard modifiers: attacker movement (TOHIT-012), TMM and target jumped, prone target −2 (always treated as adjacent), immobile −4, terrain in the target hex (woods), actuator modifiers. Never heat, sensors, secondary targets or attacker-prone (prone units can't attack) |
| PHYS-002 | TN ≤ 2 auto-hit; TN ≥ 13 can't be declared |
| PHYS-003 | A unit makes one type of physical attack per turn (punch may use both arms). Prone, shut down and unconscious units make none |
| PHYS-004 | Target adjacent and in the arc the attack needs; hex floors within 1 level (PHYS-020) |
| PHYS-005 | Each unit may be the target of only one charge, DFA or push per turn. A unit making a charge or DFA can't be targeted by a charge, DFA or other physical attack |
| PHYS-006 | All physical attacks are simultaneous; displacement never cancels another physical attack (2026 `[CL C19]`) |
| PHYS-007 | Damage takes effect at the end of the phase (INIT-012); displacements happen in the Displacement Step (PHYS-090) |
| PHYS-008 | **Comparative modifier** (charge, DFA): + (attacker Piloting − target Piloting). Against an immobile target, use 4 as the target's Piloting (2026 `[CL C22]`) |

### 16.2 Attack type modifiers

| ID | Attack | Base mod |
|---|---|---|
| PHYS-010 | Punch | −1 (2026 `[CL C34]`) |
| PHYS-011 | Kick | −1 (2026 `[CL C32]`) |
| PHYS-012 | Push | −1 |
| PHYS-013 | Charge | 0 + comparative |
| PHYS-014 | DFA | 0 + comparative + the +3 jump attacker modifier; no terrain modifiers |
| PHYS-015 | Club, physical weapons | Reserved (later): club −1, hatchet −1, claw 0 `[CL W29]`, lance 0 `[CL W30]`. 2026 notes for later: clubs may hit prone 'Mechs `[CL C21]`, club hit forces a PSR `[CL C26]`, club on a standing 'Mech one level lower uses the Punch table `[CL C29]`, picking up a club costs the Ranged Attack Phase only `[CL C28]` |

### 16.3 Different levels

| ID | Target is | Allowed (table used) |
|---|---|---|
| PHYS-020 | Standing, same level | All (normal tables) |
| PHYS-021 | Standing, 1 level higher | Charge; DFA (own table, PHYS-064); punch (Kick table); club/physical weapon (Kick table) |
| PHYS-022 | Standing, 1 level lower | Charge; DFA (own table, PHYS-064); kick (Punch table); club/physical weapon (Punch table) |
| PHYS-023 | Prone, same level | Kick, DFA, club, physical weapon (Hit Location Table) |
| PHYS-024 | Prone, 1 level higher | DFA (own table, PHYS-064); punch, club, physical weapon (Hit Location Table) |
| PHYS-025 | Prone, 1 level lower | DFA only |
| PHYS-026 | Floors 2+ levels apart | DFA only |

### 16.4 Punch

| ID | Rule |
|---|---|
| PHYS-030 | Each arm punches separately (own roll, may pick different targets; no secondary-target modifier). Target in the Forward arc (either arm) or the arm's side arc (that arm only), using torso facing |
| PHYS-031 | Not with an arm that fired a weapon this turn, an arm with a shoulder crit, or an arm holding an intact physical weapon |
| PHYS-032 | Damage = ceil(tonnage / 10), halved (round down, min 1) for each upper or lower arm actuator that is critted or absent; Punch table (HITLOC-006), one group |
| PHYS-033 | Modifiers: hand critted or absent +1; each upper/lower arm actuator critted or absent +2 |

### 16.5 Kick

| ID | Rule |
|---|---|
| PHYS-034 | Target in the Forward arc by **feet** facing. Requires both hips undamaged. Not with a leg that fired a leg-mounted weapon this turn (only that leg is barred, 2026 `[CL C33]`) |
| PHYS-035 | Damage = ceil(tonnage / 5), halved (round down, min 1) per upper/lower leg actuator crit on the kicking leg; Kick table (HITLOC-007), one group |
| PHYS-036 | Modifiers: per upper/lower leg actuator crit +2; foot crit +1 |
| PHYS-037 | Hit: target PSR (0). Miss: attacker PSR (0) |

### 16.6 Charge

| ID | Rule |
|---|---|
| PHYS-040 | Declared in the Movement Phase by a walking or running unit (not jumping) that ends adjacent to the target, facing it, with enough MP left to enter the target's hex legally. The target must have finished moving, or have begun the turn shut down or unconscious. Can't charge a prone unit |
| PHYS-041 | Until resolved the charger counts as in its adjacent hex with its movement so far. It makes no ranged attacks |
| PHYS-042 | If the charger falls in the Ranged Attack Phase, the charge fails (no roll). If the target falls, is destroyed or displaced before the Physical Attack Phase, the charger may declare a different legal physical attack instead (2026 `[CL C23]`) |
| PHYS-043 | Damage to target = ceil(tonnage / 10 × L). N = charger's MOVE-013 hex count + 1 for the target's hex. L = N when N ≤ 2; otherwise the **lowest hex count of the TOHIT-014 bracket containing N**: 3–4 → 3, 5–6 → 5, 7–9 → 7, 10–17 → 10, 18–24 → 18, 25+ → 25. (2026 `[CL C24]` says only: TMM-based, counts the target's hex, less damage above 10 hexes. RULING: this formula is our guess; it stays within one hex of the AGoAC tonnage ÷ 10 × hexes moved up to 9 hexes and is lower above 10, e.g. 65 t after 5 hexes: N 6, L 5 → 33 (AGoAC 33); 50 t after 2 hexes: N 3, L 3 → 15 (AGoAC 10); 50 t after 12 hexes: N 13, L 10 → 50 (AGoAC 60).) Damage to charger = ceil(target tonnage / 10). Both in groups of 5 |
| PHYS-044 | Target locations: Hit Location Table, direction from the charger's adjacent hex. Charger locations: Hit Location Table, Front column (2026?). Partial cover never applies (2026 `[CL C14]`) |
| PHYS-045 | Hit: charger moves into the target's hex; target displaced one hex directly away from the charger (PHYS-090); both PSR +2. Miss: no displacement; charger stays in its adjacent hex (2026 `[CL C25]`) |

### 16.7 Death from above (DFA)

| ID | Rule |
|---|---|
| PHYS-060 | Declared in the Movement Phase by a jumping unit: it must have Jump MP to reach the target's hex by MOVE-050 and clear the height of the target's hex floor + the target's height (2 standing, 1 prone) (2026 `[CL C31]`) |
| PHYS-061 | During the Ranged Attack Phase it counts as in the last hex of its jump path before the target, facing the target; if two path hexes tie, it chooses. Its LOS level = max(own hex floor + 2, target floor + target height + 1) (2026?). It makes no ranged attacks and can't be a physical attack target |
| PHYS-062 | If it fails a PSR in the Ranged Attack Phase, the DFA misses (PHYS-066) |
| PHYS-063 | Attack direction: from the hex it occupied at the end of the Movement Phase (PHYS-061 hex) (2026 `[CL C30]`) |
| PHYS-064 | Hit: target takes ceil(tonnage × 3 / 10) in groups of 5 on the Punch table (HITLOC-006); a prone target uses the Hit Location Table **Rear** column. Attacker takes ceil(tonnage / 5) in groups of 5 on the Kick table Front column. Attacker lands in the target's hex; target displaced one hex directly away from the attacker. Target PSR +2; attacker PSR +2 |
| PHYS-066 | Miss: the attacker lands in the target's hex and falls as a 2-level fall (PSR-052) with all groups on the Rear column; the target moves to a legal adjacent hex of its controller's choice (may be occupied: domino) even if prone or immobile |
| PHYS-067 | DFA displacement into a prohibited hex: try hexsides in order ±1, ±2, opposite from the intended one (target's controller picks between equals). None legal: hit → target destroyed; miss → attacker destroyed |

### 16.8 Push

| ID | Rule |
|---|---|
| PHYS-070 | Target standing, same floor level, in the hex directly ahead of the attacker's **feet**, and not making a charge or DFA. Attacker fired no arm-mounted weapon this turn. +2 per damaged shoulder |
| PHYS-071 | Hit: no damage; target displaced one hex directly away; attacker moves into the vacated hex (no MP); target PSR 0 |
| PHYS-072 | Two units pushing each other: both hit → neither moves, both PSR; one hits → normal |
| PHYS-073 | Prohibited destination (except off board, which is allowed and destroys the target, cause `displacedOff`): no one moves; the PSR still happens |

### 16.9 Displacement Step and dominoes

| ID | Rule |
|---|---|
| PHYS-090 | **Displacement Step** at the end of the Physical Attack Phase, after all physical attacks resolve and before the PSR queue (2026? `[CL C19]`): apply each successful displacement in initiative order (loser's attacks first; same side: controller's order). A unit destroyed by the attack is not displaced. Displacement PSRs and their falls resolve immediately |
| PHYS-091 | Into a hex at the same level or 1–2 levels higher: if occupied → domino (PHYS-094); else move |
| PHYS-092 | Into a hex 3+ levels higher: prohibited; neither unit moves; other effects stand |
| PHYS-093 | Into a hex 1 level lower: as PHYS-091. 2+ levels lower: automatic fall of that many levels in the new hex (no PSR); if occupied → accidental fall from above (PHYS-097). Off board or into a partial hex: destroyed (cause `displacedOff`) |
| PHYS-094 | **Domino:** the occupant makes a PSR (0). Fail: displaced one hex directly away from the intruder's entry hexside and falls there. Pass: it may **dodge** by moving one hex directly forward or backward into an empty legal hex if it is standing, mobile and did not jump this turn (2026 `[CL O5]` "simplified"; MP and side-hex requirements dropped, 2026?); if it can't or won't dodge, it is displaced but does not fall. Chains continue; the last unit with no legal hex is destroyed |
| PHYS-097 | **Accidental fall from above** (2+ levels onto a unit): roll 2d6 ≥ 7 + target TMM + target-hex terrain. Hit: target takes ceil(tonnage / 10) × max(1, levels fallen − target height) in groups of 5 (2026 `[CL O11]`) on the Punch table, or the Hit Location Table if the target is prone (2026 `[CL O9]`); half (round down) if the target is submerged; target is displaced to a random legal adjacent hex and makes a PSR +2. Faller takes normal fall damage on the Rear column. Miss: faller lands in an adjacent hex, empty hexes first (2026 `[CL O10]`), then random among equals; normal fall |

## 17. Victory and forced withdrawal

| ID | Rule |
|---|---|
| SCN-010 | A unit may leave the board only by its home edge, and only when the scenario or forced withdrawal allows; it is then `withdrawn` (not destroyed). An `exit` step on any other edge is rejected (`E_EXIT_EDGE`). Being displaced off the board is not an exit (HEX-010) |
| SCN-020 | Default victory (End Phase): a side wins when every enemy unit is destroyed, withdrawn, surrendered, or crippled where the scenario counts crippled. All last units destroyed in the same turn, or the last units on each side unable to move and unable to damage each other: draw. Scenario objectives (`11-missions.md`) override |
| SCN-021 | Crippled: the condition list is `11-missions.md` §2.2 (the unit's `crippled` flag); it counts for victory only where the mission asks (SCN-020). No list here |
| SCN-030 | **Forced withdrawal** (optional, default off; 2026 rewrite `[CL MS3]`, conditions 2026?): the trigger list is `11-missions.md` §3.2; a triggered unit gets status `withdrawing` for the rest of the game, moves per 11 §3.3 and leaves by SCN-010. It may still attack. No list here |
| SCN-031 | Forced surrender (End Phase): per `11-missions.md` §3.4, for `withdrawing` units only; status `surrendered`, counts as destroyed for victory. No list here |

## 18. Equipment rules that touch the core

Full item data is the equipment catalogue's job; these rules are engine code paths.

| ID | Rule |
|---|---|
| EQUIP-001 | Targeting computer: −1 to-hit for direct-fire energy, ballistic and pulse weapons (data weapon flag `directFire`, `20-data-schema.md`); never for missiles, cluster attacks (LB-X cluster ammo, MG arrays), flamers or machine guns. Destroyed TC: no bonus |
| EQUIP-002 | TC aimed shots: TOHIT-030/034 |
| EQUIP-010 | Autocannons (every AC type: standard, LB-X, Ultra, rotary, light, ProtoMech): the **first** crit on the weapon does not disable it; the second crit (on any of its slots) destroys it (2026 `[CL W9]`). No penalty while damaged (2026?) |
| EQUIP-011 | Ultra ACs never jam (2026 `[CL W11]`). Rotary AC jams per its data; unjamming happens in the Movement Phase and does not stop the unit acting (2026 `[CL W10]`) |
| EQUIP-012 | Heavy and improved heavy Gauss: no PSR for firing (2026 `[CL W13]`) |
| EQUIP-013 | PPC capacitor: a natural 2 on the attack no longer burns it out (2026 `[CL W23]`) |
| EQUIP-020 | **Escalating failure** (MASC, supercharger and similar; 2026 `[CL W4]`): each turn the item is used, roll 2d6 ≥ the avoid number; it starts at 3 and rises one step per consecutive turn of use along 3, 5, 7, 10, 11 (stays 11; never automatic failure); each turn unused lowers it one step (2026?). MASC failure: one crit check on a random leg (2026 `[CL W48]`). Supercharger failure: per its data (2026?) |
| EQUIP-030 | Removed items must not exist in data: flail, flechette and fragmentation ammo, full-head ejection, industrial weapons, mechanical jump boosters, UMUs `[CL W1]` |

## 19. Battle Value

| ID | Rule |
|---|---|
| BV-001 | Force building with BV and the skill multiplier table lives in `11-missions.md`; BV is part of the core game in 2026 `[CL MS1]`. No engine rule here |
