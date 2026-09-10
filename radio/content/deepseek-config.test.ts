import assert from "node:assert/strict";
import test from "node:test";
import { assertDeepSeekReady } from "./deepseek-config.ts";
import { ScriptGenerationError } from "./script-validation.ts";

test("缺少 DeepSeek 密钥时会在请求前停止", () => {
  assert.throws(
    () => assertDeepSeekReady({ enabled: true, apiKey: null }),
    (error: unknown) =>
      error instanceof ScriptGenerationError && error.kind === "configuration",
  );
});

test("未显式启用时不会调用 DeepSeek", () => {
  assert.throws(
    () => assertDeepSeekReady({ enabled: false, apiKey: "test-key" }),
    (error: unknown) =>
      error instanceof ScriptGenerationError && error.kind === "disabled",
  );
});
