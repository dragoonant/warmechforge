# 20: Data schema

All game content is JSON under `src/data/`, validated by `tools/validate-data.ts` (ajv `dist/2020`, `allErrors: true`,
`strict: true`) against `docs/spec/schemas/*.schema.json`. `$id` = `https://warmechforge.dev/schemas/<name>.schema.json`;
cross-refs use `common.schema.json#/$defs/...` (register every schema with `ajv.addSchema` before compiling).

- **Every number lives in data**, never in engine code. Engine rules tables that are not per-item (to-hit, cluster, hit
  location, heat scale) belong to `10-rules-core` and are added to `core/tables.json` by that spec.
- **Every prose field is our own words** (`Text`, ≤600 chars). Names of 'Mechs, weapons, equipment and pilots are real.
- **The engine never imports data**: `src/data/index.ts` builds a `DataBundle` that `createGame(setup, seed, bundle)` receives.
- **Edition leak guard**: no Alpha Strike values (PV, size, 2/2/1 damage, inch ranges), no stability/evasion, no ghost heat,
  no skid or ammo-dump fields (validate-data rejects the keys in §11).

## 1. Files and ids

| Path | Schema | Content |
|---|---|---|
| `src/data/core/weapons.json` | `weapon[]` | every weapon on the 16 Core Box sheets (§12), plus test fixtures |
| `src/data/core/ammo.json` | `ammo[]` | one entry per ammo type (LB-X slug and cluster are two entries; MML LRM and SRM are two) |
| `src/data/core/equipment.json` | `equipment[]` | heat sinks, jump jets, CASE, TC, supercharger, capacitor ... |
| `src/data/core/tables.json` | `tables` | `internalStructure` (§6.3), `bvSkillMultiplier` (§7.3); rules tables added by 10-rules-core |
| `src/data/core/spas.json` | `spa[]` | the 8 Core Box SPAs (§7.2) |
| `src/data/mechs/<chassis>/<model>.json` | `mech` | one variant per file, e.g. `mechs/uziel/uzl-2s.json` |
| `src/data/pilots/pilots.json` | `pilot[]` | the 8 Core Box pilot cards |
| `src/data/maps/<id>.json` | `map` | hex terrain, e.g. `maps/scorched-oasis.json` |
| `src/data/forces/<id>.json` | `force` | fixed forces used by missions |
| `src/data/missions/<id>.json` | `mission` | intro, skirmish, 5 box missions (`11-missions.md`) |
| `src/data/raw.ts` | | static imports of every JSON file; a test checks every file under `src/data/` is listed |
| `src/data/index.ts` | | builds `DataBundle {byId, weapons, ammo, equipment, mechs, pilots, spas, maps, forces, missions, tables, version}`; throws on duplicate id or dangling ref; `version` = content hash |

**Id grammar** (`common#/$defs/Id`: lowercase kebab segments joined by dots):

| Kind | Pattern | Example |
|---|---|---|
| weapon | `<is\|cl>.w.<name>` | `is.w.medium-laser`, `cl.w.er-medium-laser`, `cl.w.heavy-large-laser` |
| ammo | `<is\|cl>.ammo.<name>` | `is.ammo.lrm-10`, `cl.ammo.lb-20x-slug`, `is.ammo.mml-5-srm` |
| equipment | `<is\|cl>.eq.<name>` | `is.eq.double-heat-sink`, `cl.eq.case`, `cl.eq.targeting-computer` |
| mech | `mech.<chassis>.<model>` | `mech.uziel.uzl-2s`, `mech.solitaire.3`, `mech.mad-cat-mk-ii.base` |
| pilot / SPA | `pilot.<name>` / `spa.<name>` | `pilot.ingalls-lu` |
| map / force / mission | `map.<name>` / `force.<name>` / `mission.<name>` | `map.arid-canyons`, `mission.intro` |

Local ids (mount ids, bin ids, side ids; `LocalId` = `^[a-z][a-z0-9-]{0,23}$`) are unique within their record only.

## 2. Shared primitives (`common.schema.json`)

| Def | Shape |
|---|---|
| `Id`, `IdList`, `LocalId`, `Name` (≤60), `Text` (≤600, our words) | strings as above |
| `TechBase` | `IS \| Clan`; `MechTechBase` adds `Mixed` |
| `Location` | `HD CT LT RT LA RA LL RL` (biped only in release 1) |
| `Hexes` | int 0..60 |
| `Tons` | number ≥0, multiple of 0.5 |
| `HexLabel` | `^\d{4}$`, `XXYY`, 1-based column then row, `0101` top-left |
| `Edge` | `north south east west`; `Facing` int 0..5 (0 = north, clockwise); `Skill` int 0..8 |
| `HookName` | `^[a-z][A-Za-z0-9]*$`, must exist in `src/engine/code-hooks.ts` |
| `Ranges` | `{min?, short, medium, long}` upper bound of each bracket in hexes (§3.2) |
| `Damage` | int 0..50, or `{short, medium, long}` |
| `Cluster` | `{rackSize, groupSize, clusterMod?}` |
| `WeaponFlag` | `cluster streak pulse explodes oneShot rapidFire lbx indirect directFire heavyLaser ppc gauss ac missile energy` |
| `Source` | `{ref, url?, note?, retrieved?}`; `ref` ∈ `booklet core-rulebook agoac changelog bmm-errata sarna megamek mul review retailer derived ours` |
| `VerifyNote` / `VerifyList` | `{path (JSON Pointer), note, status: unconfirmed\|standIn\|conflict}` |

