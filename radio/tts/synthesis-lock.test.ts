import assert from "node:assert/strict";
import test from "node:test";
import {
  SynthesisInProgressError,
  withSynthesisLock,
} from "./synthesis-lock.ts";

test("重复点击只允许一个语音合成请求", async () => {
  let release: (() => void) | undefined;
  const first = withSynthesisLock(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  await assert.rejects(
    withSynthesisLock(async () => undefined),
    SynthesisInProgressError,
  );
  release?.();
  await first;
});
