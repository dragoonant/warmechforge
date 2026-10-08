// M5-content (pulled forward from M8 while the figure gate and the audio key wait on the owner).
// Workflow({ scriptPath: 'tools/workflows/w5-content.js' })
export const meta = {
  name: 'w5-content',
  description: 'WarMechForge: engine freeze fix, stock data for all 8 Core Box chassis, the 4 Core Box maps, skirmish force/map picker',
  phases: [
    { title: 'Build', detail: 'engine fix, mech data, maps' },
    { title: 'Verify', detail: 'adversarial data check vs MegaMek MTFs' },
    { title: 'Ship', detail: 'fixes, skirmish picker, gates, e2e, commit, push' },
  ],
}

const ROOT = 'C:/Users/antho/OneDrive/Documents/WarMechForge/warmechforge'
const ATTR = 'Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>'
const RESULT = { type: 'object', properties: { ok: { type: 'boolean' }, summary: { type: 'string' }, files: { type: 'array', items: { type: 'string' } }, issues: { type: 'array', items: { type: 'string' } } }, required: ['ok', 'summary', 'files', 'issues'] }
const VERDICT = { type: 'object', properties: { verdict: { type: 'string', enum: ['pass', 'fail'] }, failing: { type: 'array', items: { type: 'object', properties: { owner: { type: 'string', enum: ['mechs', 'maps', 'engine'] }, where: { type: 'string' }, problem: { type: 'string' }, fix: { type: 'string' } }, required: ['owner', 'where', 'problem', 'fix'] } }, notes: { type: 'string' } }, required: ['verdict', 'failing', 'notes'] }

const COMMON = `Project root: ${ROOT} (git repo, main, remote github.com/dragoonant/warmechforge, Pages live). Windows; absolute paths, the cwd resets. Run long commands in the FOREGROUND. Orient from ${ROOT}/STATUS.md and HANDOFF.md, then only the spec sections named. Game: BattleTech Classic (2026 Core Rules) vs AI; engine in src/engine (frozen contracts: additive only, logged in docs/spec/00-architecture.md §14), data in src/data validated by 'npm run validate:data' against docs/spec/schemas. IP: names fine, all prose ours; MegaMek mm-data (CC-BY-NC-SA) is a cross-check aid: never commit its files, credit MegaMek in CREDITS.md when used, every record's source note says what was checked. Concurrent agents share the tree: touch only files you own, never git commit or npm install unless told. Rulings: "RULING: rule | what we did | why" in issues. Final output is raw JSON.`

