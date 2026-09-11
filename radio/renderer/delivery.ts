import { TtsError } from "../tts/validation.ts";
import type { RadioProgram } from "../program/types";

export type DeliveryProfile = {
  id: "broadcast" | "lively" | "urgent" | "mysterious";
  instruction: string;
  label: string;
  speed: number;
};

export const deliveryProfiles = {
  broadcast: {
    id: "broadcast",
    instruction:
      "请以真实电台主播的方式播报，表达利落，有重点和自然句间节奏，避免逐字朗读腔。",
    label: "普通广播",
    speed: 1.15,
  },
  lively: {
    id: "lively",
    instruction:
      "请以自然的电台对话方式表达，反应明确，轻松，有情绪起伏，避免主持稿朗读腔。",
    label: "活泼聊天",
    speed: 1.25,
  },
  urgent: {
    id: "urgent",
    instruction:
      "请以紧迫而专注的突发新闻方式播报，信息密度高，清晰有力，不要喊叫或含糊。",
    label: "突发新闻",
    speed: 1.3,
  },
  mysterious: {
    id: "mysterious",
    instruction:
      "请以神秘、克制且有频道广播感的方式播报，保持清晰节奏，不要故意拖慢。",
    label: "神秘广播",
    speed: 1.18,
  },
} as const satisfies Record<string, DeliveryProfile>;

export const deliveryProfileIds = Object.keys(
  deliveryProfiles,
) as DeliveryProfileId[];

export type DeliveryProfileId = keyof typeof deliveryProfiles;

export function getDefaultDeliveryProfileId(
  format: RadioProgram["format"],
): DeliveryProfileId {
  return format === "chat" ? "lively" : "broadcast";
}

export function getDeliveryProfile(id: DeliveryProfileId): DeliveryProfile {
  return deliveryProfiles[id];
}

export function parseDeliveryProfileId(value: unknown): DeliveryProfileId {
  if (
    typeof value === "string" &&
    Object.hasOwn(deliveryProfiles, value)
  )
    return value as DeliveryProfileId;
  throw new TtsError(
    "播报风格只能是 broadcast、lively、urgent 或 mysterious。",
    "input",
  );
}
