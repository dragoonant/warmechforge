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
