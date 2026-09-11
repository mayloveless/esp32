import { createSeededRandom, randomInteger } from "./random.ts";
import {
  musicGenerator,
  proceduralMusicStyleOptions,
  proceduralMusicStyleRequests,
  type ProceduralMusicRecipe,
  type ProceduralMusicStyle,
  type ProceduralMusicStyleRequest,
} from "./types.ts";

const styleSettings: Record<
  ProceduralMusicStyle,
  { barCount: number; bpm: [number, number]; root: [number, number]; scale: number[] }
> = {
  orbital_ambient: {
    barCount: 12,
    bpm: [66, 78],
    root: [40, 47],
    scale: [0, 3, 5, 7, 10],
  },
  retro_synth: {
    barCount: 20,
    bpm: [106, 120],
    root: [43, 50],
    scale: [0, 2, 3, 7, 9],
  },
  mechanical_pulse: {
    barCount: 20,
    bpm: [96, 108],
    root: [43, 50],
    scale: [0, 2, 5, 7, 10],
  },
  alien_signal: {
    barCount: 14,
    bpm: [72, 88],
    root: [42, 49],
    scale: [0, 1, 5, 6, 10],
  },
};

export function parseProceduralMusicStyle(value: unknown): ProceduralMusicStyleRequest {
  if (
    typeof value !== "string" ||
    !proceduralMusicStyleRequests.includes(value as ProceduralMusicStyleRequest)
  )
    throw new Error("音乐风格只能是 random、orbital_ambient、retro_synth、mechanical_pulse 或 alien_signal。");
  return value as ProceduralMusicStyleRequest;
}

export function parseProceduralMusicRequest(value: unknown) {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("请求体必须是对象。");
  return parseProceduralMusicStyle((value as { style?: unknown }).style);
}

export function createProceduralMusicRecipe(
  requestedStyle: ProceduralMusicStyleRequest,
  seed: string,
): ProceduralMusicRecipe {
  if (!seed.trim()) throw new Error("音乐 seed 不能为空。");
  const random = createSeededRandom(seed);
  const style =
    requestedStyle === "random"
      ? proceduralMusicStyleOptions[
          randomInteger(random, 0, proceduralMusicStyleOptions.length - 1)
        ].value
      : requestedStyle;
  const settings = styleSettings[style];
  const bpm = randomInteger(random, settings.bpm[0], settings.bpm[1]);
  const rootMidi = randomInteger(random, settings.root[0], settings.root[1]);
  const durationMs = Math.round((settings.barCount * 4 * 60_000) / bpm);
  return {
    barCount: settings.barCount,
    bpm,
    durationMs,
    generator: musicGenerator,
    rootMidi,
    scale: [...settings.scale],
    seed,
    style,
  };
}

export function getProceduralMusicTitle(recipe: ProceduralMusicRecipe) {
  const label = proceduralMusicStyleOptions.find(
    (option) => option.value === recipe.style,
  )?.label;
  return `${label ?? "程序音乐"} · ${recipe.seed.replaceAll("-", "").slice(0, 6)}`;
}
