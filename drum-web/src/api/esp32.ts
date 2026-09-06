import type { DrumPattern } from '../types/drum'

function patternUrl(esp32Ip: string) {
  const address = esp32Ip.trim().replace(/\/$/, '')
  if (!address) throw new Error('请输入 ESP32 IP 地址')

  const baseUrl = address.startsWith('http://') || address.startsWith('https://')
    ? address
    : `http://${address}`

  return `${baseUrl}/api/pattern`
}

/** Sends the same JSON-serializable pattern used by the local sequencer. */
export async function sendPattern(esp32Ip: string, pattern: DrumPattern) {
  const response = await fetch(patternUrl(esp32Ip), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(pattern),
  })

  const responseText = await response.text()
  if (!response.ok) {
    throw new Error(`ESP32 返回 ${response.status}${responseText ? `: ${responseText}` : ''}`)
  }
}
