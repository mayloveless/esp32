import assert from "node:assert/strict";
import test from "node:test";
import { parseBroadcastScript, ScriptGenerationError } from "./script-validation.ts";

const input = {
  format: "news" as const,
  language: "中文",
};

function scriptPayload(overrides: Record<string, unknown> = {}) {
  return {
    title: "木卫二信号记录",
    format: "news",
    language: "中文",
    fictional: true,
    segments: [
      {
        speaker: "播音员",
        text: "在冰壳下方的观测站，研究员记录到一串重复的微弱脉冲。".repeat(5),
      },
      {
        speaker: "播音员",
        text: "这是一条明确虚构的宇宙广播，节目将继续追踪信号背后的故事。".repeat(5),
      },
    ],
    sources: [],
    ...overrides,
  };
}

test("非法结构化输出会被拒绝", () => {
  assert.throws(
    () => parseBroadcastScript(scriptPayload({ fictional: false }), input),
    (error: unknown) =>
      error instanceof ScriptGenerationError && error.kind === "output",
  );
});

test("过长的用户无关模型正文会被拒绝", () => {
  const longText = "内容。".repeat(1_000);
  assert.throws(
    () =>
      parseBroadcastScript(
        scriptPayload({
          segments: [
            { speaker: "播音员", text: longText },
            { speaker: "播音员", text: longText },
          ],
        }),
        input,
      ),
    (error: unknown) =>
      error instanceof ScriptGenerationError && error.kind === "output",
  );
});
