import assert from "node:assert/strict";
import test from "node:test";
import {
  requestSiliconFlowSpeech,
  type SiliconFlowRequest,
} from "./siliconflow-transport.ts";
import { TtsError } from "./validation.ts";

const request: SiliconFlowRequest = {
  apiKey: "test-key",
  baseUrl: "https://api.siliconflow.cn/v1",
  model: "FunAudioLLM/CosyVoice2-0.5B",
  responseFormat: "mp3",
  sampleRate: 32_000,
  text: "这是测试稿件。",
  voice: "FunAudioLLM/CosyVoice2-0.5B:alex",
};

test("供应商错误不会被伪装成音频成功", async () => {
  await assert.rejects(
    requestSiliconFlowSpeech(request, async () => new Response("", { status: 503 })),
    (error: unknown) => error instanceof TtsError && error.kind === "provider",
  );
});

test("超时会返回可诊断错误", async () => {
  await assert.rejects(
    requestSiliconFlowSpeech(request, async () => {
      const error = new Error("aborted");
      error.name = "AbortError";
      throw error;
    }),
    (error: unknown) => error instanceof TtsError && error.kind === "timeout",
  );
});

test("非法音频响应会被拒绝", async () => {
  await assert.rejects(
    requestSiliconFlowSpeech(
      request,
      async () =>
        new Response("not an mp3", {
          headers: { "Content-Type": "audio/mpeg" },
        }),
    ),
    (error: unknown) => error instanceof TtsError && error.kind === "audio",
  );
});

test("自然语言 instruction 和 speed 会转换为 SiliconFlow 请求字段", async () => {
  let requestBody: Record<string, unknown> | null = null;
  await requestSiliconFlowSpeech(
    {
      ...request,
      instruction: "请用利落的电台主播语气播报。",
      responseFormat: "wav",
      speed: 1.15,
    },
    async (_url, init) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(new Uint8Array([1]), {
        headers: { "Content-Type": "audio/wav" },
      });
    },
  );
  assert.deepEqual(requestBody, {
    model: request.model,
    input: "请用利落的电台主播语气播报。<|endofprompt|>这是测试稿件。",
    voice: request.voice,
    response_format: "wav",
    sample_rate: request.sampleRate,
    stream: false,
    speed: 1.15,
    gain: 0,
  });
});

test("超出范围的 speed 会在请求前被拒绝", async () => {
  let fetchCalled = false;
  await assert.rejects(
    requestSiliconFlowSpeech(
      { ...request, speed: 4.01 },
      async () => {
        fetchCalled = true;
        return new Response();
      },
    ),
    (error: unknown) => error instanceof TtsError && error.kind === "input",
  );
  assert.equal(fetchCalled, false);
});
