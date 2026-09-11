import "server-only";
import { assertTtsReady, type TtsSettings } from "./config";
import {
  requestSiliconFlowSpeech,
  type TtsResponseFormat,
} from "./siliconflow-transport";

export type SingleSpeechRequest = {
  responseFormat: TtsResponseFormat;
  sampleRate: number;
  text: string;
  voice: string;
};

export function getTtsSettings(): TtsSettings {
  return {
    apiKey: process.env.TTS_API_KEY?.trim() || null,
    baseUrl: process.env.TTS_BASE_URL?.trim() || "https://api.siliconflow.cn/v1",
    enabled: process.env.TTS_ENABLED === "true",
    model: process.env.TTS_MODEL?.trim() || "FunAudioLLM/CosyVoice2-0.5B",
    primaryVoice:
      process.env.TTS_VOICE_PRIMARY?.trim() ||
      process.env.TTS_VOICE?.trim() ||
      "FunAudioLLM/CosyVoice2-0.5B:alex",
    provider: process.env.TTS_PROVIDER?.trim() || "siliconflow",
    secondaryVoice:
      process.env.TTS_VOICE_SECONDARY?.trim() ||
      "FunAudioLLM/CosyVoice2-0.5B:anna",
  };
}

export async function synthesizeWithSiliconFlow(
  request: SingleSpeechRequest | string,
) {
  const settings = getTtsSettings();
  const apiKey = assertTtsReady(settings);
  const singleRequest: SingleSpeechRequest =
    typeof request === "string"
      ? {
          responseFormat: "mp3",
          sampleRate: 32_000,
          text: request,
          voice: settings.primaryVoice,
        }
      : request;
  const result = await requestSiliconFlowSpeech({
    apiKey,
    baseUrl: settings.baseUrl,
    model: settings.model,
    ...singleRequest,
  });
  return { ...result, settings };
}
