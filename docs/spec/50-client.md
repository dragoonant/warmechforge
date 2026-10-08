# 50: Client

React 19 + @react-three/fiber 9 + drei + zustand, built with Vite. The client never mutates `GameState` and never
computes a rules number. Every target number, odds value, modifier, MP cost, reach set, arc, LOS verdict, heat
projection and damage figure comes from the engine (`query.*`, `pending.context`, or an event payload). The client is
generic over forces from day one: no 'Mech, variant, side or seat literals outside `src/data/`. Colours follow the
force, not the seat.

Milestone tags: **[M3]** must exist in the vertical slice; **[M4+]** later (named milestone). Untagged = M3.

Sibling templates: Whirr Machine `src/client/` (same folder names) and its `docs/spec/50-client.md`. Copy patterns,
never Warmachine rules.

## 1. Modules and files

```
src/client/
  App.tsx              start screen in the main chunk; GameScreen via React.lazy (code split)
  GameScreen.tsx       Canvas + HUD layout (§12)
  contract.ts          FROZEN client contract: the only import surface for board/ui/figures (Whirr pattern)
  store/
    gameStore.ts       GameRunner: the ONLY caller of engine.step; true state, pending, event ring buffer (2 000)
    uiStore.ts         selection, hover, tool modes, plan drafts (move/fire), rail collapse
    settingsStore.ts   §14, persisted
    storage.ts         autosave and saves (§15)
    testHooks.ts       window.__game and URL setup (§16)
  presentation/
    director.ts        event batches -> timed beats; skip; idle flag
    beats.ts           beat types, easing, durations
    presentedStore.ts  state as of the animation cursor; tweens; damage pops; shown rolls
    announceStore.ts   phase/turn banners and narration queue
    labels.ts          our words for mod codes, roll purposes, locations, phases, terrain (one table each)
  board/
    Board.tsx          composes the layers below
    hexWorld.ts        hex <-> world mapping (wraps engine hex.ts; no rules math of its own)
    HexTerrain.tsx     one merged static mesh: terraced prisms, vertex colours (§4)
    Water.tsx          transparent depth-tinted surfaces
    Woods.tsx          instanced tree clumps (procedural in M3, GLB in M5)
    Rough.tsx          instanced rock scatter
    HexGrid.tsx        hex-line overlay (toggle G)
    HexLabels.tsx      XXYY label atlas (instanced quads)
    HexTooltip.tsx     hover card from query.terrainInfo
    boards.ts          theme table (ground colours, light, fog) per map theme
    Lights.tsx, Camera.tsx, boardPick.ts (ray -> hex), FpsMeter.tsx, frameRate.ts
  overlays/
    HexFill.tsx        shared InstancedMesh of flat hex fills (per-instance colour/opacity); every overlay uses it
    ReachOverlay.tsx   walk/run/jump reach (§6)
    PathPreview.tsx    step dots, MP labels, facing ticks, PSR flags
    FacingPicker.tsx   six arrows around the chosen hex
    ArcOverlay.tsx     front/left/right/rear arcs, torso-twist preview
    LosLines.tsx       LOS lines + reason chips
    RangeRings.tsx     per-weapon range bands
    Ruler.tsx          hex count + range band
    ThreatOverlay.tsx  [M4+] enemy reach next turn
  figures/             see 30-figures
  interaction/
    controller.ts      routes pending.kind -> controller; camera input never starts an action
    moveController.ts, fireController.ts, physicalController.ts
    keys.ts            keyboard map (§13); ray.ts
  ui/
    TopBar.tsx         turn, phase, initiative strip, tool buttons, settings, paint
    UnitRoster.tsx     left rail: both forces, mini status
    EventFeed.tsx      feedView.ts
    Prompt.tsx         promptView.ts (§8)
    MovePanel.tsx      moveView.ts
    FirePanel.tsx      fireView.ts
    PhysicalPanel.tsx  physicalView.ts
    sheet/             RecordSheet.tsx, PaperDoll.tsx, WeaponsTable.tsx, CritSlots.tsx, AmmoBins.tsx,
                       MpBlock.tsx, PilotBox.tsx, sheetView.ts (§10)
    HeatScale.tsx      heatView.ts (§11)
    GameOver.tsx, StartScreen.tsx, SettingsPopover.tsx, FanNotice.tsx, format.ts, hud.css
  dice/                DiceTray.tsx, DiceLog.tsx, diceView.ts, trayStore.ts (§9)
  vfx/                 pooled: muzzle, beam, bolt, missile trail, tracer, impact sparks, smoke, fireball, jump jets
  bot/                 botDriver.ts (M3 random bot on main thread), aiWorkerClient.ts [M4] (src/ai/worker.ts)
  audio/               [M6] copy Whirr's
```

