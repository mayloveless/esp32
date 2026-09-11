import assert from "node:assert/strict";
import test from "node:test";
import {
  findCaptionAtTime,
  getReceiverCaptions,
} from "./captions.ts";

const captions = getReceiverCaptions([
  { startMs: 0, endMs: 1_200, speaker: "观测员", text: "第一句中文含义。" },
  { startMs: 1_380, endMs: 2_600, speaker: "导航员", text: "第二句中文含义。" },
]);

test("Receiver 只接收结构有效的 captions", () => {
  assert.deepEqual(
    getReceiverCaptions([
      ...captions,
      { startMs: 100, endMs: 100, speaker: "无效", text: "无效" },
    ]),
    captions,
  );
});

test("根据播放时间定位当前字幕，片段间隙显示空白", () => {
  assert.equal(findCaptionAtTime(captions, 600)?.text, "第一句中文含义。");
  assert.equal(findCaptionAtTime(captions, 1_250), null);
  assert.equal(findCaptionAtTime(captions, 1_500)?.text, "第二句中文含义。");
});

test("从 startOffsetMs 中途切入时直接定位对应字幕", () => {
  const startOffsetMs = 1_900;
  assert.equal(
    findCaptionAtTime(captions, startOffsetMs)?.text,
    "第二句中文含义。",
  );
});
