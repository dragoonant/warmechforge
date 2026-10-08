# 30: Figures

How 'Mechs look on the board. Rules never read meshes: position, facing, twist, LOS height (a 'Mech is two levels
tall) and damage come from engine state. Pipeline detail lives in the brief, Part D.3; this file is the game-side
contract. Folder: `src/client/figures/` (copy Whirr Machine's file layout: `Figure.tsx`, `Procedural.tsx`,
`GlbBody.tsx`, `glbLoader.ts`, `glbModels.ts`, `glbPaint.ts`, `paintStore.ts`, `Gallery.tsx`, `facing.ts`).

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
constant from `00-architecture`).

| Constant | Value | Notes |
|---|---|---|
| `FIGURE_BASE_HEIGHT` | 0.80 | heavy 'Mech, base top to highest point |
| `HEIGHT_BY_CLASS` | light 0.8, medium 0.9, heavy 1.0, assault 1.1 (× base height) | light 0.64, medium 0.72, heavy 0.80, assault 0.88 |
| Weight class | from the unit's tonnage in data: light 20–35 t, medium 40–55 t, heavy 60–75 t, assault 80–100 t | never a per-'Mech literal |
| `BASE_RADIUS` | 0.33 | round disc, fits inside the hex's inscribed circle (0.5) |
| `BASE_THICKNESS` | 0.04 | near-black; force-colour rim ring 0.015 wide |
| `TREE_MAX_HEIGHT` | 0.55 × the smallest figure height on the board | woods stay below shoulders (`50-client` §4) |

Figures are deliberately a little taller than `2 × LEVEL_HEIGHT` so they read at board zoom; the LOS view
(`50-client` §7) draws the rules column (two levels) as a faint ghost so players are not misled.

## 3. Node contract (shared by procedural and GLB figures)

Every figure, procedural or GLB, exposes the same named `Object3D` nodes. `Figure.tsx` animates only these.

| Node | Parent | Pivot | Driven by |
|---|---|---|---|
| `root` | board | hex centre at the hex's top (`level × LEVEL_HEIGHT`) | position (tween), `rotation.y = −facing × π/3` (front = −z; facing 0 = north, clockwise), prone tilt |
| `base` | `root` | origin | force rim colour, rings (selected/target) |
| `lower` | `root` | origin | legs, pelvis; walk bob |
| `leg_l`, `leg_r` | `lower` | hip joint | swing while walking; destroyed-leg look |
| `upper` | `root` | torso centre (vertical twist axis) | `rotation.y = −twist × π/3`, twist ∈ {−1, 0, +1} (+1 = clockwise/right); shutdown slump `rotation.x` |
| `torso_c`, `torso_l`, `torso_r` | `upper` | part centre | per-location damage tint, smoke; `torso_l/r` hidden when destroyed |
| `head` | `upper` | part centre | canopy emissive (lights out on shutdown/unconscious) |
| `arm_l`, `arm_r` | `upper` | shoulder joint | hidden when the arm (or its side torso) is destroyed; arm flip `rotation.x = π` when the engine says flipped |
| sockets `s_<loc>` | the node of that location | muzzle point | VFX origin per weapon location (§6) |

Locations map to nodes: `HD→head`, `CT→torso_c`, `LT→torso_l`, `RT→torso_r`, `LA→arm_l`, `RA→arm_r`, `LL→leg_l`,
`RL→leg_r`. Rear-armor hits use the same node.

## 4. Procedural kit (M3 placeholder and permanent fallback)

Built in `Procedural.tsx` from shared `BufferGeometry` per part type (one per type, scaled per instance) and shared
materials per `(force, part role)`. Budget ≤ 600 triangles per figure. `H` = figure height for its class.

| Part | Geometry | Size (w × h × d, in H) | Placement (centre, in H) |
|---|---|---|---|
| Foot | box | 0.18 × 0.05 × 0.26 | (±0.12, 0.025, −0.03) |
| Shin | box | 0.16 × 0.20 × 0.18 | (±0.12, 0.15, 0) |
| Thigh | box | 0.14 × 0.20 × 0.16 | (±0.12, 0.33, 0) |
| Pelvis | box | 0.30 × 0.08 × 0.20 | (0, 0.43, 0) |
| Centre torso | box | 0.26 × 0.32 × 0.24 | (0, 0.62, 0) `upper` pivot here |
| Side torso | box | 0.14 × 0.28 × 0.22 | (±0.20, 0.63, 0) |
| Head / cockpit | box + canopy strip (emissive, 0.12 × 0.04) | 0.16 × 0.20 × 0.18 | (0, 0.88, −0.02) |
| Upper arm | box | 0.11 × 0.20 × 0.12 | shoulder pivot (±0.31, 0.74, 0); hangs to y 0.54 |
| Forearm / weapon | box (hand style) or cylinder pod (gunpod style) | 0.12 × 0.22 × 0.18 | below the upper arm, slightly forward (z −0.04) |
| Shoulder pod | box | 0.14 × 0.10 × 0.16 | on top of the side torso |
| Base | cylinder 24 segments | radius `BASE_RADIUS`, height `BASE_THICKNESS` | under `root` |

