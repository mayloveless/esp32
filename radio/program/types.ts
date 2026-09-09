export const programFormats = [
  { value: "news", label: "新闻" },
  { value: "chat", label: "聊天" },
] as const;

export type ProgramFormat = (typeof programFormats)[number]["value"];
