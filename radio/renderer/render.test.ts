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

function signalWav(durationMs = 100) {
  const frames = Math.round((format.sampleRate * durationMs) / 1_000);
  const data = new Uint8Array(frames * format.blockAlign);
  const view = new DataView(data.buffer);
  for (let frame = 0; frame < frames; frame += 1) {
    view.setInt16(
      frame * format.blockAlign,
      Math.round(Math.sin((2 * Math.PI * 440 * frame) / format.sampleRate) * 24_000),
      true,
    );
  }
  return buildPcmWav(format, data);
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
      spokenText: "第一段。\n第二段。",
      text: "第一段。\n第二段。",
      voice: voices.primaryVoice,
    },
    {
      speaker: "导航员",
      spokenText: "第三段。",
      text: "第三段。",
      voice: voices.secondaryVoice,
    },
  ]);
});

test("normal 与 alien Render Plan 分别保留原文和生成确定性播报文本", () => {
  const normal = createRenderPlan(chatProgram, voices, { mode: "normal" });
  const alien = createRenderPlan(chatProgram, voices, { mode: "alien" });

  assert.equal(normal.mode, "normal");
  assert.equal(normal.delivery.id, "lively");
  assert.equal(normal.alienDialect, null);
  assert.equal(normal.units[0].spokenText, "第一段。\n第二段。");
  assert.equal(alien.mode, "alien");
  assert.equal(alien.alienDialect, "cosmic-1");
  assert.notEqual(alien.units[0].spokenText, normal.units[0].text);
  assert.match(alien.units[0].spokenText, /^[a-z ,.?!;:]+$/);
  assert.equal(alien.units[0].text, normal.units[0].text);
});

test("手动 delivery profile 会覆盖按节目形式选择的默认值", () => {
  const plan = createRenderPlan(chatProgram, voices, {
    deliveryProfile: "urgent",
  });
  assert.equal(plan.delivery.id, "urgent");
  assert.equal(plan.delivery.speed, 1.3);
});

test("聊天节目会对合并后的单元真实请求两种音色", async () => {
  const requests: Array<{
    instruction?: string;
    responseFormat: string;
    sampleRate: number;
    speed?: number;
    text: string;
    voice: string;
  }> = [];
  const result = await renderProgramAudio(chatProgram, voices, async (request) => {
    requests.push(request);
    return { audioBytes: wav(), traceId: `trace-${requests.length}` };
  });
  assert.deepEqual(requests, [
    {
      instruction:
        "请以自然的电台对话方式表达，反应明确，轻松，有情绪起伏，避免主持稿朗读腔。",
      responseFormat: "wav",
      sampleRate: 32_000,
      speed: 1.25,
      text: "第一段。\n第二段。",
      voice: voices.primaryVoice,
    },
    {
      instruction:
        "请以自然的电台对话方式表达，反应明确，轻松，有情绪起伏，避免主持稿朗读腔。",
      responseFormat: "wav",
      sampleRate: 32_000,
      speed: 1.25,
      text: "第三段。",
      voice: voices.secondaryVoice,
    },
  ]);
  assert.equal(result.captions.length, 2);
  assert.equal(result.traceIds.length, 2);
});

test("alien TTS 接收 spokenText，但 caption 保存中文原文", async () => {
  const requests: Array<{ instruction?: string; speed?: number; text: string }> = [];
  const result = await renderProgramAudio(
    chatProgram,
    voices,
    async (request) => {
      requests.push(request);
      return { audioBytes: wav(), traceId: null };
    },
    { mode: "alien" },
  );

  assert.notEqual(requests[0].text, "第一段。\n第二段。");
  assert.match(requests[0].text, /^[a-z ,.?!;:]+$/);
  assert.equal(result.captions[0].text, "第一段。\n第二段。");
  assert.equal(result.mode, "alien");
  assert.equal(result.alienDialect, "cosmic-1");
});

