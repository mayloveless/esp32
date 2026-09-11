export const maximumInventoryBatchSize = 50;

const programIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type InventoryBatchAction = "retire" | "restore" | "delete";

export function parseInventoryBatchRequest(value: unknown) {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("请求体必须是对象。");
  const body = value as { action?: unknown; programIds?: unknown };
  if (
    body.action !== "retire" &&
    body.action !== "restore" &&
    body.action !== "delete"
  )
    throw new Error("批量操作类型无效。");
  if (
    !Array.isArray(body.programIds) ||
    body.programIds.length === 0 ||
    body.programIds.length > maximumInventoryBatchSize
  )
    throw new Error(`每次最多处理 ${maximumInventoryBatchSize} 个节目。`);
  if (
    body.programIds.some(
      (id) => typeof id !== "string" || !programIdPattern.test(id),
    )
  )
    throw new Error("节目 ID 必须是 UUID。");
  return {
    action: body.action,
    programIds: [...new Set(body.programIds)],
  } as { action: InventoryBatchAction; programIds: string[] };
}
