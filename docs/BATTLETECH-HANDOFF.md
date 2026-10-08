# Handoff: WarMechForge, a BattleTech browser game (third in the series)

Written 2026-10-07. It distils two finished sibling projects:

| Project | Game | Repo | Pages | Scale |
|---|---|---|---|---|
| Mallet 42k | Warhammer 40k | `dragoonant/mallet-42k` (local `C:\Users\antho\OneDrive\Documents\Mallet-42k`) | https://dragoonant.github.io/mallet-42k/ | ~200 commits, 1,764 tests |
| Whirr Machine | Warmachine MK4 | `dragoonant/whirr-machine` (local `C:\Users\antho\OneDrive\Documents\WarMForge\whirr-machine`) | https://dragoonant.github.io/whirr-machine/ | 49 commits in 4 days (M0-M13), 1,167 tests, 6 factions |

**Goal.** A 3D browser game of **BattleTech (Classic, hex-and-record-sheet)** against an AI. The content is the
**BattleTech Core Box (CAT37002, 2026)**. It uses the same look, sound and polish as Whirr Machine: generated 3D figures of the real
'Mech sculpts, ElevenLabs SFX, voice and music, and the dark-and-gold UI. The owner was "having a blast" playing Whirr Machine,
so copy what it does; don't reinvent.

How to use this file:
- Read it once, start to finish.
- Then keep your own `HANDOFF.md`, `STATUS.md` and `PLAN.md` in the repo.
- Copy Part B into the repo's `CLAUDE.md` on day one.
- Whirr Machine's brief (`WarMForge\whirr-machine\docs\WARMACHINE-HANDOFF.md`) is the predecessor of this file. Read a part of it
  only when this file points there.

Confidence marks:
- **(verify)**: must be checked against the official source before data entry.
- **(U)**: unconfirmed as of 2026-10-07; see Part G.0 for how to resolve it.

---

## Part A: the owner and how they work (read first)

**Priorities**
- **Playable first.** Something the owner can open on Pages and play beats test coverage. Every stage ends in something visible:
  a Pages deploy or screenshots.
- **Metered plan.** The token rules in Part B are mandatory, not style advice.
- **Do the legwork.** Finish routine chores yourself: free downloads, $0 guest checkouts, web research. Stop only for passwords,
  payment or account creation. The owner said: "Please don't make me do the work for you."
- **Research before assuming.** One blocked source is not the only source. Before you mark data unverified or ship a stand-in,
  search widely and cite what you tried: Sarna, MegaMek data, reviews, reddit, retailer photos, battle reports. In Whirr Machine
  the owner was disappointed by stats marked unverified that took little effort to find, and by a stand-in figure for a model with
  easy-to-find photos.

**Communication**
- **Check-ins are ≤10 lines**, with a screenshot per milestone.
  - Don't narrate options you won't pursue.
  - Don't re-ask settled decisions (list below).
  - Questions go in one numbered list.
- **Playtest loop.** The owner plays on Pages and gives blunt, specific feedback. Fix it in small commits and push.
- **Rules ambiguities never block work.** Add a `RULING:` line (rule, what we did, why) to `docs/needs-rules-check.md`. The
  owner reconciles them in one sitting.
- **Overnight runs.** The owner often sets auto mode and leaves the PC on overnight.
  - Leave a "Morning summary (owner)" block at the top of `HANDOFF.md`: what shipped, URLs, screenshot paths, numbered
    questions.
  - Build the backlog in workflow stages and push after each one.

**Settled decisions (2026-10-07, do not re-ask)**

| Topic | Decision |
|---|---|
| Game | BattleTech, Classic rules (hex map, record sheets, heat, criticals). Not Alpha Strike. |
| Content | The 2026 **BattleTech Core Box** (not AGoAC, Beginner Box or Starter Box). |
| Opponent | Player vs AI first. Multiplayer later, if ever. |
| Title and repo | **WarMechForge**, public GitHub repo `dragoonant/warmechforge`, deployed to https://dragoonant.github.io/warmechforge/. Repo folder `C:\Users\antho\OneDrive\Documents\WarMechForge\warmechforge`. |
| IP posture | The Mallet / Whirr posture (Part F). Real 'Mech, weapon and equipment names are fine. All prose is ours. No Catalyst or HBS art, logos or record-sheet layouts in the repo. |
| Figures | Versions of the **real Core Box sculpts**. Product photos are local references only, never committed. |
| Proportions | Stated in plain words; see D.1. The words "MGSD", "SD", "super deformed", "chibi" and "Gundam" are banned. Owner: "we just need the proportions correct for all models", and "less SD, more detailed". |
| Pipelines | SDXL or Gemini concepts, Hunyuan3D GLBs, ElevenLabs SFX, voice and music. |
| Secrets | ElevenLabs key in `WarMechForge\Tokens.txt` (format `EL=sk_...`), passed only via env var. |

