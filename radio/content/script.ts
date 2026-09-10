import "server-only";
import type { BroadcastScript } from "../program/types";
import type { GenerateScriptInput } from "../program/validation";
import { assertDeepSeekReady } from "./deepseek-config";
import { requestDeepSeekScript } from "./deepseek-transport";
import {
  parseBroadcastScript,
  ScriptGenerationError,
} from "./script-validation";

export { ScriptGenerationError } from "./script-validation";

export type DeepSeekSettings = {
  apiKey: string | null;
  baseUrl: string;
  enabled: boolean;
  model: string;
};
export function getDeepSeekSettings(): DeepSeekSettings {
  const configuredBaseUrl = process.env.DEEPSEEK_BASE_URL?.trim();
  const baseUrl = (configuredBaseUrl || "https://api.deepseek.com").replace(/\/$/, "");
  let origin: string;
  try {
    origin = new URL(baseUrl).origin;
  } catch {
    throw new ScriptGenerationError("DEEPSEEK_BASE_URL 不是有效 URL。", "configuration");
  }
  if (origin !== "https://api.deepseek.com")
    throw new ScriptGenerationError(
      "DEEPSEEK_BASE_URL 必须是官方地址 https://api.deepseek.com。",
      "configuration",
    );
  return {
    apiKey: process.env.DEEPSEEK_API_KEY?.trim() || null,
    baseUrl,
    enabled: process.env.DEEPSEEK_ENABLED === "true",
    model:
      process.env.DEEPSEEK_TEXT_MODEL?.trim() ||
      process.env.OPENAI_TEXT_MODEL?.trim() ||
      "deepseek-v4-flash",
  };
}

export async function generateBroadcastScript(
  input: GenerateScriptInput,
): Promise<{ script: BroadcastScript; model: string }> {
  const settings = getDeepSeekSettings();
  const apiKey = assertDeepSeekReady(settings);

  const content = await requestDeepSeekScript({
    apiKey,
    baseUrl: settings.baseUrl,
    model: settings.model,
    input,
  });
  return { script: parseBroadcastScript(content, input), model: settings.model };
}
