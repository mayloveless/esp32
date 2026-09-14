import assert from "node:assert/strict";
import test from "node:test";
import type { RadioProgram } from "../program/types.ts";
import {
  classifyInventory,
  inventoryTargets,
  pickInventoryDeficit,
} from "./classify.ts";

function program(id: string, overrides: Partial<RadioProgram> = {}): RadioProgram {
  return {
    audio_path: `${id}/audio.wav`,
    captions: [],
    content: {},
    created_at: "2026-09-14T00:00:00.000Z",
    duration_ms: 60_000,
    error: null,
    format: "news",
    id,
    recipe: {},
    retired_at: null,
    status: "ready",
    title: id,
    updated_at: "2026-09-14T00:00:00.000Z",
    ...overrides,
  };
}

test("只按可播 active-ready 节目分类四种库存", () => {
  const inventory = classifyInventory([
    program("news"),
    program("chat", { format: "chat" }),
    program("alien", { recipe: { render_mode: "alien" } }),
    program("music", { format: "music", recipe: { render_mode: "alien" } }),
    program("retired", { retired_at: "2026-09-14T01:00:00.000Z" }),
    program("not-ready", { status: "failed" }),
    program("missing-audio", { audio_path: null }),
    program("invalid-duration", { duration_ms: 0 }),
  ]);

  assert.deepEqual(inventory.news.programIds, ["news"]);
  assert.deepEqual(inventory.chat.programIds, ["chat"]);
  assert.deepEqual(inventory.alien.programIds, ["alien"]);
  assert.deepEqual(inventory.music.programIds, ["music"]);
});

test("缺口按比例优先，并列按固定 kind 顺序选择", () => {
  const empty = classifyInventory([]);
  assert.equal(pickInventoryDeficit(empty), "news");

  const inventory = classifyInventory([
    program("news-1"),
    program("chat-1", { format: "chat" }),
    program("alien-1", { recipe: { render_mode: "alien" } }),
  ]);
  assert.equal(pickInventoryDeficit(inventory), "music");

  const allReady = classifyInventory([
    program("news-2"),
    program("chat-2", { format: "chat" }),
    program("alien-2", { recipe: { render_mode: "alien" } }),
    program("music-2", { format: "music" }),
  ]);
  assert.equal(pickInventoryDeficit(allReady), null);

  assert.deepEqual(inventoryTargets, { alien: 1, chat: 1, music: 1, news: 1 });
});
