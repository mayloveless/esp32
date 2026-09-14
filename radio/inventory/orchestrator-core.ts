import type { RadioProgram } from "../program/types.ts";
import {
  classifyInventory,
  pickInventoryDeficit,
  type InventorySummary,
} from "./classify.ts";
import type { InventoryKind } from "./plan.ts";

export type EnsureInventoryResult =
  | { inventory: InventorySummary; result: "healthy" }
  | {
      inventory: InventorySummary;
      kind: InventoryKind;
      programId: string;
      result: "replenished";
    };

export type InventoryOrchestratorDependencies = {
  listActiveReadyPrograms: () => Promise<RadioProgram[]>;
  produceInventoryProgram: (kind: InventoryKind) => Promise<{ program: RadioProgram }>;
};

/**
 * 检查一次库存并且最多生产一条缺口。此处不承担锁，方便测试并由服务端入口复用现有进程内锁。
 */
export async function ensureInventoryCore(
  dependencies: InventoryOrchestratorDependencies,
): Promise<EnsureInventoryResult> {
  const current = classifyInventory(await dependencies.listActiveReadyPrograms());
  const kind = pickInventoryDeficit(current);
  if (!kind) return { inventory: current, result: "healthy" };

  const produced = await dependencies.produceInventoryProgram(kind);
  const inventory = classifyInventory(await dependencies.listActiveReadyPrograms());
  return {
    inventory,
    kind,
    programId: produced.program.id,
    result: "replenished",
  };
}
