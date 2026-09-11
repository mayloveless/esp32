import assert from "node:assert/strict";
import test from "node:test";
import { buildSynthesisRecipe } from "./synthesis-metadata.ts";

test("recipe 保存实际的 delivery profile 和 TTS speed", () => {
  const recipe = buildSynthesisRecipe(
    { format: "chat" },
    {
      alienDialect: null,
      audioEffect: null,
      audioContentType: "audio/wav",
      deliveryProfile: "lively",
      model: "FunAudioLLM/CosyVoice2-0.5B",
      provider: "siliconflow",
      renderMode: "normal",
      responseFormat: "wav",
      sampleRate: 32_000,
      speakerVoices: { 观测员: "alex", 导航员: "anna" },
      speed: 1.25,
      traceIds: ["trace-1"],
    },
  );

  assert.equal(recipe.delivery_profile, "lively");
  assert.equal(recipe.tts_speed, 1.25);
  assert.equal(recipe.format, "chat");
});

test("machine-1 会在 recipe 中记录方言和机械后处理", () => {
  const recipe = buildSynthesisRecipe(
    { format: "news" },
    {
      alienDialect: "machine-1",
      audioEffect: "machine-radio-v1",
      audioContentType: "audio/wav",
      deliveryProfile: "urgent",
      model: "FunAudioLLM/CosyVoice2-0.5B",
      provider: "siliconflow",
      renderMode: "alien",
      responseFormat: "wav",
      sampleRate: 32_000,
      speakerVoices: { 播音员: "alex" },
      speed: 1.3,
      traceIds: ["trace-2"],
    },
  );

  assert.equal(recipe.render_mode, "alien");
  assert.equal(recipe.alien_dialect, "machine-1");
  assert.equal(recipe.audio_effect, "machine-radio-v1");
});
