import assert from "node:assert/strict";
import test from "node:test";
import { getSignalPresentation } from "./presentation.ts";

test("外星信号将中文 captions 标为译文", () => {
  const presentation = getSignalPresentation("alien");
  assert.equal(presentation.label, "未知语言信号");
  assert.equal(presentation.captionLabel, "译文");
});

test("音乐信号不创建空字幕区域", () => {
  const presentation = getSignalPresentation("music");
  assert.equal(presentation.captionLabel, null);
  assert.equal(presentation.musicStatus, "音乐广播中");
});
