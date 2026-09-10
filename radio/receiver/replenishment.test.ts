import assert from "node:assert/strict";
import test from "node:test";
import {
  getAutomaticProgramInput,
  ReplenishmentInProgressError,
  withReplenishmentLock,
} from "./replenishment.ts";

test("自动补充继承正在播放节目的有效语言、风格与节目形式", () => {
  assert.deepEqual(
    getAutomaticProgramInput("chat", {
      language: "中文",
      style: "克制、清晰",
    }),
    { format: "chat", language: "中文", style: "克制、清晰", topic: null },
  );
});

test("自动补充会忽略无效 recipe 并使用受控默认值", () => {
  assert.deepEqual(
    getAutomaticProgramInput("music", {
      language: "x".repeat(41),
      style: 123,
    }),
    {
      format: "news",
      language: "中文",
      style: "冷静、略带未知感",
      topic: null,
    },
  );
});

test("同一时刻只允许一个自动补充任务", async () => {
  let release: (() => void) | null = null;
  const first = withReplenishmentLock(
    () => new Promise<void>((resolve) => (release = resolve)),
  );
  await assert.rejects(
    withReplenishmentLock(async () => undefined),
    ReplenishmentInProgressError,
  );
  release?.();
  await first;
});
