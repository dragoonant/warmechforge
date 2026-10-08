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
import testCanyons from './maps/test-canyons.json'
import introA from './forces/intro-a.json'
import introB from './forces/intro-b.json'
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
  mechs: cast<Mech[]>([uzl2s, ers2n, solitairePrime, mdg1a]),
  maps: cast<GameMap[]>([testCanyons]),
  forces: cast<Force[]>([introA, introB]),
  missions: cast<Mission[]>([intro, skirmish]),
}

/** Paths (relative to src/data, forward slashes) of every JSON file imported above. */
export const RAW_FILES: readonly string[] = [
  'core/weapons.json', 'core/ammo.json', 'core/equipment.json', 'core/tables.json', 'core/spas.json', 'pilots/pilots.json',
  'mechs/uziel/uzl-2s.json', 'mechs/eris/ers-2n.json', 'mechs/solitaire/prime.json', 'mechs/rakshasa/mdg-1a.json',
  'maps/test-canyons.json', 'forces/intro-a.json', 'forces/intro-b.json', 'missions/intro.json', 'missions/skirmish.json',
]