## 3. Weapons (`weapon.schema.json`)

### 3.1 Fields

| Field | Req | Meaning |
|---|---|---|
| `id`, `name`, `shortName?` | ✓ | `shortName` ≤14 chars for the record-sheet panel |
| `techBase` | ✓ | IS and Clan versions of the same weapon are separate entries |
| `category` | ✓ | `energy \| ballistic \| missile` (physical attacks are rules, not items) |
| `heat` | ✓ | heat per firing; for `rapidFire`, per shot |
| `damage` | ✓ | per shot; with `cluster`, per missile/pellet; object form = per range bracket (snub-nose PPC 10/8/5) |
| `cluster` | if flag | Cluster Hits Table use (§3.3) |
| `ranges` | ✓ | §3.2 |
| `toHitMod` | | built-in attack modifier (pulse −2, heavy lasers +1); default 0 |
| `slots`, `tons` | ✓ | critical slots, weight |
| `ammo` | ballistic/missile | ammo ids it can fire; `[0]` is the default load; energy omits it |
| `flags` | | §3.4 |
| `rapidFire` | if flag | `{modes: int[], jamHook?}` shots-per-turn choices; RAC `[1,2,4,6]`, Ultra `[1,2]` |
| `linkable` | | `capacitor \| artemis \| targetingComputer` items that may link to it |
| `code` | | hook names for odd rules (§12.2) |
| `notes`, `source` ✓, `verify` | | |

### 3.2 Range brackets

- Brackets are inclusive upper bounds: short = 1..`short`, medium = `short`+1..`medium`, long = `medium`+1..`long`.
  Range > `long` = out of range. Range 0 (same hex) is never legal for a ranged attack in release 1.
- `min` (default 0 = none): at range ≤ `min` the minimum-range modifier applies (formula owned by 10-rules-core:
  `min − range + 1`). Minimum range never makes an attack illegal.
- Validation: `short < medium < long`; `min < short`.
- No extreme range, no underwater ranges (2026 deleted the underwater range table), no inches.

### 3.3 Damage and clusters

| Weapon kind | `damage` | `cluster` | Resolution |
|---|---|---|---|
| Single-shot (lasers, PPC, Gauss, AC) | per hit | none | 1 location |
| LRM n / MML n (LRM ammo) | 1 | `{rackSize:n, groupSize:5}` | hits from Cluster Hits Table; 5-point groups, each its own location |
| SRM n / MML n (SRM ammo) | 2 | `{rackSize:n, groupSize:1}` | each missile its own location |
| Streak SRM n | 2 | `{rackSize:n, groupSize:1}` + flag `streak` | hit = all n missiles hit; miss = no heat, no ammo spent |
| LB n-X, slug ammo | n | removed by ammo `override.noCluster` | 1 location |
| LB n-X, cluster ammo | 1 | `{rackSize:n, groupSize:1}` via ammo override, `toHitMod −1` | each pellet its own location |
| RAC/Ultra, k shots | per shot | engine builds `{rackSize:k, groupSize:1}` per attack | k>1 rolls the Cluster Hits Table |
| Machine gun | 2 | none | 1 location |

- Partial last group: an LRM 10 hitting 7 missiles applies a 5-group and a 2-group.
- `clusterMod` adds to the Cluster Hits Table roll (default 0). Artemis, AMS and similar are code hooks, not data fields.

### 3.4 Flags

| Flag | Meaning for engine/AI |
|---|---|
| `cluster` | requires `cluster` (schema-enforced both ways) |
| `streak` | all-or-nothing; no heat/ammo on miss |
| `pulse` | informational (the −2 itself is `toHitMod`) |
| `explodes` | Gauss-type; a crit on it explodes for 2 × `slots` (2026 `[CL D10]`), capped at 20 under AMMO-010; computed by the engine, no data field |
| `oneShot` | fires once per game; no ammo bin |
| `rapidFire` | requires `rapidFire.modes` |
| `lbx` | weapon accepts slug and cluster ammo choice |
| `indirect` | may fire indirectly (LRM, MML-LRM) |
| `directFire` | counts toward and benefits from a targeting computer |
| `heavyLaser`, `ppc`, `gauss`, `ac`, `missile`, `energy` | family tags for SPAs, VFX and sound mapping |

### 3.5 Effective profile with ammo