Variant styles (from data `figure.style`, else this table). Values are **provisional; confirm against the concept
images and update here**:

| Chassis | `legs` | `arms` | `shoulderPods` | `cockpit` |
|---|---|---|---|---|
| Mad Cat Mk II | `reverse` | `gunpod` | 2 | `nose` |
| Vulture Mk IV | `reverse` | `gunpod` | 2 | `nose` |
| Hollander, Rakshasa, Solitaire, Uziel, Regent, Eris | `humanoid` | `hand` | 0 | `head` |

- `reverse` legs: thigh angled back 25°, shin forward 35°, foot flat; pelvis at 0.48 H; torso boxes pushed forward 0.06 H.
- `nose` cockpit: head box rotated to sit in front of the centre torso at y 0.70 H, canopy facing forward.
- Primary colour on torso/arms/legs, secondary on head, pelvis, pods and feet; metal grey on joints.

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

## 7. GLB slot-in (M5; spike in M3)

| File | Role |
|---|---|
| `glbModels.ts` | `GLB_SLUG_BY_MODEL: Record<variantId, slug>`; both variants of a chassis share one slug `bt-<chassis-kebab>` (e.g. `bt-mad-cat-mk-ii`) |
| `public/assets/models/manifest.json` | enabled slugs; unlisted slugs are never requested (no 404s) |
| `glbLoader.ts` | shared cache; never suspends; returns `null` until loaded; procedural shows meanwhile |
| `GlbBody.tsx` | maps GLB nodes onto the §3 contract |
| `glbPaint.ts` | Whirr's two-hue army painter (hue band ±22°, saturation < 0.18 untouched, materials cached per `(material, paintKey)`) |

**Split nodes.** `stage_finalize.py` gains a bpy split step (2.1 venv) driven by `bt_units.json`:
`"cuts": {"hip": y, "lShoulder": [x, y], "rShoulder": [x, y]}` in normalised units (figure height = 1, front = −z).

- `hip`: horizontal plane at `y`; below → `lower`, above → `upper`. `upper` origin moved to the torso centre
  (bounding-box centre of the upper part, x = 0, z = 0).
- `lShoulder` / `rShoulder`: vertical plane at `x = ∓x` (left is −x), applied only above `y`; outboard pieces become
  `arm_l` / `arm_r` with the origin at the cut centre.
- Cut faces are capped with a dark metal material so seams never show holes.
- Optional `torso_l`, `torso_r`, `head`, `leg_l`, `leg_r` nodes: if absent, damage tints apply to the nearest
  existing node and a location-destroyed effect plays at its socket position from `sockets` in `bt_units.json`.
- Node names in the GLB must match §3 exactly. `GlbBody` reports `capabilities = {twist, armLoss}`:
  - no `upper`: twist is shown by an arc arrow decal on the base, not by rotating the mesh;
  - no `arm_*`: arm loss shows scorch tint, smoke and a destroyed marker at the shoulder socket.
- Tune cut values by reading the finalize contact sheets (copied to `art/figure-sheets/`).
- Budgets: ≈10 000 faces and one 1024 texture per figure.
- Before overwriting GLBs, `git mv` the old ones to `art/archive/` in the same commit. A test checks the manifest ⊆
  files on disk and `GLB_SLUG_BY_MODEL` slugs ⊆ manifest or procedural.

## 8. Gallery (`?gallery`)

Grid of every variant in the bundle (procedural and GLB side by side), turntable, toggles: base ring, LOS ghost (two
levels), twist −1/0/+1, arm flip, each status visual (§6), heat slider 0–30, per-location destroy buttons, army
painter pickers. Used for the M3 owner gate and screenshot tests. `data-testid`: `gallery-item-<variantId>`,
`gallery-toggle-<name>`.

## 9. Tests (lean)

1. Every variant in the data bundle resolves to a procedural style (data or §4 table).
2. Procedural figure exposes every §3 node name.
3. Height by class: Solitaire-class (light) figure height < assault figure height; ratio 0.8 / 1.1 of base.
4. `facing.ts`: facing 1 points the figure's front to the north-east hexside (`rotation.y = −π/3`).
5. Destroyed LA hides `arm_l`; destroyed LT hides `torso_l` and `arm_l`.
6. Manifest ⊆ files on disk.
