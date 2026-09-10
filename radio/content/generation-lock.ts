export class GenerationInProgressError extends Error {
  constructor() {
    super("已有稿件正在生成，请等待当前请求完成后再试。");
  }
}

let generating = false;

export async function withGenerationLock<T>(operation: () => Promise<T>) {
  if (generating) throw new GenerationInProgressError();
  generating = true;
  try {
    return await operation();
  } finally {
    generating = false;
  }
}