`effectiveProfile(weapon, ammo)` = the weapon fields, then each key of `ammo.override` replaces the weapon's value;
`noCluster: true` deletes `cluster` and the `cluster` flag; `addFlags`/`removeFlags` edit `flags`. The engine and UI always use
the effective profile of the bin selected for the attack (the player picks the bin when a weapon has more than one).

## 4. Ammunition (`ammo.schema.json`)

| Field | Req | Meaning |
|---|---|---|
| `weapons` | ✓ | weapon ids that fire it; each of those weapons must list this ammo in its `ammo` |
| `shotsPerTon` | ✓ | full-load shots per bin (one bin = one ton = one slot) |
| `explodes` | | default `true`; `false` (Gauss slugs) forces `explosionPerShot: 0` |
| `explosionPerShot` | ✓ | damage per remaining shot when the bin explodes; missiles = damage per missile × rack size (SRM 6 = 12, LRM 10 = 10) |
| `override` | | §3.5 |

- **Half loads (2026):** a bin may start with `floor(shotsPerTon / 2)` shots (`force.units[].halfLoad`, allowed when
  `mission.options.halfLoads`). A half-loaded bin still occupies its slot and still explodes with its remaining shots.
- **Explosion cap (2026):** internal explosion damage is capped at 20 by the engine (10-rules-core), not by data.
- Machine gun ammo is whole-ton bins only in release 1 (no half-ton bins).

## 5. Equipment (`equipment.schema.json`)

| Field | Req | Meaning |
|---|---|---|
| `kind` | ✓ | `heatSink jumpJet case caseII targetingComputer supercharger masc capacitor artemis ams other` |
| `slots` | ✓ | int, or `"perMech"` (the mount states `slots`) |
| `tons` | ✓ | number, or `"perMech"` (the mount states `tons`) |
| `heatSink` | iff kind heatSink | `{dissipation: 1\|2}` |
| `jumpJet` | iff kind jumpJet | `{improved: bool}` |
| `critEffect` | | `destroy` (default) or `none` (CASE) |
| `explodes` | | default false |
| `code` | | hooks, e.g. `targetingComputer`, `supercharger`, `ppcCapacitor` |

Fixed values the catalogue must use (validate-data checks):

| Item | Slots | Tons |
|---|---|---|
| IS single heat sink | 1 | 1 |
| IS double heat sink | 3 | 1 |
| Clan double heat sink | 2 | 1 |
| Jump jet | 1 | perMech: 0.5 (20–55 t), 1 (60–85 t), 2 (90–100 t) |
| Improved jump jet | 2 | perMech: 2× the jump jet value |
| IS CASE | 1 | 0.5 |
| Clan CASE | 0 | 0 |
| CASE II | IS 1 / Clan 1 | IS 1 / Clan 0.5 |
| Targeting computer | perMech = tons | IS: ceil(Σ direct-fire weapon tons / 4); Clan: ceil(Σ / 5) |
| Supercharger | 1 | perMech: engine tons / 10, rounded up to 0.5 (validate-data logs, does not fail) |
| PPC capacitor | 1 | 1 |

## 6. 'Mechs (`mech.schema.json`)

### 6.1 Fields

| Field | Req | Meaning |
|---|---|---|
| `id`, `chassis`, `model` | ✓ | display = `chassis + ' ' + model` (+ ` (stock)` if `stock`) |
| `figure` | | figure slug shared by both variants of a chassis |
| `tonnage` | ✓ | 20..100 step 5 |
| `techBase` | ✓ | `IS \| Clan \| Mixed`; non-Mixed 'Mechs mount only items of their own tech base |
| `omni`, `stock` | | `stock: true` = stand-in stock variant for an unsourced box variant (G.0) |
| `engine` | ✓ | `{type: standard\|xl\|light\|compact\|xxl, techBase?, rating}` |
| `gyro`, `cockpit` | | defaults `standard`; gyro `compact\|heavyDuty\|xl`, cockpit `small` |
| `movement` | ✓ | `{walk, run, jump}` base MP |
| `heatSinks` | ✓ | `{count ≥10, type single\|double, techBase?}` |
| `structure` | ✓ | `{type: standard\|endoSteel\|composite\|reinforced\|endoComposite, techBase?}` |
| `armor` | ✓ | `{type, techBase?, front:{HD..RL}, rear:{CT,LT,RT}}`; types `standard ferroFibrous lightFerro heavyFerro ferroLamellor stealth hardened reactive reflective` |
| `crits` | ✓ | §6.4 |
| `mounts` | ✓ | §6.5 |
| `ammoBins` | ✓ | §6.6 (may be `[]`) |
| `bv` | ✓ | base BV at 4/5 from the Core Box BV table |
| `source` | ✓ | record-level source |
| `valueSources` | | per-value sources keyed by JSON Pointer, e.g. `{"/armor/front/CT": {"ref":"sarna"}}` |
| `verify` | | unconfirmed values; each also gets a line in `docs/spec/mechs-sources.md` |
| `quirks` | | reserved, must be empty |

`techBase` of `engine`, `heatSinks`, `structure`, `armor` defaults to the 'Mech's; required when the 'Mech is `Mixed`.

