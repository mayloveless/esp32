import "server-only";
import {
  createProgramAudioUrl,
  listActiveReadyPrograms,
} from "../program/service.ts";
import {
  createReceiverTuneResult as createReceiverTuneResultCore,
  type ReceiverManifestDependencies,
} from "./manifest-builder-core.ts";

export type { ReceiverManifestDependencies, ReceiverTuneResult } from "./manifest-builder-core.ts";

const defaultDependencies: ReceiverManifestDependencies = {
  createProgramAudioUrl,
  listActiveReadyPrograms,
};

export async function createReceiverTuneResult(
  excludeProgramIds: string[],
  dependencies: ReceiverManifestDependencies = defaultDependencies,
) {
  return createReceiverTuneResultCore(excludeProgramIds, dependencies);
}
