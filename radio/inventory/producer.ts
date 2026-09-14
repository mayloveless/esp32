import "server-only";
import { assertDeepSeekReady } from "../content/deepseek-config.ts";
import { withGenerationLock } from "../content/generation-lock.ts";
import { generateBroadcastScript, getDeepSeekSettings } from "../content/script.ts";
import { createProceduralMusicRecipe } from "../music/recipe.ts";
import { synthesizeProceduralMusic } from "../music/synth.ts";
import {
  createGeneratingProgram,
  createProceduralMusicProgram,
  saveSynthesizedProgramAudio,
  updateProgram,
} from "../program/service.ts";
import { renderProgramAudio } from "../renderer/render.ts";
import { assertTtsReady } from "../tts/config.ts";
import { getTtsSettings } from "../tts/siliconflow.ts";
import { synthesizeSpeech } from "../tts/speech.ts";
import { withSynthesisLock } from "../tts/synthesis-lock.ts";
import { createInventoryProductionPlan, type InventoryKind } from "./plan.ts";
import {
  produceInventoryProgramCore,
  type InventoryProducerDependencies,
  type InventoryProductionResult,
} from "./producer-core.ts";

const productionDependencies = {
  assertDeepSeekReady,
  assertTtsReady,
  createGeneratingProgram,
  createProceduralMusicProgram,
  createProceduralMusicRecipe,
  createSeed: crypto.randomUUID,
  generateBroadcastScript,
  getDeepSeekSettings,
  getTtsSettings,
  renderProgramAudio,
  runGeneration: withGenerationLock,
  runSynthesis: withSynthesisLock,
  saveSynthesizedProgramAudio,
  synthesizeProceduralMusic,
  synthesizeSpeech,
  updateProgram,
} satisfies InventoryProducerDependencies;

/**
 * 生产一条可进入 ready 库存的节目。调用本函数才可能发生付费文本或语音请求；不会在 tune 中调用。
 */
export async function produceInventoryProgram(
  kind: InventoryKind,
  random: () => number = Math.random,
): Promise<InventoryProductionResult> {
  return produceInventoryProgramCore(
    createInventoryProductionPlan(kind, random),
    productionDependencies,
  );
}

export type { InventoryProductionResult };
