import assert from "node:assert/strict";
import test from "node:test";
import {
  persistReadyMusicProgram,
  type ReadyMusicPersistence,
} from "./ready-music.ts";
import type { RadioProgram } from "./types.ts";

const input = {
  audioBytes: new Uint8Array([1, 2, 3]),
  contentType: "audio/wav" as const,
  durationMs: 1_000,
  extension: "wav" as const,
  recipe: { audio_source: "procedural" },
  title: "测试音乐",
};

function program(id: string): RadioProgram {
  return {
    ...input,
    audio_path: `${id}/asset.wav`,
    captions: [],
    content: {},
    created_at: "2026-01-01T00:00:00.000Z",
    error: null,
    format: "music",
    id,
    retired_at: null,
    status: "ready",
    updated_at: "2026-01-01T00:00:00.000Z",
  };
}

test("ready music 保存成功时写入新的唯一对象路径", async () => {
  const uploads: string[] = [];
  const persistence: ReadyMusicPersistence = {
    insert: async (record) => ({ data: program(record.id), error: null }),
    remove: async () => null,
    upload: async (path) => {
      uploads.push(path);
      return null;
    },
  };
  const result = await persistReadyMusicProgram(
    input,
    persistence,
    (() => {
      const ids = ["program-id", "audio-id"];
      return () => ids.shift() ?? "unexpected";
    })(),
  );
  assert.equal(result.program.status, "ready");
  assert.deepEqual(uploads, ["program-id/audio-id.wav"]);
});

test("Storage 成功而数据库失败时会清理新对象", async () => {
  const removed: string[] = [];
  const persistence: ReadyMusicPersistence = {
    insert: async () => ({ data: null, error: { message: "数据库故障" } }),
    remove: async (path) => {
      removed.push(path);
      return null;
    },
    upload: async () => null,
  };
  await assert.rejects(
    persistReadyMusicProgram(input, persistence, (() => {
      const ids = ["program-id", "audio-id"];
      return () => ids.shift() ?? "unexpected";
    })()),
    /数据库未保存音乐节目/,
  );
  assert.deepEqual(removed, ["program-id/audio-id.wav"]);
});
