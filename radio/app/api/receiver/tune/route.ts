import {
  assertLocalDevelopmentRequest,
  getRequestErrorStatus,
  readJsonBody,
} from "../../../../lib/supabase-server";
import {
  createProgramAudioUrl,
  listActiveReadyPrograms,
} from "../../../../program/service";
import {
  calculateStartOffsetMs,
  findManifestCandidate,
  getSignalKind,
  parseTuneRequest,
  type ReceiverManifest,
} from "../../../../receiver/manifest";
import { getReceiverCaptions } from "../../../../receiver/captions";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    assertLocalDevelopmentRequest(request);
    const { excludeProgramIds } = parseTuneRequest(await readJsonBody(request));
    const candidates = await listActiveReadyPrograms();
    const program = findManifestCandidate(candidates, excludeProgramIds);
    if (!program)
      return Response.json({ result: "no_signal" as const });
    const audio = await createProgramAudioUrl(program);
    if (!audio || !program.audio_path)
      return Response.json({ result: "no_signal" as const });
    const manifest: ReceiverManifest = {
      programId: program.id,
      title: program.title,
      format: program.format,
      signalKind: getSignalKind(program),
      audioUrl: audio.signedUrl,
      audioExpiresAt: audio.expiresAt,
      durationMs: program.duration_ms,
      startOffsetMs: calculateStartOffsetMs(program.duration_ms),
      captions: getReceiverCaptions(program.captions),
      retireOnComplete: true,
    };
    return Response.json({ result: "signal" as const, manifest });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "无法调台。" },
      { status: getRequestErrorStatus(error, 400) },
    );
  }
}