phase('Build')
const build = await parallel([
  () => agent(`${COMMON}
Task: engine robustness. You own src/engine/movement.ts, src/engine/phases/movement.ts, src/engine/describe.ts, tests/engine/move*.test.ts, tests/engine/action-fuzz.test.ts, tests/engine/describe*.test.ts.
1. BUG: legalActions/query.reachable can be EMPTY: a 'Mech that fails a PSR while passing through a friendly unit's hex falls and ends in that shared hex; after standing with 1 MP left, reachable() filters out the occupied start hex and no neighbour is affordable. Per 10-rules-core (stacking/ending movement rules; grep MOVE- for occupied hexes), make this legal and never empty: e.g. the unit must be allowed to end its move in place (or 'stand still' is always offered), and any rule-required displacement is applied. Find the 2026/AGoAC rule for a unit that ends in a friendly-occupied hex after a fall (grep docs/sources/agoac-rulebook.txt for 'stacking' / 'occupied'); add a RULING if unclear. Add a regression test reproducing it (construct the state directly).
2. Strengthen tests/engine/action-fuzz.test.ts: 200 seeded random games (short turn limit) asserting legalActions is non-empty for every open decision and every listed action validates; make it fast (<20 s).
3. describe.ts: ammo choice labels and decision lines print raw ids (e.g. 'is.ammo.mml-5-lrm (24)'); use the ammo record's display name (e.g. 'MML 5 LRM ammo (24 shots)').
Run npm run typecheck and npm test. Return JSON: ok, summary (<=80 words), files, issues.`, { label: 'engine-fix', phase: 'Build', schema: RESULT, effort: 'high' }),
  () => agent(`${COMMON}
Task: 'Mech data for the whole Core Box roster using public STOCK variants (the box's new variants have no public stats; see tools/out/variant-research.md). You own src/data/mechs/** (add new chassis folders; do not change the existing eris/uziel/solitaire/rakshasa files except to add second variants beside them), src/data/core/** (add any missing weapons/ammo/equipment), src/data/forces/**, docs/spec/mechs-sources.md, tests/data/*.test.ts.
Read docs/spec/20-data-schema.md and the existing src/data/mechs/eris/*.json as the pattern. Enter, from MegaMek mm-data MTF files (raw.githubusercontent.com/MegaMek/mm-data/main/data/mekfiles/meks/...; find paths via the GitHub API or search, max ~20 fetches total) cross-checked against the brief docs/BATTLETECH-HANDOFF.md lines 1016-1032:
- Regent Prime and Regent A; Mad Cat Mk II (base); Vulture Mk IV Prime; Hollander BZK-F3 (stand-in for BZK-W4, labelled stock); and a second stock variant for each of Eris, Uziel, Solitaire, Rakshasa, Mad Cat Mk II, Vulture Mk IV, Hollander where a standard one exists (prefer ones close to the box era).
- Every value with a source; stock:true and a standIn verify note where the box variant differs; BV from MUL (tools/out/variant-research.md lists MUL urls) where available.
- Full crit slot tables; the tonnage audit in validate-data must close for every 'Mech.
- Any new weapon/equipment (e.g. Clan ER PPC, LB 5-X, LB 20-X with slug/cluster ammo, Streak SRM 4, ER small pulse, micro pulse, Gauss rifle, ferro-lamellor armor, endo steel...) gets exact numbers from MegaMek equipment classes (cross-check) and a code hook name where the engine needs special handling (list hooks the engine lacks in issues as "ENGINE: <item> needs <behaviour>").
- Add skirmish forces: one lance per side presets (e.g. 'Eris Lance' and 'Solitaire Lance' already exist; add 'Regent Lance' and 'Mad Cat Lance' 4-'Mech presets at similar BV).
Run npm run validate:data and npx vitest run tests/data. Return JSON: ok, summary (<=80 words: mechs added, gaps), files, issues.`, { label: 'data:mechs', phase: 'Build', schema: RESULT, model: 'sonnet' }),
  () => agent(`${COMMON}
Task: the four Core Box maps. You own src/data/maps/** (except test-canyons.json), src/data/missions/** (only to point missions at the new maps), tests/data/maps*.test.ts, CREDITS.md (MegaMek credit line only).
Read docs/spec/70-maps.md fully (§6 procedure and the slug/file table) and docs/spec/20-data-schema.md map section. For each of headwater-crossing (Grassland 2), sodden-hills (Grassland 3), scorched-oasis (Desert 2), arid-canyons (Desert 3): fetch the MegaMek board file (gh api repos/MegaMek/mm-data/contents/... or raw URL) into C:/Users/antho/OneDrive/Documents/WarMechForge/sources-local/boards/ (outside the repo), write a small converter script in sources-local (NOT in the repo) that maps every hex's level, terrain (woods light/heavy, rough, water depth, pavement/road, buildings -> skip with a note) to our JSON schema, and write src/data/maps/<slug>.json (16x17, labels 0101-1617, theme desert/grasslands, source {ref:'megamek', note:'<path> @ <sha>, hex-by-hex conversion, no file copied'}). Sanity-check each map with a rendered ASCII dump (levels + terrain letters) in your head against the board's own counts, and run validate:data. Point mission.intro at scorched-oasis (keep test-canyons as a dev map), and make all 4 maps selectable for Skirmish.
Return JSON: ok, summary (<=80 words incl. per-map hex counts by terrain), files, issues.`, { label: 'data:maps', phase: 'Build', schema: RESULT, model: 'sonnet' }),
])

