import type { RadioProgram } from "../program/types";
import type { ReceiverCaption } from "./captions";

const maximumExcludedPrograms = 20;

export type ReceiverManifest = {
  programId: string;
  title: string;
  format: RadioProgram["format"];
  audioUrl: string;
  audioExpiresAt: string;
  durationMs: number;
  startOffsetMs: number;
  captions: ReceiverCaption[];
  retireOnComplete: true;
};

type ManifestCandidate = RadioProgram & { duration_ms: number };

export function findManifestCandidate(
  candidates: RadioProgram[],
  excludeProgramIds: string[],
  random: () => number = Math.random,
): ManifestCandidate | null {
  const eligible = candidates.filter(
    (candidate): candidate is ManifestCandidate =>
      !excludeProgramIds.includes(candidate.id) &&
      typeof candidate.duration_ms === "number" &&
      Number.isSafeInteger(candidate.duration_ms) &&
      candidate.duration_ms > 0,
  );
  if (eligible.length === 0) return null;
  const value = random();
  const normalized = Number.isFinite(value) ? Math.max(0, Math.min(value, 0.999_999)) : 0;
  return eligible[Math.floor(normalized * eligible.length)];
}

export function parseTuneRequest(value: unknown) {
  if (value === undefined || value === null) return { excludeProgramIds: [] };
  if (typeof value !== "object" || Array.isArray(value))
    throw new Error("调台请求体必须是对象。");
  const excluded = (value as { excludeProgramIds?: unknown }).excludeProgramIds;
  if (excluded === undefined) return { excludeProgramIds: [] };
  if (!Array.isArray(excluded) || excluded.length > maximumExcludedPrograms)
    throw new Error(`excludeProgramIds 必须是最多 ${maximumExcludedPrograms} 项的数组。`);
  const ids = excluded.map((id) => {
    if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id))
      throw new Error("excludeProgramIds 中包含无效节目 ID。");
    return id;
  });
  return { excludeProgramIds: [...new Set(ids)] };
}

export function calculateStartOffsetMs(
  durationMs: number,
  random: () => number = Math.random,
) {
  if (!Number.isFinite(durationMs) || durationMs <= 20_000) return 0;
  const minimumOffset = 4_000;
  const minimumRemaining = 15_000;
  const maximumOffset = Math.min(15_000, durationMs - minimumRemaining);
  if (maximumOffset < minimumOffset) return 0;
  return Math.min(
    maximumOffset,
    Math.floor(
      minimumOffset + random() * (maximumOffset - minimumOffset + 1),
    ),
  );
}
