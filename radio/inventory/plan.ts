import type { AlienDialect } from "../renderer/alien-language.ts";
import type { RenderMode } from "../renderer/render.ts";
import type { GenerateScriptInput } from "../program/validation.ts";

export const inventoryKinds = ["news", "chat", "alien", "music"] as const;
export type InventoryKind = (typeof inventoryKinds)[number];

const automaticScriptDefaults = {
  language: "中文",
  style: "冷静、略带未知感",
  topic: null,
} as const satisfies Omit<GenerateScriptInput, "format">;

const automaticAlienDialects = [
  "cosmic-1",
  "continental-1",
  "machine-1",
] as const satisfies readonly AlienDialect[];

export type SpeechInventoryPlan = {
  alienDialect: AlienDialect | null;
  input: GenerateScriptInput;
  kind: "news" | "chat" | "alien";
  mode: RenderMode;
};

export type MusicInventoryPlan = {
  kind: "music";
};

export type InventoryProductionPlan = SpeechInventoryPlan | MusicInventoryPlan;

function pickAlienDialect(random: () => number): AlienDialect {
  const value = random();
  const normalized = Number.isFinite(value) ? Math.max(0, Math.min(value, 0.999_999)) : 0;
  return automaticAlienDialects[Math.floor(normalized * automaticAlienDialects.length)];
}

/**
 * 自动生产的默认计划保持小且可复现。调用方可注入 random，避免把不可控随机数写入业务路径。
 */
export function createInventoryProductionPlan(
  kind: InventoryKind,
  random: () => number = Math.random,
): InventoryProductionPlan {
  if (kind === "music") return { kind };
  if (kind === "alien") {
    return {
      alienDialect: pickAlienDialect(random),
      input: { ...automaticScriptDefaults, format: "chat" },
      kind,
      mode: "alien",
    };
  }
  return {
    alienDialect: null,
    input: { ...automaticScriptDefaults, format: kind },
    kind,
    mode: "normal",
  };
}
