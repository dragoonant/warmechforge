# 70: Maps

Map data (which hex is what), how it is stored, how the four Core Box maps get transcribed, and the procedural-style
test map for M3. The engine reads terrain from map data, never from meshes. Rendering is `50-client` §4; rules effects
of terrain (MP costs, LOS, to-hit, PSRs) are `10-rules-core`. A map file holds facts only, never rules numbers.

## 1. IP

- A hex layout (level and terrain per hex) is transcribed into our own JSON and drawn only with our own art. Never
  commit a scan, photo or image of a Catalyst map, and never commit a MegaMek `.board` file.
- MegaMek board data (`MegaMek/mm-data`, CC-BY-NC-SA-4.0) is a cross-check aid. When it was used, the map's `source`
  note says so and `CREDITS.md` credits MegaMek. See the open question in §6.4.

## 2. Mapsheet facts

| Fact | Value | Evidence |
|---|---|---|
| Hexes per standard mapsheet | **16 columns × 17 rows = 272** (labels `0101`…`1617`) | MegaMek boards declare `size 16 17`; the AGoAC rulebook says a mapsheet is seventeen hexes long |
| Physical size | 18 × 22 in, one hex = 30 m | AGoAC rulebook |
| Orientation | flat-topped hexes; row `01` is the north edge; column `01` the west edge | |
| Partial hexes | the half/quarter hexes at the sheet edges are **not** part of the map data; they are off-board for every purpose (movement, LOS, displacement) and are not drawn | AGoAC: no voluntary entry; 2026: LOS ignores partial hexes |

The brief's "15 × 17" is superseded by 16 × 17.

## 3. Hex math summary (authoritative version: `00-architecture`; if they differ, 00 wins)

- Label `XXYY` → 0-based `col = XX − 1`, `row = YY − 1`.
- Offset layout is **odd-q**: 0-based odd columns (labels `02`, `04`, … `16`) sit half a hex lower (south) than even
  ones. Verify against MegaMek `Coords` (its x/y are our col/row; label = `(x+1)(y+1)`).
- Offset → axial: `q = col`, `r = row − (col − (col & 1)) / 2`; cube `s = −q − r`. Axial → offset:
  `col = q`, `row = r + (q − (q & 1)) / 2`.
- Facing / neighbour directions in axial `(dq, dr)`, clockwise from north:

| Facing | Name | `(dq, dr)` |
|---|---|---|
| 0 | N | (0, −1) |
| 1 | NE | (+1, −1) |
| 2 | SE | (+1, 0) |
| 3 | S | (0, +1) |
| 4 | SW | (−1, +1) |
| 5 | NW | (−1, 0) |

- Distance: `(|dq| + |dr| + |ds|) / 2`. Ranges count the target hex, not the attacker's (equal to this distance).
- World (1 unit = flat-to-flat): `x = q × √3/2`, `z = r + q/2` (south = +z), `y = level × LEVEL_HEIGHT`; then subtract
  the centre of all hex centres so the board is centred at the origin.
- Worked check (16 × 17): `0101` → axial (0, 0); `0201` → (1, 0); `0102` → (0, 1); `0301` → (2, −1); `1617` → (15, 9).
  `0201` is the SE neighbour of `0101`; `0301` is the NE neighbour of `0201`.

## 4. Map JSON

File: `src/data/maps/<slug>.json`, one per mapsheet, validated by `npm run validate:data` against
`schemas/map.schema.json`. The authoritative contract is `20-data-schema` §8 and that schema; this section adds only
what the map-entry agents need. If this section and the schema differ, the schema wins (report it in `issues`).

```json
{
  "id": "map.arid-canyons",
  "name": "Arid Canyons",
  "theme": "desert",
  "width": 16,
  "height": 17,
  "hexes": {
    "0407": { "level": 1 },
    "0608": { "level": 2, "terrain": [{ "type": "lightWoods" }] },
    "0809": { "level": 0, "terrain": [{ "type": "water", "depth": 1 }] },
    "1003": { "terrain": [{ "type": "rough" }] }
  },
  "notes": "Layout of Desert #3.",
  "source": { "ref": "megamek", "note": "hex-by-hex cross-check; no file copied", "retrieved": "2026-10-08" },
  "verify": [{ "path": "/hexes", "note": "second-source spot check pending", "status": "unconfirmed" }]
}
```

