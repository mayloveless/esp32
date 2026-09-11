import assert from "node:assert/strict";
import test from "node:test";
import { parsePcmWav } from "../renderer/wav.ts";
import { createSeededRandom } from "./random.ts";
import {
  createProceduralMusicRecipe,
  parseProceduralMusicRequest,
} from "./recipe.ts";
import { synthesizeProceduralMusic } from "./synth.ts";
import { proceduralMusicStyleOptions } from "./types.ts";

test("seeded PRNG 对同一 seed 输出稳定", () => {
  const first = createSeededRandom("same-seed");
  const second = createSeededRandom("same-seed");
  assert.deepEqual(
    [first(), first(), first(), first()],
    [second(), second(), second(), second()],
  );
});

test("相同 style 与 seed 生成完全相同的 PCM WAV", () => {
  const recipe = createProceduralMusicRecipe("retro_synth", "stable-seed");
  assert.deepEqual(
    synthesizeProceduralMusic(recipe).audioBytes,
    synthesizeProceduralMusic(recipe).audioBytes,
  );
});

test("不同 seed 的程序音乐不会完全相同", () => {
  const first = synthesizeProceduralMusic(
    createProceduralMusicRecipe("mechanical_pulse", "first-seed"),
  );
  const second = synthesizeProceduralMusic(
    createProceduralMusicRecipe("mechanical_pulse", "second-seed"),
  );
  assert.notDeepEqual(first.audioBytes, second.audioBytes);
});

test("机械脉冲避免突变采样与硬削波", () => {
  const asset = synthesizeProceduralMusic(
    createProceduralMusicRecipe("mechanical_pulse", "continuity-fixture"),
  );
  const { data } = parsePcmWav(asset.audioBytes);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let maxAdjacentSampleDelta = 0;
  for (let offset = 2; offset < data.length; offset += 2) {
    maxAdjacentSampleDelta = Math.max(
      maxAdjacentSampleDelta,
      Math.abs(view.getInt16(offset, true) - view.getInt16(offset - 2, true)),
    );
  }
  assert.ok(maxAdjacentSampleDelta < 1_000);
});

test("复古合成器避免突变采样与硬削波", () => {
  const asset = synthesizeProceduralMusic(
    createProceduralMusicRecipe("retro_synth", "retro-continuity-fixture"),
  );
  const { data } = parsePcmWav(asset.audioBytes);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let maxAdjacentSampleDelta = 0;
  for (let offset = 2; offset < data.length; offset += 2) {
    maxAdjacentSampleDelta = Math.max(
      maxAdjacentSampleDelta,
      Math.abs(view.getInt16(offset, true) - view.getInt16(offset - 2, true)),
    );
  }
  assert.ok(maxAdjacentSampleDelta < 1_000);
});

test("四种风格均输出合法、有时长且留有 headroom 的 32kHz mono PCM WAV", () => {
  for (const { value: style } of proceduralMusicStyleOptions) {
    const asset = synthesizeProceduralMusic(
      createProceduralMusicRecipe(style, `fixture-${style}`),
    );
    const parsed = parsePcmWav(asset.audioBytes);
    assert.equal(parsed.format.sampleRate, 32_000);
    assert.equal(parsed.format.channels, 1);
    assert.equal(parsed.format.bitsPerSample, 16);
    assert.ok(asset.durationMs >= 30_000 && asset.durationMs <= 50_000);
    const view = new DataView(parsed.data.buffer, parsed.data.byteOffset, parsed.data.byteLength);
    let peak = 0;
    for (let offset = 0; offset < parsed.data.length; offset += 2)
      peak = Math.max(peak, Math.abs(view.getInt16(offset, true)));
    assert.ok(peak > 100);
    assert.ok(peak < 30_000);
  }
});

test("random 风格请求合法且 recipe 保存已解析的实际风格与元数据", () => {
  assert.equal(parseProceduralMusicRequest({ style: "random" }), "random");
  const recipe = createProceduralMusicRecipe("random", "random-fixture");
  assert.equal(recipe.generator, "procedural-synth-v1");
  assert.ok(proceduralMusicStyleOptions.some(({ value }) => value === recipe.style));
  assert.equal(recipe.seed, "random-fixture");
  assert.ok(recipe.bpm > 0);
});
