import "server-only";
import { assertDeepSeekReady } from "../content/deepseek-config";
import {
  GenerationInProgressError,
  withGenerationLock,
} from "../content/generation-lock";
import {
  generateBroadcastScript,
  getDeepSeekSettings,
  ScriptGenerationError,
} from "../content/script";
import {
  createGeneratingProgram,
  getProgram,
  listActiveReadyPrograms,
  saveSynthesizedProgramAudio,
  updateProgram,
} from "../program/service";
import { assertTtsReady } from "../tts/config";
import { getTtsSettings, synthesizeWithSiliconFlow } from "../tts/siliconflow";
import {
  SynthesisInProgressError,
  withSynthesisLock,
} from "../tts/synthesis-lock";
import { getSynthesisText, TtsError } from "../tts/validation";
import {
  getAutomaticProgramInput,
  ReplenishmentInProgressError,
  withReplenishmentLock,
} from "./replenishment";

export {
  ReplenishmentInProgressError,
  ScriptGenerationError,
  SynthesisInProgressError,
  TtsError,
};

export type ReplenishmentResult =
  | { result: "inventory_available"; readyProgramIds: string[] }
  | { result: "replenished"; programId: string };

function availableProgramsExcept(programId: string | null, ids: string[]) {
  return programId ? ids.filter((id) => id !== programId) : ids;
}

export async function replenishReceiverInventory(
  playingProgramId: string | null,
): Promise<ReplenishmentResult> {
  return withReplenishmentLock(async () => {
    const active = await listActiveReadyPrograms();
    const readyProgramIds = availableProgramsExcept(
      playingProgramId,
      active.map((program) => program.id),
    );
    if (readyProgramIds.length > 0)
      return { result: "inventory_available", readyProgramIds };

    // 在写入节目记录前先校验两家付费服务的配置，避免配置错误留下失败库存。
    const textSettings = getDeepSeekSettings();
    assertDeepSeekReady(textSettings);
    assertTtsReady(getTtsSettings());

    const playingProgram = playingProgramId
      ? await getProgram(playingProgramId)
      : null;
    const input = getAutomaticProgramInput(
      playingProgram?.format ?? "news",
      playingProgram?.recipe ?? {},
    );

    return withGenerationLock(async () => {
      const created = await createGeneratingProgram({
        ...input,
        model: textSettings.model,
      });
      try {
        const { script, model } = await generateBroadcastScript(input);
        const scripted = await updateProgram(created.id, {
          content: script,
          error: null,
          recipe: { ...created.recipe, text_model: model },
          status: "queued",
          title: script.title,
        });
        if (!scripted) throw new Error("自动补充的节目已不存在。");

        const text = getSynthesisText(scripted);
        return await withSynthesisLock(async () => {
          const synthesizing = await updateProgram(created.id, {
            error: null,
            status: "generating",
          });
          if (!synthesizing) throw new Error("自动补充的节目已不存在。");
          try {
            const speech = await synthesizeWithSiliconFlow(text);
            const saved = await saveSynthesizedProgramAudio(
              created.id,
              speech.audioBytes,
              speech.durationMs,
              {
                model: speech.settings.model,
                provider: speech.settings.provider,
                traceId: speech.traceId,
                voice: speech.settings.voice,
              },
            );
            if (!saved) throw new Error("自动补充的节目已不存在。");
            return { result: "replenished" as const, programId: saved.program.id };
          } catch (error) {
            const message =
              error instanceof Error ? error.message : "自动语音合成发生未知错误。";
            await updateProgram(created.id, { error: message, status: "failed" });
            throw error;
          }
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "自动稿件生成发生未知错误。";
        const latest = await getProgram(created.id);
        if (latest?.status !== "ready")
          await updateProgram(created.id, { error: message, status: "failed" });
        throw error;
      }
    });
  });
}
