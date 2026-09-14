import assert from "node:assert/strict";
import test from "node:test";
import {
  addExcludedProgramId,
  getRemainingTuningFeedbackMs,
  isAutoplayBlocked,
  isLatestTune,
  minimumTuningFeedbackMs,
  resolvePlaybackStartOffsetMs,
  startNoSignalInventoryEnsure,
} from "./runtime.ts";

test("切走的节目会进入有限的调台排除列表", () => {
  assert.deepEqual(addExcludedProgramId(["a", "b"], "a"), ["b", "a"]);

  const ids = Array.from({ length: 20 }, (_, index) => `program-${index}`);
  assert.deepEqual(addExcludedProgramId(ids, "program-20"), [
    ...ids.slice(1),
    "program-20",
  ]);
});

test("接收机只保留当前与最近切走的节目，避免耗尽小型库存", () => {
  assert.deepEqual(addExcludedProgramId(["a", "b"], "c", 2), ["b", "c"]);
});

test("自动播放限制会进入人工播放兜底", () => {
  assert.equal(isAutoplayBlocked({ name: "NotAllowedError" }), true);
  assert.equal(isAutoplayBlocked(new Error("其他播放错误")), false);
});

test("自动顺播从头开始，手动调台保留临场切入偏移", () => {
  assert.equal(resolvePlaybackStartOffsetMs(8_000, true), 0);
  assert.equal(resolvePlaybackStartOffsetMs(8_000, false), 8_000);
});

test("调台静电仅补足最短反馈，不额外拖慢慢请求", () => {
  assert.equal(getRemainingTuningFeedbackMs(0), minimumTuningFeedbackMs);
  assert.equal(getRemainingTuningFeedbackMs(120), 200);
  assert.equal(getRemainingTuningFeedbackMs(minimumTuningFeedbackMs), 0);
  assert.equal(getRemainingTuningFeedbackMs(1_000), 0);
});

test("旧调台结果不会覆盖最新请求", () => {
  assert.equal(isLatestTune(3, 3), true);
  assert.equal(isLatestTune(2, 3), false);
});

test("无信号时不等待库存补充", () => {
  let calls = 0;
  const result = startNoSignalInventoryEnsure(() => {
    calls += 1;
    return new Promise(() => undefined);
  });
  assert.equal(result, "no_signal");
  assert.equal(calls, 1);
});
