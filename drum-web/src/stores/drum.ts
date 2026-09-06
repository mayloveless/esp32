import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { MAX_BPM, MIN_BPM, STEP_COUNT, type DrumPattern, type TrackName } from '../types/drum'

const createSteps = (activeSteps: number[] = []) =>
  Array.from({ length: STEP_COUNT }, (_, index) => activeSteps.includes(index))

const createDefaultPattern = (): DrumPattern => ({
  bpm: 120,
  kick: createSteps([0, 4, 8, 12]),
  snare: createSteps([4, 12]),
  hihat: createSteps(Array.from({ length: STEP_COUNT }, (_, index) => index)),
})

export const useDrumStore = defineStore('drum', () => {
  // This object is deliberately JSON-serializable for a future WebSocket/ESP32 bridge.
  const pattern = ref<DrumPattern>(createDefaultPattern())
  const playing = ref(false)
  const currentStep = ref(-1)
  const bpm = computed(() => pattern.value.bpm)

  function changeBpm(amount: number) {
    setBpm(pattern.value.bpm + amount)
  }

  function setBpm(value: number) {
    if (!Number.isFinite(value)) return
    pattern.value.bpm = Math.min(MAX_BPM, Math.max(MIN_BPM, Math.round(value)))
  }

  function toggleStep(track: TrackName, step: number) {
    if (step < 0 || step >= STEP_COUNT) return
    pattern.value[track][step] = !pattern.value[track][step]
  }

  function setCurrentStep(step: number) {
    currentStep.value = step
  }

  function start() {
    playing.value = true
  }

  function stop() {
    playing.value = false
    currentStep.value = -1
  }

  return {
    pattern,
    bpm,
    playing,
    currentStep,
    changeBpm,
    setBpm,
    toggleStep,
    setCurrentStep,
    start,
    stop,
  }
})
