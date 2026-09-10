import type { JsonObject, ProgramFormat } from "../program/types.ts";
import type { GenerateScriptInput } from "../program/validation.ts";

const defaultInput: GenerateScriptInput = {
  format: "news",
  language: "中文",
  style: "冷静、略带未知感",
  topic: null,
};

export class ReplenishmentInProgressError extends Error {
  constructor() {
    super("已有接收机库存补充任务正在执行。");
  }
}

let replenishing = false;

function recipeText(recipe: JsonObject, key: "language" | "style") {
  const value = recipe[key];
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text) return null;
  const maximumLength = key === "language" ? 40 : 120;
  return text.length <= maximumLength ? text : null;
}

export function getAutomaticProgramInput(
  format: ProgramFormat | "music",
  recipe: JsonObject,
): GenerateScriptInput {
  return {
    format: format === "chat" ? "chat" : defaultInput.format,
    language: recipeText(recipe, "language") ?? defaultInput.language,
    style: recipeText(recipe, "style") ?? defaultInput.style,
    topic: null,
  };
}

export async function withReplenishmentLock<T>(operation: () => Promise<T>) {
  if (replenishing) throw new ReplenishmentInProgressError();
  replenishing = true;
  try {
    return await operation();
  } finally {
    replenishing = false;
  }
}
