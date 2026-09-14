import assert from "node:assert/strict";
import test from "node:test";
import type { RadioProgram } from "../program/types.ts";
import {
  createReceiverTuneResult,
  type ReceiverManifestDependencies,
} from "./manifest-builder-core.ts";

function program(id: string, overrides: Partial<RadioProgram> = {}): RadioProgram {
  return {
    audio_path: `${id}/audio.wav`,
    captions: [{ endMs: 4_000, speaker: "主持人", startMs: 0, text: "节目开始" }],
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

function dependencies(programs: RadioProgram[]): ReceiverManifestDependencies {
  return {
    createProgramAudioUrl: async () => ({
      expiresAt: "2026-09-14T00:15:00.000Z",
      signedUrl: "https://storage.example/signed-audio.wav",
    }),
    listActiveReadyPrograms: async () => programs,
    random: () => 0,
  };
}

test("Web 与 Device 共用的 manifest builder 只输出接收机字段", async () => {
  const result = await createReceiverTuneResult(["first"], dependencies([
    program("first"),
    program("second", { format: "music", recipe: { render_mode: "alien" } }),
  ]));

  assert.equal(result.result, "signal");
  if (result.result !== "signal") return;
  assert.equal(result.manifest.programId, "second");
  assert.equal(result.manifest.signalKind, "music");
  assert.equal(result.manifest.startOffsetMs, 4_000);
  assert.equal(result.manifest.audioUrl, "https://storage.example/signed-audio.wav");
  assert.equal("serviceRoleKey" in result.manifest, false);
  assert.equal(JSON.stringify(result.manifest).includes("SUPABASE_SERVICE_ROLE_KEY"), false);
});

test("无 ready 库存立即返回 no_signal，且不会签发音频 URL", async () => {
  let signedUrlCalls = 0;
  const result = await createReceiverTuneResult([], {
    createProgramAudioUrl: async () => {
      signedUrlCalls += 1;
      return null;
    },
    listActiveReadyPrograms: async () => [],
  });

  assert.deepEqual(result, { result: "no_signal" });
  assert.equal(signedUrlCalls, 0);
});
