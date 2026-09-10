import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateStartOffsetMs,
  findManifestCandidate,
  parseTuneRequest,
} from "./manifest.ts";
import type { RadioProgram } from "../program/types.ts";

test("极短节目从开头播放", () => {
  assert.equal(calculateStartOffsetMs(20_000), 0);
  assert.equal(calculateStartOffsetMs(1), 0);
});

test("普通节目从合理的中间位置切入", () => {
  const offset = calculateStartOffsetMs(60_000, () => 0.5);
  assert.ok(offset >= 4_000);
  assert.ok(offset <= 15_000);
  assert.ok(60_000 - offset >= 15_000);
});

test("接近边界的节目不会只剩几秒", () => {
  const offset = calculateStartOffsetMs(21_000, () => 1);
  assert.ok(offset < 21_000);
  assert.ok(21_000 - offset >= 15_000);
});

test("调台排除列表限制长度与格式", () => {
  assert.deepEqual(parseTuneRequest({}), { excludeProgramIds: [] });
  assert.throws(
    () => parseTuneRequest({ excludeProgramIds: ["invalid"] }),
    /无效节目 ID/,
  );
});

test("调台会跳过无法生成完整 manifest 的无效时长节目", () => {
  const candidates = [
    { id: "missing-duration", duration_ms: null },
    { id: "zero-duration", duration_ms: 0 },
    { id: "valid-duration", duration_ms: 60_000 },
  ] as RadioProgram[];

  assert.equal(
    findManifestCandidate(candidates, []).id,
    "valid-duration",
  );
});
