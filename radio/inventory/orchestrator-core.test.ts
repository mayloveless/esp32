import assert from "node:assert/strict";
import test from "node:test";
import type { RadioProgram } from "../program/types.ts";
import { ensureInventoryCore } from "./orchestrator-core.ts";

function program(id: string, format: RadioProgram["format"] = "news"): RadioProgram {
  return {
    audio_path: `${id}/audio.wav`,
    captions: [],
    content: {},
    created_at: "2026-09-14T00:00:00.000Z",
    duration_ms: 60_000,
    error: null,
    format,
    id,
    recipe: {},
    retired_at: null,
    status: "ready",
    title: id,
    updated_at: "2026-09-14T00:00:00.000Z",
  };
}

test("库存健康时 ensure 不生产节目", async () => {
  const active = [
    program("news"),
    program("chat", "chat"),
    { ...program("alien", "chat"), recipe: { render_mode: "alien" } },
    program("music", "music"),
  ];
  let produced = 0;
  const result = await ensureInventoryCore({
    listActiveReadyPrograms: async () => active,
    produceInventoryProgram: async () => {
      produced += 1;
      throw new Error("健康库存不应生产节目。");
    },
  });
  assert.equal(result.result, "healthy");
  assert.equal(produced, 0);
});

test("ensure 每次只补一个最高优先级缺口并返回刷新后的摘要", async () => {
  const active = [program("news")];
  const producedKinds: string[] = [];
  const result = await ensureInventoryCore({
    listActiveReadyPrograms: async () => active,
    produceInventoryProgram: async (kind) => {
      producedKinds.push(kind);
      const created = program("chat", "chat");
      active.push(created);
      return { program: created };
    },
  });
  assert.equal(result.result, "replenished");
  if (result.result === "replenished") {
    assert.equal(result.kind, "chat");
    assert.equal(result.programId, "chat");
    assert.equal(result.inventory.chat.count, 1);
  }
  assert.deepEqual(producedKinds, ["chat"]);
});

test("生产失败会原样抛出，且不会修改既有 ready 库存", async () => {
  const active = [program("news")];
  await assert.rejects(
    ensureInventoryCore({
      listActiveReadyPrograms: async () => active,
      produceInventoryProgram: async () => {
        throw new Error("测试生产失败。");
      },
    }),
    /测试生产失败/,
  );
  assert.deepEqual(active.map((item) => item.id), ["news"]);
});
