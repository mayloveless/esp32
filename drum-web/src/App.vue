<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'
import TrackRow from './components/TrackRow.vue'
import Transport from './components/Transport.vue'
import { Sequencer } from './audio/sequencer'
import { sendPattern } from './api/esp32'
import { useDrumStore } from './stores/drum'
import { trackNames } from './types/drum'

const ESP32_IP_STORAGE_KEY = 'drum-web.esp32-ip'
const drum = useDrumStore()
const esp32Ip = ref(localStorage.getItem(ESP32_IP_STORAGE_KEY) ?? '')
const connectionStatus = ref('')
const sendingPattern = ref(false)
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

function saveEsp32Ip() {
  const ip = esp32Ip.value.trim()
  if (!ip) {
    connectionStatus.value = '请输入 ESP32 IP 地址'
    return
  }

  esp32Ip.value = ip
  localStorage.setItem(ESP32_IP_STORAGE_KEY, ip)
  connectionStatus.value = 'ESP32 IP 已保存'
}

async function sendToEsp32() {
  if (!esp32Ip.value.trim()) {
    connectionStatus.value = '请先填写 ESP32 IP 地址'
    return
  }

  saveEsp32Ip()
  sendingPattern.value = true
  connectionStatus.value = '正在发送 pattern…'

  try {
    await sendPattern(esp32Ip.value, drum.pattern)
    connectionStatus.value = 'Pattern 已发送至 ESP32'
  } catch (error) {
    connectionStatus.value = error instanceof Error ? error.message : '发送失败，请检查网络和 IP'
  } finally {
    sendingPattern.value = false
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
      <section class="esp32-panel" aria-label="ESP32 connection">
        <label for="esp32-ip">ESP32 IP</label>
        <input id="esp32-ip" v-model="esp32Ip" placeholder="192.168.x.x" inputmode="decimal" @keydown.enter="saveEsp32Ip" />
        <button class="secondary-button" @click="saveEsp32Ip">Connect</button>
        <button class="send-button" :disabled="sendingPattern" @click="sendToEsp32">
          {{ sendingPattern ? 'Sending…' : 'Send To ESP32' }}
        </button>
        <output v-if="connectionStatus" class="connection-status" aria-live="polite">{{ connectionStatus }}</output>
      </section>
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
.esp32-panel { display: flex; flex-wrap: wrap; align-items: center; gap: 9px; margin-top: 22px; padding: 13px; border: 1px solid #333947; border-radius: 9px; background: #1d212a; }
.esp32-panel label { color: #aeb7c8; font-size: .78rem; font-weight: 650; }
.esp32-panel input { min-width: 150px; flex: 1; height: 34px; padding: 0 10px; border: 1px solid #4b5262; border-radius: 6px; outline: 0; color: #f5f7fb; background: #141820; }
.esp32-panel input:focus { border-color: #68ddaf; }
.secondary-button, .send-button { height: 34px; padding: 0 12px; border: 0; border-radius: 6px; cursor: pointer; font-size: .78rem; font-weight: 700; }
.secondary-button { color: #dce2ed; background: #3a4354; }.send-button { color: #11151c; background: #68ddaf; }.send-button:disabled { cursor: wait; opacity: .65; }
.connection-status { width: 100%; color: #aeb7c8; font-size: .72rem; }
.legend { display: flex; align-items: center; gap: 8px; margin: 21px 0 7px 108px; color: #8f99ab; font-size: .72rem; }
.legend span { display: inline-block; width: 8px; height: 8px; border-radius: 50%; }
.active-dot { background: #68ddaf; }.playhead-dot { margin-left: 10px; border: 2px solid #f4c95d; }
@media (max-width: 620px) { .machine { border-radius: 10px; } .esp32-panel input { flex-basis: 100%; } .legend { margin-left: 0; } }
</style>
