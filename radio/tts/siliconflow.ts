import "server-only";
import { assertTtsReady, type TtsSettings } from "./config";
import { requestSiliconFlowSpeech } from "./siliconflow-transport";

export function getTtsSettings(): TtsSettings {
  return {
    apiKey: process.env.TTS_API_KEY?.trim() || null,
    baseUrl: process.env.TTS_BASE_URL?.trim() || "https://api.siliconflow.cn/v1",
    enabled: process.env.TTS_ENABLED === "true",
    model: process.env.TTS_MODEL?.trim() || "FunAudioLLM/CosyVoice2-0.5B",
    provider: process.env.TTS_PROVIDER?.trim() || "siliconflow",
    voice:
      process.env.TTS_VOICE?.trim() || "FunAudioLLM/CosyVoice2-0.5B:alex",
  };
}

export async function synthesizeWithSiliconFlow(text: string) {
  const settings = getTtsSettings();
  const apiKey = assertTtsReady(settings);
  const result = await requestSiliconFlowSpeech({
    apiKey,
    baseUrl: settings.baseUrl,
    model: settings.model,
    text,
    voice: settings.voice,
  });
  return { ...result, settings };
}
