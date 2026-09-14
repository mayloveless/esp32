import "server-only";
import { ensureInventoryCore, type EnsureInventoryResult } from "../inventory/orchestrator-core.ts";
import { produceInventoryProgram } from "../inventory/producer.ts";
import { listActiveReadyPrograms } from "../program/service.ts";
import {
  ReplenishmentInProgressError,
  withReplenishmentLock,
} from "./replenishment.ts";

export { ReplenishmentInProgressError };
export type { EnsureInventoryResult };

export async function ensureReceiverInventory(): Promise<EnsureInventoryResult> {
  return withReplenishmentLock(() =>
    ensureInventoryCore({ listActiveReadyPrograms, produceInventoryProgram }),
  );
}