`*View.ts` files are pure functions (state + engine queries -> view model) with unit tests; `*.tsx` only renders.

## 2. What the client reads from the engine

Names below are the client's expectations. `00-architecture` is authoritative: if a name differs there, map it inside
`contract.ts` and log nothing else. If a needed query is missing, return it in `issues` (additive contract change).

| Need | Source | Used by |
|---|---|---|
| Advance the game | `step(state, action) -> {state, events, rejection?}` | `gameStore` only |
| Open decision | `state.pending: {kind, player, unitId?, context}`; `legalActions(state)` never empty | prompts, controllers, bot |
| Reach set | `query.reachable(state, unitId)` -> entries per `(hex, facing, mode)` with `mpSpent`, `path[]` (hex + facing per step + cost parts), `psr[]` reason codes, `heat`, `tmm`, `attackerMod`, ready `action` | §6 |
| Arcs | `query.arcs(state, unitId, twist)` -> hex sets `front/left/right/rear` (+ which weapon locations each arc serves) | §7 |
| LOS | `query.los(state, from, to)` -> `{canSee, attackAllowed, hexes[], reasons[{code, hex?, value?}], divided?}` | §7 |
| Ranged preview | `query.attackPreview(state, attackerId, plan)` -> per weapon `{legal, why?, targetId, distance, band, tn, odds, mods[{code,value}], heat, damage, cluster?}` + `heat {now, move, weapons, sinks, end, effects[]}` | §7, prompts |
| Physical preview | `query.physicalPreview(state, attackerId, targetId)` -> per option `{legal, why?, tn, odds, mods[], damage, risk}` | §7.6 |
| Heat scale | `query.heatScale()` -> `[{level, effects[{code, value}]}]` and the unit's current/projected level | §11 |
| Record sheet | `query.sheet(state, unitId)` -> locations (armor/internal current+max, rear), slots, weapons, ammo, MP base/current, sinks, pilot hits, consciousness TNs | §10 |
| Terrain | `query.terrainInfo(state, hex)` -> `{label, level, terrain[], depth?, moveCost{walk,run,jump}, losEffect}` | tooltip |
| Distance | `query.distance(a, b)` | ruler |
| Threat [M4+] | `query.threat(state, hex)` | threat view |
| Event text | event payloads carry every number (TN, roll, location, armor before/after, crits) | feed, tray |

Odds are 2d6 "roll ≥ TN" probabilities from the engine. The client only formats: integer percent; `TN ≤ 2` shows
`auto`, `TN ≥ 13` shows `impossible`; never print 0% or 100% otherwise.

## 3. Game store, presentation director, presented store

- `gameStore` (GameRunner) holds the true state, pending decision, last rejection and the event ring buffer. It is the
  only module that imports `step`. UI code dispatches through `contract.ts` (`game.dispatch(action)`), never builds
  rules actions from scratch: move/fire/physical actions are taken from engine-provided entries and only filled with
  engine-provided ids.
- `director` turns each event batch into beats. Durations at speed 1 (scaled by `speed`):

