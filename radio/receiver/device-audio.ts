import "server-only";
import { createHash } from "node:crypto";
import {
  DeviceAudioCache, maxDeviceAudioBytes, signDeviceAudioUrl,
  type DeviceAudioBytes,
} from "./device-audio-core.ts";
import type { ReceiverTuneResult } from "./manifest-builder-core.ts";

const state = globalThis as typeof globalThis & { radioDeviceAudioCache?: DeviceAudioCache };
export const deviceAudioCache = state.radioDeviceAudioCache ??= new DeviceAudioCache();

export async function readDeviceAudioBytes(url: string): Promise<DeviceAudioBytes> {
  const source = new URL(url);
  const storage = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");
  if (source.origin !== storage.origin || !source.pathname.startsWith("/storage/v1/object/sign/radio-audio/"))
    throw new Error("Device audio source is invalid");
  const response = await fetch(source, { signal: AbortSignal.timeout(30_000), redirect: "error", cache: "no-store" });
  if (!response.ok || !response.body) throw new Error("Device audio download failed");
  const declared = response.headers.get("content-length");
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > maxDeviceAudioBytes)) {
    await response.body.cancel(); throw new Error("Device audio exceeds cache limit");
  }
  const reader = response.body.getReader();
  const blocks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const chunk = await reader.read(); if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > maxDeviceAudioBytes) throw new Error("Device audio exceeds cache limit");
      blocks.push(chunk.value);
    }
  } catch (error) { await reader.cancel(); throw error; }
  finally { reader.releaseLock(); }
  if (!size || (declared && size !== Number(declared))) throw new Error("Device audio download incomplete");
  const bytes = new Uint8Array(size); let offset = 0;
  for (const block of blocks) { bytes.set(block, offset); offset += block.length; }
  return bytes;
}

/** Optional local development delivery. Original WAV/MP3, timeline and inventory stay intact. */
export async function withLocalDeviceAudio(result: ReceiverTuneResult): Promise<ReceiverTuneResult> {
  if (process.env.RADIO_DEVICE_AUDIO_TRANSPORT !== "local-cache" || result.result !== "signal") return result;
  const { manifest } = result;
  const source = new URL(manifest.audioUrl);
  const extension = /\.(wav|mp3)$/i.exec(source.pathname)?.[1].toLowerCase();
  if (!extension) return result;
  const origin = process.env.RADIO_DEVICE_AUDIO_ORIGIN;
  const secret = process.env.DEVICE_API_TOKEN;
  if (!origin || !secret) throw new Error("Local device audio delivery is not configured");
  const revision = createHash("sha256").update(source.pathname).digest("hex").slice(0, 16);
  const filename = `${manifest.programId}.${revision}.${extension}`;
  // Validate configuration before fetching private audio.
  signDeviceAudioUrl(origin, filename, secret);
  await deviceAudioCache.load(filename, () => readDeviceAudioBytes(manifest.audioUrl));
  // Start expiry after the cache fill; never shorten the playable window by download time.
  const ready = signDeviceAudioUrl(origin, filename, secret);
  return { ...result, manifest: { ...manifest, audioUrl: ready.signedUrl, audioExpiresAt: ready.expiresAt } };
}
