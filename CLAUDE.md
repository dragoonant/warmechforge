# WarMechForge: agent orientation

Read these in order, and nothing else up front:
1. `HANDOFF.md`: current state and next steps.
2. `STATUS.md`: what exists.
3. `PLAN.md`: scope, decisions and milestones.
4. `docs/spec/`: read only the sections a task names.

The original brief is `docs/BATTLETECH-HANDOFF.md`. Read a part of it only when a task cites it.

## Owner priority: playable first
- Something the owner can open on Pages and play beats test coverage. Every stage ends in something
  visible: a Pages deploy or screenshots.
- Lean mode is the default (`args.lean: true`): implement and commit with about 10 focused tests and
  no adversarial verify loop. Verify loops ON for the heat/crit/PSR engine, the equipment catalogue
  and each new 'Mech data batch.
- Check-ins are ≤10 lines with a screenshot per milestone. Questions go in one numbered list.
  Rules ambiguities never block work: add a `RULING:` line (rule, what we did, why) to
  `docs/needs-rules-check.md`.
- Do the legwork (free downloads, research) and research widely before marking data unverified.

## Rules source (owner decisions 2026-10-07/08)
- Target: BattleTech Classic as the 2026 Core Box plays it (2026 Core Rules, cut down).
- In hand: the A Game of Armored Combat (AGoAC) rulebook, TW-era, at
  `C:\Users\antho\OneDrive\Documents\WarMechForge\cat3500d+battletech+a+game+of+armored+combat+rulebook.pdf`
  (outside the repo; never commit). Text extract: `docs/sources/agoac-rulebook.txt` (gitignored).
- Apply the 2026 deltas from the Master Changelog (`docs/sources/`) on top. Every AGoAC/TW fallback
  where 2026 differs or is unknown gets a `RULING:`. The owner may add the 2026 rulebook later.
- The owner does not have the Core Box: variant stats are researched online; each value carries a
  `source`, and unconfirmed values are flagged.

## Token rules (metered plan: mandatory)
- The main loop never reads whole source files or hand-writes bulk code. It writes Workflow scripts
  (`tools/workflows/`), reads structured JSON results, and checks in with the owner.
- Models: implementation and data entry on Sonnet (`model: 'sonnet'`); spec writing, integration and
  adversarial verification on the session model at `effort: 'high'`. Agents return schema-validated
  JSON, ≤300 tokens.
- One workflow stage at a time, ≤8 agents per stage. Commit and push after every stage. Resume
  (`resumeFromRunId`) works in the same session only; resume prompts say "check `git diff` first".
- Prompts point at specs on disk; they never paste specs in. Freeze interfaces before fan-out.
- Cap research at 3–6 WebFetches per agent. Probe a new setup with one cheap agent before fanning out.

## Workflow script pattern
- Every prompt starts with a `COMMON` preamble: absolute root ("use absolute paths, the cwd resets"),
  "orient from STATUS.md only", the IP rule, the frozen-contract rule, "run long commands in the
  FOREGROUND", the edition leak list (below), "Final output is raw JSON".
- Schemas: `RESULT = {ok, summary, files[], issues[]}`; `VERDICT = {verdict, coverage, failing[], notes}`
  (verifiers default to fail when unsure and never edit); `FINDINGS = {ok, findings:[{owner, where, problem, fix}]}`.
- Every prompt says "You own ONLY: ...", and concurrent agents own disjoint files.
- The ship agent runs the gates, stages by exact path (never `git add -A`), commits `M<n>: <what>` +
  attribution, runs `git pull --rebase`, pushes, watches the Pages run, and collects `RULING:` lines into
  `docs/needs-rules-check.md`. Out-of-scope issues go to `tools/out/m<n>-followups.md` by work package.
- Shared tree: concurrent agents never run `npm install` or `git commit`, never edit `package.json` or
  `STATUS.md`, unless told to. Never stage `tools/out`, `e2e-out`, `test-results`, `.claude/`,
  `docs/sources/`, PDFs, photos or tokens.
- After an interrupted run: `git status`, then `npm run typecheck && npm test && npm run validate:data`.
- Workflow scripts stay LF (`.gitattributes`).

## Conventions
- Hexes: axial/cube internally, printed label `XXYY` (`0101` top-left) for display and data.
  Flat-topped mapsheets, facing 0 = north, 0–5 clockwise. 1 world unit = 1 hex flat-to-flat, y up,
  board centred at origin; one elevation level = one constant (`LEVEL_HEIGHT`).
- A 'Mech occupies one hex and is two levels tall. Ranges in hexes (target hex counted, attacker's not).
- Engine contracts are frozen after M0: `src/engine/{types,actions,events,hooks,rng,decider,index}.ts`.
  Changes are additive only and logged in `docs/spec/00-architecture.md` §14 plus the agent's `issues`.
- `roll(state, spec)` is the only way the engine rolls; never `Math.random`.
- Name engine tests by checklist ID from `docs/spec/12-rules-test-checklist.md` (e.g. `it('HEAT-014 ...')`).
- The engine owns every number the UI shows. `legalActions` is never empty for an open decision.
- Commit messages: `M<n>: <what>`, blank line, then the Co-Authored-By line for the current model.
  Pushing to `main` after each stage is pre-approved. Pages deploys from `main`.

## Edition leak list (put in every rules prompt)
| Wrong source | What leaks | Our rule |
|---|---|---|
| Alpha Strike | 2/2/1 damage, inch ranges, single structure track | Per-weapon damage, hex ranges, armor + internal per location |
| HBS BattleTech (2018) | Stability bar, evasion pips, morale called shots | Classic PSRs and TMM; aimed shots only per the 2026 rule |
| MechWarrior games | Ghost heat, real-time beams | Heat-scale thresholds, turn-based heat |
| Total Warfare / AGoAC | Skidding, fall facing roll, ammo dumping, shutdown fall PSR, "Weapon Attack Phase" | Removed or changed in 2026 |
| Old rules / BMR | Crit and transfer edge cases | 2026 Core Rules |

## IP rule (Mallet/Whirr posture)
- Real 'Mech, weapon, equipment and pilot names are fine. ALL prose is ours: rules text, SPA text,
  lore, UI copy, docs. Never copy rulebook text.
- Never commit Catalyst or HBS art, logos, maps, record-sheet layouts or rulebook text; no MechWarrior
  game assets or sounds. The "BattleTech" logo never appears; the title is WarMechForge.
- Figures are generated versions of the real Core Box sculpts; reference photos stay outside the repo.
  Proportions are stated in plain words (about 4–5 heads tall, highly detailed). Banned prompt words:
  see `docs/BATTLETECH-HANDOFF.md` D.1.
- MegaMek data (CC-BY-NC-SA) is a cross-check aid only; never commit its files.
- The UI and README carry the unofficial fan-project notice (not affiliated with Catalyst Game Labs,
  Topps or Microsoft; free, non-commercial).
- The ElevenLabs key is passed only through `ELEVENLABS_API_KEY`; never echo or commit it.
