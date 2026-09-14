import assert from "node:assert/strict";
import test from "node:test";
import type { RadioProgram } from "../program/types.ts";
import {
  classifyInventory,
  getInventoryHealth,
  inventoryMinimums,
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
    program("news-2"),
    program("chat-1", { format: "chat" }),
    program("chat-2", { format: "chat" }),
    program("chat-3", { format: "chat" }),
    program("alien-1", { recipe: { render_mode: "alien" } }),
    program("alien-2", { recipe: { render_mode: "alien" } }),
    program("alien-3", { recipe: { render_mode: "alien" } }),
    program("music-1", { format: "music" }),
    program("music-2", { format: "music" }),
    program("music-3", { format: "music" }),
    program("music-4", { format: "music" }),
    program("music-5", { format: "music" }),
  ]);
  assert.equal(pickInventoryDeficit(inventory), "news");

  const allReady = classifyInventory([
    ...Array.from({ length: 3 }, (_, index) => program(`news-${index}`)),
    ...Array.from({ length: 3 }, (_, index) =>
      program(`chat-${index}`, { format: "chat" }),
    ),
    ...Array.from({ length: 3 }, (_, index) =>
      program(`alien-${index}`, { recipe: { render_mode: "alien" } }),
    ),
    ...Array.from({ length: 5 }, (_, index) =>
      program(`music-${index}`, { format: "music" }),
    ),
  ]);
  assert.equal(pickInventoryDeficit(allReady), null);

  assert.deepEqual(inventoryTargets, { alien: 3, chat: 3, music: 5, news: 3 });
});

test("库存健康度分别反映最低库存、补充中和满库存", () => {
  const low = classifyInventory([
    program("news"),
    program("chat", { format: "chat" }),
    program("alien", { recipe: { render_mode: "alien" } }),
    program("music", { format: "music" }),
  ]);
  assert.equal(getInventoryHealth(low), "low");

  const refilling = classifyInventory([
    ...Array.from({ length: 2 }, (_, index) => program(`news-${index}`)),
    ...Array.from({ length: 2 }, (_, index) =>
      program(`chat-${index}`, { format: "chat" }),
    ),
    ...Array.from({ length: 2 }, (_, index) =>
      program(`alien-${index}`, { recipe: { render_mode: "alien" } }),
    ),
    ...Array.from({ length: 3 }, (_, index) =>
      program(`music-${index}`, { format: "music" }),
    ),
  ]);
  assert.equal(getInventoryHealth(refilling), "refilling");
  assert.deepEqual(inventoryMinimums, { alien: 2, chat: 2, music: 3, news: 2 });

  const healthy = classifyInventory([
    ...Array.from({ length: 3 }, (_, index) => program(`news-ready-${index}`)),
    ...Array.from({ length: 3 }, (_, index) =>
      program(`chat-ready-${index}`, { format: "chat" }),
    ),
    ...Array.from({ length: 3 }, (_, index) =>
      program(`alien-ready-${index}`, { recipe: { render_mode: "alien" } }),
    ),
    ...Array.from({ length: 5 }, (_, index) =>
      program(`music-ready-${index}`, { format: "music" }),
    ),
  ]);
  assert.equal(getInventoryHealth(healthy), "healthy");
});
