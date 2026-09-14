import assert from "node:assert/strict";
import test from "node:test";
import { completeReceiverProgram } from "./completed-core.ts";

test("completed 使用同一 retire 生命周期并保持幂等", async () => {
  const first = await completeReceiverProgram("program-1", async () => ({
    changed: true,
    program: { id: "program-1" },
  }));
  const repeated = await completeReceiverProgram("program-1", async () => ({
    changed: false,
    program: { id: "program-1" },
  }));

  assert.deepEqual(first, {
    completed: true,
    program: { id: "program-1" },
    retired: true,
  });
  assert.deepEqual(repeated, {
    completed: true,
    program: { id: "program-1" },
    retired: false,
  });
});
