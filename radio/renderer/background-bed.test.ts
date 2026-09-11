import assert from "node:assert/strict";
import test from "node:test";
import { buildPcmWav, parsePcmWav, type WavPcmFormat } from "./wav.ts";
import {
  getBackgroundBedGain,
  getDefaultBackgroundBed,
  synthesizeBackgroundBed,
} from "./background-bed.ts";

const format: WavPcmFormat = {
  bitsPerSample: 16,
  blockAlign: 2,
  byteRate: 64_000,
  channels: 1,
  sampleRate: 32_000,
};

function speechWav(durationMs = 360, wavFormat = format) {
  const frames = Math.round((wavFormat.sampleRate * durationMs) / 1_000);
  return buildPcmWav(wavFormat, new Uint8Array(frames * wavFormat.blockAlign));
}

test("相同 preset 与 seed 的背景音乐字节完全一致", () => {
  const speech = speechWav();
  assert.deepEqual(
    synthesizeBackgroundBed(speech, "ambient", "stable-bed").audioBytes,
    synthesizeBackgroundBed(speech, "ambient", "stable-bed").audioBytes,
  );
});

test("背景音乐严格匹配语音时长与 PCM 格式", () => {
  const speech = speechWav(470);
  const expected = parsePcmWav(speech);
  for (const bed of ["ambient", "pulse", "mysterious"] as const) {
    const generated = synthesizeBackgroundBed(speech, bed, `${bed}-seed`);
    const parsed = parsePcmWav(generated.audioBytes);
    assert.deepEqual(parsed.format, expected.format);
    assert.equal(parsed.data.length, expected.data.length);
    assert.equal(generated.durationMs, Math.round(expected.durationMs));
    const view = new DataView(parsed.data.buffer, parsed.data.byteOffset, parsed.data.byteLength);
    let peak = 0;
    for (let offset = 0; offset < parsed.data.length; offset += 2)
      peak = Math.max(peak, Math.abs(view.getInt16(offset, true)));
    assert.ok(peak >= 20_000, "背景应先标准化到稳定可听的 PCM 电平。");
  }
});

test("背景音乐拒绝与讲话节目不兼容的 PCM 格式", () => {
  const incompatible: WavPcmFormat = {
    ...format,
    byteRate: 32_000,
    sampleRate: 16_000,
  };
  assert.throws(
    () => synthesizeBackgroundBed(speechWav(100, incompatible), "ambient", "invalid"),
    /32000 Hz/,
  );
});

test("machine-1 默认使用神秘背景，其余正常播报使用氛围背景", () => {
  assert.equal(
    getDefaultBackgroundBed({ alienDialect: "machine-1", mode: "alien" }),
    "mysterious",
  );
  assert.equal(
    getDefaultBackgroundBed({ alienDialect: null, mode: "normal" }),
    "ambient",
  );
});

test("脉冲背景保留最高的混音电平，避免节拍被人声完全掩盖", () => {
  assert.ok(getBackgroundBedGain("pulse") > getBackgroundBedGain("ambient"));
  assert.ok(getBackgroundBedGain("pulse") > getBackgroundBedGain("mysterious"));
});