| Beat | Duration |
|---|---|
| Turn banner | 1 600 ms |
| Phase banner (Initiative, Movement, Ranged Attack, Physical Attack, Heat, End) | 2 400 ms |
| Initiative roll | 900 ms |
| Move tween | 180 ms per hex, 90 ms per hexside turn; jump: 500 ms + 60 ms per hex |
| Torso twist / arm flip | 250 ms |
| Weapon fire (VFX + to-hit dice) | 700 ms per weapon |
| Hit location + damage pop + bar drain | 600 ms per hit group |
| Cluster roll | 500 ms |
| Crit check / crit slot | 600 ms each |
| PSR / consciousness / avoid roll | 800 ms |
| Fall (tip over) | 500 ms |
| Ammo explosion | 1 200 ms |
| Heat phase (bars animate per unit) | 700 ms per unit |
| Destroyed | 1 200 ms |

- Any left click or Space skips the current beat; `Esc` while animating skips the whole batch (`skipAll`).
- `presentedStore` holds the state **as of the animation cursor**. Everything on screen renders from it; a panel never
  shows a number before its beat plays.
- Human prompts open only when `presentedIdle`. The bot answers only when idle; a 5 s no-progress watchdog
  force-answers bot-owned decisions.
- Narration line per beat (announceStore), for example `Eris walks to 0608 (5 MP), facing SE.` Narration on/off
  is a setting.

## 4. Board rendering

Hex math is the engine's (`00-architecture`, summary in `70-maps` §3); `hexWorld.ts` only converts engine hex ->
world `(x, z)` and level -> `y = level * LEVEL_HEIGHT`. Flat-topped hexes, 1 world unit flat-to-flat, board centred at
the origin, north = −z.

| Layer | Build | Notes |
|---|---|---|
| Terrain | one merged `BufferGeometry` per map: each hex a hexagonal prism from `y = −0.1` to its level, top cap inset 0.02 for a visible seam; vertex colours | 1 draw call. Rebuilt only when the map changes. |
| Level colour | top colour from `boards.ts` theme ramp indexed by level (clamp at ramp end); side faces 35% darker | terraced look; sloped look [M7] optional |
| Depressions | levels below 0 go down to `level * LEVEL_HEIGHT`; prism base at `min(level) − 0.1` | |
| Water | seabed prism at `(level − depth)`; transparent surface plane at `level` (opacity 0.55 depth 1, 0.7 depth 2, 0.8 depth 3+), tint deepens per depth | Low: opaque tinted cap |
| Woods | M3: instanced procedural clumps (cone + cylinder). Light: 3 trees per hex; heavy: 6 trees. Tree height ≤ 0.55 × the smallest figure height on the board (below shoulders). Positions from a hash of the hex label (stable) | fade to 0.3 opacity within 1 hex of the selected or hovered 'Mech and along the active LOS line |
| Rough | 4–7 instanced low rocks (dodecahedron, radius 0.05–0.1) per hex, hash-placed | |
| Grid lines | `LineSegments` of every hex edge at its top, 1 px, theme `gridColor`, opacity 0.35 | toggle `G`; default on |
| Labels | XXYY drawn into one CanvasTexture atlas (2048²), one instanced quad per hex at the top cap's north edge | setting: hover / always / off; default hover |
| Partial hexes | not drawn | map edges get a thin dark frame |
| Ground mat | M5: textured top caps from Whirr's `art/board-textures/gen.py` (Poly Haven CC0, credited) | M3 uses vertex colours |

Hover tooltip (`HexTooltip`): `0507 · Level 1 · Light woods · Walk 3 MP` (label, terrain and costs from
`query.terrainInfo`). Lighting: ambient + hemisphere fill + one directional sun with on-demand 1024 shadows
(`markShadowsDirty`); theme sets light and fog tint.

## 5. Camera and selection

- drei `OrbitControls`: right-drag orbits, middle-drag or WASD pans, wheel zooms (distance 3–30), polar angle 15°–80°,
  pan clamped to the board bounds + 2 hexes. Left click is reserved for the board.
