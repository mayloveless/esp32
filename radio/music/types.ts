export const musicGenerator = "procedural-synth-v1";

export const proceduralMusicStyleOptions = [
  { value: "orbital_ambient", label: "轨道氛围" },
  { value: "retro_synth", label: "复古合成器" },
  { value: "mechanical_pulse", label: "机械脉冲" },
  { value: "alien_signal", label: "异星信号" },
] as const;

export const proceduralMusicStyleRequests = [
  "random",
  ...proceduralMusicStyleOptions.map((option) => option.value),
] as const;

export type ProceduralMusicStyle = (typeof proceduralMusicStyleOptions)[number]["value"];
export type ProceduralMusicStyleRequest =
  (typeof proceduralMusicStyleRequests)[number];

export type ProceduralMusicRecipe = {
  barCount: number;
  bpm: number;
  durationMs: number;
  generator: typeof musicGenerator;
  rootMidi: number;
  scale: number[];
  seed: string;
  style: ProceduralMusicStyle;
};
