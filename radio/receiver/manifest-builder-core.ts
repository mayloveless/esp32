import type { RadioProgram } from "../program/types.ts";
import { getReceiverCaptions } from "./captions.ts";
import {
  calculateStartOffsetMs,
  findManifestCandidate,
  getSignalKind,
  type ReceiverManifest,
} from "./manifest.ts";

export type ReceiverTuneResult =
  | { result: "no_signal" }
  | { result: "signal"; manifest: ReceiverManifest };

type AudioUrl = { signedUrl: string; expiresAt: string } | null;

export type ReceiverManifestDependencies = {
  createProgramAudioUrl: (program: RadioProgram) => Promise<AudioUrl>;
  listActiveReadyPrograms: () => Promise<RadioProgram[]>;
  random?: () => number;
};

/**
 * 从现有可播库存构造 Receiver manifest。它不会触发库存生产或调用 AI。
 */
export async function createReceiverTuneResult(
  excludeProgramIds: string[],
  dependencies: ReceiverManifestDependencies,
): Promise<ReceiverTuneResult> {
  const candidates = await dependencies.listActiveReadyPrograms();
  const program = findManifestCandidate(
    candidates,
    excludeProgramIds,
    dependencies.random,
  );
  if (!program) return { result: "no_signal" };

  const audio = await dependencies.createProgramAudioUrl(program);
  if (!audio || !program.audio_path) return { result: "no_signal" };

  return {
    result: "signal",
    manifest: {
      programId: program.id,
      title: program.title,
      format: program.format,
      signalKind: getSignalKind(program),
      audioUrl: audio.signedUrl,
      audioExpiresAt: audio.expiresAt,
      durationMs: program.duration_ms,
      startOffsetMs: calculateStartOffsetMs(program.duration_ms, dependencies.random),
      captions: getReceiverCaptions(program.captions),
      retireOnComplete: true,
    },
  };
}
