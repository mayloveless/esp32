import { buildPcmWav, parsePcmWav, wavSampleRate } from "../renderer/wav.ts";
import { createSeededRandom, randomInteger } from "./random.ts";
import type { ProceduralMusicRecipe } from "./types.ts";

const sampleRate = wavSampleRate;
const pcmFormat = {
  bitsPerSample: 16,
  blockAlign: 2,
  byteRate: sampleRate * 2,
  channels: 1,
  sampleRate,
} as const;

type Waveform = "sine" | "triangle" | "square" | "saw";

export type ProceduralMusicAsset = {
  audioBytes: Uint8Array;
  durationMs: number;
  sampleRate: typeof sampleRate;
};

function midiToFrequency(note: number) {
  return 440 * 2 ** ((note - 69) / 12);
}

function waveform(phase: number, type: Waveform) {
  const cycle = phase - Math.floor(phase);
  if (type === "triangle") return 1 - 4 * Math.abs(cycle - 0.5);
  if (type === "square") return cycle < 0.5 ? 1 : -1;
  if (type === "saw") return 2 * cycle - 1;
  return Math.sin(cycle * Math.PI * 2);
}

function envelope(frame: number, start: number, end: number, attackMs = 16, releaseMs = 90) {
  const attackFrames = Math.max(1, Math.round((attackMs / 1_000) * sampleRate));
  const releaseFrames = Math.max(1, Math.round((releaseMs / 1_000) * sampleRate));
  return Math.max(
    0,
    Math.min(1, (frame - start) / attackFrames, (end - frame) / releaseFrames),
  );
}

function addTone(
  mix: Float32Array,
  start: number,
  end: number,
  frequency: number,
  amplitude: number,
  type: Waveform,
) {
  const boundedStart = Math.max(0, start);
  const boundedEnd = Math.min(mix.length, end);
  for (let frame = boundedStart; frame < boundedEnd; frame += 1) {
    const phase = (frame * frequency) / sampleRate;
    mix[frame] += waveform(phase, type) * amplitude * envelope(frame, start, end);
  }
}

function addNoiseHit(
  mix: Float32Array,
  start: number,
  lengthFrames: number,
  amplitude: number,
  random: () => number,
) {
  const end = Math.min(mix.length, start + lengthFrames);
  for (let frame = Math.max(0, start); frame < end; frame += 1) {
    const progress = (frame - start) / lengthFrames;
    mix[frame] += (random() * 2 - 1) * amplitude * (1 - progress) ** 3;
  }
}

function addDrone(mix: Float32Array, recipe: ProceduralMusicRecipe, note: number, amplitude: number) {
  addTone(mix, 0, mix.length, midiToFrequency(note), amplitude, "sine");
  addTone(mix, 0, mix.length, midiToFrequency(note + 7), amplitude * 0.42, "triangle");
}

function addAmbient(
  mix: Float32Array,
  recipe: ProceduralMusicRecipe,
  random: () => number,
  beatFrames: number,
) {
  addDrone(mix, recipe, recipe.rootMidi - 12, 0.075);
  for (let bar = 0; bar < recipe.barCount; bar += 1) {
    const start = Math.round(bar * 4 * beatFrames);
    const root = recipe.rootMidi + recipe.scale[(bar * 2 + randomInteger(random, 0, 2)) % recipe.scale.length];
    addTone(mix, start, Math.round(start + beatFrames * 3.7), midiToFrequency(root), 0.055, "triangle");
    if (bar % 2 === 0) {
      const note = root + 12 + recipe.scale[randomInteger(random, 0, recipe.scale.length - 1)];
      addTone(mix, Math.round(start + beatFrames), Math.round(start + beatFrames * 2.8), midiToFrequency(note), 0.065, "sine");
    }
  }
}

function addRetroSynth(
  mix: Float32Array,
  recipe: ProceduralMusicRecipe,
  random: () => number,
  beatFrames: number,
) {
  addDrone(mix, recipe, recipe.rootMidi - 12, 0.045);
  const stepFrames = beatFrames / 2;
  const steps = recipe.barCount * 8;
  for (let step = 0; step < steps; step += 1) {
    const bar = Math.floor(step / 8);
    const chord = recipe.rootMidi + recipe.scale[(bar * 2) % recipe.scale.length];
    const degree = recipe.scale[(step + randomInteger(random, 0, 2)) % recipe.scale.length];
    const start = Math.round(step * stepFrames);
    addTone(mix, start, Math.round(start + stepFrames * 0.82), midiToFrequency(chord + 12 + degree), 0.07, "saw");
    if (step % 2 === 0)
      addTone(mix, start, Math.round(start + beatFrames * 0.72), midiToFrequency(chord - 12), 0.065, "square");
    if (step % 4 === 0)
      addNoiseHit(mix, start, Math.round(sampleRate * 0.04), 0.026, random);
  }
}

