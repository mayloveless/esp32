import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPcmWav,
  mergeWavSegments,
  parsePcmWav,
  speakerPauseMs,
  type WavPcmFormat,
} from "./wav.ts";

const format: WavPcmFormat = {
  bitsPerSample: 16,
  blockAlign: 2,
  byteRate: 64_000,
  channels: 1,
  sampleRate: 32_000,
};

function wav(durationMs: number, wavFormat = format) {
  const frames = Math.round((wavFormat.sampleRate * durationMs) / 1_000);
  return buildPcmWav(wavFormat, new Uint8Array(frames * wavFormat.blockAlign));
}

test("可解析并重建合法 PCM WAV", () => {
  const audio = wav(100);
  const parsed = parsePcmWav(audio);
  assert.equal(parsed.format.sampleRate, 32_000);
  assert.equal(Math.round(parsed.durationMs), 100);
  assert.equal(parsePcmWav(buildPcmWav(parsed.format, parsed.data)).data.length, 6_400);
});

test("接受最后一个 data chunk 的开放长度，并重建准确 header", () => {
  const streamed = wav(100);
  new DataView(streamed.buffer).setUint32(40, 0xffffffff, true);
  const parsed = parsePcmWav(streamed);
  const rebuilt = buildPcmWav(parsed.format, parsed.data);
  assert.equal(parsed.data.length, 6_400);
  assert.equal(new DataView(rebuilt.buffer).getUint32(40, true), 6_400);
});

test("合并 WAV 时会在不同说话者间插入静音并累计字幕时间", () => {
  const result = mergeWavSegments([
    { audioBytes: wav(100), speaker: "甲", text: "第一句" },
    { audioBytes: wav(200), speaker: "乙", text: "第二句" },
  ]);
  assert.equal(result.durationMs, 100 + speakerPauseMs + 200);
  assert.deepEqual(result.captions, [
    { endMs: 100, speaker: "甲", startMs: 0, text: "第一句" },
    {
      endMs: 100 + speakerPauseMs + 200,
      speaker: "乙",
      startMs: 100 + speakerPauseMs,
      text: "第二句",
    },
  ]);
  assert.equal(Math.round(parsePcmWav(result.audioBytes).durationMs), result.durationMs);
});

test("拒绝 PCM 参数不一致的 WAV 片段", () => {
  const incompatible: WavPcmFormat = {
    ...format,
    byteRate: 32_000,
    sampleRate: 16_000,
  };
  assert.throws(
    () =>
      mergeWavSegments([
        { audioBytes: wav(100), speaker: "甲", text: "第一句" },
        { audioBytes: wav(100, incompatible), speaker: "乙", text: "第二句" },
      ]),
    /采样率|PCM 参数/,
  );
});
