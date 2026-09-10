import assert from "node:assert/strict";
import test from "node:test";
import { parseBroadcastScript, ScriptGenerationError } from "./script-validation.ts";

const input = {
  format: "news" as const,
  language: "中文",
};
const chatInput = {
  format: "chat" as const,
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

test("news 允许单段稿件", () => {
  const script = parseBroadcastScript(
    scriptPayload({
      segments: [
        {
          speaker: "播音员",
          text: "在冰壳下方的观测站，研究员记录到一串重复的微弱脉冲。".repeat(10),
        },
      ],
    }),
    input,
  );
  assert.equal(script.segments.length, 1);
});

test("chat 需要至少两个片段和两位不同说话者", () => {
  assert.throws(
    () =>
      parseBroadcastScript(
        scriptPayload({
          format: "chat",
          segments: [
            { speaker: "主持人", text: "这里是星港夜话，今晚我们讨论冰海信号。".repeat(5) },
          ],
        }),
        chatInput,
      ),
    /2 到 12 个片段/,
  );
  assert.throws(
    () =>
      parseBroadcastScript(
        scriptPayload({
          format: "chat",
          segments: [
            { speaker: "主持人", text: "这里是星港夜话，今晚我们讨论冰海信号。".repeat(5) },
            { speaker: "主持人", text: "现在请继续说明观测站为何要关闭外部天线。".repeat(5) },
          ],
        }),
        chatInput,
      ),
    /至少需要两位不同的 speaker/,
  );
});

test("chat 接受两位 speaker 推进的多段稿件", () => {
  const script = parseBroadcastScript(
    scriptPayload({
      format: "chat",
      segments: [
        { speaker: "主持人", text: "这里是星港夜话，今晚我们讨论冰海信号。".repeat(5) },
        { speaker: "观测员", text: "信号每隔七分钟出现一次，所以我们暂停了外部天线。".repeat(5) },
      ],
    }),
    chatInput,
  );
  assert.equal(script.segments.length, 2);
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
