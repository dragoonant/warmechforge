# 30: Figures

How 'Mechs look on the board. Rules never read meshes: position, facing, twist, LOS height (a 'Mech is two levels
tall) and damage come from engine state. Pipeline detail lives in the brief, Part D.3; this file is the game-side
contract. Folder: `src/client/figures/`: `rig.ts` (the node contract: procedural and GLB builders, posing, status),
`Figure.tsx` (one 'Mech on the table), `UnitsLayer.tsx` (all figures + VFX + pops + interaction), `unitFrame.ts` (position,
height and tween pose from the presented state), `visuals.ts` (state -> look), `sockets.ts` (muzzle and wound points),
`facing.ts`, `figureConstants.ts`, `profile.ts` (chassis, weight class, style), `glbLoader.ts`, `glbModels.ts`, `glbPaint.ts`,
`paintStore.ts`, `worldLabels.tsx` (DOM labels without a React root per label), `Gallery.tsx`. The loader, model map and
painter are copied from Whirr Machine and adapted.

## 1. Style and proportions

| Aspect | Rule |
|---|---|
| Proportion sentence (put verbatim in every concept prompt) | "mildly stylized heroic proportions, about 4–5 heads tall; cockpit and torso slightly enlarged, legs slightly shortened and sturdy, weapons slightly oversized; high surface detail like a premium painted tabletop miniature; keep the exact silhouette, weapon placement and panelling of the real sculpt." |
| Banned prompt words | `MGSD`, `SD`, `super deformed`, `chibi`, `Gundam`, `mecha kit` |
| No styling of that kind | no V-fins, no face plates with eyes or visors of that style, no tricolour blocking |
| Fidelity | each figure is a generated version of the real Core Box sculpt: same silhouette, weapon count and placement for the variant |
| Markings | original only: plain two-tone camo the army painter can recolour; no Catalyst or faction insignia, unit logos, decals or text |
| Base | plain black round base (§2) |

**Owner gate (M3).** Two 'Mechs (one light, one assault, e.g. Solitaire and Regent) go through the full pipeline and
are shown side by side in `?gallery` with the procedural kit. The owner approves the exact ratio before any other
figure is generated.

| Gate field | Value |
|---|---|
| Approved head-to-height ratio | **TBD (M3 owner gate)** |
| Approved light : assault height ratio | **TBD (M3 owner gate)**; proposal in §2 |
| Approved split approach (hip/shoulder nodes vs scorch fallback) | **TBD (M3 owner gate)** |
| Date / approver | TBD |

## 2. Sizes (world units; 1 = one hex flat-to-flat)

Constants live in `src/client/figures/figureConstants.ts` (client only; `LEVEL_HEIGHT` itself is the engine/board
constant from `00-architecture`). **Heights are measured from the top of the base disc to the highest point**, which is how
the generated GLBs are built (Solitaire 0.75, Regent 1.00; the base disc is 0.12 thick and part of the GLB).

| Constant | Value | Notes |
|---|---|---|
| `BASE_THICKNESS` | 0.12 | the disc under every figure (GLB and procedural) |
| `HEIGHT_BY_CLASS` | light 0.75, medium 0.833, heavy 0.917, assault 1.00 | proposal for the owner gate: light : assault = 0.75 : 1.00, evenly spaced between |
| Weight class | from the unit's tonnage in data: light 20-35 t, medium 40-55 t, heavy 60-75 t, assault 80-100 t | never a per-'Mech literal |
| `BASE_RADIUS_BY_CLASS` | light 0.394, medium 0.41, heavy 0.42, assault 0.433 | the GLB discs are 0.394 and 0.433; all fit inside the hex's inscribed circle (0.5) |
| force rim | thin ring at the disc's edge, force colour | |
| `TREE_MAX_HEIGHT` | 0.55 x the smallest figure height (0.41) | woods stay below shoulders (`50-client` section 4) |

