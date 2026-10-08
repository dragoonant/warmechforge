// Concrete shapes of the JSON under src/data (20-data-schema). The engine narrows DataRecord to these with type-only imports.
export type Id = string
export type LocalId = string
export type TechBase = 'IS' | 'Clan'
export type MechTechBase = TechBase | 'Mixed'
export type Loc = 'HD' | 'CT' | 'LT' | 'RT' | 'LA' | 'RA' | 'LL' | 'RL'
export type Edge = 'north' | 'south' | 'east' | 'west'
export type WeaponFlag =
  | 'cluster' | 'streak' | 'pulse' | 'explodes' | 'oneShot' | 'rapidFire' | 'lbx' | 'indirect' | 'directFire'
  | 'heavyLaser' | 'ppc' | 'gauss' | 'ac' | 'missile' | 'energy'

export interface Source { ref: string; url?: string; note?: string; retrieved?: string }
export interface VerifyNote { path: string; note: string; status?: 'unconfirmed' | 'standIn' | 'conflict' }
export interface Ranges { min?: number; short: number; medium: number; long: number }
export type Damage = number | { short: number; medium: number; long: number }
export interface Cluster { rackSize: number; groupSize: number; clusterMod?: number }

export interface Weapon {
  id: Id; name: string; shortName?: string; techBase: TechBase; category: 'energy' | 'ballistic' | 'missile'
  heat: number; damage: Damage; cluster?: Cluster; ranges: Ranges; toHitMod?: number; slots: number; tons: number
  ammo?: Id[]; flags?: WeaponFlag[]; rapidFire?: { modes: number[]; jamHook?: string }
  linkable?: ('capacitor' | 'artemis' | 'targetingComputer')[]; code?: string[]; notes?: string
  source: Source; verify?: VerifyNote[]
}
export interface AmmoOverride {
  damage?: Damage; cluster?: Cluster; noCluster?: true; ranges?: Ranges; toHitMod?: number
  addFlags?: WeaponFlag[]; removeFlags?: WeaponFlag[]
}
export interface Ammo {
  id: Id; name: string; techBase: TechBase; weapons: Id[]; shotsPerTon: number; explodes?: boolean
  explosionPerShot: number; override?: AmmoOverride; code?: string[]; notes?: string; source: Source; verify?: VerifyNote[]
}
export type EquipmentKind =
  | 'heatSink' | 'jumpJet' | 'case' | 'caseII' | 'targetingComputer' | 'supercharger' | 'masc' | 'capacitor' | 'artemis' | 'ams' | 'ecm' | 'other'
export interface Equipment {
  id: Id; name: string; techBase: TechBase; kind: EquipmentKind; slots: number | 'perMech'; tons: number | 'perMech'
  heatSink?: { dissipation: 1 | 2 }; jumpJet?: { improved: boolean }; explodes?: boolean; critEffect?: 'destroy' | 'none'
  code?: string[]; notes?: string; source: Source; verify?: VerifyNote[]
}

export interface Mount {
  id: LocalId; item: Id; location: Loc; rear?: boolean; split?: Loc; linkedTo?: LocalId; slots?: number; tons?: number
}
export interface AmmoBin { id: LocalId; ammo: Id; options?: Id[]; location: Loc; load?: 'full' | 'half' }
export type ArmorFront = Record<Loc, number>
export interface Mech {
  id: Id; chassis: string; model: string; figure?: Id; tonnage: number; techBase: MechTechBase; omni?: boolean; stock?: boolean
  engine: { type: 'standard' | 'xl' | 'light' | 'compact' | 'xxl'; techBase?: TechBase; rating: number }
  gyro?: 'standard' | 'compact' | 'heavyDuty' | 'xl'; cockpit?: 'standard' | 'small'
  movement: { walk: number; run: number; jump: number }
  heatSinks: { count: number; type: 'single' | 'double'; techBase?: TechBase }
  structure: { type: 'standard' | 'endoSteel' | 'composite' | 'reinforced' | 'endoComposite'; techBase?: TechBase }
  armor: { type: string; techBase?: TechBase; front: ArmorFront; rear: { CT: number; LT: number; RT: number } }
  crits: Record<Loc, string[]>
  mounts: Mount[]; ammoBins: AmmoBin[]; bv: number; quirks?: never[]
  source: Source; valueSources?: Record<string, Source>; verify?: VerifyNote[]
}

export interface Pilot {
  id: Id; name: string; callsign?: string; affiliation?: string; gunnery: number; piloting: number; spas: Id[]
  preferredMech?: Id; bio?: string; portrait?: string; source: Source; verify?: VerifyNote[]
}
export interface Spa {
  id: Id; name: string; cost: number; text: string; hook: string; windows?: string[]; params?: Record<string, unknown>
  usage?: 'always' | 'oncePerTurn' | 'oncePerGame' | 'choice'; source: Source; verify?: VerifyNote[]
}

export type Feature =
  | { type: 'lightWoods' | 'heavyWoods' | 'rough' | 'rubble' | 'pavement' | 'sand' | 'mud' | 'swamp' | 'ice' | 'snow' | 'foliage' }
  | { type: 'water'; depth: number }
  | { type: 'road'; exits: number[] }
  | { type: 'building'; class: string; cf: number; height: number }
export interface MapHex { level?: number; terrain?: Feature[]; label?: string }
export interface GameMap {
  id: Id; name: string; theme: 'grasslands' | 'desert'; width: number; height: number; defaultLevel?: number
  hexes?: Record<string, MapHex>; sheets?: { map: Id; col: number; row: number; rotate180?: boolean }[]
  notes?: string; source: Source; verify?: VerifyNote[]
}

export interface ForceUnit {
  slot?: LocalId; mech: Id; pilot?: Id; skills?: { gunnery: number; piloting: number }; name?: string
  ammo?: Record<LocalId, Id>; halfLoad?: LocalId[]
}
export interface Force {
  id: Id; name: string; faction?: string; color?: string; bvBudget?: number; units: ForceUnit[]
  source?: Source; verify?: VerifyNote[]
}

export type Deployment = { mode: 'edgeEntry' } | { mode: 'edgePlace'; depth: number } | { mode: 'hexes'; hexes: string[] }
export interface MissionSide {
  id: LocalId; label: string; force: Id | 'pick'; control?: 'human' | 'ai' | 'either'; homeEdge: Edge
  initiativeMod?: number; deployment: Deployment
}
export type Victory =
  | { type: 'eliminate'; cripple?: boolean }
  | { type: 'turnLimitBV' }
  | { type: 'objective'; hook: string; params?: Record<string, unknown>; text?: string }
export interface Mission {
  id: Id; name: string; kind: 'intro' | 'skirmish' | 'box'; status?: 'ready' | 'todo'; order?: number; briefing?: string
  map: Id | 'choose'; mapChoices?: Id[]; sides: [MissionSide, MissionSide]; defaultHumanSide?: LocalId; turnLimit?: number
  victory: Victory[]
  options: { forcedWithdrawal: 'off' | 'on' | 'playerChoice'; halfLoads?: boolean; pilotCards?: boolean; bvBudget?: number; weather?: never[] }
  specialRules?: { id: LocalId; text: string; hook?: string; params?: Record<string, unknown> }[]
  source: Source; verify?: VerifyNote[]
}

export interface InternalStructureRow { HD: 3; CT: number; sideTorso: number; arm: number; leg: number }
export type Tables = {
  internalStructure: Record<string, InternalStructureRow>
  bvSkillMultiplier: { rows: number[][]; source: Source; verify?: VerifyNote[] }
  [extra: string]: unknown
}
