import type {
  BroadcastScript,
  BroadcastSegment,
  JsonObject,
  ProgramFormat,
} from "../program/types";
import type { GenerateScriptInput } from "../program/validation";

const minimumScriptCharacters = 120;
const maximumScriptCharacters = 1_800;
const maximumSegments = 12;

export class ScriptGenerationError extends Error {
  readonly kind: "configuration" | "disabled" | "timeout" | "provider" | "output";

  constructor(
    message: string,
    kind: "configuration" | "disabled" | "timeout" | "provider" | "output",
  ) {
    super(message);
    this.kind = kind;
  }
}

function text(value: unknown, field: string, maximumLength: number) {
  if (typeof value !== "string")
    throw new ScriptGenerationError(`${field}必须是字符串。`, "output");
  const result = value.trim();
  if (!result) throw new ScriptGenerationError(`${field}不能为空。`, "output");
  if (result.length > maximumLength)
    throw new ScriptGenerationError(`${field}长度超过限制。`, "output");
  return result;
}

function spokenSegmentText(value: unknown) {
  const result = text(value, "segment.text", 900);
  if (/[()\[\]（）【】]/u.test(result))
    throw new ScriptGenerationError(
      "segment.text 不能包含括号或括号内说明；只保留可直接朗读的正文。",
      "output",
    );
  return result;
}

function object(value: unknown): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new ScriptGenerationError("模型返回的 JSON 根节点必须是对象。", "output");
  return value as JsonObject;
}

function parseSegments(value: unknown, format: ProgramFormat): BroadcastSegment[] {
  const minimumSegments = format === "news" ? 1 : 2;
  if (
    !Array.isArray(value) ||
    value.length < minimumSegments ||
    value.length > maximumSegments
  )
    throw new ScriptGenerationError(
      `${format} 的 segments 必须包含 ${minimumSegments} 到 ${maximumSegments} 个片段。`,
      "output",
    );
  const segments = value.map((segment) => {
    const item = object(segment);
    return {
      speaker: text(item.speaker, "segment.speaker", 40),
      text: spokenSegmentText(item.text),
    };
  });
  if (format === "chat" && new Set(segments.map((segment) => segment.speaker)).size < 2)
    throw new ScriptGenerationError(
      "chat 的 segments 至少需要两位不同的 speaker。",
      "output",
    );
  return segments;
}

function parseSources(value: unknown) {
  if (!Array.isArray(value) || value.length > 10)
    throw new ScriptGenerationError("sources 必须是最多 10 项的数组。", "output");
  return value.map((source) => text(source, "source", 500));
}

export function parseBroadcastScript(
  payload: unknown,
  expected: Pick<GenerateScriptInput, "format" | "language">,
): BroadcastScript {
  let raw = payload;
  if (typeof payload === "string") {
    try {
      raw = JSON.parse(payload) as unknown;
    } catch {
      throw new ScriptGenerationError("模型返回的内容不是合法 JSON。", "output");
    }
  }
  const script = object(raw);
  const format = text(script.format, "format", 20) as ProgramFormat;
  if (format !== expected.format)
    throw new ScriptGenerationError("模型返回的节目形式与请求不一致。", "output");
  const language = text(script.language, "language", 40);
  if (language !== expected.language)
    throw new ScriptGenerationError("模型返回的语言与请求不一致。", "output");
  if (script.fictional !== true)
    throw new ScriptGenerationError("稿件必须明确标记为虚构内容。", "output");
  const segments = parseSegments(script.segments, format);
  const totalCharacters = segments.reduce(
    (total, segment) => total + segment.text.length,
    0,
  );
  if (
    totalCharacters < minimumScriptCharacters ||
    totalCharacters > maximumScriptCharacters
  )
    throw new ScriptGenerationError(
      `稿件正文长度必须介于 ${minimumScriptCharacters} 和 ${maximumScriptCharacters} 个字符之间。`,
      "output",
    );
  return {
    title: text(script.title, "title", 120),
    format,
    language,
    fictional: true,
    segments,
    sources: parseSources(script.sources),
  };
}
