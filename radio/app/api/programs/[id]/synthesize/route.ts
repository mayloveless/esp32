import {
  assertLocalDevelopmentRequest,
  getRequestErrorStatus,
} from "../../../../../lib/supabase-server";
import {
  getProgram,
  saveSynthesizedProgramAudio,
  updateProgram,
} from "../../../../../program/service";
import { getSynthesisText, TtsError } from "../../../../../tts/validation";
import { synthesizeWithSiliconFlow } from "../../../../../tts/siliconflow";
import {
  SynthesisInProgressError,
  withSynthesisLock,
} from "../../../../../tts/synthesis-lock";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

function errorStatus(error: unknown) {
  if (error instanceof SynthesisInProgressError) return 409;
  if (error instanceof TtsError)
    return error.kind === "input" ? 400 : 503;
  return getRequestErrorStatus(error, 400);
}

export async function POST(request: Request, { params }: Context) {
  try {
    assertLocalDevelopmentRequest(request);
    const id = (await params).id;
    const current = await getProgram(id);
    if (!current)
      return Response.json({ error: "节目不存在。" }, { status: 404 });
    if (
      current.status !== "queued" &&
      !(current.status === "failed" && current.content.segments)
    )
      throw new TtsError("只有已保存稿件的节目可以合成语音。", "input");
    const text = getSynthesisText(current);
    return await withSynthesisLock(async () => {
      const generating = await updateProgram(id, {
        status: "generating",
        error: null,
      });
      if (!generating)
        return Response.json({ error: "节目不存在。" }, { status: 404 });
      try {
        const result = await synthesizeWithSiliconFlow(text);
        const saved = await saveSynthesizedProgramAudio(
          id,
          result.audioBytes,
          result.durationMs,
          {
            model: result.settings.model,
            provider: result.settings.provider,
            traceId: result.traceId,
            voice: result.settings.voice,
          },
        );
        if (!saved)
          return Response.json({ error: "节目不存在。" }, { status: 404 });
        return Response.json({
          cleanupWarning: saved.cleanupWarning,
          program: saved.program,
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "语音合成发生未知错误。";
        const program = await updateProgram(id, {
          status: "failed",
          error: message,
        });
        return Response.json(
          { error: message, program },
          { status: errorStatus(error) },
        );
      }
    });
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "无法开始语音合成。",
      },
      { status: errorStatus(error) },
    );
  }
}