- Right/middle click, Alt and Space never start a model action. No auto-camera while the human drags.
- Presets (≤ 600 ms eased): `1` top-down, `2` own home edge at 55°, `3` follow active unit, `0` overview. At the start
  of a human decision the camera eases to the active unit only if it is off screen.
- Selection: left click a 'Mech selects it (right rail shows its sheet); hover shows a compact card. `Tab` cycles own
  units, `Shift+Tab` enemy units, `Esc` clears the draft then the selection. During a fire or physical decision a
  click on an enemy sets it as the target instead of selecting it.
- Rings under figures: selected gold, active unit pulsing gold, current target red, hovered white 50%.

## 6. Movement UI

Opens when `pending.kind` is the movement decision for a human-owned unit.

1. **Mode row** (`MovePanel`): `Stand still`, `Walk`, `Run`, `Jump` (only modes present in the reach set), `Stand up`
   when prone. Default `Walk`. Each button shows MP from the sheet, e.g. `Run 8`.
2. **Reach highlights** from `query.reachable`: walk-reachable hexes green `#3fae5a`, run-only amber `#d99a1e`,
   jump blue `#3d7fd9` (opacity 0.35). With Walk selected, run-only hexes show as amber outlines (hint); with Run,
   walk hexes stay green and run-only ones amber; Jump shows blue only. A hex is reachable if any facing is.
3. **Path preview**: hovering a reachable hex shows the cheapest path for the selected mode (engine-provided): a dot per
   step with cumulative MP, a tick per hexside turn, and cost chips where a step costs more than 1 (`+1 woods`,
   `+2 level`, from the engine's cost parts). PSR flags show as a warning icon with the reason (`Run into water: PSR`).
   Jump shows an arc line instead of steps.
4. **Facing choice**: clicking the hex locks it and opens `FacingPicker`: six arrows on the hexsides. An arrow is
   enabled only if `(hex, facing, mode)` is in the reach set; it shows its MP total. Hover previews the figure ghost;
   `Q`/`E` rotate through enabled facings; click or `Enter` picks.
5. **Result strip**: `Walk 0608 · 5/5 MP · target modifier +2 · you +1 to-hit · +1 heat`. All four numbers from the
   reach entry.
6. **Commit**: `Confirm move` (`Enter`) dispatches the entry's action. `Reset` (`Backspace`) clears. Stand still is one
   click.
8. **Charge and DFA** (declared with the move, PHYS-040/060): a reach entry whose `physical` field is set ends adjacent to
   a target (walk or run: charge; jump: DFA). In Walk/Run mode, and in Jump mode, the target enemy's hex gets a red
   ring and a choice chip pair on that hex: `Move here` (the ordinary entry, no attack) and `Charge <name>` or
   `DFA <name>`. Choosing the attack chip shows, in the result strip, the `physicalPreview` of the entry: TN, odds, damage
   dealt, damage taken and the target PSR (`Charge Rakshasa · TN 7 (58%) · 20 dmg, you take 8 · both PSR +2`). The facing
   picker and `Confirm move` then work as usual; the dispatched action is the entry's ready `action` (the engine's
   `MoveAction.attack`), never composed by the client. Entries with a charge/DFA are listed only where the engine says
   the attack is legal; a prone target never offers the chip. After commit, the unit shows a `Charge`/`DFA` tag until
   resolved (§7.6).
9. Edge cases: a unit with no reachable hex still gets `Stand still`; immobile units never get the movement prompt
   (engine); a prone unit's `Stand up` shows the PSR odds before committing; backward moves are reach entries like any
   other (the path preview marks backward steps with a reversed arrow).

## 7. Firing UI

Opens when `pending.kind` is the ranged attack declaration for a human-owned unit (the phase is the **Ranged Attack
Phase**; never say "weapon attack phase").