| Field | Type | Rule |
|---|---|---|
| `id` | `map.<kebab>` | unique; the file is `<kebab>.json` (e.g. `map.arid-canyons` in `arid-canyons.json`); `test-canyons` is `map.test-canyons` |
| `name` | string | display name |
| `theme` | `"desert"` \| `"grasslands"` | selects colours, light and ground mat (`50-client` §4) |
| `width`, `height` | int | 16 × 17 for every Core Box sheet |
| `defaultLevel` | int −5…10 | optional, default 0 |
| `hexes` | object keyed by `XXYY` | **sparse**: only hexes that differ from default (default level, clear). Every key must be inside `width × height`. Mutually exclusive with `sheets` (§5) |
| `hexes[*].level` | int −5…10 | ground level; for water it is the **surface** level (bottom = `level − depth`) |
| `hexes[*].terrain` | array of features, max 3 | `{type: 'lightWoods' \| 'heavyWoods' \| 'rough' \| 'pavement'}`, `{type: 'water', depth: 1..5}`, `{type: 'road', exits: Facing[]}` |
| `hexes[*].label` | string ≤ 30 | optional place name of our own; transcribed maps leave it out |
| `layoutOf` | n/a | not a schema field: put the printed sheet name (e.g. `Desert #3`) in `notes` |
| `source` | `{ref, url?, note?, retrieved?}` | required. `ref` ∈ the common Source enum; use `megamek` for a MegaMek cross-check, `ours` for hand-authored or procedural maps, `review` / `retailer` for photo-based entry. Put checked URLs in `url` / `note`; MegaMek file paths and commit SHAs go in `note` |
| `verify` | `[{path, note, status?}]` | replaces any `verified` flag: a transcribed map starts with `{path: '/hexes', status: 'unconfirmed'}`; the second-source check removes it (or leaves per-hex `conflict` notes). A map with an empty or absent `verify` is verified. Stand-in layouts use `status: 'standIn'` |

**Release-1 terrain** (same list as `20-data-schema` §8): clear, `lightWoods`, `heavyWoods`, `rough`, `water`
(depth 1, 2, 3+), `road`, `pavement`, and levels. Core Box transcription rarely needs `road` or `pavement`; they are
accepted so a map entry never fails on a hex the sheet really has. `10-rules-core` owns their costs (MOVE-022 for road).
Everything else (`rubble`, `sand`, `mud`, `swamp`, `ice`, `snow`, `foliage`, `building`,
`bridge`) is **reserved for M8+**: validation fails with `UNSUPPORTED_TERRAIN <type> at <hex>`.

Validation rules (all errors name the hex): the per-hex combination rules of `20-data-schema` §8 (one of the woods; one of
rough/pavement; `water` excludes woods, rough and pavement; `road` may sit with `pavement` or woods); no unknown keys;
labels exactly 4 digits and inside the sheet; `road.exits` checked against neighbours; the file round-trips (sorted keys,
LF, 2-space indent) so diffs stay small.

Engine load: `loadMap(json)` resolves `sheets` (§5), then returns a dense `Hex[]` of `width × height`, filling defaults. The
engine stores terrain in its own state; the client never re-reads the JSON.

## 5. Composite boards (maps built from several sheets)

A composite is itself a map file (`20-data-schema` §8) with `sheets` instead of `hexes`; a mission's `map` field names it
like any other map. Example, two sheets stacked, the second turned around:

```json
{ "id": "map.oasis-crossing", "name": "Oasis Crossing", "theme": "desert", "width": 16, "height": 34,
  "sheets": [ { "map": "map.scorched-oasis", "col": 0, "row": 0 },
              { "map": "map.headwater-crossing", "col": 0, "row": 17, "rotate180": true } ],
  "source": { "ref": "ours" } }
```

- `col`/`row` = global 0-based offset of the sheet's `0101`. `col` must be even (keeps column parity) and every sheet is a
  single-sheet map; placed sheets may not overlap and must tile `width × height` exactly (validate-data).
- `rotate180` (needs an even sheet `width`): local `(x, y)` → `(W + 1 − x, H + 1 − y)` in 1-based labels, i.e. `0101` ↔ `1617`
  on a 16 × 17 sheet; each road exit `f` becomes `(f + 3) % 6`.
- Global labels are global `XXYY`; the hex tooltip adds `(Desert #2 0507)` for the sheet-local label.
- M3 uses a single sheet; composite boards are M8.

## 6. Core Box maps

### 6.1 The four maps

