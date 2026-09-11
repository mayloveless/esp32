import type { JsonObject, RadioProgram } from "./types.ts";

export type ReadyMusicAsset = {
  audioBytes: Uint8Array;
  contentType: "audio/mpeg" | "audio/wav";
  durationMs: number;
  extension: "mp3" | "wav";
};

export type ReadyMusicProgramInput = ReadyMusicAsset & {
  recipe: JsonObject;
  title: string;
};

type ReadyMusicRecord = {
  audio_path: string;
  captions: [];
  content: JsonObject;
  duration_ms: number;
  error: null;
  format: "music";
  id: string;
  recipe: JsonObject;
  retired_at: null;
  status: "ready";
  title: string;
};

export type ReadyMusicPersistence = {
  insert: (
    record: ReadyMusicRecord,
  ) => Promise<{ data: RadioProgram | null; error: { message: string } | null }>;
  remove: (path: string) => Promise<{ message: string } | null>;
  upload: (
    path: string,
    audioBytes: Uint8Array,
    contentType: ReadyMusicAsset["contentType"],
  ) => Promise<{ message: string } | null>;
};

async function cleanupNewMusicObject(
  path: string,
  persistence: ReadyMusicPersistence,
) {
  let lastError: { message: string } | null = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const error = await persistence.remove(path);
    if (!error) return null;
    lastError = error;
  }
  return `音频对象清理失败：${lastError?.message ?? "未知错误"}`;
}

/**
 * 将已经验证的音乐资产创建为 ready Program。上传成功而数据库写入失败时会清理新对象。
 */
export async function persistReadyMusicProgram(
  input: ReadyMusicProgramInput,
  persistence: ReadyMusicPersistence,
  createId: () => string = () => crypto.randomUUID(),
): Promise<{ program: RadioProgram; cleanupWarning: string | null }> {
  const id = createId();
  const audioPath = `${id}/${createId()}.${input.extension}`;
  const uploadError = await persistence.upload(
    audioPath,
    input.audioBytes,
    input.contentType,
  );
  if (uploadError) throw new Error(uploadError.message);

  const { data, error } = await persistence.insert({
    audio_path: audioPath,
    captions: [],
    content: {},
    duration_ms: input.durationMs,
    error: null,
    format: "music",
    id,
    recipe: input.recipe,
    retired_at: null,
    status: "ready",
    title: input.title,
  });
  if (error) {
    const cleanupWarning = await cleanupNewMusicObject(audioPath, persistence);
    throw new Error(
      cleanupWarning
        ? `数据库未保存音乐节目，且${cleanupWarning}`
        : `数据库未保存音乐节目：${error.message}`,
    );
  }
  if (!data) throw new Error("数据库未返回已创建的音乐节目。");
  return { program: data, cleanupWarning: null };
}
