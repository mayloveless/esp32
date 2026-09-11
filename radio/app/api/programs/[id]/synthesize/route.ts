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
import { getSynthesisOperation } from "../../../../../program/synthesis-state";
import {
  isAlienDialect,
  type AlienDialect,
} from "../../../../../renderer/alien-language";
import {
  renderProgramAudio,
  type RenderMode,
} from "../../../../../renderer/render";
import {
  getDefaultBackgroundBed,
  parseBackgroundBed,
  type BackgroundBed,
} from "../../../../../renderer/background-bed";
import {
  parseDeliveryProfileId,
  type DeliveryProfileId,
} from "../../../../../renderer/delivery";
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

type SynthesisRequestOptions = {
  alienDialect?: AlienDialect;
  backgroundBed: BackgroundBed;
  backgroundBedSeed: string | null;
  deliveryProfile?: DeliveryProfileId;
  mode: RenderMode;
};

async function readSynthesisRequest(
  request: Request,
): Promise<SynthesisRequestOptions> {
  const body = await readJsonBody(request);
  if (typeof body !== "object" || body === null || Array.isArray(body))
    throw new TtsError("合成请求必须是对象。", "input");
  const { alienDialect, backgroundBed, deliveryProfile, renderMode } = body as {
    alienDialect?: unknown;
    backgroundBed?: unknown;
    deliveryProfile?: unknown;
    renderMode?: unknown;
  };
  if (renderMode !== undefined && renderMode !== "normal" && renderMode !== "alien")
    throw new TtsError("播报模式只能是 normal 或 alien。", "input");
  if (alienDialect !== undefined && !isAlienDialect(alienDialect))
    throw new TtsError("外星方言只能是 cosmic-1、machine-1 或 continental-1。", "input");
  const mode = renderMode ?? "normal";
  const resolvedAlienDialect = mode === "alien" ? alienDialect ?? "cosmic-1" : null;
  const resolvedBackgroundBed =
    backgroundBed === undefined
      ? getDefaultBackgroundBed({ alienDialect: resolvedAlienDialect, mode })
      : parseBackgroundBed(backgroundBed);
  return {
    alienDialect,
    backgroundBed: resolvedBackgroundBed,
    backgroundBedSeed:
      resolvedBackgroundBed === "none" ? null : crypto.randomUUID(),
    deliveryProfile:
      deliveryProfile === undefined
        ? undefined
        : parseDeliveryProfileId(deliveryProfile),
    mode,
  };
}

export async function POST(request: Request, { params }: Context) {
  try {
    assertLocalDevelopmentRequest(request);
    const synthesisOptions = await readSynthesisRequest(request);
    const id = (await params).id;
    const current = await getProgram(id);
    if (!current)
      return Response.json({ error: "节目不存在。" }, { status: 404 });
    const synthesisOperation = getSynthesisOperation(current);
    if (!synthesisOperation)
      throw new TtsError("只有已保存稿件的节目可以合成语音。", "input");
    const isRegeneration = synthesisOperation === "regenerate_audio";
    const settings = getTtsSettings();
    assertTtsReady(settings);
    return await withSynthesisLock(async () => {
      if (!isRegeneration) {
        const generating = await updateProgram(id, {
          status: "generating",
          error: null,
        });
        if (!generating)
          return Response.json({ error: "节目不存在。" }, { status: 404 });
      }
      try {
        const rendered = await renderProgramAudio(
          current,
          {
            primaryVoice: settings.primaryVoice,
            secondaryVoice: settings.secondaryVoice,
          },
          synthesizeSpeech,
          synthesisOptions,
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
            audioEffect: rendered.audioEffect,
            backgroundBed: rendered.backgroundBed,
            backgroundBedGain: rendered.backgroundBedGain,
            backgroundBedGenerator: rendered.backgroundBedGenerator,
            backgroundBedSeed: rendered.backgroundBedSeed,
            captions: rendered.captions,
            deliveryProfile: rendered.delivery.id,
            model: settings.model,
            provider: settings.provider,
            renderMode: rendered.mode,
            responseFormat: "wav",
            sampleRate: rendered.sampleRate,
            speakerVoices: rendered.speakerVoices,
            speed: rendered.delivery.speed,
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
        if (isRegeneration)
          return Response.json(
            { error: message, program: current },
            { status: errorStatus(error) },
          );
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
