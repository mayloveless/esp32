import assert from "node:assert/strict";
import test from "node:test";
import {
  deliveryProfileIds,
  getDefaultDeliveryProfileId,
  getDeliveryProfile,
  parseDeliveryProfileId,
} from "./delivery.ts";
import { TtsError } from "../tts/validation.ts";

test("节目形式会选择最小的默认播报风格", () => {
  assert.equal(getDefaultDeliveryProfileId("news"), "broadcast");
  assert.equal(getDefaultDeliveryProfileId("chat"), "lively");
});

test("手动选择的播报风格会覆盖默认值", () => {
  assert.equal(parseDeliveryProfileId("urgent"), "urgent");
  assert.equal(getDeliveryProfile("urgent").speed, 1.3);
});

test("对话相关风格会使用较快但仍清晰的语速", () => {
  assert.equal(getDeliveryProfile("lively").speed, 1.25);
  assert.equal(getDeliveryProfile("mysterious").speed, 1.18);
});

test("所有内置 profile 的 speed 都在供应商允许范围内", () => {
  for (const id of deliveryProfileIds) {
    const { speed } = getDeliveryProfile(id);
    assert.ok(speed >= 0.25 && speed <= 4);
  }
});

test("未知的播报风格会被拒绝", () => {
  assert.throws(
    () => parseDeliveryProfileId("freeform"),
    (error: unknown) => error instanceof TtsError && error.kind === "input",
  );
});
