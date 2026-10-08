# Mech and item sources (slice batch)

Written 2026-10-08 by the data work package. Numbers were typed by hand; MegaMek files were read for cross-checking and
are not committed. Per-value sources live in each JSON file (`source`, `valueSources`, `verify`).

## The four slice 'Mechs

| 'Mech | File | Status | Stats source | BV (4/5) |
|---|---|---|---|---|
| Uziel UZL-2S | `mechs/uziel/uzl-2s.json` | box variant, sourced | MegaMek mm-data `3067/Uziel UZL-2S.mtf`, matches the brief's stock numbers | 1352 (MUL, Core Box review) |
| Eris ERS-2N | `mechs/eris/ers-2n.json` | box variant, sourced | mm-data `Rec Guides ilClan/Vol 18/Eris ERS-2N.mtf`, matches the brief | 1400 (MUL, review) |
| Solitaire Prime | `mechs/solitaire/prime.json` | **(stock)** stand-in for Solitaire 3 | mm-data `3067/Solitaire.mtf`, matches the brief | 1284 (MUL) |
| Rakshasa MDG-1A | `mechs/rakshasa/mdg-1a.json` | **(stock)** stand-in for MDG-3D | mm-data `3055U/Rakshasa MDG-1A.mtf`, matches the brief | 1795 (MUL) |

Solitaire 3 and Rakshasa MDG-3D have only a BV (1608 and 2100, from the review) and no stat line anywhere found
(`tools/out/variant-research.md`), so the slice plays the stock variants and labels them "(stock)" in the UI.

## Where the MegaMek record added detail beyond the brief

- Uziel carries a Beagle Active Probe (2 slots, left torso) and only half a ton of machine gun ammo. The probe is an
  `other` item with no rules in release 1. The ammo is a one-ton bin that starts at a half load (100 shots), which is
  the same 100 rounds in one slot; the schema allows whole-ton bins only.
- Eris carries a partial wing (4 slots in each side torso) and CASE II in both side torsos. The wing's jump bonus is not
  modelled, so jump stays at the 5 jump jets. The IS partial wing weighs 7% of tonnage rounded up to the half ton, 3.5 t at 50 t (BMM p.116; TacOps). RULING: the 2 / 1.5 split between the side torsos is ours and arbitrary.
- Rakshasa 1A carries an Artemis IV on each LRM 10 (1 slot each, linked). No engine hook exists for it yet, so it only
  occupies its slot and weight.
- Armor, endo steel and ferro-fibrous filler slot counts match the section 6.4 table for every Mech.
- The tonnage audit (`npm run validate:data`) now fails on any mismatch. It adds the engine weight (AGoAC Engine Table, XL halved, rounded up to the half ton) and one ton per heat sink beyond the first 10. Engine weights: 9.5 t (Uziel), 6.5 t (Eris), 6.5 t (Solitaire), 19.5 t (Rakshasa, plus 5 t of extra sinks, 24.5 t together).
- RULING: MTF quirks are dropped in release 1 (quirks are reserved empty); each Mech carries a `/quirks` verify note naming what was dropped.

## Gaps and unconfirmed values

| Item | Gap |
|---|---|
| Crit slot order | all four follow the MegaMek record, not a printed Core Box record sheet (`verify` on `/crits`) |
| Small X-pulse laser | -2 pulse bonus confirmed (TacOps, MegaMek); ranges 2/4/5 from Sarna |
| Partial wing | 3.5 t total sourced; torso split is a ruling; no rules |
| Beagle Active Probe | 1.5 t, 2 slots (TechManual, MegaMek); no rules |
| BV skill table | TechManual table, not the Core Box table (`tables.json` `verify`) |
| Weapon numbers | PPC, machine gun, SRM 6, LRM 10, medium laser from the AGoAC weapons table (checked); ER large laser, medium pulse laser from the TechManual tables; Snub-Nose PPC, small X-pulse, MML 5 and the three heavy lasers read from Sarna pages (heavy large laser is 16 damage, not 25) |
| Intro mission | shape from `11-missions.md` section 6; the booklet is not read. Map is the hand-built `map.test-canyons` in place of Scorched Oasis or Arid Canyons. Base BV a 2752 vs b 3079, not rebalanced |

## Sources used

- AGoAC rulebook weapons table (local extract) for the classic weapons.
- MegaMek mm-data MTF files (4), cross-check only, retrieved 2026-10-08.
- Sarna wiki pages for the newer weapons: Small X-Pulse Laser, Snub-Nose PPC, MML 5, Heavy Small/Medium/Large Laser, Medium Pulse Laser.
- Master Unit List BV values via `tools/out/variant-research.md`.

## Roster batch (2026-10-08): the whole Core Box roster with public stock variants

