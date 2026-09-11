import assert from "node:assert/strict";
import test from "node:test";
import {
  getAlienWord,
  toAlienSpokenText,
} from "./alien-language.ts";

test("相同方言和中文词会稳定映射为同一伪外星语词", () => {
  assert.equal(getAlienWord("星云"), getAlienWord("星云"));
  assert.match(getAlienWord("星云"), /^[a-z]+$/);
});

test("相同输入重复转换会得到完全相同的播报文本", () => {
  const source = "星云信号，正在靠近。星云信号！";
  const first = toAlienSpokenText(source);
  const second = toAlienSpokenText(source);
  assert.equal(first, second);
  assert.match(first, /^[a-z ,.!?;:]+$/);
});

test("不同词不会全部映射成同一个伪外星语词", () => {
  const words = ["星云", "轨道", "观测站", "信号"];
  assert.ok(new Set(words.map((word) => getAlienWord(word))).size > 1);
});

test("中文标点会保留为 TTS 可读的句界和停顿", () => {
  const spoken = toAlienSpokenText("星云，靠近。注意！");
  assert.match(spoken, /, /);
  assert.match(spoken, /\. /);
  assert.match(spoken, /!$/);
});
