import type { TrackName } from '../types/drum'

export interface Esp32State {
  bpm: number
  pattern: Record<TrackName, boolean[]>
  playing: boolean
  currentStep: number
}

type StateHandler = (state: Esp32State) => void
type StatusHandler = (message: string) => void

function websocketUrl(address: string) {
  const host = address.trim()
  if (!host) throw new Error('请输入 ESP32 主机名或 IP 地址')

  const source = /^(wss?|https?):\/\//.test(host) ? host : `ws://${host}`
  const url = new URL(source)
  url.protocol = url.protocol === 'https:' || url.protocol === 'wss:' ? 'wss:' : 'ws:'
  if (!url.port) url.port = '81'
  return url.toString().replace(/\/$/, '')
}

function isTrack(value: unknown): value is boolean[] {
  return Array.isArray(value) && value.length === 16 && value.every((step) => typeof step === 'boolean')
}

function parseState(message: unknown): Esp32State | null {
  if (!message || typeof message !== 'object') return null
  const envelope = message as { type?: unknown; data?: unknown }
  if (envelope.type !== 'state_sync' || !envelope.data || typeof envelope.data !== 'object') return null

  const data = envelope.data as {
    bpm?: unknown
    pattern?: Record<TrackName, unknown>
    playing?: unknown
    currentStep?: unknown
  }

  if (
    typeof data.bpm !== 'number' ||
    typeof data.playing !== 'boolean' ||
    typeof data.currentStep !== 'number' ||
    !data.pattern ||
    !isTrack(data.pattern.kick) ||
    !isTrack(data.pattern.snare) ||
    !isTrack(data.pattern.hihat)
  ) {
    return null
  }

  return {
    bpm: data.bpm,
    pattern: {
      kick: data.pattern.kick,
      snare: data.pattern.snare,
      hihat: data.pattern.hihat,
    },
    playing: data.playing,
    currentStep: data.currentStep,
  }
}

/** Lightweight reconnecting WebSocket client for the ESP32 state protocol. */
export class Esp32Socket {
  private socket: WebSocket | null = null
  private reconnectTimer: number | null = null
  private address = ''
  private reconnectEnabled = false

  constructor(
    private readonly onState: StateHandler,
    private readonly onStatus: StatusHandler,
  ) {}

  connect(address: string) {
    this.address = address.trim()
    this.reconnectEnabled = true
    this.clearReconnectTimer()
    this.closeCurrentSocket()
    this.open()
  }

  disconnect() {
    this.reconnectEnabled = false
    this.clearReconnectTimer()
    this.closeCurrentSocket()
    this.onStatus('WebSocket 已断开')
  }

  send(type: string, data: object) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return false
    this.socket.send(JSON.stringify({ type, data }))
    return true
  }

  private open() {
    let url: string
    try {
      url = websocketUrl(this.address)
    } catch (error) {
      this.onStatus(error instanceof Error ? error.message : 'ESP32 地址无效')
      return
    }

    this.onStatus(`正在连接 ${url}`)
    const socket = new WebSocket(url)
    this.socket = socket

    socket.onopen = () => {
      if (this.socket !== socket) return
      this.onStatus('WebSocket 已连接')
      this.send('get_state', {})
    }

    socket.onmessage = (event) => {
      let message: unknown
      try {
        message = JSON.parse(String(event.data))
      } catch {
        return
      }

      const state = parseState(message)
      if (state) this.onState(state)
    }

    socket.onclose = () => {
      if (this.socket !== socket) return
      this.socket = null
      if (!this.reconnectEnabled) return
      this.onStatus('连接已断开，3 秒后重试…')
      this.reconnectTimer = window.setTimeout(() => this.open(), 3000)
    }
  }

  private closeCurrentSocket() {
    if (!this.socket) return
    const socket = this.socket
    this.socket = null
    socket.close()
  }

  private clearReconnectTimer() {
    if (this.reconnectTimer === null) return
    window.clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
  }
}
