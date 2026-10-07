import { deviceAudioCache } from "../../../../../receiver/device-audio";
import { parseDeviceAudioRange, verifyDeviceAudioUrl } from "../../../../../receiver/device-audio-core";

export const runtime = "nodejs";
type Context = { params: Promise<{ filename: string }> };

export async function GET(request: Request, { params }: Context) {
  const { filename } = await params;
  if (process.env.RADIO_DEVICE_AUDIO_TRANSPORT !== "local-cache" ||
      !verifyDeviceAudioUrl(filename, new URL(request.url), process.env.DEVICE_API_TOKEN))
    return new Response(null, { status: 403, headers: { "Cache-Control": "no-store" } });
  const bytes = deviceAudioCache.get(filename);
  if (!bytes) return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
  const range = parseDeviceAudioRange(request.headers.get("range"), bytes.length);
  if (!range) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${bytes.length}`, "Cache-Control": "no-store" } });
  const headers = new Headers({
    "Content-Type": filename.endsWith(".mp3") ? "audio/mpeg" : "audio/wav",
    "Content-Length": String(range.end - range.start + 1),
    "Accept-Ranges": "bytes", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
  });
  if (range.partial) headers.set("Content-Range", `bytes ${range.start}-${range.end}/${bytes.length}`);
  return new Response(bytes.subarray(range.start, range.end + 1), { status: range.partial ? 206 : 200, headers });
}