**Rules edition (resolved from the owner's answer).** The owner chose "Classic (Total Warfare)". The Core Box ships the new
**2026 BattleTech Core Rules** (the Refit & Redeployment line), which replace Total Warfare and the BattleMech Manual. Catalyst
calls it "not a new edition", but there are 174 listed changes (Part E.0).
- **Implement the 2026 Core Rules as cut down in the Core Box rulebook.** That is Classic BattleTech as the box plays it.
- Where the Core Rules are unavailable, fall back to Total Warfare and log a `RULING:`.
- Mention this in the first check-in as a statement, not a question.

**Ask the owner in the FIRST check-in (one message, numbered):**
1. **Do you own the Core Box?** It sold at Gen Con 2026; general retail is mid-to-late October.
   - Also: the Core Rulebook (print or PDF), or the Core Box rulebook?
   - The box's record-sheet booklet is the only confirmed source for six of the eight 'Mech variants (G.0).
   - If yes: please photograph or scan the 16-page record-sheet booklet, the pilot cards and the 5 missions into
     `WarMechForge\sources-local\` (outside the repo). The agent reads them locally and never commits them.
   - If no: the agent researches the stats online (G.0) and logs every unconfirmed value.
2. **Buying the Core Rulebook PDF** from store.catalystgamelabs.com is a payment, so only the owner can do it. Offer it as an
   option, not a requirement.
3. **ElevenLabs budget** for this game: suggest ≤25k credits total (SFX ~1k, voice ~1k, music ~12k), and confirm before spending
   more than 5k in one run.

**Machines and secrets**
- **The Windows PC with the GPU** (this machine) does all asset work: Hunyuan3D, SDXL, Claude in Chrome for Gemini, and
  ElevenLabs. Never route asset work through the Mac.
- **The key file lives outside the repo:** `C:\Users\antho\OneDrive\Documents\WarMechForge\Tokens.txt`, one line `EL=sk_...`.
  - Load it inline only, and never echo, log or commit it:
    ```bash
    export ELEVENLABS_API_KEY="$(sed 's/^EL=//' /c/Users/antho/OneDrive/Documents/WarMechForge/Tokens.txt | tr -d '\r\n ')"
    ```
  - Check `GET https://api.elevenlabs.io/v1/user/subscription` (`character_count` and `character_limit`) before every batch.
    The Starter tier gives about 59k credits per cycle.
  - The repo `.gitignore` gets `*.token*`, `Tokens.txt`, `.env*` and `docs/sources/` on day one.
  - Lesson: Mallet's `.gitignore` had `*.token` but not `*.token*`, so its `elevenlabs.token.rtf` sat untracked and not ignored.

---

## Part B: process rules (copy into the new `CLAUDE.md`)

These rules worked in both games, tightened by their mistakes. Whirr Machine's `CLAUDE.md` is the template; copy it and swap
in the BattleTech specifics.

### B.1 Token rules
- **The main loop stays cheap.** It never reads whole source files or hand-writes bulk code. It writes Workflow scripts
  (`tools/workflows/`), reads structured JSON results, and checks in with the owner.
- **Models.**
  - Implementation and data entry run on Sonnet subagents (`model: 'sonnet'`).
  - Spec writing, integration and adversarial verification run on the session model at `effort: 'high'`.
  - Agents return schema-validated JSON, ≤300 tokens.
- **Stage size.** One workflow stage at a time, ≤8 agents per stage. Commit and push after every stage. Resume
  (`resumeFromRunId`) works in the same session only.
- **Prompts point, they don't paste.** "Read spec section X, build Y."
- **Freeze interfaces before fan-out.** This was the number one rework sink in Mallet.
- **Cap research.** At most 3–6 WebFetches per agent, name the exact spec sections, and probe a new setup with one cheap agent
  before fanning out. Mallet wasted about 2M tokens on blocked worktree agents.
- **Lean mode is the default** (`args.lean: true`): implement and commit with about 10 focused tests and no adversarial verify
  loop.
  - Turn verify loops ON for rules-dense work: the heat, crit and PSR engine, the equipment catalogue, and each new 'Mech
    data batch.
- **Token reference points:**
  - Mallet: foundation specs ~1.2M, engine core ~0.5M, data entry with verify ~2M, main loops ~0.35M.
  - Whirr Machine reached a playable Pages game (M3) in about one day and M13 in four.

### B.2 Workflow script pattern
Copy `whirr-machine/tools/workflows/w1-engine.js`, `w3-client.js` and `w10-backlog.js` as templates.

**Skeleton:**
```js
export const meta = { name:'w1-engine', description:'...', phases:[{title:'Spec'},{title:'Build'},{title:'Ship'}] }
const ROOT='C:/Users/antho/OneDrive/Documents/WarMechForge/warmechforge'
const ATTR='Co-Authored-By: <current model line from the session attribution reminder>'
const STAGE=(args&&args.stage)||'spec'
const RESULT={type:'object',properties:{ok:{type:'boolean'},summary:{type:'string'},files:{type:'array',items:{type:'string'}},issues:{type:'array',items:{type:'string'}}},required:['ok','summary','files','issues']}
const COMMON=`Project root ${ROOT}. Windows; use absolute paths, the cwd resets. Run long commands in the FOREGROUND. Orient from STATUS.md only... IP rule... frozen contracts... own only your files; never git commit / npm install / edit STATUS.md unless told. Final output is raw JSON.`
if (STAGE==='spec'){ phase('Spec'); /* parallel([...]) */ }
return { error:`stage ${STAGE} not written yet` }
```

**Schemas:**
- `RESULT = {ok, summary, files[], issues[]}`
- `VERDICT = {verdict:'pass'|'fail', coverage:{covered,total}, failing:[{owner,where,problem,fix}], notes}`. Tell the verifier
  "default to fail when unsure"; verifiers never edit.
- `FINDINGS = {ok, findings:[{owner:'spec'|'data'|'engine'|'client', where, problem, fix}]}`

**The `COMMON` preamble** opens every prompt. It contains:
- the absolute root;
- "orient from STATUS.md only";
- the IP rule;
- the frozen-contract rule;
- **"run long commands in the FOREGROUND"**: Sonnet agents that background `npm test` stall;
- the **Classic-vs-other-editions leak list** (E.12);
- "Final output is raw JSON".

**File ownership.**
- Every prompt says "You own ONLY: …", and concurrent agents own disjoint files.
- Each finding carries an `owner` and is routed to the agent that owns that file. Narrow fix agents correctly refuse
  out-of-scope findings.

**The integrate/ship agent** (`effort:'high'`):
1. Runs the gates.
2. Stages files **by exact path** (never `git add -A`).
3. Commits with `M<n>: <what>` plus the attribution line.
4. Runs `git pull --rebase`, then pushes.
5. Watches the Pages deploy with `gh run watch`.
6. Collects `RULING:` lines from every agent's `issues` into `docs/needs-rules-check.md`.

**Follow-up file.** Agent issues that are out of scope go to `tools/out/m<n>-followups.md`, grouped by work package (WP-CORE,
WP-AI, WP-FIG…). Whirr's `m12-followups.md` shows the format. The next backlog stage reads it.

**Resume prompts after a usage-limit cutoff** must say "check `git diff` first". A cutoff left partial uncommitted edits once.

### B.3 Concurrency and git hygiene
- **Shared tree.** Concurrent agents never run `npm install` or `git commit`, and never edit `package.json` or `STATUS.md`,
  unless told to. Concurrent installs corrupted `node_modules`.
- **Parallel content** (for example, extra 'Mech packs later) runs in git worktrees (`.claude/worktrees/<name>`), one Workflow
  run each. Each agent calls `EnterWorktree` first, because a harness hook refuses edits into a sibling worktree.
- **After an interrupted run:** `git status`, then `npm run typecheck && npm test && npm run validate:data`, then commit by hand
  or park the work on `wip/<stage>`.
- **`scriptPath` must be inside the session's working directory.** Start sessions in `C:\Users\antho\OneDrive\Documents\WarMechForge`
  (the repo is a subfolder), as Whirr did with `WarMForge\whirr-machine`.
- **Line endings.** Workflow scripts stay LF (`.gitattributes`).
- **Never stage** `tools/out`, `e2e-out`, `test-results`, `.claude/`, `docs/sources/`, PDFs, photos or tokens.
- **Shell notes.**
  - Bash is Git Bash. `pdftotext` is at `/mingw64/bin/pdftotext`.
  - Keep each Bash call under 10 minutes; run GPU batches one slug per call.
  - If another process holds more than 4 GB of VRAM, wait rather than kill it.

### B.4 Verification (automated, lean)
- **Gates:** `npm run typecheck`, `npm test`, `npm run validate:data`, `npm run sim -- --games 50 --seed 1` (zero invariant
  violations), and `npm run bench:ai`.
- **E2E:** `PW_PORT=4183 npx playwright test <spec>`, then **Read the screenshots** in `e2e-out/` to actually look at them.
- **Name engine tests by checklist ID** from `docs/spec/12-rules-test-checklist.md` (e.g. `it('HEAT-014 ...')`). Coverage is
  counted by test names, not line coverage.
- **Playwright serves the Pages sub-path** (`/warmechforge/`), so base-path bugs show up locally.
- **Verify behaviour in play, not just in tests.** A Mallet pile-in fix passed its tests but still failed in play. Build
  `?scenario=<name>` dev positions (`src/client/dev/scenarios.ts`) for tricky rules (DFA, falls, ammo explosion, a torso-twist
  arc edge) and measure there.
- **The built-in browser pane's `left_click_drag` does not move three.js objects.** Test drags with Playwright `page.mouse`
  (steps ≥10).

---

## Part C: tech stack and architecture (reuse Whirr Machine's, nearly verbatim)

### C.1 Stack and config (copy files from whirr-machine)
- **Libraries:** react/react-dom 19.2, three ^0.186, @react-three/fiber ^9.7, @react-three/drei ^10.7, zustand ^5. Dev: vite
  ^8.3, @vitejs/plugin-react ^6, vitest ^5, @playwright/test ^1.63, typescript ^7, tsx ^4.23, ajv ^8 + ajv-formats ^3,
  @breezystack/lamejs ^1.2.
- **Scripts:** `dev build preview typecheck test test:watch e2e sim bench:ai validate:data`.
- **`vite.config.ts`:**
  - `base: '/warmechforge/'` in production only, `/` in dev.
  - Alias `@` → `./src`.
  - The vitest block uses `environment:'node'`, `include:['tests/**/*.test.ts']` and `testTimeout:30000` (CI runners are about
    2× slower).
- **`playwright.config.ts`:**
  - Port from `PW_PORT` (default 4173), baseURL `/warmechforge/`.
  - webServer runs `npm run build && npm run preview -- --port $PORT --strictPort`, chromium only, `retries: 0`.
- **`tsconfig.json`:** ES2022, Bundler resolution, strict, `resolveJsonModule`, `paths` `@/*` (TS 7: no `baseUrl`).
- **`.github/workflows/deploy.yml`** (copy verbatim):
  - Node 22: `npm ci`, typecheck, test, build.
  - Then configure-pages@v5, upload-pages-artifact@v3 (`dist`) and deploy-pages@v4.
  - E2E does not run in CI.
- **`.claude/launch.json`:** a dev entry (`npm run dev`, port 5174, `autoPort`) plus the "hunyuan model viewer" entry from Mallet
  (python viewer.py, port 8765).
- **Node 25 locally** prints a harmless EBADENGINE warning from Vitest 5. Run `npx playwright install chromium` once.

### C.2 Layout
```
src/engine/   pure rules engine: (GameState, Action) -> events + new state + exactly ONE PendingDecision
  types.ts actions.ts events.ts hooks.ts rng.ts decider.ts index.ts        <- FROZEN after M0 (additive only, log in 00-architecture §14)
  hex.ts (coords, facing, lines, arcs) los.ts terrain.ts movement.ts (MP, paths, PSR triggers)
  dice.ts tohit.ts hitloc.ts cluster.ts damage.ts crits.ts heat.ts psr.ts pilot.ts physical.ts ammo.ts
  initiative.ts phases/{initiative,movement,ranged,physical,heat,end}.ts equipment/<family>.ts scenario.ts bv.ts
src/data/     core/{equipment,weapons,ammo,tables}.json, mechs/<chassis>/<variant>.json, pilots/*.json, spas.json,
              maps/<id>.json (hex terrain), missions/*.json, forces/*.json   (ajv-validated by tools/validate-data.ts)
src/ai/       utility decider, closed-form 2d6 math, movement search over (hex, facing) states, heat knapsack, threat maps, worker.ts
src/client/   store/ (zustand, the ONLY caller of engine.step), presentation/, board/ (hex board + terrain), figures/, interaction/,
              ui/ (record sheet, heat scale, prompts), dice/, vfx/, audio/, bot/, dev/scenarios.ts
tools/        sim.ts ai-bench.ts validate-data.ts gen-audio.ts compose-audio.ts measure-audio.ts audio-manifest.json audio-src/
              terrain-catalog.json workflows/*.js out/
docs/spec/    00-architecture 10-rules-core 11-missions 12-rules-test-checklist 13-golden 20-data-schema schemas/
              30-figures 40-ai 50-client 60-testing 70-maps
docs/needs-rules-check.md   docs/sources/ (gitignored)
art/          unit-concepts/ figure-sheets/ terrain-sheets/ board-textures/ archive/
public/       assets/{models,terrain,ui}, audio/, audio/music/, sounds.html
tests/        engine/ data/ ai/ client/ e2e/ fixtures/
```

### C.3 Engine principles that paid off (both games)
- **Pure, seeded, replayable.**
  - RNG: sfc32 + cyrb128 with 15 warm-up draws (Whirr's `rng.ts`).
  - `roll(state, spec)` is the **only** way the engine rolls, and every roll emits `DiceRolled{purpose, dice, total, target}`.
    `Math.random` is never used.
  - `deriveSeed(...)` supplies randomness for the AI and bots and never touches `state.rng`.
  - The action log, `save`/`load`/`replay`, and `?seed=<word>` make games repeatable.
  - The engine never imports data; a bundle is passed in or registered.
- **API:** `createGame(setup, seed, bundle)`, `step(state, action) -> {state, events, pending, rejection?}`, `legalActions`,
  `validate`, `replay`, `save`, `load`, `view`, `query.*`, `describe.*`.
- **Illegal input is rejected with a code, never thrown.** Only corrupt state throws.
- **One `Decider` interface** for the human, the AI, random play and replay.
- **`legalActions` is never empty for an open decision.** Feasibility means "some candidate passes full validation", not "the
  planner's preferred arrangement fits". Mallet froze twice on this.
- **The engine owns every number the UI shows**: to-hit target and its modifier breakdown, LOS verdict, arc, MP cost, heat
  projection, PSR target, cluster odds.
  - Mallet computed objective control client-side and saves as `Sv − AP` (ignoring cover); both were bugs.
- **Read targets from state, not from events.** A re-roll window opened before the roll event, so the UI showed the previous
  roll's target.
- **One generic mechanism per concept.** Mallet ended up with three deferred-death systems. Here that means:
  - **one damage pipeline**: armor → internal → transfer → crit check → crit resolution → explosion chain;
  - **one PSR queue**;
  - **one heat ledger**.
- **Data-driven equipment.** Each weapon or equipment item is JSON (heat, damage, ranges, min range, slots, tons, ammo per ton,
  flags like `cluster`, `streak`, `pulse:-2`, `explodes`, `oneShot`). Add `{code:'<hook>'}` escape hatches registered in
  `code-hooks.ts` for odd items (RAC jams, X-pulse, capacitors, supercharger, targeting computer).
- **Stacking.** Take the max of durations deliberately; never let one effect silently overwrite another.

### C.4 Client principles that paid off (build in the first client stage, not retrofitted)
- **Presentation director plus presented-state store.**
  - The engine resolves a step instantly; `presentation/director.ts` turns events into timed beats.
  - The UI shows state as of the presentation cursor.
  - The bot answers only when the presentation is idle, with a 5 s watchdog that force-answers bot-owned decisions.
  - Narration pauses: 2.4 s per phase, 1.6 s per turn, scaled by speed; any click skips.
- **Prompts that explain themselves.** Every prompt names the attacker, the target and the exact numbers, for example:
  > "Fire ER PPC at Rakshasa? Target 8 (Gunnery 4, medium range +2, you walked +1, it moved 5 hexes +2, light woods +1,
  > heat −1) = 72%. +15 heat → you'll be at 9 after sinks."

  This was retrofitted across about 8 Mallet commits; build it on day one.
- **Generic two-force client from day one.** No hard-coded side or 'Mech logic. Colours follow the force, not the seat.
- **Performance from the start.**
  - A demand frameloop (`invalidate()` from every animator), a dpr cap, on-demand shadows at 1024 (`markShadowsDirty`), shared
    GLB geometry and materials, and a Low graphics setting.
  - **Triangles dominate cost**, not draw calls.
  - Code-split the start screen from the game chunk.
  - The AI runs in a Web Worker (`src/ai/worker.ts` + `client/bot/aiWorkerClient.ts`).
- **Test hooks.**
  - `?test=1` exposes `window.__game` (state, pending, legal, dispatch, skipAll, speed, presentedIdle).
  - `?scenario=&forces=&control=bot,bot&seed=&map=` skips the start screen. `?gallery` shows the figure turntable. `?fps`
    shows a frame meter.
  - `data-testid` follows `<area>-<element>[-id]`. Invisible DOM proxies `mech-<id>` carry `data-hex` and `data-facing`.
  - E2E clicks the real UI only (shared click policy in `tests/e2e/policy.ts`); `window.__game` is for reading state and
    fast-forwarding.
- **E2E text matching.** Picks match exact text: a Mallet test picking "Space Marines" matched "Chaos Space Marines". The same
  trap here is "Mad Cat Mk II" vs "Mad Cat".
- **Camera.** drei OrbitControls: right-drag orbits, middle-drag or WASD pans, the wheel zooms, left-click is reserved for the
  board. Right/middle click and Alt/Space never start a model action. Preset transitions ≤600 ms.
- **Side rails** collapse with `[` and `]`. Paint button in the top bar. Settings popover with speed, graphics, narration and
  tips. Autosave each turn with Continue on the start screen. The end screen shows the cause, damage per side and Play again.

### C.5 Conventions for BattleTech (new: hexes, not inches)
- **Coordinates.**
  - The engine works in hexes: axial/cube coordinates internally, with the printed mapsheet label `XXYY` (column, row;
    `0101` top-left) for display and data.
  - BattleTech mapsheets are **flat-topped**: a 'Mech faces a hexside, and facing 0 = north (verify the column offset parity
    against MegaMek's `Coords`).
  - Six facings, 0–5, clockwise.
- **World units.**
  - 1 world unit = 1 hex, flat-to-flat; y is up.
  - One elevation level is a fixed fraction of a hex; pick a visually pleasing value such as 0.35 and keep it in one constants
    file.
  - The board is centred at the origin.
  - A standard mapsheet is 15 × 17 hexes (verify against the Core Box maps; retailers list 18"×22" vs 17"×22").
- **Sizes.** A 'Mech occupies one hex and is two levels tall (for LOS and partial cover).
- **Ranges** are in hexes, counted hex to hex (the target hex is counted, the attacker's isn't).
- **Facing is first-class.** The front, side and rear arcs, torso twist and hit-location tables all depend on it. Measuring is
  always allowed: the ruler shows hex count and range band.

---

## Part D: art, sound and music (same look as Whirr Machine)

### D.1 Figure proportions (owner, 2026-10-07)
- **Banned words in prompts:** never write "MGSD", "SD", "super deformed", "chibi", "Gundam" or "mecha kit".
- **State the proportions in plain words:** "mildly stylized heroic proportions, about 4–5 heads tall; cockpit and torso slightly
  enlarged, legs slightly shortened and sturdy, weapons slightly oversized; high surface detail like a premium painted tabletop
  miniature; keep the exact silhouette, weapon placement and panelling of the real sculpt."
- **No Gundam styling:** no V-fins, Gundam faces or visors, and no Gundam colour blocking.
- **Owner gate in M3.** Run **two 'Mechs** (one light, one assault, for example Solitaire and Regent) through the full pipeline.
  The owner approves the exact ratio before any other figure is made. Record the approved ratio in `docs/spec/30-figures.md`.
- **Check the image, not the prompt.**
  - Zoom in on every concept. Reject duplicate or extra weapons, missing limbs, fused parts, text or lettering, a cropped
    figure or base, or wrong weapon placement for the variant.
  - Make the variants by editing one clean base image ("start from image N, keep everything, change only X") rather than
    re-prompting.
- **Original markings only.** No Catalyst or faction insignia, unit logos or decals. Use plain two-tone camo that the army painter
  can recolour.

### D.2 Concept images
**Option 1: Gemini via Claude in Chrome**, the method the owner prefers for real sculpts.
- **Browser:**
  - Use **Claude in Chrome on this Windows PC** (the owner's Google account).
  - Run `list_connected_browsers` first; if no Windows browser is connected, ask the owner.
  - Never use the Mac or the built-in browser, which isn't signed in.
- **Reference photos:**
  - Download official product photos (Catalyst store, retailer listings, the Tabletop Battles review) into
    `WarMechForge\refs-local\<slug>\` (outside the repo, inside the session folder).
  - Record the source URLs in `refs-local\refs.json` as `[{slug, files[], urls[], notes}]`.
- **Uploading refs (clipboard guard):**
  - **Never paste refs via the clipboard.** In 2026-10 a failed copy pasted the owner's private clipboard text into Gemini.
  - Click "Upload & tools" (+), then hover "Upload files" so the hidden `input[type=file]` renders.
  - `find` it, then `file_upload` with a path inside the session folder.
  - Verify the prompt box holds only the prompt before pressing Enter.
- **Chats:** one Gemini chat per force for style consistency. Files are named `art/unit-concepts/<slug>.png`.
- **Downloading results:** the download button is unreliable, so pull images with in-page JS.
  - `blob:` images: draw to a canvas and call `toDataURL`.
  - lh3 images: `fetch(src.split('?')[0]+'?alr=yes',{credentials:'include'})`, and follow text-body redirects until the blob
    type is `image/*`.
  - Bundle the results into one JSON download per tab.
- **Browser quirks:**
  - `javascript_tool` times out at 45 s, so start long loops un-awaited and poll.
  - A hidden page drops prompts silently, so screenshot the tab to bring it forward.
- **Prompt template:**
  > Generate an image of the BattleTech [CHASSIS VARIANT] BattleMech exactly as in the attached photos of the official
  > miniature: [weapons and where they are]. [Proportion sentence from D.1.] Full body, neutral standing pose, front
  > three-quarter view, standing on a plain round black base. Plain white background, even soft lighting, no shadows, no text,
  > no logos, no insignia. Exactly ONE figure, centred, not cropped.

**Option 2: local SDXL** (`Hunyuan3D-2\concepts_sdxl.py`, Part D.3).
- Fine for terrain and as a fallback.
- Pass `--style 0.2 --avoid "..."`, or the librarian style reference turns everything blue.
- Replace the old `--prefix` text, which contains banned words, with the D.1 sentence.

### D.3 3D figures: the local Hunyuan3D pipeline (this PC, outside the repo)
**Folders and tools:**
- `C:\Users\antho\Hunyuan3D-2`: Python 3.11 venv for SDXL, rembg cutout and texture paint.
- `C:\Users\antho\Hunyuan3D-2.1`: Python 3.10 venv for shape and bpy finalize.
- `uv` is at `~\.local\bin\uv.exe`, with `UV_SYSTEM_CERTS=1` (the PC re-signs HTTPS).

**Data files** (in the 2.0 folder): create `bt_units.json`, keyed by slug, e.g.
`{"bt-regent": {"prompt": "...", "height": 1.6, "base": 40}}` with optional `base2` and `yaw`. Then `picks.json` maps slug to a
seed or an absolute PNG path, and `PICKS=` selects the file via env. **Write JSON without a BOM**; PowerShell 5.1 adds one and
`json.load` fails.

**Stages** (templates: `run_wm9_one.sh`, `run_wm10_q.sh`):
1. *(optional)* `concepts_sdxl.py --file bt_units.json --units <slugs> --seeds 0 1 2 3 --style 0.2 --avoid "..."`
2. `stage_cutout.py <slugs>` (2.0 venv)
3. `..\Hunyuan3D-2.1\.venv\Scripts\python.exe stage_shape.py --only <slugs> --faces 10000 [--nocut <slug>]`, about 90 s each.
   Display bases are auto-cut.
4. `stage_paint.py --only <slugs> --texture 1024` (2.0 venv), about 20 s each.
5. `..\Hunyuan3D-2.1\.venv\Scripts\python.exe stage_finalize.py <repo>\public\assets\models <slugs>` scales to height, adds a black
   base and a matte material, and writes `<slug>.glb` plus contact sheets. **Read the contact sheets before wiring**; copy them
   to `art/figure-sheets/`.

**Throughput and rules:**
- About 12 minutes per 5 figures. One GPU job at a time.
- Don't upgrade `transformers` 4.48.3 or `diffusers` 0.32.2 in the 2.0 venv.
- Weights are plain files in `~\.cache\hy3dgen`.
- The viewer is `view_models.bat` (port 8765).
- The Hunyuan licence is non-commercial, which matches this fan project.

**Game side** (copy Whirr's `src/client/figures/`):
- `glbModels.ts` holds `GLB_SLUG_BY_MODEL` (variant id → `bt-<chassis>` slug; both variants of a chassis share the sculpt).
- `public/assets/models/manifest.json` lists the enabled slugs; unlisted slugs are never requested, so there are no 404s.
- `glbLoader.ts` never suspends: it returns null until loaded, and the procedural figure shows meanwhile. `glbPaint.ts` is the
  hue-band army painter. A test checks the lists match the files on disk.
- **Before overwriting GLBs,** `git mv` the old ones to `art/archive/` in the same commit.

**BattleTech-specific figure needs (decide in M3, spike first):**
- **Torso twist is a rule and must be visible.**
  - Add a finalize step (bpy, 2.1 venv) that **splits each GLB at the hip plane** into `lower` (legs) and `upper`
    (torso, arms, cockpit) nodes. Store the pivot at the torso centre.
  - The client rotates `upper` ±60° for a twist. Facing rotates the whole figure.
- **Limb loss is common.**
  - Split the arms off as their own nodes (cut planes at the shoulders) so a destroyed arm can be hidden, with sparks and
    smoke at the stump.
  - If clean cuts fail on a sculpt, fall back to scorch, smoke and a "destroyed" decal on that location.
  - Write a per-slug cut-plane table in `bt_units.json` (`cuts:{hip:y, lShoulder:[x,y], rShoulder:[x,y]}`), tuned by looking at
    the sheets.
- **Status visuals:**
  - prone (tip the figure on its side, facing kept);
  - shutdown (lights out, a slump tilt);
  - heat glow (an emissive tint scaled by the heat level: orange at 10+, red at 20+);
  - smoke by damaged location, an ammo-explosion fireball, a destroyed wreck (darken, collapse, smoke column);
  - the ejection pod later.
- **Heights.** A 'Mech is two levels tall; scale the figures so a light reads clearly smaller than an assault (a 25 t Solitaire
  vs a 90 t Regent). Suggested ratio: light 0.8, medium 0.9, heavy 1.0, assault 1.1 of the base height.
- **Jumping.** The figure arcs with jet-flame VFX.

### D.4 Sound and music (copy Whirr's tools and client verbatim)
**SFX and voice pipeline:**
- **Manifest.** `tools/audio-manifest.json` is
  `{voice:{voiceId, voiceName, modelId:"eleven_flash_v2_5"}, music:{endpoint:"/v1/music", modelId:"music_v1", forceInstrumental:true, outputFormat:"mp3_44100_128"}, items:[...]}`.
  Each item is `{id, kind: sfx|voice|music, group, prompt|text, durationSeconds, promptInfluence, loop?}`, mirrored at runtime in
  `src/client/audio/manifest.ts`.
- **Generation.** `tools/gen-audio.ts` is idempotent and skips files that exist.
  - Options: `--kind=sfx,voice` (music is opt-in with `--kind=music`), `--only=<prefix>`, `--dry`.
  - Env: `CREDIT_CEILING`, `RUN_BUDGET` (default 12000).
  - To redo a sound, edit the prompt, delete the mp3, and rerun.
- **Audition.** `public/sounds.html` is the audition page. The owner listens on Pages, names the ids to redo, and only those are
  regenerated.
- **Loudness.**
  - `npx tsx tools/measure-audio.ts <prefix>` prints RMS, peak and crest. Target RMS is about 0.15–0.18; guns need crest ≥8.
  - Per-asset trims go in `src/client/audio/trims.ts`. **Ship the measure tool and trims with the first SFX batch.**
- **Layer instead of re-prompting.** When the owner likes a sound but wants more of it, `tools/compose-audio.ts` layers clips
  from `tools/audio-src/`.
- **Weapon flavour map first.** `src/client/weaponFlavour.ts` maps every weapon id to one flavour (longest-slug match), and both
  the sounds and the VFX read it.
  - A test fails if any weapon in the data has no flavour; Whirr caught missing ones this way.
  - The BattleTech flavours are listed below.
- **Prompt lessons:**
  - Describe the *mechanism*, not the name. "Bolter" alone sounded like a silenced pistol.
  - State exclusions ("no music, no voices, no clicks").
  - promptInfluence is 0.45–0.75 (0.7+ to follow the prompt literally).
  - SFX are 0.5–1.5 s, deaths and explosions 1.2–3 s.
  - Guns need "single sharp report, fast attack".
- **Audio manager.**
  - Buses: master, sfx, voice and music, with a limiter on sfx.
  - Throttling with detune jitter; unlocked on the first click.
  - Volumes and mute are persisted.
  - The music bus sits at −14 dB and is ducked −6 dB under narrator lines, with 2 s crossfades.
  - Music streams through `<audio>` elements; a decoded 150 s track is about 50 MB.

**BattleTech sound list (first pass, about 60 files):**
- **'Mech movement:**
  - footsteps by weight class (light servo-thud to assault ground-shaking stomp with hydraulic hiss);
  - a torso-twist servo whine;
  - jump-jet ignition, thrust and landing;
  - a fall crash; standing up.
- **Weapon flavours** (each distinct, described by mechanism):
  - lasers: small, medium and large beams, ER (sharper crackle), pulse (rapid stutter), heavy (deep thrum), X-pulse;
  - PPC: a charged particle discharge, a crackling thunderclap;
  - autocannon: LB-X (a heavy cannon report), RAC (a rotary roar), ProtoMech AC;
  - Gauss: a capacitor whine, then a magnetic slug crack;
  - missiles: LRM ripple salvo, SRM and Streak launch whoosh, MML, impact clusters;
  - machine gun;
  - physical: punch, kick, charge impact, DFA.
- **Damage:**
  - armor hit clang, internal structure crunch, a critical-hit alarm stab;
  - limb blown off, ammo explosion, engine breach and reactor shutdown;
  - destroyed 'Mech (a big explosion plus debris);
  - pilot hit (cockpit sparks and a grunt).
- **Heat and systems:**
  - a heat-warning alarm (original tones, not a copy of any video game);
  - shutdown power-down, startup power-up, coolant vent hiss.
- **Narrator and computer voice** (all lines our own words):
  - phases: "Initiative", "Movement phase", "Ranged attacks", "Physical attacks", "Heat phase";
  - "Critical hit!", "Ammunition explosion!", "Shutdown!", "'Mech destroyed", victory, defeat.
  - Consider a second, cockpit-computer voice for heat and damage warnings. Write original lines and never imitate the
    MechWarrior "Betty".
- **UI and dice:** clicks, 2d6 rattle, a turn bell.

**Music (ElevenLabs Music, about 12.5 credits per second; a 502 is still charged):**
- **Tracks:** a title theme (60–90 s, loopable), 2 battle loops (2–3 min, low-mid intensity), victory and defeat stingers. Two
  candidates each; the owner picks by ear on `sounds.html`.
- **Direction:** gritty military-industrial orchestral with heavy synth bass, taiko and anvil percussion, low brass, and a driving
  machine pulse. No vocals. Never imitate any existing BattleTech or MechWarrior soundtrack.
- **Cost check.** Measure the cost on the first track (from the subscription delta) and confirm with the owner before spending
  more than ~5k credits.
- **Faction themes later** (Whirr had `setTheme` per faction).

### D.5 Board, terrain, lighting and UI
- **Hex board rendering.**
  - A ground mat per map theme: Grasslands (green) and Desert (sand). Use Whirr's `art/board-textures/gen.py` with CC0 Poly
    Haven bases at 1k, credited in `CREDITS.md`.
  - A thin hex-line overlay (shader or a texture) that the player can toggle, plus hex labels on hover.
  - Elevation is drawn as stepped terraced hexes, with a sloped look optional.
  - Water is drawn as transparent depth-tinted hexes.
- **Terrain pieces.**
  - Woods are Hunyuan GLB tree clumps: light (sparse) and heavy (dense), instanced per hex.
  - Rough is rock scatter.
  - Buildings come later.
  - **Flat terrain is procedural.** Image-to-3D can't do flat terrain (a Whirr lesson), so water, rough ground decals and level
    steps are procedural.
- **The engine reads terrain from data, never from meshes.** Visuals must not hide 'Mechs: cap tree height below a 'Mech's
  shoulders, and fade trees near the selected 'Mech.
- **Terrain GLB budget:** about 6k triangles each (decimate with `Hunyuan3D-2\terrain_post.py --faces 6000`), with textures at
  1024 JPEG q85.
- **Terrain prompts.** Use negative prompts ("multiple views, collage, turnaround sheet, black base"). Scale by the footprint,
  then clamp an extra y-only scale to [0.8, 1.35]. Fit pieces with Whirr's `board/terrainFit.ts`.
- **Lighting.** Ambient, fill and a sun key light. Map themes set the light and fog tint (Whirr's `board/boards.ts` pattern).
- **UI theme.** Dark charcoal and gold: `--bg:#14161a; --fg:#e8e6e1; --card:#1e2127; --accent:#c9a227`. Add a hazard amber or
  heat red as a second accent.
- **The BattleTech-specific UI is the heart of this game. Build it in M3:**
  - **Record sheet panel** (our own layout, not Catalyst's):
    - an armor/internal paper-doll by location (front and rear), filled by damage;
    - the weapons table with range bands and heat;
    - the crit-slot list per location, with destroyed slots struck through;
    - ammo bins with counts;
    - the heat scale with the current level and the effects at each threshold;
    - pilot hits and consciousness targets;
    - MP walk/run/jump, current versus base.
  - **Movement:**
    - Hex highlights showing walk (green), run (amber) and jump (blue) reach.
    - A path preview with MP spent, facing arrows and terrain costs.
    - The resulting target modifier ("+2 TMM") and the heat added.
    - Click a hex, then click or rotate to choose the final facing.
  - **Firing:**
    - Arcs drawn on the board (front, sides, rear; torso-twist preview).
    - LOS lines with a "why" overlay listing the intervening woods and partial cover.
    - Range bands as hex rings per weapon.
    - Weapon checkboxes with a live heat total and the to-hit breakdown per weapon.
  - **Dice tray** for every roll type: to-hit, hit location, cluster, crit check, crit slot, PSR, consciousness, heat avoid rolls
    and ammo explosion. A test enforces that every roll purpose has a renderer (Whirr's `dice/diceView.ts` Record pattern).
  - **Event feed** with full breakdowns: to-hit math, location hit, armor/internal before and after, crits, transfers.
  - **Threat view:** which enemy weapons can reach a hex next turn.

---

## Part E: BattleTech Classic rules as the engine must implement them

**Sources, in priority order:**
1. The **Core Box rulebook (72 pp) and record-sheet booklet**, or the **2026 Core Rulebook** (CAT37101, 274 pp, general retail
   2026-09-23). These need the owner's copy or purchase (Part A).
2. The **Master Changelog v2** (174 changes, TW/BMM → Core Rules), mirrored at
   https://assets.tabletopbattles.com/wp-content/uploads/2026/06/Master-Changelog-v2.pdf, plus Tabletop Battles' "BattleTech Core
   Rules: updates for existing players" article. Download the PDF into `docs/sources/` (free, direct).
3. The free official PDFs at https://battletech.com/downloads/: Quick-Start Rules, Essentials QSR, the AGoAC record sheets and the
   blank record sheets. The QSR dated 2026/07 may still be the legacy text (verify).
4. Total Warfare and the BattleMech Manual knowledge, as a fallback only, with a `RULING:` for every use.
5. MegaMek, as a behavioural cross-check (`MegaMek/megamek` code; it is adopting the Core Rules in v0.51.01, late October to
   mid-November 2026).

Everything below is TW-era knowledge with the known 2026 deltas folded in. **Every table must be verified against source 1 or 2
before the spec freezes in M0.** Write all specs in our own words.

### E.0 Known 2026 Core Rules changes vs Total Warfare (from the changelog coverage)
- **Initiative is front-loaded** (verify exactly what that means for movement order).
- **Deployment.** Units move onto the board from their own edge. You may start at half ammo or with equipment switched off.
- **Movement:**
  - Water can be entered at a walk with no PSR, or at a run with a PSR.
  - Backward level changes are standard.
  - Units may pass through immobile enemy units.
  - **Skidding is removed.**
  - Standing up is at −1 to the PSR and generates no heat.
- **Ranged combat:**
  - The weapon attack phase is renamed the **Ranged Attack Phase**.
  - Torso twist is allowed in either attack phase.
  - **The target movement modifier lasts the whole turn.**
  - Aimed shots hit their location on 4+ on 1d6 (aimed shots need a targeting computer or an immobile target).
- **Physical:**
  - Punch and kick both take −1 to hit.
  - Displacement is resolved at the end of the turn.
  - Charge damage = (weight ÷ 5) × (charger TMM + 1) (verify rounding).
- **Criticals:**
  - Each foot, leg, hip or leg-actuator crit is −1 MP, down to a minimum of 1 Walk MP.
  - Losing a leg leaves Walk 1 / Run 2 with a +4 PSR modifier.
  - An ammo explosion without CASE is capped at 20 internal damage plus loss of the linked armor; with CASE the cap is 10.
  - An explosion causes 1 pilot hit.
- **Heat.** An overheat shutdown no longer forces a fall PSR.
- **PSRs and pilot checks:**
  - The "seatbelt" check after a fall is a straight PSR.
  - Consciousness is checked once per phase.
  - There is a new sensor check.
  - Entering ice is a PSR at +1.
- **Removed:** ammo dumping, fall facing, skidding, rules levels (one core plus optional rules).
- **Equipment:** some items were removed (flail, flechette and fragmentation ammo…) and some added (plasma rifles, Blue Shield,
  stealth systems, shields). C3 was reworked.

### E.1 Game format for the first release
- **The Core Box intro mission first:** Eris and Uziel against Solitaire and Rakshasa on Arid Canyons / Scorched Oasis (verify
  the forces, map and deployment from the booklet).
- **Then the 5 Core Box missions** (only "Focal Point" is named publicly), with BV force building at 4/5 skills.
- **Weather complications** (smoke, heat, wind, visibility) come in M8.
- **Victory:** destroy or cripple the enemy force, or meet the mission objectives. Add forced withdrawal as an option (verify
  whether the Core Box uses it).

### E.2 Turn sequence
1. **Initiative phase:**
   - Each side rolls 2d6 (re-roll ties). The loser moves first.
   - With unequal unit counts, the side with more units moves several per turn so that both finish together (the ratio rule).
   - Fire is effectively simultaneous.
   - Apply the 2026 "front-loaded initiative" change (verify).
2. **Movement phase:** units alternate per initiative.
3. **Ranged Attack phase:**
   - Units declare in initiative order; resolve one unit at a time.
   - **Damage takes effect at the end of the phase**, so a 'Mech destroyed this phase still fires.
   - The PSRs this phase triggers are resolved at the end of the phase.
4. **Physical Attack phase:** the same declare-and-resolve pattern, with damage at the end of the phase.
5. **Heat phase:** add the heat generated this turn, subtract dissipation, then resolve the threshold effects (shutdown,
   ammo explosion, pilot damage, startup).
6. **End phase:** clean-up, displacement (2026), and checks for mission victory.

**Engine shape.** Each phase has an explicit event sequence and named timing windows, as Whirr had for its attack pipeline.

### E.3 Movement
**Modes:**
- **Stand still.**
- **Walk:** up to Walk MP.
- **Run:** up to Run MP (1.5 × Walk, rounded up); no backward movement while running.
- **Jump:**
  - Up to Jump MP, in a straight-line count of hexes, ignoring terrain cost.
  - Choose any final facing.
  - Height limit: you can't jump up more levels than Jump MP.

**Costs (verify each):**
- Entering a clear hex costs 1 MP. A facing change costs 1 MP per hexside.
- Light woods +1 (total 2), heavy woods +2 (total 3), rough +1.
- Water: depth 1 +1, depth 2+ +3.
- Each level up or down +1. More than 2 levels in one hex is not allowed for 'Mechs.
- Backward movement is walk only. Lateral shift is for quads; skip it.

**Heat from movement:**
- Walking +1, running +2.
- Jumping: the number of hexes jumped, minimum 3.
- Standing still +0.

**Modifiers that movement produces:**
- Attacker movement modifier (on the attacker's own shots): stationary +0, walked +1, ran +2, jumped +3, prone +2.
- **Target movement modifier (TMM)**, by hexes moved this turn:

  | Hexes | TMM |
  |---|---|
  | 0–2 | 0 |
  | 3–4 | +1 |
  | 5–6 | +2 |
  | 7–9 | +3 |
  | 10–17 | +4 |
  | 18–24 | +5 |
  | 25+ | +6 |

  Jumping adds +1. In 2026 the TMM lasts the whole turn.

**PSR triggers:**
- Running onto pavement or ice; entering water at a run (2026).
- Standing up.
- Moving with a damaged gyro, hip or legs (per the rules).
- Jumping with damaged legs or a damaged gyro (verify list).

**Prone and standing:**
- Standing up costs 2 MP plus a PSR (at −1 in 2026), and generates no heat in 2026.
- Prone 'Mechs can only fire with restrictions (verify).

**Path search.** Model movement as Dijkstra over `(hex, facing)` states with MP cost.
- **The engine exports the reachable set**, with mode, cost, path, end facing, heat and TMM. Both the UI highlight and the AI
  read it.

### E.4 Line of sight and arcs
**LOS:**
- Draw a line from hex centre to hex centre.
- **Divided line** (the line runs along a hexside): the defender chooses the hex that is better for them (verify; TW gave the
  choice to the defender).
- Woods: each intervening light woods hex is +1, each heavy woods hex +2. A total of **3 or more woods points blocks LOS.** Woods
  in the target's hex add their modifier but don't count toward the block (verify).
- Elevation:
  - A hex blocks LOS if its terrain height is ≥ both the attacker's and the target's height; 'Mechs are 2 levels tall.
  - The detailed rule compares the intervening height against both ends; implement the TW rule and verify.
- Other 'Mechs never block LOS.

**Partial cover:**
- The target stands one level lower than an adjacent intervening hill or level change, so its legs are hidden: +1 to hit.
- Leg hits strike the cover instead (no damage).

**Arcs:**
- Front: 3 hexsides forward (a 120° cone, extended by hex rules).
- Left and right sides; rear.
- Arm-mounted weapons can also fire into the matching side arc (verify against the 2026 rules).
- **Torso twist:** rotate the torso one hexside left or right for the attack phase. In 2026 it can be done in either attack phase.
- Rear-mounted weapons fire into the rear arc.

**The attack direction** (front, left, right or rear) is decided by the arc of the *target* that the attacker sits in. It picks
the hit-location table.

**Debug overlay:** build the LOS and arc overlay from the engine's verdict object (`reasons[]`, `blockers[]`). It doubles as the
player's LOS view.

### E.5 To-hit
**Target number** = Gunnery skill (default 4) plus:
- **Range:** short +0, medium +2, long +4. Extreme range is optional (skip).
- **Minimum range:** if the target is at or inside the weapon's minimum range, add (minimum − range + 1).
- **Attacker movement** (E.3).
- **TMM** (E.3).
- **Terrain:** woods in the line and in the target hex (+1 light / +2 heavy); partial cover +1; target in water at depth 1
  (partial cover); depth 2+ only allows certain attacks (verify).
- **Heat:** 8–12 +1, 13–16 +2, 17–23 +3, 24+ +4 (verify).
- **Target state:** prone (−2 from an adjacent hex, +1 from range); immobile or shutdown −4.
- **Secondary targets:** +1 in the front arc, +2 in a side or rear arc.
- **Damage and equipment:**
  - sensor hits: +2 per hit;
  - shoulder or arm actuator crits on weapons in that arm;
  - pulse lasers −2 (and X-pulse per its data);
  - a targeting computer −1 for direct-fire weapons.
- **Pilot SPAs** from the Core Box pilot cards (data-driven; verify each).

**Rolls:** 2d6 ≥ target hits. A target over 12 can't be attempted. Each weapon rolls separately.

**AI and preview.** P(2d6 ≥ T) is closed form; expose it from `query.attackPreview`.

### E.6 Hit location, clusters and damage
**Hit location** is 2d6 on the table for the attack direction.

| 2d6 | Front / rear | Left side | Right side |
|---|---|---|---|
| 2 | CT (floating crit) | LT (floating crit) | RT (floating crit) |
| 3 | RA | LL | RL |
| 4 | RA | LA | RA |
| 5 | RL | LA | RA |
| 6 | RT | LL | RL |
| 7 | CT | LT | RT |
| 8 | LT | CT | CT |
| 9 | LL | RT | LT |
| 10 | LA | RA | LA |
| 11 | LA | RL | LL |
| 12 | Head | Head | Head |

All values (verify).

- Rear hits use the rear armor of the torso locations.
- **Punch table** (1d6) and **kick table** (1d6: left or right leg) are separate.

**Cluster weapons** (LRM, SRM, MML, LB-X cluster, MG arrays, ATMs):
- Roll 2d6 on the cluster table for the rack size to get the number of missiles that hit. Then group damage:
  - LRMs: groups of 5;
  - SRMs: 2 damage per missile, one location each;
  - LB-X cluster: 1 damage per pellet per location.
- **Streak:** all missiles hit if the launcher hits; no heat or ammo is spent on a miss.
- Artemis and NARC adjust the cluster roll (Core Box use only if the data needs it).

**Damage application:**
1. Damage strikes armor; the excess goes to the internal structure.
2. When a location's internal structure is gone, the location is destroyed and the excess **transfers inward**: arm → side
   torso, leg → side torso, side torso → CT. Head and CT damage is never transferred; the 'Mech is destroyed.
3. A destroyed side torso destroys the arm on that side, and with an XL engine it costs engine crits (IS XL: a side torso loss
   destroys the 'Mech; Clan XL: it survives with a heat penalty; verify).
4. **Each 20 points of damage in one phase** forces a PSR at the end of that phase.

**Destruction:**
- Head or CT destroyed.
- 3 engine crits.
- 2 gyro crits (immobile rather than destroyed; verify the 2026 rule).
- The pilot killed.
- Both legs destroyed: the 'Mech is immobile and considered destroyed for victory (verify).

### E.7 Critical hits
**The crit check.** Whenever a location takes **internal structure damage**, roll 2d6:
- 8–9: 1 crit;
- 10–11: 2 crits;
- 12: 3 crits, or the limb is **blown off** for arms, legs and head (verify).

The "floating" 2 on the hit table also gives a crit check.

**Picking the slot:**
- A location has 12 slots (torsos, arms) or 6 (head, legs).
- For 12-slot locations, roll 1d6 for the upper or lower half, then 1d6 for the slot. Re-roll empty or already-destroyed slots.

**Effects** (each a data-driven item effect):

| Item | Effect |
|---|---|
| Engine | +5 heat per crit; 3 crits destroy the 'Mech |
| Gyro | +3 to PSRs per crit, and a PSR at once; 2 crits = cannot stand |
| Sensors | +2 to hit per crit; 2 crits = no ranged attacks |
| Life support | Pilot damage from heat at 15+ and 25+ |
| Cockpit | Pilot killed |
| Actuators (shoulder, upper/lower arm, hand) | To-hit penalties for that arm's weapons and physical attacks (shoulder +4; others +1 and/or no punch) |
| Actuators (hip, upper/lower leg, foot) | −1 MP each in 2026, plus PSR modifiers |
| Weapon | That weapon is destroyed |
| Heat sink | Lost dissipation |
| Ammo | **Explodes**: the remaining shots × damage per shot, applied to the internal structure of that location (2026 caps: 20 without CASE, 10 with CASE), plus 1 pilot hit |
| Jump jet | −1 Jump MP |
| CASE | Limits explosion damage to the location |
| Other equipment | Disabled |

**Ammo explosions chain** through the damage pipeline (transfer, more crit checks). Gauss rifles explode when hit (no ammo
needed); verify each weapon's `explodes` flag.

### E.8 Heat
**The ledger.** Each turn, add up:
- movement heat;
- the heat of every weapon fired;
- engine crits;
- environment (later: weather complications).

Then subtract dissipation: single heat sinks 1 each, double 2 each (engine-integral sinks count). Clan and IS doubles take
different numbers of slots. The result moves the heat scale, minimum 0.

**The heat scale** (verify every threshold against the Core Rules):

| Heat | Effect |
|---|---|
| 5+ | −1 Walk MP |
| 8+ | +1 to hit |
| 10+ | −2 MP |
| 13+ | +2 to hit |
| 14+ | Shutdown avoid on 4+ |
| 15+ | −3 MP; life-support pilot damage (if its crit) |
| 17+ | +3 to hit |
| 18+ | Shutdown avoid 6+ |
| 19+ | Ammo explosion avoid 4+ |
| 20+ | −4 MP |
| 22+ | Shutdown avoid 8+ |
| 23+ | Ammo explosion avoid 6+ |
| 24+ | +4 to hit |
| 25+ | −5 MP; life support |
| 26+ | Shutdown avoid 10+ |
| 28+ | Ammo explosion avoid 8+ |
| 30 | Automatic shutdown |

- **Shutdown:** the 'Mech is immobile (−4 to be hit) and can't act. In 2026 it no longer forces a fall PSR. Restart in a later
  Heat phase by rolling the avoid number for the current heat, or automatically once heat falls below 14 (verify).
- **The AI needs a heat knapsack:** pick the weapons that maximise expected damage subject to a projected end-of-turn heat cap
  (by tier: easy ignores heat, normal keeps heat under 8–10 unless it's a kill shot).
- **The UI must show the heat projection before every fire confirmation.**

### E.9 Piloting skill rolls (PSR) and pilot damage
**The roll:** 2d6 ≥ Piloting skill (default 5) plus modifiers. The modifiers are:
- damaged gyro +3 per crit;
- leg or foot actuator crits (per the table);
- a destroyed leg +5 (+4 in 2026);
- hip +2;
- the trigger's own modifier.

**Triggers:**
- 20+ damage in one phase;
- a leg or gyro crit;
- being kicked or charged, or a DFA (both sides);
- failing to stand;
- running on pavement or ice;
- jumping with damage;
- entering water at a run;
- the new 2026 sensor check (verify).

**Failure → fall:**
- Damage = (tonnage ÷ 10) × (levels fallen + 1), in groups of 5, hit-location rolled.
- In 2026 there is no fall facing roll (verify what replaces it).
- The pilot then makes a PSR or takes 1 hit (the 2026 "seatbelt" check is a straight PSR).

**Pilot hits:** 6 hits = dead.
- After each hit, roll consciousness: 2d6 ≥ 3/5/7/10/11 for hits 1–5 (verify). In 2026 this is checked once per phase.
- An unconscious pilot's 'Mech can't act; recovery is rolled in the End phase (verify).

**The PSR queue.** PSRs triggered in a phase are queued and resolved in order at the phase's end. Build one queue.

### E.10 Physical attacks
**General:**
- To-hit = Piloting skill plus the modifiers. In 2026, punch and kick are at −1.
- A 'Mech that fired a weapon from an arm can't punch with that arm; one that fired from a leg (rare) can't kick (verify).

**Attack types:**
- **Punch:** damage = tonnage ÷ 10 (round up), per arm; 1d6 punch location table. Arm actuator crits modify or forbid it.
- **Kick:** damage = tonnage ÷ 5; 1d6 kick table (legs). The target makes a PSR.
  - A missed kick forces a PSR for the attacker (verify 2026).
- **Charge** (moved in the Movement phase into the target's hex):
  - Damage = (weight ÷ 5) × (charger TMM + 1) (2026).
  - The charger takes damage too (tonnage ÷ 10 of the target, verify).
  - Both sides make PSRs.
- **Death From Above (DFA):** a jump into the target.
  - Damage = tonnage ÷ 10 × 3 to the target, on the punch table.
  - The attacker takes tonnage ÷ 5 to its legs and makes a PSR.
  - A miss means the attacker falls.
- **Push and club:** later.

**Displacement** (2026) is resolved at the end of the turn.

### E.11 Ammo, equipment and the Core Box tech list
The eight 'Mechs mix Inner Sphere and Clan tech from the ilClan era. **The equipment catalogue is the biggest data job.** List
every item on the 16 record sheets and build each item with:
- **Ranges:** short, medium and long, plus minimum range.
- **Numbers:** heat, damage, tons, slots.
- **Ammo:** shots per ton.
- **Flags:** cluster, streak, pulse, explodes, one-shot.
- **Rules notes** that need code hooks.

Known so far (G.0):
- **Lasers:** small, medium, large and ER versions; IS and Clan pulse; heavy small, medium and large; improved heavy large;
  ER small; small X-pulse; micro pulse; improved medium.
- **PPCs:** PPC, ER PPC, snub-nose PPC, light PPC with PPC capacitor.
- **Autocannons:** LB 5-X, LB 20-X (slug or cluster ammo choice), RAC/5 (rate of fire and jam), ProtoMech AC/8.
- **Gauss:** Gauss rifle, improved heavy Gauss.
- **Missiles:** LRM 10, SRM 6, Streak SRM 4 and 6, MML 5 (LRM or SRM ammo choice).
- **Other weapons:** machine gun.
- **Equipment:**
  - targeting computer, CASE (and CASE II, if present);
  - XL and Clan XL engines, endo-steel, composite structure;
  - ferro-fibrous and ferro-lamellor armor (damage reduction; verify);
  - double heat sinks (IS and Clan);
  - jump jets and improved jump jets;
  - supercharger.

Each needs its exact 2026 numbers (verify). Ammo choice per bin is a setup decision.

### E.12 Edition leak list (put in every rules prompt)
Agents' training data mixes Total Warfare, older Classic rules, Alpha Strike, the MechWarrior and HBS video games, and MegaMek
options. Guard against each:

| Wrong source | What leaks | Our rule |
|---|---|---|
| Alpha Strike | Damage values like 2/2/1, inch ranges, single structure track | Classic: per-weapon damage, hex ranges, armor and internal per location |
| HBS BattleTech (2018 game) | Stability bar, evasion pips, called shots via morale | Classic PSRs and TMM; aimed shots only per the 2026 rule |
| MechWarrior games | Real-time ghost heat, hitscan beam duration | Heat-scale thresholds, turn-based heat |
| Total Warfare | Skidding, fall facing roll, ammo dumping, shutdown fall PSR, "Weapon Attack Phase" | Removed or changed in 2026 (E.0) |
| Old rules / BMR | Different crit and transfer edge cases | 2026 Core Rules |

`tools/validate-data.ts` should scan data for leak keys (`stability`, `evasion`, `skid`, `ghostHeat`), as Whirr scanned for
MK3 keys.

### E.13 Battle Value and pilots
- **BV for force building.** The Core Box BV table lists each variant at 4/5 skills, with a skill multiplier table. Store the
  base BV in the data, compute the adjusted BV from the skills, and show it on the force picker.
  - Confirmed: BZK-W4 920, UZL-2S 1352, MDG-3D 2100, Mad Cat Mk II 3135, Solitaire 3 1608, ERS-2N 1400, Vulture Mk IV E 2151,
    Regent Prime 2437 (Tabletop Battles review).
- **Pilots.** Eight Core Box pilot cards, each with skills and one SPA costing 2:
  - Bitala van Austen, Erbie Hastelmeyer, Sarkan Huditar, Rayan Joransson, Ingalls Lu, Artesse Rodimar, Nanette Romanov,
    Portala Ventimiglia.
  - Each SPA is data plus a code hook. Names are fine; write the ability text in our own words.

---

## Part F: IP and naming
- **Who owns what.**
  - The BattleTech tabletop is published by **Catalyst Game Labs** under licence. The IP for electronic games sits with
    **Microsoft**, whose *Game Content Usage Rules* govern free fan games. MegaMek's licence cites them.
  - **Follow those rules:** free, non-commercial, no monetisation, and a clear "unofficial fan project, not affiliated with or
    endorsed by Catalyst Game Labs, Topps or Microsoft" notice in the UI and README (verify the current wording of the GCUR
    notice).
- **The Mallet/Whirr posture (settled):**
  - Real 'Mech, weapon, equipment and pilot names are fine.
  - **All prose is ours**: rules text, SPA text, lore, UI copy and docs.
  - **Never** commit Catalyst art, maps, logos, record-sheet layouts or the rulebook text.
  - Never use HBS or MechWarrior game assets, UI or sounds.
  - Figures are generated from reference photos kept outside the repo.
  - The "BattleTech" logo never appears. The title is WarMechForge.
- **Maps.** Hex terrain layouts (which hex is woods or level 2) are transcribed per hex into our own JSON, from the owner's maps
  or by cross-checking MegaMek's `.board` files. They are rendered only with our own art; never ship a scan or image of a
  Catalyst map.
- **MegaMek data** (`MegaMek/mm-data`) is **CC-BY-NC-SA-4.0**. Use it as a **research and cross-check aid** for numbers we enter
  ourselves, as Whirr did with community data. Never commit its files. Credit MegaMek in `docs/` if its data was used to
  verify values.
- `docs/sources/`, `sources-local/` and `refs-local/` are never committed.

---

## Part G: first-release content

### G.0 Data status and how to resolve it (do this in M0)
**Box contents** (Sarna, Miniature Market and the Tabletop Battles review):
- 8 pre-assembled unpainted 'Mechs: **Hollander, Rakshasa, Solitaire, Uziel, Mad Cat Mk II, Vulture Mk IV, Regent, Eris**.
- A 16-page record-sheet booklet with **two variants per 'Mech**.
- 8 pilot cards; 10 Alpha Strike cards (ignore them).
- 2 double-sided maps, giving **4 maps**:
  - Headwater Crossing (the Grasslands #2 layout);
  - Sodden Hills (Grasslands #3);
  - Scorched Oasis (Desert #2);
  - Arid Canyons (Desert #3).
- 36 objective and terrain tokens, 2 d6, a quick reference sheet, a hit-location and cluster card.
- A 72-page rulebook with the intro mission, BV force building, 5 missions and weather complications.
- *BattleTech Sagas*, a lore primer.
- **Retail.** Gen Con 2026 exclusive early; general retail mid-to-late October 2026 (Oct 14, Oct 28 or Oct 31 by source; Sarna
  says November?). MSRP $69.99.

**Variants:**

| 'Mech | Variant A (in BV table) | Variant B | Status |
|---|---|---|---|
| Hollander | BZK-W4 (new: improved heavy Gauss, composite structure, XL) | ? | A: stats (U); B: (U) |
| Uziel | UZL-2S **or** UZL-9S? (BV table says 2S; news says 9S debuts in the box) | the other? | 2S stock known (below); 9S stats (U) |
| Rakshasa | MDG-3D (new Clan-tech refit) | ? | (U) |
| Mad Cat Mk II | base (stock known) | "Mk II 7" (new: RAC/5s replace the Gauss rifles)? | 7 stats (U) |
| Solitaire | Solitaire 3 (new: supercharger, improved heavy large laser, ER smalls) | Prime? | 3 stats (U); Prime known |
| Eris | ERS-2N (stock known) | ? | B (U) |
| Vulture Mk IV | E (new: Streak boat, ProtoMech AC/8, improved medium laser) | Prime? | E stats (U) |
| Regent | Prime (stock known) | A (seen in a photo caption) | both known |

**Stock stats confirmed from MegaMek `mm-data`** (armor HD/CT/LT/RT/LA/RA/LL/RL, rear CT/LT/RT):
- **Hollander BZK-F3** (reference only; the box uses W4): 35 t, 5/8/0, 10 SHS, Gauss (RT); 8/10/8/8/6/6/8/8, rear 3/3/3.
- **Uziel UZL-2S:** 50 t, 6/9/6, 300 XL, 10 DHS; PPC (LA), PPC (RA), MG (LT), MG (RT), SRM 6 (CT);
  9/17/14/14/12/12/18/18, rear 6/4/4.
- **Solitaire Prime:** 25 t, 10/15/0, Clan 250 XL, 10 DHS; heavy large laser (RT), 2× heavy medium laser (LT, CT), heavy small
  laser (LT); 9/10/9/9/8/8/12/12, rear 3/3/3.
- **Eris ERS-2N:** 50 t, 5/8/5, 250 XL, 10 DHS; snub-nose PPC (RA), 2× small X-pulse (LA), small X-pulse (HD), 2× MML 5 (LT, RT);
  9/23/18/18/15/15/22/22, rear 8/5/5.
- **Regent Prime:** 90 t, 3/5/0, 19 DHS; 3× ER large laser (RA, LT, RT), LB 20-X (RT), Streak SRM 4 (LT), 2× medium pulse (LA,
  RA), micro pulse (HD); 9/42/28/28/30/30/38/38, rear 16/10/10.
- **Regent A:** the same chassis and armor, 26 DHS; 3× ER PPC (RA, LT, RT), ER medium laser (HD).
- **Rakshasa MDG-1A** (reference; the box uses 3D): 75 t, 5/8/0, 375 XL, 15 DHS; 2× ER large (LA, RA), 2× medium laser (LA, RA),
  2× LRM 10 (LT, RT), medium pulse (LT); 9/32/22/22/21/21/28/28, rear 9/7/7.
- **Mad Cat Mk II:** 90 t, 4/6/3, 14 DHS; 2× Gauss (LA, RA), 4× ER medium (2 LT, 2 RT), 2× LRM 10 (LT, RT);
  9/38/26/26/27/27/34/34, rear 12/8/8.
- **Vulture Mk IV Prime:** 60 t, 5/8/0, 12 DHS, ferro-lamellor; ER PPC (RA), LB 5-X (LA), 4× SRM 6 (2 LT, 2 RT), 2× ER small
  pulse (CT); 9/30/20/20/20/20/28/28, rear 10/8/8.

**How to resolve the (U) rows, in order:**
1. The owner's booklet (Part A, question 1).
2. Sarna's per-variant pages (sarna.net/wiki/<Chassis>); Sarna adds new variants within weeks.
3. MegaMek `mm-data` commits after 2026-10 (the new variants are not there yet). Raw path:
   `https://raw.githubusercontent.com/MegaMek/mm-data/main/data/mekfiles/meks/<folder>/<Chassis> <Model>.mtf`
4. The Tabletop Battles Core Box review and its photos, reddit r/battletech unboxing threads, retailer image galleries.
5. The Master Unit List (masterunitlist.info; it was down on 2026-10-07, so retry).

- Each value in `src/data/mechs/<chassis>/<variant>.json` carries a `source` field. Variants with an unconfirmed value carry a
  `verify` note and a line in `docs/spec/mechs-sources.md` (the Whirr pattern from M10: value by value, with what matched and
  what changed).
- **Never ship a stand-in variant silently.** If a box variant can't be sourced by M2, play the slice with the stock variants
  above, labelled "(stock)" in the UI, and list the gap in the morning summary.

### G.1 Content order
1. **Vertical slice (M3):** the intro mission, 2 v 2 (Eris + Uziel vs Solitaire + Rakshasa), one map.
2. **Full box (M5–M8):**
   - all 8 'Mechs × 2 variants; 4 v 4 lances;
   - all 4 maps;
   - the 5 missions;
   - BV force building with pilot picks and SPAs;
   - weather complications.
3. **Later (owner's call):**
   - the Starter Box 'Mechs (Hammerhead, Kontio);
   - ForcePacks (the Illician Lancers Command Lance — Scarabus, Ostsol, Ostroc, Ostwar — reaches retail 2026-10-14 and has
     free record sheets at
     battletech.com/wp-content/uploads/sites/6/2026/07/ForcePack-Record-Sheets-Illician-Lancers-Command-Lance.pdf);
   - buildings, vehicles and infantry;
   - a random map generator;
   - campaign play.

---

## Part H: milestone plan (ordered by both games' hindsight)

Each milestone is one or more lean workflow stages, ending in a push and something visible. Whirr Machine did M0–M3 in about a
day; aim for the same.

**M0, Foundation**
- **Scaffold:**
  - Create `C:\Users\antho\OneDrive\Documents\WarMechForge\warmechforge` by copying Whirr's config: package.json scripts,
    vite, playwright, tsconfig, deploy.yml, `.gitattributes`, `.gitignore` with `*.token*`, `Tokens.txt`, `.env*` and
    `docs/sources/`.
  - Create the GitHub repo (`gh repo create dragoonant/warmechforge --public`) and enable Pages (GitHub Actions source).
  - Push a hello page, then curl the Pages URL.
- **Docs:** `CLAUDE.md` (Part B plus the IP rule), `HANDOFF.md`, `STATUS.md`, `PLAN.md`.
- **Sources:**
  - Download the changelog PDF and the free battletech.com PDFs into `docs/sources/`.
  - Extract them with `pdftotext` into the scratchpad.
  - Run the G.0 research for the (U) variants.
- **Specs:** `docs/spec/00`–`70`. The frozen contracts must include, from day one:
  - hex coordinates and facing types;
  - the phase machine with simultaneous-damage windows;
  - the PSR queue;
  - the heat ledger;
  - the damage pipeline as an explicit event sequence;
  - every `PendingDecision` kind: initiative ack, unit-to-move choice, move path + facing, torso twist, weapon selection and
    targets, ammo choice, physical attack choice, stand-up attempt, shutdown override where allowed.
- **Rules checklist with IDs:** `INIT-`, `HEX-`, `MOVE-`, `LOS-`, `ARC-`, `TOHIT-`, `HITLOC-`, `CLUS-`, `DMG-`, `CRIT-`,
  `AMMO-`, `HEAT-`, `PSR-`, `PILOT-`, `PHYS-`, `EQUIP-`, `SCN-`, `BV-`.
- **Golden test spec** (`13-golden`): transcribe a worked example from the Core Box rulebook or the QSR (an attack with to-hit
  math, hit location and damage). It becomes `tests/engine/golden.test.ts` with forced dice (Whirr's `vi.mock` of `roll()` with
  a `FORCED` map by `rollSeq`).
- One adversarial spec review.

**M1, Hex geometry, LOS, movement search, headless sim**
- `hex.ts`: axial/cube conversion, `XXYY` labels, neighbours, distance, hex lines with divided-line detection, arcs by facing,
  torso twist.
- `los.ts`: levels, woods counting, partial cover; returns a verdict with reasons.
- `movement.ts`: the reachable set over (hex, facing) with costs and PSR flags.
- `validate-data` and `npm run sim` exist from this milestone on.
- The sim has invariants, a 5000-decision cap, a 200-decision stall detector, save/load mid-game and replay determinism.

**M2, Rules core**
- Initiative, all phases, to-hit, hit location, clusters, the damage pipeline, crits, ammo explosions, heat, PSRs and falls,
  pilot hits and consciousness, physical attacks, shutdown and startup.
- The equipment catalogue for the slice 'Mechs.
- Victory checks.
- Golden test passing.
- Verify loop ON (the rules are dense).

**M3, Playable vertical slice on Pages (the most important milestone)**
- **Board:** the hex board and one map (Arid Canyons or Scorched Oasis) with procedural terrain.
- **'Mechs:** the 4 intro 'Mechs as procedural figures. Use a simple 'Mech kit (legs, torso, arms) that already supports torso
  rotation and arm hiding.
- **UI from the first client stage:**
  - the presentation director;
  - explanatory prompts with exact odds;
  - movement reach highlights with facing;
  - LOS and arc overlays;
  - the record-sheet panel and heat projection;
  - the dice tray and event feed.
- A random bot, so the owner can play end to end.
- **Owner gates:**
  - the figure proportions (2 'Mechs through the full pipeline, D.1);
  - the hip and shoulder split approach (D.3).

**M4, AI opponent**
- **A utility decider in a worker:**
  - movement chosen over the reachable set, scored on expected damage dealt next phase minus expected damage taken (from enemy
    reach, arcs and LOS), plus a rear-arc avoidance and gain, a TMM value, a cover value, and objectives;
  - facing and torso twist to present the strongest armor;
  - the heat knapsack for weapon selection;
  - physical attack choice;
  - target focus (kill probability per location, "finish the cripple");
  - a shutdown and ammo-explosion risk cap.
- **Closed-form math:** 2d6 to-hit, hit-location distributions per direction, cluster-table expectations, and P(location
  destroyed).
- **Tiers:** random, easy, normal.
- **Gate:** `npm run bench:ai -- --games 20 --seed 1` with normal beating random ≥18/20 and 0 rejections, stalls or fallbacks.

**M5, Art pass:** concepts and GLBs for all 8 'Mechs (split nodes), the army painter, status visuals, VFX (beams, tracers,
missile trails, explosions, jump flames, heat shimmer), terrain GLBs (woods, rocks), ground mats, title art.

**M6, Audio and music:** the weapon-flavour map, SFX, narrator and cockpit voice, the measure tool and trims, music, the
`sounds.html` audition, and an owner feedback round.

**M7, Polish:** feed breakdowns, the end screen with damage per location, settings, Low graphics, narration pauses, hover tips,
How to Play tabs (movement, heat, crits, physical attacks), and the in-game painter.

**M8, Full box:** all 16 variants, all 4 maps, the 5 missions, BV force building with pilots and SPAs, weather complications, and
an any-vs-any force picker.

**Later:** ForcePacks, the Starter Box 'Mechs, buildings, vehicles, a campaign, and multiplayer (on hold, as in Whirr).

---

## Part I: bug list from both games (avoid repeating these)

**Engine**
- `legalActions` empty for an open decision, so the bot froze. Keep the invariant in the sim and a fuzz test
  (`action-fuzz.test.ts`: seeded random play asserting a non-empty, validating legal set).
- The planner's arrangement was used as the feasibility test.
- AI deployment crashed in shallow zones; it needs a chain fallback. Here, edge entry must always find a legal hex and facing.
- A Mallet ability was re-offered forever at 0 CP, giving 3,700+ decision games. Hence the decision cap and stall detector.
- Expiry overwrite instead of max on stacking durations.
- Whirr: abilities registered as plugins that core code never called (Serenity, Arc Node, Annoyance). **Every code hook must have
  a test proving it fires in a real game**, and `validate-data` must check that every referenced hook is registered *and*
  wired.
- Whirr: targeted special actions auto-picked their target because `needsTarget` was a whitelist. Make target selection
  generic.

**UI**
- The UI showed the previous roll's target number.
- UI arithmetic for target numbers ignored modifiers. The engine supplies every number.
- The dice tray sat behind the decision prompt; it belongs in the right rail.
- Some roll types never reached the dice tray.
- The deploy panel hid Confirm and Reset.
- Faction picks in e2e matched substrings.
- Mallet: prompts with no context ("re-rolling without even knowing what I'm re-rolling for").

**Art and audio**
- Every ranged weapon played one sound. Build the flavour map first.
- The Hunyuan style reference turns everything blue without `--style 0.2 --avoid`.
- Floor-length parts break the base auto-cut; use `--nocut`.
- GLBs are fused meshes. Plan the node splits (D.3) before generating 16 variants.
- Locking the figure look late threw away a whole v1 set. Gate the proportions at M3.
- Gemini returned normal proportions when only a style label was given. State the proportions in numbers.
- Mallet: "gargle/grunt" made Orks sound like frogs, and Ork guns were 3× louder. State exclusions and ship trims with the first
  batch.

**Performance and bundle**
- One 1.6 MB JS chunk. Code-split the start screen, the game, and the AI worker.
- Terrain GLBs at 12k triangles cost frame time on the overview camera (76–86 ms headless). Decimate to about 6k from the
  start.
- `baseEdgePoints` gap tests were about 85% of Mallet's sim time. Memoize the geometry (hex lines and LOS) by hex pair.

---

## Part J: first actions for the next agent
1. Read this file. Write the project memory (see below). Send the owner **one** ≤10-line check-in: the Part A questions plus
   the rules-edition statement.
2. Scaffold the repo (M0), create the GitHub repo, and push the hello page.
3. Download the free PDFs and the changelog into `docs/sources/`. Start the G.0 variant research with one cheap agent first.
4. Write `tools/workflows/w0-foundation.js` (spec stage) modelled on Whirr's `w1-engine.js`, and run it lean, except for the
   rules specs.

**Files worth copying or reading.** Whirr Machine (`C:\Users\antho\OneDrive\Documents\WarMForge\whirr-machine\`) is the primary
template:
- **Process:** `CLAUDE.md`, `tools/workflows/{w1-engine,w3-client,w4-ai,w6-audio,w10-backlog}.js`.
- **Config:** `.github/workflows/deploy.yml`, `vite.config.ts`, `playwright.config.ts`, `tsconfig.json`, `.gitattributes`,
  `.gitignore`.
- **Engine:** `src/engine/{rng,decider}.ts`, plus `index.ts` for the API shape.
- **AI:** `src/ai/{prob,worker,tiers}.ts`, `src/client/bot/{botDriver,aiWorkerClient}.ts`.
- **Client:**
  - `src/client/{store,presentation,dice,audio,figures,vfx}/`;
  - `src/client/board/{frameRate,terrainFit,boards}.ts`, `Camera.tsx`;
  - `src/client/store/testHooks.ts`, `src/client/weaponFlavour.ts`.
- **Tools:** `tools/{sim,ai-bench,validate-data,gen-audio,compose-audio,measure-audio}.ts`, `tools/audio-manifest.json`,
  `tools/out/{fps-probe,console-probe}.mjs`.
- **Tests:** `tests/e2e/policy.ts`, `tests/engine/{golden,action-fuzz}.test.ts`, `tests/fixtures/synthetic-decisions.ts`.
- **Assets:** `public/sounds.html`, `art/board-textures/gen.py`.

From Mallet 42k (`C:\Users\antho\OneDrive\Documents\Mallet-42k\`):
- `docs/HANDOFF-hunyuan-install.md` and `docs/HANDOFF-sd-figures-v2.md`;
- `src/client/dev/scenarios.ts` (on origin/main; local `main` is 69 commits behind);
- `docs/spike-incursion.md` (perf numbers).

From the Hunyuan folders: `C:\Users\antho\Hunyuan3D-2\{run_wm9_one.sh, run_wm10_q.sh, stage_*.py, terrain_post.py, wm_units.json}`
and `C:\Users\antho\Hunyuan3D-2.1\{stage_shape.py, stage_finalize.py, finalize_model.py, render_views.py}`.

**Memory.** Sessions started in `WarMechForge` load memory from
`~\.claude\projects\C--Users-antho-OneDrive-Documents-WarMechForge\memory\`. It was pre-seeded on 2026-10-07 with:
- the pipeline notes (audio, Hunyuan, Gemini browser and clipboard guard);
- the owner's working rules (do the legwork, research before assuming, figure proportions);
- this project's decisions.

Keep it current.
