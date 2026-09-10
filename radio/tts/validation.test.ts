import assert from "node:assert/strict";
import test from "node:test";
import {
  getSynthesisText,
  maximumTtsInputCharacters,
  readMp3Duration,
  TtsError,
} from "./validation.ts";

const program = {
  format: "news" as const,
  content: {
    segments: [{ speaker: "播音员", text: "这是已保存的虚构宇宙广播稿件。" }],
  },
};

function fakeMp3() {
  const frameLength = 576;
  const bytes = new Uint8Array(frameLength * 2);
  bytes.set([0xff, 0xfb, 0x98, 0x00], 0);
  bytes.set([0xff, 0xfb, 0x98, 0x00], frameLength);
  return bytes;
}

test("从已保存稿件提取合成文本", () => {
  assert.equal(getSynthesisText(program), "这是已保存的虚构宇宙广播稿件。");
});

test("超长稿件会在发出 TTS 请求前被拒绝", () => {
  assert.throws(
    () =>
      getSynthesisText({
        ...program,
        content: {
          segments: [{ speaker: "播音员", text: "字".repeat(maximumTtsInputCharacters + 1) }],
        },
      }),
    (error: unknown) => error instanceof TtsError && error.kind === "input",
  );
});

test("可解析 MP3 帧并得到时长", () => {
  assert.equal(readMp3Duration(fakeMp3()), 72);
});
