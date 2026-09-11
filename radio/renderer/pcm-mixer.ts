import { TtsError } from "../tts/validation.ts";
import { buildPcmWav, parsePcmWav, type Caption, type WavPcmFormat } from "./wav.ts";

export type BackgroundMixOptions = {
  baseGain: number;
  captions: Caption[];
  duckedGain?: number;
};

function formatsEqual(left: WavPcmFormat, right: WavPcmFormat) {
  return (
    left.bitsPerSample === right.bitsPerSample &&
    left.blockAlign === right.blockAlign &&
    left.byteRate === right.byteRate &&
    left.channels === right.channels &&
    left.sampleRate === right.sampleRate
  );
}

function assertMixFormat(format: WavPcmFormat) {
  if (format.channels !== 1 || format.bitsPerSample !== 16 || format.blockAlign !== 2)
    throw new TtsError("背景混音只支持单声道、16-bit PCM WAV。", "audio");
}

function frameIsSpeaking(frame: number, sampleRate: number, captions: Caption[]) {
  const timeMs = (frame / sampleRate) * 1_000;
  return captions.some((caption) => timeMs >= caption.startMs && timeMs < caption.endMs);
}

function clampSample(value: number) {
  return Math.max(-1, Math.min(1, value));
}

/**
 * 在内存中将低音量背景混入语音。背景在字幕对应的人声区间下降，并使用短 ramp 消除点击声。
 */
export function mixSpeechWithBackground(
  speechAudioBytes: Uint8Array,
  backgroundAudioBytes: Uint8Array | null,
  options: BackgroundMixOptions,
) {
  const speech = parsePcmWav(speechAudioBytes);
  if (backgroundAudioBytes === null)
    return { audioBytes: speechAudioBytes, durationMs: Math.round(speech.durationMs) };
  const background = parsePcmWav(backgroundAudioBytes);
  assertMixFormat(speech.format);
  assertMixFormat(background.format);
  if (!formatsEqual(speech.format, background.format))
    throw new TtsError("语音与背景音乐的 PCM 参数必须完全一致。", "audio");
  if (speech.data.length !== background.data.length)
    throw new TtsError("语音与背景音乐时长必须完全一致。", "audio");
  if (!Number.isFinite(options.baseGain) || options.baseGain < 0 || options.baseGain > 0.25)
    throw new TtsError("背景音乐音量无效。", "input");
  const duckedGain = options.duckedGain ?? options.baseGain * 0.82;
  if (!Number.isFinite(duckedGain) || duckedGain < 0 || duckedGain > options.baseGain)
    throw new TtsError("背景音乐压低音量无效。", "input");

  const output = new Float32Array(speech.data.length / speech.format.blockAlign);
  const speechView = new DataView(speech.data.buffer, speech.data.byteOffset, speech.data.byteLength);
  const backgroundView = new DataView(
    background.data.buffer,
    background.data.byteOffset,
    background.data.byteLength,
  );
  const rampFrames = Math.max(1, Math.round(speech.format.sampleRate * 0.045));
  let appliedGain = options.baseGain;
  const gainStep = Math.max(0.00001, (options.baseGain - duckedGain) / rampFrames);
  let average = 0;
  let peak = 0;
  for (let frame = 0; frame < output.length; frame += 1) {
    const targetGain = frameIsSpeaking(frame, speech.format.sampleRate, options.captions)
      ? duckedGain
      : options.baseGain;
    if (appliedGain < targetGain) appliedGain = Math.min(targetGain, appliedGain + gainStep);
    else if (appliedGain > targetGain) appliedGain = Math.max(targetGain, appliedGain - gainStep);
    const speechSample = speechView.getInt16(frame * 2, true) / 32_768;
    const backgroundSample = backgroundView.getInt16(frame * 2, true) / 32_768;
    output[frame] = speechSample + backgroundSample * appliedGain;
    average += output[frame];
  }
  average /= Math.max(1, output.length);
  for (let frame = 0; frame < output.length; frame += 1) {
    output[frame] -= average;
    peak = Math.max(peak, Math.abs(output[frame]));
  }
  const normalization = peak > 0.94 ? 0.94 / peak : 1;
  const data = new Uint8Array(speech.data.length);
  const outputView = new DataView(data.buffer);
  for (let frame = 0; frame < output.length; frame += 1) {
    outputView.setInt16(
      frame * 2,
      Math.round(clampSample(output[frame] * normalization) * 32_767),
      true,
    );
  }
  return {
    audioBytes: buildPcmWav(speech.format, data),
    durationMs: Math.round(speech.durationMs),
  };
}
