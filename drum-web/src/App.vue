<script setup lang="ts">
import { onBeforeUnmount } from 'vue'
import TrackRow from './components/TrackRow.vue'
import Transport from './components/Transport.vue'
import { Sequencer } from './audio/sequencer'
import { useDrumStore } from './stores/drum'
import { trackNames } from './types/drum'

const drum = useDrumStore()
const sequencer = new Sequencer(
  () => drum.pattern,
  (step) => drum.setCurrentStep(step),
)

async function togglePlayback() {
  if (drum.playing) {
    sequencer.stop()
    drum.stop()
    return
  }

  drum.start()
  try {
    await sequencer.start()
  } catch (error) {
    // Audio can be unavailable in restricted browser contexts.
    drum.stop()
    console.error('Unable to start Web Audio', error)
  }
}

onBeforeUnmount(() => sequencer.stop())
</script>

<template>
  <main>
    <div class="machine">
      <Transport
        :bpm="drum.bpm"
        :playing="drum.playing"
        @change-bpm="drum.changeBpm"
        @set-bpm="drum.setBpm"
        @toggle-playback="togglePlayback"
      />
      <div class="legend"><span class="active-dot" /> active step <span class="playhead-dot" /> playhead</div>
      <div class="tracks">
        <TrackRow
          v-for="track in trackNames"
          :key="track"
          :name="track"
          :steps="drum.pattern[track]"
          :current-step="drum.currentStep"
          @toggle="drum.toggleStep(track, $event)"
        />
      </div>
    </div>
  </main>
</template>

<style>
:root { font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #dce2ed; background: #101218; font-synthesis: none; }
* { box-sizing: border-box; }
body { min-width: 320px; min-height: 100vh; margin: 0; }
button { font: inherit; }
main { display: grid; min-height: 100vh; padding: clamp(16px, 5vw, 72px); place-items: center; background: radial-gradient(circle at 15% 0%, #27384a 0, transparent 34rem), #101218; }
.machine { width: min(100%, 960px); padding: clamp(20px, 5vw, 46px); border: 1px solid #363d4c; border-radius: 16px; background: rgb(25 29 37 / .93); box-shadow: 0 24px 80px rgb(0 0 0 / .25); }
.legend { display: flex; align-items: center; gap: 8px; margin: 21px 0 7px 108px; color: #8f99ab; font-size: .72rem; }
.legend span { display: inline-block; width: 8px; height: 8px; border-radius: 50%; }
.active-dot { background: #68ddaf; }.playhead-dot { margin-left: 10px; border: 2px solid #f4c95d; }
@media (max-width: 620px) { .machine { border-radius: 10px; } .legend { margin-left: 0; } }
</style>
