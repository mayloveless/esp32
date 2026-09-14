export const maximumExcludedPrograms = 20;
export const minimumTuningFeedbackMs = 320;

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

/**
 * 已经花在请求或加载上的时间会计入调台反馈，避免为慢请求再额外等待。
 */
export function getRemainingTuningFeedbackMs(
  elapsedMs: number,
  minimumMs = minimumTuningFeedbackMs,
) {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return minimumMs;
  if (!Number.isFinite(minimumMs) || minimumMs <= 0) return 0;
  return Math.max(0, Math.ceil(minimumMs - elapsedMs));
}

/** 旧请求即使稍后完成，也不能覆盖最新一次调台的状态。 */
export function isLatestTune(sequence: number, currentSequence: number) {
  return sequence === currentSequence;
}

/**
 * no_signal 后仅机会式检查库存：立即返回界面状态，绝不等待可能触发生产的异步任务。
 */
export function startNoSignalInventoryEnsure(ensure: () => Promise<unknown>) {
  void ensure().catch(() => undefined);
  return "no_signal" as const;
}
