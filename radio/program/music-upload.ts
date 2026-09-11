import { parsePcmWav } from "../renderer/wav.ts";
import { readMp3Duration } from "../tts/validation.ts";

const maximumMusicFileBytes = 52_428_800;

const musicContentTypes = {
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
} as const;

export type ManualMusicUpload = {
  audioBytes: Uint8Array;
  contentType: keyof typeof musicContentTypes;
  description: string | null;
  durationMs: number;
  extension: (typeof musicContentTypes)[keyof typeof musicContentTypes];
  style: string | null;
  title: string;
};

function parseText(
  formData: FormData,
  field: string,
  maximumLength: number,
  optional = false,
) {
  const value = formData.get(field);
  if (value === null && optional) return null;
  if (typeof value !== "string") throw new Error(`${field}必须是文本。`);
  const text = value.trim();
  if (!text && !optional) throw new Error(`${field}不能为空。`);
  if (text.length > maximumLength)
    throw new Error(`${field}长度不能超过 ${maximumLength} 个字符。`);
  return text || null;
}

function hasExpectedMusicSignature(contentType: string, audioBytes: Uint8Array) {
  if (audioBytes.length < 12) return false;
  if (contentType === "audio/wav")
    return (
      textAt(audioBytes, 0, 4) === "RIFF" &&
      textAt(audioBytes, 8, 4) === "WAVE"
    );
  return (
    textAt(audioBytes, 0, 3) === "ID3" ||
    (audioBytes[0] === 0xff && (audioBytes[1] & 0xe0) === 0xe0)
  );
}

function readMusicDuration(
  contentType: keyof typeof musicContentTypes,
  audioBytes: Uint8Array,
) {
  try {
    const durationMs =
      contentType === "audio/wav"
        ? Math.round(parsePcmWav(audioBytes).durationMs)
        : readMp3Duration(audioBytes);
    if (!Number.isSafeInteger(durationMs) || durationMs <= 0)
      throw new Error("时长无效");
    return durationMs;
  } catch {
    throw new Error("无法读取音频真实时长。请上传有效的 MP3 或 PCM WAV 文件。");
  }
}

function textAt(bytes: Uint8Array, start: number, length: number) {
  return new TextDecoder().decode(bytes.slice(start, start + length));
}

/** 解析并验证仅供 music 节目使用的本地音频上传。 */
export async function parseManualMusicUpload(
  formData: FormData,
): Promise<ManualMusicUpload> {
  const title = parseText(formData, "title", 200) ?? "";
  const description = parseText(formData, "description", 1_000, true);
  const style = parseText(formData, "style", 120, true);
  const audio = formData.get("audio");
  if (!(audio instanceof File)) throw new Error("audio 必须是文件。");
  if (!(audio.type in musicContentTypes))
    throw new Error("音乐只支持 audio/mpeg 的 MP3 或 audio/wav 的 WAV 文件。");
  if (audio.size === 0 || audio.size > maximumMusicFileBytes)
    throw new Error("音乐文件大小必须介于 1 字节和 50 MB 之间。");

  const contentType = audio.type as keyof typeof musicContentTypes;
  const audioBytes = new Uint8Array(await audio.arrayBuffer());
  if (!hasExpectedMusicSignature(contentType, audioBytes))
    throw new Error("音频内容与声明的 MIME 类型不匹配。");

  return {
    audioBytes,
    contentType,
    description,
    durationMs: readMusicDuration(contentType, audioBytes),
    extension: musicContentTypes[contentType],
    style,
    title,
  };
}
