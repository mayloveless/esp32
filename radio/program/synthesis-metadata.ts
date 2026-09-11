import type { DeliveryProfileId } from "../renderer/delivery";
import type { RenderMode } from "../renderer/render";
import type { JsonObject } from "./types";

export type SynthesisRecipeMetadata = {
  alienDialect: string | null;
  audioEffect: string | null;
  audioContentType: string;
  backgroundBed: "none" | "ambient" | "pulse" | "mysterious";
  backgroundBedGain: number;
  backgroundBedGenerator: string | null;
  backgroundBedSeed: string | null;
  deliveryProfile: DeliveryProfileId | null;
  model: string;
  provider: string;
  renderMode: RenderMode;
  responseFormat: "mp3" | "wav";
  sampleRate: number;
  speakerVoices: Record<string, string>;
  speed: number | null;
  traceIds: Array<string | null>;
};

export function buildSynthesisRecipe(
  recipe: JsonObject,
  metadata: SynthesisRecipeMetadata,
): JsonObject {
  return {
    ...recipe,
    audio_effect: metadata.audioEffect,
    audio_content_type: metadata.audioContentType,
    alien_dialect: metadata.alienDialect,
    background_bed: metadata.backgroundBed,
    background_bed_gain: metadata.backgroundBedGain,
    background_bed_generator: metadata.backgroundBedGenerator,
    background_bed_seed: metadata.backgroundBedSeed,
    delivery_profile: metadata.deliveryProfile,
    render_mode: metadata.renderMode,
    renderer: "segment-wav-v1",
    speaker_voice_map: metadata.speakerVoices,
    tts_model: metadata.model,
    tts_provider: metadata.provider,
    tts_response_format: metadata.responseFormat,
    tts_sample_rate: metadata.sampleRate,
    tts_speed: metadata.speed,
    tts_trace_ids: metadata.traceIds,
  };
}
