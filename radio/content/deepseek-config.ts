import { ScriptGenerationError } from "./script-validation.ts";

export function assertDeepSeekReady(settings: {
  apiKey: string | null;
  enabled: boolean;
}) {
  if (!settings.enabled)
    throw new ScriptGenerationError("DeepSeek 实际调用当前未启用。", "disabled");
  if (!settings.apiKey)
    throw new ScriptGenerationError("未配置 DEEPSEEK_API_KEY。", "configuration");
  return settings.apiKey;
}
