import "server-only";
import { getSupabaseServerClient } from "../lib/supabase-server";
import type { DeliveryProfileId } from "../renderer/delivery";
import type { RenderMode } from "../renderer/render";
import { buildSynthesisRecipe } from "./synthesis-metadata";
import type { RadioProgram } from "./types";
import type { CreateProgramInput, UpdateProgramInput } from "./validation";

const table = "radio_programs";
const bucket = "radio-audio";
export const audioUrlExpiresInSeconds = 15 * 60;
const extensions = {
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/ogg": "ogg",
  "audio/mp4": "m4a",
  "audio/aac": "aac",
} as const;

type SynthesizedAudioAsset = {
  audioBytes: Uint8Array;
  contentType: "audio/mpeg" | "audio/wav";
  durationMs: number;
  sampleRate: number;
};

type SynthesizedAudioMetadata = {
  alienDialect: string | null;
  audioEffect: string | null;
  captions: unknown[];
  deliveryProfile: DeliveryProfileId | null;
  model: string;
  provider: string;
  renderMode: RenderMode;
  responseFormat: "mp3" | "wav";
  sampleRate: number;
  speakerVoices: Record<string, string>;
  speed: number | null;
  traceIds: Array<string | null>;
};

type LegacySynthesizedAudioMetadata = {
  model: string;
  provider: string;
  traceId: string | null;
  voice: string;
};

function throwIfError(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}

async function cleanupAudioObject(path: string) {
  let lastError: { message: string } | null = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { error } = await getSupabaseServerClient()
      .storage.from(bucket)
      .remove([path]);
    if (!error) return null;
    lastError = error;
  }
  const message = `音频对象清理失败：${lastError?.message ?? "未知错误"}`;
  console.error(message, { path });
  return message;
}

export async function listPrograms(): Promise<RadioProgram[]> {
  const { data, error } = await getSupabaseServerClient()
    .from(table)
    .select("*")
    .order("created_at", { ascending: false });
  throwIfError(error);
  return (data ?? []) as RadioProgram[];
}

export async function getProgram(id: string): Promise<RadioProgram | null> {
  const { data, error } = await getSupabaseServerClient()
    .from(table)
    .select("*")
    .eq("id", id)
    .maybeSingle();
  throwIfError(error);
  return data as RadioProgram | null;
}

export async function listActiveReadyPrograms(): Promise<RadioProgram[]> {
  const { data, error } = await getSupabaseServerClient()
    .from(table)
    .select("*")
    .eq("status", "ready")
    .is("retired_at", null)
    .not("audio_path", "is", null)
    .order("created_at", { ascending: false });
  throwIfError(error);
  return (data ?? []) as RadioProgram[];
}

export async function retireProgram(
  id: string,
): Promise<{ changed: boolean; program: RadioProgram | null }> {
  const current = await getProgram(id);
  if (!current) return { changed: false, program: null };
  if (current.status !== "ready")
    throw new Error("只有资源已就绪的节目可以下线。");
  if (current.retired_at) return { changed: false, program: current };
  const retiredAt = new Date().toISOString();
  const { data, error } = await getSupabaseServerClient()
    .from(table)
    .update({ retired_at: retiredAt, updated_at: retiredAt })
    .eq("id", id)
    .eq("status", "ready")
    .is("retired_at", null)
    .select()
    .maybeSingle();
  throwIfError(error);
  if (data) return { changed: true, program: data as RadioProgram };

  const latest = await getProgram(id);
  if (!latest) return { changed: false, program: null };
  if (latest.status !== "ready")
    throw new Error("只有资源已就绪的节目可以下线。");
  return { changed: false, program: latest };
}

export async function restoreProgram(id: string): Promise<RadioProgram | null> {
  const current = await getProgram(id);
  if (!current) return null;
  if (current.status !== "ready")
    throw new Error("只有资源已就绪的节目可以恢复到播出池。");
  if (!current.retired_at) return current;
  const updatedAt = new Date().toISOString();
  const { data, error } = await getSupabaseServerClient()
    .from(table)
    .update({ retired_at: null, updated_at: updatedAt })
    .eq("id", id)
    .select()
    .single();
  throwIfError(error);
  return data as RadioProgram;
}

