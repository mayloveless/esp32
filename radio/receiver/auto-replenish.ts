import "server-only";
import { ScriptGenerationError } from "../content/script";
import { SynthesisInProgressError } from "../tts/synthesis-lock";
import { TtsError } from "../tts/validation";
import {
  ReplenishmentInProgressError,
} from "./replenishment";
import { ensureReceiverInventory } from "./inventory-orchestrator";

export {
  ReplenishmentInProgressError,
  ScriptGenerationError,
  SynthesisInProgressError,
  TtsError,
};

/** @deprecated Checkpoint B 起请直接使用 ensureReceiverInventory。 */
export async function replenishReceiverInventory(
): ReturnType<typeof ensureReceiverInventory> {
  return ensureReceiverInventory();
}
