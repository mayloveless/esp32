import type { SignalKind } from "./manifest";

export type SignalPresentation = {
  label: string;
  captionLabel: "字幕" | "译文" | null;
  musicStatus: string | null;
};

const signalPresentations: Record<SignalKind, SignalPresentation> = {
  news: { label: "新闻广播", captionLabel: "字幕", musicStatus: null },
  chat: { label: "访谈 / 对话", captionLabel: "字幕", musicStatus: null },
  alien: { label: "未知语言信号", captionLabel: "译文", musicStatus: null },
  music: { label: "音乐节目", captionLabel: null, musicStatus: "音乐广播中" },
};

/** 将稳定的 signalKind 转成 Receiver 主界面所需的最小文案。 */
export function getSignalPresentation(signalKind: SignalKind): SignalPresentation {
  return signalPresentations[signalKind];
}