| Our slug (id = `map.<slug>`) | Name | Printed layout | MegaMek cross-check file (`MegaMek/mm-data`, branch `main`) | Theme |
|---|---|---|---|---|
| `headwater-crossing` | Headwater Crossing | Grasslands #2 | `data/boards/AGoAC Maps/16x17 Grassland 2.board` (a variant `16x17 Grassland 2 (Low Bridges).board` also exists; use the plain one unless photos show bridges) | grasslands |
| `sodden-hills` | Sodden Hills | Grasslands #3 | `data/boards/AGoAC Maps/16x17 Grassland 3.board` | grasslands |
| `scorched-oasis` | Scorched Oasis | Desert #2 | `data/boards/AGoAC Maps/16x17 Desert 2.board` | desert |
| `arid-canyons` | Arid Canyons | Desert #3 | `data/boards/AGoAC Maps/16x17 Desert 3.board` | desert |

The names-to-layout mapping is from the brief (Part G.0) and still needs a photo check: the 2026 box may have
reprinted the AGoAC sheets with changes. Sanity numbers observed for `16x17 Desert 3.board` (2026-10-08): 272 hexes;
levels 0/1/2/3 on 154/77/37/4 hexes; 40 hexes carry woods; no water or rough; some purely cosmetic tags.

### 6.2 MegaMek `.board` format (for the converter only)

- Header: `size 16 17`, optional `option`/`tag` lines, then one line per hex:
  `hex XXYY <elevation> "<terrain list>" "<theme>"`, terrain list items `type:level[:exits]` joined by `;`.
- Token mapping:

| MegaMek token | Our field |
|---|---|
| elevation | `level` |
| `woods:1` / `woods:2` | `terrain: [{type: "lightWoods"}]` / `[{type: "heavyWoods"}]` |
| `woods:3` (ultra-heavy) | reject (`UNSUPPORTED_TERRAIN`) and list in issues |
| `rough:1` | `{type: "rough"}` (`rough:2` ultra: reject) |
| `water:N` | `{type: "water", depth: N}`; `level` = the elevation (surface) |
| `foliage_elev`, `ground_fluff`, theme string, `tag` lines | ignore (cosmetic) |
| `road` (with exits), `pavement` | `{type: "road", exits}` / `{type: "pavement"}` (release-1 terrain; map exit numbers to our facings and list any mapping doubt in issues) |
| anything else (`bridge`, `building`, `sand`, `swamp`, …) | reject with hex label; list in issues |

### 6.3 Transcription procedure (one agent per map, Sonnet; verify loop on)

1. Download the `.board` file with `gh api` (raw) into `sources-local/boards/` (gitignored, outside commits).
2. Run `node tools/maps/mmboard-to-map.mjs <board> <slug> <name> <layoutOf> <theme>` (`layoutOf` goes into `notes`) → writes
   `src/data/maps/<slug>.json` with `source: {ref: "megamek", note: "<file path> @ <commit SHA>"}`,
   `verify: [{path: "/hexes", status: "unconfirmed", note: "second-source check pending"}]`. The tool never copies comments or the licence header.
3. Look for a second source (Core Box review photos, retailer photos, battle reports; cap 4 fetches). Record each URL in
   `source.url` / `source.note` and every disagreement in `notes` as `XXYY: megamek=<x> photo=<y>`.
4. A second agent spot-checks at least 30 hexes (all level-2+ hexes, all water, all heavy woods) against the photos and
   the board file, then removes the `verify` entry (or records `conflict` entries) and returns findings.
5. Run `npm run validate:data`; screenshot the map in the client (top-down preset) for the check-in.

### 6.4 Open question for the owner

Is a layout derived hex-by-hex from MegaMek's board (credited, never committing the file) acceptable, given its
share-alike licence? If not, transcription waits for owner photos of the Core Box sheets and MegaMek is used only to
diff (`tools/maps/diff-board.mjs`).

## 7. Test map `test-canyons` (M3 fallback when no transcription is ready)

A hand-authored, Arid-Canyons-like sheet: two mesas with level 3 cores, a canyon floor with a dry rough riverbed and a
small pond, clear deployment rows `01–02` (north) and `16–17` (south). It is fixed data (no generator), id
`map.test-canyons`, theme `desert`, `source: {ref: "ours"}`, no `verify` entry (verified by construction). Legend letters map to features: `l` lightWoods, `h` heavyWoods, `r` rough, `a`/`A` water depth 1/2.

