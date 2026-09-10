import {
  assertLocalDevelopmentRequest,
  getRequestErrorStatus,
  readJsonBody,
  RequestGuardError,
} from "../../../../lib/supabase-server";
import {
  replenishReceiverInventory,
  ReplenishmentInProgressError,
} from "../../../../receiver/auto-replenish";

export const runtime = "nodejs";

function parsePlayingProgramId(value: unknown) {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new RequestGuardError("请求体必须是对象。", 400);
  const id = (value as { playingProgramId?: unknown }).playingProgramId;
  if (id === undefined || id === null) return null;
  if (
    typeof id !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      id,
    )
  )
    throw new RequestGuardError("playingProgramId 必须是 UUID 或 null。", 400);
  return id;
}

export async function POST(request: Request) {
  try {
    assertLocalDevelopmentRequest(request);
    const result = await replenishReceiverInventory(
      parsePlayingProgramId(await readJsonBody(request)),
    );
    return Response.json(result);
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "无法补充接收机节目库存。",
      },
      {
        status:
          error instanceof ReplenishmentInProgressError
            ? 409
            : getRequestErrorStatus(error, 503),
      },
    );
  }
}
