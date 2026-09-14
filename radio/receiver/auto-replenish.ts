import "server-only";
import { ScriptGenerationError } from "../content/script";
import { produceInventoryProgram } from "../inventory/producer";
import {
  getProgram,
  listActiveReadyPrograms,
} from "../program/service";
import { SynthesisInProgressError } from "../tts/synthesis-lock";
import { TtsError } from "../tts/validation";
import {
  getAutomaticInventoryKind,
  ReplenishmentInProgressError,
  withReplenishmentLock,
} from "./replenishment";

export {
  ReplenishmentInProgressError,
  ScriptGenerationError,
  SynthesisInProgressError,
  TtsError,
};

export type ReplenishmentResult =
  | { result: "inventory_available"; readyProgramIds: string[] }
  | { result: "replenished"; programId: string };

function availableProgramsExcept(programId: string | null, ids: string[]) {
  return programId ? ids.filter((id) => id !== programId) : ids;
}

export async function replenishReceiverInventory(
  playingProgramId: string | null,
): Promise<ReplenishmentResult> {
  return withReplenishmentLock(async () => {
    const active = await listActiveReadyPrograms();
    const readyProgramIds = availableProgramsExcept(
      playingProgramId,
      active.map((program) => program.id),
    );
    if (readyProgramIds.length > 0)
      return { result: "inventory_available", readyProgramIds };

    const playingProgram = playingProgramId
      ? await getProgram(playingProgramId)
      : null;
    const produced = await produceInventoryProgram(
      getAutomaticInventoryKind(playingProgram?.format ?? "news"),
    );
    return { result: "replenished", programId: produced.program.id };
  });
}