### 6.2 Derived values (computed in `src/data/index.ts`, never stored)

| Value | Rule |
|---|---|
| internal structure per location | `tables.internalStructure[tonnage]` (§6.3) |
| max armor per location | HD 9; others 2 × internal; torso front + rear together ≤ 2 × internal |
| walk check | `engine.rating === tonnage × walk` |
| run check | `run === ceil(walk × 1.5)` (supercharger/MASC sprint is the engine's) |
| jump check | standard jets: `jump ≤ walk`; improved: `jump ≤ run`; jump-jet mount count === `jump` |
| heat dissipation | `count × (single 1, double 2)` |
| engine-held sinks | `min(count, floor(rating / 25))`; those take no slots and are not mounts |
| mounted sinks | `count − engine-held` heat-sink mounts of the matching item (IS single/IS double/Clan double) |
| CASE per location | `case` if a mount of kind `case` there; `caseII` if kind `caseII`; else none |
| adjusted BV | `round(bv × bvSkillMultiplier[gunnery][piloting])`, half up (§7.3) |

### 6.3 Internal structure table (standard, endo steel, endo-composite and composite all use it)

| Tons | HD | CT | LT/RT | LA/RA | LL/RL | Max armor (incl. HD 9) |
|---|---|---|---|---|---|---|
| 20 | 3 | 6 | 5 | 3 | 4 | 69 |
| 25 | 3 | 8 | 6 | 4 | 6 | 89 |
| 30 | 3 | 10 | 7 | 5 | 7 | 105 |
| 35 | 3 | 11 | 8 | 6 | 8 | 119 |
| 40 | 3 | 12 | 10 | 6 | 10 | 137 |
| 45 | 3 | 14 | 11 | 7 | 11 | 153 |
| 50 | 3 | 16 | 12 | 8 | 12 | 169 |
| 55 | 3 | 18 | 13 | 9 | 13 | 185 |
| 60 | 3 | 20 | 14 | 10 | 14 | 201 |
| 65 | 3 | 21 | 15 | 10 | 15 | 211 |
| 70 | 3 | 22 | 15 | 11 | 15 | 217 |
| 75 | 3 | 23 | 16 | 12 | 16 | 231 |
| 80 | 3 | 25 | 17 | 13 | 17 | 247 |
| 85 | 3 | 27 | 18 | 14 | 18 | 263 |
| 90 | 3 | 29 | 19 | 15 | 19 | 279 |
| 95 | 3 | 30 | 20 | 16 | 20 | 293 |
| 100 | 3 | 31 | 21 | 17 | 21 | 307 |

- Stored in `tables.json` as `internalStructure["50"] = {HD:3, CT:16, sideTorso:12, arm:8, leg:12}`; validate-data checks
  the 17 rows equal this table, and that max armor = 9 + 2 × (CT + 2·sideTorso + 2·arm + 2·leg).
- Composite structure: same points (its effects, if any, are a 10-rules-core hook). Reinforced: same points (damage halving
  is a hook). No 'Mech in release 1 changes the point counts.

### 6.4 Critical slot table (`crits`)

- `crits.<loc>` is an ordered array, slot 1 first: **12 slots** for CT, LT, RT, LA, RA; **6 slots** for HD, LL, RL
  (schema-enforced).
- Each slot is a **system token** or **`#<id>`** referencing a mount or ammo bin of this 'Mech.
- System tokens: `lifeSupport sensors cockpit engine gyro shoulder upperArm lowerArm hand hip upperLeg lowerLeg foot
  structure armor empty`. `structure`/`armor` are endo-steel/ferro-type filler slots; `empty` is an unused slot. A crit that lands on `structure`, `armor` or `empty` is an inapplicable slot and is re-rolled (CRIT-003, CRIT-073), as in AGoAC; there is no per-slot `critable` data field. `40-ai` §3.4 counts only slots that can take a crit.
- Crit effects of each token belong to 10-rules-core; this spec fixes only the layout.

**Fixed layouts** (validate-data checks exactly):

| Location | Slots | Rule |
|---|---|---|
| HD, standard cockpit | 1–6 | `lifeSupport, sensors, cockpit, <free>, sensors, lifeSupport` |
| HD, small cockpit | 1–6 | `lifeSupport, sensors, cockpit, sensors, <free>, <free>` |
| CT | from 1 | engine block A (3), then gyro (standard 4, compact 2, heavyDuty 4, xl 6), then engine block B (CT engine slots − 3); the rest free |
| LT/RT | from 1 | side-torso engine slots (table below), the rest free |
| LA/RA | 1–4 | `shoulder, upperArm`, then optional `lowerArm`, then optional `hand` (hand requires lowerArm); an omitted actuator's slot is free |
| LL/RL | 1–4 | `hip, upperLeg, lowerLeg, foot`; 5–6 free |

| Engine | CT engine slots | Each side torso |
|---|---|---|
| standard | 6 | 0 |
| compact | 3 | 0 |
| light (IS only) | 6 | 2 |
| xl IS / xl Clan | 6 | 3 / 2 |
| xxl IS / xxl Clan | 6 | 6 / 4 |

Example (standard engine, standard gyro): CT = `engine ×3, gyro ×4, engine ×3, <free>, <free>`.

**Filler slot counts** (count of `structure` / `armor` tokens across all locations; any locations allowed):

| Type | IS | Clan |
|---|---|---|
| endoSteel | 14 | 7 |
| endoComposite | 7 | 4 |
| composite, reinforced, standard | 0 | 0 |
| ferroFibrous | 14 | 7 |
| lightFerro (IS) | 7 | — |
| heavyFerro (IS) | 21 | — |
| ferroLamellor (Clan) | — | 12 |
| stealth (IS) | 12: exactly 2 in each of LA, RA, LT, RT, LL, RL | — |
| reactive | 14 | 7 |
| reflective | 10 | 5 |
| standard armor, hardened | 0 | 0 |

### 6.5 Mounts (`mounts[]`)

One entry per physical item: every weapon, heat sink beyond the engine-held ones, jump jet, CASE, TC, supercharger,
capacitor. Fields: `id` (LocalId), `item` (weapon or equipment id), `location`, `rear?` (CT/LT/RT only), `split?`,
`linkedTo?`, `slots?`, `tons?`.

Slot rules:
1. A mount's `#id` appears in `crits` exactly `slots` times (item `slots`, or the mount's `slots` when the item says
   `perMech`), all in `location` or `split`, contiguous within each location. Zero-slot items (Clan CASE) appear 0 times.