1. **Arcs** (`ArcOverlay`): tint front (none, only an outline), left/right side (blue-grey 0.15), rear (red 0.15) from
   `query.arcs` for the current twist. Twist buttons `◀ Twist`, `Centre`, `Twist ▶` (keys `,` and `.`), arm flip when
   the engine offers it. Changing twist re-queries arcs and the preview.
2. **Target**: click an enemy (or its roster row). LOS line from the attacker's hex to the target's hex:
   green = clear, amber = clear with modifiers, red = no attack. Reason chips along the line at the hex they come
   from, text from `labels.ts` by code: `light woods +1`, `heavy woods +2`, `partial cover`, `blocked: woods total 3`,
   `blocked: level 2 hill`, `across the water line: no attack`, `divided line: defender's choice`.
3. **Weapons list** (`FirePanel`), one row per weapon:
   `☑ ER PPC (RA) · 8 hexes medium · TN 9 · 28% · +15 heat · 10 dmg`. Illegal rows are unchecked and disabled with the
   engine's reason (`out of arc`, `out of range (max 23)`, `inside minimum range` shown as a mod not a block,
   `destroyed`, `no ammo`, `no line of sight`). Hover/expand shows the breakdown: every mod with its label and value,
   summed to the TN.
4. **Per-weapon target**: a small target dropdown per row when more than one enemy is legal; the engine marks the
   primary and returns secondary-target mods.
5. **Live heat total** (always visible above the list): `Heat now 4 + moved 1 + weapons 23 − sinks 10 = 18`, then the
   effects crossed at the end value from `heat.effects`, e.g. `18: −3 MP, +3 to-hit, shutdown avoid 6+`. The ammo-explosion check starts at 19 (HEAT-024); from 19 the line adds `ammo avoid 4+`.
   Turns red when shutdown or ammo explosion becomes possible. The heat scale panel (§11) shows the projected marker.
6. **Physical attacks** (`PhysicalPanel`, Physical Attack Phase; opens on `declarePhysical`). Release-1 options are
   **punch (L/R), kick and push only**; there is no club row (clubs and physical weapons are reserved, PHYS-015).
   Charge and DFA are declared in the Movement Phase (PHYS-040, PHYS-060; see §6 item 8) and never appear as options here.
   - One row per option from `query.physicalPreview` with TN, odds, damage and the risk line (`miss: you make a PSR`);
     illegal rows are disabled with the engine reason (`E_LEVEL_DIFF`, `E_LIMB_UNAVAILABLE`, ...). Kick TN uses −1 (PHYS-011).
   - **Pending charge or DFA**: if the unit declared one and it is still valid, the panel shows a locked read-only row
     (`Charge Rakshasa · TN 7 · 20 dmg · resolves with the other attacks`) and no decision is requested (the engine
     resolves it without a prompt).
   - **`chargeVoided`**: when the decision carries `data.code 'chargeVoided'` (PHYS-042: the target fell, was destroyed
     or displaced), show the banner `Your charge on <target> is void: choose another attack` above the normal rows,
     which re-list for any legal target; `None` stays available.
7. **Commit**: `Fire` (`Enter`) dispatches the declaration; `Hold fire` dispatches the empty declaration. An aimed
   shot location picker (doll click) appears only if the engine lists aimed options.
8. **Range rings**: hovering a weapon row draws its bands as hex fills around the attacker (short green, medium amber,
   long red, minimum-range hexes hatched). `R` toggles rings for all checked weapons.

## 8. Prompts that explain themselves

Every prompt names the actor, the target and the exact numbers (all from the engine). Prompts dock bottom-centre,
never cover the dice tray, and support `Enter` (default option) and `Esc` (pass/cancel when allowed). Example texts
(illustrative numbers; the arithmetic must always add up):

