import { TtsError } from "../tts/validation.ts";

export const wavSampleRate = 32_000;
export const speakerPauseMs = 180;

export type WavPcmFormat = {
  bitsPerSample: number;
  blockAlign: number;
  byteRate: number;
  channels: number;
  sampleRate: number;
};

export type ParsedWavPcm = {
  data: Uint8Array;
  durationMs: number;
  format: WavPcmFormat;
};

export type WavRenderSegment = {
  audioBytes: Uint8Array;
  speaker: string;
  text: string;
};

export type Caption = {
  endMs: number;
  speaker: string;
  startMs: number;
  text: string;
};

function readText(bytes: Uint8Array, offset: number, length: number) {
  return new TextDecoder().decode(bytes.slice(offset, offset + length));
}

function assertWav(condition: boolean, message: string): asserts condition {
  if (!condition) throw new TtsError(message, "audio");
}

function formatEquals(left: WavPcmFormat, right: WavPcmFormat) {
  return (
    left.bitsPerSample === right.bitsPerSample &&
    left.blockAlign === right.blockAlign &&
    left.byteRate === right.byteRate &&
    left.channels === right.channels &&
    left.sampleRate === right.sampleRate
  );
}

export function parsePcmWav(bytes: Uint8Array): ParsedWavPcm {
  assertWav(bytes.length >= 44, "TTS 返回的 WAV 文件过短。");
  assertWav(
    readText(bytes, 0, 4) === "RIFF" && readText(bytes, 8, 4) === "WAVE",
    "TTS 返回的不是 RIFF/WAV 音频。",
  );
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 12;
  let format: WavPcmFormat | null = null;
  let data: Uint8Array | null = null;
  while (offset + 8 <= bytes.length) {
    const chunkName = readText(bytes, offset, 4);
    const chunkSize = view.getUint32(offset + 4, true);
    const chunkStart = offset + 8;
    const chunkEnd = chunkStart + chunkSize;
    assertWav(chunkEnd <= bytes.length, "WAV chunk 长度无效。");
    if (chunkName === "fmt ") {
      assertWav(chunkSize >= 16, "WAV 缺少 PCM 格式信息。");
      const formatCode = view.getUint16(chunkStart, true);
      const channels = view.getUint16(chunkStart + 2, true);
      const sampleRate = view.getUint32(chunkStart + 4, true);
      const byteRate = view.getUint32(chunkStart + 8, true);
      const blockAlign = view.getUint16(chunkStart + 12, true);
      const bitsPerSample = view.getUint16(chunkStart + 14, true);
      assertWav(formatCode === 1, "只支持 PCM 格式的 WAV 音频。");
      assertWav(channels >= 1 && channels <= 2, "WAV 声道数必须为单声道或双声道。");
      assertWav(
        bitsPerSample === 8 ||
          bitsPerSample === 16 ||
          bitsPerSample === 24 ||
          bitsPerSample === 32,
        "WAV 位深度不受支持。",
      );
      assertWav(sampleRate > 0, "WAV 采样率无效。");
      const expectedBlockAlign = channels * (bitsPerSample / 8);
      assertWav(blockAlign === expectedBlockAlign, "WAV blockAlign 无效。");
      assertWav(
        byteRate === sampleRate * blockAlign,
        "WAV byteRate 与 PCM 参数不一致。",
      );
      format = { bitsPerSample, blockAlign, byteRate, channels, sampleRate };
    }
    if (chunkName === "data") {
      assertWav(data === null, "WAV 不能包含多个 data chunk。");
      data = bytes.slice(chunkStart, chunkEnd);
    }
    offset = chunkEnd + (chunkSize % 2);
  }
  assertWav(format !== null, "WAV 缺少 fmt chunk。");
  assertWav(data !== null && data.length > 0, "WAV 缺少音频数据。");
  assertWav(data.length % format.blockAlign === 0, "WAV PCM 数据未按帧对齐。");
  return {
    data,
    durationMs: (data.length / format.byteRate) * 1_000,
    format,
  };
}

export function buildPcmWav(format: WavPcmFormat, data: Uint8Array) {
  assertWav(data.length % format.blockAlign === 0, "PCM 数据未按帧对齐。");
  assertWav(
    data.length <= 0xffffffff - 36,
    "合并后的 WAV 音频过大。",
  );
  const bytes = new Uint8Array(44 + data.length);
  const view = new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode("RIFF"), 0);
  view.setUint32(4, 36 + data.length, true);
  bytes.set(new TextEncoder().encode("WAVEfmt "), 8);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, format.channels, true);
  view.setUint32(24, format.sampleRate, true);
  view.setUint32(28, format.byteRate, true);
  view.setUint16(32, format.blockAlign, true);
  view.setUint16(34, format.bitsPerSample, true);
  bytes.set(new TextEncoder().encode("data"), 36);
  view.setUint32(40, data.length, true);
  bytes.set(data, 44);
  return bytes;
}

function createSilence(format: WavPcmFormat, durationMs: number) {
  const frames = Math.round((format.sampleRate * durationMs) / 1_000);
  const silence = new Uint8Array(frames * format.blockAlign);
  if (format.bitsPerSample === 8) silence.fill(128);
  return silence;
}

export function mergeWavSegments(
  segments: WavRenderSegment[],
  pauseMs = speakerPauseMs,
) {
  assertWav(segments.length > 0, "没有可合并的语音片段。");
  assertWav(
    Number.isInteger(pauseMs) && pauseMs >= 0,
    "说话者停顿时长无效。",
  );
  const parsedSegments = segments.map((segment) => ({
    ...segment,
    parsed: parsePcmWav(segment.audioBytes),
  }));
  const format = parsedSegments[0].parsed.format;
  assertWav(
    format.sampleRate === wavSampleRate,
    `WAV 采样率必须为 ${wavSampleRate} Hz。`,
  );
  const dataChunks: Uint8Array[] = [];
  const captions: Caption[] = [];
  let previousSpeaker: string | null = null;
  let elapsedMs = 0;
  for (const segment of parsedSegments) {
    assertWav(
      formatEquals(format, segment.parsed.format),
      "多个 WAV 片段的 PCM 参数必须完全一致。",
    );
    if (previousSpeaker !== null && previousSpeaker !== segment.speaker) {
      const silence = createSilence(format, pauseMs);
      dataChunks.push(silence);
      elapsedMs += (silence.length / format.byteRate) * 1_000;
    }
    const startMs = Math.round(elapsedMs);
    dataChunks.push(segment.parsed.data);
    elapsedMs += segment.parsed.durationMs;
    captions.push({
      endMs: Math.round(elapsedMs),
      speaker: segment.speaker,
      startMs,
      text: segment.text,
    });
    previousSpeaker = segment.speaker;
  }
  const data = new Uint8Array(
    dataChunks.reduce((size, chunk) => size + chunk.length, 0),
  );
  let offset = 0;
  for (const chunk of dataChunks) {
    data.set(chunk, offset);
    offset += chunk.length;
  }
  return {
    audioBytes: buildPcmWav(format, data),
    captions,
    durationMs: Math.round((data.length / format.byteRate) * 1_000),
    sampleRate: format.sampleRate,
  };
}
