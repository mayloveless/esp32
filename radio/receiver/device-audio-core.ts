import { createHmac, timingSafeEqual } from "node:crypto";

export const deviceAudioLifetimeSeconds = 15 * 60;
export const maxDeviceAudioBytes = 32 * 1024 * 1024;
const filenamePattern = /^[a-f0-9-]{36}\.[a-f0-9]{16}\.(wav|mp3)$/;

function signature(filename: string, expires: number, secret: string) {
  return createHmac("sha256", secret)
    .update(`radio-device-audio-v1\n${filename}\n${expires}`)
    .digest("hex");
}

export function signDeviceAudioUrl(origin: string, filename: string, secret: string, now = Date.now()) {
  if (!secret || !filenamePattern.test(filename)) throw new Error("Invalid device audio signing configuration");
  const base = new URL(origin);
  if (!/^https?:$/.test(base.protocol) || base.username || base.password || base.search || base.hash || base.pathname !== "/")
    throw new Error("Invalid device audio origin");
  const expires = Math.floor(now / 1000) + deviceAudioLifetimeSeconds;
  const url = new URL(`/api/device/audio/${filename}`, base);
  url.searchParams.set("expires", String(expires));
  url.searchParams.set("signature", signature(filename, expires, secret));
  return { signedUrl: url.toString(), expiresAt: new Date(expires * 1000).toISOString() };
}

export function verifyDeviceAudioUrl(filename: string, url: URL, secret: string | undefined, now = Date.now()) {
  const expiry = url.searchParams.getAll("expires");
  const signatures = url.searchParams.getAll("signature");
  if (!secret || !filenamePattern.test(filename) || expiry.length !== 1 || signatures.length !== 1 || !/^\d{1,12}$/.test(expiry[0]) || !/^[a-f0-9]{64}$/.test(signatures[0])) return false;
  const expires = Number(expiry[0]);
  const seconds = Math.floor(now / 1000);
  if (expires <= seconds || expires > seconds + deviceAudioLifetimeSeconds) return false;
  return timingSafeEqual(Buffer.from(signatures[0], "hex"), Buffer.from(signature(filename, expires, secret), "hex"));
}

export function parseDeviceAudioRange(value: string | null, size: number) {
  if (!Number.isSafeInteger(size) || size <= 0) return null;
  if (!value) return { start: 0, end: size - 1, partial: false };
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2])) return null;
  let start: number, end: number;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return null;
    start = Math.max(0, size - suffix); end = size - 1;
  } else {
    start = Number(match[1]); end = match[2] ? Number(match[2]) : size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start) return null;
    end = Math.min(end, size - 1);
  }
  return { start, end, partial: true };
}

export type DeviceAudioBytes = Uint8Array<ArrayBuffer>;

/** A complete immutable object is cached before its URL is handed to a device. */
export class DeviceAudioCache {
  private entries = new Map<string, DeviceAudioBytes>();
  private pending = new Map<string, Promise<DeviceAudioBytes>>();
  private usedBytes = 0;
  private capacity: number;
  constructor(capacity = 64 * 1024 * 1024) { this.capacity = capacity; }
  get(filename: string) {
    const bytes = this.entries.get(filename);
    if (bytes) { this.entries.delete(filename); this.entries.set(filename, bytes); }
    return bytes;
  }
  async load(filename: string, loader: () => Promise<DeviceAudioBytes>) {
    const existing = this.get(filename);
    if (existing) return existing;
    const pending = this.pending.get(filename);
    if (pending) return pending;
    if (this.pending.size >= 2) throw new Error("Device audio cache is busy");
    const task = Promise.resolve().then(loader).then(bytes => {
      if (!bytes.length || bytes.length > maxDeviceAudioBytes || bytes.length > this.capacity) throw new Error("Device audio exceeds cache limit");
      while (this.usedBytes + bytes.length > this.capacity) {
        const first = this.entries.keys().next().value;
        if (!first) break;
        this.usedBytes -= this.entries.get(first)!.length; this.entries.delete(first);
      }
      this.entries.set(filename, bytes); this.usedBytes += bytes.length;
      return bytes;
    }).finally(() => this.pending.delete(filename));
    this.pending.set(filename, task);
    return task;
  }
}