| Decision | Example text |
|---|---|
| Choose mover | `Your move: pick 1 of 2 'Mechs to move (you lost initiative 6 vs 9).` |
| Ranged attack | `Fire ER PPC at Rakshasa? TN 9 (Gunnery 4, medium range +2, you walked +1, it moved 5 hexes +2) = 28%. +15 heat → you end at 9 after sinks.` |
| Fire all | `Fire 4 weapons at Solitaire? Expected hits 1.9. You end at 14 heat: +2 to-hit next turn, shutdown avoid 4+.` |
| Aimed shot | `Aim at Rakshasa's head? It is immobile: roll 1d6, 4+ hits the head (50%); otherwise normal location.` |
| Physical | `Kick Solitaire? TN 8 (Piloting 5, kick −1, it ran 6 hexes +2, you walked +1, light woods +1) = 42%. 10 damage on the kick table; miss: you make a PSR.` |
| Stand up | `Uziel is prone. Stand up? PSR TN 4 (Piloting 5, standing −1) = 92%. Fail: fall again.` |
| Hold fire | `Hold fire with Eris? No heat added; you end at 2.` |

Rules for prompt text: actor first, the verb, the target, `TN n (mods)`, `= p%`, then the consequence (heat end
level, damage, risk). Mods appear in the engine's order. Labels come from `labels.ts` only.

## 9. Dice tray and log

- Right rail under the heat panel; never behind a prompt. Every `DiceRolled.purpose` routes here.
- `diceView.ts` exports `PURPOSE_RENDERERS: Record<RollPurpose, (ctx) => Verdict>`. A missing purpose fails typecheck;
  a unit test also asserts every purpose in the engine's list has a renderer. Unknown purposes at runtime render
  generically (`roll 7`), never silently.
