import { readMp3Duration, TtsError } from "./validation.ts";

const maximumAudioBytes = 52_428_800;
const requestTimeoutMs = 45_000;

export type SiliconFlowRequest = {
  apiKey: string;
  baseUrl: string;
  model: string;
  text: string;
  voice: string;
};

export type FetchImplementation = typeof fetch;

export async function requestSiliconFlowSpeech(
  request: SiliconFlowRequest,
  fetchImplementation: FetchImplementation = fetch,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
  try {
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
          input: request.text,
          voice: request.voice,
          response_format: "mp3",
          sample_rate: 32_000,
          stream: false,
          speed: 1,
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
      durationMs: readMp3Duration(audioBytes),
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
