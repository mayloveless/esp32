import type { InventoryKind } from "../inventory/plan.ts";
import type { ProgramFormat } from "../program/types.ts";

export class ReplenishmentInProgressError extends Error {
  constructor() {
    super("已有接收机库存补充任务正在执行。");
  }
}

let replenishing = false;

// Checkpoint A 保留既有补货触发语义；Checkpoint B 会改为按完整库存缺口选择 kind。
export function getAutomaticInventoryKind(format: ProgramFormat | "music"): InventoryKind {
  return format === "chat" ? "chat" : "news";
}

export async function withReplenishmentLock<T>(operation: () => Promise<T>) {
  if (replenishing) throw new ReplenishmentInProgressError();
  replenishing = true;
  try {
    return await operation();
  } finally {
    replenishing = false;
  }
}
