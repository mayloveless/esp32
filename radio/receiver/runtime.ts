export const maximumExcludedPrograms = 20;

export const receiverStatuses = [
  "idle",
  "no_signal",
  "tuning",
  "buffering",
  "playing",
  "ended",
  "error",
] as const;

export type ReceiverStatus = (typeof receiverStatuses)[number];

export function addExcludedProgramId(
  ids: string[],
  id: string,
  maximum = maximumExcludedPrograms,
) {
  return [...new Set([...ids.filter((item) => item !== id), id])].slice(
    -Math.min(Math.max(maximum, 1), maximumExcludedPrograms),
  );
}

export function isAutoplayBlocked(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "NotAllowedError"
  );
}

export function resolvePlaybackStartOffsetMs(
  manifestStartOffsetMs: number,
  playFromStart: boolean,
) {
  return playFromStart ? 0 : manifestStartOffsetMs;
}
