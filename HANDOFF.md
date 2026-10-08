# Handoff

## Morning summary (owner)
M3 is in: WarMechForge is playable on Pages (https://dragoonant.github.io/warmechforge/). Start the Intro Mission against the
random bot, then walk, run or jump your two 'Mechs, pick facings, twist torsos, fire with the live heat sum and every target
number explained, and kick or punch at close range, until one side is down. The board sits on a table in a little game shop
(Settings > Surroundings switches to a plain dark surround). Screenshots of a played game are in `e2e-out/` (local).
M4 (utility AI in a worker, easy/normal tiers) is running/next; see Current state.
M6 audio is in, now with music: audition at https://dragoonant.github.io/warmechforge/sounds.html, name the ids to redo, and say -a or -b for each music slot (title, battle 1, battle 2, victory, defeat).

Data notes: the box's new variants (Solitaire 3, Rakshasa MDG-3D, Hollander BZK-W4, Vulture E...) have no public stats yet
(Sarna, MegaMek, MUL checked 2026-10-08; only BVs known), so the slice uses stock Solitaire Prime and Rakshasa MDG-1A,
labelled "(stock)". Mapsheets are 16 x 17 hexes (MegaMek boards and AGoAC agree; the brief said 15 x 17).

Questions:
1. Figure gate: do the Solitaire and Regent look right (`art/figure-sheets/bt-solitaire.png`, `bt-regent.png`, and the
   torso-twist / arm-loss sheets `*-split.png`; in game: `?gallery`)? Proportions are close to the real sculpts, only
   lightly stylised. Approve, or say "chunkier" / "more stylised", and I'll make the other six to match.
3. Music is generated (10 tracks, about 9.9k credits; account at 37,870 of 59,062): pick -a or -b per slot on sounds.html.
2. Rulings: `docs/needs-rules-check.md` has every judgement call (about 120 lines). Skim when convenient; a newer 2026
   rulebook would settle most of them.

Content: all 8 chassis (stock variants), the 4 Core Box maps, Skirmish any-vs-any
M7: the roster's special equipment works by the rules (AI uses it; player controls still to come), press T for the threat overlay, and the end screen shows per-'Mech damage with Play again / Rematch / Back to setup.
M8a: you can now use that equipment yourself (Ultra AC "2 shots", PPC "Charge", "Vent coolant pod", MASC in Run mode), Skirmish has turn limit / forced withdrawal / "AI picks a force", damage previews account for ferro-lamellor, and the lance presets are rebalanced.

## Current state
- Engine: `src/engine/` (rules, queries, text). M5 added ferro-lamellor (EQUIP-014), the Clan targeting computer (EQUIP-001) and
  Guardian ECM vs Artemis IV (EQUIP-015). M7 added `equipment.ts` and wired every hook point (00 §14 rows tagged M6; `HOOK_WIRING`
  in hooks.ts names the call sites): PPC capacitor (`DeclareFireAction.charge`, EQUIP-016), coolant pod (`coolantPod`, EQUIP-017),
  Clan MASC (`MoveAction.masc`, `query.reachable(..., {masc})`, escalating failure EQUIP-020/021), RAC jam / unjam (EQUIP-022),
  partial wing via the heat and movement hooks (EQUIP-018), Beagle probe no-op (EQUIP-023). Events `EquipmentUsed`,
  `WeaponJamChanged`; `SheetView.equipment` carries capacitor / pod / MASC / jam state. Involuntary stacking reports
  `UnitDisplaced.cause: 'stacking'`. M8a: `expect.ts` makes `attackPreview` / `firePreview` / `physicalPreview` expect what the
  pipeline lands (ferro-lamellor per group, partial-cover leg hits absorbed; new optional fields `expectedPerHit`,
  `armorReduction`, `expectedStopped`, logged in 00 §14).
- Data: 16 'Mechs (two variants per Core Box chassis; unknown box variants are public stock stand-ins labelled "(stock)"), the 4
  Core Box maps plus the dev map Test Canyons; the intro plays on Scorched Oasis with a new briefing. Presets: Regent Lance, Mad Cat
  Lance; M8a rebalanced the Solitaire Lance (intro side B) and the Mad Cat Lance to within 5 % BV of their pairs (bench notes in each
  force file). All 8 chassis have generated GLB figures (`public/assets/models/`).
- AI: `src/ai/` utility decider, tiers random / easy / normal, in a Web Worker (3 s timeout, random-bot fallback). M7: roster-wide
  play (LB-X / MML ammo choice, explosion risk, ECM vs Artemis, jumpers, woods and elevation), capacitor charge, coolant pod, MASC
  run entries priced by failure risk, Ultra AC double tap, forced-withdrawal exit preference. M8a: the damage model applies
  ferro-lamellor; movement always re-scores the best hexes with a shot and ranks them first (`SHOOTERS_KEPT` in `moves.ts`);
  tests AI-029..032 (`tests/ai/majors.test.ts`, `lamellor.test.ts`).
- Client: Skirmish any-vs-any picker (M5). M7: threat overlay (`interaction/ThreatOverlay.tsx`, T key or the Threat button), AI trace
  panel (`ui/AiTrace.tsx`), Settings > Follow action, end screen with mini sheets (`ui/MiniSheet.tsx`), Play again / Rematch / Back
  to setup; How to Play equipment + Skirmish sections; record-sheet hover tips. M8a: equipment controls (`ui/equipView.ts`): Fire
  panel "2 shots", "Charge", "Vent coolant pod" with the engine's heat; Move panel MASC chip in Run mode; record-sheet equipment
  block (`ui/sheet/EquipmentBlock.tsx`); Skirmish turn limit, forced withdrawal and "AI picks a force" (`ui/start/startOptions.ts`);
  playtest fixes (no accidental prone on your own hex, twist notes count legal shots, feed attribution, top bar playback note).
- Tools: `npm run sim` and `npm run bench:ai` take `--map <id>` and `--forces`; the bench also sweeps `--map a,b|all`,
  `--forces "A,B;C,D"` and `--withdrawal`, and audits every normal-tier move for no-shot and back-to-threat moves.
- Checks: `npm run typecheck`, `npm test` (58 files, 508 tests), `npm run validate:data`, `npm run sim -- --games 30 --seed 8`
  (30/30, 0 violations), `npm run bench:ai -- --games 20 --seed 1` (normal vs random 16/20, vs easy 15/20, 0 rejections / stalls /
  fallbacks; the M7 intro forces give 19/20 and 18/20 with the same AI), `PW_PORT=4183 npx playwright test` (12/12: play,
  skirmish, polish, m8, m9; `e2e-out/m8-*.png`).

## Next
1. Owner playtest on Pages: Skirmish with turn limit 8, forced withdrawal and "AI picks a force"; use 2 shots, Charge, Vent, MASC
   (Regent A: Charge + Vent; Solitaire 2: MASC; Vulture Mk IV A: 2 shots).
2. Re-baseline the AI bench on the now-even intro (or bench a fixed mirror); 40-ai §4.5 Monte Carlo. List: `tools/out/m8-followups.md`.
3. M8b: smoke and hidden units (Beagle probe effects), figure-gate follow-ups; keep the music candidates the owner picks.

## Known gaps
- Previews do not model crit chains inside one attack (an ammo explosion emptying a location mid-cluster).
- The Mad Cat Lance shares its three supporting variants with the Regent Lance (balanced, but little variety).
- Water pools still show the sea-bed steps faintly at low camera angles.
- Beagle probe has no effect yet; Guardian ECM only cancels hostile Artemis; RAC tested only with a fixture weapon.
- `choice` decisions (askDefender) are never raised (defaults decide).
