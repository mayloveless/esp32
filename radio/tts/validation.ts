import type { JsonObject, ProgramFormat } from "../program/types";

export const maximumTtsInputCharacters = 3_000;

export class TtsError extends Error {
  readonly kind:
    | "configuration"
    | "disabled"
    | "provider"
    | "timeout"
    | "audio"
    | "input";

  constructor(
    message: string,
    kind:
      | "configuration"
      | "disabled"
      | "provider"
      | "timeout"
      | "audio"
      | "input",
  ) {
    super(message);
    this.kind = kind;
  }
}

type ProgramForSynthesis = {
  content: JsonObject;
  format: ProgramFormat | "music";
};

export type SynthesisSegment = {
  speaker: string;
  text: string;
};

export function getSynthesisSegments(
  program: ProgramForSynthesis,
): SynthesisSegment[] {
  if (program.format !== "news" && program.format !== "chat")
    throw new TtsError("只有新闻或聊天节目可以合成语音。", "input");
  const segments = program.content.segments;
  if (!Array.isArray(segments) || segments.length === 0)
    throw new TtsError("节目没有可合成的已保存稿件。", "input");
  const parsed = segments.map((segment) => {
    if (typeof segment !== "object" || segment === null)
      throw new TtsError("稿件片段格式无效。", "input");
    const { speaker, text } = segment as { speaker?: unknown; text?: unknown };
    if (typeof speaker !== "string" || !speaker.trim())
      throw new TtsError("稿件片段缺少说话者。", "input");
    if (typeof text !== "string" || !text.trim())
      throw new TtsError("稿件片段缺少可播报文字。", "input");
    return { speaker: speaker.trim(), text: text.trim() };
  });
  const length = parsed.reduce((total, segment) => total + segment.text.length, 0);
  if (length > maximumTtsInputCharacters)
    throw new TtsError(
      `单次语音合成稿件不能超过 ${maximumTtsInputCharacters} 个字符。`,
      "input",
    );
  return parsed;
}

export function getSynthesisText(program: ProgramForSynthesis) {
  return getSynthesisSegments(program)
    .map((segment) => segment.text)
    .join("\n");
}

const bitrateByVersionAndLayer: Record<string, number[]> = {
  "1-3": [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  "2-3": [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};
const sampleRates = {
  1: [44_100, 48_000, 32_000],
  2: [22_050, 24_000, 16_000],
  "2.5": [11_025, 12_000, 8_000],
} as const;

function readFrame(bytes: Uint8Array, offset: number) {
  if (
    offset + 4 > bytes.length ||
    bytes[offset] !== 0xff ||
    (bytes[offset + 1] & 0xe0) !== 0xe0
  )
    return null;
  const versionBits = (bytes[offset + 1] >> 3) & 0x03;
  const layerBits = (bytes[offset + 1] >> 1) & 0x03;
  const bitrateIndex = (bytes[offset + 2] >> 4) & 0x0f;
  const sampleRateIndex = (bytes[offset + 2] >> 2) & 0x03;
  const padding = (bytes[offset + 2] >> 1) & 0x01;
  const version =
    versionBits === 3 ? 1 : versionBits === 2 ? 2 : versionBits === 0 ? 2.5 : null;
  if (
    !version ||
    layerBits !== 1 ||
    bitrateIndex === 0 ||
    bitrateIndex === 15 ||
    sampleRateIndex === 3
  )
    return null;
  const bitrate = bitrateByVersionAndLayer[`${version === 1 ? 1 : 2}-3`][bitrateIndex];
  const sampleRate = sampleRates[version][sampleRateIndex];
  if (!bitrate || !sampleRate) return null;
  const samples = version === 1 ? 1_152 : 576;
  const length =
    Math.floor(((version === 1 ? 144_000 : 72_000) * bitrate) / sampleRate) +
    padding;
  return length > 4 ? { length, samples, sampleRate } : null;
}

export function readMp3Duration(bytes: Uint8Array) {
  let offset = 0;
  if (
    bytes.length >= 10 &&
    new TextDecoder().decode(bytes.slice(0, 3)) === "ID3"
  ) {
    const size =
      ((bytes[6] & 0x7f) << 21) |
      ((bytes[7] & 0x7f) << 14) |
      ((bytes[8] & 0x7f) << 7) |
      (bytes[9] & 0x7f);
    offset = 10 + size;
  }
  let totalMilliseconds = 0;
  let frames = 0;
  while (offset < bytes.length) {
    const frame = readFrame(bytes, offset);
    if (!frame || offset + frame.length > bytes.length) break;
    totalMilliseconds += (frame.samples / frame.sampleRate) * 1_000;
    frames += 1;
    offset += frame.length;
  }
  if (frames === 0 || totalMilliseconds < 1)
    throw new TtsError("硅基流动返回的不是可解析的 MP3 音频。", "audio");
  return Math.round(totalMilliseconds);
}
