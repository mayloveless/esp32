import assert from "node:assert/strict";
import test from "node:test";
import { assertTtsReady, type TtsSettings } from "./config.ts";
import { TtsError } from "./validation.ts";

const settings: TtsSettings = {
  apiKey: "test-key",
  baseUrl: "https://api.siliconflow.cn/v1",
  enabled: true,
  model: "FunAudioLLM/CosyVoice2-0.5B",
  provider: "siliconflow",
  voice: "FunAudioLLM/CosyVoice2-0.5B:alex",
};

test("缺少 TTS 密钥时停止在供应商请求之前", () => {
  assert.throws(
    () => assertTtsReady({ ...settings, apiKey: null }),
    (error: unknown) =>
      error instanceof TtsError && error.kind === "configuration",
  );
});

test("只接受硅基流动的内置 CosyVoice2 音色", () => {
  assert.throws(
    () => assertTtsReady({ ...settings, voice: "unknown" }),
    (error: unknown) =>
      error instanceof TtsError && error.kind === "configuration",
  );
});
