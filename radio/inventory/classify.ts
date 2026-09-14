import type { RadioProgram } from "../program/types.ts";
import { inventoryKinds, type InventoryKind } from "./plan.ts";

export const inventoryTargets: Record<InventoryKind, number> = {
  alien: 1,
  chat: 1,
  music: 1,
  news: 1,
};

export type InventorySummary = Record<
  InventoryKind,
  { count: number; programIds: string[] }
>;

function createEmptyInventory(): InventorySummary {
  return {
    alien: { count: 0, programIds: [] },
    chat: { count: 0, programIds: [] },
    music: { count: 0, programIds: [] },
    news: { count: 0, programIds: [] },
  };
}

function hasPlayableAudio(program: RadioProgram) {
  return (
    program.status === "ready" &&
    program.retired_at === null &&
    typeof program.audio_path === "string" &&
    program.audio_path.length > 0 &&
    typeof program.duration_ms === "number" &&
    Number.isSafeInteger(program.duration_ms) &&
    program.duration_ms > 0
  );
}

export function getInventoryKind(program: RadioProgram): InventoryKind | null {
  if (program.format === "music") return "music";
  if (program.recipe.render_mode === "alien") return "alien";
  if (program.format === "news") return "news";
  if (program.format === "chat") return "chat";
  return null;
}

/** 只统计能够被 Receiver 直接调入的 active-ready 节目。 */
export function classifyInventory(programs: RadioProgram[]): InventorySummary {
  const summary = createEmptyInventory();
  for (const program of programs) {
    if (!hasPlayableAudio(program)) continue;
    const kind = getInventoryKind(program);
    if (!kind) continue;
    summary[kind].count += 1;
    summary[kind].programIds.push(program.id);
  }
  return summary;
}

/**
 * 选择一个缺口最大的种类；同等缺口按 inventoryKinds 的固定顺序处理。
 */
export function pickInventoryDeficit(
  inventory: InventorySummary,
  targets: Record<InventoryKind, number> = inventoryTargets,
): InventoryKind | null {
  let selected: InventoryKind | null = null;
  let selectedRatio = 0;
  for (const kind of inventoryKinds) {
    const target = targets[kind];
    if (!Number.isSafeInteger(target) || target <= 0) continue;
    const missing = target - inventory[kind].count;
    if (missing <= 0) continue;
    const ratio = missing / target;
    if (selected === null || ratio > selectedRatio) {
      selected = kind;
      selectedRatio = ratio;
    }
  }
  return selected;
}
