import type { RadioProgram } from "../program/types";
import type { SynthesizeSpeech } from "../tts/speech";
import {
  getSynthesisSegments,
  type SynthesisSegment,
  TtsError,
} from "../tts/validation.ts";
import {
  mergeWavSegments,
  type Caption,
  wavSampleRate,
} from "./wav.ts";
import {
  defaultAlienDialect,
  toAlienSpokenText,
  type AlienDialect,
} from "./alien-language.ts";
import {
  applyMachineRadioEffect,
  machineRadioEffect,
} from "./audio-effects.ts";
import {
  getDefaultDeliveryProfileId,
  getDeliveryProfile,
  type DeliveryProfile,
  type DeliveryProfileId,
} from "./delivery.ts";
import {
  backgroundBedGenerator,
  getBackgroundBedGain,
  getDefaultBackgroundBed,
  synthesizeBackgroundBed,
  type BackgroundBed,
} from "./background-bed.ts";
import { mixSpeechWithBackground } from "./pcm-mixer.ts";

export type RendererVoices = {
  primaryVoice: string;
  secondaryVoice: string;
};

export const renderModes = ["normal", "alien"] as const;
export type RenderMode = (typeof renderModes)[number];

export type RenderOptions = {
  alienDialect?: AlienDialect;
  backgroundBed?: BackgroundBed;
  backgroundBedSeed?: string | null;
  deliveryProfile?: DeliveryProfileId;
  mode?: RenderMode;
};

export type RenderUnit = SynthesisSegment & {
  spokenText: string;
  voice: string;
};

export function mapSpeakerVoices(
  segments: SynthesisSegment[],
  voices: RendererVoices,
) {
  const mapping: Record<string, string> = {};
  let speakerCount = 0;
  for (const segment of segments) {
    if (mapping[segment.speaker]) continue;
    mapping[segment.speaker] =
      speakerCount % 2 === 0 ? voices.primaryVoice : voices.secondaryVoice;
    speakerCount += 1;
  }
  return mapping;
}

export function mergeAdjacentSpeakerSegments(
  segments: SynthesisSegment[],
  speakerVoices: Record<string, string>,
  options: Pick<Required<RenderOptions>, "alienDialect" | "deliveryProfile" | "mode"> = {
    alienDialect: defaultAlienDialect,
    deliveryProfile: "broadcast",
    mode: "normal",
  },
): RenderUnit[] {
  const units: RenderUnit[] = [];
  for (const segment of segments) {
    const previous = units.at(-1);
    if (previous?.speaker === segment.speaker) {
      previous.text = `${previous.text}\n${segment.text}`;
      continue;
    }
    const voice = speakerVoices[segment.speaker];
    if (!voice) throw new TtsError("说话者未分配音色。", "input");
    units.push({ ...segment, spokenText: segment.text, voice });
  }
  return units.map((unit) => ({
    ...unit,
    spokenText:
      options.mode === "alien"
        ? toAlienSpokenText(unit.text, options.alienDialect)
        : unit.text,
  }));
}

export function createRenderPlan(
  program: Pick<RadioProgram, "content" | "format">,
  voices: RendererVoices,
  options: RenderOptions = {},
) {
  const renderOptions = {
    alienDialect: options.alienDialect ?? defaultAlienDialect,
    deliveryProfile:
      options.deliveryProfile ?? getDefaultDeliveryProfileId(program.format),
    mode: options.mode ?? "normal",
  };
  const backgroundBed = options.backgroundBed ?? getDefaultBackgroundBed({
    alienDialect:
      renderOptions.mode === "alien" ? renderOptions.alienDialect : null,
    mode: renderOptions.mode,
  });
  const delivery = getDeliveryProfile(renderOptions.deliveryProfile);
  const segments = getSynthesisSegments(program);
  const speakerVoices = mapSpeakerVoices(segments, voices);
  if (program.format === "news") {
    for (const speaker of Object.keys(speakerVoices))
      speakerVoices[speaker] = voices.primaryVoice;
  }
  if (program.format === "chat") {
    const usedVoices = new Set(Object.values(speakerVoices));
    if (Object.keys(speakerVoices).length < 2 || usedVoices.size < 2)
      throw new TtsError("聊天节目必须至少使用两种不同音色。", "input");
  }
  return {
    alienDialect:
      renderOptions.mode === "alien" ? renderOptions.alienDialect : null,
    backgroundBed,
    delivery,
    mode: renderOptions.mode,
    speakerVoices,
    units: mergeAdjacentSpeakerSegments(segments, speakerVoices, renderOptions),
  };
}

export type RenderedProgramAudio = {
  audioEffect: string | null;
  audioBytes: Uint8Array;
  backgroundBed: BackgroundBed;
  backgroundBedGain: number;
  backgroundBedGenerator: string | null;
  backgroundBedSeed: string | null;
  captions: Caption[];
  delivery: DeliveryProfile;
  durationMs: number;
  sampleRate: number;
  speakerVoices: Record<string, string>;
  traceIds: Array<string | null>;
  alienDialect: AlienDialect | null;
  mode: RenderMode;
};

export async function renderProgramAudio(
  program: Pick<RadioProgram, "content" | "format">,
  voices: RendererVoices,
  synthesize: SynthesizeSpeech,
  options: RenderOptions = {},
): Promise<RenderedProgramAudio> {
  const plan = createRenderPlan(program, voices, options);
  const renderedSegments: Array<{
    audioBytes: Uint8Array;
    speaker: string;
    text: string;
  }> = [];
  const traceIds: Array<string | null> = [];
  for (const unit of plan.units) {
    const result = await synthesize({
      instruction: plan.delivery.instruction,
      responseFormat: "wav",
      sampleRate: wavSampleRate,
      speed: plan.delivery.speed,
      text: unit.spokenText,
      voice: unit.voice,
    });
    renderedSegments.push({
      audioBytes: result.audioBytes,
      speaker: unit.speaker,
      text: unit.text,
    });
    traceIds.push(result.traceId);
  }
  const merged = mergeWavSegments(renderedSegments);
  const applyMachineEffect =
    plan.mode === "alien" && plan.alienDialect === "machine-1";
  const speechAudioBytes = applyMachineEffect
    ? applyMachineRadioEffect(merged.audioBytes)
    : merged.audioBytes;
  const backgroundBedSeed =
    plan.backgroundBed === "none"
      ? null
      : (options.backgroundBedSeed ?? "background-bed-default");
  const background =
    plan.backgroundBed === "none" || backgroundBedSeed === null
      ? null
      : synthesizeBackgroundBed(speechAudioBytes, plan.backgroundBed, backgroundBedSeed);
  const mixed = mixSpeechWithBackground(
    speechAudioBytes,
    background?.audioBytes ?? null,
    {
      baseGain: background ? getBackgroundBedGain(plan.backgroundBed) : 0,
      captions: merged.captions,
    },
  );
  return {
    ...merged,
    audioBytes: mixed.audioBytes,
    audioEffect: applyMachineEffect ? machineRadioEffect : null,
    alienDialect: plan.alienDialect,
    backgroundBed: plan.backgroundBed,
    backgroundBedGain: background ? getBackgroundBedGain(plan.backgroundBed) : 0,
    backgroundBedGenerator: background ? backgroundBedGenerator : null,
    backgroundBedSeed,
    delivery: plan.delivery,
    durationMs: mixed.durationMs,
    mode: plan.mode,
    speakerVoices: plan.speakerVoices,
    traceIds,
  };
}
