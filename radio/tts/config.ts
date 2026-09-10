import { TtsError } from "./validation.ts";

const model = "FunAudioLLM/CosyVoice2-0.5B";
const builtInVoices = new Set([
  "alex",
  "benjamin",
  "charles",
  "david",
  "anna",
  "bella",
  "claire",
  "diana",
]);

export type TtsSettings = {
  apiKey: string | null;
  baseUrl: string;
  enabled: boolean;
  model: string;
  provider: string;
  voice: string;
};

export function assertTtsReady(settings: TtsSettings) {
  if (settings.provider !== "siliconflow")
    throw new TtsError("当前仅支持 siliconflow 作为 TTS_PROVIDER。", "configuration");
  if (!settings.enabled)
    throw new TtsError("TTS 实际调用当前未启用。", "disabled");
  if (!settings.apiKey)
    throw new TtsError("未配置 TTS_API_KEY。", "configuration");
  if (settings.model !== model)
    throw new TtsError(`当前仅支持 ${model}。`, "configuration");
  if (
    !builtInVoices.has(settings.voice.replace(`${model}:`, "")) ||
    !settings.voice.startsWith(`${model}:`)
  )
    throw new TtsError("TTS_VOICE 必须是 CosyVoice2 的内置音色。", "configuration");
  let url: URL;
  try {
    url = new URL(settings.baseUrl);
  } catch {
    throw new TtsError("TTS_BASE_URL 不是有效 URL。", "configuration");
  }
  if (
    url.origin !== "https://api.siliconflow.cn" ||
    !url.pathname.startsWith("/v1")
  )
    throw new TtsError("TTS_BASE_URL 必须是硅基流动官方 v1 地址。", "configuration");
  return settings.apiKey;
}
