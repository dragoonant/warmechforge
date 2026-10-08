# Handoff

## Morning summary (owner)
M3 is in: WarMechForge is playable on Pages (https://dragoonant.github.io/warmechforge/). Start the Intro Mission against the
random bot, then walk, run or jump your two 'Mechs, pick facings, twist torsos, fire with the live heat sum and every target
number explained, and kick or punch at close range, until one side is down. The board sits on a table in a little game shop
(Settings > Surroundings switches to a plain dark surround). Screenshots of a played game are in `e2e-out/` (local).
M4 (utility AI in a worker, easy/normal tiers) is running/next; see Current state.
M6 audio is in: audition every sound at https://dragoonant.github.io/warmechforge/sounds.html and name the ids to redo; music is not generated yet (needs your OK, about 12k credits).

Data notes: the box's new variants (Solitaire 3, Rakshasa MDG-3D, Hollander BZK-W4, Vulture E...) have no public stats yet
(Sarna, MegaMek, MUL checked 2026-10-08; only BVs known), so the slice uses stock Solitaire Prime and Rakshasa MDG-1A,
labelled "(stock)". Mapsheets are 16 x 17 hexes (MegaMek boards and AGoAC agree; the brief said 15 x 17).

Questions:
1. Figure gate: do the Solitaire and Regent look right (`art/figure-sheets/bt-solitaire.png`, `bt-regent.png`, and the
   torso-twist / arm-loss sheets `*-split.png`; in game: `?gallery`)? Proportions are close to the real sculpts, only
   lightly stylised. Approve, or say "chunkier" / "more stylised", and I'll make the other six to match.
3. Music: generate the title theme, two battle loops and victory / defeat stingers (two candidates each, about 12k
   ElevenLabs credits)? SFX and voice are done (756 credits; account at 27,876 of 59,062).
2. Rulings: `docs/needs-rules-check.md` has every judgement call (about 120 lines). Skim when convenient; a newer 2026
   rulebook would settle most of them.

Content: all 8 chassis (stock variants), the 4 Core Box maps, Skirmish any-vs-any
M7: the roster's special equipment works by the rules (AI uses it; player controls still to come), press T for the threat overlay, and the end screen shows per-'Mech damage with Play again / Rematch / Back to setup.

## Current state
- Engine: `src/engine/` (rules, queries, text). M5 added ferro-lamellor (EQUIP-014), the Clan targeting computer (EQUIP-001) and
  Guardian ECM vs Artemis IV (EQUIP-015). M7 added `equipment.ts` and wired every hook point (00 §14 rows tagged M6; `HOOK_WIRING`
  in hooks.ts names the call sites): PPC capacitor (`DeclareFireAction.charge`, EQUIP-016), coolant pod (`coolantPod`, EQUIP-017),
  Clan MASC (`MoveAction.masc`, `query.reachable(..., {masc})`, escalating failure EQUIP-020/021), RAC jam / unjam (EQUIP-022),
  partial wing via the heat and movement hooks (EQUIP-018), Beagle probe no-op (EQUIP-023). Events `EquipmentUsed`,
  `WeaponJamChanged`; `SheetView.equipment` carries capacitor / pod / MASC / jam state. Involuntary stacking reports
  `UnitDisplaced.cause: 'stacking'`.
- Data: 16 'Mechs (two variants per Core Box chassis; unknown box variants are public stock stand-ins labelled "(stock)"), the 4
  Core Box maps plus the dev map Test Canyons; the intro plays on Scorched Oasis with a new briefing. Presets: Regent Lance, Mad Cat Lance.
  All 8 chassis have generated GLB figures (`public/assets/models/`).
- AI: `src/ai/` utility decider, tiers random / easy / normal, in a Web Worker (3 s timeout, random-bot fallback). M7: roster-wide
  play (LB-X / MML ammo choice, explosion risk, ECM vs Artemis, jumpers, woods and elevation), capacitor charge, coolant pod, MASC
  run entries priced by failure risk, Ultra AC double tap, forced-withdrawal exit preference.
- Client: Skirmish any-vs-any picker (M5). M7: threat overlay (`interaction/ThreatOverlay.tsx`, T key or the Threat button), AI trace
  panel (`ui/AiTrace.tsx`), Settings > Follow action (camera frames bot moves and attacks, hands the view back on your turn), end
  screen with mini sheets per 'Mech (`ui/MiniSheet.tsx`), kills and heat peaks, Play again / Rematch, same forces / Back to setup;
  How to Play equipment + Skirmish sections; record-sheet hover tips (`ui/Tip.tsx`); softer water seams; Low graphics audit.
- Tools: `npm run sim` and `npm run bench:ai` take `--map <id>` and `--forces`; the bench also sweeps `--map a,b|all`,
  `--forces "A,B;C,D"` and `--withdrawal`.
- Checks: `npm run typecheck`, `npm test` (50 files, 470 tests), `npm run validate:data`, `npm run sim -- --games 30 --seed 7`
  (30/30, 0 violations), `npm run bench:ai -- --games 20 --seed 1` (normal vs random 19/20, vs easy 16/20, 0 rejections / stalls /
  fallbacks), `PW_PORT=4183 npx playwright test` (play, skirmish, polish specs; `e2e-out/polish-*.png`).

## Next
1. Owner playtest on Pages: Skirmish vs the normal AI; try the threat overlay (T), Follow action and the new end screen.
2. Player controls for the new equipment: "2 shots" for Ultra ACs, Charge for capacitor PPCs, Vent coolant pod, MASC in Run mode
   (engine and AI already support them). List: `tools/out/m7-followups.md`.
3. Ferro-lamellor in `attackPreview` / `firePreview` and the AI damage model; skirmish turn-limit and withdrawal options.
4. M8: smoke and hidden units (Beagle probe effects), 40-ai §4.5 Monte Carlo, figure-gate follow-ups, audio when a key arrives.

## Known gaps
- The player cannot charge a capacitor, vent a coolant pod, use MASC or double-tap an Ultra AC; only the AI does.
- Previews and the AI damage model ignore ferro-lamellor (about 20 % high against a Vulture Mk IV).
- Skirmish turn-limit and withdrawal choices are not on the start screen; no AI force picker.
- Water pools still show the sea-bed steps faintly at low camera angles.
- Beagle probe has no effect yet; Guardian ECM only cancels hostile Artemis; RAC tested only with a fixture weapon.
- `choice` decisions (askDefender) are never raised (defaults decide).
