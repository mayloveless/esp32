import assert from "node:assert/strict";
import test from "node:test";
import {
  ReplenishmentInProgressError,
  withReplenishmentLock,
} from "./replenishment.ts";

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
