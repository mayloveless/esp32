import assert from "node:assert/strict";
import test from "node:test";
import {
  GenerationInProgressError,
  withGenerationLock,
} from "./generation-lock.ts";

test("并发生成请求只允许一个进入", async () => {
  let release: (() => void) | undefined;
  const first = withGenerationLock(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  await assert.rejects(
    withGenerationLock(async () => undefined),
    GenerationInProgressError,
  );
  release?.();
  await first;
});
