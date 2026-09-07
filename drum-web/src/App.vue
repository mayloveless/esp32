<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import TrackRow from './components/TrackRow.vue'
import Transport from './components/Transport.vue'
import { Esp32Socket, type Esp32State } from './api/esp32'
import { useDrumStore } from './stores/drum'
import { trackNames, type TrackName } from './types/drum'

const DEFAULT_ESP32_HOST = '192.168.4.1'
const drum = useDrumStore()
const connectionStatus = ref('')
const settingsOpen = ref(false)
const wifiSsid = ref('')
const wifiPassword = ref('')

function applyEsp32State(state: Esp32State) {
  drum.syncFromEsp32(
    {
      bpm: state.bpm,
      kick: state.pattern.kick,
      snare: state.pattern.snare,
      hihat: state.pattern.hihat,
    },
    state.playing,
    state.currentStep,
  )

}

const esp32Socket = new Esp32Socket(applyEsp32State, (status) => {
  connectionStatus.value = status
})

function sendCommand(type: string, data: object) {
  if (esp32Socket.send(type, data)) return true
  connectionStatus.value = '尚未连接 ESP32，无法发送命令'
  return false
}

function togglePlayback() {
  if (!sendCommand('set_playing', { playing: !drum.playing })) return
}

function changeBpm(amount: number) {
  sendCommand('set_bpm', { bpm: drum.bpm + amount })
}

function setBpm(bpm: number) {
  sendCommand('set_bpm', { bpm })
}

function toggleStep(track: TrackName, step: number) {
  sendCommand('toggle_step', { track, step })
}

function resetPattern() {
  if (sendCommand('reset_pattern', {})) {
    connectionStatus.value = '正在恢复初始 Pattern…'
  }
}

function saveWiFiSettings() {
  const ssid = wifiSsid.value.trim()
  if (!ssid) {
    connectionStatus.value = '请输入 Wi-Fi SSID'
    return
  }

  if (!sendCommand('set_wifi', { ssid, password: wifiPassword.value })) return

  wifiSsid.value = ssid
  wifiPassword.value = ''
  settingsOpen.value = false
  connectionStatus.value = 'Wi-Fi 设置已发送；ESP32 正在重启并连接新网络'
}

onMounted(() => esp32Socket.connect(DEFAULT_ESP32_HOST))
onBeforeUnmount(() => esp32Socket.disconnect())
</script>

<template>
  <main>
    <div class="machine">
      <Transport
        :bpm="drum.bpm"
        :playing="drum.playing"
        @change-bpm="changeBpm"
        @set-bpm="setBpm"
        @toggle-playback="togglePlayback"
      />
      <section class="esp32-panel" aria-label="ESP32 connection">
        <span class="esp32-host">ESP32 AP: {{ DEFAULT_ESP32_HOST }}</span>
        <button class="reset-button" @click="resetPattern">恢复初始 Pattern</button>
        <button class="settings-button" @click="settingsOpen = !settingsOpen">Settings</button>
        <output v-if="connectionStatus" class="connection-status" aria-live="polite">{{ connectionStatus }}</output>
      </section>
      <section v-if="settingsOpen" class="settings-panel" aria-label="Wi-Fi settings">
        <div>
          <h2>ESP32 Wi-Fi</h2>
          <p>先连接 ESP32-Drum 热点。保存后设备会保留热点，并同时尝试接入这里填写的 Wi-Fi。</p>
        </div>
        <label>
          SSID
          <input v-model="wifiSsid" autocomplete="username" maxlength="32" placeholder="Wi-Fi 名称" />
        </label>
        <label>
          Password
          <input v-model="wifiPassword" type="password" autocomplete="new-password" maxlength="63" placeholder="Wi-Fi 密码（开放网络可留空）" @keydown.enter="saveWiFiSettings" />
        </label>
        <div class="settings-actions">
          <button class="secondary-button" @click="settingsOpen = false">Cancel</button>
          <button class="save-button" @click="saveWiFiSettings">Save Wi-Fi</button>
        </div>
      </section>
      <div class="legend"><span class="active-dot" /> active step <span class="playhead-dot" /> playhead</div>
      <div class="tracks">
        <TrackRow
          v-for="track in trackNames"
          :key="track"
          :name="track"
          :steps="drum.pattern[track]"
          :current-step="drum.currentStep"
          @toggle="toggleStep(track, $event)"
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
.esp32-host { flex: 1; color: #aeb7c8; font-size: .78rem; font-weight: 650; }
.settings-button, .secondary-button, .save-button, .reset-button { height: 34px; padding: 0 12px; border: 0; border-radius: 6px; cursor: pointer; font-size: .78rem; font-weight: 700; }
.settings-button, .secondary-button { color: #dce2ed; background: #3a4354; }.save-button { color: #11151c; background: #68ddaf; }
.reset-button { color: #f4c95d; background: #463b23; }
.connection-status { width: 100%; color: #aeb7c8; font-size: .72rem; }
.settings-panel { display: grid; gap: 14px; margin-top: 10px; padding: 17px; border: 1px solid #3c4353; border-radius: 9px; background: #1b2029; }
.settings-panel h2 { margin: 0; color: #f5f7fb; font-size: .95rem; }.settings-panel p { margin: 5px 0 0; color: #9aa5b7; font-size: .75rem; line-height: 1.45; }
.settings-panel label { display: grid; gap: 6px; color: #cbd3e0; font-size: .78rem; font-weight: 650; }.settings-panel input { height: 36px; padding: 0 10px; border: 1px solid #4b5262; border-radius: 6px; outline: 0; color: #f5f7fb; background: #141820; }.settings-panel input:focus { border-color: #68ddaf; }
.settings-actions { display: flex; justify-content: flex-end; gap: 8px; }
.legend { display: flex; align-items: center; gap: 8px; margin: 21px 0 7px 108px; color: #8f99ab; font-size: .72rem; }
.legend span { display: inline-block; width: 8px; height: 8px; border-radius: 50%; }
.active-dot { background: #68ddaf; }.playhead-dot { margin-left: 10px; border: 2px solid #f4c95d; }
@media (max-width: 620px) { .machine { border-radius: 10px; } .legend { margin-left: 0; } }
</style>
