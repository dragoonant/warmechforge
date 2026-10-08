// Runtime mirror of tools/audio-manifest.json (ids, kinds, groups, loop flags, narrator text). Prompts stay in the tools file.
// SFX and voice live at audio/<id>.mp3, music at audio/music/<id>.mp3 (relative to the site base, /warmechforge/ on Pages).
export type AudioKind = 'sfx' | 'voice' | 'music'
export type VoiceRole = 'narrator' | 'computer'

export interface AudioAsset {
  id: string
  kind: AudioKind
  group: string
  voice?: VoiceRole
  loop?: boolean
  durationSeconds?: number
  /** Not generated yet: the client never requests it (avoids 404s on Pages). Remove the flag once the mp3 ships. */
  pending?: boolean
  text?: string
}

export const AUDIO_ASSETS: readonly AudioAsset[] = [
  { id: 'mv-step-light', kind: 'sfx', group: 'movement', durationSeconds: 0.7 },
  { id: 'mv-step-medium', kind: 'sfx', group: 'movement', durationSeconds: 0.9 },
  { id: 'mv-step-heavy', kind: 'sfx', group: 'movement', durationSeconds: 1.1 },
  { id: 'mv-step-assault', kind: 'sfx', group: 'movement', durationSeconds: 1.4 },
  { id: 'mv-torso-twist', kind: 'sfx', group: 'movement', durationSeconds: 1 },
  { id: 'mv-jump-ignite', kind: 'sfx', group: 'movement', durationSeconds: 1 },
  { id: 'mv-jump-thrust', kind: 'sfx', group: 'movement', durationSeconds: 1.5 },
  { id: 'mv-jump-land', kind: 'sfx', group: 'movement', durationSeconds: 1 },
  { id: 'mv-fall', kind: 'sfx', group: 'movement', durationSeconds: 2 },
  { id: 'mv-standup', kind: 'sfx', group: 'movement', durationSeconds: 2 },
  { id: 'wp-laser-small', kind: 'sfx', group: 'weapon', durationSeconds: 0.5 },
  { id: 'wp-laser-medium', kind: 'sfx', group: 'weapon', durationSeconds: 0.7 },
  { id: 'wp-laser-large', kind: 'sfx', group: 'weapon', durationSeconds: 1 },
  { id: 'wp-laser-er', kind: 'sfx', group: 'weapon', durationSeconds: 0.8 },
  { id: 'wp-laser-pulse', kind: 'sfx', group: 'weapon', durationSeconds: 0.8 },
  { id: 'wp-laser-heavy', kind: 'sfx', group: 'weapon', durationSeconds: 1.2 },
  { id: 'wp-laser-xpulse', kind: 'sfx', group: 'weapon', durationSeconds: 0.8 },
  { id: 'wp-ppc', kind: 'sfx', group: 'weapon', durationSeconds: 1.2 },
  { id: 'wp-ppc-light', kind: 'sfx', group: 'weapon', durationSeconds: 0.8 },
  { id: 'wp-ac', kind: 'sfx', group: 'weapon', durationSeconds: 0.9 },
  { id: 'wp-ac-lbx', kind: 'sfx', group: 'weapon', durationSeconds: 1.2 },
  { id: 'wp-ac-ultra', kind: 'sfx', group: 'weapon', durationSeconds: 0.9 },
  { id: 'wp-ac-rotary', kind: 'sfx', group: 'weapon', durationSeconds: 1.5 },
  { id: 'wp-ac-proto', kind: 'sfx', group: 'weapon', durationSeconds: 0.6 },
  { id: 'wp-gauss', kind: 'sfx', group: 'weapon', durationSeconds: 1.4 },
  { id: 'wp-lrm', kind: 'sfx', group: 'weapon', durationSeconds: 1.8 },
  { id: 'wp-srm', kind: 'sfx', group: 'weapon', durationSeconds: 1 },
  { id: 'wp-mml', kind: 'sfx', group: 'weapon', durationSeconds: 1.2 },
  { id: 'wp-missile-impact', kind: 'sfx', group: 'weapon', durationSeconds: 1.5 },
  { id: 'wp-mg', kind: 'sfx', group: 'weapon', durationSeconds: 0.8 },
  { id: 'ph-punch', kind: 'sfx', group: 'physical', durationSeconds: 0.8 },
  { id: 'ph-kick', kind: 'sfx', group: 'physical', durationSeconds: 0.9 },
  { id: 'ph-charge', kind: 'sfx', group: 'physical', durationSeconds: 1.5 },
  { id: 'ph-dfa', kind: 'sfx', group: 'physical', durationSeconds: 1.8 },
  { id: 'dm-armor', kind: 'sfx', group: 'damage', durationSeconds: 0.8 },
  { id: 'dm-internal', kind: 'sfx', group: 'damage', durationSeconds: 1 },
  { id: 'dm-crit', kind: 'sfx', group: 'damage', durationSeconds: 0.7 },
  { id: 'dm-limb', kind: 'sfx', group: 'damage', durationSeconds: 1.8 },
  { id: 'dm-ammo-explosion', kind: 'sfx', group: 'damage', durationSeconds: 2.5 },
  { id: 'dm-engine-breach', kind: 'sfx', group: 'damage', durationSeconds: 2 },
  { id: 'dm-destroyed', kind: 'sfx', group: 'damage', durationSeconds: 3 },
  { id: 'dm-cockpit', kind: 'sfx', group: 'damage', durationSeconds: 1 },
  { id: 'ht-warning', kind: 'sfx', group: 'heat', durationSeconds: 1.5 },
  { id: 'ht-shutdown', kind: 'sfx', group: 'heat', durationSeconds: 2 },
  { id: 'ht-startup', kind: 'sfx', group: 'heat', durationSeconds: 2 },
  { id: 'ht-vent', kind: 'sfx', group: 'heat', durationSeconds: 1.5 },
  { id: 'ui-click', kind: 'sfx', group: 'ui', durationSeconds: 0.5 },
  { id: 'ui-dice', kind: 'sfx', group: 'ui', durationSeconds: 1.2 },
  { id: 'ui-turn-bell', kind: 'sfx', group: 'ui', durationSeconds: 1.5 },
  { id: 'nar-initiative', kind: 'voice', group: 'narrator', voice: 'narrator', text: "Initiative" },
  { id: 'nar-movement', kind: 'voice', group: 'narrator', voice: 'narrator', text: "Movement phase" },
  { id: 'nar-ranged', kind: 'voice', group: 'narrator', voice: 'narrator', text: "Ranged attacks" },
  { id: 'nar-physical', kind: 'voice', group: 'narrator', voice: 'narrator', text: "Physical attacks" },
  { id: 'nar-heat', kind: 'voice', group: 'narrator', voice: 'narrator', text: "Heat phase" },
  { id: 'nar-critical', kind: 'voice', group: 'narrator', voice: 'narrator', text: "Critical hit!" },
  { id: 'nar-ammo', kind: 'voice', group: 'narrator', voice: 'narrator', text: "Ammunition explosion!" },
  { id: 'nar-shutdown', kind: 'voice', group: 'narrator', voice: 'narrator', text: "Shutdown!" },
  { id: 'nar-destroyed', kind: 'voice', group: 'narrator', voice: 'narrator', text: "'Mech destroyed" },
  { id: 'nar-victory', kind: 'voice', group: 'narrator', voice: 'narrator', text: "Victory. The field is ours." },
  { id: 'nar-defeat', kind: 'voice', group: 'narrator', voice: 'narrator', text: "Defeat. The lance is lost." },
  { id: 'cmp-heat-critical', kind: 'voice', group: 'computer', voice: 'computer', text: "Heat level critical" },
  { id: 'cmp-reactor', kind: 'voice', group: 'computer', voice: 'computer', text: "Reactor shutdown imminent" },
  { id: 'cmp-armor-breach', kind: 'voice', group: 'computer', voice: 'computer', text: "Armor breach" },
  { id: 'cmp-weapon-destroyed', kind: 'voice', group: 'computer', voice: 'computer', text: "Weapon destroyed" },
  { id: 'cmp-systems-online', kind: 'voice', group: 'computer', voice: 'computer', text: "Systems online" },
  { id: 'mus-title-a', kind: 'music', group: 'music', loop: true, durationSeconds: 75 },
  { id: 'mus-title-b', kind: 'music', group: 'music', loop: true, durationSeconds: 75 },
  { id: 'mus-battle1-a', kind: 'music', group: 'music', loop: true, durationSeconds: 150 },
  { id: 'mus-battle1-b', kind: 'music', group: 'music', loop: true, durationSeconds: 150 },
  { id: 'mus-battle2-a', kind: 'music', group: 'music', loop: true, durationSeconds: 150 },
  { id: 'mus-battle2-b', kind: 'music', group: 'music', loop: true, durationSeconds: 150 },
  { id: 'mus-victory-a', kind: 'music', group: 'music', durationSeconds: 12 },
  { id: 'mus-victory-b', kind: 'music', group: 'music', durationSeconds: 12 },
  { id: 'mus-defeat-a', kind: 'music', group: 'music', durationSeconds: 12 },
  { id: 'mus-defeat-b', kind: 'music', group: 'music', durationSeconds: 12 },
]

export const AUDIO_BY_ID: Readonly<Record<string, AudioAsset>> = Object.fromEntries(AUDIO_ASSETS.map((a) => [a.id, a]))
