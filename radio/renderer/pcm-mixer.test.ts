import assert from "node:assert/strict";
import test from "node:test";
import { TtsError } from "../tts/validation.ts";
import { mixSpeechWithBackground } from "./pcm-mixer.ts";
import { buildPcmWav, parsePcmWav, type Caption, type WavPcmFormat } from "./wav.ts";

const format: WavPcmFormat = {
  bitsPerSample: 16,
  blockAlign: 2,
  byteRate: 64_000,
  channels: 1,
  sampleRate: 32_000,
};

function sineWav(durationMs: number, amplitude: number, wavFormat = format) {
  const frames = Math.round((wavFormat.sampleRate * durationMs) / 1_000);
  const data = new Uint8Array(frames * wavFormat.blockAlign);
  const view = new DataView(data.buffer);
  for (let frame = 0; frame < frames; frame += 1) {
    view.setInt16(
      frame * wavFormat.blockAlign,
      Math.round(Math.sin((2 * Math.PI * 100 * frame) / wavFormat.sampleRate) * amplitude),
      true,
    );
  }
  return buildPcmWav(wavFormat, data);
}

function rangeRms(audioBytes: Uint8Array, startMs: number, endMs: number) {
  const parsed = parsePcmWav(audioBytes);
  const view = new DataView(parsed.data.buffer, parsed.data.byteOffset, parsed.data.byteLength);
  const start = Math.round((startMs / 1_000) * parsed.format.sampleRate);
  const end = Math.round((endMs / 1_000) * parsed.format.sampleRate);
  let total = 0;
  for (let frame = start; frame < end; frame += 1) {
    const sample = view.getInt16(frame * 2, true);
    total += sample ** 2;
  }
  return Math.sqrt(total / Math.max(1, end - start));
}

test("none 不改变原始语音字节", () => {
  const speech = sineWav(300, 12_000);
  assert.deepEqual(
    mixSpeechWithBackground(speech, null, { baseGain: 0, captions: [] }).audioBytes,
    speech,
  );
});

test("背景混音拒绝 PCM 格式不一致", () => {
  const incompatible: WavPcmFormat = {
    ...format,
    byteRate: 32_000,
    sampleRate: 16_000,
  };
  assert.throws(
    () => mixSpeechWithBackground(sineWav(120, 1_000), sineWav(120, 1_000, incompatible), {
      baseGain: 0.12,
      captions: [],
    }),
    (error: unknown) => error instanceof TtsError && /PCM 参数/.test(error.message),
  );
});

test("混音会限幅，且最终时长保持语音时长", () => {
  const mixed = mixSpeechWithBackground(sineWav(300, 31_000), sineWav(300, 31_000), {
    baseGain: 0.2,
    captions: [],
  });
  const parsed = parsePcmWav(mixed.audioBytes);
  const view = new DataView(parsed.data.buffer, parsed.data.byteOffset, parsed.data.byteLength);
  let peak = 0;
  for (let offset = 0; offset < parsed.data.length; offset += 2)
    peak = Math.max(peak, Math.abs(view.getInt16(offset, true)));
  assert.equal(mixed.durationMs, 300);
  assert.ok(peak <= Math.round(32_767 * 0.94));
});

test("字幕人声区间内的背景音量明显低于句间", () => {
  const captions: Caption[] = [
    { endMs: 120, speaker: "播音员", startMs: 0, text: "第一句" },
  ];
  const silentSpeech = sineWav(320, 0);
  const mixed = mixSpeechWithBackground(silentSpeech, sineWav(320, 12_000), {
    baseGain: 0.12,
    captions,
    duckedGain: 0.04,
  });
  const speakingRms = rangeRms(mixed.audioBytes, 70, 110);
  const pauseRms = rangeRms(mixed.audioBytes, 210, 280);
  assert.ok(speakingRms < pauseRms * 0.55);
});
