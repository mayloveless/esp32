import assert from "node:assert/strict";
import test from "node:test";
import { buildPcmWav, type WavPcmFormat } from "./wav.ts";
import {
  createRenderPlan,
  renderProgramAudio,
} from "./render.ts";

const voices = {
  primaryVoice: "FunAudioLLM/CosyVoice2-0.5B:alex",
  secondaryVoice: "FunAudioLLM/CosyVoice2-0.5B:anna",
};
const format: WavPcmFormat = {
  bitsPerSample: 16,
  blockAlign: 2,
  byteRate: 64_000,
  channels: 1,
  sampleRate: 32_000,
};
const chatProgram = {
  content: {
    segments: [
      { speaker: "观测员", text: "第一段。" },
      { speaker: "观测员", text: "第二段。" },
      { speaker: "导航员", text: "第三段。" },
    ],
  },
  format: "chat" as const,
};

function wav(durationMs = 100) {
  return buildPcmWav(
    format,
    new Uint8Array(Math.round((32_000 * durationMs) / 1_000) * format.blockAlign),
  );
}

test("speaker 映射稳定，且相邻同 speaker 会合并", () => {
  const plan = createRenderPlan(chatProgram, voices);
  assert.deepEqual(plan.speakerVoices, {
    观测员: voices.primaryVoice,
    导航员: voices.secondaryVoice,
  });
  assert.deepEqual(plan.units, [
    {
      speaker: "观测员",
      text: "第一段。\n第二段。",
      voice: voices.primaryVoice,
    },
    {
      speaker: "导航员",
      text: "第三段。",
      voice: voices.secondaryVoice,
    },
  ]);
});

test("聊天节目会对合并后的单元真实请求两种音色", async () => {
  const requests: Array<{
    responseFormat: string;
    sampleRate: number;
    text: string;
    voice: string;
  }> = [];
  const result = await renderProgramAudio(chatProgram, voices, async (request) => {
    requests.push(request);
    return { audioBytes: wav(), traceId: `trace-${requests.length}` };
  });
  assert.deepEqual(requests, [
    {
      responseFormat: "wav",
      sampleRate: 32_000,
      text: "第一段。\n第二段。",
      voice: voices.primaryVoice,
    },
    {
      responseFormat: "wav",
      sampleRate: 32_000,
      text: "第三段。",
      voice: voices.secondaryVoice,
    },
  ]);
  assert.equal(result.captions.length, 2);
  assert.equal(result.traceIds.length, 2);
});

test("中途 TTS 失败时不会产出可保存的半成品", async () => {
  let saveCalled = false;
  let calls = 0;
  await assert.rejects(async () => {
    const rendered = await renderProgramAudio(chatProgram, voices, async () => {
      calls += 1;
      if (calls === 2) throw new Error("第二段合成失败。");
      return { audioBytes: wav(), traceId: "trace-1" };
    });
    saveCalled = Boolean(rendered.audioBytes.length);
  }, /第二段合成失败/);
  assert.equal(calls, 2);
  assert.equal(saveCalled, false);
});
