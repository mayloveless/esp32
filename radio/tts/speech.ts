import "server-only";
import {
  synthesizeWithSiliconFlow,
  type SingleSpeechRequest,
} from "./siliconflow";

export type SpeechSynthesisRequest = SingleSpeechRequest;

export type SpeechSynthesisResult = {
  audioBytes: Uint8Array;
  traceId: string | null;
};

export type SynthesizeSpeech = (
  request: SpeechSynthesisRequest,
) => Promise<SpeechSynthesisResult>;

// Renderer 只依赖这个通用的单段语音边界，不感知当前供应商。
export const synthesizeSpeech: SynthesizeSpeech = async (request) => {
  const result = await synthesizeWithSiliconFlow(request);
  return { audioBytes: result.audioBytes, traceId: result.traceId };
};