Grid legend: each cell is `<level><terrain>`; terrain `.` clear, `l` light woods, `h` heavy woods, `r` rough,
`a` water depth 1, `A` water depth 2 (water cells' digit is the surface level). Columns `01`…`16` left to right, rows
`01`…`17` top to bottom. Only non-`0.` cells go into `hexes`.

```
     01 02 03 04 05 06 07 08 09 10 11 12 13 14 15 16
01   0. 0. 0. 0. 0. 0. 0l 0l 0. 0. 0. 0. 0. 0. 0. 0.
02   0. 0l 0. 0. 0. 0. 0. 0. 0. 0. 0. 0. 0l 0. 0. 0.
03   0. 0. 0. 1. 1. 0. 0. 0. 0. 0. 0. 1. 1. 0. 0. 0.
04   0. 0. 1. 2. 2. 1. 0. 0r 0. 0. 1. 2. 2. 1. 0. 0.
05   0. 1. 2. 2l 3. 2. 0. 0r 0. 0. 2. 3. 2. 2. 1. 0.
06   0l 1. 2. 3. 3. 2. 0l 0r 0. 1. 2. 3. 3h 2. 1. 0.
07   0. 1. 2h 3. 3. 2. 0. 0r 0l 1. 3. 3. 3. 2. 1. 0l
08   0. 1. 2h 2. 3. 1. 0. 0a 0a 0. 3. 3. 2. 2. 1. 0.
09   0. 1. 2. 2. 2. 0. 0. 0A 0a 0. 2. 2l 2. 1. 0. 0.
10   0. 0. 1. 2. 2. 0. 0l 0a 0r 0. 2. 2. 2h 1. 0. 0.
11   0. 0. 1. 2. 3. 2. 0. 0r 0. 1. 3. 3. 2. 1. 0. 0.
12   0l 1. 2. 3. 3. 2. 0. 0r 0. 2. 3. 3. 2. 1. 0. 0.
13   0. 1. 2. 2l 2. 1. 0. 0r 0l 1. 2. 2. 1. 0. 0l 0.
14   0. 0. 1. 1. 1. 0. 0. 0r 0. 0. 1. 1. 0. 0. 0. 0.
15   0. 0. 0. 0. 0. 0. 0l 0. 0. 0. 0. 0. 0l 0. 0. 0.
16   0. 0l 0. 0. 0. 0. 0. 0. 0. 0. 0. 0. 0. 0. 0. 0.
17   0. 0. 0. 0. 0. 0. 0. 0. 0l 0. 0. 0. 0. 0. 0. 0.
```

Row `05` column `04` is hex `0405` (`2l`: level 2, light woods). Expected counts (the test asserts them): 272 hexes;
levels 0/1/2/3 = 170/37/44/21; light woods 19, heavy woods 4, rough 9, water 5 (one depth 2 at `0809`); every hex is
reachable from `0101` when a step may change at most 2 levels (water allowed); exactly 3 hex pairs differ by 3 levels
(cliffs).

## 8. Themes (`src/client/board/boards.ts`)

| Theme | Level colour ramp (0, 1, 2, 3, 4+) | Woods foliage | Water tint | Light / fog |
|---|---|---|---|---|
| `desert` | `#c9a66b`, `#b88d55`, `#a2733f`, `#8a5c30`, `#714a27` | `#6f7a3a` | `#3d6f7a` | warm sun `#ffe2b0`, fog `#d8c09a` far 60 |
| `grasslands` | `#6f8f4a`, `#7d8c4c`, `#8a7f4f`, `#7a6a45`, `#665a3d` | `#3f6b2e` | `#2f5f80` | neutral sun `#fff4e0`, fog `#a9b8a0` far 60 |

Rough tint: level colour × 0.85 with rock instances `#7a6f62`. Negative levels use ramp[0] × 0.8.

## 9. Tests (lean)

1. `test-canyons` loads; counts match §7; connectivity holds.
2. Validation rejects: a key outside 16 × 17, `lightWoods` + `water` on one hex, an unknown key, a reserved type (`UNSUPPORTED_TERRAIN`), a `road` exit whose neighbour has no matching exit; accepts `road` and `pavement`.
3. Hex math worked check (§3) passes against the engine's `hex.ts`.
4. Converter: a 3-line fixture `.board` written inside the test (our own made-up hexes) maps tokens per §6.2.
5. Composite: a `rotate180` sheet maps local `0101` → `1617` and flips road exits (`f` → `(f + 3) % 6`).
