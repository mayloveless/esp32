/**
 * 在 completed 响应之外机会式补一条库存。调用者不会等待它，也不会因失败改变 completed 结果。
 */
export function replenishAfterReceiverCompletion(
  retired: boolean,
  ensure: () => Promise<unknown>,
  options: {
    isIgnoredError?: (error: unknown) => boolean;
    warn?: (error: unknown) => void;
  } = {},
) {
  if (!retired) return;
  void ensure().catch((error) => {
    if (!options.isIgnoredError?.(error)) options.warn?.(error);
  });
}
