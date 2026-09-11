import { TtsError } from "../tts/validation.ts";
import { buildPcmWav, parsePcmWav } from "./wav.ts";

export const machineRadioEffect = "machine-radio-v4";

// 收窄到通信设备常见的人声频带，削弱真人声线中的低频厚度与高频气声。
const highPassCutoffHz = 520;
const lowPassCutoffHz = 3_400;
// 保持低深度载波调制，避免周期性翻转波形造成明显失真。
const ringFrequencyHz = 78;
const ringWet = 0.18;

function clampSample(value: number) {
  return Math.max(-1, Math.min(1, value));
}

function filterCoefficient(cutoffHz: number, sampleRate: number) {
  const deltaTime = 1 / sampleRate;
  const resistance = 1 / (2 * Math.PI * cutoffHz);
  return deltaTime / (resistance + deltaTime);
}

/**
 * 将 16-bit PCM WAV 处理为机械通信音色，不改变采样率、声道或时长。
 * 处理只在 machine-1 使用：窄频与低深度金属调制共同削弱真人声线。
 */
export function applyMachineRadioEffect(audioBytes: Uint8Array) {
  const parsed = parsePcmWav(audioBytes);
  const { format } = parsed;
  if (format.bitsPerSample !== 16)
    throw new TtsError("机械通信后处理目前只支持 16-bit PCM WAV。", "audio");

  const output = new Uint8Array(parsed.data.length);
  const inputView = new DataView(
    parsed.data.buffer,
    parsed.data.byteOffset,
    parsed.data.byteLength,
  );
  const outputView = new DataView(output.buffer);
  const highPassAlpha = 1 - filterCoefficient(highPassCutoffHz, format.sampleRate);
  const lowPassAlpha = filterCoefficient(lowPassCutoffHz, format.sampleRate);
  const previousInput = new Array<number>(format.channels).fill(0);
  const previousHighPass = new Array<number>(format.channels).fill(0);
  const previousLowPass = new Array<number>(format.channels).fill(0);
  const frames = parsed.data.length / format.blockAlign;

  for (let frame = 0; frame < frames; frame += 1) {
    const ring = Math.sin((2 * Math.PI * ringFrequencyHz * frame) / format.sampleRate);
    for (let channel = 0; channel < format.channels; channel += 1) {
      const offset = frame * format.blockAlign + channel * 2;
      const input = inputView.getInt16(offset, true) / 32_768;
      const highPass = highPassAlpha * (
        previousHighPass[channel] + input - previousInput[channel]
      );
      const lowPass =
        previousLowPass[channel] + lowPassAlpha * (highPass - previousLowPass[channel]);
      const modulated = lowPass * (1 - ringWet) + lowPass * ring * ringWet;
      const encoded = Math.round(clampSample(modulated) * 32_767);
      outputView.setInt16(offset, encoded, true);
      previousInput[channel] = input;
      previousHighPass[channel] = highPass;
      previousLowPass[channel] = lowPass;
    }
  }

  return buildPcmWav(format, output);
}
