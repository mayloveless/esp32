export const programFormats = [
  { value: "news", label: "新闻" },
  { value: "chat", label: "聊天" },
] as const;

export type ProgramFormat = (typeof programFormats)[number]["value"];

export const programStatuses = [
  "queued",
  "generating",
  "ready",
  "failed",
] as const;
export type ProgramStatus = (typeof programStatuses)[number];
export type JsonObject = Record<string, unknown>;

export type BroadcastSegment = {
  speaker: string;
  text: string;
};

export type BroadcastScript = {
  title: string;
  format: ProgramFormat;
  language: string;
  fictional: true;
  segments: BroadcastSegment[];
  sources: string[];
};

export type RadioProgram = {
  id: string;
  status: ProgramStatus;
  format: ProgramFormat | "music";
  title: string;
  recipe: JsonObject;
  content: JsonObject;
  captions: unknown[];
  audio_path: string | null;
  duration_ms: number | null;
  error: string | null;
  created_at: string;
  updated_at: string;
};
