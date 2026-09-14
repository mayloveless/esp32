import assert from "node:assert/strict";
import test from "node:test";
import { buildPcmWav, wavSampleRate } from "../renderer/wav.ts";
import { renderProgramAudio } from "../renderer/render.ts";
import type { RadioProgram } from "../program/types.ts";
import type { InventoryProducerDependencies } from "./producer-core.ts";
import { produceInventoryProgramCore } from "./producer-core.ts";
import { createInventoryProductionPlan } from "./plan.ts";

const textSettings = {
  apiKey: "test-key",
  baseUrl: "https://api.deepseek.com",
  enabled: true,
  model: "deepseek-v4-flash",
};

const ttsSettings = {
  apiKey: "test-key",
  baseUrl: "https://api.siliconflow.cn/v1",
  enabled: true,
  model: "FunAudioLLM/CosyVoice2-0.5B",
  primaryVoice: "FunAudioLLM/CosyVoice2-0.5B:alex",
  provider: "siliconflow",
  secondaryVoice: "FunAudioLLM/CosyVoice2-0.5B:anna",
};

function fixtureWav() {
  return buildPcmWav(
    {
      bitsPerSample: 16,
      blockAlign: 2,
      byteRate: wavSampleRate * 2,
      channels: 1,
      sampleRate: wavSampleRate,
    },
    new Uint8Array(wavSampleRate / 5),
  );
}

function createProgram(format: RadioProgram["format"]): RadioProgram {
  return {
    audio_path: null,
    captions: [],
    content: {},
    created_at: "2026-09-14T00:00:00.000Z",
    duration_ms: null,
    error: null,
    format,
    id: "00000000-0000-4000-8000-000000000001",
    recipe: {},
    retired_at: null,
    status: "generating",
    title: "正在生成稿件",
    updated_at: "2026-09-14T00:00:00.000Z",
  };
}

function createDependencies(options: { failSpeech?: boolean } = {}) {
  let program = createProgram("news");
  const speechRequests: Array<{ responseFormat: string; text: string; voice: string }> = [];
  const savedMetadata: Array<Record<string, unknown>> = [];
  let savedMusicOptions: { inventorySource?: "auto" } | null = null;

  const dependencies: InventoryProducerDependencies = {
    assertDeepSeekReady: () => "test-key",
    assertTtsReady: () => "test-key",
    createGeneratingProgram: async (input) => {
      program = {
        ...createProgram(input.format),
        recipe: {
          format: input.format,
          language: input.language,
          style: input.style,
          text_model: input.model,
        },
      };
      return program;
    },
    createProceduralMusicProgram: async (_recipe, _asset, musicOptions) => {
      savedMusicOptions = musicOptions;
      program = {
        ...createProgram("music"),
        audio_path: "music/fixture.wav",
        duration_ms: 200,
        recipe: { audio_source: "procedural", inventory_source: musicOptions.inventorySource },
        status: "ready",
      };
      return { cleanupWarning: null, program };
    },
    createProceduralMusicRecipe: (_style, seed) => ({
      barCount: 1,
      bpm: 120,
      durationMs: 2_000,
      generator: "procedural-synth-v1",
      rootMidi: 48,
      scale: [0, 3, 7],
      seed,
      style: "orbital_ambient",
    }),
    createSeed: () => "test-seed",
    generateBroadcastScript: async (input) => ({
      model: textSettings.model,
      script: {
        fictional: true,
        format: input.format,
        language: input.language,
        segments:
          input.format === "chat"
            ? [
                { speaker: "主持人", text: "来自测试站的第一条信号。" },
                { speaker: "嘉宾", text: "第二位说话者已经收到。" },
              ]
            : [{ speaker: "播音员", text: "来自测试站的新闻信号。" }],
        sources: [],
        title: "自动测试节目",
      },
    }),
    getDeepSeekSettings: () => textSettings,
    getTtsSettings: () => ttsSettings,
    renderProgramAudio: async (renderedProgram, voices, synthesize, renderOptions) =>
      renderProgramAudio(renderedProgram, voices, synthesize, renderOptions),
    runGeneration: async (operation) => operation(),
    runSynthesis: async (operation) => operation(),
    saveSynthesizedProgramAudio: async (_id, asset, metadata) => {
      savedMetadata.push(metadata as unknown as Record<string, unknown>);
      program = {
        ...program,
        audio_path: "speech/fixture.wav",
        captions: metadata.captions,
        duration_ms: asset.durationMs,
        status: "ready",
      };
      return { cleanupWarning: null, program };
    },
    synthesizeProceduralMusic: () => ({
      audioBytes: fixtureWav(),
      durationMs: 100,
      sampleRate: wavSampleRate,
    }),
    synthesizeSpeech: async (request) => {
      speechRequests.push({
        responseFormat: request.responseFormat,
        text: request.text,
        voice: request.voice,
      });
      if (options.failSpeech) throw new Error("测试语音供应商失败。");
      return { audioBytes: fixtureWav(), traceId: "test-trace" };
    },
    updateProgram: async (_id, input) => {
      program = {
        ...program,
        ...input,
        content: input.content ?? program.content,
        recipe: input.recipe ?? program.recipe,
      };
      return program;
    },
  };
  return {
    dependencies,
    getProgram: () => program,
    savedMetadata,
    savedMusicOptions: () => savedMusicOptions,
    speechRequests,
  };
}

