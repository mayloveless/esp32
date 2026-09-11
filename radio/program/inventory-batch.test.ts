import assert from "node:assert/strict";
import test from "node:test";
import {
  maximumInventoryBatchSize,
  parseInventoryBatchRequest,
} from "./inventory-batch.ts";

const programId = "17a469b2-5a5f-4d09-872e-2815d455aa04";

test("批量库存请求会去重并保留操作类型", () => {
  assert.deepEqual(
    parseInventoryBatchRequest({
      action: "retire",
      programIds: [programId, programId],
    }),
    { action: "retire", programIds: [programId] },
  );
  assert.deepEqual(
    parseInventoryBatchRequest({ action: "delete", programIds: [programId] }),
    { action: "delete", programIds: [programId] },
  );
});

test("批量库存请求拒绝空列表、超量或无效 ID", () => {
  assert.throws(() => parseInventoryBatchRequest({ action: "restore", programIds: [] }));
  assert.throws(() =>
    parseInventoryBatchRequest({
      action: "restore",
      programIds: Array.from({ length: maximumInventoryBatchSize + 1 }, () => programId),
    }),
  );
  assert.throws(() =>
    parseInventoryBatchRequest({ action: "restore", programIds: ["invalid"] }),
  );
});
