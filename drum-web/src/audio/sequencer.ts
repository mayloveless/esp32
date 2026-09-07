import type { DrumPattern, TrackName } from '../types/drum'
import { STEP_COUNT, trackNames } from '../types/drum'

type PatternSource = () => DrumPattern
type StepListener = (step: number) => void

/**
 * Small, replaceable browser sequencer. It only consumes a serializable pattern,
 * so a later WebSocket transport can send exactly the same data to an ESP32.
 */
export class Sequencer {
  private context: AudioContext | null = null
  private timerId: number | null = null
  private playing = false
  private starting = false
  private startToken = 0
  private nextStep = 0
  private nextStepTime = 0

  constructor(
    private readonly getPattern: PatternSource,
    private readonly onStep: StepListener,
  ) {}

  async start() {
    if (this.playing || this.starting) return

    this.starting = true
    const token = ++this.startToken
    this.context ??= new AudioContext()
    try {
      await this.context.resume()
      if (token !== this.startToken) return

      this.playing = true
      this.nextStep = 0
      this.nextStepTime = this.context.currentTime + 0.03
      this.tick()
    } finally {
      if (token === this.startToken) this.starting = false
    }
  }

  stop() {
    this.startToken += 1
    this.starting = false
    this.playing = false
    if (this.timerId !== null) {
      window.clearTimeout(this.timerId)
      this.timerId = null
    }
  }

  get isRunning() {
    return this.playing || this.starting
  }

  /** Unlocks Web Audio from a browser user gesture without making a sound. */
  async enable() {
    this.context ??= new AudioContext()
    await this.context.resume()
  }

  /** Plays one instrument immediately; used when editing a step while stopped. */
  async preview(track: TrackName) {
    await this.enable()
    if (this.context) this.playSound(track, this.context.currentTime)
  }

  /** Schedules one step and queues the next tick from audio-clock time. */
  tick() {
    if (!this.playing || !this.context) return

    const now = this.context.currentTime
    const pattern = this.getPattern()
    const secondsPerStep = 60 / pattern.bpm / 4

    // If a tab was suspended, skip stale steps rather than producing a burst.
    while (this.nextStepTime < now - secondsPerStep) {
      this.nextStepTime += secondsPerStep
      this.nextStep = (this.nextStep + 1) % STEP_COUNT
    }

    const when = Math.max(this.nextStepTime, now)
    this.playStep(pattern, this.nextStep, when)
    this.onStep(this.nextStep)

    this.nextStep = (this.nextStep + 1) % STEP_COUNT
    this.nextStepTime += secondsPerStep
    const delay = Math.max(0, (this.nextStepTime - this.context.currentTime) * 1000)
    this.timerId = window.setTimeout(() => this.tick(), delay)
  }

  private playStep(pattern: DrumPattern, step: number, when: number) {
    for (const track of trackNames) {
      if (pattern[track][step]) this.playSound(track, when)
    }
  }

  private playSound(track: TrackName, when: number) {
    if (!this.context) return
    if (track === 'kick') this.playKick(when)
    else this.playNoise(track, when)
  }

  private playKick(when: number) {
    const context = this.context!
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    oscillator.type = 'sine'
    oscillator.frequency.setValueAtTime(150, when)
    oscillator.frequency.exponentialRampToValueAtTime(45, when + 0.12)
    gain.gain.setValueAtTime(0.45, when)
    gain.gain.exponentialRampToValueAtTime(0.001, when + 0.18)
    oscillator.connect(gain).connect(context.destination)
    oscillator.start(when)
    oscillator.stop(when + 0.19)
  }

  private playNoise(track: 'snare' | 'hihat', when: number) {
    const context = this.context!
    const duration = track === 'snare' ? 0.13 : 0.045
    const buffer = context.createBuffer(1, Math.ceil(context.sampleRate * duration), context.sampleRate)
    const data = buffer.getChannelData(0)
    for (let index = 0; index < data.length; index += 1) data[index] = Math.random() * 2 - 1

    const source = context.createBufferSource()
    const filter = context.createBiquadFilter()
    const gain = context.createGain()
    source.buffer = buffer
    filter.type = track === 'snare' ? 'bandpass' : 'highpass'
    filter.frequency.value = track === 'snare' ? 1700 : 6500
    gain.gain.setValueAtTime(track === 'snare' ? 0.18 : 0.08, when)
    gain.gain.exponentialRampToValueAtTime(0.001, when + duration)
    source.connect(filter).connect(gain).connect(context.destination)
    source.start(when)
  }
}
