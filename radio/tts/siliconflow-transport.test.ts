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
