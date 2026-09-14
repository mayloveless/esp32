import {
  assertLocalDevelopmentRequest,
  getRequestErrorStatus,
} from "../../../../../../lib/supabase-server";
import { completeReceiverProgram } from "../../../../../../receiver/completed";
import { replenishAfterReceiverCompletion } from "../../../../../../receiver/after-completed";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Context) {
  try {
    assertLocalDevelopmentRequest(request);
    const completed = await completeReceiverProgram((await params).id);
    if (!completed)
      return Response.json({ error: "节目不存在。" }, { status: 404 });
    replenishAfterReceiverCompletion(completed.retired);
    return Response.json(completed);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "无法完成节目下线。" },
      { status: getRequestErrorStatus(error, 400) },
    );
  }
}
