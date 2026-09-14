import assert from "node:assert/strict";
import test from "node:test";
import type { InventorySummary } from "./classify.ts";
import {
  maximumInventoryPreheatSteps,
  preheatReceiverInventory,
} from "./preheat-core.ts";
import type { EnsureInventoryResult } from "./orchestrator-core.ts";

function inventory(count = 0): InventorySummary {
  return {
    alien: { count, programIds: [] },
    chat: { count, programIds: [] },
    music: { count, programIds: [] },
    news: { count, programIds: [] },
  };
}

test("预热严格串行，并在单步 replenish 报告健康后停止", async () => {
  const results: EnsureInventoryResult[] = [
    { inventory: inventory(1), kind: "news", programId: "news-1", result: "replenished" },
    { inventory: inventory(2), kind: "chat", programId: "chat-1", result: "replenished" },
    { inventory: inventory(3), result: "healthy" },
  ];
  let active = 0;
  let maximumActive = 0;
  let calls = 0;

  const result = await preheatReceiverInventory(async () => {
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    const next = results[calls++];
    await Promise.resolve();
    active -= 1;
    return next;
  });

  assert.equal(result.result, "healthy");
  assert.equal(result.steps, 3);
  assert.equal(calls, 3);
  assert.equal(maximumActive, 1);
});

test("最后一次补齐 target 时，预热直接根据返回库存结束", async () => {
  const result = await preheatReceiverInventory(async () => ({
    inventory: {
      alien: { count: 3, programIds: [] },
      chat: { count: 3, programIds: [] },
      music: { count: 5, programIds: [] },
      news: { count: 3, programIds: [] },
    },
    kind: "music",
    programId: "music-5",
    result: "replenished",
  }));

  assert.equal(result.result, "healthy");
  assert.equal(result.steps, 1);
});

test("预热在单步失败时停止，不继续产生后续请求", async () => {
  let calls = 0;
  const result = await preheatReceiverInventory(async () => {
    calls += 1;
    if (calls === 2) throw new Error("测试生产失败。");
    return { inventory: inventory(1), kind: "news", programId: "news-1", result: "replenished" };
  });

  assert.equal(result.result, "error");
  assert.equal(result.steps, 2);
  assert.equal(calls, 2);
});

test("预热最多执行配置的次数，默认上限为十四次", async () => {
  let calls = 0;
  const result = await preheatReceiverInventory(
    async () => {
      calls += 1;
      return {
        inventory: inventory(1),
        kind: "news",
        programId: `news-${calls}`,
        result: "replenished",
      };
    },
    { maximumSteps: 2 },
  );

  assert.equal(result.result, "maximum_reached");
  assert.equal(result.steps, 2);
  assert.equal(calls, 2);
  assert.equal(maximumInventoryPreheatSteps, 14);
});
