import assert from "node:assert/strict";
import test from "node:test";
import { buildPcmWav, type WavPcmFormat } from "../renderer/wav.ts";
import { parseManualMusicUpload } from "./music-upload.ts";

const fixtureFormat: WavPcmFormat = {
  bitsPerSample: 16,
  blockAlign: 2,
  byteRate: 64_000,
  channels: 1,
  sampleRate: 32_000,
};

function fixtureWav(durationMs = 250) {
  const frames = Math.round((fixtureFormat.sampleRate * durationMs) / 1_000);
  const bytes = new Uint8Array(frames * fixtureFormat.blockAlign);
  const view = new DataView(bytes.buffer);
  for (let frame = 0; frame < frames; frame += 1) {
    const sample = Math.round(
      Math.sin((2 * Math.PI * 440 * frame) / fixtureFormat.sampleRate) * 8_000,
    );
    view.setInt16(frame * fixtureFormat.blockAlign, sample, true);
  }
  return buildPcmWav(fixtureFormat, bytes);
}

function fixtureMp3() {
  const frameLength = 576;
  const bytes = new Uint8Array(frameLength * 2);
  bytes.set([0xff, 0xfb, 0x98, 0x00], 0);
  bytes.set([0xff, 0xfb, 0x98, 0x00], frameLength);
  return bytes;
}

function musicForm(audio: File) {
  const formData = new FormData();
  formData.set("title", "无版权测试信号");
  formData.set("description", "程序生成的小型 WAV fixture");
  formData.set("style", "测试");
  formData.set("audio", audio);
  return formData;
}

test("音乐上传读取 PCM WAV 的真实时长及元数据", async () => {
  const audio = new File([fixtureWav()], "fixture.wav", { type: "audio/wav" });
  const parsed = await parseManualMusicUpload(musicForm(audio));
  assert.equal(parsed.contentType, "audio/wav");
  assert.equal(parsed.extension, "wav");
  assert.equal(parsed.durationMs, 250);
  assert.equal(parsed.title, "无版权测试信号");
  assert.equal(parsed.description, "程序生成的小型 WAV fixture");
});

test("音乐上传拒绝 MIME 不匹配和无效音频", async () => {
  const wav = fixtureWav();
  await assert.rejects(
    parseManualMusicUpload(
      musicForm(new File([wav], "fixture.mp3", { type: "audio/mpeg" })),
    ),
    /MIME 类型不匹配/,
  );
  await assert.rejects(
    parseManualMusicUpload(
      musicForm(
        new File([new Uint8Array(64).fill(1)], "fixture.wav", {
          type: "audio/wav",
        }),
      ),
    ),
    /MIME 类型不匹配/,
  );
});

test("音乐上传读取程序生成的 MP3 fixture 时长", async () => {
  const parsed = await parseManualMusicUpload(
    musicForm(
      new File([fixtureMp3()], "fixture.mp3", { type: "audio/mpeg" }),
    ),
  );
  assert.equal(parsed.contentType, "audio/mpeg");
  assert.equal(parsed.extension, "mp3");
  assert.equal(parsed.durationMs, 72);
});
