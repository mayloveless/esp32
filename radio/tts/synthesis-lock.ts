export class SynthesisInProgressError extends Error {
  constructor() {
    super("已有节目正在合成语音，请等待当前请求完成后再试。");
  }
}

let synthesizing = false;

export async function withSynthesisLock<T>(operation: () => Promise<T>) {
  if (synthesizing) throw new SynthesisInProgressError();
  synthesizing = true;
  try {
    return await operation();
  } finally {
    synthesizing = false;
  }
}
