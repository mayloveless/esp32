import assert from "node:assert/strict";
import test from "node:test";
import { TtsError } from "../tts/validation.ts";
import { applyMachineRadioEffect } from "./audio-effects.ts";
import { buildPcmWav, parsePcmWav, type WavPcmFormat } from "./wav.ts";

const pcm16Mono: WavPcmFormat = {
  bitsPerSample: 16,
  blockAlign: 2,
  byteRate: 64_000,
  channels: 1,
  sampleRate: 32_000,
};

function signalWav(durationMs = 120) {
  const frames = Math.round((pcm16Mono.sampleRate * durationMs) / 1_000);
  const data = new Uint8Array(frames * pcm16Mono.blockAlign);
  const view = new DataView(data.buffer);
  for (let frame = 0; frame < frames; frame += 1) {
    const sample = Math.round(
      Math.sin((2 * Math.PI * 440 * frame) / pcm16Mono.sampleRate) * 24_000,
    );
    view.setInt16(frame * 2, sample, true);
  }
  return buildPcmWav(pcm16Mono, data);
}

function meanAbsoluteDifference(left: Uint8Array, right: Uint8Array) {
  const leftView = new DataView(left.buffer, left.byteOffset, left.byteLength);
  const rightView = new DataView(right.buffer, right.byteOffset, right.byteLength);
  let total = 0;
  for (let offset = 0; offset < left.length; offset += 2)
    total += Math.abs(leftView.getInt16(offset, true) - rightView.getInt16(offset, true));
  return total / (left.length / 2);
}

test("机械通信后处理保持 PCM WAV 的格式与时长", () => {
  const input = parsePcmWav(signalWav());
  const output = parsePcmWav(applyMachineRadioEffect(signalWav()));
  assert.deepEqual(output.format, input.format);
  assert.equal(Math.round(output.durationMs), Math.round(input.durationMs));
  assert.notDeepEqual(output.data, input.data);
  assert.ok(
    meanAbsoluteDifference(output.data, input.data) > 1_500,
    "机械通信后处理应改变原始声线，而非仅产生轻微误差。",
  );
  const view = new DataView(output.data.buffer, output.data.byteOffset, output.data.byteLength);
  for (let offset = 0; offset < output.data.length; offset += 2) {
    const sample = view.getInt16(offset, true);
    assert.ok(sample >= -32_768 && sample <= 32_767);
  }
});

test("机械通信后处理对相同输入保持确定性", () => {
  const input = signalWav();
  assert.deepEqual(
    applyMachineRadioEffect(input),
    applyMachineRadioEffect(input),
  );
});

test("机械通信后处理会明确拒绝非 16-bit PCM WAV", () => {
  const pcm8: WavPcmFormat = {
    bitsPerSample: 8,
    blockAlign: 1,
    byteRate: 32_000,
    channels: 1,
    sampleRate: 32_000,
  };
  const audio = buildPcmWav(pcm8, new Uint8Array(320));
  assert.throws(
    () => applyMachineRadioEffect(audio),
    (error: unknown) => error instanceof TtsError && /16-bit/.test(error.message),
  );
});