test("同一随机输入会得到完全相同的 alien 生产计划", () => {
  assert.deepEqual(
    createInventoryProductionPlan("alien", () => 0.51),
    createInventoryProductionPlan("alien", () => 0.51),
  );
});

test("自动 news 使用正式 Renderer 的 WAV 路径并保存自动来源", async () => {
  const fixture = createDependencies();
  const result = await produceInventoryProgramCore(
    createInventoryProductionPlan("news", () => 0),
    fixture.dependencies,
  );
  assert.equal(result.program.status, "ready");
  assert.equal(fixture.getProgram().recipe.inventory_source, "auto");
  assert.deepEqual(fixture.speechRequests.map((request) => request.responseFormat), ["wav"]);
  assert.equal(fixture.savedMetadata[0].responseFormat, "wav");
  assert.equal(fixture.savedMetadata[0].renderMode, "normal");
});

test("自动 chat 经 Renderer 使用稳定的双说话者音色", async () => {
  const fixture = createDependencies();
  await produceInventoryProgramCore(
    createInventoryProductionPlan("chat", () => 0),
    fixture.dependencies,
  );
  assert.deepEqual(
    fixture.speechRequests.map((request) => request.voice),
    [ttsSettings.primaryVoice, ttsSettings.secondaryVoice],
  );
  assert.deepEqual(fixture.savedMetadata[0].speakerVoices, {
    主持人: ttsSettings.primaryVoice,
    嘉宾: ttsSettings.secondaryVoice,
  });
});

test("自动 alien 保存 alien 模式和确定方言", async () => {
  const fixture = createDependencies();
  await produceInventoryProgramCore(
    createInventoryProductionPlan("alien", () => 0.51),
    fixture.dependencies,
  );
  assert.equal(fixture.savedMetadata[0].renderMode, "alien");
  assert.equal(fixture.savedMetadata[0].alienDialect, "continental-1");
  assert.notEqual(fixture.speechRequests[0].text, "来自测试站的第一条信号。");
});

test("自动 music 只走程序化音乐保存，不调用文本或语音", async () => {
  const fixture = createDependencies();
  fixture.dependencies.generateBroadcastScript = async () => {
    throw new Error("music 不应调用文本生成。");
  };
  fixture.dependencies.synthesizeSpeech = async () => {
    throw new Error("music 不应调用语音合成。");
  };
  const result = await produceInventoryProgramCore(
    createInventoryProductionPlan("music", () => 0),
    fixture.dependencies,
  );
  assert.equal(result.program.status, "ready");
  assert.deepEqual(fixture.savedMusicOptions(), { inventorySource: "auto" });
  assert.deepEqual(fixture.speechRequests, []);
});

test("语音生产失败会留下 failed 节目，且不会伪造 ready 音频", async () => {
  const fixture = createDependencies({ failSpeech: true });
  await assert.rejects(
    produceInventoryProgramCore(
      createInventoryProductionPlan("news", () => 0),
      fixture.dependencies,
    ),
    /测试语音供应商失败/,
  );
  assert.equal(fixture.getProgram().status, "failed");
  assert.equal(fixture.getProgram().audio_path, null);
  assert.deepEqual(fixture.savedMetadata, []);
});