- Expected purposes (the engine's union wins; extra ones need a renderer):

| Purpose | Dice | Verdict word |
|---|---|---|
| initiative | 2d6 | `7` + `wins` / `loses` (re-roll on tie shown as history) |
| toHit | 2d6 | `HIT` / `MISS` vs TN |
| hitLocation | 2d6 | location name; `2` marks `possible crit` when the engine flags it |
| cluster | 2d6 | `6 of 10 hit` |
| aimedShot | 1d6 | `on target` / `off: roll location` |
| punchLocation, kickLocation | 1d6 | location name |
| critCheck | 2d6 | `no crit` / `1 crit` / `2 crits` / `3 crits` / `limb blown off` (engine result) |
| critSlot | 1d6 (+1d6) | `slot 4: Medium Laser` |
| psr | 2d6 | `PASS` / `FAIL: falls` |
| fallLocation | 2d6 | location name |
| consciousness | 2d6 | `awake` / `unconscious` |
| shutdownAvoid | 2d6 | `avoided` / `shuts down` |
| startup | 2d6 | `restarts` / `stays down` |
| ammoExplosionAvoid | 2d6 | `avoided` / `explodes` |
| physicalToHit | 2d6 | `HIT` / `MISS` |

- Each roll shows: dice faces, purpose label, actor → target, the mods (hover), total vs TN (TN from the event, never
  recomputed) and the verdict. `data-testid="tray-roll-<rollId>"`, `data-purpose`, `data-total`, `data-tn`.
- The dice log keeps the whole game; clicking a row scrolls the event feed to its entry.

## 10. Record sheet panel (our own layout)

Right rail, for the selected unit (hover shows the compact card instead). Never copy Catalyst's sheet layout: ours is
a vertical card with collapsible sections, dark theme.

1. **Header**: `<Chassis> <Model> · <tons> t · BV <bv> · <pilot> (G4/P5)` (all from the sheet query); force colour stripe.
2. **MP block**: `Walk 6 · Run 9 · Jump 6`; reduced values show `5 (6)` in amber with a hover trace (heat −1, hip
   crit, etc. from the engine).
3. **Paper doll**: our own simplified silhouette, 8 front locations (HD, CT, LT, RT, LA, RA, LL, RL) and a separate rear
   strip (CT-R, LT-R, RT-R). Each cell: outer ring = armor, inner fill = internal structure; fill fraction = current /
   max; colours: full grey-blue, damaged amber, internal exposed red, destroyed black with a cross. Numbers on hover
   (`LT 9/16 armor · 8/12 internal`). The last-hit cell flashes for the beat.
4. **Weapons table**: name, location, heat, damage, min, short/medium/long (hexes), ammo left. Destroyed weapons struck
   through; weapons in a destroyed location greyed.
5. **Critical slots**: per location 6 or 12 rows; hit slots struck through with a red tick; empty slots dim; ammo slots
   show `AC/10 Ammo (10)` with current shots.
6. **Heat sinks**: `10 double (20) · 1 destroyed`; dissipation from the engine.
7. **Pilot**: six hit boxes; under each box its consciousness TN from the engine; status `awake/unconscious/killed`.
8. Status chips: `prone`, `shutdown`, `immobile`, `jumped`, `twisted right`.

`data-testid`: `sheet-root-<unitId>`, `sheet-loc-<LOC>` (`data-armor`, `data-internal`, `data-destroyed`),
`sheet-rear-<LOC>`, `sheet-weapon-<weaponId>`, `sheet-crit-<LOC>-<slot>` (`data-hit`), `sheet-pilot-hit-<n>`,
`sheet-mp-walk|run|jump`.

## 11. Heat scale panel

- Vertical thermometer 0 to the engine's max level, one tick per level. Threshold rows (from `query.heatScale()`) show
  short effect chips in our words (`−1 MP`, `+1 to-hit`, `shutdown 4+`, `ammo 4+`, `pilot hit 6+` style; exact values
  from the engine).
- Markers: current level (solid), projected end-of-turn level during a move or fire plan (ghost arrow with the sum
  `4 + 1 + 23 − 10`). During the Heat phase beat the marker animates from old to new.
- Colours: 0–4 grey, 5–9 amber, 10–19 orange, 20+ heat red `#d9412b`.
- `data-testid="heat-level"` (`data-level`, `data-projected`).

## 12. Layout

- Top bar: `Turn 3 · Ranged Attack Phase`, initiative strip (who won, the order of remaining declarations), tool
  buttons (Ruler `M`, LOS `L`, Threat `T` [M4+], Grid `G`), Paint [M5], Settings, Help.
- Left rail: unit roster (both forces; per unit name, armor %, heat, status icons; click selects), event feed below.
- Right rail: record sheet, heat scale, dice tray + log. Rails collapse with `[` and `]`.
- Bottom centre: the active panel (Move / Fire / Physical) or a prompt.
- Theme: `--bg:#14161a; --fg:#e8e6e1; --card:#1e2127; --accent:#c9a227; --accent2:#e08a1e` (hazard amber);
  `--heat:#d9412b`.
- The fan notice (not affiliated with Catalyst Game Labs, Topps or Microsoft; free, non-commercial) is on the start
  screen footer and in Settings. The title is WarMechForge; no BattleTech logo.

## 13. Event feed and keys

- One entry per meaningful event, newest at the bottom, expandable breakdown. Examples:
  - `Eris → Rakshasa: Medium Laser TN 8 rolled 9 HIT · RT 12→7 armor`
  - `LRM 10: cluster 7 → 6 hits · 5+1 · LA 8→3, CT 20→19`
  - `Crit check RT: rolled 9 → 1 crit · slot 3: AC/10 Ammo · ammo explodes · RT internal 10→0, transfers to CT`
  - `Rakshasa PSR (gyro +2): TN 7 rolled 5 FAIL · falls · 3 damage`
  - `Heat: Eris 18 → 8 (−10)`
  Expanded rows show every mod, armor/internal before → after, transfers (`LA destroyed, 4 transfers to LT`) and crits.
- `data-testid="feed-entry-<seq>"`.
- Keys: `Enter` confirm, `Esc` cancel/skip, `Space` skip beat, `Q`/`E` facing, `,`/`.` twist, `M` `L` `T` `G` `R`
  tools, `1 2 3 0` camera, `Tab`/`Shift+Tab` cycle units, `[` `]` rails. Keys never fire while a text input is focused.

## 14. Settings (`wmf.settings`, localStorage, wrapped in try/catch)

| Setting | Values | Default |
|---|---|---|
| Animation speed | 0.5 / 1 / 2 / 4 / instant | 1 |
| Graphics | Low / High (Low: dpr 1, no shadows, particles become icons, opaque water, simple trees) | High |
| Narration | on / off | on |
| Tips | on / off | on |
| Hex labels | hover / always / off | hover |
| Grid lines | on / off | on |
| Odds format | `%` / `TN only` | `%` |
| Audio volumes [M6] | master, sfx, music | |

Performance: `<Canvas frameloop="demand">`, `invalidate()` from every animator and camera input, `dpr={[1, 1.5]}`,
shared geometries/materials, instancing for terrain props; triangles dominate cost.

## 15. Autosave, start screen, end screen

- Autosave after each End phase to `wmf.autosave` = `{version, savedAt, summary {turn, scenario, map, forces}, save}`,
  where `save` is whatever the engine's save format is (seed + action log). On the start screen, `Continue` appears
  only if the version matches; a load failure deletes the slot and shows a toast.
- Start screen: scenario (M3: the intro mission only), map (fixed by scenario in M3), control per force (Human / Bot),
  seed (optional), Paint [M5], Settings, fan notice. `data-testid`: `start-new`, `start-continue`,
  `start-control-<forceId>-<human|bot>`, `start-go`.
- End screen (`GameOver`): cause (`all enemy 'Mechs destroyed`, `forced withdrawal`, `objective`, `turn limit`), per
  force: damage dealt, damage taken, 'Mechs destroyed/crippled, heat peak; buttons `Play again` (same setup, new seed),
  `Back to start`. `data-testid`: `end-cause`, `end-play-again`, `end-back`.

## 16. Test hooks

| Hook | Contract |
|---|---|
| `?test=1` | exposes `window.__game = {state(), presented(), pending(), legal(), dispatch(action), skipAll(), speed(n), presentedIdle(), seed, load(save), hexToScreen(label)}`. `hexToScreen` returns page pixels of a hex centre (for E2E clicks). |
| `?scenario=<id>&forces=<a,b>&control=bot,bot&seed=<n>&map=<id>` | skips the start screen |
| `?gallery` | figure gallery (`30-figures` §8) |
| `?fps` | frame meter |
| `?debug=los` | with `?test=1`: LOS reason chips on every check |
| DOM proxies | invisible `<div data-testid="mech-<unitId>" data-hex="0507" data-facing="2" data-twist="0" data-prone data-shutdown data-heat data-destroyed>` per unit, from the presented store |

- `data-testid` = `<area>-<element>[-<id>]`: `move-mode-walk`, `move-facing-3`, `move-confirm`, `fire-weapon-<weaponId>`,
  `fire-target-<unitId>`, `fire-confirm`, `fire-hold`, `fire-heat-total`, `phys-option-<kind>`, `prompt-<kind>-<option>`,
  `topbar-phase`, `topbar-turn`, `roster-unit-<unitId>`.
- E2E clicks the real UI only (shared click policy `tests/e2e/policy.ts`); `window.__game` is for reading state and
  fast-forwarding. Picks match exact text or testid, never substrings (`Mad Cat Mk II` vs a future `Mad Cat`).

## 17. Tests (lean)

1. `diceView`: every engine roll purpose has a renderer.
2. `promptView`: ranged prompt text lists mods in engine order and the sum equals the TN.
3. `moveView`: reach colours (walk/run/jump) from a fixture reach set; facing arrows enabled only for listed facings.
4. `fireView`: heat total string equals the engine's projection parts.
5. `sheetView`: doll fills from a fixture sheet; destroyed location flagged.
6. `hexWorld`: `0101` and `1617` map to opposite corners; centre hex near the origin.
7. `labels`: every mod code and location code the engine exports has a label.
8. Director: presented state never runs ahead of the beat cursor; `skipAll` reaches the true state.
