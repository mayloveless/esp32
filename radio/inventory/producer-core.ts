import type { BroadcastScript, JsonObject, RadioProgram } from "../program/types.ts";
import type { GenerateScriptInput } from "../program/validation.ts";
import type { DeliveryProfile } from "../renderer/delivery.ts";
import type { RenderMode } from "../renderer/render.ts";
import type { Caption } from "../renderer/wav.ts";
import type { DeepSeekSettings } from "../content/script.ts";
import type { TtsSettings } from "../tts/config.ts";
import type { AlienDialect } from "../renderer/alien-language.ts";
import type { ProceduralMusicRecipe } from "../music/types.ts";
import type { ProceduralMusicAsset } from "../music/synth.ts";
import type {
  InventoryKind,
  InventoryProductionPlan,
  SpeechInventoryPlan,
} from "./plan.ts";

type RenderedInventoryAudio = {
  alienDialect: AlienDialect | null;
  audioBytes: Uint8Array;
  audioEffect: string | null;
  backgroundBed: "none" | "ambient" | "pulse" | "mysterious";
  backgroundBedGain: number;
  backgroundBedGenerator: string | null;
  backgroundBedSeed: string | null;
  captions: Caption[];
  delivery: DeliveryProfile;
  durationMs: number;
  mode: RenderMode;
  sampleRate: number;
  speakerVoices: Record<string, string>;
  traceIds: Array<string | null>;
};

type InventoryProducerDependencies = {
  assertDeepSeekReady: (settings: DeepSeekSettings) => string;
  assertTtsReady: (settings: TtsSettings) => string;
  createGeneratingProgram: (input: {
    format: "news" | "chat";
    language: string;
    model: string;
    style: string;
    topic: string | null;
  }) => Promise<RadioProgram>;
  createProceduralMusicProgram: (
    recipe: ProceduralMusicRecipe,
    asset: ProceduralMusicAsset,
    options: { inventorySource?: "auto" },
  ) => Promise<{ cleanupWarning: string | null; program: RadioProgram }>;
  createProceduralMusicRecipe: (
    style: "random",
    seed: string,
  ) => ProceduralMusicRecipe;
  createSeed: () => string;
  generateBroadcastScript: (
    input: GenerateScriptInput,
  ) => Promise<{ model: string; script: BroadcastScript }>;
  getDeepSeekSettings: () => DeepSeekSettings;
  getTtsSettings: () => TtsSettings;
  renderProgramAudio: (
    program: Pick<RadioProgram, "content" | "format">,
    voices: { primaryVoice: string; secondaryVoice: string },
    synthesize: (request: {
      instruction?: string;
      responseFormat: "mp3" | "wav";
      sampleRate: number;
      speed?: number;
      text: string;
      voice: string;
    }) => Promise<{ audioBytes: Uint8Array; traceId: string | null }>,
    options: {
      alienDialect?: AlienDialect;
      backgroundBedSeed: string;
      mode: RenderMode;
    },
  ) => Promise<RenderedInventoryAudio>;
  runGeneration: <T>(operation: () => Promise<T>) => Promise<T>;
  runSynthesis: <T>(operation: () => Promise<T>) => Promise<T>;
  saveSynthesizedProgramAudio: (
    id: string,
    asset: {
      audioBytes: Uint8Array;
      contentType: "audio/wav";
      durationMs: number;
      sampleRate: number;
    },
    metadata: {
      alienDialect: AlienDialect | null;
      audioEffect: string | null;
      backgroundBed: "none" | "ambient" | "pulse" | "mysterious";
      backgroundBedGain: number;
      backgroundBedGenerator: string | null;
      backgroundBedSeed: string | null;
      captions: Caption[];
      deliveryProfile: DeliveryProfile["id"];
      model: string;
      provider: string;
      renderMode: RenderMode;
      responseFormat: "wav";
      sampleRate: number;
      speakerVoices: Record<string, string>;
      speed: number;
      traceIds: Array<string | null>;
    },
  ) => Promise<{ cleanupWarning: string | null; program: RadioProgram } | null>;
  synthesizeProceduralMusic: (recipe: ProceduralMusicRecipe) => ProceduralMusicAsset;
  synthesizeSpeech: (request: {
    instruction?: string;
    responseFormat: "mp3" | "wav";
    sampleRate: number;
    speed?: number;
    text: string;
    voice: string;
  }) => Promise<{ audioBytes: Uint8Array; traceId: string | null }>;
  updateProgram: (
    id: string,
    input: {
      content?: BroadcastScript;
      error?: string | null;
      recipe?: JsonObject;
      status?: "generating" | "failed";
      title?: string;
    },
  ) => Promise<RadioProgram | null>;
};