test("仅 machine-1 会处理最终 WAV，且不改变字幕或时长", async () => {
  const synthesize = async () => ({ audioBytes: signalWav(), traceId: null });
  const cosmic = await renderProgramAudio(chatProgram, voices, synthesize, {
    alienDialect: "cosmic-1",
    mode: "alien",
  });
  const continental = await renderProgramAudio(chatProgram, voices, synthesize, {
    alienDialect: "continental-1",
    mode: "alien",
  });
  const machine = await renderProgramAudio(chatProgram, voices, synthesize, {
    alienDialect: "machine-1",
    mode: "alien",
  });

  assert.equal(cosmic.audioEffect, null);
  assert.equal(continental.audioEffect, null);
  assert.equal(machine.audioEffect, "machine-radio-v4");
  assert.equal(machine.durationMs, cosmic.durationMs);
  assert.deepEqual(machine.captions, cosmic.captions);
  assert.notDeepEqual(machine.audioBytes, cosmic.audioBytes);
});

test("none 背景保留合并后的语音，而背景混音不改变字幕", async () => {
  const result = await renderProgramAudio(chatProgram, voices, async () => ({
    audioBytes: signalWav(),
    traceId: null,
  }), {
    backgroundBed: "none",
  });
  assert.equal(result.backgroundBed, "none");
  assert.equal(result.backgroundBedGain, 0);
  assert.equal(result.backgroundBedGenerator, null);
  assert.deepEqual(result.captions, [
    { endMs: 100, speaker: "观测员", startMs: 0, text: "第一段。\n第二段。" },
    { endMs: 380, speaker: "导航员", startMs: 280, text: "第三段。" },
  ]);
  assert.equal(result.durationMs, 380);
});

test("machine-1 在混入神秘背景前先完成语音后处理，结果稳定且字幕不变", async () => {
  const synthesize = async () => ({ audioBytes: signalWav(), traceId: null });
  const options = {
    alienDialect: "machine-1" as const,
    backgroundBed: "mysterious" as const,
    backgroundBedSeed: "machine-background-seed",
    mode: "alien" as const,
  };
  const first = await renderProgramAudio(chatProgram, voices, synthesize, options);
  const second = await renderProgramAudio(chatProgram, voices, synthesize, options);
  assert.equal(first.audioEffect, "machine-radio-v4");
  assert.equal(first.backgroundBed, "mysterious");
  assert.equal(first.backgroundBedGenerator, "procedural-bed-v1");
  assert.equal(first.backgroundBedSeed, "machine-background-seed");
  assert.deepEqual(first.audioBytes, second.audioBytes);
  assert.deepEqual(first.captions, second.captions);
});

test("背景生成失败时不会产出可保存的新音频", async () => {
  let saveCalled = false;
  await assert.rejects(async () => {
    const rendered = await renderProgramAudio(
      chatProgram,
      voices,
      async () => ({ audioBytes: signalWav(), traceId: null }),
      { backgroundBed: "ambient", backgroundBedSeed: " " },
    );
    saveCalled = rendered.audioBytes.length > 0;
  }, /seed 不能为空/);
  assert.equal(saveCalled, false);
});

test("delivery 不会修改 normal 原文或 alien 的确定性 spokenText", async () => {
  const normalRequests: Array<{ text: string }> = [];
  const alienRequests: Array<{ text: string }> = [];
  await renderProgramAudio(chatProgram, voices, async (request) => {
    normalRequests.push(request);
    return { audioBytes: wav(), traceId: null };
  });
  await renderProgramAudio(
    chatProgram,
    voices,
    async (request) => {
      alienRequests.push(request);
      return { audioBytes: wav(), traceId: null };
    },
    { deliveryProfile: "mysterious", mode: "alien" },
  );

  assert.equal(normalRequests[0].text, "第一段。\n第二段。");
  assert.match(alienRequests[0].text, /^[a-z ,.?!;:]+$/);
  assert.notEqual(alienRequests[0].text, normalRequests[0].text);
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
