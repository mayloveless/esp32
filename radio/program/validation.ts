import { programStatuses, type JsonObject, type ProgramFormat, type ProgramStatus } from "./types";

const formats = new Set<ProgramFormat | "music">(["news", "chat", "music"]);
const statuses = new Set<ProgramStatus>(programStatuses);

export type CreateProgramInput = { format: ProgramFormat | "music"; title: string; recipe: JsonObject; content: JsonObject; captions: unknown[] };
export type UpdateProgramInput = Partial<{ status: ProgramStatus; title: string; recipe: JsonObject; content: JsonObject; captions: unknown[]; duration_ms: number | null; error: string | null }>;

function isJsonObject(value: unknown): value is JsonObject { return typeof value === "object" && value !== null && !Array.isArray(value); }
function parseTitle(value: unknown, fallback: string) {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || value.length > 200) throw new Error("title must be a string up to 200 characters.");
  return value;
}

export function parseCreateProgram(value: unknown): CreateProgramInput {
  if (!isJsonObject(value) || !formats.has(value.format as ProgramFormat | "music")) throw new Error("format must be news, chat, or music.");
  const recipe = value.recipe ?? {}; const content = value.content ?? {}; const captions = value.captions ?? [];
  if (!isJsonObject(recipe) || !isJsonObject(content) || !Array.isArray(captions)) throw new Error("recipe and content must be objects; captions must be an array.");
  return { format: value.format as ProgramFormat | "music", title: parseTitle(value.title, ""), recipe, content, captions };
}

export function parseUpdateProgram(value: unknown): UpdateProgramInput {
  if (!isJsonObject(value)) throw new Error("Request body must be an object.");
  const update: UpdateProgramInput = {};
  if (value.status !== undefined) { if (typeof value.status !== "string" || !statuses.has(value.status as ProgramStatus)) throw new Error("Invalid program status."); update.status = value.status as ProgramStatus; }
  if (value.title !== undefined) update.title = parseTitle(value.title, "");
  for (const key of ["recipe", "content"] as const) { if (value[key] !== undefined) { if (!isJsonObject(value[key])) throw new Error(`${key} must be an object.`); update[key] = value[key]; } }
  if (value.captions !== undefined) { if (!Array.isArray(value.captions)) throw new Error("captions must be an array."); update.captions = value.captions; }
  if (value.duration_ms !== undefined) {
    if (value.duration_ms === null) update.duration_ms = null;
    else if (typeof value.duration_ms === "number" && Number.isInteger(value.duration_ms) && value.duration_ms >= 0) update.duration_ms = value.duration_ms;
    else throw new Error("duration_ms must be a non-negative integer or null.");
  }
  if (value.error !== undefined) { if (value.error !== null && (typeof value.error !== "string" || value.error.length > 2000)) throw new Error("error must be null or a string up to 2000 characters."); update.error = value.error; }
  return update;
}
