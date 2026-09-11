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

export type RendererVoices = {
  primaryVoice: string;
  secondaryVoice: string;
};

export type RenderUnit = SynthesisSegment & { voice: string };

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
    units.push({ ...segment, voice });
  }
  return units;
}

export function createRenderPlan(
  program: Pick<RadioProgram, "content" | "format">,
  voices: RendererVoices,
) {
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
    speakerVoices,
    units: mergeAdjacentSpeakerSegments(segments, speakerVoices),
  };
}

export type RenderedProgramAudio = {
  audioBytes: Uint8Array;
  captions: Caption[];
  durationMs: number;
  sampleRate: number;
  speakerVoices: Record<string, string>;
  traceIds: Array<string | null>;
};

export async function renderProgramAudio(
  program: Pick<RadioProgram, "content" | "format">,
  voices: RendererVoices,
  synthesize: SynthesizeSpeech,
): Promise<RenderedProgramAudio> {
  const plan = createRenderPlan(program, voices);
  const renderedSegments: Array<{
    audioBytes: Uint8Array;
    speaker: string;
    text: string;
  }> = [];
  const traceIds: Array<string | null> = [];
  for (const unit of plan.units) {
    const result = await synthesize({
      responseFormat: "wav",
      sampleRate: wavSampleRate,
      text: unit.text,
      voice: unit.voice,
    });
    renderedSegments.push({
      audioBytes: result.audioBytes,
      speaker: unit.speaker,
      text: unit.text,
    });
    traceIds.push(result.traceId);
  }
  return { ...mergeWavSegments(renderedSegments), speakerVoices: plan.speakerVoices, traceIds };
}
