// Where a manifest asset lives, relative to the site base: audio/<id>.mp3, music under audio/music/<id>.mp3.
import type { AudioAsset } from './manifest'

export const audioPath = (a: Pick<AudioAsset, 'id' | 'kind'>): string =>
  a.kind === 'music' ? `audio/music/${a.id}.mp3` : `audio/${a.id}.mp3`
