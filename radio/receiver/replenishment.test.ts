import assert from "node:assert/strict";
import test from "node:test";
import {
  getAutomaticInventoryKind,
  ReplenishmentInProgressError,
  withReplenishmentLock,
} from "./replenishment.ts";

test("Checkpoint A 的旧补货入口只选择节目 kind，不再携带 legacy 输入", () => {
  assert.equal(getAutomaticInventoryKind("chat"), "chat");
  assert.equal(getAutomaticInventoryKind("news"), "news");
  assert.equal(getAutomaticInventoryKind("music"), "news");
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
