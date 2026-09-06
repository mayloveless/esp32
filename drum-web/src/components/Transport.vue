<script setup lang="ts">
import { ref, watch } from 'vue'
import { MAX_BPM, MIN_BPM } from '../types/drum'

const props = defineProps<{
  bpm: number
  playing: boolean
}>()

const emit = defineEmits<{
  changeBpm: [amount: number]
  setBpm: [value: number]
  togglePlayback: []
}>()

const bpmInput = ref(String(props.bpm))

watch(
  () => props.bpm,
  (bpm) => {
    bpmInput.value = String(bpm)
  },
)

function commitBpm() {
  const value = Number(bpmInput.value)
  if (!Number.isFinite(value)) {
    bpmInput.value = String(props.bpm)
    return
  }

  const normalizedBpm = Math.min(MAX_BPM, Math.max(MIN_BPM, Math.round(value)))
  bpmInput.value = String(normalizedBpm)
  emit('setBpm', normalizedBpm)
}
</script>

<template>
  <header class="transport">
    <div>
      <p class="eyebrow">ESP32 DRUM CONTROL</p>
      <h1>Drum Machine</h1>
    </div>
    <div class="controls">
      <div class="bpm" aria-label="Tempo control">
        <button aria-label="Decrease BPM" @click="emit('changeBpm', -1)">−</button>
        <label class="bpm-input">
          <input
            v-model="bpmInput"
            type="number"
            :min="MIN_BPM"
            :max="MAX_BPM"
            step="1"
            inputmode="numeric"
            aria-label="BPM"
            @change="commitBpm"
            @blur="commitBpm"
            @keydown.enter.prevent="($event.target as HTMLInputElement).blur()"
          />
          <span>BPM</span>
        </label>
        <button aria-label="Increase BPM" @click="emit('changeBpm', 1)">+</button>
      </div>
      <button class="play-button" :class="{ playing }" @click="emit('togglePlayback')">
        {{ playing ? 'Stop' : 'Play' }}
      </button>
    </div>
  </header>
</template>

<style scoped>
.transport { display: flex; justify-content: space-between; align-items: center; gap: 24px; padding-bottom: 28px; border-bottom: 1px solid #333947; }
.eyebrow { margin: 0 0 5px; color: #68ddaf; font-size: .68rem; letter-spacing: .16em; font-weight: 700; }
h1 { margin: 0; color: #f5f7fb; font-size: clamp(1.65rem, 4vw, 2.25rem); letter-spacing: -.04em; }
.controls, .bpm { display: flex; align-items: center; gap: 10px; }
.bpm { padding: 5px; border: 1px solid #3c4353; border-radius: 9px; background: #1d212a; }
.bpm button { width: 28px; height: 32px; border: 0; border-radius: 5px; color: #d7ddea; background: transparent; cursor: pointer; font-size: 1.25rem; }
.bpm button:hover { background: #353c4b; }
.bpm-input { display: grid; min-width: 47px; text-align: center; line-height: 1; }
.bpm-input input { width: 54px; padding: 0; border: 0; outline: 0; color: #f5f7fb; background: transparent; text-align: center; font-size: 1.08rem; font-weight: 700; }
.bpm-input input::-webkit-inner-spin-button { opacity: .45; }
.bpm-input span { margin-top: 3px; color: #8993a5; font-size: .55rem; letter-spacing: .07em; }
.play-button { min-width: 76px; height: 42px; padding: 0 17px; border: 0; border-radius: 8px; background: #68ddaf; color: #11151c; cursor: pointer; font-weight: 750; }
.play-button.playing { color: #fff; background: #dc5c68; }
@media (max-width: 620px) { .transport { align-items: flex-start; flex-direction: column; } .controls { width: 100%; justify-content: space-between; } }
</style>
