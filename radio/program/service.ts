import "server-only";
import { getSupabaseServerClient } from "../lib/supabase-server";
import type { RadioProgram } from "./types";
import type { CreateProgramInput, UpdateProgramInput } from "./validation";

const table = "radio_programs";
const bucket = "radio-audio";
const extensions = { "audio/mpeg": "mp3", "audio/wav": "wav", "audio/ogg": "ogg", "audio/mp4": "m4a", "audio/aac": "aac" } as const;

function throwIfError(error: { message: string } | null) { if (error) throw new Error(error.message); }

export async function listPrograms(): Promise<RadioProgram[]> {
  const { data, error } = await getSupabaseServerClient().from(table).select("*").order("created_at", { ascending: false });
  throwIfError(error);
  return (data ?? []) as RadioProgram[];
}

export async function getProgram(id: string): Promise<RadioProgram | null> {
  const { data, error } = await getSupabaseServerClient().from(table).select("*").eq("id", id).maybeSingle();
  throwIfError(error);
  return data as RadioProgram | null;
}

export async function createProgram(input: CreateProgramInput): Promise<RadioProgram> {
  const { data, error } = await getSupabaseServerClient().from(table).insert(input).select().single();
  throwIfError(error);
  return data as RadioProgram;
}

export async function updateProgram(id: string, input: UpdateProgramInput): Promise<RadioProgram | null> {
  const current = await getProgram(id);
  if (!current) return null;
  if ((input.status ?? current.status) === "ready" && !current.audio_path) throw new Error("A ready program requires an audio file.");
  const { data, error } = await getSupabaseServerClient().from(table).update({ ...input, updated_at: new Date().toISOString() }).eq("id", id).select().single();
  throwIfError(error);
  return data as RadioProgram;
}

export async function uploadProgramAudio(id: string, file: File): Promise<RadioProgram | null> {
  const current = await getProgram(id);
  if (!current) return null;
  const extension = extensions[file.type as keyof typeof extensions];
  if (!extension) throw new Error("Unsupported audio type.");
  if (file.size === 0 || file.size > 52_428_800) throw new Error("Audio must be between 1 byte and 50 MB.");

  const audioPath = `${id}/${crypto.randomUUID()}.${extension}`;
  const client = getSupabaseServerClient();
  const { error: uploadError } = await client.storage.from(bucket).upload(audioPath, new Uint8Array(await file.arrayBuffer()), { contentType: file.type, upsert: false });
  throwIfError(uploadError);

  const { data, error } = await client.from(table).update({ audio_path: audioPath, updated_at: new Date().toISOString() }).eq("id", id).select().single();
  if (error) {
    await client.storage.from(bucket).remove([audioPath]);
    throwIfError(error);
  }
  if (current.audio_path) await client.storage.from(bucket).remove([current.audio_path]);
  return data as RadioProgram;
}

export async function createProgramAudioUrl(program: RadioProgram) {
  if (!program.audio_path) return null;
  const { data, error } = await getSupabaseServerClient().storage.from(bucket).createSignedUrl(program.audio_path, 60);
  throwIfError(error);
  if (!data) throw new Error("Supabase did not return a signed audio URL.");
  return data.signedUrl;
}

export async function deleteProgram(id: string): Promise<boolean> {
  const current = await getProgram(id);
  if (!current) return false;
  const client = getSupabaseServerClient();
  if (current.audio_path) { const { error } = await client.storage.from(bucket).remove([current.audio_path]); throwIfError(error); }
  const { error } = await client.from(table).delete().eq("id", id);
  throwIfError(error);
  return true;
}