phase('Verify')
const ver = await agent(`${COMMON}
Task: ADVERSARIAL verification, do not edit. Check every NEW 'Mech file in src/data/mechs/** (git status/diff shows which) against its MegaMek MTF (fetch, max 12) for tonnage, engine, MP, heat sinks, armor per location incl. rear, internal type, weapons + locations, ammo bins, crit slot order; new weapons/equipment numbers in src/data/core/** against MegaMek; and each new map (pick 15 random hexes per map and compare level/terrain with the board file in C:/Users/antho/OneDrive/Documents/WarMechForge/sources-local/boards/). Default to fail when unsure; max 20 failing items, owner 'mechs' | 'maps' | 'engine'.
Return JSON: verdict, failing, notes (<=60 words).`, { label: 'verify:data', phase: 'Verify', schema: VERDICT, effort: 'high' })

phase('Ship')
const byOwner = {}
for (const f of (ver ? ver.failing : [])) (byOwner[f.owner] = byOwner[f.owner] || []).push(f)
const OWN = { mechs: 'src/data/mechs/**, src/data/core/**, src/data/forces/**, docs/spec/mechs-sources.md, tests/data/*', maps: 'src/data/maps/**, src/data/missions/**, tests/data/maps*', engine: 'src/engine/**, tests/engine/**' }
const fixes = await parallel(Object.keys(byOwner).filter(o => OWN[o]).map(o => () => agent(`${COMMON}
Task: fix these verified problems (check each against the source first; reject wrong ones in issues): ${JSON.stringify(byOwner[o])}
You own ONLY: ${OWN[o]}. Run validate:data and the relevant tests in the FOREGROUND.
Return JSON: ok, summary (<=60 words), files, issues.`, { label: `fix:${o}`, phase: 'Ship', schema: RESULT, model: 'sonnet' })))

const issues = [...build, ...fixes].filter(Boolean).flatMap(r => r.issues)
const rulings = issues.filter(s => s.startsWith('RULING'))
const engineNeeds = issues.filter(s => s.startsWith('ENGINE'))
const ship = await agent(`${COMMON}
Task: land this stage. You may edit any file in src/, tests/, tools/, docs/, STATUS.md, HANDOFF.md, CREDITS.md.
1. Engine needs reported by the data agent: ${JSON.stringify(engineNeeds)}. Implement the ones a stock variant in the new data actually needs to play correctly (e.g. LB-X slug/cluster ammo choice, Gauss explodes, ferro-lamellor damage reduction per 10-rules-core / changelog W41) with tests; list the rest in tools/out/m5-followups.md.
2. Client: the start screen's Skirmish mission gets an any-vs-any picker: choose up to 4 'Mechs per side from all data 'Mechs (variant dropdown per chassis, "(stock)" labels, BV shown, side BV totals), pilot skills per 'Mech (default 4/5), map choice from the 4 Core Box maps (+ dev map), and an "Even BV" quick button. Keep e2e text matching exact (no substring picks: 'Mad Cat Mk II' vs others).
3. Gates: npm run typecheck, npm test, npm run validate:data, npm run sim -- --games 30 --seed 5 (zero violations, include a skirmish with the new 'Mechs on a new map if sim supports options; else add a --mission/--forces flag), npm run bench:ai -- --games 10 --seed 2 (no rejections/stalls/fallbacks), PW_PORT=4183 npx playwright test (full e2e). Take e2e-out/skirmish-setup.png and e2e-out/scorched-oasis.png (a game on the new map) and Read them; the map must look right (levels, woods, water) with the hex board renderer.
4. Append rulings to docs/needs-rules-check.md (dedupe): ${JSON.stringify(rulings)}
5. Update STATUS.md and HANDOFF.md (Current state + Next; keep the Morning summary block, appending one line: "Content: all 8 chassis (stock variants), the 4 Core Box maps, Skirmish any-vs-any").
6. Stage by exact path (never sources-local, tools/out, e2e-out, docs/sources, PDFs, tokens, art/board-textures/preview.png); commit "M5: full stock roster, Core Box maps, skirmish picker, engine fixes" + blank line + "${ATTR}"; git pull --rebase; git push origin main; gh run watch the Pages run --exit-status.
Return JSON: ok, summary (<=100 words), files, issues.`, { label: 'ship:content', phase: 'Ship', schema: RESULT, effort: 'high' })

const s = r => r && { ok: r.ok, summary: r.summary, issues: r.issues.slice(0, 6) }
return { build: build.map(s), verify: ver && { verdict: ver.verdict, n: ver.failing.length, notes: ver.notes }, fixes: fixes.map(s), ship: s(ship) }