The box's new variants (Hollander BZK-W4, Vulture Mk IV E, Rakshasa MDG-3D, Solitaire 3, the unnamed second variants) have no public
stats (`tools/out/variant-research.md`), so every chassis carries two public stock variants. All stats below were read from
MegaMek mm-data MTF files (cross-check only, nothing committed); BV is the Master Unit List base value at 4/5, fetched 2026-10-08.
Crit slot order follows the MTF, not a printed record sheet (`verify` on `/crits` of every file). MTF quirks are dropped.

| 'Mech | File | Status | mm-data MTF | BV |
|---|---|---|---|---|
| Regent Prime | `mechs/regent/prime.json` | box variant | Rec Guides ilClan/Vol 21 | 2437 |
| Regent A | `mechs/regent/a.json` | box variant (seen in the review prose) | Rec Guides ilClan/Vol 21 | 3412 |
| Mad Cat Mk II (base) | `mechs/mad-cat-mk-ii/base.json` | box variant | 3067 | 3135 |
| Mad Cat Mk II 2 | `mechs/mad-cat-mk-ii/2.json` | **(stock)** second variant unknown | 3067 Unabridged/Clan Meks | 2822 |
| Vulture Mk IV Prime | `mechs/vulture-mk-iv/prime.json` | **(stock)** stand-in for E (BV 2151) | 3145/Merc | 2110 |
| Vulture Mk IV A | `mechs/vulture-mk-iv/a.json` | **(stock)** second variant unknown | 3145/Merc | 2177 |
| Hollander BZK-F3 | `mechs/hollander/bzk-f3.json` | **(stock)** stand-in for BZK-W4 (BV 920) | 3055U | 953 |
| Hollander BZK-G1 | `mechs/hollander/bzk-g1.json` | **(stock)** second variant unknown | 3055U | 873 |
| Eris ERS-2H | `mechs/eris/ers-2h.json` | **(stock)** second variant unknown | Rec Guides ilClan/Vol 18 | 1674 |
| Uziel UZL-8S | `mechs/uziel/uzl-8s.json` | **(stock)** second variant unknown (maybe the UZL-9S) | 3067 Unabridged/IS Meks | 1393 |
| Solitaire 2 | `mechs/solitaire/2.json` | **(stock)** second variant unknown | 3067 Unabridged/Clan Meks | 1471 |
| Rakshasa MDG-1B | `mechs/rakshasa/mdg-1b.json` | **(stock)** second variant unknown | 3055U | 1748 |

Armor, engine, heat sinks and weapons of Regent Prime, Mad Cat Mk II, Vulture Mk IV Prime and Hollander BZK-F3 also match the brief
(`docs/BATTLETECH-HANDOFF.md` lines 1016-1032). The tonnage audit closes for all 16 'Mechs.

New weapons (all `source.ref` megamek, equipment class named in each note): Large Laser, ER Medium Laser, Heavy PPC, Streak SRM 6,
LB 10-X, Gauss Rifle (IS); Clan ER Large, ER Medium, ER Small, ER PPC, Medium Pulse, Large Pulse, Micro Pulse, ER Small Pulse,
LB 20-X, LB 5-X, Ultra AC/10, Gauss, Streak SRM 4, SRM 6, LRM 10, LRM 5. Ammo shots per ton read from MegaMek `AmmoType`.
New equipment: Clan jump jet, IS improved jump jet, Clan CASE II, PPC capacitor, Clan targeting computer, coolant pod, Clan MASC,
Guardian ECM. The Clan ER small pulse laser is -1 to hit in MegaMek (not -2); the Clan medium pulse laser ranges are 4/8/12.

### Roster gaps

| Item | Gap |
|---|---|
| Coolant pod | slot/ton counts inferred from the MTF slot table and the Regent A tonnage audit (MegaMek models it as an ammo item); no rules |
| Clan MASC / targeting computer | weights from MegaMek formulas (max(1, round(tons * 0.04)); ceil(direct-fire tons / 5)); the TC's -1 is in the engine (M5, EQUIP-001); MASC has no rules yet |
| Ferro-lamellor armor | tonnage audit uses 14 points per ton (0.875 x 16), which closes the Vulture Mk IV audit; `tools/validate-data.ts` gained that multiplier; the damage cut is in the engine (M5, damage.ts, 10 EQUIP-014) |
| Hooks the engine lacks | M5 added ferro-lamellor, the targeting computer and Guardian ECM vs Artemis; still missing: ppcCapacitor, masc, coolantPod, other ECM effects (see `tools/out/m5-followups.md`) |
| Presets | `force.regent-lance` (base BV 6732) and `force.mad-cat-lance` (6952), both under the 7500 skirmish budget |