export type InventoryProductionResult = {
  kind: InventoryKind;
  program: RadioProgram;
};

async function markProductionFailed(
  id: string,
  error: unknown,
  update: InventoryProducerDependencies["updateProgram"],
) {
  const message = error instanceof Error ? error.message : "自动节目生产发生未知错误。";
  await update(id, { error: message, status: "failed" });
}

async function produceSpeechInventoryProgram(
  plan: SpeechInventoryPlan,
  dependencies: InventoryProducerDependencies,
): Promise<InventoryProductionResult> {
  // 先检查两家付费服务，避免配置问题留下无意义的失败节目。
  const textSettings = dependencies.getDeepSeekSettings();
  dependencies.assertDeepSeekReady(textSettings);
  const ttsSettings = dependencies.getTtsSettings();
  dependencies.assertTtsReady(ttsSettings);

  return dependencies.runGeneration(async () => {
    const created = await dependencies.createGeneratingProgram({
      ...plan.input,
      model: textSettings.model,
    });
    try {
      const { model, script } = await dependencies.generateBroadcastScript(plan.input);
      const scripted = await dependencies.updateProgram(created.id, {
        content: script,
        error: null,
        recipe: {
          ...created.recipe,
          inventory_source: "auto",
          text_model: model,
        },
        status: "generating",
        title: script.title,
      });
      if (!scripted) throw new Error("自动生产的节目已不存在。");

      return await dependencies.runSynthesis(async () => {
        const rendered = await dependencies.renderProgramAudio(
          scripted,
          {
            primaryVoice: ttsSettings.primaryVoice,
            secondaryVoice: ttsSettings.secondaryVoice,
          },
          dependencies.synthesizeSpeech,
          {
            alienDialect: plan.alienDialect ?? undefined,
            backgroundBedSeed: dependencies.createSeed(),
            mode: plan.mode,
          },
        );
        const saved = await dependencies.saveSynthesizedProgramAudio(
          created.id,
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
            model: ttsSettings.model,
            provider: ttsSettings.provider,
            renderMode: rendered.mode,
            responseFormat: "wav",
            sampleRate: rendered.sampleRate,
            speakerVoices: rendered.speakerVoices,
            speed: rendered.delivery.speed,
            traceIds: rendered.traceIds,
          },
        );
        if (!saved) throw new Error("自动生产的节目已不存在。");
        return { kind: plan.kind, program: saved.program };
      });
    } catch (error) {
      await markProductionFailed(created.id, error, dependencies.updateProgram);
      throw error;
    }
  });
}

/**
 * 不直接接触供应商或数据库的生产顺序编排，供服务端入口与不收费测试复用。
 */
export async function produceInventoryProgramCore(
  plan: InventoryProductionPlan,
  dependencies: InventoryProducerDependencies,
): Promise<InventoryProductionResult> {
  if (plan.kind === "music") {
    const recipe = dependencies.createProceduralMusicRecipe("random", dependencies.createSeed());
    const saved = await dependencies.createProceduralMusicProgram(
      recipe,
      dependencies.synthesizeProceduralMusic(recipe),
      { inventorySource: "auto" },
    );
    return { kind: plan.kind, program: saved.program };
  }
  return produceSpeechInventoryProgram(plan, dependencies);
}

export type { InventoryProducerDependencies };
