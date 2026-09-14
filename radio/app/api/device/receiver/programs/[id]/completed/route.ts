import {
  assertDeviceRequest,
  getDeviceRequestErrorStatus,
} from "../../../../../../../lib/device-api";
import { completeReceiverProgram } from "../../../../../../../receiver/completed";
import { replenishAfterReceiverCompletion } from "../../../../../../../receiver/after-completed";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Context) {
  try {
    assertDeviceRequest(request);
    const completed = await completeReceiverProgram((await params).id);
    if (!completed)
      return Response.json({ error: "节目不存在。" }, { status: 404 });
    replenishAfterReceiverCompletion(completed.retired);
    return Response.json(completed, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "设备无法完成节目下线。" },
      { status: getDeviceRequestErrorStatus(error, 400) },
    );
  }
}
