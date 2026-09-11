import { createSeededRandom, randomInteger } from "../music/random.ts";
import { TtsError } from "../tts/validation.ts";
import {
  buildPcmWav,
  parsePcmWav,
  wavSampleRate,
  type WavPcmFormat,
} from "./wav.ts";

export const backgroundBedGenerator = "procedural-bed-v1";

export const backgroundBedOptions = [
  { label: "无", value: "none" },
  { label: "氛围", value: "ambient" },
  { label: "脉冲（120 BPM）", value: "pulse" },
  { label: "神秘", value: "mysterious" },
] as const;

export type BackgroundBed = (typeof backgroundBedOptions)[number]["value"];
export type GeneratedBackgroundBed = {
  audioBytes: Uint8Array;
  durationMs: number;
  generator: typeof backgroundBedGenerator;
  seed: string;
};

// 各 preset 在人声下的可听度不同；pulse 保留更高电平，确保节拍不会被朗读完全掩盖。
const backgroundGains: Record<BackgroundBed, number> = {
  ambient: 0.22,
  mysterious: 0.24,
  none: 0,
  pulse: 0.3,
};

export function isBackgroundBed(value: unknown): value is BackgroundBed {
  return typeof value === "string" && backgroundBedOptions.some((option) => option.value === value);
}

export function parseBackgroundBed(value: unknown): BackgroundBed {
  if (isBackgroundBed(value)) return value;
  throw new TtsError("背景音乐只能是 none、ambient、pulse 或 mysterious。", "input");
}

export function getDefaultBackgroundBed(options: {
  alienDialect: string | null;
  mode: "alien" | "normal";
}): BackgroundBed {
  return options.mode === "alien" && options.alienDialect === "machine-1"
    ? "mysterious"
    : "ambient";
}

export function getBackgroundBedGain(bed: BackgroundBed) {
  return backgroundGains[bed];
}

function assertBedFormat(format: WavPcmFormat) {
  if (
    format.sampleRate !== wavSampleRate ||
    format.channels !== 1 ||
    format.bitsPerSample !== 16 ||
    format.blockAlign !== 2
  )
    throw new TtsError(
      `背景音乐只支持 ${wavSampleRate} Hz、单声道、16-bit PCM WAV。`,
      "audio",
    );
}

function midiToFrequency(note: number) {
  return 440 * 2 ** ((note - 69) / 12);
}

function addTone(
  mix: Float32Array,
  start: number,
  end: number,
  frequency: number,
  amplitude: number,
  waveform: "sine" | "triangle" = "sine",
) {
  const boundedStart = Math.max(0, start);
  const boundedEnd = Math.min(mix.length, end);
  const attackFrames = Math.max(1, Math.round(wavSampleRate * 0.04));
  const releaseFrames = Math.max(1, Math.round(wavSampleRate * 0.18));
  for (let frame = boundedStart; frame < boundedEnd; frame += 1) {
    const phase = (frame * frequency) / wavSampleRate;
    const cycle = phase - Math.floor(phase);
    const value = waveform === "triangle"
      ? 1 - 4 * Math.abs(cycle - 0.5)
      : Math.sin(cycle * Math.PI * 2);
    const envelope = Math.max(
      0,
      Math.min(1, (frame - start) / attackFrames, (end - frame) / releaseFrames),
    );
    mix[frame] += value * amplitude * envelope;
  }
}

function addAmbientBed(mix: Float32Array, root: number, random: () => number) {
  addTone(mix, 0, mix.length, midiToFrequency(root - 12), 0.18);
  addTone(mix, 0, mix.length, midiToFrequency(root - 5), 0.065, "triangle");
  addTone(mix, 0, mix.length, midiToFrequency(root + 12), 0.065, "triangle");
  const changeFrames = Math.round(wavSampleRate * 5.5);
  for (let start = 0; start < mix.length; start += changeFrames) {
    const note = root + randomInteger(random, 3, 10);
    addTone(mix, start, start + changeFrames * 1.45, midiToFrequency(note), 0.045);
    addTone(mix, start, start + changeFrames * 0.62, midiToFrequency(note + 12), 0.032);
  }
}

