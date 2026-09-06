<script setup lang="ts">
defineProps<{
  steps: boolean[]
  currentStep: number
}>()

const emit = defineEmits<{
  toggle: [step: number]
}>()
</script>

<template>
  <div class="step-grid" aria-label="16-step sequencer">
    <button
      v-for="(active, step) in steps"
      :key="step"
      class="step"
      :class="{ active, 'current-step': currentStep === step }"
      :aria-label="`Step ${step + 1}`"
      :aria-pressed="active"
      @click="emit('toggle', step)"
    >
      <span>{{ step + 1 }}</span>
    </button>
  </div>
</template>

<style scoped>
.step-grid { display: grid; grid-template-columns: repeat(16, minmax(0, 1fr)); gap: 6px; min-width: 510px; }
.step { aspect-ratio: 1; border: 1px solid #4b5262; border-radius: 5px; color: #767d8c; background: #252a35; cursor: pointer; transition: background .12s, border-color .12s, transform .12s; }
.step:nth-child(4n + 1) { border-left-color: #8b95a9; }
.step:hover { transform: translateY(-1px); border-color: #b5bfd3; }
.step.active { color: #11151c; background: #68ddaf; border-color: #9cf0ce; }
.step.current-step { outline: 2px solid #f4c95d; outline-offset: 2px; }
.step span { font-size: .65rem; }
@media (max-width: 620px) { .step-grid { min-width: 430px; gap: 4px; } .step span { font-size: .55rem; } }
</style>
