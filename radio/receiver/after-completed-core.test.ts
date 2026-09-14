import assert from "node:assert/strict";
import test from "node:test";
import { replenishAfterReceiverCompletion } from "./after-completed-core.ts";

test("完成后的补货失败不会向调用方抛出", async () => {
  let warned: unknown = null;
  replenishAfterReceiverCompletion(
    true,
    async () => {
      throw new Error("补货失败。");
    },
    { warn: (error) => (warned = error) },
  );

  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(warned instanceof Error);
  assert.equal((warned as Error).message, "补货失败。");
});

test("进行中的补货错误可以静默，不影响 completed 响应路径", async () => {
  let warned = false;
  replenishAfterReceiverCompletion(
    true,
    async () => {
      throw new Error("正在补货。");
    },
    {
      isIgnoredError: () => true,
      warn: () => (warned = true),
    },
  );

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(warned, false);
});

test("重复 completed 未改变 retired 状态时不重复补货", () => {
  let calls = 0;
  replenishAfterReceiverCompletion(false, async () => {
    calls += 1;
  });
  assert.equal(calls, 0);
});
