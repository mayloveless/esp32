import {
  programStatuses,
  type JsonObject,
  type ProgramFormat,
  type ProgramStatus,
} from "./types";

const formats = new Set<ProgramFormat | "music">(["news", "chat", "music"]);
const statuses = new Set<ProgramStatus>(programStatuses);

export type CreateProgramInput = {
  format: ProgramFormat | "music";
  title: string;
  recipe: JsonObject;
  content: JsonObject;
  captions: unknown[];
};
export type UpdateProgramInput = Partial<{
  status: ProgramStatus;
  title: string;
  recipe: JsonObject;
  content: JsonObject;
  captions: unknown[];
  duration_ms: number | null;
  error: string | null;
}>;

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function parseTitle(value: unknown, fallback: string) {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || value.length > 200)
    throw new Error("节目标题必须是长度不超过 200 的字符串。");
  return value;
}

export function parseCreateProgram(value: unknown): CreateProgramInput {
  if (
    !isJsonObject(value) ||
    !formats.has(value.format as ProgramFormat | "music")
  )
    throw new Error("节目形式必须是 news、chat 或 music。");
  const recipe = value.recipe ?? {};
  const content = value.content ?? {};
  const captions = value.captions ?? [];
  if (
    !isJsonObject(recipe) ||
    !isJsonObject(content) ||
    !Array.isArray(captions)
  )
    throw new Error("recipe 和 content 必须是对象，captions 必须是数组。");
  return {
    format: value.format as ProgramFormat | "music",
    title: parseTitle(value.title, ""),
    recipe,
    content,
    captions,
  };
}

export function parseUpdateProgram(value: unknown): UpdateProgramInput {
  if (!isJsonObject(value)) throw new Error("请求体必须是对象。");
  const update: UpdateProgramInput = {};
  if (value.status !== undefined) {
    if (
      typeof value.status !== "string" ||
      !statuses.has(value.status as ProgramStatus)
    )
      throw new Error("节目状态无效。");
    update.status = value.status as ProgramStatus;
  }
  if (value.title !== undefined) update.title = parseTitle(value.title, "");
  for (const key of ["recipe", "content"] as const) {
    if (value[key] !== undefined) {
      if (!isJsonObject(value[key]))
        throw new Error(`字段 ${key} 必须是对象。`);
      update[key] = value[key];
    }
  }
  if (value.captions !== undefined) {
    if (!Array.isArray(value.captions))
      throw new Error("captions 必须是数组。");
    update.captions = value.captions;
  }
  if (value.duration_ms !== undefined) {
    if (value.duration_ms === null) update.duration_ms = null;
    else if (
      typeof value.duration_ms === "number" &&
      Number.isInteger(value.duration_ms) &&
      value.duration_ms >= 0
    )
      update.duration_ms = value.duration_ms;
    else throw new Error("duration_ms 必须是非负整数或 null。");
  }
  if (value.error !== undefined) {
    if (
      value.error !== null &&
      (typeof value.error !== "string" || value.error.length > 2000)
    )
      throw new Error("error 必须是 null 或长度不超过 2000 的字符串。");
    update.error = value.error;
  }
  return update;
}
