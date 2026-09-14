import type { EnsureInventoryResult } from "./orchestrator-core.ts";
import { getInventoryHealth } from "./classify.ts";

export const maximumInventoryPreheatSteps = 14;

export type InventoryPreheatResult =
  | {
      inventory: EnsureInventoryResult["inventory"];
      result: "healthy";
      steps: number;
    }
  | {
      error: unknown;
      result: "error";
      steps: number;
    }
  | {
      inventory: EnsureInventoryResult["inventory"];
      result: "maximum_reached";
      steps: number;
    };

type PreheatOptions = {
  maximumSteps?: number;
  onStep?: (result: EnsureInventoryResult, step: number) => void;
};

/**
 * 显式预热时逐个请求单步 replenish；绝不并发，也不会在任意单个请求中批量生产。
 */
export async function preheatReceiverInventory(
  ensure: () => Promise<EnsureInventoryResult>,
  options: PreheatOptions = {},
): Promise<InventoryPreheatResult> {
  const maximumSteps = options.maximumSteps ?? maximumInventoryPreheatSteps;
  let lastResult: EnsureInventoryResult | null = null;

  for (let step = 1; step <= maximumSteps; step += 1) {
    try {
      const result = await ensure();
      lastResult = result;
      options.onStep?.(result, step);
      if (
        result.result === "healthy" ||
        getInventoryHealth(result.inventory) === "healthy"
      )
        return { inventory: result.inventory, result: "healthy", steps: step };
    } catch (error) {
      return { error, result: "error", steps: step };
    }
  }

  if (!lastResult)
    return {
      error: new Error("预热最大次数必须大于 0。"),
      result: "error",
      steps: 0,
    };
  return {
    inventory: lastResult.inventory,
    result: "maximum_reached",
    steps: maximumSteps,
  };
}