export async function createProgram(
  input: CreateProgramInput,
): Promise<RadioProgram> {
  const { data, error } = await getSupabaseServerClient()
    .from(table)
    .insert(input)
    .select()
    .single();
  throwIfError(error);
  return data as RadioProgram;
}

export async function createGeneratingProgram(input: {
  format: "news" | "chat";
  language: string;
  style: string;
  topic: string | null;
  model: string;
}): Promise<RadioProgram> {
  return createProgram({
    status: "generating",
    format: input.format,
    title: "正在生成稿件",
    recipe: {
      format: input.format,
      language: input.language,
      style: input.style,
      topic: input.topic,
      text_provider: "deepseek",
      text_model: input.model,
      fictional: true,
    },
    content: {},
    captions: [],
  });
}

export async function updateProgram(
  id: string,
  input: UpdateProgramInput,
): Promise<RadioProgram | null> {
  const current = await getProgram(id);
  if (!current) return null;
  if (
    current.status === "ready" &&
    Object.keys(input).some((key) => key !== "title")
  ) {
    throw new Error("已完成的节目只能修改标题，不能被普通更新覆盖。");
  }
  if ((input.status ?? current.status) === "ready" && !current.audio_path)
    throw new Error("状态为 ready 的节目必须关联音频文件。");
  const { data, error } = await getSupabaseServerClient()
    .from(table)
    .update({ ...input, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();
  throwIfError(error);
  return data as RadioProgram;
}

export async function uploadProgramAudio(
  id: string,
  file: File,
): Promise<{ program: RadioProgram; cleanupWarning: string | null } | null> {
  const current = await getProgram(id);
  if (!current) return null;
  const extension = extensions[file.type as keyof typeof extensions];
  if (!extension) throw new Error("不支持的音频类型。");
  if (file.size === 0 || file.size > 52_428_800)
    throw new Error("音频大小必须介于 1 字节和 50 MB 之间。");

  const audioBytes = new Uint8Array(await file.arrayBuffer());
  if (!hasExpectedAudioSignature(file.type, audioBytes)) {
    throw new Error("音频内容与声明的文件类型不匹配。");
  }

  const audioPath = `${id}/${crypto.randomUUID()}.${extension}`;
  const client = getSupabaseServerClient();
  const { error: uploadError } = await client.storage
    .from(bucket)
    .upload(audioPath, audioBytes, {
      contentType: file.type,
      upsert: false,
    });
  throwIfError(uploadError);

  const { data, error } = await client
    .from(table)
    .update({ audio_path: audioPath, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();
  if (error) {
    const cleanupWarning = await cleanupAudioObject(audioPath);
    throw new Error(
      cleanupWarning
        ? `数据库未保存新音频，且${cleanupWarning}`
        : `数据库未保存新音频：${error.message}`,
    );
  }
  const cleanupWarning = current.audio_path
    ? await cleanupAudioObject(current.audio_path)
    : null;
  return { program: data as RadioProgram, cleanupWarning };
}

export async function saveSynthesizedProgramAudio(
  id: string,
  asset: SynthesizedAudioAsset,
  tts: SynthesizedAudioMetadata,
): Promise<{ program: RadioProgram; cleanupWarning: string | null } | null>;
export async function saveSynthesizedProgramAudio(
  id: string,
  audioBytes: Uint8Array,
  durationMs: number,
  tts: LegacySynthesizedAudioMetadata,
): Promise<{ program: RadioProgram; cleanupWarning: string | null } | null>;
export async function saveSynthesizedProgramAudio(
  id: string,
  assetOrAudioBytes: SynthesizedAudioAsset | Uint8Array,
  ttsOrDuration: SynthesizedAudioMetadata | number,
  legacyTts?: LegacySynthesizedAudioMetadata,
): Promise<{ program: RadioProgram; cleanupWarning: string | null } | null> {
  const asset: SynthesizedAudioAsset =
    assetOrAudioBytes instanceof Uint8Array
      ? {
          audioBytes: assetOrAudioBytes,
          contentType: "audio/mpeg",
          durationMs: ttsOrDuration as number,
          sampleRate: 32_000,
        }
      : assetOrAudioBytes;
  const tts: SynthesizedAudioMetadata = legacyTts
      ? {
        alienDialect: null,
        audioEffect: null,
        captions: [],
        deliveryProfile: null,
        model: legacyTts.model,
        provider: legacyTts.provider,
        renderMode: "normal",
        responseFormat: "mp3",
        sampleRate: 32_000,
        speakerVoices: { 播音员: legacyTts.voice },
        speed: null,
        traceIds: [legacyTts.traceId],
      }
    : (ttsOrDuration as SynthesizedAudioMetadata);
  const current = await getProgram(id);
  if (!current) return null;
  if (current.status !== "generating" && current.status !== "ready")
    throw new Error("节目当前不处于可保存的语音合成状态。");
  if (!Number.isInteger(asset.durationMs) || asset.durationMs <= 0)
    throw new Error("合成音频时长无效。");
  if (!Number.isInteger(asset.sampleRate) || asset.sampleRate <= 0)
    throw new Error("合成音频采样率无效。");
  const extension = extensions[asset.contentType];
  if (!extension || !hasExpectedAudioSignature(asset.contentType, asset.audioBytes))
    throw new Error("合成音频格式无效。");

  const audioPath = `${id}/${crypto.randomUUID()}.${extension}`;
  const client = getSupabaseServerClient();
  const { error: uploadError } = await client.storage
    .from(bucket)
    .upload(audioPath, asset.audioBytes, {
      contentType: asset.contentType,
      upsert: false,
    });
  throwIfError(uploadError);

  const { data, error } = await client
    .from(table)
    .update({
      audio_path: audioPath,
      captions: tts.captions,
      duration_ms: asset.durationMs,
      status: "ready",
      error: null,
      recipe: buildSynthesisRecipe(current.recipe, {
        alienDialect: tts.alienDialect,
        audioEffect: tts.audioEffect,
        audioContentType: asset.contentType,
        deliveryProfile: tts.deliveryProfile,
        model: tts.model,
        provider: tts.provider,
        renderMode: tts.renderMode,
        responseFormat: tts.responseFormat,
        sampleRate: tts.sampleRate,
        speakerVoices: tts.speakerVoices,
        speed: tts.speed,
        traceIds: tts.traceIds,
      }),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select()
    .single();
  if (error) {
    const cleanupWarning = await cleanupAudioObject(audioPath);
    throw new Error(
      cleanupWarning
        ? `数据库未保存合成音频，且${cleanupWarning}`
        : `数据库未保存合成音频：${error.message}`,
    );
  }
  const cleanupWarning = current.audio_path
    ? await cleanupAudioObject(current.audio_path)
    : null;
  return { program: data as RadioProgram, cleanupWarning };
}

export async function createProgramAudioUrl(program: RadioProgram) {
  if (!program.audio_path) return null;
  const { data, error } = await getSupabaseServerClient()
    .storage.from(bucket)
    .createSignedUrl(program.audio_path, audioUrlExpiresInSeconds);
  throwIfError(error);
  if (!data) throw new Error("Supabase 未返回音频签名 URL。");
  return {
    signedUrl: data.signedUrl,
    expiresAt: new Date(
      Date.now() + audioUrlExpiresInSeconds * 1000,
    ).toISOString(),
  };
}

export async function deleteProgram(
  id: string,
): Promise<{ deleted: boolean; cleanupWarning: string | null }> {
  const current = await getProgram(id);
  if (!current) return { deleted: false, cleanupWarning: null };
  const client = getSupabaseServerClient();
  const { error } = await client.from(table).delete().eq("id", id);
  throwIfError(error);
  return {
    deleted: true,
    cleanupWarning: current.audio_path
      ? await cleanupAudioObject(current.audio_path)
      : null,
  };
}

function hasExpectedAudioSignature(contentType: string, bytes: Uint8Array) {
  if (bytes.length < 12) return false;
  if (contentType === "audio/wav") {
    return textAt(bytes, 0, 4) === "RIFF" && textAt(bytes, 8, 4) === "WAVE";
  }
  if (contentType === "audio/ogg") return textAt(bytes, 0, 4) === "OggS";
  if (contentType === "audio/mp4") return textAt(bytes, 4, 4) === "ftyp";
  if (contentType === "audio/aac")
    return bytes[0] === 0xff && (bytes[1] & 0xf6) === 0xf0;
  return (
    textAt(bytes, 0, 3) === "ID3" ||
    (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)
  );
}

function textAt(bytes: Uint8Array, start: number, length: number) {
  return new TextDecoder().decode(bytes.slice(start, start + length));
}
