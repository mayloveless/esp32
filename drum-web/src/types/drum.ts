export const STEP_COUNT = 16
export const MIN_BPM = 40
export const MAX_BPM = 240

export type TrackName = 'kick' | 'snare' | 'hihat'

export interface DrumPattern {
  bpm: number
  kick: boolean[]
  snare: boolean[]
  hihat: boolean[]
}

export const trackNames: TrackName[] = ['kick', 'snare', 'hihat']
