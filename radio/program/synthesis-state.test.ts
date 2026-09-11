import assert from "node:assert/strict";
import test from "node:test";
import { getSynthesisOperation } from "./synthesis-state.ts";

const savedScript = { content: { segments: [] } };

test("ready 且有稿件的节目使用重新生成路径", () => {
  assert.equal(
    getSynthesisOperation({ ...savedScript, status: "ready" }),
    "regenerate_audio",
  );
});

test("首次合成仅允许 queued 或 failed 的已保存稿件", () => {
  assert.equal(
    getSynthesisOperation({ ...savedScript, status: "queued" }),
    "generate_audio",
  );
  assert.equal(
    getSynthesisOperation({ ...savedScript, status: "failed" }),
    "generate_audio",
  );
  assert.equal(
    getSynthesisOperation({ content: {}, status: "ready" }),
    null,
  );
});
