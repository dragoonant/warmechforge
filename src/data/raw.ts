// Static imports of every JSON file under src/data (a test checks that none is missing).
import weapons from './core/weapons.json'
import ammo from './core/ammo.json'
import equipment from './core/equipment.json'
import tables from './core/tables.json'
import spas from './core/spas.json'
import pilots from './pilots/pilots.json'
import uzl2s from './mechs/uziel/uzl-2s.json'
import ers2n from './mechs/eris/ers-2n.json'
import solitairePrime from './mechs/solitaire/prime.json'
import mdg1a from './mechs/rakshasa/mdg-1a.json'
import regentPrime from './mechs/regent/prime.json'
import regentA from './mechs/regent/a.json'
import madCatBase from './mechs/mad-cat-mk-ii/base.json'
import madCat2 from './mechs/mad-cat-mk-ii/2.json'
import vulturePrime from './mechs/vulture-mk-iv/prime.json'
import vultureA from './mechs/vulture-mk-iv/a.json'
import hollanderF3 from './mechs/hollander/bzk-f3.json'
import hollanderG1 from './mechs/hollander/bzk-g1.json'
import eris2h from './mechs/eris/ers-2h.json'
import uzl8s from './mechs/uziel/uzl-8s.json'
import solitaire2 from './mechs/solitaire/2.json'
import mdg1b from './mechs/rakshasa/mdg-1b.json'
import testCanyons from './maps/test-canyons.json'
import headwaterCrossing from './maps/headwater-crossing.json'
import soddenHills from './maps/sodden-hills.json'
import scorchedOasis from './maps/scorched-oasis.json'
import aridCanyons from './maps/arid-canyons.json'
import introA from './forces/intro-a.json'
import introB from './forces/intro-b.json'
import regentLance from './forces/regent-lance.json'
import madCatLance from './forces/mad-cat-lance.json'
import intro from './missions/intro.json'
import skirmish from './missions/skirmish.json'
import type { Ammo, Equipment, Force, GameMap, Mech, Mission, Pilot, Spa, Tables, Weapon } from './types'

const cast = <T>(x: unknown): T => x as T

export const RAW = {
  weapons: cast<Weapon[]>(weapons),
  ammo: cast<Ammo[]>(ammo),
  equipment: cast<Equipment[]>(equipment),
  tables: cast<Tables>(tables),
  spas: cast<Spa[]>(spas),
  pilots: cast<Pilot[]>(pilots),
  mechs: cast<Mech[]>([
    uzl2s, ers2n, solitairePrime, mdg1a,
    regentPrime, regentA, madCatBase, madCat2, vulturePrime, vultureA, hollanderF3, hollanderG1, eris2h, uzl8s, solitaire2, mdg1b,
  ]),
  maps: cast<GameMap[]>([scorchedOasis, aridCanyons, headwaterCrossing, soddenHills, testCanyons]),
  forces: cast<Force[]>([introA, introB, regentLance, madCatLance]),
  missions: cast<Mission[]>([intro, skirmish]),
}

/** Paths (relative to src/data, forward slashes) of every JSON file imported above. */
export const RAW_FILES: readonly string[] = [
  'core/weapons.json', 'core/ammo.json', 'core/equipment.json', 'core/tables.json', 'core/spas.json', 'pilots/pilots.json',
  'mechs/uziel/uzl-2s.json', 'mechs/eris/ers-2n.json', 'mechs/solitaire/prime.json', 'mechs/rakshasa/mdg-1a.json',
  'mechs/regent/prime.json', 'mechs/regent/a.json', 'mechs/mad-cat-mk-ii/base.json', 'mechs/mad-cat-mk-ii/2.json', 'mechs/vulture-mk-iv/prime.json', 'mechs/vulture-mk-iv/a.json', 'mechs/hollander/bzk-f3.json', 'mechs/hollander/bzk-g1.json', 'mechs/eris/ers-2h.json', 'mechs/uziel/uzl-8s.json', 'mechs/solitaire/2.json', 'mechs/rakshasa/mdg-1b.json',
  'maps/test-canyons.json', 'maps/headwater-crossing.json', 'maps/sodden-hills.json', 'maps/scorched-oasis.json', 'maps/arid-canyons.json',
  'forces/intro-a.json', 'forces/intro-b.json', 'forces/regent-lance.json', 'forces/mad-cat-lance.json', 'missions/intro.json', 'missions/skirmish.json',
]
