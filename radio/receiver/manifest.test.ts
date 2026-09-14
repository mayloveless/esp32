import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateStartOffsetMs,
  findManifestCandidate,
  getSignalKind,
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

test("music 与广播节目使用相同的调台候选和开始偏移规则", () => {
  const music = {
    id: "music-duration",
    duration_ms: 60_000,
    format: "music",
  } as RadioProgram;
  assert.equal(findManifestCandidate([music], []).id, music.id);
  const offset = calculateStartOffsetMs(music.duration_ms, () => 0.5);
  assert.ok(offset >= 4_000 && offset <= 15_000);
});

test("调台候选会在未排除节目中按可注入随机值打散", () => {
  const candidates = [
    { id: "first", duration_ms: 60_000 },
    { id: "second", duration_ms: 60_000 },
  ] as RadioProgram[];
  assert.equal(findManifestCandidate(candidates, [], () => 0.9).id, "second");
  assert.equal(findManifestCandidate(candidates, ["second"], () => 0.9).id, "first");
});

test("Receiver manifest 使用与库存一致的信号展示类型", () => {
  const base = {
    audio_path: "audio.wav",
    captions: [],
    content: {},
    created_at: "2026-09-14T00:00:00.000Z",
    duration_ms: 60_000,
    error: null,
    id: "program",
    retired_at: null,
    status: "ready" as const,
    title: "节目",
    updated_at: "2026-09-14T00:00:00.000Z",
  };

  assert.equal(getSignalKind({ ...base, format: "news", recipe: {} }), "news");
  assert.equal(getSignalKind({ ...base, format: "chat", recipe: {} }), "chat");
  assert.equal(
    getSignalKind({ ...base, format: "chat", recipe: { render_mode: "alien" } }),
    "alien",
  );
  assert.equal(
    getSignalKind({ ...base, format: "music", recipe: { render_mode: "alien" } }),
    "music",
  );
});
