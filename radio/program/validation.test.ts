import assert from "node:assert/strict";
import test from "node:test";
import { parseGenerateScript } from "./validation.ts";

test("生成稿件拒绝不支持的节目形式", () => {
  assert.throws(
    () =>
      parseGenerateScript({
        format: "music",
        language: "中文",
        style: "冷静",
      }),
    /只支持 news 或 chat/,
  );
});

test("生成稿件限制主题、语言和风格长度", () => {
  assert.throws(
    () =>
      parseGenerateScript({
        format: "news",
        language: "中文",
        style: "冷静",
        topic: "宇宙".repeat(121),
      }),
    /主题长度不能超过 240 个字符/,
  );
});