Figures are deliberately a little taller than `2 x LEVEL_HEIGHT` (0.70) so they read at board zoom; the LOS view
(`50-client` section 7) draws the rules column (two levels) as a faint ghost so players are not misled. Root origin: the hex
top (`level x LEVEL_HEIGHT`, from the engine's terrain level).

## 3. Node contract (shared by procedural and GLB figures)

Frame: origin at the hex top, y up, **front = +z, the figure's left = +x** (the GLBs are authored this way). `Figure.tsx`
animates only these nodes (all built by `rig.ts`; a test checks both builders).

| Node | Parent | Pivot | Driven by |
|---|---|---|---|
| `root` | figure group | hex top | `rotation.y = pi - facing x pi/3` (facing 0 = north = -z; clockwise), position from the tween |
| `base` | `root` | origin | stays flat when the figure tips; the force rim ring and facing arrow sit beside it |
| `body` (ours) | `root` | origin | prone tilt about the forward axis (z, 1.4 rad) with a lift so the side clears the table; bob |
| `lower` | `body` | origin | legs, pelvis; walk bob |
| `upper` | `body` | **the hip** (GLB: x 0, y = top of the legs, 0.59 light / 0.685 assault) | `rotation.y = -twist x pi/3` (twist -1, 0, +1; +1 = clockwise = right, continuous mid-tween); shutdown slump `rotation.x = +0.25`; wreck tilt 0.6 |
| `armL` | `upper` | the shoulder (x +, the figure's left) | hidden when LA (or LT) is destroyed; arm flip `rotation.y = pi` (arms turn to the rear arc) |
| `armR` | `upper` | the shoulder (x -) | hidden when RA (or RT) is destroyed; flip `-pi` |
| optional (procedural only) `head`, `torsoC`, `torsoL`, `torsoR`, `legL`, `legR` | `upper` / `lower` | part centre / hip | per-location tint, hide (head, side torsos), canopy emissive, leg swing while walking |
| `jets`, `facingArrow`, `rim` (ours) | `root` | feet / front edge / disc edge | jump-jet cones while airborne; force-colour arrow on the base pointing forward; rim colour |

The GLB nodes are exactly `base`, `lower`, `upper`, `armL`, `armR` (armL and armR are children of `upper`). `buildGlbRig`
reports `capabilities = {twist, armLoss}`: no `upper` means no twist; no arms means arm loss is shown by darkening only.
Locations fold onto nodes that exist: `HD, CT, LT, RT` -> `head / torsoC / torsoL / torsoR` else `upper`; `LA, RA` -> `armL, armR`;
`LL, RL` -> `legL, legR` else `lower`. Rear-armour hits use the same node.

Facing maths (`facing.ts`): `yawForFacing(f) = pi - f x pi/3`; `frontVector` and `rotateLocal` are used by sockets and VFX. Arm flip
is `rotation.y` (not `x`): turning the arm about the shoulder's vertical axis points it backwards.

## 4. Procedural kit (M3 placeholder and permanent fallback)

Built by `buildProceduralRig` from one shared box / cylinder / cone geometry per type, scaled per part. Materials are cloned
**per figure and per node** (a handful of small materials) so heat glow and per-location damage tint stay per unit.
Budget <= 600 triangles per figure (a test counts them). `H` = figure height above the base for its class; x left is +, z front is +.
The table below is in units of `H` from the base top.

| Part | Geometry | Size (w x h x d, in H) | Placement (centre, in H) |
|---|---|---|---|
| Foot | box | 0.18 x 0.05 x 0.26 | (+-0.12, 0.025, +0.03) |
| Shin | box | 0.16 x 0.20 x 0.18 | (+-0.12, 0.15, 0) |
| Thigh | box | 0.14 x 0.20 x 0.16 | (+-0.12, 0.33, 0) |
| Pelvis | box | 0.30 x 0.08 x 0.20 | (0, 0.43, 0) |
| Centre torso | box | 0.26 x 0.32 x 0.24 | (0, 0.62, 0); the `upper` pivot is the hip, y 0.46 |
| Side torso | box | 0.14 x 0.28 x 0.22 | (+-0.20, 0.63, 0) |
| Head / cockpit | box + canopy strip (emissive, 0.12 x 0.04) | 0.16 x 0.20 x 0.18 | (0, 0.88, +0.02) |
| Upper arm | box | 0.11 x 0.20 x 0.12 | shoulder pivot (+-0.31, 0.74, 0); hangs to y 0.54 |
| Forearm / weapon | box (hand style) or cylinder pod (gunpod style) | 0.12 x 0.22 x 0.18 | below the upper arm, slightly forward (z +0.04) |
| Shoulder pod | box | 0.14 x 0.10 x 0.16 | on top of the side torso |
| Base | cylinder 28 segments + force rim ring | radius from the weight class, height 0.12 | under `root` |

Variant styles (from data `figure.style`, else this table). Values are **provisional; confirm against the concept
images and update here**:

| Chassis | `legs` | `arms` | `shoulderPods` | `cockpit` |
|---|---|---|---|---|
| Mad Cat Mk II | `reverse` | `gunpod` | 2 | `nose` |
| Vulture Mk IV | `reverse` | `gunpod` | 2 | `nose` |
| Hollander, Rakshasa, Solitaire, Uziel, Regent, Eris | `humanoid` | `hand` | 0 | `head` |

- `reverse` legs: thigh angled back 25°, shin forward 35°, foot flat; pelvis at 0.48 H; torso boxes pushed forward (+z) 0.06 H.
- `nose` cockpit: head box in front of the centre torso at y 0.70 H (z +0.17), canopy facing forward.
- Primary colour (the force's `color`) on torso, arms and legs; secondary (a derived trim, `trimOf`) on head, pelvis, pods and feet; metal grey on joints.

## 5. Motion

| Motion | Spec |
|---|---|
| Walk/run tween | along the engine path, 180 ms per hex at speed 1; `lower` bob 0.02 H; legs swing ±0.35 rad alternating; run uses 140 ms per hex |
| Turn in place | 90 ms per hexside, shortest direction |
| Backward step | same tween, legs swing reversed |
| Jump | parabolic arc, apex `0.6 + 0.15 × hexes` world units (max 2.0); jet flame cones under both feet for the whole arc (pooled); dust ring on landing |
| Twist | `upper` eases to the new angle in 250 ms |
| Fall | `root` tips 80° onto its side about its forward axis in 500 ms, facing unchanged (no facing roll in 2026); dust puff |
| Stand up | reverse of fall, 500 ms |
| Weapon fire | muzzle VFX at the socket; beam/bolt/missile/tracer by weapon type; recoil kick 0.03 H on `upper` |

## 6. Status visuals (state-driven, never animation-driven)

| State | Visual |
|---|---|
| Prone | figure on its side (as fall), base stays flat |
| Shutdown | canopy emissive 0; `upper.rotation.x = +0.25` (slump forward); arms hang; no heat glow |
| Pilot unconscious | canopy emissive 0; status icon above the figure |
| Heat 10–19 | emissive orange `#ff7a1a` on torso parts, intensity 0.15 at 10 rising linearly to 0.45 at 19 |
| Heat 20+ | emissive red `#ff2a10`, 0.5 rising to 0.8, slow pulse (1.2 s) |
| Location armor gone (internal exposed) | that node tinted 25% darker; thin smoke wisp from its socket |
| Location destroyed (arm / side torso) | node hidden; sparks + smoke at the stump for 2 s, then a smoke wisp; side torso destroyed also hides its arm |
| Leg destroyed | leg node charcoal; sparks at the hip; figure stays upright unless the engine says prone |
| Head destroyed | head node hidden; wreck look |
| Destroyed (any cause) | all materials darkened 60%, `upper` tilted 0.6 rad, smoke column (pooled); stays as a wreck in its hex |
| Ammo explosion | fireball at the location socket (1 200 ms beat), then the destroyed/location visuals the state calls for |
| Immobile | status icon |
| Jumped this turn | small jet icon on the roster and over the figure until End phase |
| Selected / active / target / hovered | gold ring / pulsing gold / red ring / white 50% ring on the base edge |

Low graphics: particles become static icons; heat glow stays. All particles are pooled (`src/client/vfx/`).

## 7. GLB slot-in (live for Solitaire and Regent; owner gate pending)

| File | Role |
|---|---|
| `glbModels.ts` | `GLB_SLUG_BY_MODEL: Record<chassisKey, slug>`, chassis key = kebab of the chassis name (`mad-cat-mk-ii`), slug `bt-<chassis-kebab>`; the data's `figure` id is the fallback |
| `public/assets/models/manifest.json` | `{"slugs": [...]}`: enabled slugs; unlisted slugs are never requested (no 404s) |
| `glbLoader.ts` | shared cache; never suspends; `useGlbScene` returns `null` until loaded; procedural shows meanwhile; each figure `cloneGlb`s the shared scene |
| `rig.ts` `buildGlbRig` | maps GLB nodes onto the section 3 contract, clones materials per figure and node |
| `glbPaint.ts` | Whirr's hue-band painter: hue band +-22 degrees around the sculpt's two source hues (olive 78, tan 38), saturation < 0.18 untouched, materials cached per `(material, paint)` |

**Split nodes.** The pipeline already delivers the split: `base`, `lower`, `upper` (origin at the hip), `armL`, `armR` (children of
`upper`, origin at the shoulder). The old "cuts" proposal (hip and shoulder planes; optional torso, head and leg nodes) is not
needed for the two gate figures; optional nodes degrade as in section 3.

- Force colours: the painter remaps the olive drab to the force colour and the tan to its trim; metal, black and grey are left
  alone. The painted variant is cached module-wide; each figure then owns a clone (heat glow and tint are per unit).
- Budgets: about 10 000 faces and one 1024 texture per figure (the two gate figures are about 1.2 MB each).
- Before overwriting GLBs, `git mv` the old ones to `art/archive/` in the same commit. A test checks the manifest <= files on disk
  and that every mapped slug listed in the manifest has a file.

## 8. Gallery (`?gallery`)

`Gallery.tsx` (default export, lazy-loaded by `App`; own canvas, no game needed): one column per chassis (every 'Mech in the data
bundle plus every enabled GLB slug), the procedural kit in the front row and the GLB behind it, orbit camera, turntable. Controls
(`data-testid` `gallery-toggle-<name>`): turntable, base ring, LOS column (two levels), prone, shut down, destroyed, pilot down, arm
flip, arm loss (`gallery-toggle-armLoss`), torso twist -1 / 0 / +1 (`gallery-twist-<n>`), heat slider 0-30 (`gallery-heat`), per-location
destroy (`gallery-destroy-<LOC>`) and exposed-armour (`gallery-expose-<LOC>`) buttons, army painter (main and trim pickers, presets).
Labels: `gallery-item-<chassis>` and `gallery-item-<chassis>-glb`. Used for the M3 owner gate and screenshot tests.
Dev entries without the game shell: `figures/galleryMain.tsx` (gallery) and `figures/devUnitsMain.tsx` (a real game with board, units and HUD).

## 9. Tests (lean; `tests/client/units.test.ts`)

1. Every 'Mech in the data bundle resolves to a procedural style; weight classes follow tonnage.
2. A procedural rig exposes every node of section 3 and stays within 600 triangles; light height < assault height (0.75 : 1.00).
3. `facing.ts`: facing 1 points the front to the north-east hexside (`rotation.y = pi - pi/3`); twist +1 is clockwise.
4. Destroyed LA hides `armL`; destroyed LT hides `torsoL` and `armL`; heat glow thresholds (orange 10-19, red 20+).
5. The real GLBs carry nodes `base`, `lower`, `upper`, `armL`, `armR`; manifest <= files on disk; mapped slugs in the manifest exist.
6. Overlay view models (reach colours, facing arrows, LOS colours, path cost), weapon looks for every weapon in data, the VFX plan
   for a fire beat, the pooled engine, ray-to-hex and the move / facing / confirm flow through the real stores.