2. `split` must be adjacent: LA–LT, RA–RT, LT–CT, RT–CT, LL–LT, RL–RT. Only weapons may split, and only when they cannot
   fit in one location.
3. `rear: true` = fires into the rear arc; allowed in CT/LT/RT only.
4. `linkedTo` names a weapon mount whose item lists this mount's kind in `linkable` (capacitor → PPC family).
5. Jump jets: legs, LT, RT, CT only. CASE: LT, RT, CT, arms, legs (IS CASE never in HD).
6. Torso and arm weapons follow the torso/arm for arcs; leg weapons fire forward only (rules owned by 10-rules-core).

### 6.6 Ammo bins (`ammoBins[]`)

`{id, ammo, location, options?, load?}`: one per ton. `#id` appears exactly once in its location. `ammo` must be listed
by at least one weapon mounted on this 'Mech. `options` (when present) includes `ammo` and lists the alternatives the player
may load at setup (LB-X slug/cluster, MML LRM/SRM); every option must be fireable by the same weapons. `load` defaults to
`full`; forces override per bin.

### 6.7 Sources and verification

- `source` is required; `valueSources` overrides it per value.
- Every value not confirmed by the booklet, Sarna or a published record sheet gets a `verify` note (`status: unconfirmed`).
  A stock variant standing in for a box variant has `stock: true` and a root `verify` note with `status: standIn`.
- MegaMek (`megamek` ref) is a cross-check aid: we type the numbers ourselves and never commit its files.

## 7. Pilots, SPAs and BV

### 7.1 Pilots (`pilot.schema.json`)

`{id, name, callsign?, affiliation?, gunnery, piloting, spas[], preferredMech?, bio?, portrait?, source, verify?}`.
Core Box cards (names known, skills and SPAs to source): Bitala van Austen, Erbie Hastelmeyer, Sarkan Huditar, Rayan
Joransson, Ingalls Lu, Artesse Rodimar, Nanette Romanov, Portala Ventimiglia. Unknown skills default to 4/5 with a
`verify` note.

### 7.2 SPAs (`spa.schema.json`)

`{id, name, cost, text, hook, windows?, params?, usage?, source, verify?}`. `text` is our paraphrase. `hook` is registered
in `code-hooks.ts` (`spa.<hook>`). `windows` ⊂ `passive initiative movement attackDeclare toHit hitLocation cluster damage
crit psr heat consciousness endPhase setup`. `usage` = `always | oncePerTurn | oncePerGame | choice`.

### 7.3 BV skill multiplier (`tables.bvSkillMultiplier`) (2026?)

`rows[gunnery][piloting]`; `rows[4][5]` must equal 1.00.

