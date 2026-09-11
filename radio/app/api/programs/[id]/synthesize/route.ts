import {
  assertLocalDevelopmentRequest,
  getRequestErrorStatus,
  readJsonBody,
} from "../../../../../lib/supabase-server";
import {
  getProgram,
  saveSynthesizedProgramAudio,
  updateProgram,
} from "../../../../../program/service";
import {
  renderProgramAudio,
  type RenderMode,
} from "../../../../../renderer/render";
import { assertTtsReady } from "../../../../../tts/config";
import { getTtsSettings } from "../../../../../tts/siliconflow";
import { synthesizeSpeech } from "../../../../../tts/speech";
import { TtsError } from "../../../../../tts/validation";
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

async function readRenderMode(request: Request): Promise<RenderMode> {
  const body = await readJsonBody(request);
  if (typeof body !== "object" || body === null || Array.isArray(body))
    throw new TtsError("合成请求必须是对象。", "input");
  const renderMode = (body as { renderMode?: unknown }).renderMode;
  if (renderMode === undefined || renderMode === "normal") return "normal";
  if (renderMode === "alien") return "alien";
  throw new TtsError("播报模式只能是 normal 或 alien。", "input");
}

export async function POST(request: Request, { params }: Context) {
  try {
    assertLocalDevelopmentRequest(request);
    const renderMode = await readRenderMode(request);
    const id = (await params).id;
    const current = await getProgram(id);
    if (!current)
      return Response.json({ error: "节目不存在。" }, { status: 404 });
    if (
      current.status !== "queued" &&
      !(current.status === "failed" && current.content.segments)
    )
      throw new TtsError("只有已保存稿件的节目可以合成语音。", "input");
    const settings = getTtsSettings();
    assertTtsReady(settings);
    return await withSynthesisLock(async () => {
      const generating = await updateProgram(id, {
        status: "generating",
        error: null,
      });
      if (!generating)
        return Response.json({ error: "节目不存在。" }, { status: 404 });
      try {
        const rendered = await renderProgramAudio(
          current,
          {
            primaryVoice: settings.primaryVoice,
            secondaryVoice: settings.secondaryVoice,
          },
          synthesizeSpeech,
          { mode: renderMode },
        );
        const saved = await saveSynthesizedProgramAudio(
          id,
          {
            audioBytes: rendered.audioBytes,
            contentType: "audio/wav",
            durationMs: rendered.durationMs,
            sampleRate: rendered.sampleRate,
          },
          {
            alienDialect: rendered.alienDialect,
            captions: rendered.captions,
            model: settings.model,
            provider: settings.provider,
            renderMode: rendered.mode,
            responseFormat: "wav",
            sampleRate: rendered.sampleRate,
            speakerVoices: rendered.speakerVoices,
            traceIds: rendered.traceIds,
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
