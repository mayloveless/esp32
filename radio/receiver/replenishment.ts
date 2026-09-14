
export class ReplenishmentInProgressError extends Error {
  constructor() {
    super("已有接收机库存补充任务正在执行。");
  }
}

let replenishing = false;

export async function withReplenishmentLock<T>(operation: () => Promise<T>) {
  if (replenishing) throw new ReplenishmentInProgressError();
  replenishing = true;
  try {
    return await operation();
  } finally {
    replenishing = false;
  }
}
