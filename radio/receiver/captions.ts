export type ReceiverCaption = {
  endMs: number;
  speaker: string;
  startMs: number;
  text: string;
};

function isReceiverCaption(value: unknown): value is ReceiverCaption {
  if (typeof value !== "object" || value === null) return false;
  const caption = value as Partial<ReceiverCaption>;
  return (
    typeof caption.speaker === "string" &&
    typeof caption.text === "string" &&
    typeof caption.startMs === "number" &&
    Number.isFinite(caption.startMs) &&
    caption.startMs >= 0 &&
    typeof caption.endMs === "number" &&
    Number.isFinite(caption.endMs) &&
    caption.endMs > caption.startMs
  );
}

export function getReceiverCaptions(captions: unknown[]): ReceiverCaption[] {
  return captions.filter(isReceiverCaption);
}

/** 返回当前音频时间实际落入的字幕；片段间静音时返回 null。 */
export function findCaptionAtTime(
  captions: ReceiverCaption[],
  playbackMs: number,
) {
  if (!Number.isFinite(playbackMs) || playbackMs < 0) return null;
  return (
    captions.find(
      (caption) =>
        playbackMs >= caption.startMs && playbackMs < caption.endMs,
    ) ?? null
  );
}