function addPulseBed(mix: Float32Array, root: number, random: () => number) {
  addTone(mix, 0, mix.length, midiToFrequency(root - 12), 0.1);
  // 120 BPM 的稳定四拍脉冲：低频只做支撑，节拍主体落在小扬声器可听见的中频。
  const pulseFrames = Math.round(wavSampleRate * 0.5);
  for (let start = 0; start < mix.length; start += pulseFrames) {
    const pulse = Math.floor(start / pulseFrames);
    const note = root + (randomInteger(random, 0, 2) === 0 ? 0 : 7);
    const accent = pulse % 4 === 0 ? 1.22 : 1;
    addTone(mix, start, start + pulseFrames * 0.32, midiToFrequency(note), 0.075 * accent, "triangle");
    addTone(mix, start, start + pulseFrames * 0.16, midiToFrequency(note + 24), 0.08 * accent);
    if (pulse % 2 === 1)
      addTone(mix, start + pulseFrames * 0.24, start + pulseFrames * 0.42, midiToFrequency(note + 19), 0.04);
  }
}

function addMysteriousBed(mix: Float32Array, root: number, random: () => number) {
  addTone(mix, 0, mix.length, midiToFrequency(root - 19), 0.16);
  addTone(mix, 0, mix.length, midiToFrequency(root - 12), 0.055, "triangle");
  addTone(mix, 0, mix.length, midiToFrequency(root + 12), 0.042);
  const signalFrames = Math.round(wavSampleRate * 4.2);
  for (let start = 0; start < mix.length; start += signalFrames) {
    const note = root + randomInteger(random, 8, 14);
    addTone(
      mix,
      start + Math.round(signalFrames * 0.5),
      start + Math.round(signalFrames * 1.05),
      midiToFrequency(note),
      0.032,
      "triangle",
    );
  }
}

function encodePcm(format: WavPcmFormat, mix: Float32Array) {
  const pcm = new Uint8Array(mix.length * format.blockAlign);
  const view = new DataView(pcm.buffer);
  let average = 0;
  for (const sample of mix) average += sample;
  average /= Math.max(1, mix.length);
  let peak = 0;
  for (let index = 0; index < mix.length; index += 1) {
    mix[index] -= average;
    peak = Math.max(peak, Math.abs(mix[index]));
  }
  // 各 preset 先归一到一致电平，再由 mixer 的 gain 和 ducking 决定与人声的关系。
  const gain = peak > 0 ? 0.72 / peak : 1;
  for (let index = 0; index < mix.length; index += 1) {
    view.setInt16(
      index * format.blockAlign,
      Math.round(Math.max(-1, Math.min(1, mix[index] * gain)) * 32_767),
      true,
    );
  }
  return buildPcmWav(format, pcm);
}

/** 按语音 PCM 的精确帧数生成克制背景，不生成独立 music Program。 */
export function synthesizeBackgroundBed(
  speechAudioBytes: Uint8Array,
  bed: Exclude<BackgroundBed, "none">,
  seed: string,
): GeneratedBackgroundBed {
  if (!seed.trim()) throw new TtsError("背景音乐 seed 不能为空。", "input");
  const speech = parsePcmWav(speechAudioBytes);
  assertBedFormat(speech.format);
  const frames = speech.data.length / speech.format.blockAlign;
  const mix = new Float32Array(frames);
  const random = createSeededRandom(`${seed}:${bed}`);
  const root = randomInteger(random, 40, 48);
  if (bed === "ambient") addAmbientBed(mix, root, random);
  else if (bed === "pulse") addPulseBed(mix, root, random);
  else addMysteriousBed(mix, root, random);
  const audioBytes = encodePcm(speech.format, mix);
  const parsed = parsePcmWav(audioBytes);
  if (parsed.data.length !== speech.data.length)
    throw new TtsError("背景音乐时长与语音不一致。", "audio");
  return {
    audioBytes,
    durationMs: Math.round(parsed.durationMs),
    generator: backgroundBedGenerator,
    seed,
  };
}
