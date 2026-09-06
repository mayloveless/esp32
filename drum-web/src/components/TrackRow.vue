<script setup lang="ts">
import StepGrid from './StepGrid.vue'
import type { TrackName } from '../types/drum'

defineProps<{
  name: TrackName
  steps: boolean[]
  currentStep: number
}>()

const emit = defineEmits<{
  toggle: [step: number]
}>()
</script>

<template>
  <section class="track-row">
    <h2>{{ name === 'hihat' ? 'HiHat' : name[0].toUpperCase() + name.slice(1) }}</h2>
    <div class="grid-wrap">
      <StepGrid :steps="steps" :current-step="currentStep" @toggle="emit('toggle', $event)" />
    </div>
  </section>
</template>

<style scoped>
.track-row { display: grid; grid-template-columns: 88px minmax(0, 1fr); align-items: center; gap: 20px; padding: 18px 0; border-bottom: 1px solid #333947; }
h2 { margin: 0; font-size: .9rem; font-weight: 650; letter-spacing: .04em; color: #cdd3df; }
.grid-wrap { overflow-x: auto; padding: 5px 3px; }
@media (max-width: 620px) { .track-row { grid-template-columns: 1fr; gap: 7px; } }
</style>
