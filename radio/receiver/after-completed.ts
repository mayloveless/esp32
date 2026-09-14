import "server-only";
import {
  ensureReceiverInventory,
  ReplenishmentInProgressError,
} from "./inventory-orchestrator.ts";
import { replenishAfterReceiverCompletion as replenishAfterCompletionCore } from "./after-completed-core.ts";

/** completed 成功后异步补一条；补货失败不得影响已经完成的下线响应。 */
export function replenishAfterReceiverCompletion(retired: boolean) {
  replenishAfterCompletionCore(retired, ensureReceiverInventory, {
    isIgnoredError: (error) => error instanceof ReplenishmentInProgressError,
    warn: (error) => console.warn("节目完成后的库存补充未完成。", error),
  });
}
