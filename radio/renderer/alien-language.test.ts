import assert from "node:assert/strict";
import test from "node:test";
import {
  alienDialects,
  getAlienWord,
  toAlienSpokenText,
} from "./alien-language.ts";

const words = [
  "星云",
  "轨道",
  "观测站",
  "信号",
  "机械通信",
  "宇宙",
  "广播",
  "紧急",
  "导航员",
  "行星",
  "传输",
  "电台",
  "警报",
  "未知",
  "深空",
  "星际",
  "回声",
  "边界",
  "旅客",
  "风暴",
  "语言",
  "接收器",
  "量子",
  "频率",
];

function averageWordLength(dialect: (typeof alienDialects)[number]) {
  return (
    words.reduce((total, word) => total + getAlienWord(word, dialect).length, 0) /
    words.length
  );
}

test("三种外星方言都会稳定生成可读的拉丁伪词", () => {
  for (const dialect of alienDialects) {
    const first = toAlienSpokenText("星云信号，正在靠近。", dialect);
    const second = toAlienSpokenText("星云信号，正在靠近。", dialect);
    assert.equal(first, second);
    assert.match(first, /^[a-z ,.?!;:]+$/);
    assert.equal(getAlienWord("星云", dialect), getAlienWord("星云", dialect));
  }
});

test("相同词在不同方言中通常得到不同词形", () => {
  const variants = alienDialects.map((dialect) => getAlienWord("观测站", dialect));
  assert.equal(new Set(variants).size, alienDialects.length);
});

test("新版伪词平均长度明显低于旧版默认的 2 到 4 音节策略", () => {
  assert.ok(averageWordLength("cosmic-1") < 6);
  assert.ok(averageWordLength("machine-1") < averageWordLength("cosmic-1"));
});

test("大陆异语会产生有限辅音簇和词尾辅音", () => {
  const forms = words.map((word) => getAlienWord(word, "continental-1"));
  assert.ok(forms.some((form) => /^(kr|gr|tr|dr|vr|st|sk|pr|br)/.test(form)));
  assert.ok(forms.some((form) => /[nrsk tl]$/.test(form)));
});

test("机械通信语保持短促词形和硬辅音词尾", () => {
  const forms = words.map((word) => getAlienWord(word, "machine-1"));
  assert.ok(forms.some((form) => /[ktsr]$/.test(form)));
  assert.ok(forms.every((form) => form.length <= 7));
});

test("中文标点会保留为 TTS 可读的句界和停顿", () => {
  const spoken = toAlienSpokenText("星云，靠近。注意！", "machine-1");
  assert.match(spoken, /, /);
  assert.match(spoken, /\. /);
  assert.match(spoken, /!$/);
});