| G \ P | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
|---|---|---|---|---|---|---|---|---|---|
| 0 | 2.42 | 2.31 | 2.21 | 2.10 | 1.93 | 1.75 | 1.68 | 1.59 | 1.50 |
| 1 | 2.21 | 2.11 | 2.02 | 1.92 | 1.76 | 1.60 | 1.54 | 1.46 | 1.38 |
| 2 | 1.93 | 1.85 | 1.76 | 1.68 | 1.54 | 1.40 | 1.35 | 1.28 | 1.21 |
| 3 | 1.66 | 1.58 | 1.51 | 1.44 | 1.32 | 1.20 | 1.16 | 1.10 | 1.04 |
| 4 | 1.38 | 1.32 | 1.26 | 1.20 | 1.10 | 1.00 | 0.95 | 0.90 | 0.85 |
| 5 | 1.31 | 1.19 | 1.13 | 1.08 | 0.99 | 0.90 | 0.86 | 0.81 | 0.77 |
| 6 | 1.24 | 1.12 | 1.07 | 1.02 | 0.94 | 0.85 | 0.81 | 0.77 | 0.72 |
| 7 | 1.17 | 1.06 | 1.01 | 0.96 | 0.88 | 0.80 | 0.76 | 0.72 | 0.68 |
| 8 | 1.10 | 0.99 | 0.95 | 0.90 | 0.83 | 0.75 | 0.71 | 0.68 | 0.64 |

- This is the TechManual-era table; replace it with the Core Box table when the booklet is in hand (`source.ref` then
  `booklet`, `verify` removed).
- SPA cost does not change BV in release 1 (2026?): the picker shows the SPA cost next to BV but does not add it.

## 8. Maps (`map.schema.json`)

| Field | Req | Meaning |
|---|---|---|
| `theme` | ✓ | `grasslands \| desert` |
| `width`, `height` | ✓ | columns × rows; a standard mapsheet is **16 × 17** (2026?) |
| `defaultLevel` | | default 0; unlisted hexes are clear at this level |
| `hexes` | one of | sparse object keyed by `XXYY` → `{level?, terrain?[], label?}` |
| `sheets` | one of | composite: `[{map, col, row, rotate180?}]` (exactly one of `hexes`/`sheets`) |

- **Geometry** (owned by the hex spec; restated for data entry): flat-topped hexes; columns run west→east, rows north→south;
  even-numbered columns (`02xx`, `04xx` ...) sit half a hex lower than odd ones (verify against MegaMek `Coords`).
- **Level** is the ground level; for water it is the water surface, and the bottom is `level − depth`.
- **Terrain features**: `{type: lightWoods|heavyWoods|rough|rubble|pavement|sand|mud|swamp|ice|snow|foliage}`,
  `{type:'water', depth: 1..5}`, `{type:'road', exits: Facing[]}`, `{type:'building', class, cf, height}` (reserved).
- **Release-1 terrain**: clear, lightWoods, heavyWoods, rough, water (depth 1, 2, 3+), road, pavement, levels.
  validate-data **errors** on any other feature until 10-rules-core implements it (rubble, sand, mud, swamp, ice, snow,
  foliage and building are reserved for M8+).
- **Allowed combinations per hex** (validate-data):
  1. at most one of `lightWoods, heavyWoods, foliage`;
  2. at most one of `rough, rubble, pavement, sand, mud, swamp, snow`;
  3. `water` excludes groups 1 and 2, `road` and `building`; `ice` only together with `water`;
  4. `road` may share a hex with group 2 only as `pavement` (a road through woods: road + lightWoods is allowed; the road
     rules decide cost when entering via a road exit);
  5. `building` excludes everything except `pavement`.
- `road.exits`: facings toward the neighbouring road hexes; validate-data checks the neighbour in each exit direction is a
  road hex listing the opposite facing (`(f + 3) % 6`), or is off-map.
- **Composites**: each `sheets[].map` must be a single-sheet map; `col` must be even (keeps column parity);
  `rotate180` needs an even `width` and maps `(x, y)` → `(W + 1 − x, H + 1 − y)` and each road exit `f` → `(f + 3) % 6`.
  Placed sheets may not overlap and must exactly tile `width × height`.
