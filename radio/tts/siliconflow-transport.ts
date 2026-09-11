import { readMp3Duration, TtsError } from "./validation.ts";

const maximumAudioBytes = 52_428_800;
const requestTimeoutMs = 45_000;
export const minimumTtsSpeed = 0.25;
export const maximumTtsSpeed = 4;

export type SiliconFlowRequest = {
  apiKey: string;
  baseUrl: string;
  instruction?: string;
  model: string;
  responseFormat: TtsResponseFormat;
  sampleRate: number;
  speed?: number;
  text: string;
  voice: string;
};

export type TtsResponseFormat = "mp3" | "wav";

export type FetchImplementation = typeof fetch;

function getInput(request: SiliconFlowRequest) {
  const instruction = request.instruction?.trim();
  return instruction
    ? `${instruction}<|endofprompt|>${request.text}`
    : request.text;
}

function getSpeed(request: SiliconFlowRequest) {
  const speed = request.speed ?? 1;
  if (
    !Number.isFinite(speed) ||
    speed < minimumTtsSpeed ||
    speed > maximumTtsSpeed
  )
    throw new TtsError(
      `TTS 语速必须介于 ${minimumTtsSpeed} 和 ${maximumTtsSpeed} 之间。`,
      "input",
    );
  return speed;
}

export async function requestSiliconFlowSpeech(
  request: SiliconFlowRequest,
  fetchImplementation: FetchImplementation = fetch,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
  try {
    const input = getInput(request);
    const speed = getSpeed(request);
    const response = await fetchImplementation(
      `${request.baseUrl.replace(/\/$/, "")}/audio/speech`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${request.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: request.model,
          input,
          voice: request.voice,
          response_format: request.responseFormat,
          sample_rate: request.sampleRate,
          stream: false,
          speed,
          gain: 0,
        }),
        signal: controller.signal,
      },
    );
    if (!response.ok)
      throw new TtsError(
        response.status >= 500
          ? "硅基流动 TTS 服务暂时不可用。"
          : "硅基流动拒绝了本次语音合成请求。",
        "provider",
      );
    const contentType = response.headers.get("content-type") ?? "";
    if (
      !contentType.startsWith("audio/") &&
      !contentType.startsWith("application/octet-stream")
    )
      throw new TtsError("硅基流动未返回音频数据。", "audio");
    const audioBytes = new Uint8Array(await response.arrayBuffer());
    if (audioBytes.length === 0 || audioBytes.length > maximumAudioBytes)
      throw new TtsError("硅基流动返回的音频大小无效。", "audio");
    return {
      audioBytes,
      durationMs:
        request.responseFormat === "mp3" ? readMp3Duration(audioBytes) : null,
      traceId: response.headers.get("x-siliconcloud-trace-id"),
    };
  } catch (error) {
    if (error instanceof TtsError) throw error;
    if (error instanceof Error && error.name === "AbortError")
      throw new TtsError("硅基流动 TTS 请求超时。", "timeout");
    throw new TtsError("无法连接硅基流动 TTS 服务。", "provider");
  } finally {
    clearTimeout(timeout);
  }
}
