// Sound section for the settings popover: four volume sliders and a mute switch (persisted by the audio manager).
import { audio, initAudio } from './audio'
import { useAudioSettings } from './useAudioSettings'

const BUSES = [['master', 'Master'], ['sfx', 'Effects'], ['voice', 'Narrator'], ['music', 'Music']] as const

export function SoundSettings() {
  const s = useAudioSettings()
  return (
    <div className="set-group" data-testid="sound-settings">
      <div className="set-label">Sound</div>
      {BUSES.map(([bus, label]) => (
        <label key={bus} className="set-row">{label}{' '}
          <input type="range" min={0} max={100} step={1} value={Math.round(s[bus] * 100)} aria-label={`${label} volume`}
            data-testid={`sound-${bus}`} onChange={(e) => { initAudio(); audio.setVolume(bus, Number(e.target.value) / 100) }} />
        </label>
      ))}
      <label className="set-row set-check">
        <input type="checkbox" checked={s.muted} data-testid="sound-mute" onChange={(e) => { initAudio(); audio.setMuted(e.target.checked) }} />
        {' '}Mute all sound
      </label>
    </div>
  )
}