- **IP**: hex layouts are transcribed per hex into our own JSON (from the owner's maps or a MegaMek `.board` cross-check);
  never ship a scan. Placeholder layouts carry `verify: [{path: '/hexes', status: 'standIn'}]`.

## 9. Forces (`force.schema.json`)

`{id, name, faction?, color?, bvBudget?, units[1..12], source?, verify?}`; each unit `{slot?, mech, pilot?, skills?, name?,
ammo?, halfLoad?}`.
- Skills: `skills` if given, else the pilot card's, else 4/5.
- `ammo`: bin id → ammo id from that bin's `options`. `halfLoad`: bin ids starting half full.
- Force BV = Σ adjusted BV; must be ≤ `bvBudget` when set.
- The runtime force picker produces the same shape (ids `force.custom-<n>`), so missions treat both alike.

## 10. Missions (`mission.schema.json`)

Fields and runtime rules are in `11-missions.md` §1. Summary: `{id, name, kind: intro|skirmish|box, status?, order?,
briefing?, map (id | 'choose'), mapChoices?, sides[2], defaultHumanSide?, turnLimit?, victory[], options, specialRules?,
source, verify?}`; side = `{id, label, force (id | 'pick'), control?, homeEdge, initiativeMod?, deployment}`; deployment =
`{mode:'edgeEntry'} | {mode:'edgePlace', depth} | {mode:'hexes', hexes}`.

## 11. validate-data checks beyond JSON Schema

| Check | Rule |
|---|---|
| refs | every id resolves: weapon.ammo ↔ ammo.weapons (both directions), mount.item, bin.ammo/options, force.mech/pilot, pilot.spas, mission.map/force, map.sheets |
| hooks | every `code`, `hook`, `jamHook` exists in `src/engine/code-hooks.ts` |
| ranges | `min < short < medium < long` (weapon and ammo override) |
| tech base | non-Mixed 'Mech items match its tech base |
| movement | walk = rating / tonnage; run = ceil(1.5 × walk); jump-jet mounts = jump; jump ≤ walk (≤ run if improved) |
| heat sinks | mounted sinks = count − min(count, floor(rating/25)), all of the declared type and tech base |
| crits | fixed layouts (§6.4); filler counts; every `#id` resolves; slot counts per mount (§6.5 rule 1); split adjacency; each bin once; no mount or bin left unreferenced unless 0 slots |
| armor | per-location max (§6.2); HD ≤ 9 |
| equipment | fixed slots/tons (§5); TC size; jump-jet tons by tonnage; supercharger tons (logged only) |
| tonnage audit | sum of structure, engine, gyro, cockpit, armor, items vs tonnage: **logged** for review, never fails (engine weight tables are not in data) |
| BV | `bv` present; `bvSkillMultiplier.rows[4][5] === 1`; 17 internal-structure rows match §6.3 |
| maps | labels within `width × height`; terrain whitelist and combinations (§8); road symmetry; composite tiling |
| missions | `11-missions.md` §9 |
| prose | no run of ≥12 words matching `docs/sources/` text (skipped when sources are absent) |
| edition leak | reject keys anywhere: `stability`, `evasion`, `skid`, `ghostHeat`, `dumpAmmo`, `pointValue`, `pv`, `tmm`, `overheat`, `inches`, `alphaStrike`; reject the string `Weapon Attack Phase` in any text |

## 12. Core Box catalogue (ids to create)

### 12.1 Items (from E.11; numbers are entered by the catalogue stage with sources and the verify loop)

| Family | Ids |
|---|---|
| IS lasers | `is.w.small-laser`, `is.w.medium-laser`, `is.w.large-laser`, `is.w.er-large-laser`, `is.w.er-medium-laser`, `is.w.medium-pulse-laser`, `is.w.small-x-pulse-laser` |
| Clan lasers | `cl.w.er-small-laser`, `cl.w.er-medium-laser`, `cl.w.er-large-laser`, `cl.w.er-small-pulse-laser`, `cl.w.medium-pulse-laser`, `cl.w.micro-pulse-laser`, `cl.w.heavy-small-laser`, `cl.w.heavy-medium-laser`, `cl.w.heavy-large-laser`, `cl.w.improved-heavy-large-laser`, `cl.w.improved-medium-laser` (verify name/tech base) |
| PPCs | `is.w.ppc`, `is.w.er-ppc`, `cl.w.er-ppc`, `is.w.snub-nose-ppc`, `is.w.light-ppc`, `is.eq.ppc-capacitor` |
| Autocannons | `is.w.lb-5x` / `cl.w.lb-5x` (whichever the sheets use), `cl.w.lb-20x`, `is.w.rac-5`, `cl.w.protomech-ac-8` |
| Gauss | `is.w.gauss-rifle` / `cl.w.gauss-rifle`, `is.w.improved-heavy-gauss-rifle` |
| Missiles | `is.w.lrm-10` / `cl.w.lrm-10`, `is.w.srm-6` / `cl.w.srm-6`, `cl.w.streak-srm-4`, `cl.w.streak-srm-6`, `is.w.mml-5` |
| Other | `is.w.machine-gun` / `cl.w.machine-gun` |
| Ammo | one per weapon, plus `*-slug` and `*-cluster` for LB-X, `*-lrm` and `*-srm` for MML |
| Equipment | heat sinks (IS single, IS double, Clan double), `is.eq.jump-jet`, `is.eq.improved-jump-jet` (+ Clan), `is.eq.case`, `cl.eq.case`, `is.eq.case-ii`, `cl.eq.case-ii`, `is.eq.targeting-computer`, `cl.eq.targeting-computer`, `is.eq.supercharger` |

The tech base of each id follows the record sheets: create the IS or Clan version (or both) only as the 16 sheets use it,
and fix the list above when the sheets disagree. Engines (XL, Clan XL, light), endo steel, composite structure, ferro-fibrous and ferro-lamellor are **'Mech fields**
(`engine`, `structure`, `armor`), not items.

### 12.2 Code hooks to register (names fixed now; behaviour in 10-rules-core)

| Hook | Used by |
|---|---|
| `racJam` | RAC rapid-fire jam roll and Movement-Phase unjam (2026) |
| `ultraJam` | Ultra AC (none in the box; reserved) |
| `xPulse` | small X-pulse laser extras, if any (verify) |
| `improvedHeavyGauss` | improved heavy Gauss (2026: firing PSR deleted) |
| `ppcCapacitor` | capacitor charge/discharge; 2026: a roll of 2 no longer burns it out |
| `targetingComputer` | −1 to-hit for direct-fire weapons |
| `supercharger` | sprint MP via Escalating Failure (2026) |
| `caseProtect`, `caseIIProtect` | CASE/CASE II explosion containment (2026 results) |
| `ferroLamellor` | damage reduction per hit (verify 2026 value) |
| `spa.<name>` | one per SPA |

## 13. Example records (valid against the schemas; numbers illustrative, re-source in data entry)

```json
{"id":"is.w.lrm-10","name":"LRM 10","techBase":"IS","category":"missile","heat":4,"damage":1,
 "cluster":{"rackSize":10,"groupSize":5},"ranges":{"min":6,"short":7,"medium":14,"long":21},
 "slots":2,"tons":5,"ammo":["is.ammo.lrm-10"],"flags":["cluster","missile","indirect"],"source":{"ref":"agoac"}}
```

```json
{"id":"is.ammo.mml-5-srm","name":"MML 5 SRM Ammo","techBase":"IS","weapons":["is.w.mml-5"],"shotsPerTon":20,
 "explosionPerShot":10,"override":{"damage":2,"cluster":{"rackSize":5,"groupSize":1},
 "ranges":{"short":3,"medium":6,"long":9},"removeFlags":["indirect"]},"source":{"ref":"derived"}}
```

'Mech skeleton (Uziel UZL-2S, slot order illustrative):

```json
{"id":"mech.uziel.uzl-2s","chassis":"Uziel","model":"UZL-2S","figure":"bt-uziel","tonnage":50,"techBase":"IS",
 "engine":{"type":"xl","rating":300},"movement":{"walk":6,"run":9,"jump":6},
 "heatSinks":{"count":10,"type":"double"},"structure":{"type":"standard"},
 "armor":{"type":"standard","front":{"HD":9,"CT":17,"LT":14,"RT":14,"LA":12,"RA":12,"LL":18,"RL":18},
          "rear":{"CT":6,"LT":4,"RT":4}},
 "crits":{"HD":["lifeSupport","sensors","cockpit","empty","sensors","lifeSupport"],
  "CT":["engine","engine","engine","gyro","gyro","gyro","gyro","engine","engine","engine","#srm6","#srm6"],
  "LT":["engine","engine","engine","#mg-lt","#jj1","#jj2","#jj3","#ammo-srm6","empty","empty","empty","empty"],
  "RT":["engine","engine","engine","#mg-rt","#jj4","#jj5","#jj6","#ammo-mg","empty","empty","empty","empty"],
  "LA":["shoulder","upperArm","lowerArm","hand","#ppc-la","#ppc-la","#ppc-la","empty","empty","empty","empty","empty"],
  "RA":["shoulder","upperArm","lowerArm","hand","#ppc-ra","#ppc-ra","#ppc-ra","empty","empty","empty","empty","empty"],
  "LL":["hip","upperLeg","lowerLeg","foot","empty","empty"],"RL":["hip","upperLeg","lowerLeg","foot","empty","empty"]},
 "mounts":[{"id":"ppc-la","item":"is.w.ppc","location":"LA"},{"id":"ppc-ra","item":"is.w.ppc","location":"RA"},
  {"id":"mg-lt","item":"is.w.machine-gun","location":"LT"},{"id":"mg-rt","item":"is.w.machine-gun","location":"RT"},
  {"id":"srm6","item":"is.w.srm-6","location":"CT"},
  {"id":"jj1","item":"is.eq.jump-jet","location":"LT","tons":0.5}, "... jj2..jj6 likewise ..."],
 "ammoBins":[{"id":"ammo-srm6","ammo":"is.ammo.srm-6","location":"LT"},
             {"id":"ammo-mg","ammo":"is.ammo.machine-gun","location":"RT"}],
 "bv":1352,"source":{"ref":"megamek","note":"stock values cross-checked"},
 "verify":[{"path":"/crits","note":"slot order not yet checked against a record sheet"}]}
```

(The `"... jj2..jj6 likewise ..."` string is elision for this document only.) All 10 double heat sinks are engine-held
(floor(300/25) = 12 ≥ 10), so the UZL-2S has no heat-sink mounts.

## 14. Rulings in this spec

| Rule | What we did | Why |
|---|---|---|
| Mapsheet size | 16 × 17 hexes (2026?) | Classic sheets number 0101–1617; AGoAC says 17 hexes long; Core Box maps reuse AGoAC layouts |
| BV skill table | TechManual table (2026?) | Core Box table not in hand; 4/5 = 1.00 matches the Core Box base BV |
| SPA cost and BV | not added to BV (2026?) | cost meaning unknown without the box |
| Explosion cap | engine applies 20 cap, data stores per-shot damage | changelog: 20-point cap on internal explosions |
| Half loads | per-bin setup option | changelog: any or all bins may start half loaded |
| MG half-ton bins | not supported | none on the Core Box sheets as far as known |