function addMechanicalPulse(
  mix: Float32Array,
  recipe: ProceduralMusicRecipe,
  random: () => number,
  beatFrames: number,
) {
  // 机械感来自稳定的节拍和音高关系，而非方波与白噪声；后两者在小扬声器上会显得刺耳、像失真。
  addDrone(mix, recipe, recipe.rootMidi - 12, 0.032);
  const halfBeat = beatFrames / 2;
  const steps = recipe.barCount * 8;
  for (let step = 0; step < steps; step += 1) {
    const start = Math.round(step * halfBeat);
    const bar = Math.floor(step / 8);
    const note = recipe.rootMidi + recipe.scale[(bar + step * 3) % recipe.scale.length];
    addTone(mix, start, Math.round(start + halfBeat * 0.58), midiToFrequency(note - 12), 0.062, "triangle");
    if (step % 2 === 0)
      addTone(mix, start, Math.round(start + halfBeat * 0.2), midiToFrequency(note + 12), 0.026, "sine");
    if (step % 4 === 1)
      addTone(mix, start, Math.round(start + halfBeat * 0.72), midiToFrequency(note + 7), 0.036, "sine");
  }
}

function addAlienSignal(
  mix: Float32Array,
  recipe: ProceduralMusicRecipe,
  random: () => number,
  beatFrames: number,
) {
  addDrone(mix, recipe, recipe.rootMidi - 12, 0.055);
  for (let bar = 0; bar < recipe.barCount; bar += 1) {
    const start = Math.round(bar * 4 * beatFrames);
    const note = recipe.rootMidi + 12 + recipe.scale[(bar * 3 + randomInteger(random, 0, 1)) % recipe.scale.length];
    const offset = randomInteger(random, 0, Math.round(beatFrames));
    addTone(mix, start + offset, Math.round(start + beatFrames * 2.2), midiToFrequency(note), 0.075, "triangle");
    addTone(mix, Math.round(start + beatFrames * 2.5), Math.round(start + beatFrames * 3.5), midiToFrequency(note + 6), 0.045, "sine");
    if (bar % 3 === 0)
      addNoiseHit(mix, Math.round(start + beatFrames * 3.6), Math.round(sampleRate * 0.09), 0.02, random);
  }
}

function applyDelayAndLimiter(mix: Float32Array) {
  const delayFrames = Math.round(sampleRate * 0.23);
  for (let frame = delayFrames; frame < mix.length; frame += 1)
    mix[frame] += mix[frame - delayFrames] * 0.18;

  let average = 0;
  for (const sample of mix) average += sample;
  average /= mix.length;
  let peak = 0;
  for (let frame = 0; frame < mix.length; frame += 1) {
    mix[frame] -= average;
    peak = Math.max(peak, Math.abs(mix[frame]));
  }
  const gain = peak > 0.84 ? 0.84 / peak : 1;
  for (let frame = 0; frame < mix.length; frame += 1) mix[frame] *= gain;
}

/** 基于可复现 recipe 合成 32kHz / mono / 16-bit PCM WAV。 */
export function synthesizeProceduralMusic(
  recipe: ProceduralMusicRecipe,
): ProceduralMusicAsset {
  const frames = Math.round((recipe.durationMs / 1_000) * sampleRate);
  const mix = new Float32Array(frames);
  const random = createSeededRandom(`${recipe.seed}:${recipe.style}:notes`);
  const beatFrames = (sampleRate * 60) / recipe.bpm;
  if (recipe.style === "orbital_ambient") addAmbient(mix, recipe, random, beatFrames);
  else if (recipe.style === "retro_synth") addRetroSynth(mix, recipe, random, beatFrames);
  else if (recipe.style === "mechanical_pulse") addMechanicalPulse(mix, recipe, random, beatFrames);
  else addAlienSignal(mix, recipe, random, beatFrames);
  applyDelayAndLimiter(mix);

  const pcm = new Uint8Array(frames * pcmFormat.blockAlign);
  const view = new DataView(pcm.buffer);
  for (let frame = 0; frame < frames; frame += 1)
    view.setInt16(frame * 2, Math.round(Math.max(-1, Math.min(1, mix[frame])) * 32_767), true);
  const audioBytes = buildPcmWav(pcmFormat, pcm);
  const parsed = parsePcmWav(audioBytes);
  if (
    parsed.format.sampleRate !== sampleRate ||
    parsed.format.channels !== 1 ||
    parsed.format.bitsPerSample !== 16 ||
    parsed.data.length % parsed.format.blockAlign !== 0
  )
    throw new Error("程序音乐 WAV 校验失败。");
  return {
    audioBytes,
    durationMs: Math.round(parsed.durationMs),
    sampleRate,
  };
}
