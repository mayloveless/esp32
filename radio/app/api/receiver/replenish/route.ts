import {
  assertLocalDevelopmentRequest,
  getRequestErrorStatus,
} from "../../../../lib/supabase-server";
import {
  ensureReceiverInventory,
  ReplenishmentInProgressError,
} from "../../../../receiver/inventory-orchestrator";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    assertLocalDevelopmentRequest(request);
    const result = await ensureReceiverInventory();
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
